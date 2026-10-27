import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { stripMarkdownMarks } from './clinical-rich-text';
import { clinicalEntryTypeLabel, formatWorkspaceDate, type Kree8Patient } from './patient-workspace';

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
