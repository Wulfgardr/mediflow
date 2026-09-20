/* @Codex: real ApiTable and WebCrypto, declared HTTP transport double only.
 * No mock provider is an authentication proof; route/SQL/physical-owner tests are separate. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { db, type Patient, type PatientCreateClientContext, type PatientAddOptions } from './db';
import { generateMasterKey, decryptData } from './security/security';

const patient = (): Patient => ({ id: 'synthetic-patient', firstName: 'Ada', lastName: 'Sintetica',
    taxCode: 'SYNTHETIC0000001', address: 'Via solo sintetica', phone: '+390000001',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') });
function context(): PatientCreateClientContext {
    return { nonce: 'a'.repeat(64), ambulatoryId: 'synthetic-A', expiresAt: Date.now() + 300_000,
        signal: db.getSessionReadSignal(), isCurrent: () => true };
}
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

test('createContext is typed only on patient add, not other tables or put/update', () => {
    const patientAdd: 'createContext' extends keyof NonNullable<Parameters<typeof db.patients.add>[1]> ? true : false = true;
    const ambulatoryAdd: 'createContext' extends keyof NonNullable<Parameters<typeof db.ambulatories.add>[1]> ? true : false = false;
    const attachmentAdd: 'createContext' extends keyof NonNullable<Parameters<typeof db.attachments.add>[1]> ? true : false = false;
    const patientPut: 'createContext' extends keyof NonNullable<Parameters<typeof db.patients.put>[1]> ? true : false = false;
    const patientUpdate: 'createContext' extends keyof NonNullable<Parameters<typeof db.patients.update>[2]> ? true : false = false;
    assert.deepEqual([patientAdd, ambulatoryAdd, attachmentAdd, patientPut, patientUpdate], [true, false, false, false, false]);
});
for (const fenced of [false, true]) test(`real patient AES-GCM encryption preserved; fenced=${fenced}`, async t => {
    const key = await generateMasterKey(); db.setKey(key); t.after(() => db.setKey(null));
    const item = patient(); const before = { ...item }; const precondition = context(); let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
        calls += 1; assert.equal(url, '/api/patients'); assert.equal(init.method, 'POST');
        const headers = new Headers(init.headers);
        assert.equal(headers.get('Content-Type'), 'application/json');
        assert.equal(headers.get('X-MediFlow-Patient-Create-Mode'), fenced ? 'fixed-preview-v1' : null);
        assert.equal(headers.get('X-MediFlow-Patient-Create-Context'), fenced ? precondition.nonce : null);
        assert.equal(headers.get('X-MediFlow-Patient-Create-Target'), fenced ? 'synthetic-A' : null);
        assert.equal(init.signal, fenced ? precondition.signal : undefined);
        const body = JSON.parse(init.body as string) as Record<string, string>;
        for (const field of ['address', 'phone'] as const) {
            assert.match(body[field], /^ENC:/u);
            const [, iv, data] = body[field].split(':');
            assert.equal(await decryptData(data, iv, key), item[field]);
        }
        assert.equal(body.firstName, item.firstName); assert.equal(body.taxCode, item.taxCode);
        for (const forbidden of ['nonce', 'sessionId', 'authenticationGeneration', 'createContext', 'cookie']) assert.equal(Object.hasOwn(body, forbidden), false);
        assert.equal((init.body as string).includes(precondition.nonce), false);
        return Response.json({ id: item.id }, { status: 201 });
    });
    assert.equal(await db.patients.add(item, fenced ? { createContext: precondition } : undefined), item.id);
    assert.equal(calls, 1); assert.deepEqual(item, before);
});
test('empty create optionals remain absent after real encryption; no value synthesis', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    // Legacy Patient is a read type requiring address/phone. This represents accepted create omission.
    const item = { id: 'synthetic-empty', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC0000002',
        createdAt: new Date(), updatedAt: new Date() } as Patient;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        for (const field of ['birthDate', 'address', 'phone', 'diagnoses', 'notes']) assert.equal(Object.hasOwn(body, field), false);
        return Response.json({ id: item.id }, { status: 201 });
    });
    assert.equal(await db.patients.add(item, { createContext: context() }), item.id);
});
test('legacy ambulatory add and put preserve body/options; no create-context headers', async t => {
    const item = { id: 'synthetic-clinic', name: 'Solo sintetico', createdAt: new Date('2026-01-01T00:00:00Z') };
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
        calls += 1; assert.equal(url, '/api/ambulatories'); assert.equal(init.method, 'POST');
        assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { 'content-type': 'application/json' });
        assert.equal(Object.hasOwn(init, 'signal'), false);
        assert.deepEqual(JSON.parse(init.body as string), { ...item, createdAt: item.createdAt.toISOString() });
        return Response.json({ id: item.id }, { status: 201 });
    });
    await db.ambulatories.add(item, { suppressNotify: true });
    await db.ambulatories.put(item, { suppressNotify: true });
    assert.equal(calls, 2);
});
test('present-but-undefined createContext cannot silently take the legacy path', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    await assert.rejects(db.patients.add(patient(), { createContext: undefined }), /context unavailable/u);
    assert.equal(fetch.mock.callCount(), 0);
});
test('a forced createContext on another table is rejected at runtime too', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    await assert.rejects(Reflect.apply(db.ambulatories.add, db.ambulatories, [
        { id: 'synthetic', name: 'Synthetic', createdAt: new Date() }, { createContext: context() },
    ]), /context unavailable/u);
    assert.equal(fetch.mock.callCount(), 0);
});
for (const reason of ['expired', 'retired', 'aborted', 'malformed'] as const) test(`fenced pre-dispatch denial: ${reason}`, async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const aborted = new AbortController(); aborted.abort();
    const value = { ...context(), ...(reason === 'expired' ? { expiresAt: Date.now() - 1 } : {}),
        ...(reason === 'retired' ? { isCurrent: () => false } : {}), ...(reason === 'aborted' ? { signal: aborted.signal } : {}),
        ...(reason === 'malformed' ? { nonce: '' } : {}) };
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    await assert.rejects(db.patients.add(patient(), { createContext: value }));
    assert.equal(fetch.mock.callCount(), 0);
});
for (const cause of ['key', 'context'] as const) test(`retirement during REAL encryption prevents HTTP (${cause})`, async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const gate = deferred(); const entered = deferred(); let current = true;
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle);
    t.mock.method(globalThis.crypto.subtle, 'encrypt', async (...args: Parameters<SubtleCrypto['encrypt']>) => {
        const result = await originalEncrypt(...args); entered.resolve(); await gate.promise; return result;
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    const run = db.patients.add(patient(), { createContext: { ...context(), isCurrent: () => current } });
    const denied = assert.rejects(run);
    await entered.promise;
    if (cause === 'key') db.setKey(null); else current = false;
    gate.resolve(); await denied;
    assert.equal(fetch.mock.callCount(), 0);
});
test('retirement after dispatched response is NOT confirmation or a retry', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const entered = deferred(); const gate = deferred(); let current = true; let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1; entered.resolve(); await gate.promise;
        return Response.json({ id: 'synthetic-patient' }, { status: 201 });
    });
    const denied = assert.rejects(db.patients.add(patient(), { createContext: { ...context(), isCurrent: () => current } }));
    await entered.promise; current = false; gate.resolve(); await denied; assert.equal(calls, 1);
});
test('fenced HTTP error body is not echoed; legacy error behavior stays unchanged', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    t.mock.method(globalThis, 'fetch', async () => new Response('SYNTHETIC_SENSITIVE_ERROR', { status: 409 }));
    await assert.rejects(db.patients.add(patient(), { createContext: context() }), error => {
        assert(error instanceof Error); assert.equal(error.message.includes('SYNTHETIC_SENSITIVE_ERROR'), false); return true;
    });
    await assert.rejects(db.patients.add(patient()), /SYNTHETIC_SENSITIVE_ERROR/u);
});
test('retirement during response JSON parsing cannot notify a confirmed create', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const entered = deferred(); const gate = deferred(); let current = true;
    const response = Response.json({ id: 'synthetic-patient' }, { status: 201 });
    const json = response.json.bind(response);
    t.mock.method(response, 'json', async () => { entered.resolve(); await gate.promise; return json(); });
    const fetch = t.mock.method(globalThis, 'fetch', async () => response);
    const denied = assert.rejects(db.patients.add(patient(), { createContext: { ...context(), isCurrent: () => current } }));
    await entered.promise; current = false; gate.resolve(); await denied; assert.equal(fetch.mock.callCount(), 1);
});

test('inherited but invalid createContext is still present: no silent legacy fallback', async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    const options: PatientAddOptions = Object.create({ createContext: undefined });
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    await assert.rejects(db.patients.add(patient(), options), /context unavailable/u);
    assert.equal(fetch.mock.callCount(), 0);
});
