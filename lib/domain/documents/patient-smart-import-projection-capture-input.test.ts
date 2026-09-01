/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ClinicalEntry, DocumentInsight, Patient, Therapy } from '../../db.ts';
import { SmartImportProjectionAttachmentBrowserNormalizerError, createSmartImportProjectionAttachmentBrowserNormalizer } from '../../security/smart-import-projection-attachment-browser-normalizer.ts';
import { buildPatientSmartImportProjectionCaptureInput } from './patient-smart-import-projection-capture.ts';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const rejects = (error: unknown) => error instanceof SmartImportProjectionAttachmentBrowserNormalizerError && error.code === 'capture_invalid';

function patient(overrides: Partial<Patient> = {}): Patient {
    return { id: 'patient.synthetic.01', firstName: 'Synthetic', lastName: 'Patient', taxCode: 'SYNTHETIC0000000', address: 'Synthetic address', phone: '0000000000',
        createdAt: NOW, updatedAt: NOW, version: 7, notes: 'Terapia: Farmaco sintetico 5 mg', diagnoses: JSON.stringify([{ system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica', date: NOW.toISOString() }]) as unknown as Patient['diagnoses'], ...overrides };
}
function entry(index = 1, content = 'Terapia: Farmaco sintetico 5 mg'): ClinicalEntry {
    return { id: `entry.synthetic.${index}`, patientId: 'patient.synthetic.01', date: new Date(NOW.getTime() + index), type: 'note', title: 'Synthetic entry', content, createdAt: NOW, updatedAt: NOW };
}
function therapy(status: Therapy['status'], overrides: Partial<Therapy> = {}): Therapy {
    return { id: `therapy.synthetic.${status}`, patientId: 'patient.synthetic.01', drugName: 'Farmaco sintetico', dosage: '5 mg', status, startDate: NOW, createdAt: NOW, ...overrides };
}
function insight(index: number): DocumentInsight {
    return { id: `insight.synthetic.${index}`, date: new Date(NOW.getTime() + index * 86_400_000), fileName: `synthetic-${index}.pdf`, rawMarkdown: 'Synthetic raw', summary: `Synthetic summary ${index}` };
}

test('builds the complete normalizer input from legacy records without ambulatory authority', () => {
    const input = buildPatientSmartImportProjectionCaptureInput(patient(), [entry()], [{ id: 'attachment.synthetic.01', name: 'synthetic.txt', summarySnapshot: 'Sintesi allegato sintetica', createdAt: NOW }], [
        therapy('active', { activePrinciple: undefined, aic: undefined, atc: undefined }), therapy('completed'),
    ]);

    assert.deepEqual(input.patient, { version: 7 });
    assert.deepEqual(input.currentDiagnoses, [{ system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica' }]);
    assert.deepEqual(input.currentActiveTherapies, [{ drugName: 'Farmaco sintetico', activePrinciple: null, dosage: '5 mg', aic: null, atc: null }]);
    assert.deepEqual(input.sources.map(({ kind, originKey }) => [kind, originKey]), [
        ['patient-notes', 'patient-notes:1'], ['clinical-entry', 'entry:entry.synthetic.1:1'], ['attachment-summary', 'attachment:attachment.synthetic.01'],
    ]);
    assert.ok(input.therapyCandidateHints.length > 0);
    assert.ok(input.therapyCandidateHints.every((hint) => input.sources.some((source) => source.kind === hint.kind && source.originKey === hint.originKey)));
    assert.equal(JSON.stringify(input).includes('ambulatoryId'), false);
});

test('is deterministic, keeps legacy origin binding, and does not mutate insight input', () => {
    const insights = [insight(1), insight(2)]; const input = patient({ documentInsights: insights });
    const first = buildPatientSmartImportProjectionCaptureInput(input, [entry()], [], [therapy('active')]);
    const second = buildPatientSmartImportProjectionCaptureInput(input, [entry()], [], [therapy('active')]);
    assert.deepEqual(first, second);
    assert.deepEqual(insights.map(({ id }) => id), ['insight.synthetic.1', 'insight.synthetic.2']);
    assert.ok(first.sources.some((source) => source.kind === 'document-insight' && source.originKey === 'insight:insight.synthetic.1'));
});

test('preserves more than 32 legacy sources so the normalizer rejects them typed', () => {
    const entries = Array.from({ length: 6 }, (_, index) => entry(index + 1, `Terapia: Farmaco ${index} 5 mg; Terapia: Farmaco ${index} 6 mg; Terapia: Farmaco ${index} 7 mg; Terapia: Farmaco ${index} 8 mg`));
    const input = buildPatientSmartImportProjectionCaptureInput(patient({ notes: 'A; B; C; D; E; F', documentInsights: [insight(1), insight(2), insight(3), insight(4)] }), entries, [], []);
    assert.equal(input.sources.length, 34);
    assert.throws(() => createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => NOW }).capture(input, true), rejects);
});

test('does not synthesize a patient version when the legacy record lacks one', () => {
    const input = buildPatientSmartImportProjectionCaptureInput(patient({ version: undefined }), [entry()], [], []);
    assert.equal(input.patient.version, undefined);
    assert.throws(() => createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => NOW }).capture(input, true), rejects);
});

test('keeps the builder pure and outside selection, context, and apply boundaries', () => {
    const source = readFileSync(new URL('./patient-smart-import-projection-capture.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function buildPatientSmartImportProjectionCaptureInput');
    assert.ok(start >= 0);
    const builder = source.slice(start);
    assert.doesNotMatch(builder, /db\.|fetch\(|localStorage|sessionStorage|ambulatoryId|\/api\/context|selection|apply/u);
    assert.match(source, /import type \{[^\n]+\} from ['"]\.\.\/\.\.\/db['"]/u);
    assert.doesNotMatch(source, /AIService|patient-smart-import-service|import \{[^\n]+\} from ['"]\.\.\/\.\.\/db['"]/u);
});
