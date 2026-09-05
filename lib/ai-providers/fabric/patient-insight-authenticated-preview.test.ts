/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PatientInsightHostCapabilityResult } from './patient-insight-host-capability';
import {
    AuthenticatedPatientInsightPreviewError,
    createAuthenticatedPatientInsightPreviewService,
    createPatientInsightPreviewHttpHandler,
} from './patient-insight-authenticated-preview.ts';

const denied: PatientInsightHostCapabilityResult = Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'denied', code: 'source_invalid', proposal: null, receipt: null, provenance: null, reviewRef: null });
const requestBody = Object.freeze({
    schemaVersion: 'mediflow.patient-insight.preview-request.v1', requestId: 'request.patient-insight.synthetic.0001',
    patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01', patientRevision: 4,
    capturedAt: '2026-09-01T10:00:00.000Z',
    sources: Object.freeze({ focus: Object.freeze({ summary: 'Synthetic follow-up' }), conditions: Object.freeze([{ label: 'Synthetic condition' }]), activeTherapies: Object.freeze([{ label: 'Synthetic therapy' }]), recentEvents: Object.freeze([{ summary: 'Synthetic review' }]) }),
});

function fixture(revision: number | null = 4) {
    const calls: string[] = [];
    const currentRef = Object.freeze({}); let stagedRef: object | null = null; let generation = 0; let terminal = false;
    const port = Object.freeze({
        snapshot: () => Object.freeze({ currentRef, stagedRef, generation, terminal }),
        prepare: () => { const replacement = Object.freeze({}); stagedRef = replacement; return replacement; },
        commit: () => { stagedRef = null; generation += 1; terminal = true; return true; },
        abort: () => { stagedRef = null; terminal = true; return true; },
        dispose: () => { terminal = true; },
    });
    const lease = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 7, patientRef: `ptr_${'2'.repeat(32)}`,
        ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: Date.parse('2026-09-01T11:00:00.000Z') });
    const session = Object.freeze({ id: '1'.repeat(64), userId: 'user.synthetic', username: 'synthetic', role: 'doctor', authChannel: 'web' as const,
        createdAt: Date.parse('2026-09-01T09:00:00.000Z'), expiresAt: lease.expiresAt });
    let liveRevision = revision;
    let afterSelection: (() => void) | undefined;
    const owner = Object.freeze({
        snapshotSelectionEpoch: () => { calls.push('epoch'); return 6; },
        issueSelection: () => { calls.push('selection'); afterSelection?.(); return lease; },
        dereferenceSelection: () => { calls.push('dereference'); return Object.freeze({ patientId: requestBody.patientId, ambulatoryId: requestBody.ambulatoryId }); },
        mintPatientInsightLeaseCommitPort: () => { calls.push('port'); return port; },
    });
    let capabilityInput: unknown;
    const service = createAuthenticatedPatientInsightPreviewService({
        acquireContext: async () => { calls.push('auth'); return Object.freeze({ session, owner }) as never; },
        readPatientRevision: () => { calls.push('revision'); return liveRevision; },
        createCapability: (currentness) => Object.freeze({ preview: async (input: unknown) => {
            calls.push('capability'); capabilityInput = input; assert.equal(currentness.verify(), true); return denied;
        } }),
        clock: () => '2026-09-01T10:00:01.000Z',
        entropy: () => new Uint8Array(32).fill(7),
    });
    return { calls, service, port, capabilityInput: () => capabilityInput,
        setRevision: (value: number | null) => { liveRevision = value; },
        afterSelection: (callback: () => void) => { afterSelection = callback; } };
}

test('authenticates first, atomically binds the host-owned projection, and invokes no apply seam', async () => {
    const value = fixture();
    const operation = await value.service.acquire();
    const result = await operation.preview(JSON.parse(JSON.stringify(requestBody)));
    assert.deepEqual(result, denied);
    const input = value.capabilityInput() as { requestId: string; projection: unknown; currentness: { selectionEpoch: number; patientRevision: number; projectionDigest: string } };
    assert.equal(input.requestId, requestBody.requestId);
    assert.deepEqual(input.projection, { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'Synthetic follow-up', activeConditions: ['Synthetic condition'], currentTherapies: ['Synthetic therapy'], recentClinicalEvents: ['Synthetic review'] });
    assert.equal(input.currentness.selectionEpoch, 7); assert.equal(input.currentness.patientRevision, 4);
    assert.match(input.currentness.projectionDigest, /^sha256_[0-9a-f]{64}$/u);
    assert.equal(value.port.snapshot().terminal, true);
    assert.equal(value.calls[0], 'auth'); assert.ok(value.calls.indexOf('capability') > value.calls.indexOf('port'));
});

test('denies stale revision before selection or capability execution', async () => {
    const value = fixture(5); const operation = await value.service.acquire();
    const result = await operation.preview(requestBody);
    assert.equal(result.status, 'denied'); assert.equal(result.code, 'source_stale');
    assert.equal(value.calls.includes('selection'), false); assert.equal(value.calls.includes('capability'), false);
});

test('HTTP acquires the authenticated operation before reading JSON and emits no-store strict wire', async () => {
    const order: string[] = [];
    const handler = createPatientInsightPreviewHttpHandler({ acquirePreview: async () => {
        order.push('auth'); return Object.freeze({ preview: async () => denied });
    } });
    const request = { json: async () => { order.push('json'); return requestBody; } } as Request;
    const response = await handler(request);
    assert.deepEqual(order, ['auth', 'json']); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { preview: denied });
});

test('HTTP maps authentication failures without parsing request content', async () => {
    let jsonReads = 0;
    const handler = createPatientInsightPreviewHttpHandler({ acquirePreview: async () => { throw new AuthenticatedPatientInsightPreviewError('session_unavailable'); } });
    const response = await handler({ json: async () => { jsonReads += 1; return requestBody; } } as Request);
    assert.equal(response.status, 401); assert.equal(jsonReads, 0);
    assert.doesNotMatch(await response.text(), /patient\.synthetic|Synthetic follow-up/u);
});

/* @Codex: unavailable includes missing and soft-deleted patients (ADR 0066).
 * Source/session/provider ports remain the existing declared unit-test doubles. */
test('unavailable revision denies preview before selection, lease or capability', async () => {
    const value = fixture(null);
    const result = await (await value.service.acquire()).preview(requestBody);
    assert.deepEqual(result, { writesPerformed: 0, apply: 'denied', status: 'denied', code: 'source_stale',
        proposal: null, receipt: null, provenance: null, reviewRef: null });
    assert.deepEqual(value.calls, ['auth', 'revision']);
});

test('revision becoming unavailable after selection denies broker use and disposes the lease', async () => {
    const value = fixture(); value.afterSelection(() => value.setRevision(null));
    const result = await (await value.service.acquire()).preview(requestBody);
    assert.deepEqual(result, { writesPerformed: 0, apply: 'denied', status: 'denied', code: 'source_stale',
        proposal: null, receipt: null, provenance: null, reviewRef: null });
    assert.equal(value.calls.includes('selection'), true);
    assert.ok(value.calls.filter((call) => call === 'revision').length >= 2, 'availability is read again');
    assert.equal(value.calls.includes('capability'), false);
    assert.equal(value.port.snapshot().terminal, true);
});
