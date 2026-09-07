/* @Codex: ordinary onboarding and real file hashing with synthetic Docker only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { onboardWho, prepareManifest, readReleaseLock } from './who-local-onboarding.mjs';
import { sha256 } from './who-local-qualification.mjs';

const id = letter => letter.repeat(64);
const lock = readReleaseLock();
function sandbox(t) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mediflow-who-onboarding-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}
function fakeDocker(options = {}) {
    const calls = [], containers = new Map(), payloads = new Map();
    const sourceFiles = new Map(lock.datasetFiles.map((name, i) => [name, Buffer.from(`Synthetic dataset ${i}: no WHO data or patient data\n`)]));
    let owner, creates = 0;
    const run = (args) => {
        calls.push(args);
        if (options.fail?.(args)) throw Object.assign(new Error('DO_NOT_PRINT_SYNTHETIC_SECRET'), { code: 'docker_unavailable' });
        if (args[0] === 'context' && args[1] === 'ls') return 'synthetic-context';
        if (args[0] === 'context' && args[1] === 'inspect') return 'unix:///synthetic/docker.sock';
        assert.deepEqual(args.slice(0, 2), ['--context', 'synthetic-context']);
        const a = args.slice(2);
        if (a[0] === 'info') return JSON.stringify({ os: 'linux', arch: 'arm64' });
        if (a[0] === 'image' && a[1] === 'pull') return '';
        if (a[0] === 'image' && a[1] === 'inspect') return JSON.stringify({ digests: [`whoicd/icd-api@${lock.imageDigest}`], os: 'linux', arch: 'arm64' });
        if (a[0] === 'container' && a[1] === 'ls') {
            const filter = a[a.indexOf('--filter') + 1];
            return [...containers.values()].filter(c => filter === `name=^/${c.name}$`).map(c => c.name).join('\n');
        }
        if (a[0] === 'container' && a[1] === 'create') {
            const cid = creates++ === 0 ? id('a') : id('b');
            owner = a[a.indexOf('--label') + 1].split('=')[1];
            const network = a[a.indexOf('--network') + 1];
            containers.set(cid, { id: cid, name: a[a.indexOf('--name') + 1], owner, running: false,
                networks: { [network]: { NetworkID: network === 'bridge' ? id('d') : id('c') } } });
            payloads.set(cid, cid === id('a') ? new Map(sourceFiles) : new Map()); return cid;
        }
        if (a[0] === 'container' && a[1] === 'inspect') {
            const c = containers.get(a[2]) ?? [...containers.values()].find(c => c.name === a[2]);
            if (!c) throw Object.assign(new Error('absent'), { code: 'docker_unavailable' });
            if (a.at(-1).includes('Config.Labels')) return JSON.stringify({ ...c, owner: options.wrongOwner ? 'different-installation' : c.owner,
                image: `whoicd/icd-api@${lock.imageDigest}`, mounts: 0, privileged: false, restart: 'no' });
            return JSON.stringify({ running: c.running, status: c.running ? 'running' : 'exited', imageId: `sha256:${id('e')}`,
                ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8382' }] }, mountCount: 0, privileged: false, network: 'bridge', restart: 'no' });
        }
        if (a[0] === 'container' && ['start', 'stop'].includes(a[1])) { containers.get(a.at(-1)).running = a[1] === 'start'; return a.at(-1); }
        if (a[0] === 'network' && a[1] === 'create') return id('c');
        if (a[0] === 'network' && a[1] === 'inspect') return JSON.stringify({ id: id('c'), internal: !options.nonInternal, ipv6: false, owner });
        if (a[0] === 'network' && a[1] === 'disconnect') {
            const c = containers.get(a[3]);
            assert.equal(c.running, true, 'Docker disconnect requires a running container');
            for (const [key, network] of Object.entries(c.networks)) if (key === a[2] || network.NetworkID === a[2]) delete c.networks[key];
            return '';
        }
        if (a[0] === 'network' && a[1] === 'connect') {
            containers.get(a[3]).networks[a[2]] = { NetworkID: a[2] === 'bridge' ? id('d') : id('c') }; return '';
        }
        if (a[0] === 'cp') {
            if (a[1].includes(':/tmp/')) {
                const [cid, file] = a[1].split(':/tmp/'); writeFileSync(a[2], payloads.get(cid).get(file), { mode: 0o644 }); chmodSync(a[2], 0o644);
            } else { const [cid, file] = a[2].split(':/tmp/'); payloads.get(cid).set(file, readFileSync(a[1])); }
            return '';
        }
        if (a[0] === 'exec') {
            const cid = a[1], command = a[2];
            if (command === 'curl') return JSON.stringify(options.invalidResponse ? {} : { destinationEntities: [{ id: 'http://id.who.int/icd/release/11/2026-01/mms/1000000001', title: 'Synthetic fixture', theCode: 'AA00' }] });
            if (command === 'stat') { const bytes = payloads.get(cid).get(path.basename(a.at(-1))).length; return `0 0 644 ${bytes} regular file`; }
            if (command === 'sha256sum') return `${(options.corruptRestore && cid === id('b')) || (options.corruptOriginal && cid === id('a')) ? id('f') : sha256(payloads.get(cid).get(path.basename(a.at(-1)))).slice(7)}  ${a.at(-1)}`;
            if (command === 'cat') return `Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 ${options.defaultRoute ? '00000000' : '000012AC'} 00000000 0001 0 0 0 ${options.defaultRoute ? '00000000' : '0000FFFF'}\n`;
        }
        throw new Error(`Unexpected fake Docker operation: ${a[0]} ${a[1]}`);
    };
    return { calls, containers, payloads, run };
}
function fixture(t, opts = {}) {
    const directory = sandbox(t), docker = fakeDocker(opts);
    const prompts = [], reports = [];
    const deps = { directory, ...docker, host: { platform: 'darwin', arch: 'arm64' }, portFree: async () => {}, wait: async () => {},
        now: () => '2026-09-07T12:00:00.000Z', ask: async prompt => { prompts.push(prompt); return prompt.includes('ACCETTO') ? 'ACCETTO' : 'n'; }, report: x => reports.push(x) };
    return { deps, docker, prompts, reports, directory };
}
const read = (directory, name) => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const noMutation = calls => assert.equal(calls.some(a => a.includes('pull') || a.includes('create') || a.includes('start') || a.includes('stop') || a.includes('cp')), false);

test('distributed official lock verifies the three primary evidence hashes and carries no deployment qualification', () => {
    assert.equal(lock.imageDigest, 'sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e');
    assert.equal(lock.registryEvidenceSha256, 'sha256:f88419655c10f2e43061c282a79aebf32579f07a5a416b3f5be4fb3b0421ada3');
    assert.equal(lock.datasetFiles.length, 5);
    assert.equal(lock.snapshotId, undefined); assert.equal(lock.acceptedAt, undefined);
    const m = prepareManifest(lock, 'synthetic-operator-gesture', '2026-09-07T12:00:00.000Z');
    assert.equal(m.dataset.restoreVerified, false); assert.equal(m.dataset.snapshotId, null);
});

test('ordinary single procedure creates manifest, computes snapshot and restore proof, configures without hash inputs', async t => {
    const { deps, directory, docker, prompts } = fixture(t);
    const result = await onboardWho('setup', deps);
    assert.equal(result.state, 'ready'); assert.equal(prompts.length, 2);
    const m = read(directory, 'manifest.json'), state = read(directory, 'installation.json');
    assert.equal(m.dataset.restoreVerified, true); assert.equal(m.dataset.offlineRestartVerified, true);
    assert.notEqual(m.dataset.snapshotId, 'sha256:ecf3b894425d5cfb7514868d554eb086a7b5e7284ef212d2bb230a84b523b825');
    const inventoryPath = path.join(directory, state.qualificationAttempt.snapshot.directory, 'inventory.json');
    assert.equal(sha256(readFileSync(inventoryPath)), m.dataset.snapshotInventorySha256);
    assert.equal(state.qualificationAttempt.installationId, state.installationId);
    assert.equal(state.qualificationAttempt.originalContainerId, id('a')); assert.equal(state.qualificationAttempt.restoredContainerId, id('b'));
    assert.equal(docker.containers.get(id('a')).running, true); assert.deepEqual(Object.keys(docker.containers.get(id('a')).networks), ['bridge']);
    assert.equal(docker.containers.get(id('b')).running, false);
    assert.equal(statSync(path.join(directory, 'who.env')).mode & 0o777, 0o600);
    assert.equal(statSync(result.launcher).mode & 0o777, 0o700);
    assert.match(readFileSync(path.join(directory, 'who.env'), 'utf8'), /MEDIFLOW_ICD_WHO_ENABLED=1/u);
    assert.equal(existsSync(path.join(directory, '.setup-active')), false);
    const creations = docker.calls.filter(a => a[2] === 'container' && a[3] === 'create');
    assert.equal(creations.length, 2);
    assert.ok(creations[0].includes('127.0.0.1:8382:80'));
    assert.equal(creations[1].includes('--publish'), false);
    for (const a of creations) {
        assert.equal(a.at(-1), `whoicd/icd-api@${lock.imageDigest}`);
        for (const expected of ['acceptLicense=true', 'include=2026-01_en', 'saveAnalytics=false', 'enableDoris=false', 'fhirSupport=false']) assert.ok(a.includes(expected));
        assert.equal(a.includes('--mount'), false); assert.equal(a.includes('--privileged'), false);
    }
    assert.doesNotMatch(JSON.stringify(docker.calls), /Config\.Env|"logs"|"rm"|"prune"|"sh"/u);
});

test('declined license or occupied port creates no installation and performs no mutation', async t => {
    for (const mode of ['decline', 'occupied']) {
        const { deps, directory, docker } = fixture(t);
        deps.ask = async () => 'no';
        if (mode === 'occupied') deps.portFree = async () => { throw Object.assign(new Error('busy'), { code: 'port_in_use' }); };
        await assert.rejects(onboardWho('setup', deps), error => ['cancelled', 'port_in_use'].includes(error.code));
        noMutation(docker.calls); assert.equal(existsSync(path.join(directory, 'installation.json')), false);
    }
});

test('Mac ARM boundary and missing Docker do not start a VM or use another platform', async t => {
    const f = fixture(t); f.deps.host = { platform: 'linux', arch: 'arm64' };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'host_unsupported' }); assert.equal(f.docker.calls.length, 0);
    const other = fixture(t); other.deps.run = () => { throw new Error('missing'); };
    await assert.rejects(onboardWho('setup', other.deps), { code: 'docker_unavailable' });
});

test('restore byte mismatch preserves incomplete receipt and keeps configuration disabled, recovering original only', async t => {
    const { deps, directory, docker } = fixture(t, { corruptRestore: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'restore_hash_mismatch' });
    const state = read(directory, 'installation.json'), manifest = read(directory, 'manifest.json');
    assert.equal(state.phase, 'qualification_required'); assert.equal(state.qualificationAttempt.complete, false);
    assert.equal(manifest.dataset.restoreVerified, false); assert.equal(manifest.dataset.snapshotId, null);
    assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
    assert.equal(docker.containers.get(id('a')).running, true); assert.deepEqual(Object.keys(docker.containers.get(id('a')).networks), ['bridge']);
    assert.equal(existsSync(path.join(directory, state.qualificationAttempt.snapshot.directory, 'qualification.json')), true);
});

test('default route or non-internal network prevents offline qualification and activation', async t => {
    for (const problem of [{ defaultRoute: true }, { nonInternal: true }]) {
        const { deps, directory } = fixture(t, problem);
        await assert.rejects(onboardWho('setup', deps), e => ['external_route_present', 'offline_network_mismatch'].includes(e.code));
        assert.equal(read(directory, 'manifest.json').dataset.offlineRestartVerified, false);
        assert.equal(read(directory, 'installation.json').qualificationAttempt.complete, false);
    }
});

test('ownership failure stops before qualification mutations and never adopts existing service', async t => {
    const { deps, docker } = fixture(t, { wrongOwner: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'container_ownership_invalid' });
    assert.equal(docker.calls.some(a => ['stop', 'exec', 'cp', 'disconnect'].some(word => a.includes(word))), false);
});

test('repeat ordinary setup reuses its own proven installation without redownload or requalification', async t => {
    const { deps, docker, directory } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    assert.equal((await onboardWho('setup', deps)).state, 'ready'); noMutation(docker.calls);
    const manifest = read(directory, 'manifest.json'); manifest.dataset.snapshotId = `sha256:${id('f')}`;
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await assert.rejects(onboardWho('status', deps), { code: 'private_state_invalid' });
});

test('unqualified start never installs or qualifies, and active procedure lock prevents concurrency', async t => {
    const { deps, directory, docker } = fixture(t);
    await assert.rejects(onboardWho('start', deps), { code: 'qualification_required' }); noMutation(docker.calls);
    mkdirSync(path.join(directory, '.setup-active'));
    await assert.rejects(onboardWho('setup', deps), { code: 'setup_busy' });
});

test('named app start loads WHO config directly, without manual env editing or overwriting inherited unrelated settings', async t => {
    const { deps, directory, docker } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    let launched = false;
    deps.appPortFree = async () => {};
    deps.launch = async environment => {
        launched = true;
        assert.equal(environment.MEDIFLOW_ICD_WHO_ENABLED, '1');
        assert.equal(environment.MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID, read(directory, 'manifest.json').dataset.snapshotId);
        assert.equal(environment.MEDIFLOW_DATA_DIR, process.env.MEDIFLOW_DATA_DIR);
        assert.equal(existsSync(path.join(directory, '.setup-active')), false);
    };
    await onboardWho('start', deps); assert.equal(launched, true); noMutation(docker.calls);
    deps.appPortFree = async () => { throw Object.assign(new Error('busy'), { code: 'app_running' }); };
    launched = false; await assert.rejects(onboardWho('start', deps), { code: 'app_running' }); assert.equal(launched, false);
});

test('original bytes changing during recovery prevent ready and preserve the exact recovery blocker', async t => {
    const { deps, directory } = fixture(t, { corruptOriginal: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'original_recovery_failed' });
    const state = read(directory, 'installation.json');
    assert.equal(state.qualificationAttempt.complete, false);
    assert.equal(state.qualificationAttempt.recoveryFailure, 'original_recovery_failed');
    assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
});

test('ordinary named launcher can start its own stopped WHO service without reinstallation', async t => {
    const { deps, docker } = fixture(t);
    await onboardWho('setup', deps);
    docker.containers.get(id('a')).running = false; docker.calls.length = 0;
    deps.appPortFree = async () => {}; deps.launch = async () => {};
    await onboardWho('start', deps);
    assert.equal(docker.containers.get(id('a')).running, true);
    assert.equal(docker.calls.filter(a => a[2] === 'container' && a[3] === 'start').length, 1);
    assert.equal(docker.calls.some(a => a.includes('pull') || a.includes('create') || a.includes('cp') || a.includes('stop')), false);
});

test('failed qualification resumes with newly calculated evidence and no second image download', async t => {
    const faults = { corruptRestore: true };
    const { deps, directory, docker } = fixture(t, faults);
    await assert.rejects(onboardWho('setup', deps), { code: 'restore_hash_mismatch' });
    const previousAttempt = read(directory, 'installation.json').qualificationAttempt.attemptId;
    faults.corruptRestore = false; docker.calls.length = 0;
    deps.ask = async prompt => prompt.includes('Riprendere') ? 's' : 'n';
    assert.equal((await onboardWho('setup', deps)).state, 'ready');
    const state = read(directory, 'installation.json');
    assert.notEqual(state.qualificationAttempt.attemptId, previousAttempt);
    assert.equal(state.qualificationAttempt.complete, true);
    assert.equal(docker.calls.some(a => a.includes('pull')), false);
    assert.equal(docker.calls.filter(a => a[2] === 'cp').length, 10);
});

test('status rejects a context changed to remote before inspecting any container', async t => {
    const { deps, docker } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    const prior = deps.run;
    deps.run = args => args[0] === 'context' && args[1] === 'inspect' ? 'ssh://synthetic-remote' : prior(args);
    await assert.rejects(onboardWho('status', deps), { code: 'local_context_required' });
    assert.equal(docker.calls.length, 0);
});
