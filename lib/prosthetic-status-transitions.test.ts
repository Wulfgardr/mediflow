import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { clearAllSessions } from './security/server-session';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* WUL-800, coorte 4: passaggi di stato e collaudo delle prescrizioni protesiche su SQLite reale. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { ServerSession } from './security/server-session.ts';
import { PROSTHETIC_TRANSITIONS, isProstheticTransitionAllowed } from './clinical-status-transitions.ts';
import { PROSTHETIC_PRESCRIPTION_STATUSES } from './prescription-domain.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'prosthetic-transitions-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const { commitTerritorialPackTransition } = await import('./territorial-pack-store.ts');
commitTerritorialPackTransition(openDbServer(), { schemaVersion: 'mediflow.territorial-packs.v1', expectedRevision: 0, preset: 'core+it+lom', confirmed: true },
    { actorType: 'system', actorRef: 'synthetic-supervisor', sourceSurface: 'job' }, () => {});
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { patients, ambulatories, patientsToAmbulatories, prostheticPrescriptions } = await import('./schema.ts');
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dir, cookieState);
const writer = await import('./prosthetic-prescription-write.ts');
const sql = new Database(join(dir, 'medical.db'));

const decision = JSON.parse(readFileSync(new URL('../docs/domain/clinical-status-transitions.json', import.meta.url), 'utf8')) as
    { prostheticPrescription: Record<string, string[]> };
let n = 0;
const next = (name: string) => `synthetic-prosthetic-transition-${++n}-${name}`;
const session: ServerSession = { id: 'synthetic-session', userId: 'synthetic-user', username: next('operator'), role: 'admin',
    authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const ambulatoryId = next('ambulatory');
const authority = syntheticNetworkPatientAuthority(dbServer, ambulatoryId, {
    userId: session.userId, clientId: 'synthetic-paired', requestId: 'synthetic-request',
    capabilities: ['network.replica.write-prosthetic-prescriptions'],
});
const request = new Request('http://localhost/test', { headers: Object.fromEntries(authority.request.headers) });
cookieState.cookies.set('ambulatory_id', ambulatoryId);
dbServer.insert(ambulatories).values({ id: ambulatoryId, name: 'Synthetic ambulatory', type: 'live' }).run();
test.after(() => { clearAllSessions(); cleanupCookies(); sql.close(); dbServer.$client.close(); });

const savedCollaudo = new Date('2026-05-20T00:00:00.000Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

function seed(status: string, collaudoAt: Date | null = null, collaudoOutcome: string | null = null): string {
    const patientId = next('patient'); const id = next('prescription');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax') }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId }).run();
    dbServer.insert(prostheticPrescriptions).values({ id, patientId, prescribedAt: new Date('2026-05-01'), description: 'ENC:synthetic:aid',
        status, collaudoAt, collaudoOutcome, version: 2 }).run();
    return id;
}
function row(id: string) {
    return sql.prepare('SELECT status, version, collaudo_at AS collaudoAt, collaudo_outcome AS collaudoOutcome FROM prosthetic_prescriptions WHERE id=?').get(id) as
        { status: string; version: number; collaudoAt: number | null; collaudoOutcome: string | null };
}
function audits(id: string) {
    return sql.prepare('SELECT redacted_metadata AS metadata FROM audit_events WHERE subject_ref=?').all(id) as Array<{ metadata: string }>;
}
function update(id: string, body: Record<string, unknown>) {
    return writer.updateHostProstheticPrescription({ request, session, id }, { version: 2, ...body });
}

test('the product table is exactly the decided one and covers every stored status', () => {
    const sorted = (table: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(table).map(([from, targets]) => [from, [...targets].sort()]));
    assert.deepEqual(sorted(PROSTHETIC_TRANSITIONS), sorted(decision.prostheticPrescription));
    assert.deepEqual(Object.keys(PROSTHETIC_TRANSITIONS).sort(), [...PROSTHETIC_PRESCRIPTION_STATUSES].sort());
});

test('every pair of states is accepted or refused on the server as decided, before any write', async () => {
    for (const from of PROSTHETIC_PRESCRIPTION_STATUSES) {
        for (const to of PROSTHETIC_PRESCRIPTION_STATUSES) {
            const expected = from === to || decision.prostheticPrescription[from].includes(to);
            assert.equal(isProstheticTransitionAllowed(from, to), expected, `${from} -> ${to}`);
            const id = seed(from, from === 'tested' ? savedCollaudo : null);
            const result = await update(id, { status: to });
            assert.equal(result.status, expected ? 200 : 409, `${from} -> ${to}`);
            assert.equal(row(id).status, expected ? to : from);
            assert.equal(audits(id).length, expected ? 1 : 0);
        }
    }
});

test('a draft cannot be tested and a tested aid cannot be cancelled, and the refusal says why', async () => {
    const draft = seed('draft');
    const refused = await update(draft, { status: 'tested' });
    assert.deepEqual(refused.value, { error: 'Status transition not allowed', code: 'status_transition_not_allowed',
        entity: 'prosthetic_prescription', from: 'draft', to: 'tested' });
    const tested = seed('tested', savedCollaudo);
    assert.equal((await update(tested, { status: 'cancelled' })).status, 409);
    assert.deepEqual(row(tested), { status: 'tested', version: 2, collaudoAt: seconds(savedCollaudo), collaudoOutcome: null });
});

test('testing keeps a given or saved date, otherwise uses the moment, and never invents an outcome', async () => {
    const before = Math.floor(Date.now() / 1000);
    const fresh = seed('delivered');
    assert.equal((await update(fresh, { status: 'tested' })).status, 200);
    const tested = row(fresh);
    assert.ok(tested.collaudoAt !== null && tested.collaudoAt >= before);
    assert.equal(tested.collaudoOutcome, null);

    const saved = seed('authorized', savedCollaudo);
    assert.equal((await update(saved, { status: 'tested' })).status, 200);
    assert.equal(row(saved).collaudoAt, seconds(savedCollaudo));

    const given = seed('prescribed');
    assert.equal((await update(given, { status: 'tested', collaudoAt: '2026-06-01', collaudoOutcome: 'ENC:synthetic:outcome' })).status, 200);
    assert.deepEqual(row(given), { status: 'tested', version: 3, collaudoAt: seconds(new Date('2026-06-01')), collaudoOutcome: 'ENC:synthetic:outcome' });
});

test('stepping back from tested clears the date, keeps the outcome the doctor wrote, and the audit names the date', async () => {
    const id = seed('tested', savedCollaudo, 'ENC:synthetic:outcome');
    assert.equal((await update(id, { status: 'delivered' })).status, 200);
    assert.deepEqual(row(id), { status: 'delivered', version: 3, collaudoAt: null, collaudoOutcome: 'ENC:synthetic:outcome' });
    const [event] = audits(id);
    const changed = (JSON.parse(event.metadata) as { changedFields: string[] }).changedFields;
    assert.ok(changed.includes('collaudoAt'), changed.join(','));
});

test('a saved collaudo date in the future does not survive testing: the moment of the change wins', async () => {
    const before = Math.floor(Date.now() / 1000);
    const id = seed('delivered', new Date(Date.now() + 30 * 86_400_000));
    assert.equal((await update(id, { status: 'tested' })).status, 200);
    const stored = row(id).collaudoAt!;
    assert.ok(stored >= before && stored <= Math.floor(Date.now() / 1000) + 1);
});

test('a tested aid cannot lose its collaudo date', async () => {
    const id = seed('tested', savedCollaudo);
    const result = await update(id, { collaudoAt: null });
    assert.equal(result.status, 409);
    assert.equal(result.value.code, 'prosthetic_collaudo_date_required');
    assert.deepEqual(row(id), { status: 'tested', version: 2, collaudoAt: seconds(savedCollaudo), collaudoOutcome: null });
    assert.equal(audits(id).length, 0);
});

test('an aid created as already tested always has a collaudo date', async () => {
    const patientId = next('patient');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax') }).run();
    const created = await writer.createHostProstheticPrescription({ request, session },
        { patientId, prescribedAt: '2026-05-01', description: 'ENC:synthetic:aid', status: 'tested' });
    assert.equal(created.status, 201);
    const stored = row((created.value as { id: string }).id);
    assert.equal(stored.status, 'tested');
    assert.notEqual(stored.collaudoAt, null);
    assert.equal(stored.collaudoOutcome, null);
    const [event] = audits((created.value as { id: string }).id);
    assert.ok((JSON.parse(event.metadata) as { changedFields: string[] }).changedFields.includes('collaudoAt'));
});

test('the paired client goes through the same table', async () => {
    const id = seed('draft');
    const refused = await writer.updateNetworkScopedProstheticPrescription({ request, session: authority.session,
        pairedClient: authority.pairedClient, scopeAmbulatoryId: ambulatoryId, prescriptionId: id }, { version: 2, status: 'tested' });
    assert.equal(refused.status, 409);
    assert.equal(row(id).status, 'draft');
});

test('a stored status outside the table can be brought back to a valid one and is not rewritten otherwise', async () => {
    const id = seed('draft');
    sql.prepare("UPDATE prosthetic_prescriptions SET status='legacy-unknown' WHERE id=?").run(id);
    assert.equal((await update(id, { notes: 'ENC:synthetic:note' })).status, 200);
    assert.equal(row(id).status, 'legacy-unknown');
    const again = sql.prepare('SELECT version FROM prosthetic_prescriptions WHERE id=?').get(id) as { version: number };
    assert.equal((await writer.updateHostProstheticPrescription({ request, session, id }, { version: again.version, status: 'prescribed' })).status, 200);
    assert.equal(row(id).status, 'prescribed');
});
