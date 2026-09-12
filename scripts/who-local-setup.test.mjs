/* @Codex: synthetic Docker and filesystem fixtures only. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONTAINER_NAME, ENABLE_CONFIRMATION, INSTALL_CONFIRMATION, configurationText, executeSetup, inspectStatus, parseArguments, readManifest } from './who-local-setup.mjs';

const hash = `sha256:${'a'.repeat(64)}`;
const fixture = () => {
    const m = JSON.parse(readFileSync(new URL('../docs/who-local-sidecar.manifest.json', import.meta.url), 'utf8'));
    Object.assign(m.image, { digest: hash, registryVerifiedAt: '2026-09-07T12:00:00.000Z', registryEvidenceSha256: hash });
    Object.assign(m.license, { acceptedAt: '2026-09-07T12:00:00.000Z', acceptanceRecordRef: 'synthetic-license-record' });
    Object.assign(m.dataset, { snapshotId: hash, snapshotInventorySha256: hash, offlineRestartVerified: true, restoreVerified: true });
    return m;
};
function provisioningFixture() {
    const m = fixture();
    Object.assign(m.dataset, { snapshotId: null, snapshotInventorySha256: null, offlineRestartVerified: false, restoreVerified: false });
    return m;
}
function temporary(t, manifest = fixture()) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-who-setup-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const filename = path.join(dir, 'manifest.json');
    writeFileSync(filename, JSON.stringify(manifest), { mode: 0o600 });
    return { filename, output: path.join(dir, 'who.env'), dir };
}
function dockerFixture(overrides = {}) {
    const calls = [];
    const config = {
        running: true, status: 'running', imageId: hash, ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8382' }], '443/tcp': null },
        mountCount: 0, privileged: false, network: 'bridge', restart: 'no', ...overrides.container,
    };
    const image = { digests: [`whoicd/icd-api@${hash}`], os: 'linux', arch: 'arm64', ...overrides.image };
    const run = (args, timeout) => {
        calls.push({ args, timeout });
        if (overrides.fail?.(args)) throw new Error('SYNTHETIC_SECRET_DO_NOT_PRINT');
        if (args[0] === 'context') return overrides.endpoint ?? 'unix:///synthetic/docker.sock';
        assert.deepEqual(args.slice(0, 2), ['--context', 'synthetic-context']);
        if (args[2] === 'info') return JSON.stringify({ os: 'linux', arch: 'aarch64', ...overrides.engine });
        if (args[2] === 'container' && args[3] === 'ls') return overrides.names ?? CONTAINER_NAME;
        if (args[2] === 'container' && args[3] === 'inspect') return JSON.stringify(config);
        if (args[2] === 'image' && args[3] === 'inspect') return JSON.stringify(image);
        if (args[2] === 'image' && args[3] === 'pull') return '';
        if (args[2] === 'container' && args[3] === 'create') return 'b'.repeat(64);
        if (args[2] === 'container' && args[3] === 'start') return 'b'.repeat(64);
        throw new Error(`Unexpected fake call ${args[2]}`);
    };
    return { calls, run };
}
const options = (filename, action, extra = {}) => ({ action, manifest: filename, context: 'synthetic-context', ...extra });
const blocked = code => error => error.code === code;

test('closed CLI options reject free commands, duplicate flags, remote targets and relative paths', () => {
    assert.equal(parseArguments(['status', '--manifest', path.join(os.tmpdir(), 'synthetic-manifest.json'), '--context', 'synthetic-context']).action, 'status');
    for (const args of [
        ['exec', '--manifest', '/synthetic/m.json'], ['init', '--manifest', '/synthetic/m.json', '--confirm', 'yes'],
        ['status', '--manifest', '/synthetic/m.json', '--context', 'x', '--context', 'y'],
        ['status', '--manifest', '/synthetic/m.json', '--context', 'tcp://host'],
        ['status', '--manifest', '/synthetic/m.json', '--context', 'x', '--container', 'x;echo bad'],
        ['plan', '--manifest', 'relative.json'], ['plan', '--manifest', '/synthetic/m.json', '--url', 'http://remote'],
    ]) assert.throws(() => parseArguments(args));
});

test('init preserves existing files and creates a private incomplete manifest without Docker', async t => {
    const { dir, filename } = temporary(t);
    const run = () => assert.fail('No Docker for init');
    await assert.rejects(executeSetup({ action: 'init', manifest: filename }, { run }), blocked('output_exists_or_unwritable'));
    const target = path.join(dir, 'new.json');
    assert.equal((await executeSetup({ action: 'init', manifest: target }, { run })).state, 'manifest_created');
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(readManifest(target).license.acceptedAt, null);
    const result = await executeSetup({ action: 'plan', manifest: target }, { run });
    assert.equal(result.state, 'prerequisites_incomplete');
    assert.ok(result.activationErrors.includes('dataset_inventory_and_offline_proof_required'));
});

test('manifest read refuses symlinks, oversized content and malformed JSON', t => {
    const { dir, filename } = temporary(t);
    const link = path.join(dir, 'link.json'); symlinkSync(filename, link);
    assert.throws(() => readManifest(link), blocked('manifest_unreadable'));
    writeFileSync(filename, 'x'.repeat(32769));
    assert.throws(() => readManifest(filename), blocked('manifest_unreadable'));
    writeFileSync(filename, '{');
    assert.throws(() => readManifest(filename), blocked('manifest_unreadable'));
});

test('invalid license or manifest and missing exact confirmation issue zero Docker calls', async t => {
    const { filename, output } = temporary(t);
    const fake = dockerFixture();
    for (const action of ['install', 'configure']) {
        await assert.rejects(executeSetup(options(filename, action, { output, confirm: 'yes' }), fake), blocked('confirmation_required'));
    }
    const m = fixture(); m.license.acceptedAt = null; writeFileSync(filename, JSON.stringify(m));
    await assert.rejects(executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), fake), blocked('prerequisites_incomplete'));
    assert.equal(fake.calls.length, 0);
});

test('status is read-only, context-scoped and projects metadata without environment or secrets', async t => {
    const { filename } = temporary(t);
    const fake = dockerFixture();
    const result = await executeSetup(options(filename, 'status'), fake);
    assert.equal(result.state, 'running');
    assert.deepEqual(result.activationErrors, []);
    const commands = JSON.stringify(fake.calls);
    assert.doesNotMatch(commands, /\.Env|\.Config\}\}|"(logs|exec|start|stop|pull|create|remove|prune|use)"/u);
    assert.doesNotMatch(JSON.stringify(result), /imageId|docker.sock|sha256/u);
});

test('nonlocal engine or wrong platform fails before container inspection', () => {
    for (const endpoint of ['tcp://127.0.0.1:2375', 'ssh://synthetic', 'https://remote.invalid']) {
        const fake = dockerFixture({ endpoint });
        assert.throws(() => inspectStatus(fixture(), 'synthetic-context', CONTAINER_NAME, fake.run), blocked('local_context_required'));
        assert.equal(fake.calls.length, 1);
    }
    const fake = dockerFixture({ engine: { arch: 'x86_64' } });
    assert.throws(() => inspectStatus(fixture(), 'synthetic-context', CONTAINER_NAME, fake.run), blocked('platform_mismatch'));
});

test('configuration denies mismatch, stopped or absent container without writing', async t => {
    const { filename, output } = temporary(t);
    for (const overrides of [
        { container: { running: false } }, { names: '' }, { image: { digests: [] } },
        { container: { ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8382' }] } } },
        { container: { ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8382' }], '443/tcp': [{ HostIp: '0.0.0.0', HostPort: '8443' }] } } },
        { container: { mountCount: 1 } }, { container: { privileged: true } }, { container: { restart: 'always' } },
    ]) {
        await assert.rejects(executeSetup(options(filename, 'configure', { output, confirm: ENABLE_CONFIRMATION }), dockerFixture(overrides)));
        assert.throws(() => statSync(output), { code: 'ENOENT' });
    }
});

test('activation writes exactly the existing three-variable contract, privately and without overwrite', async t => {
    const { filename, output } = temporary(t);
    const fake = dockerFixture();
    assert.equal((await executeSetup(options(filename, 'configure', { output, confirm: ENABLE_CONFIRMATION }), fake)).state, 'configuration_written');
    assert.equal(readFileSync(output, 'utf8'), `MEDIFLOW_ICD_WHO_ENABLED=1\nMEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST=${hash}\nMEDIFLOW_ICD_WHO_LOCAL_DATASET_ID=${hash}\n`);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    await assert.rejects(executeSetup(options(filename, 'configure', { output, confirm: ENABLE_CONFIRMATION }), fake), blocked('output_exists_or_unwritable'));
    assert.doesNotMatch(JSON.stringify(fake.calls), /"(start|create|pull|stop|exec)"/u);
});

test('snapshot/offline/restore gates precede all activation Docker calls', async t => {
    const m = fixture(); m.dataset.restoreVerified = false;
    const { filename, output } = temporary(t, m);
    const fake = dockerFixture();
    await assert.rejects(executeSetup(options(filename, 'configure', { output, confirm: ENABLE_CONFIRMATION }), fake), blocked('prerequisites_incomplete'));
    assert.equal(fake.calls.length, 0);
    assert.throws(() => configurationText(m), blocked('prerequisites_incomplete'));
});

test('install uses only pinned fixed flags and starts only its newly-created container ID', async t => {
    const { filename } = temporary(t, provisioningFixture());
    const fake = dockerFixture({ names: '' });
    let checkedPort = false;
    const result = await executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), { ...fake, portFree: async () => { checkedPort = true; } });
    assert.equal(result.state, 'container_started'); assert.equal(checkedPort, true);
    const create = fake.calls.find(c => c.args[3] === 'create').args;
    assert.deepEqual(create.slice(4), ['--name', CONTAINER_NAME, '--platform', 'linux/arm64', '--label', 'org.mediflow.owner=mediflow.who.guided.v1', '--restart', 'no', '--publish', '127.0.0.1:8382:80', '--env', 'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt', '--env', 'acceptLicense=true', '--env', 'include=2026-01_en', '--env', 'saveAnalytics=false', '--env', 'enableDoris=false', '--env', 'fhirSupport=false', `whoicd/icd-api@${hash}`]);
    assert.deepEqual(fake.calls.at(-1).args, ['--context', 'synthetic-context', 'container', 'start', 'b'.repeat(64)]);
});

test('existing container and occupied port stop installation before download or mutation', async t => {
    const { filename } = temporary(t, provisioningFixture());
    const fake = dockerFixture();
    await assert.rejects(executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), fake), blocked('container_conflict'));
    assert.doesNotMatch(JSON.stringify(fake.calls), /"(pull|create|start)"/u);
    const empty = dockerFixture({ names: '' });
    await assert.rejects(executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), { ...empty, portFree: async () => { throw new Error('occupied'); } }));
    assert.doesNotMatch(JSON.stringify(empty.calls), /"(pull|create|start)"/u);
});

test('failed pull/create/start retains resources and emits a bounded phase error, never raw logs', async t => {
    const { filename } = temporary(t, provisioningFixture());
    for (const phase of ['pull', 'create', 'start']) {
        const fake = dockerFixture({ names: '', fail: args => args[3] === phase });
        await assert.rejects(executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), { ...fake, portFree: async () => {} }), error => error.code === `${phase}_failed` && !error.message.includes('SYNTHETIC_SECRET'));
        assert.doesNotMatch(JSON.stringify(fake.calls), /"(rm|prune|stop|kill)"/u);
        assert.equal(fake.calls.at(-1).args[3], phase);
    }
});

test('new installation cannot inherit dataset qualification from another deployment', async t => {
    const { filename } = temporary(t);
    const fake = dockerFixture();
    await assert.rejects(executeSetup(options(filename, 'install', { confirm: INSTALL_CONFIRMATION }), fake), blocked('fresh_qualification_required'));
    assert.equal(fake.calls.length, 0);
});
