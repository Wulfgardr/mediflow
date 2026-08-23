/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AiTransparencyEnvelopeError,
    createAiTransparencyEnvelope,
} from './ai-transparency-envelope.ts';

function inHouseEnvelope(): Record<string, unknown> {
    return {
        schemaVersion: 'mediflow.ai.transparency-envelope.v1',
        disclosure: 'ai_generated_review_only',
        claimCeiling: 'ai_act_informed_technical_contract_candidate',
        capability: 'icd_lookup',
        provider: 'in_house',
        model: null,
        venue: 'local_process',
        egress: 'none',
        generatedAt: '2026-08-23T08:00:00.000Z',
        reviewState: 'pending',
        applyPolicy: 'none',
        writesPerformed: 0,
        provenance: {
            schemaVersion: 'mediflow.ai.fabric-provenance.v1',
            capability: 'icd_lookup', venue: 'local_process', provider: 'in_house', model: null,
            preprocessing: ['context_minimization', 'envelope_validation'],
            receipt: {
                schemaVersion: 'mediflow.ai.fabric-resolution.v1',
                capability: 'icd_lookup', class: 'deterministic', venue: 'local_process',
                egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' },
                provider: 'in_house', model: null, providerReceipt: null, fallbackCount: 0,
            },
        },
    };
}

function expectRejected(value: unknown): void {
    assert.throws(
        () => createAiTransparencyEnvelope(value),
        (error) => error instanceof AiTransparencyEnvelopeError && error.code === 'invalid_envelope',
    );
}

function assertDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test('crea un envelope minimizzato, deep-frozen e review-only', () => {
    const envelope = createAiTransparencyEnvelope(inHouseEnvelope());
    assert.equal(envelope.writesPerformed, 0);
    assert.equal(envelope.applyPolicy, 'none');
    assertDeepFrozen(envelope);
    assert.throws(() => { (envelope as { reviewState: string }).reviewState = 'accepted'; }, TypeError);
    assert.equal(JSON.stringify(envelope).includes('prompt'), false);
});

test('rifiuta campi extra e superfici vietate di contenuto, identita o authority', () => {
    for (const key of ['prompt', 'content', 'patientId', 'patientIdentity', 'authority', 'providerReadiness']) {
        expectRejected({ ...inHouseEnvelope(), [key]: 'synthetic-forbidden-value' });
    }
    expectRejected({
        ...inHouseEnvelope(),
        provenance: { ...(inHouseEnvelope().provenance as object), prompt: 'synthetic-forbidden-value' },
    });
});

test('rifiuta mismatch tra envelope, provenance e receipt', () => {
    const cases = [
        { provider: 'ollama' },
        { venue: 'home_base' },
        { model: 'synthetic-model' },
        { egress: 'redacted_explicit_consent' },
        { provenance: { ...(inHouseEnvelope().provenance as object), venue: 'home_base' } },
        { provenance: { ...(inHouseEnvelope().provenance as object), receipt: { ...(inHouseEnvelope().provenance as { receipt: object }).receipt, fallbackCount: 1 } } },
    ];
    for (const change of cases) expectRejected({ ...inHouseEnvelope(), ...change });
});

test('rifiuta valori non canonici, timestamp/versione invalidi, apply/write e overclaim', () => {
    const cases = [
        { schemaVersion: 'mediflow.ai.transparency-envelope.v2' },
        { generatedAt: '23/08/2026' },
        { reviewState: 'applied' },
        { applyPolicy: 'manual_apply' },
        { writesPerformed: 1 },
        { claimCeiling: 'ai_act_compliant' },
    ];
    for (const change of cases) expectRejected({ ...inHouseEnvelope(), ...change });
});

test('lega il provider Ollama alla sua receipt locale senza segreti o fallback', () => {
    const envelope = inHouseEnvelope();
    const receipt = {
        schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application',
        task: 'clinical', provider: 'ollama', model: 'qwen3.5:35b-a3b', execution: 'local',
        endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0,
    };
    const provenance = envelope.provenance as Record<string, unknown>;
    const resolution = provenance.receipt as Record<string, unknown>;
    const ollama = {
        ...envelope, capability: 'patient_insight', provider: 'ollama', model: 'qwen3.5:35b-a3b',
        provenance: {
            ...provenance, capability: 'patient_insight', provider: 'ollama', model: 'qwen3.5:35b-a3b',
            receipt: { ...resolution, capability: 'patient_insight', class: 'generative', provider: 'ollama', model: 'qwen3.5:35b-a3b', providerReceipt: receipt },
        },
    };
    const snapshot = createAiTransparencyEnvelope(ollama);
    assert.equal(snapshot.provider, 'ollama');
    assertDeepFrozen(snapshot);
    expectRejected({ ...ollama, provenance: { ...ollama.provenance, receipt: { ...ollama.provenance.receipt, providerReceipt: { ...receipt, fallbackCount: 1 } } } });
});
