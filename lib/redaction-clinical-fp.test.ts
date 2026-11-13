import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createRedactionSession } from './ai-redaction-session';
import { clinicalIdentifierSpans } from './chat-card/clinical-identifiers';
import { measureClinicalFalsePositives } from '../scripts/measure-cb-clinical-fp';

const challenge = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/cb-clinical-challenge.json', import.meta.url), 'utf8'));
const group = (categories: string[]) => challenge.entries.filter((e: { category: string }) => categories.includes(e.category));
const measurement = measureClinicalFalsePositives();
const observed = JSON.parse(fs.readFileSync(new URL('../docs/quality/cb-clinical-fp-20261113-before.json', import.meta.url), 'utf8'));

test('C-B review P1: ordinary sixteen-letter clinical observations are never tax codes', () => {
    for (const entry of group(['tax-prose'])) {
        const session = createRedactionSession();
        try { assert.equal(session.prepare({ text: entry.text, entities: [] }).redactedText, entry.text); }
        finally { session.close(); }
        assert.deepEqual(clinicalIdentifierSpans(entry.text, { names: [], birthDates: [] }), []);
    }
});

test('C-B review P2: geographic spans stop before coordinated clinical statements', () => {
    for (const entry of group(['place-coordination'])) {
        const session = createRedactionSession();
        try {
            const prepared = session.prepare({ text: entry.text, entities: [] });
            assert.equal(prepared.spans.length, 1);
            assert.deepEqual(prepared.spans.map(s => ({ start: s.start, end: s.end })),
                entry.expectedIdentifiers.map(({ start, end }: { start: number; end: number }) => ({ start, end })));
            assert.equal(prepared.rehydrate(prepared.redactedText), entry.text);
        } finally { session.close(); }
    }
});

for (const [label, categories] of [
    ['clinical number sequences', ['spoken-sequence', 'dosage']],
    ['care departments and clinical context', ['department', 'clinical-context']],
    ['clinical imported values', ['imported-key']],
] as const) test(`C-B preserves ${label} without neural entities`, () => {
    for (const entry of group([...categories])) {
        const session = createRedactionSession();
        try { assert.equal(session.prepare({ text: entry.text, entities: [] }).redactedText, entry.text, entry.id); }
        finally { session.close(); }
    }
});

test('C-B frozen clinical corpus never exceeds its declared new-word deletion budget', async () => {
    const budget = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/cb-clinical-fp-budget.json', import.meta.url), 'utf8'));
    const report = await measurement;
    for (const set of report.sets) {
        assert.equal(set.corpusSha256, budget.corpora[set.name].sha256);
        assert.ok(set.newlyRemovedClinicalWords <= budget.corpora[set.name].maximumNewClinicalWords,
            `${set.name}: ${set.newlyRemovedClinicalWords} clinical words removed`);
        const corpus = JSON.parse(fs.readFileSync(new URL(`../scripts/fixtures/${set.name}.json`, import.meta.url), 'utf8'));
        for (const row of set.results) {
            const identifiers = corpus.entries.find((e: { id: string }) => e.id === row.id).expectedIdentifiers ?? [];
            for (const span of row.newSpans) for (let i = span.start; i < span.end; i++) {
                // Also protect doses/numeric values, which are not letter-first words.
                assert.ok(/\s/u.test(row.text[i]) || identifiers.some((r: { start: number; end: number }) => r.start <= i && i < r.end),
                    `${row.id}: unannotated clinical character removed at ${i}`);
            }
        }
    }
});

for (const set of observed.sets) for (const entry of set.results) {
    if (!entry.newSpans.some((span: { classification: string }) => span.classification === 'false_positive')) continue;
    test(`C-B observed false positive preserves all clinical words: ${entry.id}`, async () => {
        const report = await measurement;
        const actual = report.sets.find(s => s.name === set.name)!.results.find(r => r.id === entry.id)!;
        assert.equal(actual.newlyRemovedClinicalWords.length, 0, entry.text);
    });
}
