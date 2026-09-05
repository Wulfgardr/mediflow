/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SMART_IMPORT_PROJECTION_FRESHNESS_MS,
    SmartImportProjectionError,
    snapshotSmartImportProjection,
    snapshotSmartImportProjectionAttachment,
} from './smart-import-projection.ts';

const NOW = '2026-08-22T12:00:00.000Z';
const PATIENT_REF = 'patient.opaque-1234567890';
const SOURCE_REF = 'source.opaque-1234567890';
function projection() {
    return {
        schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: PATIENT_REF,
        selectionEpoch: 7, patientRevision: 3, sourceRevision: 5, capturedAt: NOW,
        currentDiagnoses: [{ system: 'ICD-11', code: 'FAKE-1', description: 'Diagnosi sintetica' }],
        currentActiveTherapies: [{ drugName: 'Farmaco sintetico', activePrinciple: null, dosage: '1 unita', aic: null, atc: null }],
        therapyCandidateHints: [{ sourceId: SOURCE_REF, label: 'Fonte sintetica', excerpt: 'Indicazione sintetica.' }],
        sources: [{ id: SOURCE_REF, kind: 'clinical-entry', label: 'Diario sintetico', date: NOW, content: 'Evidenza sintetica.' }],
    };
}
function attachment() {
    return {
        schemaVersion: 'mediflow.smart-import.projection-attachment.v1', capability: 'smart_import',
        patientRevision: 3, sourceRevision: 5, capturedAt: NOW,
        currentDiagnoses: [{ system: 'ICD-11', code: 'FAKE-1', description: 'Diagnosi sintetica' }],
        currentActiveTherapies: [{ drugName: 'Farmaco sintetico', activePrinciple: null, dosage: '1 unita', aic: null, atc: null }],
        therapyCandidateHints: [{ sourceId: SOURCE_REF, label: 'Fonte sintetica', excerpt: 'Indicazione sintetica.' }],
        sources: [{ id: SOURCE_REF, kind: 'clinical-entry', label: 'Diario sintetico', date: NOW, content: 'Evidenza sintetica.' }],
    };
}
const reject = (value: unknown, code = 'projection_invalid') => assert.throws(
    () => snapshotSmartImportProjection(value, NOW),
    (error) => error instanceof SmartImportProjectionError && error.code === code
        && error.message === `Smart Import projection rejected: ${code}` && !/Diagnosi|Farmaco|opaque-123/u.test(error.message),
);
const rejectAttachment = (value: unknown, code = 'projection_invalid') => assert.throws(
    () => snapshotSmartImportProjectionAttachment(value, NOW),
    (error) => error instanceof SmartImportProjectionError && error.code === code
        && error.message === `Smart Import projection rejected: ${code}` && !/Diagnosi|Farmaco|opaque-123/u.test(error.message),
);

test('copies a valid closed projection into a deeply frozen snapshot', () => {
    const input = projection();
    const snapshot = snapshotSmartImportProjection(input, NOW);
    input.sources[0].content = 'Mutazione successiva';
    assert.equal(snapshot.sources[0].content, 'Evidenza sintetica.');
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.sources), true);
    assert.equal(Object.isFrozen(snapshot.sources[0]), true);
});

test('uses one canonical half-open projection freshness window at ingest', () => {
    assert.equal(SMART_IMPORT_PROJECTION_FRESHNESS_MS, 300_000);
    assert.doesNotThrow(() => snapshotSmartImportProjection(projection(), '2026-08-22T12:04:59.999Z'));
    assert.throws(
        () => snapshotSmartImportProjection(projection(), '2026-08-22T12:05:00.000Z'),
        (error) => error instanceof SmartImportProjectionError && error.code === 'projection_stale',
    );
});

test('uses the same half-open freshness boundary for authority-free attachments', () => {
    assert.doesNotThrow(() => snapshotSmartImportProjectionAttachment(attachment(), '2026-08-22T12:04:59.999Z'));
    assert.throws(() => snapshotSmartImportProjectionAttachment(attachment(), '2026-08-22T12:05:00.000Z'), (error) => error instanceof SmartImportProjectionError && error.code === 'projection_stale');
    assert.throws(() => snapshotSmartImportProjectionAttachment({ ...attachment(), capturedAt: '2026-08-22T12:00:00.001Z' }, NOW), (error) => error instanceof SmartImportProjectionError && error.code === 'projection_stale');
});

test('copies a valid authority-free attachment into a deeply frozen snapshot', () => {
    const input = attachment();
    const value = snapshotSmartImportProjectionAttachment(input, NOW);
    input.sources[0].content = 'Mutazione successiva';

    assert.deepEqual(Reflect.ownKeys(value), [
        'schemaVersion', 'capability', 'patientRevision', 'sourceRevision', 'capturedAt',
        'currentDiagnoses', 'currentActiveTherapies', 'therapyCandidateHints', 'sources',
    ]);
    assert.equal(value.sources[0].content, 'Evidenza sintetica.');
    assert.equal(Object.isFrozen(value.sources[0]), true);
});

test('rejects caller authority and malformed attachment structures without reading accessors', () => {
    for (const key of ['patientRef', 'selectionEpoch', 'sessionRef', 'ambulatoryRef', 'leaseRef', 'actorRef',
        'handle', 'requestId', 'provider', 'model', 'endpoint', 'receipt']) {
        rejectAttachment({ ...attachment(), [key]: 'caller-authority' });
    }
    let reads = 0;
    const accessor = attachment();
    Object.defineProperty(accessor.sources[0], 'content', { get() { reads += 1; return 'Non leggere'; } });
    const sparse = attachment(); sparse.sources = new Array(1) as typeof sparse.sources;
    const symbol = attachment(); Object.defineProperty(symbol, Symbol('authority'), { value: true });
    for (const value of [Object.create(attachment()), accessor, sparse, symbol]) rejectAttachment(value);
    assert.equal(reads, 0);
});

test('enforces attachment freshness, revisions, bounds and source bindings', () => {
    const cases = [
        [(value: ReturnType<typeof attachment>) => { value.capturedAt = '2026-08-22T11:54:59.999Z'; }, 'projection_stale'],
        [(value: ReturnType<typeof attachment>) => { value.patientRevision = 0; }, 'projection_invalid'],
        [(value: ReturnType<typeof attachment>) => { value.sourceRevision = 0; }, 'projection_invalid'],
        [(value: ReturnType<typeof attachment>) => { value.sources[0].kind = 'unknown'; }, 'projection_invalid'],
        [(value: ReturnType<typeof attachment>) => { value.sources[0].content = 'x'.repeat(901); }, 'projection_invalid'],
        [(value: ReturnType<typeof attachment>) => { value.sources.push({ ...value.sources[0] }); }, 'projection_invalid'],
        [(value: ReturnType<typeof attachment>) => { value.therapyCandidateHints[0].sourceId = 'source.unbound-1234567890'; }, 'projection_invalid'],
    ] as const;
    for (const [change, code] of cases) { const value = attachment(); change(value); rejectAttachment(value, code); }
});

test('rejects extra, inherited, accessor and sparse structures without reading accessors', () => {
    let reads = 0;
    const accessor = projection();
    Object.defineProperty(accessor.sources[0], 'content', { get() { reads += 1; return 'Non leggere'; } });
    const sparse = projection(); sparse.sources = new Array(1) as typeof sparse.sources;
    for (const value of [{ ...projection(), payload: 'arbitrary' }, Object.create(projection()), accessor, sparse]) reject(value);
    assert.equal(reads, 0);
});

test('enforces bounds, freshness, positive versions, opaque refs and source kinds', () => {
    const cases = [
        (value: ReturnType<typeof projection>) => { value.capturedAt = '2026-08-22T11:54:59.999Z'; },
        (value: ReturnType<typeof projection>) => { value.patientRevision = 0; },
        (value: ReturnType<typeof projection>) => { value.sourceRevision = 0; },
        (value: ReturnType<typeof projection>) => { value.patientRef = 'patient'; },
        (value: ReturnType<typeof projection>) => { value.sources[0].kind = 'unknown'; },
        (value: ReturnType<typeof projection>) => { value.sources[0].label = ' \n '; },
        (value: ReturnType<typeof projection>) => { value.sources[0].content = 'x'.repeat(901); },
    ];
    cases.forEach((change, index) => { const value = projection(); change(value); reject(value, index === 0 ? 'projection_stale' : 'projection_invalid'); });
});

test('requires unique source refs and binds every candidate hint to a source', () => {
    const duplicate = projection(); duplicate.sources.push({ ...duplicate.sources[0] });
    reject(duplicate);
    const unbound = projection(); unbound.therapyCandidateHints[0].sourceId = 'source.unbound-1234567890';
    reject(unbound);
});
