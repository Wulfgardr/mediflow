import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { mountContract, find, text } from './settings/settings-presentation.test-support.ts';
const imports = { './security-provider': {}, '@/lib/db': {}, '@/lib/patient-profile-scoped-browser-adapter': {} };
test('presentation distinguishes pending, unavailable and confirmed empty notes, and preserves the full valid note', () => {
    const render = (value: unknown) => mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotesView', { imports, props: { value } }).render();
    const pending = render({ state: 'pending' }), denied = render({ state: 'unavailable', message: 'Note troppo grandi. Nessuna bozza modificata.' });
    assert.match(text(pending), /Lettura delle note in corso/u); assert.doesNotMatch(text(pending), /Nessuna nota generale/u);
    assert.match(text(denied), /Nessuna bozza modificata/u); assert.doesNotMatch(text(denied), /Nessuna nota generale registrata/u);
    assert.match(text(render({ state: 'available', notes: null })), /Nessuna nota generale registrata/u);
    const notes = 'Sintetico '.repeat(60), valid = render({ state: 'available', notes });
    assert.match(text(valid), /Leggi la nota completa/u);
    assert.equal(text(find(valid, node => node.type === 'details')).includes(notes), true);
    const preview = find(valid, node => node.type === 'p'); assert.ok(text(preview).length <= 321);
});
test('patient synopsis passes scoped notes instead of the legacy snapshot and keeps grant out of clinical content', () => {
    const page = readFileSync(new URL('../app/patients/[id]/modules/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /notesContent=\{<PatientProfileNotes patientId=\{id\} patientVersion=\{patient\.version\}/u);
    assert.doesNotMatch(page, /notes=\{patient\.notes\}/u);
    const action = readFileSync(new URL('./patient-profile-access-action.tsx', import.meta.url), 'utf8');
    assert.match(action, /print:hidden/u); assert.match(action, /Nessun accesso aggiuntivo/u);
});
test('the dedicated access action defaults to no grant and sends only an explicitly selected projection', async () => {
    for (const projection of ['none', 'notes', 'profile']) {
        const calls: unknown[][] = [];
        const client = { initialize: async () => undefined, reset: () => undefined,
            activate: async (...values: unknown[]) => { calls.push(values); } };
        const harness = mountContract('components/patient-profile-access-action.tsx', 'PatientProfileAccessAction', {
            states: { 0: client, 1: projection }, props: { patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' },
            imports: { '@/lib/security/intelligent-host-browser-adapter': { createIntelligentHostBrowserAdapter: () => client } },
        });
        const tree = harness.render();
        const button = find(tree, node => node.type === 'button'); (button.props.onClick as () => void)(); await nextTurn();
        assert.equal(calls.length, 1); assert.equal(calls[0]![1], true);
        assert.equal(JSON.stringify(calls[0]![2]), projection === 'none' ? undefined : JSON.stringify({ projection }));
    }
});

test('render hides an old patient/operator/session note before effects can reset asynchronous state', () => {
    const previous = new AbortController().signal, replacement = new AbortController().signal;
    for (const change of ['patient', 'operator', 'session']) {
        const state = { patientId: 'synthetic-A', patientVersion: 7, userId: 'synthetic-user-A', signal: previous,
            value: { state: 'available', notes: 'OLD_SYNTHETIC_PATIENT_NOTE' } };
        const harness = mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotes', {
            states: { 0: { reset: () => undefined }, 1: state },
            props: { patientId: change === 'patient' ? 'synthetic-B' : 'synthetic-A', patientVersion: 7 },
            imports: { './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true,
                user: { id: change === 'operator' ? 'synthetic-user-B' : 'synthetic-user-A' } }) },
            '@/lib/db': { db: { getSessionReadSignal: () => change === 'session' ? replacement : previous } },
            '@/lib/patient-profile-scoped-browser-adapter': {} },
        });
        const tree = harness.render(); assert.doesNotMatch(text(tree), /OLD_SYNTHETIC_PATIENT_NOTE/u);
        assert.match(text(tree), /Lettura delle note in corso/u);
    }
});

test('an observed revision change hides available notes at render and requires explicit reopening', async () => {
    const signal = new AbortController().signal;
    let opens = 0;
    const client = { reset() {}, open: async () => { opens++; return { profile: { notes: 'NEW_ENC' }, currentness: { revision: 8, expiresAt: Date.now() + 60_000 } }; } };
    const props = { patientId: 'synthetic-A', patientVersion: 8 };
    const harness = mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotes', {
        states: { 0: client, 1: { patientId: props.patientId, patientVersion: 7, userId: 'operator', signal,
            value: { state: 'available', notes: 'OLD_REVISION_NOTE' } } }, props,
        imports: { './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true, user: { id: 'operator' } }) },
            '@/lib/db': { db: { getSessionReadSignal: () => signal, decryptPatientProfileNotes: async () => 'NEW_REVISION_NOTE' } },
            '@/lib/patient-profile-scoped-browser-adapter': {} },
        globals: { setTimeout: () => 1, clearTimeout() {} },
    });
    let tree = harness.render(); assert.doesNotMatch(text(tree), /OLD_REVISION_NOTE/u);
    assert.match(text(tree), /Riapri le note/u);
    const cleanup = harness.effects[0]!() as () => void;
    await nextTurn(); assert.equal(opens, 0);
    tree = harness.render(); (find(tree, node => node.type === 'button').props.onClick as () => void)();
    cleanup(); harness.render(); const reopenedCleanup = harness.effects[0]!() as () => void;
    await nextTurn(); assert.equal(opens, 1); assert.match(text(harness.render()), /NEW_REVISION_NOTE/u);
    reopenedCleanup();
});

for (const delayed of ['response', 'decryption'] as const) test(`old revision ${delayed} cannot publish after an observed version change`, async () => {
    const signal = new AbortController().signal;
    let release!: (value: unknown) => void, opens = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const result = { profile: { notes: 'OLD_ENC' }, currentness: { revision: 7, expiresAt: Date.now() + 60_000 } };
    const client = { reset() {}, open: () => { opens++; return delayed === 'response' ? pending : Promise.resolve(result); } };
    const props = { patientId: 'synthetic-A', patientVersion: 7 };
    const harness = mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotes', { states: { 0: client }, props,
        imports: { './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true, user: { id: 'operator' } }) },
            '@/lib/db': { db: { getSessionReadSignal: () => signal, decryptPatientProfileNotes: () => delayed === 'decryption' ? pending : Promise.resolve('OLD_LATE_NOTE') } },
            '@/lib/patient-profile-scoped-browser-adapter': {} }, globals: { setTimeout: () => 1, clearTimeout() {} } });
    harness.render(); const cleanup = harness.effects[0]!() as () => void;
    await nextTurn(); assert.equal(opens, 1);
    props.patientVersion = 8;
    let tree = harness.render(); assert.doesNotMatch(text(tree), /OLD_LATE_NOTE/u); assert.match(text(tree), /Riapri le note/u);
    release(delayed === 'response' ? result : 'OLD_LATE_NOTE'); await nextTurn();
    tree = harness.render(); assert.doesNotMatch(text(tree), /OLD_LATE_NOTE/u); assert.match(text(tree), /Riapri le note/u);
    cleanup(); const invalidatedCleanup = harness.effects[0]!() as () => void; await nextTurn();
    assert.equal(opens, 1); invalidatedCleanup();
});

test('a missing observed revision cannot open the profile or expose cached notes', () => {
    const signal = new AbortController().signal; let opens = 0;
    const harness = mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotes', {
        props: { patientId: 'synthetic-A', patientVersion: undefined },
        states: { 0: { reset() {}, open() { opens++; throw new Error('unversioned open'); } } },
        imports: { './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true, user: { id: 'operator' } }) },
            '@/lib/db': { db: { getSessionReadSignal: () => signal } }, '@/lib/patient-profile-scoped-browser-adapter': {} },
    });
    assert.match(text(harness.render()), /revisione della cartella non è disponibile/u);
    const cleanup = harness.effects[0]!() as () => void; assert.equal(opens, 0); cleanup();
});
