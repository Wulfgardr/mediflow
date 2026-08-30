/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    createTreatmentReasoningPreviewCapability,
    TreatmentReasoningPreviewCapabilityConfigurationError,
} from './treatment-reasoning-preview-capability.ts';

const proposal = () => ({
    projection: {
        schema: 'mediflow.ai.treatment-reasoning-projection.v1', capability: 'treatment_reasoning', stage: 'preview',
        sourceRevision: 'source_synthetic_01', therapyRefs: ['therapy.synthetic.alpha'], evidenceRefs: ['evidence.synthetic.alpha'],
    },
    provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01',
});

const admissionHost = () => ({
    readiness: { provider: 'athena_mlx', locality: 'local_process', status: 'available_unqualified' },
    receipt: { schema: 'mediflow.ai.treatment-reasoning-host-receipt.v1', reference: 'receipt_synthetic_01', capability: 'treatment_reasoning', provider: 'athena_mlx', venue: 'local_process', egress: 'none', fallback: 'denied_by_contract' },
    provenance: { schema: 'mediflow.ai.treatment-reasoning-host-provenance.v1', reference: 'provenance_synthetic_01', capability: 'treatment_reasoning', provider: 'athena_mlx', receiptRef: 'receipt_synthetic_01' },
    evidenceRefs: ['evidence.synthetic.alpha'],
});

const lifecycle = (status: 'available_unqualified' | 'degraded' | 'revoked' = 'available_unqualified') => ({
    status: 'available',
    record: {
        schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
        lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'athena_mlx', credentialClass: 'local_model', status },
        actorClass: 'host_service', actorRef: 'actor_0123456789abcdef0123456789abcdef', version: 1,
        hostTimestamp: '2026-08-24T10:00:00.000Z', receiptRef: 'receipt_0123456789abcdef0123456789abcdef',
    },
});

function service(read: () => unknown = lifecycle) {
    return createTreatmentReasoningPreviewCapability({ proposalHost: proposal(), admissionHost: admissionHost(), lifecycle: { read } });
}

test('declares a server-only, zero-argument preview surface', () => {
    const source = readFileSync(new URL('./treatment-reasoning-preview-capability.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    assert.match(source, /preview\(\): TreatmentReasoningPreviewCapabilityResult/u);
});

test('composes the fixed host proposal and accepted admission after exactly one lifecycle read', () => {
    let reads = 0;
    const result = service(() => { reads += 1; return lifecycle(); }).preview();
    assert.equal(reads, 1);
    assert.deepEqual(result, {
        status: 'admitted', code: null,
        preview: {
            schema: 'mediflow.ai.treatment-reasoning-preview-envelope.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required',
            uncertainty: { level: 'low', source: 'degraded_default' }, evidence: { source: 'host_minimized', count: 1 },
            provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01',
        },
        writesPerformed: 0, applyPolicy: 'none',
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.preview), true);
    assert.equal(Object.isFrozen(result.preview?.uncertainty), true);
    assert.equal(Object.isFrozen(result.preview?.evidence), true);
});

test('denies non-admissible lifecycle outcomes without reading again', () => {
    const cases: readonly [string, () => unknown, string][] = [
        ['unavailable', () => ({ status: 'denied', reason: 'unavailable' }), 'lifecycle_unavailable'],
        ['missing', () => ({ status: 'denied', reason: 'missing' }), 'lifecycle_unavailable'],
        ['degraded', () => lifecycle('degraded'), 'lifecycle_not_available'],
        ['revoked', () => lifecycle('revoked'), 'lifecycle_not_available'],
        ['throwing read', () => { throw new Error('synthetic'); }, 'lifecycle_unavailable'],
    ];
    for (const [, read, code] of cases) assert.deepEqual(service(read).preview(), {
        status: 'denied', code, preview: null, writesPerformed: 0, applyPolicy: 'none',
    });
});

test('rejects proxies, accessors, ambient fields, and malformed lifecycle records fail-closed', () => {
    const accessor = lifecycle();
    Object.defineProperty(accessor.record.lifecycle, 'status', { enumerable: true, get: () => 'available_unqualified' });
    const provider = lifecycle();
    provider.record.lifecycle.provider = 'ollama';
    const hostile = new Proxy(lifecycle(), {});
    for (const value of [accessor, provider, hostile, { status: 'available', record: lifecycle().record, then: () => undefined }]) {
        assert.deepEqual(service(() => value).preview(), {
            status: 'denied', code: 'lifecycle_invalid', preview: null, writesPerformed: 0, applyPolicy: 'none',
        });
    }
});

test('rejects malformed configuration before it can invoke its lifecycle callable', () => {
    let reads = 0;
    const accessor = { proposalHost: proposal(), admissionHost: admissionHost(), lifecycle: {} };
    Object.defineProperty(accessor.lifecycle, 'read', { enumerable: true, get: () => () => { reads += 1; return lifecycle(); } });
    for (const configuration of [
        accessor,
        new Proxy({ proposalHost: proposal(), admissionHost: admissionHost(), lifecycle: { read: lifecycle } }, {}),
        { proposalHost: proposal(), admissionHost: admissionHost(), lifecycle: { read: new Proxy(lifecycle, {}) } },
    ]) {
        assert.throws(() => createTreatmentReasoningPreviewCapability(configuration), TreatmentReasoningPreviewCapabilityConfigurationError);
    }
    assert.equal(reads, 0);
});

test('does not accept caller input, prompts, authority, provider invocation, or apply policy', () => {
    const preview = service().preview as unknown as (...args: unknown[]) => unknown;
    assert.deepEqual(preview(proposal(), 'invoke'), service().preview());
});
