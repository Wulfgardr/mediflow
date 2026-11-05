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
