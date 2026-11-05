import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatientSchema, patientSchema } from './schemas';
import { PatientEditSession, type PatientEditPort } from './patient-edit-session';
import { normalizePatientCreateInput } from './patient-write-normalization';
import { patientAgeLabel } from './patient-identity';
import { parsePatientCsv, PATIENT_CSV_HEADERS, PATIENT_CSV_IDENTITY_HEADERS, markExistingPatientDuplicates } from './patient-bulk-import';

test('creazione legacy conserva valori opachi e inferisce solo STP ENI con 13 cifre', () => {
    for (const [taxCode, identifierType] of [
        ['SYNTHETIC0000001', 'cf'], ['TEST-legacy', 'cf'], [' lower case ', 'cf'],
        ['stp0300010000123', 'stp'], ['ENI0300010000123', 'eni'], ['STP123', 'cf'],
        ['', 'cf'], [' ', 'cf'],
    ]) {
        const result = normalizePatientCreateInput({ firstName: 'Ada', lastName: 'Sintetica', taxCode }, { id: taxCode });
        assert.equal(result.ok, true);
        if (!result.ok) continue;
        assert.equal(result.values.taxCode, taxCode);
        assert.equal(result.values.identifierType, identifierType);
        assert.equal(patientAgeLabel(result.values), null);
    }
});

test('schema senza tipo conserva il controllo form legacy di main', () => {
    const person = { firstName: 'Ada', lastName: 'Sintetica' };
    assert.equal(patientSchema.safeParse({ ...person, taxCode: 'RSSMRA80A01H501X' }).success, true);
    assert.equal(patientSchema.safeParse({ ...person, identifierType: 'cf', taxCode: 'RSSMRA80A01H501X' }).success, false);
    assert.equal(patientSchema.safeParse({ ...person, taxCode: 'TEST-legacy' }).success, false);
    assert.equal(patientSchema.safeParse({ ...person, taxCode: 'x'.repeat(17) }).success, false);
});

test('CSV legacy conserva il controllo precedente, i duplicati e non dichiara un tipo inferito', () => {
    const taxCode = 'SYNTHETIC0000001';
    const parsed = parsePatientCsv(new TextEncoder().encode(`${PATIENT_CSV_HEADERS.join(';')}\nAda;Sintetica;${taxCode};;;`));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const row = parsed.preview.rows[0];
    assert.deepEqual(row.issues, []);
    assert.equal(row.values?.identifierType, undefined);
    assert.equal(normalizePatientCreateInput({ ...row.values }, { id: 'legacy-csv' }).ok, true);
    assert.equal(markExistingPatientDuplicates(parsed.preview, [{ id: 'existing', taxCode, identifierType: 'cf' }]).rows[0].duplicateExisting, true);
    const declared = parsePatientCsv(new TextEncoder().encode(`${PATIENT_CSV_IDENTITY_HEADERS.join(';')}\nAda;Sintetica;${taxCode};;;;cf;;`));
    assert.equal(declared.ok, true);
    if (declared.ok) assert.ok(declared.preview.rows[0].issues.some(issue => issue.code === 'tax-code'));
});

test('form modifica note con CF storico invalido e blocca cambio di valore o tipo invalido', async () => {
    const session = new PatientEditSession({ id: 'synthetic-legacy-form', version: 1,
        firstName: 'Ada', lastName: 'Sintetica', identifierType: 'cf', taxCode: 'RSSMRA80A01H501X', checkups: [] });
    const saved = session.getDefaultValues();
    const schema = createPatientSchema(saved);
    const draft = { ...saved, notes: 'Nota sintetica aggiornata' };
    assert.equal(patientSchema.safeParse(draft).success, false);
    const parsed = schema.parse(draft);
    const writes: unknown[] = [];
    const port: PatientEditPort = {
        updatePatient: async (id, changes) => { writes.push({ id, changes }); },
        updateCheckup: async () => { throw new Error('Unexpected checkup'); },
        deleteCheckup: async () => { throw new Error('Unexpected checkup'); },
        createCheckup: async () => { throw new Error('Unexpected checkup'); },
    };
    const result = await session.submit(parsed, port, () => 'synthetic-child');
    assert.equal(result.status, 'complete');
    assert.deepEqual(writes, [{ id: 'synthetic-legacy-form', changes: { version: 1, notes: draft.notes } }]);
    assert.equal(schema.safeParse({ ...draft, taxCode: 'RSSMRA80A01H501Y' }).success, false);
    assert.equal(schema.safeParse({ ...draft, identifierType: 'stp' }).success, false);
    assert.equal(schema.safeParse({ ...draft, taxCode: 'RSSMRA80A01H501U' }).success, true);
});
