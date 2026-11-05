import assert from 'node:assert/strict';
import test from 'node:test';
import { identifierError, patientAgeLabel } from './patient-identity';
import { evaluateEgress } from './ai-egress-gate';
import { createRedactionSession } from './ai-redaction-session';
import { parsePatientCsv, PATIENT_CSV_IDENTITY_HEADERS } from './patient-bulk-import';
import { buildSissPatientContextSummary } from './siss-patient-context-shared';
import { decidePatientImportTarget } from './domain/documents/patient-import-decision';
import { resolveDocumentTaxCodeRoles } from './domain/documents/document-identity-resolution';

test('nascita esatta considera compleanno, stime restano esplicite', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    assert.equal(patientAgeLabel({ birthDate: '1980-06-01', birthDatePrecision: 'exact' }, now), '45 anni');
    assert.equal(patientAgeLabel({ birthYear: 1980, birthDatePrecision: 'estimated' }, now), 'circa 46 anni');
    for (const identifierType of ['stp', 'eni', 'passport', 'other', 'none'] as const) assert.equal(patientAgeLabel({ identifierType, taxCode: 'RSSMRA80A01H501U' }, now), null);
    assert.equal(patientAgeLabel({ identifierType: 'cf', taxCode: 'RSSMRA80A01H501X' }, now), null);
    assert.equal(patientAgeLabel({ identifierType: 'cf', taxCode: 'RSSMRA80A01H501U' }, now), 'circa 46 anni');
});
test('validazione distingue prefissi, cifre e testo libero limitato', () => {
    for (const type of ['stp', 'eni'] as const) {
        assert.equal(identifierError(type, `${type.toUpperCase()}0300010000123`), null);
        assert.ok(identifierError(type, 'RSSMRA80A01H501U'));
        assert.ok(identifierError(type, `${type.toUpperCase()}030001000012A`));
    }
    assert.equal(identifierError('passport', 'Document 123/A'), null);
    assert.equal(identifierError('other', 'Dichiarato 123'), null);
    assert.ok(identifierError('other', 'x'.repeat(129)));
    assert.ok(identifierError('none', '123'));
});
test('CSV esteso prepara none con solo anno e STP senza ricavare nascita', () => {
    const csv = `${PATIENT_CSV_IDENTITY_HEADERS.join(';')}\nAda;Sintetica;;;;;none;estimated;1980\nAltra;Sintetica;STP0300010000123;;;;stp;unknown;`;
    const parsed = parsePatientCsv(new TextEncoder().encode(csv));
    assert.equal(parsed.ok, true); if (!parsed.ok) return;
    assert.deepEqual(parsed.preview.rows.map(row => row.issues), [[], []]);
    assert.equal(parsed.preview.rows[0].values?.birthYear, 1980);
    assert.equal(parsed.preview.rows[1].values?.birthDate, undefined);
});
test('redazione copre STP ENI e documenti noti, con gate ancora chiuso', () => {
    const identifiers = ['STP0300010000123', 'ENI0300010000123', 'Document 123/A', 'Locale (123)'];
    const result = evaluateEgress({ text: identifiers.join('; '), lane: 'clinical', knownIdentifiers: { identifiers } });
    assert.equal(result.status, 'closed_pending_redaction_lane');
    for (const value of identifiers) assert.ok(!result.redactedText?.includes(value));
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text: identifiers.join('; '), entities: [], knownIdentifiers: { identifiers } });
        for (const value of identifiers) assert.ok(!prepared.redactedText.includes(value));
    } finally { session.close(); }
});
test('SISS rifiuta documento e altro anche se sembrano CF', () => {
    for (const identifierType of ['passport', 'other', 'none'] as const) assert.equal(buildSissPatientContextSummary({ identifierType, patientTaxCode: 'RSSMRA80A01H501U' }).patientFiscalCodeReady, false);
    for (const [identifierType, patientTaxCode] of [['cf', 'RSSMRA80A01H501U'], ['stp', 'STP0300010000123'], ['eni', 'ENI0300010000123']] as const) assert.equal(buildSissPatientContextSummary({ identifierType, patientTaxCode }).patientFiscalCodeReady, true);
});
test('documenti mantengono il tipo e non uniscono tipi diversi', () => {
    const roles = resolveDocumentTaxCodeRoles({ text: 'Assistito codice STP STP0300010000123' });
    assert.equal(roles.taxCodes[0]?.identifierType, 'stp');
    const decision = decidePatientImportTarget({ identifierType: 'passport', taxCode: 'ABC123', candidates: [{ id: 'other', identifierType: 'other', taxCode: 'ABC123' }] });
    assert.notEqual(decision.action, 'merge_existing_patient');
});
