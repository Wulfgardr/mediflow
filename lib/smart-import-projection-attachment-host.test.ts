/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHostSmartImportProjectionAttacher,
    SmartImportProjectionAttachmentHostError,
} from './smart-import-projection-attachment-host.ts';
import { SmartImportProjectionError } from './smart-import-projection.ts';

const NOW = '2026-08-22T12:00:00.000Z';
const PATIENT_REF = 'patient.canonical-1234567890';
const SOURCE_REF = 'source.synthetic-1234567890';
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
const rejectHost = (action: () => unknown, code: 'authority_invalid' | 'source_invalid') => assert.throws(
    action,
    (error) => error instanceof SmartImportProjectionAttachmentHostError && error.code === code
        && error.message === `Smart Import projection attachment host rejected: ${code}`
        && !/canonical|Diagnosi|raw source/u.test(error.message),
);

test('applies one canonical authority snapshot with one host clock read', () => {
    let clocks = 0;
    const authority = { patientRef: PATIENT_REF, selectionEpoch: 7 };
    const attacher = createHostSmartImportProjectionAttacher(authority, { clock: () => { clocks += 1; return NOW; } });
    authority.patientRef = 'patient.changed-1234567890'; authority.selectionEpoch = 8;
    const input = attachment();
    const value = attacher.attach(input);
    input.sources[0].content = 'Mutazione successiva';

    assert.equal(value.patientRef, PATIENT_REF);
    assert.equal(value.selectionEpoch, 7);
    assert.equal(value.sources[0].content, 'Evidenza sintetica.');
    assert.deepEqual({ clocks, frozen: Object.isFrozen(value) && Object.isFrozen(value.sources[0]) }, { clocks: 1, frozen: true });
});

test('rejects malformed authority and clock sources with fixed non-echoing errors', () => {
    let authorityReads = 0;
    const accessorAuthority = { selectionEpoch: 7 } as { patientRef: string; selectionEpoch: number };
    Object.defineProperty(accessorAuthority, 'patientRef', { get() { authorityReads += 1; return PATIENT_REF; } });
    const symbolAuthority = { patientRef: PATIENT_REF, selectionEpoch: 7 };
    Object.defineProperty(symbolAuthority, Symbol('authority'), { value: true });
    for (const authority of [
        { patientRef: 'short', selectionEpoch: 7 },
        { patientRef: PATIENT_REF, selectionEpoch: 0 },
        { patientRef: PATIENT_REF, selectionEpoch: 7, sessionRef: 'caller-authority' },
        Object.create({ patientRef: PATIENT_REF, selectionEpoch: 7 }),
        accessorAuthority,
        symbolAuthority,
    ]) rejectHost(() => createHostSmartImportProjectionAttacher(authority as never), 'authority_invalid');
    assert.equal(authorityReads, 0);

    for (const clock of [() => { throw new Error('raw source detail'); }, () => 'invalid']) {
        const attacher = createHostSmartImportProjectionAttacher(
            { patientRef: PATIENT_REF, selectionEpoch: 7 }, { clock },
        );
        rejectHost(() => attacher.attach(attachment()), 'source_invalid');
    }
    rejectHost(() => createHostSmartImportProjectionAttacher(
        { patientRef: PATIENT_REF, selectionEpoch: 7 }, { clock: () => NOW, extra: true } as never,
    ), 'source_invalid');
});

test('rejects caller authority overrides before returning an internal projection', () => {
    const attacher = createHostSmartImportProjectionAttacher(
        { patientRef: PATIENT_REF, selectionEpoch: 7 }, { clock: () => NOW },
    );
    assert.throws(
        () => attacher.attach({ ...attachment(), patientRef: 'patient.caller-1234567890', selectionEpoch: 99 }),
        (error) => error instanceof SmartImportProjectionError && error.code === 'projection_invalid'
            && !/caller-123|Diagnosi/u.test(error.message),
    );
});

test('maps hostile authority and source objects to fixed errors', () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('raw proxy detail'); } });
    rejectHost(() => createHostSmartImportProjectionAttacher(hostile as never), 'authority_invalid');
    rejectHost(() => createHostSmartImportProjectionAttacher(
        { patientRef: PATIENT_REF, selectionEpoch: 7 }, hostile as never,
    ), 'source_invalid');
});
