import assert from 'node:assert/strict';
import test from 'node:test';

import type { DossierDraftGroup, DossierDraftSource, DossierPatient } from './document-dossier-session';
import { allIdentityProposals, groupIdentityProposals, loneDocumentImage, newPatientDossierStart, undecidedReason } from './dossier-new-patient-entry';
import { birthDateMatchesTaxCode, isValidItalianTaxCode, taxCodeBirthDetails } from './patient-identity';
import { omocodicVariant, syntheticTaxCode } from './patient-identity.test-support.ts';

const CF = syntheticTaxCode('nuova-scheda');
const OTHER = syntheticTaxCode('altro-paziente');

function source(key: string, options: { codes?: string[]; kind?: 'pdf' | 'image'; size?: number; status?: DossierDraftSource['status']; text?: string } = {}): DossierDraftSource {
    return {
        key, group: '.', relativePath: key, fileName: key, size: options.size ?? 2048, sha256: key,
        classification: { kind: options.kind ?? 'pdf', mediaType: options.kind === 'image' ? 'image/png' : 'application/pdf', extractable: true, reason: '' },
        extraction: { state: 'extracted', unitBasis: 'pages', units: [], ocrPageCount: 0 } as unknown as DossierDraftSource['extraction'],
        text: options.text ?? '', taxCodes: (options.codes ?? []).map((value) => ({ value, role: 'patient_cf' as const, checksumValid: true })),
        patientNames: [], documentDate: null as unknown as DossierDraftSource['documentDate'], facts: [],
        classificationResult: null as unknown as DossierDraftSource['classificationResult'], status: options.status ?? 'ready',
        file: { name: key, size: 2048, type: 'application/pdf', lastModified: 0, relativePath: key, read: async () => new Uint8Array() },
    };
}
const group = (...sources: DossierDraftSource[]): DossierDraftGroup => ({ key: '.', sources });
const patient = (taxCode: string): DossierPatient => ({ id: `p-${taxCode}`, firstName: 'Anna', lastName: 'Sintetica', taxCode, diagnoses: [], exemptions: [] });

test('documenti di un paziente nuovo: la creazione parte dal PDF che porta il codice fiscale', () => {
    const start = newPatientDossierStart([group(source('esami.pdf'), source('lettera.pdf', { codes: [CF] }))], []);
    assert.deepEqual(start, { kind: 'create', groupKey: '.', sourceKey: 'lettera.pdf' });
});

test('fra più PDF dello stesso paziente la creazione parte da quello con più dati anagrafici', () => {
    const start = newPatientDossierStart([group(
        source('esami.pdf', { codes: [CF] }),
        source('lettera.pdf', { codes: [CF], text: 'Cognome: Sintetica\nNome: Elena\nData di nascita: 03/02/1950' }),
    )], []);
    assert.deepEqual(start, { kind: 'create', groupKey: '.', sourceKey: 'lettera.pdf' });
});

test('senza codice fiscale nei documenti la creazione parte dal primo PDF', () => {
    assert.deepEqual(newPatientDossierStart([group(source('referto.pdf'))], []), { kind: 'create', groupKey: '.', sourceKey: 'referto.pdf' });
});

test('due codici fiscali diversi fermano la creazione', () => {
    const start = newPatientDossierStart([group(source('a.pdf', { codes: [CF] }), source('b.pdf', { codes: [OTHER] }))], []);
    assert.deepEqual(start, { kind: 'review', reason: 'identity_blocked' });
});

test('un codice fiscale e la sua variante per omocodia fermano la creazione', () => {
    const variant = omocodicVariant(CF);
    assert.ok(isValidItalianTaxCode(variant));
    assert.notEqual(variant, CF);
    const start = newPatientDossierStart([group(source('a.pdf', { codes: [CF] }), source('b.pdf', { codes: [variant] }))], []);
    assert.deepEqual(start, { kind: 'review', reason: 'identity_blocked' });
});

test('un codice fiscale già in archivio propone la scheda esistente, non una nuova', () => {
    const start = newPatientDossierStart([group(source('lettera.pdf', { codes: [CF] }))], [patient(CF)]);
    assert.deepEqual(start, { kind: 'review', reason: 'existing_patient' });
});

test('senza un PDF leggibile entro il limite la creazione non parte', () => {
    assert.deepEqual(newPatientDossierStart([group(source('foto.png', { kind: 'image' }))], []), { kind: 'review', reason: 'no_pdf' });
    assert.deepEqual(newPatientDossierStart([group(source('grande.pdf', { size: 11 * 1024 * 1024 }))], []), { kind: 'review', reason: 'no_pdf' });
    assert.deepEqual(newPatientDossierStart([group(source('escluso.pdf', { status: 'excluded' }))], []), { kind: 'review', reason: 'several_groups' });
});

test('documenti in più gruppi restano alla scelta del medico', () => {
    const start = newPatientDossierStart([group(source('a.pdf')), { key: 'Altro', sources: [source('b.pdf')] }], []);
    assert.deepEqual(start, { kind: 'review', reason: 'several_groups' });
});

test('una sola foto segue la creazione da documento singolo', () => {
    assert.equal(loneDocumentImage([{ type: 'image/jpeg' }])?.type, 'image/jpeg');
    assert.equal(loneDocumentImage([{ type: 'image/jpeg' }, { type: 'application/pdf' }]), null);
    assert.equal(loneDocumentImage([{ type: 'application/pdf' }]), null);
});

const LETTER = 'Cognome: Sintetica\nNome: Elena\nData di nascita: 01/01/1980';

test('i testi sintetici usano la data di nascita codificata nel codice fiscale sintetico', () => {
    assert.equal(birthDateMatchesTaxCode(CF, '1980-01-01'), true);
});

test('le proposte d’anagrafica vengono da tutti i documenti del lotto, ognuna con il suo file', () => {
    const proposals = groupIdentityProposals(group(
        source('esami.pdf', { codes: [CF] }),
        source('lettera.pdf', { codes: [CF], text: LETTER }),
    ), 'lettera.pdf');
    assert.deepEqual(proposals.map((item) => [item.field, item.value, item.sourceName]), [
        ['taxCode', CF, 'lettera.pdf'], ['lastName', 'Sintetica', 'lettera.pdf'], ['firstName', 'Elena', 'lettera.pdf'], ['birthDate', '1980-01-01', 'lettera.pdf'],
    ]);
});

test('un solo gesto porta tutte le proposte concordi nei campi', () => {
    const proposals = groupIdentityProposals(group(
        source('lettera.pdf', { codes: [CF], text: LETTER }),
        source('referto.pdf', { codes: [CF], text: 'COGNOME: SINTETICA\nnato il 1/1/1980' }),
    ), 'lettera.pdf');
    assert.deepEqual(allIdentityProposals(proposals), {
        values: { taxCode: CF, lastName: 'Sintetica', firstName: 'Elena', birthDate: '1980-01-01' }, undecided: [],
    });
});

test('due documenti con valori diversi per lo stesso campo: nessuna scelta, il campo resta da decidere', () => {
    const proposals = groupIdentityProposals(group(
        source('lettera.pdf', { codes: [CF], text: LETTER }),
        source('referto.pdf', { codes: [CF], text: 'Cognome: Sintetico\nData di nascita: 02/01/1980' }),
    ), 'lettera.pdf');
    assert.deepEqual(proposals.map((item) => [item.field, item.value, item.sourceName]), [
        ['taxCode', CF, 'lettera.pdf'], ['lastName', 'Sintetica', 'lettera.pdf'], ['lastName', 'Sintetico', 'referto.pdf'],
        ['firstName', 'Elena', 'lettera.pdf'], ['birthDate', '1980-01-01', 'lettera.pdf'], ['birthDate', '1980-01-02', 'referto.pdf'],
    ]);
    assert.deepEqual(allIdentityProposals(proposals), { values: { taxCode: CF, firstName: 'Elena' }, undecided: ['lastName', 'birthDate'] });
});

test('una data di nascita che non corrisponde al codice fiscale proposto resta da decidere', () => {
    const cf = taxCodeBirthDetails(CF);
    assert.ok(cf);
    const relativeBirth = `19${String((cf.yearSuffix + 30) % 100).padStart(2, '0')}-01-15`;
    assert.equal(birthDateMatchesTaxCode(CF, relativeBirth), false);
    const proposals = groupIdentityProposals(group(
        source('lettera.pdf', { codes: [CF], text: 'Cognome: Sintetica\nNome: Elena' }),
        source('familiare.pdf', { text: `Data di nascita: ${relativeBirth.slice(8)}/${relativeBirth.slice(5, 7)}/${relativeBirth.slice(0, 4)}` }),
    ), 'lettera.pdf');
    assert.deepEqual(proposals.filter((item) => item.field === 'birthDate').map((item) => [item.value, item.sourceName]), [[relativeBirth, 'familiare.pdf']]);
    assert.deepEqual(allIdentityProposals(proposals), {
        values: { taxCode: CF, lastName: 'Sintetica', firstName: 'Elena' }, undecided: ['birthDate'],
    });
    assert.equal(undecidedReason(proposals, 'birthDate'), 'birth-date-not-in-tax-code');
});

test('valori diversi per lo stesso campo hanno il loro motivo, anche per la data di nascita', () => {
    const proposals = groupIdentityProposals(group(
        source('lettera.pdf', { codes: [CF], text: LETTER }),
        source('referto.pdf', { codes: [CF], text: 'Cognome: Sintetico\nData di nascita: 02/01/1980' }),
    ), 'lettera.pdf');
    assert.equal(undecidedReason(proposals, 'lastName'), 'different-values');
    assert.equal(undecidedReason(proposals, 'birthDate'), 'different-values');
});

test('senza codice fiscale la data di nascita proposta non si confronta con nulla', () => {
    const proposals = groupIdentityProposals(group(source('lettera.pdf', { text: 'Cognome: Sintetica\nData di nascita: 03/02/1950' })), 'lettera.pdf');
    assert.deepEqual(allIdentityProposals(proposals), { values: { lastName: 'Sintetica', birthDate: '1950-02-03' }, undecided: [] });
});

test('i documenti esclusi o illeggibili non propongono anagrafica', () => {
    const proposals = groupIdentityProposals(group(
        source('lettera.pdf', { codes: [CF], text: LETTER }),
        source('escluso.pdf', { status: 'excluded', text: 'Cognome: Diversa' }),
    ), 'lettera.pdf');
    assert.equal(allIdentityProposals(proposals).undecided.length, 0);
    assert.equal(proposals.some((item) => item.sourceName === 'escluso.pdf'), false);
});
