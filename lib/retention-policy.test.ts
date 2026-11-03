import assert from 'node:assert/strict';
import test from 'node:test';
import {
    RETENTION_CATEGORIES, RETENTION_CLASSIFICATION, RETENTION_PROFILES, RetentionError, addCalendarYears,
    assertWindowsRespectProfile, classifyRetentionRow, effectiveRetentionTerm, evaluateFascicolo, retentionProfileForPreset,
    type FascicoloFacts, type RetentionCategory,
} from './retention-policy';
import type { PatientChildTableName } from './patient-cascade';

const CLOSED_AT = Date.UTC(2010, 0, 15) / 1000;
const facts = (categories: RetentionCategory[], overrides: Partial<FascicoloFacts> = {}): FascicoloFacts => ({
    patientId: 'synthetic-patient', version: 3, archived: true, deleted: false, closureEstimate: CLOSED_AT, categories, ...overrides,
});
const NOW = Date.UTC(2026, 10, 3) / 1000;

// Un esempio di riga MediFlow per categoria: la tabella del dominio è l'unica fonte.
const EXAMPLES: Record<RetentionCategory, { table: PatientChildTableName; value?: string }> = {
    ambulatory_record: { table: 'entries', value: 'visit' },
    hospital_record: { table: 'entries', value: 'hospitalization' },
    diagnostic_report: { table: 'entries', value: 'exam' },
    lab_report: { table: 'observations' },
    imaging_iconography: { table: 'attachments', value: 'application/dicom' },
    prescription: { table: 'therapies' },
    attached_document: { table: 'attachments', value: 'application/pdf' },
    unclassified: { table: 'entries', value: 'tipo-sconosciuto' },
};

for (const category of RETENTION_CATEGORIES) {
    test(`classificazione: ${category} ha una sorgente MediFlow e un termine in ogni profilo`, () => {
        const example = EXAMPLES[category];
        assert.equal(classifyRetentionRow(example.table, example.value), category);
        for (const profile of Object.values(RETENTION_PROFILES)) {
            const term = profile.terms[category];
            assert.ok(term, `${profile.id} definisce ${category}`);
            if (term.basis === 'source') assert.ok(term.sourceId, `${profile.id}/${category} cita la fonte`);
        }
    });
}

test('ogni tabella figlia del paziente è classificata e la categoria ignota resta illimitata', () => {
    for (const [table, rule] of Object.entries(RETENTION_CLASSIFICATION)) {
        assert.ok(rule.timestamps.length > 0, `${table} ha almeno una data per la chiusura`);
    }
    for (const profile of Object.values(RETENTION_PROFILES)) {
        assert.equal(profile.terms.unclassified.term.kind, 'unlimited');
    }
});

test('il profilo segue il pacchetto territoriale', () => {
    assert.equal(retentionProfileForPreset('core'), 'none');
    assert.equal(retentionProfileForPreset('core+it'), 'it-national');
    assert.equal(retentionProfileForPreset('core+it+lom'), 'it-lom-rev04');
});

test('le finestre allungano il minimo ma non lo accorciano e non toccano le categorie illimitate', () => {
    assert.throws(() => assertWindowsRespectProfile('it-lom-rev04', { ambulatory_record: { kind: 'years', years: 9 } }),
        (error: unknown) => error instanceof RetentionError && error.code === 'below_minimum');
    assert.throws(() => assertWindowsRespectProfile('it-lom-rev04', { hospital_record: { kind: 'years', years: 99 } }),
        (error: unknown) => error instanceof RetentionError && error.code === 'below_minimum');
    assert.doesNotThrow(() => assertWindowsRespectProfile('it-lom-rev04', { ambulatory_record: { kind: 'years', years: 15 } }));
    assert.doesNotThrow(() => assertWindowsRespectProfile('none', { ambulatory_record: { kind: 'years', years: 2 } }));
    // Una finestra salvata con un profilo più corto non scende sotto il minimo del profilo attivo.
    assert.deepEqual(effectiveRetentionTerm('it-lom-rev04', 'ambulatory_record', { kind: 'years', years: 2 }),
        { kind: 'years', years: 10, origin: 'profile' });
    assert.deepEqual(effectiveRetentionTerm('none', 'ambulatory_record', undefined), { kind: 'unset' });
});

test('un fascicolo chiuso scade dalla chiusura secondo il termine più lungo delle sue categorie', () => {
    const before = evaluateFascicolo(facts(['lab_report', 'prescription']), 'it-lom-rev04', {}, [], addCalendarYears(CLOSED_AT, 10) - 1);
    assert.equal(before.status, 'in_retention');
    assert.equal(before.governing?.category, 'ambulatory_record');
    const after = evaluateFascicolo(facts(['lab_report', 'prescription']), 'it-lom-rev04', {}, [], NOW);
    assert.equal(after.status, 'expired');
    assert.equal(after.expiresAt, addCalendarYears(CLOSED_AT, 10));
    const longer = evaluateFascicolo(facts(['lab_report']), 'it-lom-rev04', { lab_report: { kind: 'years', years: 30 } }, [], NOW);
    assert.equal(longer.status, 'in_retention');
});

test('fascicolo aperto, categoria illimitata, finestra mancante e blocco non sono mai scaduti', () => {
    assert.equal(evaluateFascicolo(facts([], { archived: false }), 'it-lom-rev04', {}, [], NOW).status, 'open');
    assert.equal(evaluateFascicolo(facts(['hospital_record']), 'it-lom-rev04', {}, [], NOW).status, 'unlimited');
    assert.equal(evaluateFascicolo(facts(['attached_document']), 'it-national', {}, [], NOW).status, 'unlimited');
    assert.equal(evaluateFascicolo(facts([]), 'none', {}, [], NOW).status, 'unset');
    assert.equal(evaluateFascicolo(facts([], { closureEstimate: null }), 'it-lom-rev04', {}, [], NOW).status, 'closure_unknown');
    const hold = { id: '0b3c1f9e-5a7d-4e2b-9c41-2f6d8e7a1b30', scope: 'patient' as const, patientId: 'synthetic-patient',
        attachmentId: null, reason: 'litigation' as const, placedAt: NOW, placedBy: 'synthetic-admin' };
    assert.equal(evaluateFascicolo(facts([]), 'it-lom-rev04', {}, [hold], NOW).status, 'held');
});
