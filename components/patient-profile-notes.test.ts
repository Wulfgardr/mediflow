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
    assert.match(page, /notesContent=\{<PatientProfileNotes patientId=\{id\}/u);
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
        const state = { patientId: 'synthetic-A', userId: 'synthetic-user-A', signal: previous,
            value: { state: 'available', notes: 'OLD_SYNTHETIC_PATIENT_NOTE' } };
        const harness = mountContract('components/patient-profile-notes.tsx', 'PatientProfileNotes', {
            states: { 0: { reset: () => undefined }, 1: state },
            props: { patientId: change === 'patient' ? 'synthetic-B' : 'synthetic-A' },
            imports: { './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true,
                user: { id: change === 'operator' ? 'synthetic-user-B' : 'synthetic-user-A' } }) },
            '@/lib/db': { db: { getSessionReadSignal: () => change === 'session' ? replacement : previous } },
            '@/lib/patient-profile-scoped-browser-adapter': {} },
        });
        const tree = harness.render(); assert.doesNotMatch(text(tree), /OLD_SYNTHETIC_PATIENT_NOTE/u);
        assert.match(text(tree), /Lettura delle note in corso/u);
    }
});
