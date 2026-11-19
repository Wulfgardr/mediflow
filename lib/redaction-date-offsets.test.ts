import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedactionSession, type RedactionSessionEntity } from './ai-redaction-session';
import { birthDateDays, clinicalDateDay, dayFromOffset, formatDay } from './redaction-date-offsets';

const date = (text: string, value: string, type: RedactionSessionEntity['type'] = 'date'): RedactionSessionEntity => {
    const start = text.indexOf(value);
    return { type, start, end: start + value.length, text: value, confidence: 1 };
};
const offsets = (text: string) => [...text.matchAll(/\[\[MF_GG([+-][0-9]+)_[a-z2-7]{8}\]\]/gu)].map(match => Number(match[1]));

test('every Layer 1 date spelling becomes an offset that keeps intervals and restores its own spelling', () => {
    const text = 'Visita 12/03/2026, controllo 22.03.2026, esami 01-04-2026, poi di nuovo il 12/03/2026.';
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text, entities: [date(text, 'il 12/03/2026')] });
        for (const value of ['12/03/2026', '22.03.2026', '01-04-2026']) assert.ok(!prepared.redactedText.includes(value), value);
        const [first, second, third, again] = offsets(prepared.redactedText);
        assert.deepEqual([second - first, third - first, again], [10, 20, first]);
        assert.match(prepared.redactedText, / il \[\[MF_GG/u);
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
        assert.deepEqual(prepared.entityCounts, { date: 4 });
    } finally { session.close(); }
});

test('birth dates, from the registry in any format or after a birth cue, leave as NAS placeholders', () => {
    const session = createRedactionSession();
    try {
        const text = 'Data 17/04/1972. Il padre, nato il 03/02/1940, accompagna. Visita 12/03/2026.';
        const prepared = session.prepare({ text, entities: [], knownIdentifiers: { birthDates: ['1972-04-17'] } });
        assert.match(prepared.redactedText, /^Data \[\[MF_NAS1_[a-z2-7]{8}\]\]\. Il padre, nato il \[\[MF_NAS2_[a-z2-7]{8}\]\], accompagna\. Visita \[\[MF_GG[+-][0-9]+_[a-z2-7]{8}\]\]\.$/u);
        assert.equal(offsets(prepared.redactedText).length, 1);
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
        assert.match(session.prepare({ text: 'Controllo 05/05/1950.', entities: [] }).redactedText, /^Controllo \[\[MF_DAT1_/u);
        assert.match(session.prepare({ text: 'Data di nascita 05/05/1950.', entities: [] }).redactedText, /^Data di nascita \[\[MF_DAT1_/u);
        session.prepare({ text: 'Controllo 05/05/2025.', entities: [] });
        assert.throws(() => session.prepare({ text: 'Data di nascita 05/05/2025.', entities: [] }), /birth date already offset/u);
    } finally { session.close(); }
});

test('dates outside the Layer 1 grammar or the offset range stay DAT placeholders', () => {
    const session = createRedactionSession();
    try {
        const text = 'Visita 12/03/2026, ricovero 3 marzo 2026, nota del 31/02/2026, archivio 01/01/1901.';
        const prepared = session.prepare({ text, entities: [date(text, '3 marzo 2026'), date(text, '31/02/2026')] });
        assert.equal(offsets(prepared.redactedText).length, 1);
        assert.equal(prepared.redactedText.match(/\[\[MF_DAT[0-9]+_/gu)?.length, 3);
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
    } finally { session.close(); }
});

test('resolve computes new offsets from the session anchor and refuses foreign or unbounded ones', () => {
    const session = createRedactionSession(), other = createRedactionSession();
    try {
        const prepared = session.prepare({ text: 'Visita 12/03/2026.', entities: [] });
        const [visit] = offsets(prepared.redactedText);
        const placeholder = prepared.redactedText.slice(7, -1);
        const shifted = (offset: number) => placeholder.replace(/GG[+-][0-9]+_/u, `GG${offset < 0 ? '-' : '+'}${Math.abs(offset)}_`);
        assert.deepEqual(session.resolve(placeholder), { role: 'GG', value: '12/03/2026' });
        assert.deepEqual(session.resolve(shifted(visit + 1)), { role: 'GG', value: '13/03/2026' });
        assert.throws(() => session.resolve(shifted(36_526)));
        assert.throws(() => other.resolve(placeholder));
        const empty = createRedactionSession();
        try { assert.throws(() => empty.resolve(placeholder.replace(/_[a-z2-7]{8}\]\]$/u, '_aaaaaaaa]]'))); } finally { empty.close(); }
        session.close();
        assert.throws(() => session.resolve(placeholder), /closed/u);
        assert.throws(() => prepared.rehydrate(placeholder), /closed/u);
    } finally { session.close(); other.close(); }
});

test('date arithmetic stays inside the calendar and the supported century', () => {
    assert.equal(clinicalDateDay('29/02/2024') !== null, true);
    assert.equal(clinicalDateDay('29/02/2025'), null);
    assert.equal(clinicalDateDay('12/03/1899'), null);
    assert.deepEqual([...birthDateDays(['1972-04-17', ' 17.04.1972 ', 'aprile 1972'])], [clinicalDateDay('17/04/1972')]);
    const anchor = clinicalDateDay('01/01/2000')!;
    assert.equal(formatDay(dayFromOffset(anchor, -1)!), '31/12/1999');
    assert.equal(dayFromOffset(anchor, 36_526), null);
    assert.equal(dayFromOffset(anchor, 0.5), null);
    assert.equal(dayFromOffset(clinicalDateDay('31/12/2099')!, 1), null);
});

const ROLE_OR_OFFSET = /\[\[MF_(?:([A-Z]+)[0-9]+|GG([+-][0-9]+))_[a-z2-7]{8}\]\]/gu;
const placeholders = (text: string) => [...text.matchAll(ROLE_OR_OFFSET)].map((match): string | number => (match[1] as string | undefined) ?? Number(match[2]));

test('an uncued birth date without registry never leaves as an offset, and clinical intervals survive', () => {
    for (const text of [
        'Paziente nata a Sesto San Giovanni (MI) il 14/02/1948. Visita del 03/11/2026, controllo il 10/11/2026.',
        'Data di nascita\n14/02/1948\nVisita 03/11/2026, controllo il 10/11/2026.',
        'Bianchi Lucia 14/02/1948 F. Visita 03/11/2026, controllo il 10/11/2026.',
    ]) {
        const session = createRedactionSession();
        try {
            const prepared = session.prepare({ text, entities: [] });
            assert.ok(!prepared.redactedText.includes('14/02/1948'), text);
            const [birth, visit, control] = placeholders(prepared.redactedText);
            assert.equal(typeof birth, 'string', text);
            assert.ok(birth === 'DAT' || birth === 'NAS', text);
            assert.equal((control as number) - (visit as number), 7, text);
            assert.equal(prepared.rehydrate(prepared.redactedText), text);
        } finally { session.close(); }
    }
});

test('the clinical window follows the most recent date, not the order of appearance, and later texts outside it stay DAT', () => {
    const session = createRedactionSession();
    try {
        const first = session.prepare({ text: 'Ricovero 20/06/2023, esame 03/11/2026, controllo futuro 03/05/2027, vecchio intervento 01/01/2019.', entities: [] });
        const [admission, exam, followUp, old] = placeholders(first.redactedText);
        assert.deepEqual([exam as number - (admission as number), followUp as number - (exam as number), old], [1232, 181, 'DAT']);
        const later = session.prepare({ text: 'Nota senza richiamo 14/02/1948, visita 10/11/2026, scadenza 01/01/2030.', entities: [] });
        const [uncued, visit, far] = placeholders(later.redactedText);
        assert.deepEqual([uncued, visit as number - (exam as number), far], ['DAT', 7, 'DAT']);
    } finally { session.close(); }
});

test('a birth date written in ISO form leaves as NAS, from the registry or after a birth cue, and never as DAT', () => {
    const known = 'Data di nascita 1972-04-17. Visita 03/11/2026.';
    const session = createRedactionSession();
    const prepared = session.prepare({ text: known, entities: [], knownIdentifiers: { birthDates: ['1972-04-17'] } });
    assert.match(prepared.redactedText, /^Data di nascita \[\[MF_NAS1_[a-z2-7]{8}\]\]\. Visita \[\[MF_GG[+-][0-9]+_[a-z2-7]{8}\]\]\.$/u);
    assert.equal(prepared.rehydrate(prepared.redactedText), known);
    session.close();
    const uncued = 'Paziente del 1972-04-17, controllo 03/11/2026.';
    const other = createRedactionSession();
    const registry = other.prepare({ text: uncued, entities: [], knownIdentifiers: { birthDates: ['17/04/1972'] } });
    assert.match(registry.redactedText, /^Paziente del \[\[MF_NAS1_/u);
    other.close();
    const cued = 'Nata il 1972-04-17 a Milano.';
    const neural = createRedactionSession();
    const detected = neural.prepare({ text: cued, entities: [date(cued, '1972-04-17')] });
    assert.match(detected.redactedText, /^Nata il \[\[MF_NAS1_/u);
    assert.doesNotMatch(detected.redactedText, /MF_DAT/u);
    neural.close();
});
