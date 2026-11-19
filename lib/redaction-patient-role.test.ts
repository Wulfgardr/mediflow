import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedactionSession, type RedactionSessionEntity } from './ai-redaction-session';

const person = (text: string, value: string): RedactionSessionEntity => {
    const start = text.indexOf(value);
    return { type: 'person', start, end: start + value.length, text: value, confidence: 1 };
};
const roles = (redacted: string) => [...redacted.matchAll(/\[\[MF_([A-Z]+)[0-9]+_[a-z2-7]{8}\]\]/gu)].map(match => match[1]);

test('PAZ only when every word of the value comes from the registry names', () => {
    const text = 'Lucia Bianchi riferisce che il padre Carlo Bianchi ha avuto un infarto. Il fratello Bianchi Aldo sta bene. Firma: Bianchi Lucia.';
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text, entities: ['Lucia Bianchi', 'Carlo Bianchi', 'Bianchi Aldo', 'Bianchi Lucia'].map(value => person(text, value)),
            knownIdentifiers: { names: ['Lucia', 'Bianchi', 'Lucia Bianchi'] } });
        assert.deepEqual(roles(prepared.redactedText), ['PAZ', 'PER', 'PER', 'PAZ']);
        assert.match(prepared.redactedText, /il padre \[\[MF_PER1_[a-z2-7]{8}\]\] ha avuto un infarto\. Il fratello \[\[MF_PER2_/u);
        assert.equal(prepared.rehydrate(prepared.redactedText), text);
    } finally { session.close(); }
});

test('a registry surname alone stays PAZ and spelling variants of registry names stay PAZ', () => {
    const text = "La signora BIANCHI, detta Lucia D'Amico-Bianchi, vede il dottor Bianchi.";
    const session = createRedactionSession();
    try {
        const prepared = session.prepare({ text, entities: [person(text, "Lucia D'Amico-Bianchi")],
            knownIdentifiers: { names: ['Lucia', "D'Amico", 'Bianchi'] } });
        assert.deepEqual(roles(prepared.redactedText), ['PAZ', 'PAZ', 'PAZ']);
    } finally { session.close(); }
});
