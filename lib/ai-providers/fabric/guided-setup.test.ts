/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FABRIC_BINDING_CANDIDATE_SCHEMA_V1, createFabricCapabilityBindingStore } from './capability-binding-store.ts';
import {
    FABRIC_DOCUMENT_OCR_ROUTING_V1,
    FabricGuidedSetupError,
    createFabricGuidedSetupService,
    type FabricGuidedSetupErrorCode,
} from './guided-setup.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const SUFFIX = '1'.repeat(32);
function option(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        candidateRef: `candidate.synthetic.${SUFFIX}`, capability: 'patient_insight',
        profileId: 'profile.synthetic.balanced.v1', profileTier: 'balanced', optionalAdapter: false,
        installation: 'ready', compatibility: 'compatible', provider: 'synthetic_local', engine: 'synthetic_engine',
        runtimeRef: 'runtime.synthetic.local.v1', model: 'synthetic-model', modelVersion: '1.0.0',
        modelDigest: DIGEST, venue: 'local_process', credentialRef: null, egressProfileId: 'local_only',
        dataPolicy: 'clinical_local_only', recipeId: 'recipe.patient-insight.v1', fallback: 'none', downloadBytes: 0,
        ...overrides,
    });
}
function inventory(candidates: readonly unknown[]) {
    return Object.freeze({ schemaVersion: 'mediflow.ai.fabric-host-inventory.v1', platform: 'linux', architecture: 'x64',
        memoryMiB: 16_384, freeDiskMiB: 65_536, accelerators: Object.freeze(['cpu.synthetic']),
        candidates: Object.freeze([...candidates]) });
}
function fixture(options: { candidates?: readonly unknown[]; smokeOutcome?: string;
    installOverrides?: Readonly<Record<string, unknown>>; detectHostCandidates?: () => unknown } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-guided-setup-'));
    const entropies = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
    const timestamps = ['2026-09-02T11:00:00.000Z', '2026-09-02T11:01:00.000Z', '2026-09-02T11:02:00.000Z'];
    const store = createFabricCapabilityBindingStore(root, {
        entropy: () => entropies.shift(), now: () => timestamps.shift(),
    });
    const installs: unknown[] = []; const smokes: unknown[] = [];
    const candidates = options.candidates ?? [option(), option({ profileId: 'profile.synthetic.quality.v1',
        profileTier: 'quality', candidateRef: `candidate.quality.${SUFFIX}` }), option({
        candidateRef: `candidate.ocr.${SUFFIX}`, capability: 'ocr', profileId: 'profile.deepseek-ocr2.optional.v1',
        profileTier: 'quality', optionalAdapter: true, installation: 'download_required',
        runtimeRef: 'runtime.synthetic.ocr.v1', model: 'synthetic-ocr-model', recipeId: 'recipe.ocr.v1',
        downloadBytes: 4_096,
    }), option({ candidateRef: `candidate.hidden.${SUFFIX}`, capability: 'treatment_reasoning',
        profileId: 'profile.hidden.v1', compatibility: 'incompatible', recipeId: 'recipe.treatment.v1' })];
    const service = createFabricGuidedSetupService({
        detectHostCandidates: options.detectHostCandidates ?? (() => inventory(candidates)),
        installProfile: async (candidate: Record<string, unknown>) => {
            installs.push(candidate);
            return Object.freeze({ ...candidate, installation: 'ready', downloadBytes: 0,
                schemaVersion: 'mediflow.ai.fabric-profile-install.v1', outcome: 'installed',
                downloadReceiptRef: `download_receipt_${SUFFIX}`, ...options.installOverrides });
        },
        runSyntheticSmoke: async (request: Record<string, unknown>) => {
            smokes.push(request);
            return Object.freeze({ schemaVersion: 'mediflow.ai.fabric-synthetic-smoke.result.v1',
                outcome: options.smokeOutcome ?? 'passed', candidateRef: request.candidateRef,
                capability: request.capability, smokeReceiptRef: `smoke_receipt_${SUFFIX}`,
                provenanceRef: `provenance_${SUFFIX}`, fixture: request.fixture,
                egress: 'none', writesPerformed: 0 });
        },
        bindingStore: { activate: store.activate, rollback: store.rollback },
    });
    return { root, store, service, installs, smokes, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function expectCode(code: FabricGuidedSetupErrorCode, run: () => unknown): void {
    assert.throws(run, (error) => error instanceof FabricGuidedSetupError && error.code === code);
}
async function expectReject(code: FabricGuidedSetupErrorCode, run: () => Promise<unknown>): Promise<void> {
    await assert.rejects(run(), (error) => error instanceof FabricGuidedSetupError && error.code === code);
}

test('scopre solo profili compatibili per cinque capability senza dedurre dal nome modello', () => {
    const fixtureValue = fixture();
    try {
        const discovery = fixtureValue.service.discover();
        assert.equal(discovery.generation, 1);
        assert.equal(discovery.capabilities.length, 5);
        assert.equal(discovery.capabilities.find((item) => item.capability === 'patient_insight')?.status, 'ready');
        assert.equal(discovery.capabilities.find((item) => item.capability === 'ocr')?.status, 'download_required');
        assert.equal(discovery.capabilities.find((item) => item.capability === 'treatment_reasoning')?.status, 'unavailable');
        assert.equal(JSON.stringify(discovery).includes('profile.hidden.v1'), false);
        assert.deepEqual(discovery.ocrRouting, FABRIC_DOCUMENT_OCR_ROUTING_V1);
        assert.deepEqual(discovery.ocrRouting, { schemaVersion: 'mediflow.ai.document-ocr-routing.v1',
            firstPass: 'anydoc', ocrEligibility: 'needsOcr_only', malformedDisposition: 'denied',
            deepSeekOcr2: 'optional_adapter' });
        assert.equal(Object.isFrozen(discovery.capabilities), true);
    } finally { fixtureValue.cleanup(); }
});

test('nega credentialRef non nulli nell inventario locale', (t) => {
    const value = fixture({ candidates: [option({ credentialRef: `credential_ref_${SUFFIX}` })] });
    t.after(value.cleanup);
    expectCode('inventory_unavailable', () => value.service.discover());
});

test('mantiene transazionale la discovery se il nuovo inventario e invalido', async (t) => {
    let detected: readonly unknown[] = [option()];
    const value = fixture({ detectHostCandidates: () => inventory(detected) });
    t.after(value.cleanup);
    const first = value.service.discover();
    detected = [option(), option({ candidateRef: `candidate.duplicate.${SUFFIX}` })];
    expectCode('inventory_unavailable', () => value.service.discover());
    await expectReject('selection_unavailable', () => value.service.prepare({ generation: first.generation + 1,
        capability: 'patient_insight', profileId: 'profile.synthetic.balanced.v1', mode: 'advanced',
        download: 'not_required' }));
    assert.equal(value.smokes.length, 0);
    const retained = await value.service.prepare({ generation: first.generation, capability: 'patient_insight',
        profileId: 'profile.synthetic.balanced.v1', mode: 'recommended', download: 'not_required' });
    assert.equal(retained.receipt.profileId, 'profile.synthetic.balanced.v1');
});

test('esegue smoke sintetico e attiva il profilo raccomandato senza download o fallback', async (t) => {
    const value = fixture(); t.after(value.cleanup);
    const discovery = value.service.discover();
    const prepared = await value.service.prepare({ generation: discovery.generation, capability: 'patient_insight',
        profileId: 'profile.synthetic.balanced.v1', mode: 'recommended', download: 'not_required' });
    assert.equal(value.installs.length, 0);
    assert.deepEqual(value.smokes, [{ schemaVersion: 'mediflow.ai.fabric-synthetic-smoke.input.v1',
        fixture: 'mediflow.synthetic.fabric-setup.v1', candidateRef: `candidate.synthetic.${SUFFIX}`,
        capability: 'patient_insight' }]);
    assert.equal(prepared.receipt.fallback, 'none');
    assert.equal(JSON.stringify(prepared.receipt).includes('synthetic-model'), false);
    const activation = value.service.activate({ candidate: prepared.candidate, expectedVersion: 0 });
    assert.equal(activation.outcome, 'activated');
    assert.equal(value.store.read().bindings.patient_insight?.profileId, 'profile.synthetic.balanced.v1');
    expectCode('replay', () => value.service.activate({ candidate: prepared.candidate, expectedVersion: 1 }));
});

test('nega in activate un handle preparato su una generation ormai stale', async (t) => {
    const value = fixture(); t.after(value.cleanup);
    const discovery = value.service.discover();
    const prepared = await value.service.prepare({ generation: discovery.generation, capability: 'patient_insight',
        profileId: 'profile.synthetic.balanced.v1', mode: 'recommended', download: 'not_required' });
    value.service.discover();
    expectCode('selection_unavailable', () => value.service.activate({ candidate: prepared.candidate,
        expectedVersion: 0 }));
    assert.equal(value.store.read().version, 0);
});

test('non scarica OCR senza conferma e mantiene il binding precedente se lo smoke fallisce', async (t) => {
    const value = fixture({ smokeOutcome: 'failed' }); t.after(value.cleanup);
    value.store.activate({ expectedVersion: 0, binding: {
        schemaVersion: FABRIC_BINDING_CANDIDATE_SCHEMA_V1, capability: 'ocr', profileId: 'profile.previous.ocr.v1',
        provider: 'synthetic_local', engine: 'synthetic_engine', runtimeRef: 'runtime.previous.ocr.v1',
        model: 'synthetic-previous-ocr', modelVersion: '1.0.0', modelDigest: DIGEST, venue: 'local_process',
        credentialRef: null, egressProfileId: 'local_only', dataPolicy: 'clinical_local_only', recipeId: 'recipe.ocr.v1',
        readiness: 'synthetic_smoke_passed', smokeReceiptRef: `smoke_previous_${SUFFIX}`,
        provenanceRef: `provenance_previous_${SUFFIX}`, fallback: 'none',
    } });
    const discovery = value.service.discover();
    const input = { generation: discovery.generation, capability: 'ocr', profileId: 'profile.deepseek-ocr2.optional.v1',
        mode: 'recommended', download: 'not_required' } as const;
    await expectReject('download_confirmation_required', () => value.service.prepare(input));
    assert.equal(value.installs.length, 0);
    await expectReject('smoke_failed', () => value.service.prepare({ ...input, download: 'confirmed' }));
    assert.equal(value.installs.length, 1);
    assert.equal(value.store.read().version, 1);
    assert.equal(value.store.read().bindings.ocr?.profileId, 'profile.previous.ocr.v1');
});

test('richiede advanced per una scelta non raccomandata e supporta rollback atomico', async (t) => {
    const value = fixture(); t.after(value.cleanup);
    const discovery = value.service.discover();
    const selection = { generation: discovery.generation, capability: 'patient_insight',
        profileId: 'profile.synthetic.quality.v1', mode: 'recommended', download: 'not_required' } as const;
    await expectReject('selection_unavailable', () => value.service.prepare(selection));
    const prepared = await value.service.prepare({ ...selection, mode: 'advanced' });
    assert.equal(prepared.receipt.selectionDisposition, 'advanced_override');
    const activation = value.service.activate({ candidate: prepared.candidate, expectedVersion: 0 });
    const rollback = value.service.rollback({ expectedVersion: 1, transitionRef: activation.transitionRef });
    assert.equal(rollback.outcome, 'rolled_back');
    assert.equal(value.store.read().bindings.patient_insight, null);
});

test('invalida selezioni stale e nega inventari o payload ostili', async (t) => {
    const value = fixture(); t.after(value.cleanup);
    const first = value.service.discover(); value.service.discover();
    await expectReject('selection_unavailable', () => value.service.prepare({ generation: first.generation,
        capability: 'patient_insight', profileId: 'profile.synthetic.balanced.v1', mode: 'recommended',
        download: 'not_required' }));
    const current = value.service.discover();
    const pending = value.service.prepare({ generation: current.generation, capability: 'patient_insight',
        profileId: 'profile.synthetic.balanced.v1', mode: 'recommended', download: 'not_required' });
    value.service.discover();
    await assert.rejects(pending, (error) => error instanceof FabricGuidedSetupError
        && error.code === 'selection_unavailable');
    expectCode('input_invalid', () => createFabricGuidedSetupService(new Proxy({}, {})));

    const hostile = fixture({ candidates: [option({ optionalAdapter: true, capability: 'patient_insight' })] });
    t.after(hostile.cleanup);
    expectCode('inventory_unavailable', () => hostile.service.discover());

    const drift = fixture({ installOverrides: { modelDigest: `sha256:${'b'.repeat(64)}` } });
    t.after(drift.cleanup);
    const driftDiscovery = drift.service.discover();
    await expectReject('download_failed', () => drift.service.prepare({ generation: driftDiscovery.generation,
        capability: 'ocr', profileId: 'profile.deepseek-ocr2.optional.v1', mode: 'recommended',
        download: 'confirmed' }));
    assert.equal(drift.smokes.length, 0);
});
