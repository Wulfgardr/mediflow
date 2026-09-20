/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedactionSession } from './ai-redaction-session';
import type { RedactionSessionEntity, RedactionSessionInput } from './ai-redaction-session';
import { evaluateEgress, isEgressGateOpen } from './ai-egress-gate';

function entity(text: string, value: string, type: RedactionSessionEntity['type'] = 'person'): RedactionSessionEntity {
    const start = text.indexOf(value);
    return Object.freeze({ type, start, end: start + value.length, text: value, confidence: 0 });
}

test('composes mandatory Layer 1 and readonly neural spans on original UTF16 text', () => {
    const text = '😀 Ada Sintetica: test@example.invalid, 12/03/2001, +39 347 123 4567; Via Fittizia.';
    const session = createRedactionSession();
    const prepared = session.prepare({ text, entities: Object.freeze([
        entity(text, 'Via Fittizia', 'address'),
    ]), knownIdentifiers: Object.freeze({ names: Object.freeze(['Ada Sintetica']) }) });
    assert.deepEqual(prepared.entityCounts, { person: 1, email: 1, date: 1, phone: 1, address: 1 });
    assert.equal(prepared.rehydrate(prepared.redactedText), text);
    assert.match(prepared.redactedText, /^😀 \{\{MF_PII_[a-f0-9]{32}_1\}\}:/);
    for (const value of ['Ada Sintetica', 'test@example.invalid', 'Via Fittizia', '12/03/2001']) {
        assert.ok(!prepared.redactedText.includes(value));
        assert.ok(!JSON.stringify(prepared).includes(value));
    }
    assert.ok(Object.isFrozen(prepared));
    assert.ok(Object.isFrozen(prepared.entityCounts));
    assert.ok(Object.isFrozen(prepared.spans));
    for (const span of prepared.spans) {
        assert.ok(Object.isFrozen(span));
        assert.deepEqual(Object.keys(span).sort(), ['end', 'replacement', 'start', 'type']);
        assert.equal(prepared.rehydrate(span.replacement), text.slice(span.start, span.end));
    }
    assert.equal('status' in prepared, false);
    assert.equal('allowed' in prepared, false);
    assert.equal(JSON.stringify(session), '{}');
    assert.equal(isEgressGateOpen(), false);
    assert.equal(evaluateEgress({ text, lane: 'clinical' }).status, 'closed_pending_redaction_lane');
    session.close();
});

test('keeps exact raw tokens stable across preparations and types, Unicode spellings and sessions isolated', () => {
    const session = createRedactionSession();
    const prepare = (text: string, type: RedactionSessionEntity['type'] = 'person') =>
        session.prepare({ text, entities: [entity(text, text, type)] });
    const first = prepare('Noé');
    const second = prepare('Noe\u0301', 'organization');
    assert.notEqual(first.redactedText, second.redactedText);
    assert.equal(first.redactedText, prepare('Noé', 'organization').redactedText);
    const bothText = 'Noé Noe\u0301';
    const both = session.prepare({ text: bothText, entities: [entity(bothText, 'Noé'), entity(bothText, 'Noe\u0301')] });
    assert.notEqual(both.spans[0].replacement, both.spans[1].replacement);
    assert.equal(both.spans[0].replacement, first.redactedText);
    assert.equal(both.spans[1].replacement, second.redactedText);
    assert.deepEqual(Buffer.from(both.rehydrate(both.redactedText)), Buffer.from(bothText));
    assert.equal(first.rehydrate(first.redactedText), 'Noé');
    assert.equal(second.rehydrate(second.redactedText), 'Noe\u0301');
    const lower = prepare('noé');
    assert.notEqual(first.redactedText, lower.redactedText);
    const other = createRedactionSession();
    const isolated = other.prepare({ text: 'Noé', entities: [entity('Noé', 'Noé')] });
    assert.notEqual(first.redactedText, isolated.redactedText);
    assert.equal(first.rehydrate(isolated.redactedText), isolated.redactedText);
    session.close(); other.close();
});

test('rejects malformed spans and input before allocating tokens', () => {
    const text = '😀 Ada';
    const good = entity(text, 'Ada');
    const invalidEntities: unknown[] = [
        null, {}, { ...good, type: 'PERSON' }, { ...good, type: 'constructor' },
        { ...good, start: -1 }, { ...good, start: 3.5 }, { ...good, end: 99 },
        { ...good, end: 3 }, { ...good, start: NaN }, { ...good, end: Infinity },
        { ...good, start: 1, end: 2, text: text.slice(1, 2) },
        { ...good, start: 0, end: 1, text: text.slice(0, 1) },
        { ...good, text: 'ada' }, { ...good, confidence: NaN },
        { ...good, confidence: Infinity }, { ...good, confidence: -0.1 },
        { ...good, confidence: 1.1 }, { ...good, confidence: undefined },
        { ...good, confidence: '1' },
    ];
    const session = createRedactionSession();
    for (const invalid of invalidEntities) {
        assert.throws(() => session.prepare({ text, entities: [good, invalid] } as RedactionSessionInput));
    }
    const badInputs: unknown[] = [null, { text: 1, entities: [] },
        { text: 'x'.repeat(12001), entities: [] }, { text, entities: null },
        { text, entities: Array(513).fill(good) }, { text, entities: new Array(1) },
        { text, entities: [good], knownIdentifiers: { names: [4] } },
    ];
    for (const input of badInputs) assert.throws(() => session.prepare(input as RedactionSessionInput));
    const valid = session.prepare({ text, entities: [good, entity(text, '😀', 'other')] });
    assert.match(valid.redactedText, /_1\}\}/);
    assert.match(valid.redactedText, /_2\}\}/);
    assert.equal(valid.rehydrate(valid.redactedText), text);
    assert.doesNotThrow(() => session.prepare({ text: 'x'.repeat(12000), entities: [] }));
    assert.doesNotThrow(() => session.prepare({ text, entities: Array(512).fill({ ...good, confidence: 1 }) }));
    session.close();
});

test('preserves Layer 1 tax specificity and maps other identifiers', () => {
    const text = 'RSSMRA80A01H501U RSSMRA80A01H501A 030AA1234567890 80380123456789012345';
    const session = createRedactionSession();
    const prepared = session.prepare({ text, entities: [entity(text, 'RSSMRA80A01H501U', 'identifier')] });
    assert.deepEqual(prepared.entityCounts, { tax_id: 2, identifier: 2 });
    assert.equal(prepared.rehydrate(prepared.redactedText), text);
    session.close();
});

test('escapes Layer 1 literals and redacts case variants without conflating exact values', () => {
    const text = 'Ada (Demo) ADA (DEMO) Ada XDemoY';
    const session = createRedactionSession();
    const prepared = session.prepare({ text, entities: [], knownIdentifiers: { names: ['Ada (Demo)'] } });
    assert.deepEqual(prepared.entityCounts, { person: 2 });
    assert.ok(prepared.redactedText.endsWith('Ada XDemoY'));
    assert.equal(prepared.rehydrate(prepared.redactedText), text);
    session.close();
});

test('merges duplicate and partial overlaps deterministically, conflicts become other', () => {
    const session = createRedactionSession();
    const text = 'abcdefghij';
    const spans = [entity(text, 'abcde', 'person'), entity(text, 'defgh', 'organization'), entity(text, 'ghij', 'person')];
    for (const entities of [spans, [...spans].reverse()]) {
        const result = session.prepare({ text, entities });
        assert.deepEqual(result.entityCounts, { other: 1 });
        assert.equal(result.rehydrate(result.redactedText), text);
    }
    const duplicate = session.prepare({ text, entities: [entity(text, text), entity(text, text)] });
    assert.deepEqual(duplicate.entityCounts, { person: 1 });
    const conflict = session.prepare({ text, entities: [entity(text, text, 'tax_id'), entity(text, text, 'person')] });
    assert.deepEqual(conflict.entityCounts, { other: 1 });
    session.close();
});

test('joins adjacent addresses only over one to three whitespace/comma characters', () => {
    const session = createRedactionSession();
    for (const [separator, count] of [[' ', 1], [', ', 1], [' ,\t', 1], ['', 2], ['    ', 2], ['; ', 2], [' x ', 2]] as const) {
        const text = `Via Fittizia${separator}Borgo Demo`;
        const prepared = session.prepare({ text, entities: [entity(text, 'Borgo Demo', 'address'), entity(text, 'Via Fittizia', 'address')] });
        assert.deepEqual(prepared.entityCounts, { address: count }, JSON.stringify(separator));
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
    }
    const text = 'Ada Bea';
    assert.deepEqual(session.prepare({ text, entities: [entity(text, 'Ada'), entity(text, 'Bea')] }).entityCounts, { person: 2 });
    session.close();
});

test('namespace collisions fail before mutation and preparations only rehydrate their own tokens', () => {
    const session = createRedactionSession();
    assert.throws(() => session.prepare({ text: 'Ada {{MF_PII_fake', entities: [entity('Ada', 'Ada')] }));
    const first = session.prepare({ text: 'Ada', entities: [entity('Ada', 'Ada')] });
    assert.match(first.redactedText, /_1\}\}$/);
    assert.throws(() => session.prepare({ text: first.redactedText, entities: [] }));
    const second = session.prepare({ text: 'Bea', entities: [entity('Bea', 'Bea')] });
    assert.equal(first.rehydrate(second.redactedText), second.redactedText);
    assert.equal(second.rehydrate(first.redactedText), first.redactedText);
    assert.equal(first.rehydrate(first.redactedText + first.redactedText), 'AdaAda');
    assert.equal(session.prepare({ text: '', entities: [] }).rehydrate(first.redactedText), first.redactedText);
    session.close();
    assert.throws(() => first.rehydrate(first.redactedText), /closed/);
    assert.throws(() => second.rehydrate(''), /closed/);
    assert.throws(() => session.prepare({ text: '', entities: [] }), /closed/);
    assert.doesNotThrow(() => session.close());
});

test('rehydrates replacement metacharacters literally in a single pass', () => {
    const session = createRedactionSession();
    const text = '$& $1 $$ {{PERSONA_1}}';
    const prepared = session.prepare({ text, entities: [entity(text, text, 'other')] });
    assert.equal(prepared.rehydrate(prepared.redactedText), text);
    assert.equal(prepared.rehydrate('prefix ' + prepared.redactedText + ' suffix'), 'prefix ' + text + ' suffix');
    session.close();
});

test('allows 64 preparations, rejects the next and preserves delivered rehydrators until close', () => {
    const session = createRedactionSession();
    const first = session.prepare({ text: 'Ada', entities: [entity('Ada', 'Ada')] });
    for (let index = 1; index < 64; index += 1) session.prepare({ text: '', entities: [] });
    assert.throws(() => session.prepare({ text: '', entities: [] }), /budget/);
    assert.equal(first.rehydrate(first.redactedText), 'Ada');
    session.close();
    assert.throws(() => first.rehydrate(first.redactedText), /closed/);
});

test('4096 unique raw values budget is checked atomically and duplicates remain usable', () => {
    const session = createRedactionSession();
    const batch = (start: number, count: number) => {
        const values = Array.from({ length: count }, (_, index) => `v${(start + index).toString(16)}q`);
        const text = values.join(' ');
        return { text, entities: values.map(value => entity(text, value, 'identifier')) };
    };
    for (let index = 0; index < 7; index += 1) session.prepare(batch(index * 512, 512));
    const prior = session.prepare(batch(3584, 511));
    assert.throws(() => session.prepare(batch(4095, 2)), /budget/);
    const last = session.prepare(batch(4095, 1));
    assert.match(last.redactedText, /_4096\}\}$/);
    assert.throws(() => session.prepare(batch(4096, 1)), /budget/);
    assert.equal(session.prepare(batch(4095, 1)).redactedText, last.redactedText);
    assert.equal(prior.rehydrate(prior.redactedText), batch(3584, 511).text);
    // Rejected preparations consume neither tokens nor preparation slots.
    for (let index = 10; index < 64; index += 1) session.prepare({ text: '', entities: [] });
    assert.throws(() => session.prepare({ text: '', entities: [] }), /budget/);
    session.close();
    assert.throws(() => last.rehydrate(last.redactedText), /closed/);
});

test('bounds known identifier arrays and strings before any session mutation', () => {
    const session = createRedactionSession();
    for (const key of ['names', 'birthDates']) {
        for (const values of [Array(65).fill('Ada'), ['x'.repeat(257)]]) {
            assert.throws(() => session.prepare({ text: 'Ada', entities: [entity('Ada', 'Ada')], knownIdentifiers: { [key]: values } }));
        }
        assert.doesNotThrow(() => session.prepare({ text: '', entities: [], knownIdentifiers: { [key]: Array(64).fill('x'.repeat(256)) } }));
    }
    assert.match(session.prepare({ text: 'Ada', entities: [entity('Ada', 'Ada')] }).redactedText, /_1\}\}$/);
    session.close();
});

test('rejects accessors and proxies at every input layer without invoking hooks or mutating session', () => {
    let hooks = 0;
    const getter = (target: object, key: PropertyKey) => Object.defineProperty(target, key, {
        get() { hooks += 1; throw new Error('getter executed'); }, enumerable: true,
    });
    const proxy = (target: object) => new Proxy(target, {
        get() { hooks += 1; throw new Error('proxy get executed'); },
        ownKeys() { hooks += 1; throw new Error('proxy ownKeys executed'); },
        getOwnPropertyDescriptor() { hooks += 1; throw new Error('proxy descriptor executed'); },
    });
    const good = () => ({ text: 'Ada', entities: [entity('Ada', 'Ada')] });
    const cases: unknown[] = [];
    for (const field of ['text', 'entities', 'knownIdentifiers']) cases.push(getter(good(), field));
    for (const field of ['type', 'start', 'end', 'text', 'confidence']) {
        cases.push({ ...good(), entities: [getter({ ...entity('Ada', 'Ada') }, field)] });
    }
    cases.push(proxy(good()), { ...good(), entities: proxy([]) },
        { ...good(), entities: [proxy({ ...entity('Ada', 'Ada') })] },
        { ...good(), entities: getter([entity('Ada', 'Ada')], '0') },
        { ...good(), entities: getter([], Symbol.iterator) },
        { ...good(), knownIdentifiers: proxy({}) });
    for (const key of ['names', 'birthDates']) {
        cases.push({ ...good(), knownIdentifiers: getter({}, key) },
            { ...good(), knownIdentifiers: { [key]: proxy(['Ada']) } },
            { ...good(), knownIdentifiers: { [key]: getter(['Ada'], '0') } });
    }
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    cases.push(revoked.proxy);
    const inherited = Object.create(getter({}, 'text'));
    inherited.entities = [];
    cases.push(inherited);
    const session = createRedactionSession();
    for (const value of cases) assert.throws(() => session.prepare(value as RedactionSessionInput));
    assert.equal(hooks, 0);
    assert.match(session.prepare(good()).redactedText, /_1\}\}$/);
    session.close();
});
