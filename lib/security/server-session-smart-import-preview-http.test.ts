/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AuthenticatedSmartImportPreviewError } from './server-session-authenticated-smart-import-preview.ts';
import { EGRESS_PROFILE_VERSION } from '../ai-providers/fabric/contract.ts';
import { parseSmartImportPreviewWireRoot, serializeSmartImportPreviewWireRoot } from '../smart-import-preview-wire.ts';
import { createSmartImportPreviewHttpHandler } from './server-session-smart-import-preview-http.ts';

const INPUT = Object.freeze({ handle: `prj_${'1'.repeat(32)}`, requestId: `req_${'2'.repeat(32)}` });
const MODEL = 'mediflow/synthetic';
const PROVIDER_RECEIPT = Object.freeze({ schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: MODEL, execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0 });
const RECEIPT = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'smart_import', class: 'generative', venue: 'local_process', egressProfile: Object.freeze({ id: 'local_only', version: EGRESS_PROFILE_VERSION, egress: 'none' }), provider: 'ollama', model: MODEL, providerReceipt: PROVIDER_RECEIPT, fallbackCount: 0 });
const PROVENANCE = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'smart_import', venue: 'local_process', provider: 'ollama', model: MODEL, preprocessing: Object.freeze(['context_minimization', 'envelope_validation']), receipt: RECEIPT });
const PROPOSAL = Object.freeze({ schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt: '2026-08-23T12:00:00.000Z',
    contract: Object.freeze({ validJson: true, validTask: true, legacyContract: false }), summary: '',
    diagnoses: Object.freeze([Object.freeze({ label: 'Sintesi', icdQuery: 'SINT', confidence: 'high', evidence: 'Evidenza', sourceId: 'source.synthetic.1', explicitCode: undefined })]),
    therapies: Object.freeze([]), servicePrescriptions: Object.freeze([]), writesPerformed: 0 as const });
const AVAILABLE = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'available' as const,
    code: null, proposal: PROPOSAL, receipt: RECEIPT,
    provenance: PROVENANCE, reviewRef: `review_${'3'.repeat(32)}` });
const AVAILABLE_WIRE = serializeSmartImportPreviewWireRoot(Object.freeze({ preview: AVAILABLE }));
const DENIED_CODES = ['input_invalid', 'kill_switch_disabled', 'kill_switch_unavailable', 'projection_unavailable',
    'lifecycle_missing', 'lifecycle_corrupt', 'lifecycle_unavailable', 'provider_binding_denied', 'provider_unready',
    'model_unavailable', 'fabric_denied', 'source_invalid'] as const;
const FAILED_CODES = ['provider_failed', 'proposal_invalid'] as const;

function request(body: unknown = INPUT): Request {
    return new Request('http://127.0.0.1/api/ai/smart-import/preview', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function denied(code: typeof DENIED_CODES[number] = DENIED_CODES[0]) { return Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const,
    status: 'denied' as const, code, proposal: null, receipt: null, provenance: null, reviewRef: null }); }
function failed(code: typeof FAILED_CODES[number] = FAILED_CODES[0]) {
    return Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'failed' as const,
        code, proposal: null, receipt: RECEIPT, provenance: PROVENANCE, reviewRef: null });
}
function subject(result: unknown = AVAILABLE) {
    let calls = 0; let received: unknown;
    return Object.freeze({ calls: () => calls, received: () => received,
        preview: createSmartImportPreviewHttpHandler({ preview: async (input) => {
            calls += 1; received = input; if (result instanceof Error) throw result; return result as never;
        } }),
    });
}
async function rejects(response: Response, status: number, code: string) {
    assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: status === 500 ? 'Errore interno del server.' : 'Preview Smart Import non disponibile.', code });
}

test('serializes one available review-only capability result without echoing input', async () => {
    const current = subject(); const response = await current.preview(request()); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const parsedBody = parseSmartImportPreviewWireRoot(body); assert.deepEqual(body, AVAILABLE_WIRE); assert.deepEqual(parsedBody, body); assert.equal(current.calls(), 1); assert.deepEqual(current.received(), INPUT);
    assert.equal(AVAILABLE.provenance.receipt, AVAILABLE.receipt);
    assert.ok(parsedBody && parsedBody.preview.status === 'available'); assert.equal('explicitCode' in parsedBody.preview.proposal.diagnoses[0], false);
    assert.equal(JSON.stringify(body).includes(INPUT.handle), false); assert.equal(JSON.stringify(body).includes(INPUT.requestId), false);
});

test('keeps every denied and failed review-only domain outcome at 200', async () => {
    for (const result of [...DENIED_CODES.map(denied), ...FAILED_CODES.map(failed)]) {
        const response = await subject(result).preview(request());
        assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), serializeSmartImportPreviewWireRoot({ preview: result }));
        if (result.status === 'failed') assert.equal(result.provenance.receipt, result.receipt);
    }
});

test('rejects malformed, extra, prototype, and accessor input before composition', async () => {
    const current = subject(); const malformed = new Request('http://127.0.0.1', { method: 'POST', body: '{' });
    const accessor = { handle: INPUT.handle }; Object.defineProperty(accessor, 'requestId', { enumerable: true, get() { return INPUT.requestId; } });
    const prototype = Object.assign(Object.create({ inherited: true }), INPUT);
    for (const value of [malformed, request({ ...INPUT, extra: true }), { json: async () => accessor } as Request,
        { json: async () => prototype } as Request, request({ handle: 'not-a-handle', requestId: INPUT.requestId })]) {
        await rejects(await current.preview(value), 400, 'input_invalid');
    }
    assert.equal(current.calls(), 0);
});

test('maps controlled authentication preview errors', async () => {
    for (const [code, status] of [['session_unavailable', 401], ['preview_unavailable', 503]] as const) {
        await rejects(await subject(new AuthenticatedSmartImportPreviewError(code)).preview(request()), status, code);
    }
});

test('rejects malformed or authority-expanding runtime results without exposing them', async () => {
    const originalError = console.error; const entries: unknown[][] = []; console.error = (...values: unknown[]) => { entries.push(values); };
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const malformed = [{ ...denied(), writesPerformed: 1 }, { ...denied(), apply: 'allowed' },
        { ...denied(), extra: true }, Object.assign(Object.create({ inherited: true }), denied()),
        { ...AVAILABLE, proposal: cycle }, { ...AVAILABLE, proposal: { score: Number.NaN } }, { ...AVAILABLE, proposal: { score: Infinity } },
        { ...AVAILABLE, reviewRef: 'review_synthetic' }];
    try {
        for (const result of malformed) {
            const response = await subject(result).preview(request()); await rejects(response, 500, 'internal_error');
        }
        assert.equal(entries.length, malformed.length);
        malformed.forEach((result, index) => assert.equal(entries[index]?.[1], result));
    } finally { console.error = originalError; }
});

test('sanitizes a runtime-invalid controlled error code while logging its original object', async () => {
    const originalError = console.error; const entries: unknown[][] = [];
    const error = new AuthenticatedSmartImportPreviewError('future_preview_code' as never);
    console.error = (...values: unknown[]) => { entries.push(values); };
    try {
        await rejects(await subject(error).preview(request()), 500, 'internal_error');
        assert.equal(entries.length, 1); assert.equal(entries[0]?.[1], error);
    } finally { console.error = originalError; }
});

test('route stays a thin dynamic Node adapter and the handler uses the shared exact preview wire', () => {
    const route = readFileSync(new URL('../../app/api/ai/smart-import/preview/route.ts', import.meta.url), 'utf8');
    const handlerSource = readFileSync(new URL('./server-session-smart-import-preview-http.ts', import.meta.url), 'utf8');
    assert.match(route, /runtime\s*=\s*'nodejs'|runtime\s*=\s*"nodejs"/u); assert.match(route, /dynamic\s*=\s*'force-dynamic'|dynamic\s*=\s*"force-dynamic"/u);
    assert.match(route, /previewAuthenticatedSmartImport/u); assert.match(handlerSource, /function exhaustiveCode\(code: never\): null/u); assert.match(handlerSource, /serializeSmartImportPreviewWireRoot/u);
    assert.doesNotMatch(handlerSource, /function plainData|function capabilityResult/u);
    assert.doesNotMatch(`${route}\n${handlerSource}`, /requireSession|createServerSessionProjectionOwnerRegistry|resolveProjectionService|createPatientSmartImportHostCapability|createTypedProjectionBroker|\.apply\(|proxy/u);
});
