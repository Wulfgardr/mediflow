/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TreatmentReasoningBrowserControllerError,
    createTreatmentReasoningBrowserController,
    parseTreatmentReasoningPublication,
} from './treatment-reasoning-browser-controller.ts';

const PATIENT_ID = 'patient.synthetic.01';
const HANDLE = `trp_${'a'.repeat(32)}`;
const IDS = [`req_${'b'.repeat(32)}`, `req_${'c'.repeat(32)}`];
const AMBULATORY = Object.freeze({ ambulatoryId: 'ambulatory.synthetic.01', name: 'Ambulatorio sintetico', address: 'Via sintetica 1', version: 3 });
const LEASE = Object.freeze({
    sessionRef: `ssr_${'1'.repeat(32)}`,
    selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`,
    ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`,
    expiresAt: 9_999_999_999_999,
});

function contextInput() {
    return {
        patient: {
            id: PATIENT_ID,
            firstName: 'Persona',
            lastName: 'Sintetica',
            taxCode: 'SYNTHETIC0000000',
            address: 'Indirizzo sintetico',
            phone: '0000000000',
            updatedAt: new Date('2026-09-01T09:30:00.000Z'),
            createdAt: new Date('2026-08-01T09:30:00.000Z'),
            diagnoses: [],
            version: 7,
        },
        therapies: [{
            id: 'therapy.synthetic.01', patientId: PATIENT_ID, drugName: 'Farmaco sintetico',
            dosage: '5 mg', frequency: '1 volta/die', status: 'active',
            startDate: new Date('2026-08-20T08:00:00.000Z'),
        }],
        entries: [], observations: [], attachments: [],
    };
}

function fabricReceipt() {
    return {
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: 'treatment_reasoning', class: 'generative', venue: 'local_process',
        egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' },
        provider: 'athena_mlx', model: null, providerReceipt: null, fallbackCount: 0,
    };
}

function publication() {
    const receipt = fabricReceipt();
    return {
        schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1',
        capability: 'treatment_reasoning', stage: 'preview', review: 'required', status: 'available',
        value: {
            schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning',
            summary: 'Sintesi sintetica da revisionare.',
            data: {
                recommendation: 'Rivedere le fonti sintetiche prima di ogni decisione.',
                keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Evidenza sintetica circoscritta.', evidenceRefs: ['therapy:therapy.synthetic.01'] }],
                reasoning: ['Le fonti richiedono revisione clinica.'],
                caveats: ['Fixture sintetica, non prescrittiva.'],
                safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Revisione richiesta', rationale: 'Il risultato resta review-only.', evidenceRefs: ['profile:clinical-summary'] }],
                suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Rivedi evidenze', rationale: 'Nessuna scrittura clinica consentita.', writePolicy: 'review_only', evidenceRefs: ['therapy:therapy.synthetic.01'] }],
                trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['Nessun lookup esterno.'] },
            },
        },
        sourceBindings: [
            { claimPath: 'summary', claim: 'Sintesi sintetica da revisionare.', evidenceRefs: ['profile:clinical-summary'] },
            { claimPath: 'data.recommendation', claim: 'Rivedere le fonti sintetiche prima di ogni decisione.', evidenceRefs: ['therapy:therapy.synthetic.01'] },
            { claimPath: 'data.reasoning.0', claim: 'Le fonti richiedono revisione clinica.', evidenceRefs: ['therapy:therapy.synthetic.01'] },
            { claimPath: 'data.caveats.0', claim: 'Fixture sintetica, non prescrittiva.', evidenceRefs: ['profile:clinical-summary'] },
        ],
        attestation: {
            schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified',
            provider: 'athena_mlx', venue: 'local_process', egress: 'none',
            receiptRef: 'receipt_synthetic_01', provenanceRef: 'provenance_synthetic_01',
        },
        fabricReceipt: receipt,
        provenance: {
            schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'treatment_reasoning',
            venue: 'local_process', provider: 'athena_mlx', model: null,
            preprocessing: ['context_minimization', 'envelope_validation'], receipt,
        },
        sourceRevision: 'source_7_2_1788255000000', capturedAt: '2026-09-01T10:00:00.000Z',
        writesPerformed: 0, applyPolicy: 'none',
    };
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function contextResponse(path: string, patientVersion = 7, ambulatoryVersion = 3): Response | null {
    if (path === `/api/patients/${PATIENT_ID}`) return response({ id: PATIENT_ID, firstName: 'Persona', lastName: 'Sintetica', version: patientVersion });
    if (path === '/api/ambulatories') return response([{ id: AMBULATORY.ambulatoryId, name: AMBULATORY.name, address: AMBULATORY.address, version: ambulatoryVersion }]);
    return null;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }

test('runs the explicit context, confirmed selection, minimized ingest, and proposal-only preview sequence', async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    let requestIndex = 0;
    const controller = createTreatmentReasoningBrowserController({
        clock: () => new Date('2026-09-01T10:00:00.000Z'),
        requestId: () => IDS[requestIndex++],
        fetch: async (input, init) => {
            const path = String(input); const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : null;
            calls.push({ path, method, body });
            const context = contextResponse(path); if (context) return context;
            if (path === '/api/ai/smart-import/selection' && method === 'GET') return response({ selectionEpoch: 0 });
            if (path === '/api/ai/smart-import/selection') return response({ selection: LEASE });
            if (path === '/api/ai/treatment-reasoning/ingest') return response({ handle: HANDLE });
            if (path === '/api/ai/treatment-reasoning/preview') return response(publication());
            throw new Error('unexpected request');
        },
    });
    const proposal = await controller.readProposal(PATIENT_ID); const ambulatory = proposal.ambulatories[0]!;
    const result = await controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: contextInput() }, true);
    assert.deepEqual(result, parseTreatmentReasoningPublication(publication()));
    assert.deepEqual(calls.map(({ path, method }) => `${method}:${path}`), [
        `GET:/api/patients/${PATIENT_ID}`,
        'GET:/api/ambulatories',
        `GET:/api/patients/${PATIENT_ID}`,
        'GET:/api/ambulatories',
        'GET:/api/ai/smart-import/selection',
        'POST:/api/ai/smart-import/selection',
        'POST:/api/ai/treatment-reasoning/ingest',
        'POST:/api/ai/treatment-reasoning/preview',
    ]);
    assert.deepEqual(calls[6]?.body && Object.keys(calls[6].body as object), ['projection', 'requestId']);
    assert.deepEqual(calls[7]?.body, { handle: HANDLE, requestId: IDS[1] });
    const ingestJson = JSON.stringify(calls[6]?.body);
    assert.doesNotMatch(ingestJson, /Persona|Sintetica|SYNTHETIC0000000|Indirizzo sintetico|0000000000/u);
    assert.doesNotMatch(ingestJson, /patientId|ambulatoryId|provider|model|prompt|question|apply/u);
});

test('rejects a syntactically valid publication bound to evidence outside the submitted projection', async () => {
    const hostile = publication();
    for (const item of hostile.value.data.keyEvidence) item.evidenceRefs = ['foreign.synthetic.source'];
    for (const item of hostile.value.data.safetyFlags) item.evidenceRefs = ['foreign.synthetic.source'];
    for (const item of hostile.value.data.suggestedActions) item.evidenceRefs = ['foreign.synthetic.source'];
    for (const item of hostile.sourceBindings) item.evidenceRefs = ['foreign.synthetic.source'];
    let id = 0;
    const controller = createTreatmentReasoningBrowserController({
        clock: () => new Date('2026-09-01T10:00:00.000Z'), requestId: () => IDS[id++],
        fetch: async (input, init) => {
            const path = String(input); const method = init?.method ?? 'GET';
            const context = contextResponse(path); if (context) return context;
            if (path.endsWith('/selection') && method === 'GET') return response({ selectionEpoch: 0 });
            if (path.endsWith('/selection')) return response({ selection: LEASE });
            if (path.endsWith('/ingest')) return response({ handle: HANDLE });
            return response(hostile);
        },
    });
    const proposal = await controller.readProposal(PATIENT_ID); const ambulatory = proposal.ambulatories[0]!;
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: contextInput() }, true),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'response_invalid',
    );
});

test('strict publication parser rejects drift, write and apply seams, provider-prompt leakage, and malformed grounding', () => {
    const variants: Array<(value: Record<string, unknown>) => void> = [
        (value) => { value.extra = true; },
        (value) => { value.writesPerformed = 1; },
        (value) => { value.applyPolicy = 'apply'; },
        (value) => { ((value.value as Record<string, unknown>).data as Record<string, unknown>).providerPrompt = 'forged'; },
        (value) => { (((value.value as Record<string, unknown>).data as Record<string, unknown>).trace as Record<string, unknown>).model = 'caller-choice'; },
        (value) => { (value.fabricReceipt as Record<string, unknown>).provider = 'cloud'; },
        (value) => { (value.fabricReceipt as Record<string, unknown>).model = 'caller-model'; },
        (value) => { (value.provenance as Record<string, unknown>).preprocessing = ['envelope_validation', 'context_minimization']; },
        (value) => { ((value.sourceBindings as unknown[])[0] as Record<string, unknown>).claim = 'different claim'; },
        (value) => { ((value.sourceBindings as unknown[])[0] as Record<string, unknown>).prompt = 'leak'; },
    ];
    for (const mutate of variants) {
        const hostile = structuredClone(publication()) as unknown as Record<string, unknown>; mutate(hostile);
        assert.equal(parseTreatmentReasoningPublication(hostile), null);
    }
    assert.equal(parseTreatmentReasoningPublication({ status: 'available' }), null);
});

test('reset fences an awaited preview so its stale publication cannot be returned', async () => {
    const pendingJson = deferred<unknown>(); const previewStarted = deferred<void>(); let id = 0;
    const controller = createTreatmentReasoningBrowserController({
        clock: () => new Date('2026-09-01T10:00:00.000Z'), requestId: () => IDS[id++],
        fetch: async (input, init) => {
            const path = String(input); const method = init?.method ?? 'GET';
            const context = contextResponse(path); if (context) return context;
            if (path.endsWith('/selection') && method === 'GET') return response({ selectionEpoch: 0 });
            if (path.endsWith('/selection')) return response({ selection: LEASE });
            if (path.endsWith('/ingest')) return response({ handle: HANDLE });
            previewStarted.resolve();
            return { ok: true, json: () => pendingJson.promise } as Response;
        },
    });
    const proposal = await controller.readProposal(PATIENT_ID); const ambulatory = proposal.ambulatories[0]!;
    const stale = controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: contextInput() }, true);
    await previewStarted.promise; controller.reset(); pendingJson.resolve(publication());
    await assert.rejects(stale, (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'operation_superseded');
});

test('a newer manual run supersedes an older awaited preview and only the newest publication is returned', async () => {
    const firstJson = deferred<unknown>(); const firstPreviewStarted = deferred<void>(); let request = 0; let epoch = 0; let previews = 0;
    const controller = createTreatmentReasoningBrowserController({
        clock: () => new Date('2026-09-01T10:00:00.000Z'),
        requestId: () => `req_${(request++).toString(16).padStart(32, 'd')}`,
        fetch: async (input, init) => {
            const path = String(input); const method = init?.method ?? 'GET';
            const context = contextResponse(path); if (context) return context;
            if (path.endsWith('/selection') && method === 'GET') return response({ selectionEpoch: epoch });
            if (path.endsWith('/selection')) { epoch += 1; return response({ selection: { ...LEASE, selectionEpoch: epoch } }); }
            if (path.endsWith('/ingest')) return response({ handle: `trp_${String(epoch).repeat(32)}` });
            previews += 1;
            if (previews === 1) { firstPreviewStarted.resolve(); return { ok: true, json: () => firstJson.promise } as Response; }
            return response(publication());
        },
    });
    const firstProposal = await controller.readProposal(PATIENT_ID); const firstAmbulatory = firstProposal.ambulatories[0]!;
    const stale = controller.run({ patientId: PATIENT_ID, proposal: firstProposal, ambulatory: firstAmbulatory, contextInput: contextInput() }, true);
    await firstPreviewStarted.promise;
    const nextProposal = await controller.readProposal(PATIENT_ID); const nextAmbulatory = nextProposal.ambulatories[0]!;
    const newest = await controller.run({ patientId: PATIENT_ID, proposal: nextProposal, ambulatory: nextAmbulatory, contextInput: contextInput() }, true);
    assert.equal(newest.status, 'available');
    firstJson.resolve(publication());
    await assert.rejects(stale, (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'operation_superseded');
});

test('rejects missing confirmation, copied proposals or choices, mismatched patients, and caller questions before selection POST', async () => {
    let posts = 0;
    const controller = createTreatmentReasoningBrowserController({ fetch: async (input, init) => {
        if (init?.method === 'POST') posts += 1;
        return contextResponse(String(input)) ?? response({ selectionEpoch: 0 });
    } });
    const proposal = await controller.readProposal(PATIENT_ID); const ambulatory = proposal.ambulatories[0]!;
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: contextInput() }, false as never),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'confirmation_required',
    );
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal: { ...proposal }, ambulatory, contextInput: contextInput() }, true),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'proposal_stale',
    );
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal, ambulatory: { ...ambulatory }, contextInput: contextInput() }, true),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'selection_invalid',
    );
    const mismatched = contextInput(); mismatched.patient.id = 'patient.synthetic.other';
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: mismatched }, true),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'input_invalid',
    );
    const next = await controller.readProposal(PATIENT_ID); const nextAmbulatory = next.ambulatories[0]!;
    await assert.rejects(
        () => controller.run({ patientId: PATIENT_ID, proposal: next, ambulatory: nextAmbulatory, contextInput: { ...contextInput(), question: 'Caller prompt forbidden.' } }, true),
        (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'input_invalid',
    );
    assert.equal(posts, 0);
});

test('rejects changed patient or ambulatory facts before selection and ingest', async () => {
    for (const changed of ['patient', 'ambulatory'] as const) {
        let patientReads = 0; let ambulatoryReads = 0; const posts: string[] = [];
        const controller = createTreatmentReasoningBrowserController({ fetch: async (input, init) => {
            const path = String(input); if (init?.method === 'POST') posts.push(path);
            if (path === `/api/patients/${PATIENT_ID}`) { patientReads += 1; return contextResponse(path, changed === 'patient' && patientReads > 1 ? 8 : 7)!; }
            if (path === '/api/ambulatories') { ambulatoryReads += 1; return contextResponse(path, 7, changed === 'ambulatory' && ambulatoryReads > 1 ? 4 : 3)!; }
            return response({ selectionEpoch: 0 });
        } });
        const proposal = await controller.readProposal(PATIENT_ID); const ambulatory = proposal.ambulatories[0]!;
        await assert.rejects(
            () => controller.run({ patientId: PATIENT_ID, proposal, ambulatory, contextInput: contextInput() }, true),
            (error: unknown) => error instanceof TreatmentReasoningBrowserControllerError && error.code === 'proposal_stale',
        );
        assert.deepEqual(posts, []);
    }
});

test('keeps the controller browser-only, manual, and free of persistence, apply, legacy, or refresh paths', () => {
    const source = readFileSync(new URL('./treatment-reasoning-browser-controller.ts', import.meta.url), 'utf8');
    assert.match(source, /^\/\* @Codex \*\/[\s\S]*?'use client';/u);
    assert.doesNotMatch(source, /server-only|node:|localStorage|sessionStorage|indexedDB|setInterval|setTimeout|\.apply\(|\/api\/context|\/api\/system\/treatment-reasoning|generatePatientTreatmentReasoningDraft|generic.{0,20}(invoke|prompt)/u);
    assert.deepEqual(Object.keys(createTreatmentReasoningBrowserController({ fetch: async () => response({}) })), ['reset', 'readProposal', 'run']);
});

import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';
function portablePublication(): Record<string, unknown> {
    const old = publication();
    const engine = { provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID, platform: 'linux-x64',
        artifactDigest: 'a'.repeat(64), runtimeDigest: 'b'.repeat(64), workerDigest: 'c'.repeat(64), admissionRevision: 2 };
    const receipt = { ...fabricReceipt(), schemaVersion: 'mediflow.ai.treatment-reasoning-engine-receipt.v2', provider: engine.provider,
        model: engine.model, engine, modelOptionId: `model_option_${'d'.repeat(32)}`, catalogRevision: `sha256_${'e'.repeat(64)}` };
    return { ...old, schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v2',
        attestation: { ...old.attestation, ...engine, schema: 'mediflow.ai.treatment-reasoning-engine-attestation.v2' }, fabricReceipt: receipt,
        provenance: { ...old.provenance, schemaVersion: 'mediflow.ai.treatment-reasoning-engine-provenance.v2', provider: engine.provider, model: engine.model, receipt } };
}
test('portable client schema requires exact engine/receipt/provenance agreement without weakening v1', () => {
    const value = portablePublication(); assert.ok(parseTreatmentReasoningPublication(value));
    const modify = (key: string, extra: Record<string, unknown>) => ({ ...value, [key]: { ...(value[key] as Record<string, unknown>), ...extra } });
    for (const invalid of [
        { ...value, schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1' },
        modify('attestation', { provider: 'athena_mlx' }), modify('attestation', { model: 'unrelated-model' }),
        modify('attestation', { artifactDigest: 'f'.repeat(64) }), modify('attestation', { admissionRevision: 3 }),
        modify('attestation', { platform: 'darwin-arm64' }), modify('attestation', { workerDigest: '' }),
        modify('fabricReceipt', { fallbackCount: 1 }), modify('fabricReceipt', { modelOptionId: 'arbitrary' }),
        modify('provenance', { model: null }), { ...value, writesPerformed: 1 }, { ...value, applyPolicy: 'automatic' },
        { ...value, sourceBindings: [] }, modify('attestation', { prompt: 'must-not-escape' }),
    ]) assert.equal(parseTreatmentReasoningPublication(invalid), null);
    const legacy = publication(); legacy.attestation.provider = 'athena_transformers'; assert.equal(parseTreatmentReasoningPublication(legacy), null);
});
