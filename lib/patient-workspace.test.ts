import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { stripMarkdownMarks } from './clinical-rich-text';
import { clinicalEntryTypeLabel, formatWorkspaceDate, mapCheckupsForKree8, type Kree8CheckupSource, type Kree8Patient } from './patient-workspace';

/* The agenda keyed its rows on `time + title`, and the row type did not
   carry the checkup id at all. Two patients seen at the same hour for the same
   reason — an ordinary morning in a clinic — produced one key, and React's
   documented behaviour for duplicate keys is that children may be duplicated or
   omitted. An appointment silently missing from a clinical agenda is not a
   rendering detail, so identity is asserted here rather than left to review. */

const inTwoHours = () => {
    const date = new Date();
    date.setHours(date.getHours() + 2, 0, 0, 0);
    return date;
};

function patient(id: string, name: string): Kree8Patient {
    return { id, name, code: `CF-${id}` } as Kree8Patient;
}

function checkup(id: string, patientId: string, date: Date): Kree8CheckupSource {
    return { id, patientId, date, title: 'Controllo', status: 'pending' };
}

test('due appuntamenti identici per ora e titolo restano due righe distinte', () => {
    const when = inTwoHours();
    const rows = mapCheckupsForKree8(
        [checkup('checkup-a', 'p1', when), checkup('checkup-b', 'p2', when)],
        [patient('p1', 'Anna Rossi'), patient('p2', 'Marco Bianchi')],
    );

    assert.equal(rows.length, 2, 'nessuna riga deve sparire');
    assert.deepEqual(rows.map((row) => row.id), ['checkup-a', 'checkup-b']);

    // The property that matters: the keys the list renders with are distinct.
    assert.equal(new Set(rows.map((row) => row.id)).size, 2);
    // And the old key would not have been. This is what the test is guarding.
    assert.equal(new Set(rows.map((row) => row.time + row.title)).size, 1);
});

test("l'identificatore della riga e quello del controllo, non un indice", () => {
    const rows = mapCheckupsForKree8(
        [checkup('checkup-xyz', 'p1', inTwoHours())],
        [patient('p1', 'Anna Rossi')],
    );
    assert.equal(rows[0].id, 'checkup-xyz');
});

test('il filtro Manuali raggiunge il settimo appuntamento prima del limite di sei righe', () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const input = [
        ...Array.from({ length: 6 }, (_, index) => checkup(`today-${index}`, 'p1', today)),
        checkup('tomorrow-seventh', 'p1', tomorrow),
    ];
    const before = structuredClone(input);
    const visible = mapCheckupsForKree8(input, [patient('p1', 'Persona inventata')], 'manual')
        .filter(row => row.filterCategory === 'manual');
    assert.deepEqual(visible.map(row => row.id), ['tomorrow-seventh']);
    assert.equal(mapCheckupsForKree8(input, []).length, 6);
    assert.deepEqual(input, before);
});

const diarySource = ts.createSourceFile('cockpit-shared.tsx', readFileSync(new URL('../components/kree8/cockpit-shared.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const diaryFunctions = ['metadataRecord', 'firstText', 'entryPresentation', 'compactClinicalText', 'buildGlobalDiaryState'];
const declarations = diaryFunctions.map(name => {
    const declaration = diarySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing production helper ${name}`);
    return declaration.getText(diarySource);
}).join('\n');
const buildDiary = runInNewContext(ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nbuildGlobalDiaryState;',
    { stripMarkdownMarks, clinicalEntryTypeLabel, formatWorkspaceDate }) as (entries: { id: string; patientId: string; date: unknown; content: string }[], patients: Kree8Patient[]) => { entries: { monthLabel: string; dateLabel: string }[] };

for (const [label, date] of [['invalid', 'not-a-date'], ['null', null], ['absent', undefined]] as const) {
    test(`global diary month remains readable for ${label} date`, () => {
        const state = buildDiary([{ id: 'invented-entry', patientId: 'invented-patient', date, content: 'Invented software fixture.' }], []);
        assert.equal(state.entries[0].monthLabel, 'Voci recenti');
        assert.equal(state.entries[0].dateLabel, 'n/d');
    });
}

test('global diary preserves the valid date month', () => {
    const state = buildDiary([{ id: 'invented-entry', patientId: 'invented-patient', date: '2026-10-15T12:00:00.000Z', content: 'Invented software fixture.' }], []);
    assert.equal(state.entries[0].monthLabel, 'ottobre 2026');
    assert.notEqual(state.entries[0].dateLabel, 'n/d');
});
