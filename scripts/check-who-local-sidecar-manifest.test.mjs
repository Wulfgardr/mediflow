/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateWhoLocalManifest } from './check-who-local-sidecar-manifest.mjs';

const candidate = () => JSON.parse(readFileSync(new URL('../docs/who-local-sidecar.manifest.json', import.meta.url), 'utf8'));
// All values below are synthetic validation fixtures, not deployable artifact locks or accepted terms.
const synthetic = () => {
    const m = candidate(), hash = `sha256:${'a'.repeat(64)}`;
    Object.assign(m.image, { digest: hash, registryVerifiedAt: '2026-09-06T10:00:00.000Z', registryEvidenceSha256: hash });
    Object.assign(m.license, { acceptedAt: '2026-09-06T10:00:00.000Z', acceptanceRecordRef: 'synthetic-fixture-only' });
    Object.assign(m.dataset, { snapshotId: hash, snapshotInventorySha256: hash, offlineRestartVerified: true, restoreVerified: true });
    return m;
};

test('shipped candidate blocks provisioning and activation rather than inventing locks or acceptance', () => {
    const m = candidate();
    assert.equal(m.image.digest, null);
    assert.equal(m.license.acceptedAt, null);
    assert.deepEqual(validateWhoLocalManifest(m, 'provision'), ['primary_registry_lock_required', 'operator_license_acceptance_required']);
    assert.deepEqual(validateWhoLocalManifest(m), ['primary_registry_lock_required', 'operator_license_acceptance_required', 'dataset_inventory_and_offline_proof_required']);
});

test('recorded prerequisites for initial provisioning are distinct from activation proof', () => {
    const m = synthetic();
    assert.deepEqual(validateWhoLocalManifest(m), []);
    m.dataset.snapshotId = null;
    m.dataset.offlineRestartVerified = false;
    assert.deepEqual(validateWhoLocalManifest(m, 'provision'), []);
    assert.deepEqual(validateWhoLocalManifest(m), ['dataset_inventory_and_offline_proof_required']);
});

test('pins target/version/platform and refuses remote bind, analytics, mounts and automation', () => {
    const changes = [
        m => { m.image.version = 'latest'; }, m => { m.image.registry = 'mirror.invalid'; },
        m => { m.listener.host = '0.0.0.0'; }, m => { m.listener.hostPort = 8888; },
        m => { m.options.saveAnalytics = true; }, m => { m.options.enableDoris = true; },
        m => { m.mounts.push('/synthetic'); }, m => { m.automaticStart = true; },
        m => { m.extra = true; },
    ];
    for (const change of changes) { const m = synthetic(); change(m); assert.ok(validateWhoLocalManifest(m).length); }
});
