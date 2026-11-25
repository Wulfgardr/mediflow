import assert from 'node:assert/strict';
import test from 'node:test';

import type { DossierDraftGroup, DossierDraftSource, DossierPatient } from './document-dossier-session';
import { loneDocumentImage, newPatientDossierStart } from './dossier-new-patient-entry';
import { isValidItalianTaxCode } from './patient-identity';
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
