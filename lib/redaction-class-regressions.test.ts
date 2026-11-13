import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createRedactionSession } from './ai-redaction-session';
import { clinicalIdentifierSpans } from './chat-card/clinical-identifiers';
import { scoreAnnotations, validateCorpus } from '../scripts/measure-cb-redaction';

const original = validateCorpus(JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/cb-redaction-acceptance.json', import.meta.url), 'utf8')));
const reserve = validateCorpus(JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/cb-redaction-reserve.json', import.meta.url), 'utf8')));
const originals: Record<string, string> = { cf_separato: 'cf-04', cf_multilinea: 'cf-06', luogo_narrativo: 'luogo-04',
    luogo_chiave_ignota: 'ignoto-02', identificatore_composto: 'ignoto-04', email_dettata: 'contatto-02', telefono_dettato: 'contatto-03' };

for (const [defectClass, originalId] of Object.entries(originals)) test(`C-B class regression: ${defectClass}`, () => {
    const variants = reserve.cases.filter(entry => (entry as typeof entry & { defectClass: string; contextLimit?: string }).defectClass === defectClass
        && !(entry as typeof entry & { contextLimit?: string }).contextLimit);
    assert.ok(variants.length >= 3);
    for (const entry of [original.cases.find(entry => entry.id === originalId)!, ...variants]) {
        const session = createRedactionSession();
        try {
            const prepared = session.prepare({ text: entry.inputText, entities: [] });
            assert.deepEqual(scoreAnnotations(entry.inputText, entry.expected, prepared.spans).filter(e => !e.stopped), [], entry.id);
            assert.equal(prepared.rehydrate(prepared.redactedText), entry.inputText);
            if (defectClass === 'luogo_narrativo') {
                const spans = clinicalIdentifierSpans(entry.inputText, { names: [], birthDates: [] });
                assert.ok(spans.length, `${entry.id}: clinical card must refuse the location without neural help`);
            }
        } finally { session.close(); }
    }
});

test('C-B additional rules preserve every original and reserve clinical control without neural spans', () => {
    for (const entry of [...original.cases, ...reserve.cases].filter(entry => entry.preserveText)) {
        const session = createRedactionSession();
        try { assert.equal(session.prepare({ text: entry.inputText, entities: [] }).redactedText, entry.inputText, entry.id); }
        finally { session.close(); }
    }
});

test('C-B place context redacts its clause and preserves the clinical clause after it', () => {
    const text = 'Vive a Valle di Prova; metformina 500 mg al giorno.';
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text, entities: [] });
        assert.ok(!prepared.redactedText.includes('Valle di Prova'));
        assert.ok(prepared.redactedText.endsWith('; metformina 500 mg al giorno.'));
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
    } finally { session.close(); }
});

test('C-B geographic JSON classification leaves clinical keys and values intact', () => {
    const text = '{"HbA1c":"7,2%","terapia":"metformina 500 mg","diagnosi":"Ipertensione arteriosa"}';
    const session = createRedactionSession();
    try { assert.equal(session.prepare({ text, entities: [] }).redactedText, text); }
    finally { session.close(); }
});

test('C-B geographic key/value context works inside a larger source batch', () => {
    const text = 'Testo importato\n␞\n{"Borgo di Test":"provenienza"}\n␞\nMetformina 500 mg.';
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text, entities: [] });
        assert.ok(!prepared.redactedText.includes('Borgo di Test'));
        assert.ok(prepared.redactedText.endsWith('Metformina 500 mg.'));
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
    } finally { session.close(); }
});
