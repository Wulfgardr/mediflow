import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, settings } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { clearAllSessions } from './security/server-session';
import type { ServerSession } from './security/server-session';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'ambulatory-hierarchy-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const host = load('./ambulatory-write.ts') as typeof import('./ambulatory-write');
const paired = load('./network-ambulatory-write.ts') as typeof import('./network-ambulatory-write');
const { prepareNetworkPatientCommitGuard } = load('./network-patient-commit-authority.ts') as typeof import('./network-patient-commit-authority');
const sql = dbServer.$client;
const observations: unknown[] = [];
const session: ServerSession = { id: 'synthetic-hierarchy-session', userId: 'synthetic-hierarchy-operator',
    username: ['synthetic', 'hierarchy'].join('-'), role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const context = { request: new Request('http://127.0.0.1/api/ambulatories', { headers: { 'x-request-id': 'synthetic-hierarchy' } }), session };
type Surface = 'host' | 'paired';
bindSyntheticArchiveSessions(session.id);

test.after(() => {
    if (process.env.MEDIFLOW_HIERARCHY_REPORT) writeFileSync(process.env.MEDIFLOW_HIERARCHY_REPORT, JSON.stringify(observations, null, 2));
    clearAllSessions(); cleanupCookies(); sql.close();
});

function seed(parents: Record<string, string | null> = { a: null, b: null, c: null }) {
    clearAllSessions(); cookieState.cookies.clear();
    sql.exec('DELETE FROM ambulatories;');
    dbServer.insert(ambulatories).values({ id: 'scope', name: 'Synthetic scope', isDefault: true, version: 1 }).run();
    for (const [id, parentId] of Object.entries(parents)) {
        dbServer.insert(ambulatories).values({ id, name: `Synthetic ${id}`, parentId, version: 1 }).run();
    }
    const authority = syntheticNetworkPatientAuthority(dbServer, 'scope');
    authority.pairedClient.grantedCapabilities.push(paired.NETWORK_AMBULATORY_WRITE_CAPABILITY);
    setClients([authority.pairedClient]);
    cookieState.cookies.set('mediflow_session', authority.session.id);
    cookieState.cookies.set('ambulatory_id', 'scope');
    return authority;
}
function setClients(clients: ReturnType<typeof syntheticNetworkPatientAuthority>['pairedClient'][]) {
    const value = JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients, intents: [] })), archiveGeneration: currentArchiveGeneration() });
    dbServer.update(settings).set({ value }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}
function snapshot() {
    return { rows: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(), audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() };
}
function row(id: string) {
    return sql.prepare('SELECT id, parent_id, version, is_default FROM ambulatories WHERE id=?').get(id) as {
        id: string; parent_id: string | null; version: number; is_default: number;
    };
}
function update(surface: Surface, authority: ReturnType<typeof seed>, id: string, body: Record<string, unknown>) {
    return surface === 'host' ? host.updateAmbulatory(context, id, body) : paired.updateNetworkAmbulatory(authority, id, body);
}
function create(surface: Surface, authority: ReturnType<typeof seed>, body: Record<string, unknown>) {
    return surface === 'host' ? host.createAmbulatory(context, body) : paired.createNetworkAmbulatory(authority, body);
}

for (const surface of ['host', 'paired'] as const) {
    for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
        test(`${surface}: stale drafts ${first}→${second}/${second}→${first} cannot commit a cycle`, async () => {
            const authority = seed();
            const read = [row(first), row(second)];
            const accepted = await update(surface, authority, first, { parentId: second, version: read[0].version });
            assert.equal(accepted.status, 200);
            assert.deepEqual(accepted.value.affectedAmbulatories, [{ id: first, version: 2 }]);
            const beforeSecond = snapshot();
            const denied = await update(surface, authority, second, { parentId: first, isDefault: true, version: read[1].version });
            observations.push({ surface, read, accepted, beforeSecond, denied, afterSecond: snapshot() });
            assert.equal(denied.status, 400);
            assert.deepEqual(snapshot(), beforeSecond);
            assert.deepEqual(row(first), { id: first, parent_id: second, version: 2, is_default: 0 });
            assert.deepEqual(row(second), { id: second, parent_id: null, version: 1, is_default: 0 });
        });
    }
    test(`${surface}: descendant parenting is rejected without default, version or audit changes`, async () => {
        const authority = seed({ a: null, b: 'a', c: 'b' });
        const before = snapshot();
        const denied = await update(surface, authority, 'a', { parentId: 'c', isDefault: true, version: 1 });
        observations.push({ surface, case: 'descendant', before, denied, after: snapshot() });
        assert.equal(denied.status, 400);
        assert.deepEqual(snapshot(), before);
    });
    test(`${surface}: malformed ancestry cannot be extended but an explicit detach can repair it`, async () => {
        for (const parents of [{ a: 'b', b: 'a', c: null }, { a: 'missing', b: 'a', c: null }]) {
            const authority = seed(parents);
            const before = snapshot();
            assert.equal((await update(surface, authority, 'c', { parentId: 'b', version: 1 })).status, 400);
            assert.equal((await create(surface, authority, { id: 'new', name: 'Synthetic new', parentId: 'a', isDefault: true })).status, 400);
            assert.deepEqual(snapshot(), before);
            assert.equal((await update(surface, authority, 'a', { parentId: null, version: 1 })).status, 200);
            assert.equal(row('a').parent_id, null);
            assert.equal((await update(surface, authority, 'c', { parentId: 'b', version: 1 })).status, 200);
        }
    });
    test(`${surface}: valid reparenting and create retain exact receipt, readback and audit versions`, async () => {
        const authority = seed({ a: null, b: 'a', c: null });
        const before = snapshot();
        const accepted = await update(surface, authority, 'b', { parentId: 'c', isDefault: true, version: 1 });
        assert.equal(accepted.status, 200);
        assert.deepEqual(accepted.value.affectedAmbulatories, [{ id: 'scope', version: 2 }, { id: 'b', version: 2 }]);
        assert.deepEqual(row('b'), { id: 'b', parent_id: 'c', version: 2, is_default: 1 });
        const events = (snapshot().audit as Array<Record<string, unknown>>).slice(before.audit.length);
        assert.equal(events.length, 2);
        for (const event of events) {
            assert.equal(event.event_type, 'ambulatory.updated');
            assert.equal(event.source_surface, surface === 'host' ? 'web' : 'native');
            assert.equal(JSON.parse(String(event.redacted_metadata)).resourceVersion, 2);
        }
        assert.equal((await create(surface, authority, { id: 'new', name: 'Synthetic new', parentId: 'b' })).status, 201);
        assert.equal(row('new').parent_id, 'b');
        assert.equal(row('new').version, 1);
        const last = snapshot().audit.at(-1) as Record<string, unknown>;
        assert.equal(last.event_type, 'ambulatory.created');
        assert.equal(JSON.parse(String(last.redacted_metadata)).resourceVersion, 1);
    });
    test(`${surface}: missing parent, self, duplicate id and stale target preserve current state`, async () => {
        const authority = seed();
        const before = snapshot();
        assert.equal((await update(surface, authority, 'a', { parentId: 'missing', version: 1 })).status, 404);
        assert.equal((await update(surface, authority, 'a', { parentId: 'a', version: 1 })).status, 400);
        assert.equal((await create(surface, authority, { id: 'a', name: 'Synthetic duplicate', parentId: 'b' })).status, 409);
        assert.equal((await create(surface, authority, { id: 'new', name: 'Synthetic new', parentId: 'missing' })).status, 404);
        assert.deepEqual(snapshot(), before);
        assert.equal((await update(surface, authority, 'a', { parentId: 'b', version: 1 })).status, 200);
        const current = snapshot();
        const stale = await update(surface, authority, 'a', { parentId: 'c', version: 1 });
        assert.equal(stale.status, 409);
        assert.equal(stale.value.code, 'VERSION_CONFLICT');
        assert.equal(stale.value.currentVersion, 2);
        assert.equal((stale.value.currentSnapshot as Record<string, unknown>).version, 2);
        assert.deepEqual(snapshot(), current);
    });
    test(`${surface}: audit failures and ignored target writes roll back parenting and default demotion together`, async () => {
        for (const trigger of [
            "BEFORE INSERT ON audit_events WHEN NEW.subject_ref='a' BEGIN SELECT RAISE(FAIL, 'synthetic hierarchy audit failure'); END",
            "BEFORE INSERT ON audit_events WHEN NEW.subject_ref='a' BEGIN SELECT RAISE(IGNORE); END",
            "BEFORE UPDATE ON ambulatories WHEN OLD.id='a' BEGIN SELECT RAISE(IGNORE); END",
        ]) {
            const authority = seed();
            const before = snapshot();
            sql.exec(`CREATE TRIGGER synthetic_hierarchy_fault ${trigger}`);
            try {
                await assert.rejects(async () => update(surface, authority, 'a', { parentId: 'b', isDefault: true, version: 1 }));
                assert.deepEqual(snapshot(), before);
            } finally { sql.exec('DROP TRIGGER synthetic_hierarchy_fault'); }
        }
    });
}

test('a prepared paired writer rechecks the revoked peer before ancestry and any mutation', async () => {
    const authority = seed({ a: null, b: 'a', c: null });
    const authorizeCommit = await prepareNetworkPatientCommitGuard(authority, paired.NETWORK_AMBULATORY_WRITE_CAPABILITY);
    setClients([]);
    const before = snapshot();
    const denied = host.updateAmbulatory({ ...authority, authorizeCommit }, 'a', { parentId: 'b', isDefault: true, version: 1 }, 'network');
    assert.equal(denied.status, 401);
    assert.deepEqual(snapshot(), before);
});
