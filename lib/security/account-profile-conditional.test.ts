/* ADR 0155. Real SQLite, real paired admission and a real Web setup session;
   only the HTTP cookie adapter is synthetic, as in the currentness suites. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { eq } from 'drizzle-orm';

import { auditEvents, settings, users } from '@/lib/schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '@/lib/network-patient-authority-test-fixture';
import { clearAllSessions, retireServerSessionForLogout } from './server-session';
import { ArchiveReplacedError, rotateSqliteArchiveGeneration } from '@/lib/archive-generation';
import { NETWORK_MODE_KEY } from '@/lib/network-contract';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '@/lib/network-pairing-model';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-account-profile-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server');
openDbServer();

const profileService = load('./profile-update-service.ts') as typeof import('./profile-update-service');
const pairedSessions = load('./paired-native-session.ts') as typeof import('./paired-native-session');
const profileRoute = load('../../app/api/auth/profile/route.ts') as typeof import('../../app/api/auth/profile/route');
const checkRoute = load('../../app/api/auth/check/route.ts') as typeof import('../../app/api/auth/check/route');
const setupRoute = load('../../app/api/auth/setup/route.ts') as typeof import('../../app/api/auth/setup/route');

const URL = 'http://127.0.0.1/api/auth/profile';
const SCOPE = 'synthetic-profile-scope';
const WEB_USERNAME = ['synthetic', 'profile', 'web'].join('-');
const WEB_PASSWORD = createHash('sha256').update(`${WEB_USERNAME}-setup`).digest('hex').slice(0, 16);
const NATIVE_DISPLAY_NAME = 'Dott.ssa Iniziale';
const NATIVE_AMBULATORY_NAME = 'Studio Iniziale';

type NativeAuthority = ReturnType<typeof syntheticNetworkPatientAuthority>;
let nativeAuthority: NativeAuthority;
let nativeUserId: string;
let webUserId: string;
let webGeneration: string;
let webCookies: { control: string; session: string };

function cookieValue(response: Response, name: string): string {
    const fields = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') ?? ''];
    for (const field of fields) {
        const match = field.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`, 'u'));
        if (match) return match[1]!;
    }
    throw new Error(`missing ${name} cookie`);
}

async function createWebSession(): Promise<{ userId: string; generation: string }> {
    const check = await checkRoute.GET(new Request('http://127.0.0.1/api/auth/check'));
    assert.equal(check.status, 200);
    const control = cookieValue(check, 'mediflow_auth_control');
    const etag = check.headers.get('etag');
    assert.ok(etag);
    const response = await setupRoute.POST(new Request('http://127.0.0.1/api/auth/setup', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mediflow_auth_control=${control}`,
            'if-match': etag,
            'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
            username: WEB_USERNAME, password: WEB_PASSWORD,
            encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt',
            displayName: 'Dott. Web', ambulatoryName: 'Studio Web',
        }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { id: string; archiveGeneration: string };
    webCookies = { control, session: cookieValue(response, 'mediflow_session') };
    return { userId: body.id, generation: body.archiveGeneration };
}

function selectNativeCookies(): void {
    cookieState.cookies.delete('mediflow_auth_control');
    cookieState.cookies.set('mediflow_session', nativeAuthority.session.id);
}

function selectWebCookies(): void {
    cookieState.cookies.set('mediflow_auth_control', webCookies.control);
    cookieState.cookies.set('mediflow_session', webCookies.session);
}

function createNativeAuthority(): NativeAuthority {
    const authority = syntheticNetworkPatientAuthority(dbServer, SCOPE);
    nativeUserId = authority.session.userId;
    nativeAuthority = authority;
    selectNativeCookies();
    return authority;
}

function profileVersion(userId: string, displayName: string | null, ambulatoryName: string | null): string {
    return `p1:${createHash('sha256').update(JSON.stringify([userId, displayName, ambulatoryName])).digest('hex')}`;
}

function setProfile(userId: string, displayName: string | null, ambulatoryName: string | null): void {
    dbServer.update(users).set({ displayName, ambulatoryName }).where(eq(users.id, userId)).run();
    for (const [key, value] of [['doctorName', displayName ?? ''], ['clinicName', ambulatoryName ?? '']]) {
        dbServer.insert(settings).values({ key: key!, value: value! })
            .onConflictDoUpdate({ target: settings.key, set: { value: value! } }).run();
    }
}

function resetState(): void {
    dbServer.$client.exec('DROP TRIGGER IF EXISTS abort_profile_audit');
    setProfile(nativeUserId, NATIVE_DISPLAY_NAME, NATIVE_AMBULATORY_NAME);
    setProfile(webUserId, 'Dott. Web', 'Studio Web');
    selectNativeCookies();
}

function nativeHeaders(): Record<string, string> {
    return Object.fromEntries(nativeAuthority.request.headers.entries());
}

function profileRequest(headers: Record<string, string> = {}): Request {
    return new Request(URL, { headers: { ...nativeHeaders(), ...headers } });
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...nativeHeaders(), ...headers },
        body: JSON.stringify(body),
    });
}

function auditCount(): number {
    return dbServer.select({ eventId: auditEvents.eventId }).from(auditEvents).all().length;
}

function profileRows(userId: string) {
    return {
        user: dbServer.select({ displayName: users.displayName, ambulatoryName: users.ambulatoryName })
            .from(users).where(eq(users.id, userId)).get(),
        settings: Object.fromEntries(dbServer.select().from(settings).all()
            .filter(row => row.key === 'doctorName' || row.key === 'clinicName')
            .map(row => [row.key, row.value])),
        audit: dbServer.select().from(auditEvents).all(),
    };
}

/** A PUT whose body is only released once the route has started reading it. */
function heldRequest(body: unknown, headers: Record<string, string> = {}) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const held = new Request(URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...nativeHeaders(), ...headers },
        body: stream,
        duplex: 'half',
    } as RequestInit);
    let reading = false;
    const reader = held.body!.getReader.bind(held.body);
    Object.defineProperty(held.body!, 'getReader', { value: () => { reading = true; return reader(); } });
    return {
        request: held,
        reading: () => reading,
        release: () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
            controller.close();
        },
    };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 1000; index++) {
        if (predicate()) return;
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error('synthetic body reader was not reached');
}

function beforeNextTransaction(t: TestContext, change: () => void): () => boolean {
    let reached = false;
    const transaction = dbServer.transaction.bind(dbServer);
    t.mock.method(dbServer, 'transaction', (...args: Parameters<typeof dbServer.transaction>) => {
        assert.equal(dbServer.$client.inTransaction, false);
        reached = true;
        change();
        return transaction(...args);
    }, { times: 1 });
    return () => reached;
}

async function currentProfile(): Promise<{ profileVersion: string }> {
    return await (await profileRoute.GET(profileRequest())).json() as { profileVersion: string };
}

test.after(() => {
    clearAllSessions();
    cleanupCookies();
    dbServer.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
});

test.before(async () => {
    const web = await createWebSession();
    webUserId = web.userId;
    webGeneration = web.generation;
    nativeAuthority = createNativeAuthority();
});

test.beforeEach(() => resetState());

test('GET returns exactly the ADR 0155 profile shape and a stable version', async () => {
    const first = await profileRoute.GET(profileRequest());
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const body = await first.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
        'ambulatoryName', 'archiveGeneration', 'contractVersion', 'displayName',
        'operation', 'profileVersion', 'userId', 'username',
    ]);
    assert.deepEqual(body, {
        operation: 'account-profile.read.v1',
        contractVersion: 1,
        userId: nativeUserId,
        username: nativeAuthority.session.username,
        displayName: NATIVE_DISPLAY_NAME,
        ambulatoryName: NATIVE_AMBULATORY_NAME,
        profileVersion: profileVersion(nativeUserId, NATIVE_DISPLAY_NAME, NATIVE_AMBULATORY_NAME),
        archiveGeneration: nativeAuthority.request.headers.get('x-mediflow-archive-generation'),
    });

    const second = await profileRoute.GET(profileRequest());
    assert.deepEqual(await second.json(), body);

    setProfile(nativeUserId, 'Dott.ssa Diversa', NATIVE_AMBULATORY_NAME);
    const changed = await (await profileRoute.GET(profileRequest())).json() as Record<string, unknown>;
    assert.notEqual(changed.profileVersion, body.profileVersion);
});

test('conditional PUT updates users and settings, audits once and reads back the same version', async () => {
    const before = await currentProfile();
    const auditsBefore = auditCount();
    const response = await profileRoute.PUT(request({
        expectedVersion: before.profileVersion,
        displayName: '  Dott. Condizionale  ',
        ambulatoryName: '  Studio Condizionale  ',
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.changed, true);
    assert.equal(body.userId, nativeUserId);
    assert.equal(body.displayName, 'Dott. Condizionale');
    assert.equal(body.ambulatoryName, 'Studio Condizionale');

    const rows = profileRows(nativeUserId);
    assert.equal(rows.user?.displayName, 'Dott. Condizionale');
    assert.equal(rows.user?.ambulatoryName, 'Studio Condizionale');
    assert.equal(rows.settings.doctorName, 'Dott. Condizionale');
    assert.equal(rows.settings.clinicName, 'Studio Condizionale');
    assert.equal(rows.audit.length, auditsBefore + 1);
    const audit = rows.audit.at(-1)!;
    assert.equal(audit.eventType, 'settings.updated');
    assert.equal(audit.subjectType, 'settings');
    assert.equal(audit.subjectRef, 'profile.identity');
    const metadata = JSON.parse(audit.redactedMetadata ?? '{}');
    assert.deepEqual(metadata.changedFields, ['displayName', 'ambulatoryName', 'doctorName', 'clinicName']);
    assert.deepEqual(metadata.flags, ['profile-update', 'conditional', 'auth:local-token']);
    assert.equal(metadata.reasonCode, 'profile_update');

    const after = await currentProfile();
    assert.equal(body.profileVersion, after.profileVersion);
});

test('a stale version returns PROFILE_VERSION_CONFLICT with the current profile and no effects', async () => {
    const current = await currentProfile();
    setProfile(nativeUserId, 'Dott. Altro Client', 'Studio Altro Client');
    const before = profileRows(nativeUserId);

    const response = await profileRoute.PUT(request({
        expectedVersion: current.profileVersion,
        displayName: 'Dott. Perdente',
        ambulatoryName: 'Studio Perdente',
    }));
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, 'PROFILE_VERSION_CONFLICT');
    assert.equal(body.displayName, 'Dott. Altro Client');
    assert.equal(body.ambulatoryName, 'Studio Altro Client');
    assert.equal(body.profileVersion, profileVersion(nativeUserId, 'Dott. Altro Client', 'Studio Altro Client'));
    assert.deepEqual(profileRows(nativeUserId), before);
});

test('the same values change nothing and write no audit', async () => {
    const current = await currentProfile();
    const auditsBefore = auditCount();
    const before = profileRows(nativeUserId);

    const response = await profileRoute.PUT(request({
        expectedVersion: current.profileVersion,
        displayName: NATIVE_DISPLAY_NAME,
        ambulatoryName: NATIVE_AMBULATORY_NAME,
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.changed, false);
    assert.equal(body.profileVersion, current.profileVersion);
    assert.deepEqual(profileRows(nativeUserId), before);
    assert.equal(auditCount(), auditsBefore);
});

test('conditional validation rejects extra fields, id, long names and missing names', async () => {
    const current = await currentProfile();
    const before = profileRows(nativeUserId);
    const invalid = [
        { expectedVersion: current.profileVersion, displayName: 'A', ambulatoryName: 'B', extra: true },
        { expectedVersion: current.profileVersion, displayName: 'A', ambulatoryName: 'B', id: nativeUserId },
        { expectedVersion: current.profileVersion, displayName: 'A'.repeat(201), ambulatoryName: 'B' },
        { expectedVersion: current.profileVersion, ambulatoryName: 'B' },
        { expectedVersion: current.profileVersion, displayName: 'A' },
        { expectedVersion: current.profileVersion, displayName: 3, ambulatoryName: 'B' },
    ];
    for (const body of invalid) {
        const response = await profileRoute.PUT(request(body));
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json() as Record<string, unknown>).error, 'Payload non valido');
    }
    assert.deepEqual(profileRows(nativeUserId), before);

    const cleared = await profileRoute.PUT(request({
        expectedVersion: current.profileVersion, displayName: '   ', ambulatoryName: '   ',
    }));
    assert.equal(cleared.status, 200);
    const body = await cleared.json() as Record<string, unknown>;
    assert.equal(body.displayName, null);
    assert.equal(body.ambulatoryName, null);
    assert.equal(body.changed, true);
});

test('legacy PUT without expectedVersion keeps its unconditional behaviour', async () => {
    const before = profileRows(nativeUserId);
    const auditsBefore = auditCount();
    const response = await profileRoute.PUT(request({
        displayName: 'Dott. Legacy',
        ambulatoryName: 'Studio Legacy',
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    const rows = profileRows(nativeUserId);
    assert.equal(rows.user?.displayName, 'Dott. Legacy');
    assert.equal(rows.user?.ambulatoryName, 'Studio Legacy');
    assert.equal(rows.settings.doctorName, 'Dott. Legacy');
    assert.equal(rows.settings.clinicName, 'Studio Legacy');
    assert.equal(rows.audit.length, auditsBefore + 1);
});

test('an audit failure inside the transaction rolls the profile back', async () => {
    const current = await currentProfile();
    const before = profileRows(nativeUserId);
    dbServer.$client.exec(`
        CREATE TRIGGER abort_profile_audit
        BEFORE INSERT ON audit_events
        BEGIN
            SELECT RAISE(ABORT, 'simulated profile audit failure');
        END;
    `);

    const originalError = console.error;
    console.error = () => {};
    let response: Response;
    try {
        response = await profileRoute.PUT(request({
            expectedVersion: current.profileVersion,
            displayName: 'Dott. Senza Audit',
            ambulatoryName: 'Studio Senza Audit',
        }));
    } finally {
        console.error = originalError;
    }
    assert.equal(response.status, 500);
    assert.deepEqual(profileRows(nativeUserId), before);
});

test('a session retired after admission returns 401 without effects', async () => {
    const current = await currentProfile();
    const body = {
        expectedVersion: current.profileVersion,
        displayName: 'Dott. Ritardato',
        ambulatoryName: 'Studio Ritardato',
    };
    const before = profileRows(nativeUserId);
    const held = heldRequest(body);
    const pending = profileRoute.PUT(held.request);
    await waitUntil(held.reading);
    retireServerSessionForLogout(nativeAuthority.session.id);
    held.release();
    const response = await pending;
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(profileRows(nativeUserId), before);

    nativeAuthority = createNativeAuthority();
});

test('a web conditional PUT requires the archive generation header and then succeeds', async () => {
    selectWebCookies();
    const before = await (await profileRoute.GET(new Request(URL))).json() as { profileVersion: string };
    const body = {
        expectedVersion: before.profileVersion,
        displayName: 'Dott. Web Dopo',
        ambulatoryName: 'Studio Web Dopo',
    };

    const denied = await profileRoute.PUT(new Request(URL, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const auditsBefore = auditCount();
    assert.equal(denied.status, 409);
    assert.equal((await denied.json() as Record<string, unknown>).code, 'ARCHIVE_REPLACED');
    assert.equal(auditCount(), auditsBefore);

    const allowed = await profileRoute.PUT(new Request(URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': webGeneration },
        body: JSON.stringify(body),
    }));
    assert.equal(allowed.status, 200);
    const updated = await allowed.json() as Record<string, unknown>;
    assert.equal(updated.changed, true);
    assert.equal(updated.displayName, 'Dott. Web Dopo');
    assert.equal(profileRows(webUserId).settings.clinicName, 'Studio Web Dopo');
    assert.equal(auditCount(), auditsBefore + 1);
    const reread = await (await profileRoute.GET(new Request(URL))).json() as Record<string, unknown>;
    assert.equal(reread.profileVersion, updated.profileVersion);
    assert.equal(reread.archiveGeneration, webGeneration);
});

test('account profile admission and commit require no patient capability', async () => {
    const pairing = JSON.parse(serializeNetworkPairingState({
        intents: [], clients: [{ ...nativeAuthority.pairedClient, grantedCapabilities: [] }],
    })) as Record<string, unknown>;
    pairing.archiveGeneration = nativeAuthority.request.headers.get('x-mediflow-archive-generation');
    dbServer.update(settings).set({ value: JSON.stringify(pairing) })
        .where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    const read = await profileRoute.GET(profileRequest());
    assert.equal(read.status, 200);
    const current = await read.json() as { profileVersion: string };
    const auditsBefore = auditCount();
    const updated = await profileRoute.PUT(request({
        expectedVersion: current.profileVersion,
        displayName: 'Synthetic account operator', ambulatoryName: 'Synthetic account clinic',
    }));
    assert.equal(updated.status, 200);
    assert.equal(auditCount(), auditsBefore + 1);
    nativeAuthority = createNativeAuthority();
});

test('a restore while profile database resolution yields never returns replacement data', async () => {
    const readRequest = profileRequest();
    const session = await pairedSessions.requireAccountSession(readRequest);
    assert.equal(session, nativeAuthority.session);
    assert.ok(session);
    const nativeBinding = await pairedSessions.pairedNativeClientBinding(readRequest);
    assert.ok(nativeBinding);

    const pending = profileService.readAccountProfile({ session, request: readRequest, nativeBinding }, { db: dbServer });
    dbServer.$client.transaction(() => {
        rotateSqliteArchiveGeneration(dbServer.$client);
        setProfile(nativeUserId, 'Synthetic replacement operator', 'Synthetic replacement clinic');
    }).immediate();
    clearAllSessions();
    const replacement = profileRows(nativeUserId);
    await assert.rejects(pending, ArchiveReplacedError);
    assert.deepEqual(profileRows(nativeUserId), replacement);
    nativeAuthority = createNativeAuthority();
});

test('GET fences a restore after paired admission and before its read transaction', async (t) => {
    let replacement: ReturnType<typeof profileRows> | undefined;
    const reached = beforeNextTransaction(t, () => {
        dbServer.$client.transaction(() => {
            rotateSqliteArchiveGeneration(dbServer.$client);
            setProfile(nativeUserId, 'Synthetic replacement operator', 'Synthetic replacement clinic');
        }).immediate();
        clearAllSessions();
        replacement = profileRows(nativeUserId);
    });
    const response = await profileRoute.GET(profileRequest());
    assert.equal(reached(), true);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, 'ARCHIVE_REPLACED');
    assert.equal(body.displayName, undefined);
    assert.equal(body.profileVersion, undefined);
    assert.deepEqual(profileRows(nativeUserId), replacement);
    nativeAuthority = createNativeAuthority();
});

for (const method of ['GET', 'PUT'] as const) {
    test(`${method}: a session retired immediately before its transaction has no profile or audit effects`, async (t) => {
        const current = await currentProfile();
        const before = profileRows(nativeUserId);
        const reached = beforeNextTransaction(t, () => retireServerSessionForLogout(nativeAuthority.session.id));
        const response = method === 'GET'
            ? await profileRoute.GET(profileRequest())
            : await profileRoute.PUT(request({
                expectedVersion: current.profileVersion,
                displayName: 'Synthetic retired operator', ambulatoryName: 'Synthetic retired clinic',
            }));
        assert.equal(reached(), true);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'Unauthorized' });
        assert.deepEqual(profileRows(nativeUserId), before);
        nativeAuthority = createNativeAuthority();
    });
}

for (const method of ['GET', 'PUT'] as const) for (const revocation of ['pairing', 'mode'] as const) {
    test(`${method} rechecks ${revocation} after binding resolution inside its transaction`, async (t) => {
        const current = await currentProfile();
        const before = profileRows(nativeUserId);
        const reached = beforeNextTransaction(t, () => {
            const key = revocation === 'pairing' ? NETWORK_PAIRING_STATE_KEY : NETWORK_MODE_KEY;
            const value = revocation === 'pairing'
                ? serializeNetworkPairingState({ intents: [], clients: [] }) : 'local-only';
            dbServer.update(settings).set({ value }).where(eq(settings.key, key)).run();
        });
        const response = method === 'GET'
            ? await profileRoute.GET(profileRequest())
            : await profileRoute.PUT(request({
                expectedVersion: current.profileVersion,
                displayName: 'Synthetic revoked operator', ambulatoryName: 'Synthetic revoked clinic',
            }));
        assert.equal(reached(), true);
        assert.equal(response.status, revocation === 'pairing' ? 401 : 403);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json() as Record<string, unknown>;
        if (revocation === 'mode') assert.equal(body.code, 'NETWORK_MODE_DISABLED');
        else assert.deepEqual(body, { error: 'Unauthorized' });
        assert.deepEqual(profileRows(nativeUserId), before);
        nativeAuthority = createNativeAuthority();
    });
}

test('a replaced archive after admission returns ARCHIVE_REPLACED without effects', async () => {
    const current = await currentProfile();
    const body = {
        expectedVersion: current.profileVersion,
        displayName: 'Dott. Archivio',
        ambulatoryName: 'Studio Archivio',
    };
    const before = profileRows(nativeUserId);
    const held = heldRequest(body);
    const pending = profileRoute.PUT(held.request);
    await waitUntil(held.reading);
    dbServer.$client.transaction(() => rotateSqliteArchiveGeneration(dbServer.$client)).immediate();
    held.release();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json() as Record<string, unknown>).code, 'ARCHIVE_REPLACED');
    assert.deepEqual(profileRows(nativeUserId), before);
});

test('archive replacement is only reported to an admitted paired client', async () => {
    const current = await currentProfile();
    const body = {
        expectedVersion: current.profileVersion,
        displayName: 'Dott. Senza Ammissione',
        ambulatoryName: 'Studio Senza Ammissione',
    };
    dbServer.$client.transaction(() => rotateSqliteArchiveGeneration(dbServer.$client)).immediate();
    // Pairing state is generation-bound: restore it so only the session binding is stale.
    const repaired = syntheticNetworkPatientAuthority(dbServer, SCOPE, {
        clientId: nativeAuthority.pairedClient.clientId,
        userId: nativeAuthority.session.userId,
    });
    const before = profileRows(nativeUserId);
    const auditsBefore = auditCount();

    const foreignHeaders = {
        'x-mediflow-paired-client-id': 'synthetic-other-device',
        'x-mediflow-paired-client-token': 'synthetic-other-device-token',
    };
    const getWithoutClient = await profileRoute.GET(new Request(URL));
    assert.equal(getWithoutClient.status, 401);
    assert.equal(getWithoutClient.headers.get('cache-control'), 'no-store');
    const getWithForeignClient = await profileRoute.GET(profileRequest(foreignHeaders));
    assert.equal(getWithForeignClient.status, 401);

    const putWithoutClient = await profileRoute.PUT(new Request(URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }));
    assert.equal(putWithoutClient.status, 401);
    const putWithForeignClient = await profileRoute.PUT(new Request(URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...foreignHeaders },
        body: JSON.stringify(body),
    }));
    assert.equal(putWithForeignClient.status, 401);
    assert.deepEqual(profileRows(nativeUserId), before);
    assert.equal(auditCount(), auditsBefore);

    const admittedGet = await profileRoute.GET(profileRequest());
    assert.equal(admittedGet.status, 409);
    assert.equal((await admittedGet.json() as Record<string, unknown>).code, 'ARCHIVE_REPLACED');
    const admittedPut = await profileRoute.PUT(request(body));
    assert.equal(admittedPut.status, 409);
    assert.equal((await admittedPut.json() as Record<string, unknown>).code, 'ARCHIVE_REPLACED');
    assert.deepEqual(profileRows(nativeUserId), before);
    assert.equal(auditCount(), auditsBefore);

    // Keep the synthetic authority's later sessions from leaking into the remaining state.
    nativeAuthority = repaired;
});
