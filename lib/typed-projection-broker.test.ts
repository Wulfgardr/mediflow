/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { type SmartImportProjection } from './smart-import-projection.ts';
import { createTypedProjectionBroker, ProjectionBrokerError, type TypedProjectionBrokerSources } from './typed-projection-broker.ts';

const NOW = '2026-08-22T12:00:00.000Z';
const REF = 'opaque-1234567890abcdef';
function config() {
    return { sessionRef: `session.${REF}`, ambulatoryRef: `ambulatory.${REF}`, patientRef: `patient.${REF}`,
        selectionEpoch: 7, leaseRef: `lease.${REF}`, expiresAt: '2026-08-22T12:10:00.000Z' };
}
function sources(overrides: Partial<TypedProjectionBrokerSources> = {}): TypedProjectionBrokerSources {
    return { clock: () => NOW, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index), ...overrides };
}
function projection() {
    return { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: `patient.${REF}`,
        selectionEpoch: 7, patientRevision: 3, sourceRevision: 5, capturedAt: NOW,
        currentDiagnoses: [{ system: 'ICD-11', code: 'FAKE-1', description: 'Diagnosi sintetica' }],
        currentActiveTherapies: [{ drugName: 'Farmaco sintetico', activePrinciple: null, dosage: '1 unita', aic: null, atc: null }],
        therapyCandidateHints: [{ sourceId: `source.${REF}`, label: 'Fonte sintetica', excerpt: 'Indicazione sintetica.' }],
        sources: [{ id: `source.${REF}`, kind: 'clinical-entry', label: 'Diario sintetico', date: NOW, content: 'Evidenza sintetica.' }],
    } satisfies SmartImportProjection;
}
let sequence = 0;
const requestId = () => `request.test-${REF}-${sequence += 1}`;
const ingest = (boundary: ReturnType<typeof createTypedProjectionBroker>, value = projection()) =>
    boundary.ingest.ingest({ projection: value, requestId: requestId() });
const reject = (action: () => unknown, code: string) => assert.throws(action, (error) => error instanceof ProjectionBrokerError
    && error.code === code && error.message === `Projection broker rejected: ${code}` && !/Diagnosi|Farmaco|opaque-123/u.test(error.message));

test('ingests once and returns an opaque handle for one detached frozen consume', () => {
    let clocks = 0; let entropy = 0;
    const boundary = createTypedProjectionBroker(config(), sources({ clock: () => { clocks += 1; return NOW; },
        entropy: () => { entropy += 1; return Uint8Array.from({ length: 16 }, (_, index) => index); } }));
    assert.deepEqual(Object.keys(boundary), ['ingest', 'service', 'control']);
    const input = projection();
    const handle = boundary.ingest.ingest({ projection: input, requestId: `request.ingest-${REF}` });
    assert.match(handle, /^prj_[0-9a-f]{32}$/u);
    assert.doesNotMatch(handle, /patient|Diagnosi|Farmaco/u);
    input.sources[0].content = 'Mutazione successiva';
    const snapshot = boundary.service.consume({ handle, capability: 'smart_import', requestId: `request.consume-${REF}` });
    assert.equal(snapshot.sources[0].content, 'Evidenza sintetica.');
    assert.equal(Object.isFrozen(snapshot.sources[0]), true);
    assert.deepEqual({ clocks, entropy }, { clocks: 2, entropy: 1 });
    assert.throws(() => boundary.service.consume({ handle, capability: 'smart_import', requestId: `request.consume-${REF}` }),
        (error) => error instanceof ProjectionBrokerError && error.code === 'request_replayed');
});

test('maps throwing or invalid clock and entropy sources to one fixed error', () => {
    for (const source of [
        sources({ clock: () => { throw new Error('raw clock'); } }),
        sources({ clock: () => 'not-a-timestamp' }),
        sources({ entropy: () => { throw new Error('raw entropy'); } }),
        sources({ entropy: () => new Uint8Array(15) }),
    ]) reject(() => ingest(createTypedProjectionBroker(config(), source)), 'source_invalid');
    reject(() => createTypedProjectionBroker(config(), { ...sources(), extra: true } as never), 'source_invalid');
});

test('rejects non-exact authority, operations and opaque grammars', () => {
    let reads = 0;
    const accessor = config(); Object.defineProperty(accessor, 'patientRef', { get() { reads += 1; return `patient.${REF}`; } });
    for (const value of [{ ...config(), providerId: 'caller' }, Object.create(config()), accessor])
        reject(() => createTypedProjectionBroker(value as never, sources()), 'input_invalid');
    assert.equal(reads, 0);
    reject(() => createTypedProjectionBroker({ ...config(), sessionRef: 'short' }, sources()), 'input_invalid');
    const boundary = createTypedProjectionBroker(config(), sources());
    reject(() => boundary.ingest.ingest({ projection: projection(), requestId: 'short' }), 'input_invalid');
    reject(() => boundary.ingest.ingest({ projection: projection(), requestId: requestId(), patientRef: `patient.${REF}` } as never), 'input_invalid');
    reject(() => boundary.service.consume({ handle: 'prj_NOT_HEX', capability: 'smart_import', requestId: requestId() }), 'input_invalid');
});

test('denies invalid, stale, wrong-patient and wrong-epoch projections before entropy', () => {
    let entropyCalls = 0;
    for (const [change, code] of [
        [(value: ReturnType<typeof projection>) => Object.assign(value, { payload: 'arbitrary' }), 'projection_invalid'],
        [(value: ReturnType<typeof projection>) => { value.capturedAt = '2026-08-22T11:54:59.999Z'; }, 'projection_stale'],
        [(value: ReturnType<typeof projection>) => { value.patientRef = `other.${REF}`; }, 'patient_mismatch'],
        [(value: ReturnType<typeof projection>) => { value.selectionEpoch = 8; }, 'selection_changed'],
    ] as const) {
        const value = projection(); change(value);
        reject(() => ingest(createTypedProjectionBroker(config(), sources({ entropy: () => { entropyCalls += 1; return new Uint8Array(16); } })), value), code);
    }
    assert.equal(entropyCalls, 0);
});

test('fails closed on wrong capability, missing handle, replay and collision', () => {
    const boundary = createTypedProjectionBroker(config(), sources()); const handle = ingest(boundary);
    const replay = requestId();
    reject(() => boundary.service.consume({ handle, capability: 'other', requestId: replay } as never), 'capability_mismatch');
    reject(() => boundary.service.consume({ handle, capability: 'smart_import', requestId: replay }), 'request_replayed');
    reject(() => boundary.service.consume({ handle: `prj_${'f'.repeat(32)}`, capability: 'smart_import', requestId: requestId() }), 'handle_missing');
    reject(() => ingest(boundary), 'handle_collision');
    boundary.service.consume({ handle, capability: 'smart_import', requestId: requestId() });
    reject(() => boundary.service.consume({ handle, capability: 'smart_import', requestId: requestId() }), 'handle_missing');
});

test('clears projections on selection change, expiry, lock and revoke', () => {
    for (const [prepare, code] of [
        [(boundary: ReturnType<typeof createTypedProjectionBroker>) => boundary.control.changeSelection({ patientRef: `next.${REF}`, selectionEpoch: 8 }), 'selection_changed'],
        [(boundary: ReturnType<typeof createTypedProjectionBroker>) => boundary.control.lock(), 'broker_locked'],
        [(boundary: ReturnType<typeof createTypedProjectionBroker>) => boundary.control.revoke(), 'broker_revoked'],
    ] as const) {
        const boundary = createTypedProjectionBroker(config(), sources()); const handle = ingest(boundary); prepare(boundary);
        reject(() => boundary.service.consume({ handle, capability: 'smart_import', requestId: requestId() }), code);
    }
    const boundary = createTypedProjectionBroker(config(), sources());
    reject(() => boundary.control.changeSelection({ patientRef: `next.${REF}`, selectionEpoch: 7 }), 'input_invalid');
    reject(() => ingest(createTypedProjectionBroker(config(), sources({ clock: () => '2026-08-22T12:10:00.000Z' }))), 'lease_expired');
});

test('uses internal production clock and 128-bit entropy when sources are omitted', () => {
    const now = new Date(); const value = projection(); value.capturedAt = now.toISOString();
    const boundary = createTypedProjectionBroker({ ...config(), expiresAt: new Date(now.getTime() + 60_000).toISOString() });
    assert.match(ingest(boundary, value), /^prj_[0-9a-f]{32}$/u);
});
