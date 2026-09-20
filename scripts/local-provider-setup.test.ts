/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import Database from 'better-sqlite3';
import { parseLocalProviderSetupArgs, runLocalProviderSetup } from './local-provider-setup.ts';
import { createHostProviderLifecycleService } from '../lib/ai-providers/fabric/provider-lifecycle-service.ts';
import type { attestLocalOllamaModel } from '../lib/ai-providers/ollama-locality.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf086-provider-setup-')); roots.push(root);
    const db = new Database(path.join(root, 'medical.db'));
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO settings VALUES ('aiModel_clinical', 'synthetic-local');");
    db.close(); return root;
}
const observed: typeof attestLocalOllamaModel = async (endpoint, model, signal) => {
    assert.equal(endpoint, 'http://127.0.0.1:11434'); assert.equal(model, 'synthetic-local'); assert.equal(signal?.aborted, false);
    return { authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback',
        requestedModel: model, canonicalModel: model, digest: 'a'.repeat(64), serverVersion: '0.32.0', checkedAt: '2026-09-06T00:00:00.000Z' };
};
const command = (dataDir: string, action: 'inspect' | 'admit' | 'recover' | 'revoke', confirmed = true) => ({ dataDir, action, confirmed });
function setting(root: string, value: string) {
    const db = new Database(path.join(root, 'medical.db')); db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, 'aiModel_clinical'); db.close();
}

test('requires explicit directory and write confirmation; inspect does not attest or write', async () => {
    for (const args of [[], ['admit', '--data-dir', '/tmp/example'], ['inspect', '--data-dir', 'relative'],
        ['inspect', '--data-dir', '/tmp/example', '--model', 'anything']]) assert.throws(() => parseLocalProviderSetupArgs(args));
    const root = fixture(); const before = fs.readFileSync(path.join(root, 'medical.db'));
    const result = await runLocalProviderSetup(parseLocalProviderSetupArgs(['inspect', '--data-dir', root]), async () => { throw new Error('must not attest'); });
    assert.equal(result.outcome, 'configuration_read'); assert.equal(result.lifecycle, 'missing');
    assert.equal(fs.existsSync(path.join(root, 'ai')), false); assert.deepEqual(fs.readFileSync(path.join(root, 'medical.db')), before);
    await assert.rejects(runLocalProviderSetup(command(root, 'admit', false), observed), /confirmation_required/);
    await assert.rejects(runLocalProviderSetup(command(path.join(root, 'absent'), 'inspect')), /data_directory_invalid/);
    assert.equal(fs.existsSync(path.join(root, 'absent')), false);
});

test('attestation failure and invalid model cannot admit, and raw errors stay out of output', async () => {
    const root = fixture();
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), async () => { throw new Error('private transport detail'); }), /^LocalProviderSetupError: local_attestation_failed$/);
    setting(root, 'synthetic:cloud');
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), async () => { assert.fail('no attestation for invalid binding'); }), /model_invalid/);
    assert.equal(createHostProviderLifecycleService({ appDataDir: root }).service.read().status, 'denied');
});

test('admits once, preserves settings, recovers explicitly and keeps revocation terminal', async () => {
    const root = fixture(); const before = fs.readFileSync(path.join(root, 'medical.db'));
    const admitted = await runLocalProviderSetup(command(root, 'admit'), observed);
    assert.equal(admitted.outcome, 'admitted'); assert.equal(admitted.lifecycleVersion, 1);
    assert.equal(admitted.lifecycle, 'available_unqualified'); assert.equal(admitted.inference, 'not_run');
    assert.equal((await runLocalProviderSetup(command(root, 'admit'), observed)).outcome, 'unchanged');
    const boundary = createHostProviderLifecycleService({ appDataDir: root }); boundary.control.degrade({ expectedVersion: 1 });
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), observed), /use_recover/);
    const recovered = await runLocalProviderSetup(command(root, 'recover'), observed); assert.equal(recovered.lifecycleVersion, 3);
    const revoked = await runLocalProviderSetup(command(root, 'revoke'), observed); assert.equal(revoked.lifecycleVersion, 4);
    assert.equal((await runLocalProviderSetup(command(root, 'revoke'), observed)).outcome, 'unchanged');
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), observed), /lifecycle_revoked/);
    await assert.rejects(runLocalProviderSetup(command(root, 'recover'), observed), /lifecycle_revoked/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'medical.db')), before);
});

test('rejects a changed binding or concurrent lifecycle before committing', async () => {
    const root = fixture();
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), async (...args) => {
        const attestation = await observed(...args); setting(root, 'replacement-local'); return attestation;
    }), /binding_changed/);
    setting(root, 'synthetic-local');
    await runLocalProviderSetup(command(root, 'admit'), observed);
    await assert.rejects(runLocalProviderSetup(command(root, 'admit'), async (...args) => {
        const attestation = await observed(...args);
        createHostProviderLifecycleService({ appDataDir: root }).control.revoke({ expectedVersion: 1 });
        return attestation;
    }), /lifecycle_changed/);
});

test('the privileged setup module has no imports from UI, routes or runtime consumers', () => {
    for (const directory of ['app', 'components', 'hooks', 'lib', 'packages']) {
        for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
            assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*scripts\/(?:local-provider-setup|setup-local-provider)/);
        }
    }
});
