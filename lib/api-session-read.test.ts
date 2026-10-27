import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db';
import { fetchDrugAutocomplete } from './drug-autocomplete-search';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from './api-table-response';

const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const tables = ['patients', 'ambulatories', 'entries', 'therapies', 'observations', 'prostheticPrescriptions',
    'servicePrescriptions', 'servicePrescriptionItems', 'serviceCatalogEntries', 'sissHandoffs', 'conversations',
    'messages', 'checkups', 'attachments', 'drugs', 'exemptions', 'settings', 'patientsToAmbulatories'] as const;

for (const terminal of ['get', 'toArray'] as const) for (const stage of ['response', 'json'] as const) {
    test(`${terminal}: old successful ${stage} cannot publish into the replacement`, async t => {
        db.setKey(await key());
        t.after(() => db.setKey(null));
        const item = { id: 'synthetic-id', patientId: 'synthetic-patient', name: 'source.txt' };
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        let parsing!: () => void;
        const parsed = new Promise<void>(resolve => { parsing = resolve; });
        let signal: AbortSignal | undefined;
        t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal ?? undefined;
            if (stage === 'response') await pending;
            return { ok: true, status: 200, json: async () => {
                parsing(); if (stage === 'json') await pending;
                return terminal === 'get' ? item : [item];
            } } as Response;
        });
        const outcome = (terminal === 'get' ? db.attachments.get(item.id) : db.attachments.toArray())
            .then(value => ({ value }), error => ({ error }));
        if (stage === 'json') await parsed;
        assert.equal(signal?.aborted, false);
        db.setKey(null);
        assert.equal(signal?.aborted, true);
        db.setKey(await key());
        release();
        const result = await outcome;
        assert.ok('error' in result && result.error.name === 'AbortError');
        assert.equal(db.isKeySet(), true);
    });
}

for (const table of tables) for (const terminal of ['get', 'toArray', 'count'] as const) {
    test(`${table}.${terminal}: a late denial cannot revoke a replacement using the same key`, async t => {
        const masterKey = await key();
        db.setKey(masterKey);
        t.after(() => db.setKey(null));
        const events = new EventTarget();
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
        t.after(() => previous ? Object.defineProperty(globalThis, 'window', previous) : Reflect.deleteProperty(globalThis, 'window'));
        let denials = 0;
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
        let reply!: (response: Response) => void;
        const pending = new Promise<Response>(resolve => { reply = resolve; });
        t.mock.method(globalThis, 'fetch', async () => pending);
        const reader = db[table].query({ patientId: 'synthetic-patient' }).filter(() => true).reverse().limit(2);
        const outcome = (terminal === 'get' ? reader.get('synthetic-id') : reader[terminal]())
            .then(value => ({ value }), error => ({ error }));
        db.setKey(null);
        db.setKey(masterKey);
        const replacement = db.getSessionReadSignal();
        reply(new Response(null, { status: terminal === 'count' ? 403 : 401 }));
        const result = await outcome;
        assert.equal(denials, 0);
        assert.equal(replacement.aborted, false);
        assert.equal(db.isKeySet(), true);
        assert.ok('error' in result && result.error.name === 'AbortError');
    });
}

for (const status of [401, 403]) test(`drug autocomplete: old ${status} cannot revoke a replacement`, async t => {
    db.setKey(await key());
    t.after(() => db.setKey(null));
    const events = new EventTarget();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    t.after(() => previous ? Object.defineProperty(globalThis, 'window', previous) : Reflect.deleteProperty(globalThis, 'window'));
    let denials = 0;
    events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
    let reply!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { reply = resolve; });
    const outcome = fetchDrugAutocomplete('sintetico', new AbortController().signal, async () => pending)
        .then(value => ({ value }), error => ({ error }));
    db.setKey(null);
    db.setKey(await key());
    reply(new Response(null, { status }));
    const result = await outcome;
    assert.equal(denials, 0);
    assert.equal(db.isKeySet(), true);
    assert.ok('error' in result && result.error.name === 'AbortError');
});
