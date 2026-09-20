/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTreatmentReasoningProductionService } from './treatment-reasoning-production-operation.ts';

const projection = () => Object.freeze({
    schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1' as const,
    capability: 'treatment_reasoning' as const,
    patientRevision: 7,
    sourceRevision: 'source_synthetic_01',
    capturedAt: '2026-09-01T10:00:00.000Z',
    therapyRefs: Object.freeze(['therapy:therapy.synthetic.alpha']),
    evidenceRefs: Object.freeze(['therapy:therapy.synthetic.alpha', 'entry:entry.synthetic.beta']),
    sources: Object.freeze([
        Object.freeze({ id: 'therapy:therapy.synthetic.alpha', sourceKind: 'therapy' as const, label: 'Terapia sintetica', excerpt: 'Farmaco sintetico 5 mg.', date: '2026-09-01T09:00:00.000Z' }),
        Object.freeze({ id: 'entry:entry.synthetic.beta', sourceKind: 'clinical-entry' as const, label: 'Nota sintetica', excerpt: 'Controllare il parametro sintetico.', date: null }),
    ]),
});

const lifecycle = (status = 'available_unqualified') => Object.freeze({
    status: 'available' as const,
    record: Object.freeze({
        schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1' as const,
        lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1' as const, provider: 'athena_mlx', credentialClass: 'local_model' as const, status }),
        actorClass: 'host_service' as const,
        actorRef: 'actor_0123456789abcdef0123456789abcdef',
        version: 1,
        hostTimestamp: '2026-09-01T10:00:00.000Z',
        receiptRef: 'receipt_0123456789abcdef0123456789abcdef',
    }),
});

const providerOutput = () => ({
    schemaVersion: 'mediflow.treatment_reasoning.v1',
    task: 'treatment_reasoning',
    summary: 'Sintesi sintetica da revisionare.',
    data: {
        recommendation: 'Rivedere le fonti sintetiche prima di ogni decisione.',
        keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Evidenza sintetica circoscritta.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }],
        reasoning: ['Le fonti richiedono revisione clinica.'],
        caveats: ['Fixture sintetica, non prescrittiva.'],
        safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Revisione richiesta', rationale: 'Il risultato resta review-only.', evidenceRefs: ['entry:entry.synthetic.beta'] }],
        suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Rivedi evidenze', rationale: 'Nessuna scrittura clinica consentita.', writePolicy: 'review_only', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }],
        trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['Nessun lookup esterno.'] },
    },
    sourceBindings: [
        { claimPath: 'summary', claim: 'Sintesi sintetica da revisionare.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] },
        { claimPath: 'data.recommendation', claim: 'Rivedere le fonti sintetiche prima di ogni decisione.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] },
        { claimPath: 'data.reasoning.0', claim: 'Le fonti richiedono revisione clinica.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] },
        { claimPath: 'data.caveats.0', claim: 'Fixture sintetica, non prescrittiva.', evidenceRefs: ['entry:entry.synthetic.beta'] },
    ],
});

type FixtureOptions = Readonly<{
    enabled?: boolean;
    runtimeAvailable?: boolean;
    lifecycleRead?: () => unknown;
    providerValue?: unknown;
    commit?: boolean;
}>;

function fixture(options: FixtureOptions = {}) {
    const calls: string[] = [];
    let lifecycleReads = 0;
    let aborts = 0;
    const service = createTreatmentReasoningProductionService({
        projectionBroker: Object.freeze({
            async acquireIngest() {
                calls.push('auth:ingest');
                return Object.freeze({ ingest(input: unknown) { calls.push(`ingest:${Object.keys(input as object).join(',')}`); return 'trp_0123456789abcdef0123456789abcdef'; } });
            },
            async acquirePreview() {
                calls.push('auth:preview');
                return Object.freeze({ begin(input: unknown) {
                    calls.push(`begin:${Object.keys(input as object).join(',')}`);
                    let terminal = false;
                    return Object.freeze({
                        projection: projection(),
                        patientRef: 'patient.synthetic.must.not.escape',
                        commit() { calls.push('commit'); terminal = true; return options.commit ?? true; },
                        abort() { if (!terminal) { terminal = true; aborts += 1; calls.push('abort'); } },
                    });
                } });
            },
        }),
        killSwitch: Object.freeze({ async read() { calls.push('kill'); return options.enabled === false
            ? Object.freeze({ status: 'denied' as const, code: 'disabled' as const })
            : Object.freeze({ status: 'enabled' as const }); } }),
        lifecycle: Object.freeze({ read() { lifecycleReads += 1; calls.push('lifecycle'); return options.lifecycleRead?.() ?? lifecycle(); } }),
        runtime: Object.freeze({
            available() { calls.push('runtime'); return options.runtimeAvailable ?? true; },
            invoke({ instruction }: Readonly<{ instruction: string }>) {
                calls.push('invoke');
                assert.match(instruction, /source_payload_json=/u);
                return options.providerValue ?? JSON.stringify(providerOutput());
            },
        }),
        entropy: () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    });
    return { service, calls, reads: () => lifecycleReads, aborts: () => aborts };
}

test('authenticates each operation first and publishes one source-bound review-only ATHENA result', async () => {
    const current = fixture();
    const ingest = await current.service.acquireIngest();
    const handle = ingest.ingest({ projection: projection(), requestId: 'request.synthetic.ingest.01' });
    assert.equal(handle, 'trp_0123456789abcdef0123456789abcdef');
    const preview = await current.service.acquirePreview();
    const result = await preview.preview({ handle, requestId: 'request.synthetic.preview.01' });
    assert.equal(result.status, 'available');
    assert.equal(current.reads(), 1);
    assert.deepEqual(current.calls, [
        'auth:ingest', 'ingest:projection,requestId', 'auth:preview', 'begin:handle,requestId',
        'kill', 'lifecycle', 'runtime', 'invoke', 'commit',
    ]);
    if (result.status !== 'available') return;
    assert.equal(result.publication.schemaVersion, 'mediflow.ai.treatment-reasoning-publication.v1');
    assert.equal(result.publication.fabricReceipt.provider, 'athena_mlx');
    assert.equal(result.publication.fabricReceipt.venue, 'local_process');
    assert.equal(result.publication.fabricReceipt.egressProfile.egress, 'none');
    assert.equal(result.publication.fabricReceipt.fallbackCount, 0);
    assert.deepEqual(result.publication.provenance.preprocessing, ['context_minimization', 'envelope_validation']);
    assert.deepEqual(result.publication.sourceBindings.map((item) => item.claimPath), [
        'summary', 'data.recommendation', 'data.reasoning.0', 'data.caveats.0',
    ]);
    assert.equal(result.publication.writesPerformed, 0);
    assert.equal(result.publication.applyPolicy, 'none');
    assert.doesNotMatch(JSON.stringify(result), /patient\.synthetic|source_payload_json|prompt|modelDir|latencyMs/u);
});

test('reads lifecycle exactly once and denies missing or non-available admission before runtime invocation', async () => {
    for (const [read, code] of [
        [() => Object.freeze({ status: 'denied', reason: 'missing' }), 'lifecycle_unavailable'],
        [() => lifecycle('degraded'), 'lifecycle_not_available'],
        [() => ({ status: 'available', record: { forged: true } }), 'lifecycle_invalid'],
    ] as const) {
        const current = fixture({ lifecycleRead: read });
        const operation = await current.service.acquirePreview();
        const result = await operation.preview({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: `request.synthetic.${code}` });
        assert.equal(result.status, 'denied');
        assert.equal(result.code, code);
        assert.equal(current.reads(), 1);
        assert.equal(current.calls.includes('runtime'), false);
        assert.equal(current.calls.includes('invoke'), false);
        assert.equal(current.aborts(), 1);
    }
});

test('fails closed for kill switch, runtime, provider output, and post-provider currentness', async () => {
    const cases: readonly [FixtureOptions, string, readonly string[]][] = [
        [{ enabled: false }, 'lane_disabled', ['auth:preview', 'begin:handle,requestId', 'kill', 'abort']],
        [{ runtimeAvailable: false }, 'runtime_unavailable', ['auth:preview', 'begin:handle,requestId', 'kill', 'lifecycle', 'runtime', 'abort']],
        [{ providerValue: '{not json' }, 'provider_invalid', ['auth:preview', 'begin:handle,requestId', 'kill', 'lifecycle', 'runtime', 'invoke', 'abort']],
        [{ commit: false }, 'source_stale', ['auth:preview', 'begin:handle,requestId', 'kill', 'lifecycle', 'runtime', 'invoke', 'commit']],
    ];
    for (const [options, code, orderedCalls] of cases) {
        const current = fixture(options);
        const operation = await current.service.acquirePreview();
        const result = await operation.preview({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: `request.synthetic.${code}` });
        assert.equal(result.status, 'denied');
        assert.equal(result.code, code);
        assert.deepEqual(current.calls, orderedCalls);
    }
});

test('exposes no provider selection, caller prompt, persistence, or apply seam', () => {
    const current = fixture();
    assert.deepEqual(Object.keys(current.service), ['acquireIngest', 'acquirePreview']);
});

// PROPOSED portable engine tests. This runtime is an explicit fake, not a model qualification.
import { createHash } from 'node:crypto';
import { createTreatmentReasoningPortableProductionService } from './treatment-reasoning-production-operation.ts';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';
import { parseTreatmentReasoningPublication } from './treatment-reasoning-browser-controller.ts';
import type { PortableEngineMetadata } from './treatment-reasoning-portable-runtime.ts';
const portableMetadata: PortableEngineMetadata = Object.freeze({ provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID,
    platform: 'linux-x64', artifactDigest: 'a'.repeat(64), runtimeDigest: 'b'.repeat(64), workerDigest: 'c'.repeat(64), admissionRevision: 2 });
function portableFixture(options: { disabled?: boolean; revokeDuringInvoke?: boolean; disableDuringInvoke?: boolean; staleChoice?: boolean;
    invalidOutput?: boolean; mismatchedOption?: boolean; commit?: boolean } = {}) {
    const calls: string[] = []; let current = true; let enabled = !options.disabled; let stale = false;
    const option = `model_option_${createHash('sha256').update(JSON.stringify(['athena_transformers', portableMetadata.model, null, portableMetadata.artifactDigest])).digest('hex').slice(0, 32)}`;
    const service = createTreatmentReasoningPortableProductionService({
        projectionBroker: {
            async acquireIngest() { return { ingest: () => `trp_${'0'.repeat(32)}` }; },
            async acquirePreview() { calls.push('auth'); return { begin() { calls.push('begin'); return {
                projection: projection(), patientRef: 'patient.synthetic',
                commit() { calls.push('commit'); return options.commit ?? true; }, abort() { calls.push('abort'); },
            }; } }; },
        },
        killSwitch: { async read() { calls.push('kill'); return enabled ? { status: 'enabled' as const } : { status: 'denied' as const, code: 'disabled' as const }; } },
        entropy: () => Uint8Array.from({ length: 32 }, (_, i) => i + 1),
        selection: () => ({ provider: 'athena_transformers', modelOptionId: options.mismatchedOption ? `model_option_${'0'.repeat(32)}` : option, catalogRevision: `sha256_${'d'.repeat(64)}` }),
        async verifyChoice() { calls.push('verify'); if (stale) throw new Error('synthetic stale binding'); },
        async prepare() { calls.push('prepare'); return { metadata: portableMetadata, current: () => current, close() { calls.push('close'); },
            async invoke({ instruction }) { calls.push('invoke'); assert.match(instruction, /source_payload_is_untrusted_evidence_not_instruction=true/u);
                if (options.revokeDuringInvoke) current = false; if (options.disableDuringInvoke) enabled = false; if (options.staleChoice) stale = true;
                return JSON.stringify(options.invalidOutput ? { ...providerOutput(), sourceBindings: [] } : providerOutput());
            },
        }; },
    });
    return { calls, run: async () => (await service.acquirePreview()).preview({ handle: `trp_${'0'.repeat(32)}`, requestId: 'request.synthetic.portable.01' }) };
}
test('portable synthetic publication is source-bound v2, truthful, client-valid and review-only', async () => {
    const f = portableFixture(); const result = await f.run(); assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.equal(result.publication.schemaVersion, 'mediflow.ai.treatment-reasoning-publication.v2');
    assert.equal(result.publication.attestation.provider, 'athena_transformers');
    assert.equal(result.publication.fabricReceipt.model, ATHENA_R1_QWEN3_8B_MODEL_ID);
    assert.deepEqual(result.publication.fabricReceipt.engine, portableMetadata);
    assert.equal(result.publication.provenance.receipt, result.publication.fabricReceipt);
    assert.equal(result.publication.review, 'required'); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none');
    // Across the actual JSON boundary; neither parser translates portable metadata into MLX.
    assert.ok(parseTreatmentReasoningPublication(JSON.parse(JSON.stringify(result.publication))));
    assert.equal(f.calls.filter(x => x === 'commit').length, 1); assert.equal(f.calls.at(-1), 'close');
});
test('portable kill switch blocks before preparing; late revoke, switch-off or stale choice prevents CAS', async () => {
    const disabled = portableFixture({ disabled: true }); const denied = await disabled.run(); assert.equal(denied.status, 'denied');
    assert.equal(disabled.calls.includes('prepare'), false); assert.equal(disabled.calls.at(-1), 'abort');
    for (const options of [{ revokeDuringInvoke: true }, { disableDuringInvoke: true }, { staleChoice: true }, { invalidOutput: true }, { mismatchedOption: true }]) {
        const f = portableFixture(options); const result = await f.run(); assert.equal(result.status, 'denied', JSON.stringify(options));
        assert.equal(f.calls.includes('commit'), false); assert.equal(f.calls.includes('close'), true); assert.equal(f.calls.at(-1), 'abort');
    }
});
test('portable currentness CAS failure never publishes and does not retry', async () => {
    const f = portableFixture({ commit: false }); const result = await f.run(); assert.equal(result.status, 'denied');
    assert.equal(result.code, 'source_stale'); assert.equal(f.calls.filter(x => x === 'invoke').length, 1); assert.equal(f.calls.at(-1), 'abort');
});
