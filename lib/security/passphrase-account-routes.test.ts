/* ADR 0143, step 2: the real check and login routes on a real archive, for an account that
   unlocks with a passphrase. The migration that writes such an account arrives with step 3:
   here the test writes the columns itself, with what the browser primitives produce. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-passphrase-account-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { POST: setup } = await import('../../app/api/auth/setup/route.ts');
const { POST: login } = await import('../../app/api/auth/login/route.ts');
const { GET: check } = await import('../../app/api/auth/check/route.ts');
const { dbServer } = await import('../db-server.ts');
const { users } = await import('../schema.ts');
const { createVerifiedSqliteSnapshotSync } = await import('../sqlite-repair.ts');
const { clearAllSessions } = await import('./server-session.ts');
const { persistKdfRewrap } = await import('./kdf-rewrap-service.ts');
const { createNativeLoginHttpHandler } = await import('./native-login-http.ts');
const { validateKdfRewrapPayload } = await import('./kdf-rewrap-validation.ts');
const { generateMasterKey, wrapMasterKeyVersioned } = await import('./security.ts');
const { createUnlockWrapping, deriveUnlockMaterial, hashAccessVerifier, openUnlockWrapping } = await import('./unlock-credential.ts');

const USERNAME = 'synthetic-admin';
const PIN = '2468';
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const account = () => dbServer.select().from(users).where(eq(users.username, USERNAME)).get()!;
const archive = path.join(dataDir, 'medical.db');
/** Which files of the archive hold `text` in their raw bytes. */
const filesHolding = (text: string) => [archive, `${archive}-wal`]
    .filter((file) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(text))).map((file) => path.basename(file));
const rawKey = async (key: CryptoKey) => Buffer.from(await globalThis.crypto.subtle.exportKey('raw', key)).toString('hex');

async function readCheck() {
    const response = await check(new Request('http://127.0.0.1/api/auth/check'));
    const controlId = response.headers.getSetCookie().find((cookie) => cookie.startsWith('mediflow_auth_control='))!.split(/[=;]/u)[1];
    return { body: await response.json() as Record<string, unknown>, controlId, etag: response.headers.get('etag')! };
}

async function post(route: (request: Request) => Promise<Response>, pathname: string, body: Record<string, unknown>) {
    const control = await readCheck();
    const response = await route(new Request(new URL(pathname, 'http://127.0.0.1'), {
        method: 'POST',
        headers: {
            'content-type': 'application/json', cookie: `mediflow_auth_control=${control.controlId}`,
            'if-match': control.etag, 'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** The native login seam with its real verifier; only pairing and session creation are stand-ins. */
async function nativeLogin(password: string) {
    let sessions = 0;
    const handler = createNativeLoginHttpHandler({
        consume: async () => ({}) as never,
        createNativeSession: (() => { sessions += 1; return { id: 'synthetic-native-session' }; }) as never,
        audit: async () => undefined,
    });
    const response = await handler(new Request('http://127.0.0.1/api/auth/native/login', { method: 'POST' }), {}, { username: USERNAME, password });
    return { status: response.status, sessions };
}

test.after(() => { clearAllSessions(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('an account moves from its PIN to a passphrase: check, login and re-wrap follow', async () => {
    const masterKey = await generateMasterKey();
    const pinSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const pinWrapping = await wrapMasterKeyVersioned(masterKey, PIN, pinSalt);
    const created = await post(setup, '/api/auth/setup', {
        username: USERNAME, password: PIN, encryptedMasterKey: pinWrapping, salt: Buffer.from(pinSalt).toString('base64'),
    });
    assert.equal(created.status, 200);

    // A repair made while the account is on its PIN leaves a full copy beside the archive.
    const pinEraCopy = `${archive}.bak-20261011-101500123`;
    createVerifiedSqliteSnapshotSync(archive, pinEraCopy);

    // On its PIN: nothing new is disclosed before authentication, and the PIN opens a session.
    assert.deepEqual((await readCheck()).body.unlock, { credential: 'pin' });
    assert.equal((await post(login, '/api/auth/login', { username: USERNAME, password: PIN })).status, 200);
    assert.ok(fs.existsSync(pinEraCopy), 'the copies of an account on its PIN are its safety net: a login leaves them');
    assert.deepEqual(await nativeLogin(PIN), { status: 200, sessions: 1 });
    const stronger = validateKdfRewrapPayload({ encryptedMasterKey: pinWrapping, salt: Buffer.from(pinSalt).toString('base64') });
    assert.ok(stronger);
    assert.equal(persistKdfRewrap(dbServer, account().id, stronger), true);

    // What the move writes in one transaction. Written here alone, it also stands for a move
    // interrupted before it could remove what still holds the PIN wrapping beside the archive.
    const wrapping = await createUnlockWrapping(masterKey, PASSPHRASE);
    dbServer.update(users).set({
        encryptedMasterKey: wrapping.encryptedMasterKey, salt: wrapping.salt,
        unlockVerifierHash: await hashAccessVerifier(wrapping.verifier),
    }).where(eq(users.username, USERNAME)).run();
    assert.notDeepEqual(filesHolding(pinWrapping), [], 'the write alone leaves the PIN wrapping in the files of the archive');

    // Before authentication the browser learns the salt, and only the salt.
    const { unlock } = (await readCheck()).body;
    assert.deepEqual(unlock, { credential: 'passphrase', kdfVersion: 3, salt: wrapping.salt });

    // The browser derives, sends the verifier and opens what the server returns.
    const material = await deriveUnlockMaterial(PASSPHRASE, new Uint8Array(Buffer.from(wrapping.salt, 'base64')));
    const opened = await post(login, '/api/auth/login', { username: USERNAME, verifier: material.verifier });
    assert.equal(opened.status, 200);
    assert.equal(await rawKey(await openUnlockWrapping(String(opened.body.encryptedMasterKey), material.kek)), await rawKey(masterKey));
    // The first unlock with the passphrase makes up for the interruption: the copy is gone, and
    // neither the archive nor its log holds the PIN wrapping or its salt any more.
    assert.equal(fs.existsSync(pinEraCopy), false);
    assert.deepEqual([...filesHolding(pinWrapping), ...filesHolding(Buffer.from(pinSalt).toString('base64'))], []);

    // The PIN no longer opens a session, alone or beside a verifier, and is not counted as an attempt.
    const withPin = await post(login, '/api/auth/login', { username: USERNAME, password: PIN });
    assert.equal(withPin.status, 401);
    assert.equal(withPin.body.code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal((await post(login, '/api/auth/login', { username: USERNAME, password: PIN, verifier: material.verifier })).status, 400);
    // Nor does it on the native seam, whose clients do not send a verifier yet: they stay out, not in with the PIN.
    assert.deepEqual(await nativeLogin(PIN), { status: 401, sessions: 0 });
    assert.equal(account().failedLoginAttempts, 0);
    const wrong = await deriveUnlockMaterial(`${PASSPHRASE}!`, new Uint8Array(Buffer.from(wrapping.salt, 'base64')));
    const denied = await post(login, '/api/auth/login', { username: USERNAME, verifier: wrong.verifier });
    assert.equal(denied.status, 401);
    assert.equal(denied.body.remainingAttempts, 4);

    // A session cannot put a PIN wrapping back in place of the passphrase one.
    assert.equal(persistKdfRewrap(dbServer, account().id, stronger), false);
    assert.equal(account().encryptedMasterKey, wrapping.encryptedMasterKey);
    assert.equal(account().salt, wrapping.salt);
});
