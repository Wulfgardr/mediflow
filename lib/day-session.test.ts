import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daySessionCandidates, readDaySession } from './day-session';
import { openDaySession, recordDaySessionDecision, replaceDaySession } from './day-session-storage';

const taxCode = 'RSSMRA80A01F205X';
const correct = { id: 'matched', firstName: 'Lina', lastName: 'Esempia', taxCode, birthDate: new Date('1980-01-01') };
const homonym = { ...correct, id: 'homonym', taxCode: '', birthDate: new Date('1985-01-01') };
const start = 1795593600;
const manifest = { versione: 2, visita: 'V01', seduta: 'S01', tratto: 1, stato: 'CF da confermare', cf: null, aperta_epoch: start, chiusa_epoch: start + 60 };
const file = (name: string, data: unknown) => {
    const source = new File([typeof data === 'string' ? data : JSON.stringify(data)], name.split('/').at(-1)!);
    Object.defineProperty(source, 'webkitRelativePath', { value: `ambulatorio-20261125/${name}` });
    return source;
};
const visitFiles = (values: Record<string, unknown>, text: string) => [file('V01/manifest.json', { ...manifest, ...values }), file('V01/trascrizione.txt', text)];

test('prioritizes independent local clues and keeps homonyms and conflicting dates distinct', async () => {
    const [row] = await readDaySession(visitFiles({ cf_dettato_parziale: 'RSSMRA' }, 'Lìna Esempia, controllo.'));
    const ranked = daySessionCandidates(row, [homonym, correct, { ...correct, id: 'archived', isArchived: true }]);
    assert.deepEqual(ranked.map(value => value.patient.id), ['matched', 'homonym']);
    assert.ok(ranked[0].score > ranked[1].score);
    assert.deepEqual(ranked[0].reasons, ['Nome e cognome nel dettato', 'Inizio del codice fiscale compatibile']);

    const [dateOnly] = await readDaySession(visitFiles({}, 'Lina Esempia, nata il 01/01/1980.'));
    assert.deepEqual(daySessionCandidates(dateOnly, [homonym, correct]).map(value => value.patient.id), ['matched']);
    const [missing] = await readDaySession(visitFiles({}, 'Richiamo senza dati.'));
    assert.deepEqual(daySessionCandidates(missing, [homonym, correct]), []);
    const [badCheck] = await readDaySession(visitFiles({ cf_dettato_parziale: 'RSSMRA' }, 'Richiamo senza nome.'));
    assert.deepEqual(daySessionCandidates(badCheck, [{ ...correct, taxCode: `${taxCode.slice(0, -1)}Y` }]), []);
});

test('uses a PDF within the source window and excludes prescriber codes', async () => {
    const pdf = { origine: '/synthetic/ricetta.pdf', mtime: start - 20, esito: 'candidato', cf_presenti: [taxCode], promemoria: true };
    const [near] = await readDaySession(visitFiles({ pdf_da_epoch: start - 20, pdf: [pdf] }, 'Richiamo senza nome.'));
    assert.deepEqual(daySessionCandidates(near, [correct]).map(value => value.reasons), [['Codice fiscale in un PDF vicino']]);
    const [far] = await readDaySession(visitFiles({ pdf: [pdf] }, 'Richiamo senza nome.'));
    const [prescriber] = await readDaySession(visitFiles({ pdf_da_epoch: start - 20, pdf: [{ ...pdf, cf_medico: [taxCode] }] }, 'Richiamo senza nome.'));
    assert.deepEqual(daySessionCandidates(far, [correct]), []);
    assert.deepEqual(daySessionCandidates(prescriber, [correct]), []);
});

test('quarantines speech overlapping a third-party segment and retains its separate source reference', async () => {
    const rows = await readDaySession([
        ...visitFiles({}, 'Lina Esempia citata da una terza persona.'),
        file('S01/seduta.json', { seduta: 'S01', tratti_terzi: [{ id: 'T01', stato: 'proposto', inizio_epoch: start + 5, fine_epoch: start + 15 }] }),
    ]);
    assert.deepEqual(rows.map(row => [row.source, row.type, row.text]), [['S01 · T01', 'third', ''], ['S01 · Tratto 1 · V01', 'visit', '']]);
    assert.deepEqual(rows.flatMap(row => daySessionCandidates(row, [correct])), []);
    assert.throws(() => recordDaySessionDecision(rows, rows[0], { kind: 'linked', patientId: correct.id }), /entry changed/u);
});

test('retains only decisions for unchanged evidence on reimport and rejects stale or repeated decisions', async () => {
    const previous = await readDaySession(visitFiles({}, 'Lina Esempia, controllo.'));
    const linked = recordDaySessionDecision(previous, previous[0], { kind: 'linked', patientId: correct.id });
    assert.deepEqual(replaceDaySession(linked, await readDaySession(visitFiles({}, 'Lina Esempia, controllo.'))), linked);
    assert.throws(() => recordDaySessionDecision(linked, previous[0], { kind: 'discarded' }), /entry changed/u);
    const edited = replaceDaySession(linked, await readDaySession(visitFiles({}, 'Altra voce dal kit.')));
    assert.equal(edited[0].decision, null);
    assert.throws(() => recordDaySessionDecision(edited, previous[0], { kind: 'discarded' }), /entry changed/u);
    const cipher = { sealLocalDraft: async () => '', openLocalDraft: async () => ({ archive: 'original', user: 'operator', entries: linked }) };
    assert.deepEqual(await openDaySession({ archive: 'original', user: 'operator' }, 'ciphertext', cipher), linked);
    await assert.rejects(openDaySession({ archive: 'different', user: 'operator' }, 'ciphertext', cipher), /scope mismatch/u);
});
