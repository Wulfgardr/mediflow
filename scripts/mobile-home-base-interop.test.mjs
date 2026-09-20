/* @Codex */
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nativeSessionCookie, openField, readDescriptor, sealField, unwrapLoginKey, validateDescriptor } from './mobile-home-base-interop.mjs';

function fixture() {
    return {
        schemaVersion: 1, synthetic: true, fixtureId: 'interop-unit',
        host: { os: 'macos', sourceCommit: 'a'.repeat(40), httpsURL: 'https://127.0.0.1:3476',
            publicCertificatePath: '/synthetic/public.pem', tlsPinSHA256: 'b'.repeat(64) },
        operator: { username: 'synthetic', pin: 'not-a-runtime-credential', ambulatoryId: 'synthetic-ambulatory' },
        patient: { id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Interop' },
        clients: { ios: { id: 'ios-client', token: 'ios-unit-only' }, ipados: { id: 'ipad-client', token: 'ipad-unit-only' } },
    };
}

test('descriptor requires explicit synthetic provenance, separate pairings and a bounded HTTPS target', () => {
    assert.equal(validateDescriptor(fixture()).fixtureId, 'interop-unit');
    for (const mutate of [
        (v) => { delete v.synthetic; },
        (v) => { v.host.sourceCommit = 'short-sha'; },
        (v) => { v.clients.ipados = v.clients.ios; },
        (v) => { v.host.httpsURL = 'http://127.0.0.1:3476'; },
        (v) => { v.host.httpsURL = 'https://example.com'; },
        (v) => { v.host.httpsURL = 'https://127.0.0.1:3476/api'; },
        (v) => { v.host.httpsURL = 'https://secret:secret@127.0.0.1:3476'; },
    ]) {
        const value = fixture(); mutate(value);
        assert.throws(() => validateDescriptor(value));
    }
    for (const address of ['https://10.211.55.6:3476', 'https://172.16.0.2:3476', 'https://192.168.1.3:3476', 'https://[::1]:3476']) {
        const value = fixture(); value.host.httpsURL = address;
        assert.equal(validateDescriptor(value).host.httpsURL, address);
    }
});

test('descriptor reads refuse shared permissions and symlinks without disclosing credentials', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-interop-descriptor-unit-'));
    const source = path.join(directory, 'fixture.json');
    try {
        fs.writeFileSync(source, JSON.stringify(fixture()), { mode: 0o600 });
        assert.equal(readDescriptor(source).schemaVersion, 1);
        fs.chmodSync(source, 0o644);
        assert.throws(() => readDescriptor(source), /private regular file/u);
        fs.chmodSync(source, 0o600);
        const linked = path.join(directory, 'linked.json');
        fs.symlinkSync(source, linked);
        assert.throws(() => readDescriptor(linked), /private regular file/u);
        fs.writeFileSync(source, '{"secret":"do-not-print"');
        assert.throws(() => readDescriptor(source), { message: 'Descriptor is not valid JSON.' });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native session capture requires its own exact Secure cookie instead of borrowing web auth control', () => {
    const cookie = `mediflow_session=${'a'.repeat(64)}`;
    assert.equal(nativeSessionCookie(new Response(null, { headers: { 'Set-Cookie': `${cookie}; HttpOnly; Secure; Path=/` } })), cookie);
    for (const fields of [[`${cookie}; HttpOnly`], ['mediflow_auth_control=web-control; Secure'],
        [`${cookie}; Secure`, `${cookie}; Secure`]]) {
        const headers = new Headers();
        for (const field of fields) headers.append('Set-Cookie', field);
        assert.throws(() => nativeSessionCookie(new Response(null, { headers })));
    }
});

for (const [version, iterations] of [[1, 100_000], [2, 600_000]]) {
    test(`real login v${version} wrap decodes authenticated synthetic fields without a database`, async () => {
        const { subtle } = webcrypto;
        const pin = 'synthetic-unit-pin';
        const salt = randomBytes(16);
        const raw = randomBytes(32);
        const iv = randomBytes(12);
        const material = await subtle.importKey('raw', Buffer.from(pin), 'PBKDF2', false, ['deriveKey']);
        const kek = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
        const base64 = Buffer.concat([iv, Buffer.from(encrypted)]).toString('base64');
        const login = { salt: salt.toString('base64'), encryptedMasterKey: version === 1 ? base64 : `v2:${base64}` };
        const key = await unwrapLoginKey(login, pin);
        const ordinaryKey = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
        const text = 'Verifica sintetica: à, è, 0';
        const ordinaryIV = randomBytes(12);
        const ordinaryCiphertext = await subtle.encrypt({ name: 'AES-GCM', iv: ordinaryIV }, ordinaryKey, Buffer.from(JSON.stringify(text)));
        assert.equal(await openField(`ENC:${ordinaryIV.toString('base64')}:${Buffer.from(ordinaryCiphertext).toString('base64')}`, key), text);
        const sealed = await sealField({ value: 0, enabled: false }, key);
        const [, sealedIV, sealedData] = sealed.split(':');
        const opened = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(sealedIV, 'base64') }, ordinaryKey, Buffer.from(sealedData, 'base64'));
        assert.deepEqual(JSON.parse(Buffer.from(opened)), { value: 0, enabled: false });
        await assert.rejects(unwrapLoginKey(login, 'incorrect-synthetic-pin'), /could not be unwrapped/u);
        const modified = Buffer.from(ordinaryCiphertext); modified[0] ^= 1;
        await assert.rejects(openField(`ENC:${ordinaryIV.toString('base64')}:${modified.toString('base64')}`, key), /could not be authenticated/u);
        assert.equal(await openField(null, key), null);
    });
}
