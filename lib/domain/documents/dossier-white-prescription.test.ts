import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { collectDossierTaxCodes, evaluateDossierGroupIdentity } from './dossier-import';
import { resolveDocumentTaxCodeRoles } from './document-identity-resolution';
import { DOSSIER_PREPARED_SCHEMA } from './dossier-prepared';

const PRESCRIPTION_PATIENT_CF = 'TSTTST00A01A000W';
const PRESCRIPTION_DOCTOR_CF = 'MEDPRS00A01A000W';
const FOREIGN_CF = 'OPRTST00A01A000K';
const WHITE_PRESCRIPTION_HEADER = 'Prescrizione di farmaci non a carico del SSN - Ricetta Bianca Elettronica - Promemoria per il paziente';
const WHITE_PRESCRIPTION_TEXT = [
    WHITE_PRESCRIPTION_HEADER,
    'NRBE            CODICE FISCALE PAZIENTE            PIN-NRBE',
    `                ${PRESCRIPTION_PATIENT_CF}                   00000`,
    'E00000000000',
    'COGNOME E NOME DEL PAZIENTE: PAZIENTE SINTETICO',
    "INDIRIZZO: Via di Prova 1 CAP: 00000 CITTA': Citta di Prova PROV: XX",
    'PRESCRIZIONE: 000000000 - FARMACO SINTETICO*CONFEZIONE QTA: 1',
    'POSOLOGIA:            TDL: No',
    'NOTE DEL MEDICO:',
    'PREPARAZIONE FARMACEUTICA:',
    'DURATA TRATTAMENTO:          MODALITA IMPIEGO:',
    'QUESITO DIAGNOSTICO:',
    'COGNOME E NOME DEL MEDICO: MEDICO SINTETICO             CODICE FISCALE',
    'INDIRIZZO DELLO STUDIO E NUMERO DI TELEFONO: Via di Prova 100',
    'Citta di Prova XX, tel. 0000000000',
    `SPECIALIZZAZIONE: Continuita assistenziale              ${PRESCRIPTION_DOCTOR_CF}`,
    '                         N. ISCRIZIONE ALBO: 00000',
    'DATA COMPILAZIONE: 23/11/2026   Rilasciata ai sensi del DM del 30 dicembre 2020   Pagina 1 di 1',
].join('\n');

const WHITE_PRESCRIPTION_LAYOUT_TEXT = WHITE_PRESCRIPTION_TEXT.split('\n')
    .map((line, index) => (index === 0 ? '          ' + line : line).replace('tel. 0000000000', 'tel.0000000000'))
    .join('\n\n');

function verifyPrescription(text: string) {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const sha256 = createHash('sha256').update(text).digest('hex');
    const input = JSON.stringify({
        cf: PRESCRIPTION_PATIENT_CF,
        physicianCodes: [],
        files: [{ sha256, text }],
        extraction: {
            schema: DOSSIER_PREPARED_SCHEMA,
            sources: [{
                sha256,
                fileName: 'ricetta-sintetica.pdf',
                patient: { taxCode: PRESCRIPTION_PATIENT_CF },
                facts: [],
                coverage: { pages: 1, unreadablePages: [], complete: true },
            }],
        },
    });
    return spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'plugins/mediflow-ambulatorio/verify.mjs', repo], {
        cwd: repo, input, encoding: 'utf8',
    });
}

test('WUL-950: the Dossier verifier accepts a white electronic prescription with the physician CF in a separate column', () => {
    const run = verifyPrescription(WHITE_PRESCRIPTION_TEXT);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { verified: 0, approximate: 0, rifiutati: 0, motivi: [] });
});

test('WUL-950: the layout text with blank lines inside the prescriber block is still accepted', () => {
    const run = verifyPrescription(WHITE_PRESCRIPTION_LAYOUT_TEXT);
    assert.equal(run.status, 0, run.stderr);
    const { taxCodes } = resolveDocumentTaxCodeRoles({ text: WHITE_PRESCRIPTION_LAYOUT_TEXT });
    assert.deepEqual(taxCodes.map(({ value, role }) => [value, role]), [
        [PRESCRIPTION_PATIENT_CF, 'patient_cf'],
        [PRESCRIPTION_DOCTOR_CF, 'prescriber_cf'],
    ]);
});

test('WUL-950: the patient and prescriber have separate high-confidence CFs', () => {
    const text = 'Copertina sintetica\r\n\f' + WHITE_PRESCRIPTION_TEXT.replaceAll('\n', '\r\n') + '\f';
    const { taxCodes, humanRequired, evidenceRefs } = resolveDocumentTaxCodeRoles({ text });
    assert.deepEqual(taxCodes.map(({ value, role, confidence }) => [value, role, confidence]), [
        [PRESCRIPTION_PATIENT_CF, 'patient_cf', 'high'],
        [PRESCRIPTION_DOCTOR_CF, 'prescriber_cf', 'high'],
    ]);
    assert.equal(humanRequired, false);
    assert.match(evidenceRefs[1].snippet, /COGNOME E NOME DEL MEDICO.*CODICE FISCALE.*SPECIALIZZAZIONE/u);

    const document = { taxCodes: collectDossierTaxCodes(WHITE_PRESCRIPTION_TEXT) };
    assert.deepEqual(document.taxCodes.map(({ role }) => role), ['patient_cf', 'professional_cf']);
    const matches = evaluateDossierGroupIdentity([document], [{ id: 'synthetic', taxCode: PRESCRIPTION_PATIENT_CF }], 'synthetic');
    assert.deepEqual([matches.status, matches.blocking], ['matched', false]);
    const wrongPatient = evaluateDossierGroupIdentity([document], [{ id: 'other', taxCode: FOREIGN_CF }], 'other');
    assert.deepEqual([wrongPatient.status, wrongPatient.blocking], ['discordant', true]);
});

test('WUL-950: the Dossier verifier still rejects foreign and ambiguous CFs', () => {
    const cases = [
        WHITE_PRESCRIPTION_TEXT.replace(WHITE_PRESCRIPTION_HEADER, 'Referto sintetico'),
        WHITE_PRESCRIPTION_TEXT.replace(WHITE_PRESCRIPTION_HEADER, 'Referto che cita la Ricetta Bianca Elettronica'),
        WHITE_PRESCRIPTION_TEXT.replace('Citta di Prova XX,', '\fCitta di Prova XX,'),
        WHITE_PRESCRIPTION_TEXT.replace(PRESCRIPTION_DOCTOR_CF, `${PRESCRIPTION_DOCTOR_CF}   ${FOREIGN_CF}`),
        WHITE_PRESCRIPTION_TEXT.replace(PRESCRIPTION_DOCTOR_CF, 'MEDPRS00A01A000A'),
        `${WHITE_PRESCRIPTION_TEXT}\nDati aggiuntivi:\n${FOREIGN_CF}`,
        `${WHITE_PRESCRIPTION_TEXT}\nDati aggiuntivi:\n${PRESCRIPTION_DOCTOR_CF}`,
    ];
    for (const text of cases) {
        const run = verifyPrescription(text);
        assert.equal(run.status, 1, run.stderr || run.stdout);
        assert.match(run.stderr, /CF estraneo o ambiguo nel PDF/u);
        const roles = resolveDocumentTaxCodeRoles({ text }).taxCodes;
        assert.ok(roles.some(({ value, role }) => value !== PRESCRIPTION_PATIENT_CF && role === 'unknown_cf'));
    }
});

test('WUL-950: the Dossier verifier still accepts an SSN electronic prescription', () => {
    const text = [
        'Promemoria della ricetta elettronica SSN',
        'NRE: 0000A0000000000',
        `CODICE FISCALE ASSISTITO: ${PRESCRIPTION_PATIENT_CF}`,
        'PRESCRIZIONE: FARMACO SINTETICO',
        `CODICE FISCALE MEDICO PRESCRITTORE: ${PRESCRIPTION_DOCTOR_CF}`,
    ].join('\n');
    const run = verifyPrescription(text);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(resolveDocumentTaxCodeRoles({ text }).taxCodes.map(({ role }) => role), ['patient_cf', 'prescriber_cf']);
});
