/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    FABRIC_BINDING_CANDIDATE_SCHEMA_V1,
    FabricBindingStoreError,
    GUIDED_FABRIC_CAPABILITIES,
    createFabricCapabilityBindingStore,
    type FabricBindingCandidateV1,
    type FabricBindingStoreErrorCode,
    type GuidedFabricCapability,
} from './capability-binding-store.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const REF_SUFFIX = '1'.repeat(32);
function candidate(capability: GuidedFabricCapability, profileId = 'profile.synthetic.balanced.v1'): FabricBindingCandidateV1 {
    return Object.freeze({
        schemaVersion: FABRIC_BINDING_CANDIDATE_SCHEMA_V1,
        capability, profileId, provider: 'synthetic_local', engine: 'synthetic_engine',
        runtimeRef: 'runtime.synthetic.local.v1', model: 'synthetic-model', modelVersion: '1.0.0', modelDigest: DIGEST,
        venue: 'local_process', credentialRef: null, egressProfileId: 'local_only',
        dataPolicy: 'clinical_local_only', recipeId: `recipe.${capability}.v1`,
        readiness: 'synthetic_smoke_passed', smokeReceiptRef: `smoke_receipt_${REF_SUFFIX}`,
        provenanceRef: `provenance_${REF_SUFFIX}`, fallback: 'none',
    });
}
function fixture(entropies = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32), '4'.repeat(32), '5'.repeat(32)],
    timestamps = ['2026-09-02T10:00:00.000Z', '2026-09-02T10:01:00.000Z', '2026-09-02T10:02:00.000Z',
        '2026-09-02T10:03:00.000Z', '2026-09-02T10:04:00.000Z']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fabric-binding-'));
    const store = createFabricCapabilityBindingStore(root, {
        entropy: () => entropies.shift(), now: () => timestamps.shift(),
    });
    return { root, store, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function expectCode(code: FabricBindingStoreErrorCode, run: () => unknown): void {
    assert.throws(run, (error) => error instanceof FabricBindingStoreError && error.code === code);
}

test('attiva atomicamente un binding locale smoke-tested senza persistere segreti', (t) => {
    const { root, store, cleanup } = fixture(); t.after(cleanup);
    assert.deepEqual(store.read(), {
        schemaVersion: 'mediflow.ai.fabric-binding-store.v1', version: 0,
        bindings: Object.assign(Object.create(null), { ocr: null, patient_insight: null, smart_import: null,
            document_synthesis: null, treatment_reasoning: null }), lastTransition: null,
    });

    const receipt = store.activate({ expectedVersion: 0, binding: candidate('patient_insight') });
    assert.deepEqual(receipt, {
        schemaVersion: 'mediflow.ai.fabric-binding-transition-receipt.v1', outcome: 'activated',
        transitionRef: `fabric_transition_${'1'.repeat(32)}`, capability: 'patient_insight',
        fromVersion: 0, toVersion: 1, previousBindingDigest: null,
        currentBindingDigest: receipt.currentBindingDigest, timestamp: '2026-09-02T10:00:00.000Z',
    });
    assert.match(receipt.currentBindingDigest!, /^sha256:[0-9a-f]{64}$/u);
    const state = store.read();
    assert.equal(state.version, 1);
    assert.equal(state.bindings.patient_insight?.readiness, 'synthetic_smoke_passed');
    assert.equal(state.bindings.patient_insight?.fallback, 'none');
    assert.equal(state.bindings.patient_insight?.activatedAt, receipt.timestamp);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.bindings), true);
    assert.doesNotMatch(fs.readFileSync(store.paths.recordPath, 'utf8'), /secret|token|api[_-]?key|clinical text/iu);
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.paths.recordPath).mode & 0o777, 0o600);
    assert.equal(store.paths.recordPath.startsWith(root), true);
});

test('ripristina soltanto l ultimo binding attivato e brucia il rollback', (t) => {
    const { store, cleanup } = fixture(); t.after(cleanup);
    const first = store.activate({ expectedVersion: 0, binding: candidate('ocr', 'profile.synthetic.light.v1') });
    const firstBinding = store.read().bindings.ocr;
    const second = store.activate({ expectedVersion: 1, binding: candidate('ocr', 'profile.synthetic.quality.v1') });
    assert.equal(first.outcome, 'activated');
    assert.equal(second.previousBindingDigest, first.currentBindingDigest);

    const rollback = store.rollback({ expectedVersion: 2, transitionRef: second.transitionRef });
    assert.equal(rollback.outcome, 'rolled_back');
    assert.equal(rollback.fromVersion, 2);
    assert.equal(rollback.toVersion, 3);
    assert.equal(rollback.currentBindingDigest, first.currentBindingDigest);
    assert.deepEqual(store.read().bindings.ocr, firstBinding);
    expectCode('transition_conflict', () => store.rollback({ expectedVersion: 3, transitionRef: second.transitionRef }));
    assert.equal(store.read().version, 3);
});

test('mantiene versioni CAS e un binding indipendente per tutte le cinque capability', (t) => {
    const { store, cleanup } = fixture(); t.after(cleanup);
    GUIDED_FABRIC_CAPABILITIES.forEach((capability, index) => {
        store.activate({ expectedVersion: index, binding: candidate(capability) });
    });
    const state = store.read();
    assert.equal(state.version, 5);
    for (const capability of GUIDED_FABRIC_CAPABILITIES) {
        assert.equal(state.bindings[capability]?.capability, capability);
    }
    expectCode('version_conflict', () => store.activate({ expectedVersion: 4, binding: candidate('ocr', 'profile.new.v1') }));
    assert.equal(store.read().version, 5);
});

test('nega replay, input ostili, clock rollback, record corrotti e lock concorrenti', (t) => {
    const first = fixture(['a'.repeat(32), 'b'.repeat(32)], ['2026-09-02T10:01:00.000Z', '2026-09-02T10:00:00.000Z']);
    t.after(first.cleanup);
    const activated = first.store.activate({ expectedVersion: 0, binding: candidate('document_synthesis') });
    expectCode('clock_invalid', () => first.store.rollback({ expectedVersion: 1, transitionRef: activated.transitionRef }));
    expectCode('input_invalid', () => first.store.activate({ expectedVersion: 1,
        binding: { ...candidate('smart_import'), extra: true } }));
    expectCode('input_invalid', () => first.store.activate(new Proxy({ expectedVersion: 1,
        binding: candidate('smart_import') }, {})));
    let observed = false;
    expectCode('input_invalid', () => first.store.activate(Object.defineProperty({ binding: candidate('smart_import') },
        'expectedVersion', { enumerable: true, get: () => { observed = true; return 1; } })));
    assert.equal(observed, false);

    const corrupt = fixture(); t.after(corrupt.cleanup);
    fs.mkdirSync(corrupt.store.paths.directory, { recursive: true });
    fs.writeFileSync(corrupt.store.paths.recordPath, '{"schemaVersion":"hostile"}\n');
    expectCode('corrupt', () => corrupt.store.read());

    const busy = fixture(); t.after(busy.cleanup);
    fs.mkdirSync(busy.store.paths.directory, { recursive: true });
    fs.writeFileSync(busy.store.paths.lockPath, 'synthetic lock');
    expectCode('busy', () => busy.store.activate({ expectedVersion: 0, binding: candidate('treatment_reasoning') }));
});
