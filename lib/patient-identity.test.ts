import { randomSyntheticTaxCode, syntheticTaxCode } from './patient-identity.test-support.ts';
import { inferIdentifierType, isValidItalianTaxCode } from './patient-identity';
import assert from 'node:assert/strict';
import test from 'node:test';
import { patientSchema } from './schemas';
import { estimateBirthYearFromTaxCode } from './utils';
import { normalizePatientCreateInput } from './patient-write-normalization';
import { toFhirPatient } from './fhir/patient-adapter';

const person = { firstName: 'Ada', lastName: 'Sintetica' };
test('a: registra none con solo anno stimato', () => {
    const input = { ...person, identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1982 };
    assert.equal(patientSchema.safeParse(input).success, true);
    const normalized = normalizePatientCreateInput(input, { id: 'synthetic-none' });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    assert.equal(Reflect.get(normalized.values, 'identifierType'), 'none');
    assert.equal(Reflect.get(normalized.values, 'birthYear'), 1982);
    assert.equal(normalized.values.birthDate, null);
    assert.equal(patientSchema.safeParse({ ...input, birthYear: undefined }).success, false);
});
test('b: STP senza nascita non produce un anno o una eta', () => {
    assert.equal(estimateBirthYearFromTaxCode('STP0300010000123'), null);
});
test('c: rifiuta controllo CF errato e accetta omocodia valida', () => {
    assert.equal(patientSchema.safeParse({ ...person, identifierType: 'cf', taxCode: 'RSSMRA80A01H501X' }).success, false);
    assert.equal(patientSchema.safeParse({ ...person, identifierType: 'cf', taxCode: 'RSSMRA80A01H50MM' }).success, true);
});
test('f: FHIR distingue sistemi e non inventa identifier per none', () => {
    const systems = { cf: 'urn:oid:2.16.840.1.113883.2.9.4.3.2', stp: 'urn:mediflow:identifier:stp', eni: 'urn:mediflow:identifier:eni', passport: 'urn:mediflow:identifier:foreign-document', other: 'urn:mediflow:identifier:other' };
    for (const [identifierType, system] of Object.entries(systems)) {
        const resource = toFhirPatient({ ...person, id: 'synthetic-fhir', taxCode: 'SYNTHETIC', identifierType } as Parameters<typeof toFhirPatient>[0]);
        assert.equal(resource.identifier?.[0].system, system);
        assert.equal(resource.identifier?.[0].value, 'SYNTHETIC');
    }
    assert.equal(toFhirPatient({ ...person, id: 'synthetic-none', taxCode: '', identifierType: 'none' } as Parameters<typeof toFhirPatient>[0]).identifier, undefined);
});

test('inferisce STP ed ENI solo con esattamente 13 cifre', () => {
    for (const value of ['STPMRA80A01H501U', 'ENIXXX80A01H501U', 'STP123', 'ENI03000100001234']) assert.equal(inferIdentifierType(value), 'cf');
    assert.equal(inferIdentifierType(' stp0300010000123 '), 'stp');
    assert.equal(inferIdentifierType('eni0300010000123'), 'eni');
    assert.equal(inferIdentifierType(' '), 'none');
});

test('genera 10.000 CF casuali e 10.000 CF da seme validi senza eccezioni', () => {
    for (let i = 0; i < 10_000; i++) {
        assert.equal(isValidItalianTaxCode(randomSyntheticTaxCode()), true);
        assert.equal(isValidItalianTaxCode(syntheticTaxCode(i)), true);
    }
});

test('righe scritte senza precisione (default «unknown») ma con la data si leggono come data esatta', async () => {
    const { patientAgeLabel } = await import('./patient-identity.ts');
    const { patientFormDefaults } = await import('./patient-edit-session.ts');
    const now = new Date('2026-11-05T12:00:00Z');
    const row = { taxCode: 'PERF000000000000', birthDate: '1980-03-10T00:00:00.000Z', birthDatePrecision: 'unknown' as const, birthYear: null };
    assert.equal(patientAgeLabel(row, now), '46 anni');
    assert.equal(patientFormDefaults(row).birthDatePrecision, 'exact');
    assert.equal(patientFormDefaults({ ...row, birthDate: null, birthYear: 1970 }).birthDatePrecision, 'estimated');
    assert.equal(patientFormDefaults({ ...row, birthDate: null }).birthDatePrecision, 'unknown');
});

test('una scheda nuova parte dal codice fiscale; un record esistente senza codice resta senza identificativo', async () => {
    const { patientFormDefaults } = await import('./patient-edit-session.ts');
    assert.equal(patientFormDefaults({}).identifierType, 'cf');
    assert.equal(patientFormDefaults({ id: 'p1', taxCode: '' }).identifierType, 'none');
    assert.equal(patientFormDefaults({ id: 'p1', taxCode: 'STP0300010000123' }).identifierType, 'stp');
    assert.equal(patientFormDefaults({ id: 'p1', taxCode: 'X', identifierType: 'other' }).identifierType, 'other');
});
