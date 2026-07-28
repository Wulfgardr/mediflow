/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    issueCapabilityAttestation,
    type CapabilityAttestation,
    type CapabilityAttestationClaims,
    type CapabilityAttestationFailure,
} from './capability-attestation.ts';
import {
    AI_LANE_TASK_BINDINGS,
    localProviderRegistry,
    ProviderRegistryError,
} from './registry.ts';
import type { AiLane } from './provider.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const NOW = new Date('2030-01-02T00:00:00.000Z');
const EVIDENCE_REF = 'local:synthetic/registry-capability';
const VERIFIED_REFS = new Set([EVIDENCE_REF]);
const BASE_BINDING = {
    task: 'clinical',
    models: {
        clinical: 'qwen3.5:35b-a3b',
        reasoning: 'reasoning-model',
        ocr: 'ocr-model',
    },
    endpoint: 'http://localhost:11434',
    chatTimeoutMs: 1_000,
};
const LANE_BINDING = {
    models: BASE_BINDING.models,
    endpoint: BASE_BINDING.endpoint,
    chatTimeoutMs: BASE_BINDING.chatTimeoutMs,
    expectedModelDigest: DIGEST_A,
};
function attest(
    lane: AiLane = 'patient_insight',
    overrides: Partial<CapabilityAttestationClaims> = {},
): CapabilityAttestation {
    return issueCapabilityAttestation({
        schemaVersion: 'mediflow.ai.capability-attestation.v1',
        lane,
        modelDigest: DIGEST_A,
        authorityPlane: 'clinical_application',
        issuer: 'synthetic-registry-test-issuer',
        evidenceRef: EVIDENCE_REF,
        issuedAt: '2030-01-01T00:00:00.000Z',
        expiresAt: '2030-01-03T00:00:00.000Z',
        ...overrides,
    });
}
function assertRegistryError(run: () => unknown, code: string) {
    assert.throws(run, (error) => error instanceof ProviderRegistryError && error.code === code);
}

for (const task of ['clinical', 'reasoning', 'ocr']) {
    test(`associa ${task} al provider Ollama locale`, () => {
        const resolved = localProviderRegistry.resolve({ ...BASE_BINDING, task });

        assert.deepEqual(resolved.receipt, {
            schemaVersion: 'mediflow.ai.provider-selection.v1',
            authorityPlane: 'clinical_application',
            task,
            provider: 'ollama',
            model: BASE_BINDING.models[task as keyof typeof BASE_BINDING.models],
            execution: 'local',
            endpointClass: 'loopback',
            egress: 'none',
            runtimeReadiness: 'required',
            fallbackCount: 0,
        });
        assert.deepEqual(resolved.fallback, { strategy: 'none', candidates: [] });
        assert.equal(Object.isFrozen(resolved.receipt), true);
        assert.equal(Object.isFrozen(resolved.fallback), true);
        assert.equal(resolved.manifest.modelCapabilityReadiness, 'runtime_attestation_required');
        assert.equal(resolved.manifest.capabilityEvidence, 'provider_transport_only');
    });
}

for (const [binding, code] of [
    [{ ...BASE_BINDING, task: 'unknown' }, 'invalid_task'],
    [{ ...BASE_BINDING, provider: 'openai' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, provider: '' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, provider: '   ' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, endpoint: ['https:', '//api.example.test'].join('') }, 'endpoint_not_local'],
    [{ ...BASE_BINDING, models: { clinical: 'qwen3.5:cloud' } }, 'invalid_model'],
    [{ ...BASE_BINDING, models: { clinical: '   ' } }, 'invalid_model'],
    [{ ...BASE_BINDING, models: {} }, 'invalid_model'],
] as const) {
    test(`rifiuta il binding non valido ${code} senza fallback`, () => {
        assert.throws(() => localProviderRegistry.resolve(binding), (error) => {
            return error instanceof ProviderRegistryError && error.code === code;
        });
    });
}

test('non include endpoint, prompt o credenziali nella ricevuta', () => {
    const receipt = localProviderRegistry.resolve(BASE_BINDING).receipt;
    const serialized = JSON.stringify(receipt);

    assert.equal(serialized.includes('11434'), false);
    assert.equal(serialized.includes('prompt'), false);
    assert.equal(serialized.includes('credential'), false);
});
for (const [lane, task] of [
    ['patient_insight', 'clinical'],
    ['smart_import', 'clinical'],
    ['document_synthesis', 'reasoning'],
    ['ocr', 'ocr'],
] as const) {
    test(`risolve la lane ${lane} solo con readiness attestata`, () => {
        assert.equal(AI_LANE_TASK_BINDINGS[lane], task);
        const blocked = localProviderRegistry.resolveForLane({ ...LANE_BINDING, lane, now: NOW });
        assert.equal(Object.hasOwn(blocked, 'transport'), false);
        assert.deepEqual(blocked.readiness, {
            status: 'blocked',
            binding: { lane, modelDigest: DIGEST_A, authorityPlane: 'clinical_application' },
            reason: 'attestation_absent',
        });
        const ready = localProviderRegistry.resolveForLane({
            ...LANE_BINDING, lane, attestation: attest(lane), now: NOW,
            locallyVerifiedEvidenceRefs: VERIFIED_REFS,
        });
        assert.equal(ready.readiness.status, 'ready');
        if (!('transport' in ready)) assert.fail('ready senza transport');
        assert.equal(ready.transport.receipt.task, task);
        assert.equal(ready.transport.receipt.provider, 'ollama');
        assert.equal(ready.transport.receipt.model, BASE_BINDING.models[task]);
        assert.equal(typeof ready.transport.adapter.chat, 'function');
        assert.deepEqual(ready.laneReceipt, {
            schemaVersion: 'mediflow.ai.lane-selection.v1',
            lane,
            task,
            provider: 'ollama',
            model: BASE_BINDING.models[task],
            modelDigest: DIGEST_A,
            authorityPlane: 'clinical_application',
            execution: 'local',
            endpointClass: 'loopback',
            egress: 'none',
            readiness: 'ready',
            fallbackCount: 0,
        });
    });
}
const valid = attest();
const BLOCKED_CASES: ReadonlyArray<{
    name: string;
    reason: CapabilityAttestationFailure;
    attestation?: CapabilityAttestation;
    refs?: ReadonlySet<string>;
}> = [
    { name: 'attestazione assente', reason: 'attestation_absent' },
    { name: 'attestazione scaduta', reason: 'expired',
        attestation: attest('patient_insight', { expiresAt: NOW.toISOString() }), refs: VERIFIED_REFS },
    { name: 'attestazione manomessa', reason: 'integrity_mismatch',
        attestation: { ...valid, issuer: 'tampered-synthetic-issuer' }, refs: VERIFIED_REFS },
    { name: 'evidenza non verificata', reason: 'evidence_unverified', attestation: valid },
    { name: 'grant di altra lane non ereditato', reason: 'lane_mismatch',
        attestation: attest('ocr'), refs: VERIFIED_REFS },
    { name: 'digest diverso', reason: 'model_digest_mismatch',
        attestation: attest('patient_insight', { modelDigest: DIGEST_B }), refs: VERIFIED_REFS },
    { name: 'plane engineering', reason: 'authority_plane_mismatch',
        attestation: attest('patient_insight', { authorityPlane: 'engineering_operator' }),
        refs: VERIFIED_REFS },
];
for (const scenario of BLOCKED_CASES) {
    test(`blocca ${scenario.name} con reason esatta`, () => {
        const result = localProviderRegistry.resolveForLane({
            ...LANE_BINDING,
            lane: 'patient_insight',
            attestation: scenario.attestation,
            now: NOW,
            locallyVerifiedEvidenceRefs: scenario.refs,
        });
        assert.equal(result.readiness.status, 'blocked');
        if (result.readiness.status === 'blocked') assert.equal(result.readiness.reason, scenario.reason);
        assert.equal(Object.hasOwn(result, 'transport'), false);
        assert.equal(result.laneReceipt.readiness, 'blocked');
        assert.equal(result.laneReceipt.reason, scenario.reason);
    });
}
test('respinge treatment_reasoning senza binding Ollama', () => {
    assert.equal(Object.hasOwn(AI_LANE_TASK_BINDINGS, 'treatment_reasoning'), false);
    assertRegistryError(
        () => localProviderRegistry.resolveForLane({ ...LANE_BINDING, lane: 'treatment_reasoning' }),
        'lane_not_registry_servable',
    );
});
test('respinge una lane runtime sconosciuta', () => {
    assertRegistryError(
        () => localProviderRegistry.resolveForLane({ ...LANE_BINDING, lane: 'exfiltration_lane' }),
        'invalid_lane',
    );
});
for (const [override, code] of [
    [{ provider: 'openai' }, 'provider_not_registered'],
    [{ models: { ...BASE_BINDING.models, clinical: '   ' } }, 'invalid_model'],
    [{ endpoint: ['https:', '//api.example.test'].join('') }, 'endpoint_not_local'],
    [{ expectedModelDigest: 'sha256:invalid' }, 'invalid_model_digest'],
] as const) {
    test(`preserva il rifiuto lane ${code}`, () => {
        assertRegistryError(
            () => localProviderRegistry.resolveForLane({
                ...LANE_BINDING, lane: 'patient_insight', ...override,
            }),
            code,
        );
    });
}
test('congela risultato e receipt senza dati sensibili o fallback', () => {
    const result = localProviderRegistry.resolveForLane({
        ...LANE_BINDING, lane: 'patient_insight', attestation: valid, now: NOW,
        locallyVerifiedEvidenceRefs: VERIFIED_REFS,
    });
    if (!('transport' in result)) assert.fail('ready senza transport');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.laneReceipt), true);
    assert.equal(Object.isFrozen(result.readiness), true);
    assert.deepEqual(result.transport.fallback, { strategy: 'none', candidates: [] });
    assert.throws(() => Object.assign(result.laneReceipt, { readiness: 'blocked' }));
    const serialized = JSON.stringify(result.laneReceipt);
    assert.equal(Object.hasOwn(result.laneReceipt, 'endpoint'), false);
    for (const forbidden of ['11434', 'prompt', 'credential']) {
        assert.equal(serialized.includes(forbidden), false);
    }
});

test('blocked non espone adapter e non raggiunge fetch', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('synthetic fetch sentinel');
    }) as typeof fetch;
    try {
        for (const attestation of [undefined, attest('ocr')]) {
            const result = localProviderRegistry.resolveForLane({
                ...LANE_BINDING, lane: 'patient_insight', attestation, now: NOW,
                locallyVerifiedEvidenceRefs: VERIFIED_REFS,
            });
            if ('transport' in result) await result.transport.adapter.chat([]).catch(() => undefined);
            assert.equal(Object.hasOwn(result, 'transport'), false);
        }
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
