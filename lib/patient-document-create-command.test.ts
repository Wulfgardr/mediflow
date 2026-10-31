import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { ambulatories, patients, settings, users } from './schema';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { NETWORK_PAIRING_STATE_KEY } from './network-pairing-model';
import { retireServerSessionForLogout } from './security/server-session';
import { parsePatientDocumentCreateJournal } from './patient-document-create-journal';
import type { PatientDocumentCreateHost, PatientDocumentCreateReview, PreparedPatientDocument } from './patient-document-create-command';

const data = mkdtempSync(join(tmpdir(), 'mediflow-patient-document-command-'));
process.env.MEDIFLOW_DATA_DIR = data;
const load = createRequire(import.meta.url);
const cookies = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const { createPatientDocumentCommandService } = load('./patient-document-create-command.ts') as typeof import('./patient-document-create-command');
const { prepareNetworkPatientCommitGuard } = load('./network-patient-commit-authority.ts') as typeof import('./network-patient-commit-authority');
const { serverSessions: native } = load('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter');
const { confirmNativeChatAccessPin } = load('./security/native-chat-access-confirmation.ts') as typeof import('./security/native-chat-access-confirmation');
const pin = ['2', '4', '6', '8'].join('');
const service = () => createPatientDocumentCommandService(dbServer, () => tick);
let tick = Date.now();
async function fixture(scope: string = randomUUID()) {
    dbServer.insert(ambulatories).values({ id: scope, name: 'Ambulatorio sintetico', isDefault: true }).run();
    const context = syntheticNetworkPatientAuthority(dbServer, scope);
    cookies.cookies.set('ambulatory_id', scope);
    dbServer.update(users).set({ passwordHash: bcrypt.hashSync(pin, 4), failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, context.session.userId)).run();
    const guard = await prepareNetworkPatientCommitGuard(context, 'network.replica.write-patient-profile');
    const host: PatientDocumentCreateHost = { session: context.session, actorRef: context.session.userId,
        archiveGeneration: currentArchiveGeneration(), ambulatoryId: scope, epoch: 0, surface: 'native',
        assertCurrent: tx => { if (guard(tx)) throw new Error('Current owner denied'); },
        confirm: value => confirmNativeChatAccessPin(context.session as import('./security/paired-native-session').PairedNativeSession, value).then(result => result === 'confirmed'),
        retain: dispose => {
            const port = native.mintNativeSessionResourcePort(context.session); assert(port);
            const registration = native.registerNativeSessionPrivateResource(port, dispose); assert(registration);
            return () => { native.unregisterNativeSessionPrivateResource(port, registration); native.releaseNativeSessionResourcePort(port); };
        },
    };
    let current = true;
    const source: PreparedPatientDocument = { sourceId: randomUUID(), name: 'ENC:bmFtZQ==:bmFtZQ==', path: 'ENC:cGF0aA==:cGF0aA==',
        data: 'ENC:c291cmNl:c291cmNl', type: 'application/pdf', size: 512, identity: 'ambiguous', quality: 'ready',
        candidates: { firstName: 'Rossi', lastName: 'Mario', taxCode: randomUUID() } };
    const port = { session: context.session, ambulatoryId: scope, readCurrent: () => { if (!current) throw new Error('Original source retired'); return source; } };
    const review: PatientDocumentCreateReview = { firstName: { action: 'correct', value: 'Mario' }, lastName: { action: 'correct', value: 'Rossi' },
        taxCode: { action: 'approve', value: source.candidates.taxCode! }, duplicate: 'none' };
    const api = service(), view = api.open(host, port);
    return { context, host, source, port, review, api, view, retireSource: () => { current = false; } };
}
function effects() {
    const db = dbServer.$client;
    return Object.fromEntries(['patients', 'patients_to_ambulatories', 'attachments', 'therapies', 'audit_events'].map(table =>
        [table, (db.prepare(`SELECT count(*) n FROM ${table}${table === 'audit_events' ? " WHERE event_type NOT LIKE 'auth.%'" : ''}`).get() as { n: number }).n]));
}
async function preview() {
    const f = await fixture();
    // Names intentionally collide between fixtures: duplicate choice is a separate explicit decision.
    const duplicates = dbServer.select().from(patients).where(eq(patients.lastName, 'Rossi')).all();
    const review = { ...f.review, duplicate: duplicates.length ? 'create-separate' as const : 'none' as const };
    f.api.preview(f.host, f.view.viewId, review);
    return f;
}
test('real native PIN, reviewed identity, atomic source/currentness/audits; replay and restart have one effect', async () => {
    const f = await preview(), before = effects();
    assert.deepEqual(await f.api.execute(f.host, f.view.commandId, pin), { outcome: 'applied' });
    const after = effects();
    assert.equal(after.patients - before.patients, 1); assert.equal(after.attachments - before.attachments, 1);
    assert.equal(after.patients_to_ambulatories - before.patients_to_ambulatories, 1);
    assert.equal(after.audit_events - before.audit_events, 2); assert.equal(after.therapies, before.therapies);
    const attachment = dbServer.$client.prepare('SELECT * FROM attachments WHERE id=?').get(f.source.sourceId) as Record<string, string>;
    assert.equal(attachment.data, f.source.data); assert.match(attachment.document_source_ref, /^[a-f0-9]{64}$/u);
    const patient = dbServer.$client.prepare('SELECT * FROM patients WHERE id=?').get(attachment.patient_id) as Record<string, string>;
    assert.equal(patient.first_name, 'Mario'); assert.equal(patient.last_name, 'Rossi'); assert.equal(patient.notes, null); assert.equal(patient.diagnoses, null);
    let replay;
    await assert.doesNotReject(async () => { replay = await service().execute(f.host, f.view.commandId, 'invalid'); });
    assert.deepEqual(replay, { outcome: 'applied' });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'applied' });
    assert.deepEqual(effects(), after);
});
test('ambiguous Rossi Mario requires explicit correction; arbitrary fields and document instructions grant no authority', async () => {
    const f = await fixture(), before = effects();
    assert.equal(f.view.identity, 'ambiguous');
    assert.throws(() => f.api.preview(f.host, f.view.viewId, { ...f.review, firstName: { action: 'approve', value: 'Rossi' } }));
    assert.throws(() => f.api.preview(f.host, f.view.viewId, { ...f.review, therapies: [{ dosage: 'istruzione ostile' }] } as PatientDocumentCreateReview));
    assert.deepEqual(effects(), before);
});
test('duplicate needs distinct choice, never merges, and a new collision after review denies', async () => {
    const f = await fixture();
    dbServer.insert(patients).values({ id: randomUUID(), firstName: 'Mario', lastName: 'Rossi', taxCode: randomUUID() }).run();
    const before = effects();
    assert.throws(() => f.api.preview(f.host, f.view.viewId, f.review));
    f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate: 'create-separate' });
    const id = randomUUID();
    dbServer.insert(patients).values({ id, firstName: 'Mario', lastName: 'Rossi', taxCode: randomUUID() }).run();
    await assert.rejects(f.api.execute(f.host, f.view.commandId, pin));
    assert.deepEqual(effects(), { ...before, patients: before.patients + 1, audit_events: before.audit_events + 1 });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'retired' });
});
for (const fault of ['source-retired', 'source-changed', 'logout', 'scope', 'epoch', 'pin', '30s', '5min', 'grant'] as const) test(`positive reviewed command then ${fault} cannot create`, async () => {
    const f = await preview(), before = effects();
    let host = f.host;
    if (fault === 'source-retired') f.retireSource();
    if (fault === 'source-changed') (f.source as { data: string }).data = 'ENC:Y2hhbmdlZA==:Y2hhbmdlZA==';
    if (fault === 'logout') retireServerSessionForLogout(f.context.session.id);
    if (fault === 'scope') host = { ...host, ambulatoryId: randomUUID() };
    if (fault === 'epoch') host = { ...host, epoch: 1 };
    if (fault === '30s') tick += 30_000;
    if (fault === '5min') tick += 300_000;
    if (fault === 'grant') dbServer.update(settings).set({ value: '{}' }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    await assert.rejects(f.api.execute(host, f.view.commandId, fault === 'pin' ? '0000' : pin));
    const retired = ['source-changed', 'epoch', 'pin', '30s', '5min'].includes(fault);
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + Number(retired) });
    if (retired) assert.deepEqual(service().receipt(host, f.view.commandId), { outcome: 'retired' });
});
for (const table of ['patients_to_ambulatories', 'attachments', 'audit_events']) test(`failure at ${table} rolls back patient and source`, async () => {
    const f = await preview(), before = effects();
    dbServer.$client.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    try { await assert.rejects(f.api.execute(f.host, f.view.commandId, pin)); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_failure'); }
    assert.deepEqual(effects(), before);
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'unknown' });
    await assert.rejects(f.api.execute(f.host, f.view.commandId, pin));
});
test('double send during PIN consumes approval once', async () => {
    const f = await preview(); let resume!: (value: boolean) => void;
    let confirmations = 0;
    const host = { ...f.host, confirm: () => ++confirmations === 1
        ? new Promise<boolean>(resolve => { resume = resolve; }) : Promise.resolve(true) };
    const first = f.api.execute(host, f.view.commandId, pin);
    await assert.rejects(f.api.execute(host, f.view.commandId, pin));
    resume(true);
    assert.deepEqual(await first, { outcome: 'applied' });
});
test('revocation during PIN is durable and atomic, even across service instances', async () => {
    const f = await preview(); let resume!: (value: boolean) => void;
    const host = { ...f.host, confirm: () => new Promise<boolean>(resolve => { resume = resolve; }) };
    const first = f.api.execute(host, f.view.commandId, pin), before = effects();
    assert.deepEqual(f.api.revoke(f.host, f.view.commandId), { outcome: 'retired' });
    resume(true);
    // A confirmed tombstone is returned, never an invented successful write.
    assert.deepEqual(await first, { outcome: 'retired' });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'retired' });
    assert.deepEqual(await service().execute(f.host, f.view.commandId, pin), { outcome: 'retired' });
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + 1 });
});
test('unknown after restart stays unknown; foreign session cannot retire a live command', async () => {
    const f = await fixture(), restarted = service(), before = effects();
    assert.deepEqual(restarted.receipt(f.host, f.view.commandId), { outcome: 'unknown' });
    assert.deepEqual(restarted.revoke(f.host, f.view.commandId), { outcome: 'unknown' });
    assert.throws(() => f.api.revoke({ ...f.host, session: {} }, f.view.commandId));
    await assert.rejects(restarted.execute(f.host, f.view.commandId, pin));
    assert.deepEqual(effects(), before);
});
for (const quality of ['uncertain', 'ocr_error'] as const) test(`${quality}: no creation from an uncorrected extraction`, async () => {
    const f = await fixture(), api = service();
    const source = { ...f.source, quality }, view = api.open(f.host, { ...f.port, readCurrent: () => source });
    const before = effects();
    assert.throws(() => api.preview(f.host, view.viewId, f.review));
    assert.deepEqual(effects(), before);
});
for (const table of ['patients', 'patients_to_ambulatories', 'attachments', 'audit_events']) test(`ignored insert at ${table} is never declared successful`, async () => {
    const f = await preview(), before = effects();
    dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_ignore BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END;`);
    try { await assert.rejects(f.api.execute(f.host, f.view.commandId, pin)); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_ignore'); }
    const retired = table !== 'audit_events';
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + Number(retired) });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: retired ? 'retired' : 'unknown' });
});
test('five minute view cannot enter preview even with a fresh PIN', async () => {
    const f = await fixture(), before = effects();
    const duplicate = dbServer.select().from(patients).where(eq(patients.lastName, 'Rossi')).all().length ? 'create-separate' as const : 'none' as const;
    tick += 300_000;
    assert.throws(() => f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate }));
    assert.deepEqual(effects(), before);
});
test('owner denial after the source/audit writes rolls back the complete command', async () => {
    const f = await preview(), before = effects(); let current = true;
    const host = { ...f.host, assertCurrent: (tx: Parameters<typeof f.host.assertCurrent>[0]) => {
        f.host.assertCurrent(tx); if (!current) throw new Error('Owner retired after callback');
    } };
    dbServer.$client.function('synthetic_retire_after_write', () => { current = false; return 1; });
    dbServer.$client.exec('CREATE TEMP TRIGGER synthetic_retire_after_write AFTER INSERT ON attachments BEGIN SELECT synthetic_retire_after_write(); END;');
    try { await assert.rejects(f.api.execute(host, f.view.commandId, pin)); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_retire_after_write'); }
    assert.deepEqual(effects(), before);
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'unknown' });
});
test('expiration retires authoritatively; a failed retirement never invents a terminal receipt', async () => {
    const f = await preview(), before = effects();
    await assert.rejects(f.api.execute({ ...f.host, confirm: async () => { tick += 30_000; return true; } }, f.view.commandId, pin));
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + 1 });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'retired' });
    const g = await preview(), state = effects();
    dbServer.$client.exec("CREATE TEMP TRIGGER synthetic_retire_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    try { assert.throws(() => g.api.revoke(g.host, g.view.commandId)); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_retire_failure'); }
    assert.deepEqual(effects(), state);
    assert.deepEqual(service().receipt(g.host, g.view.commandId), { outcome: 'unknown' });
});
test('failed PIN terminal write keeps an authoritative revoke path without inventing a receipt', async () => {
    const f = await preview(), before = effects();
    dbServer.$client.exec("CREATE TEMP TRIGGER synthetic_terminal_failure BEFORE INSERT ON audit_events WHEN NEW.event_type = 'patient.create.retired' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    try { await assert.rejects(f.api.execute(f.host, f.view.commandId, '0000')); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_terminal_failure'); }
    assert.deepEqual(effects(), before);
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'unknown' });
    assert.deepEqual(f.api.revoke(f.host, f.view.commandId), { outcome: 'retired' });
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'retired' });
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + 1 });
});
test('journal schema keeps only opaque references and rejects malformed partial receipts', () => {
    const journal = { commandId: randomUUID(), archiveGeneration: randomUUID(), ambulatoryId: randomUUID(), patientId: randomUUID(), sourceId: randomUUID() };
    assert.deepEqual(parsePatientDocumentCreateJournal(journal), journal);
    assert.equal(parsePatientDocumentCreateJournal({ ...journal, sourceId: null }), null);
    assert.equal(parsePatientDocumentCreateJournal({ ...journal, firstName: 'Mario' }), null);
    assert.equal(parsePatientDocumentCreateJournal({ ...journal, commandId: 'not-a-command' }), null);
});
test('labelled approved fields are the only fields inserted; omitted birth date stays empty', async () => {
    const f = await fixture(), api = service();
    const source = { ...f.source, identity: 'labelled' as const,
        candidates: { firstName: 'Ada', lastName: randomUUID(), taxCode: randomUUID(), birthDate: '1950-01-02' } };
    const view = api.open(f.host, { ...f.port, readCurrent: () => source });
    api.preview(f.host, view.viewId, { firstName: { action: 'approve', value: source.candidates.firstName },
        lastName: { action: 'approve', value: source.candidates.lastName }, taxCode: { action: 'approve', value: source.candidates.taxCode }, duplicate: 'none' });
    assert.deepEqual(await api.execute(f.host, view.commandId, pin), { outcome: 'applied' });
    const row = dbServer.select().from(patients).where(eq(patients.taxCode, source.candidates.taxCode)).get();
    assert(row); assert.equal(row.birthDate, null);
});
test('revocation before preview cannot be renewed and a reused source cannot create another patient', async () => {
    const f = await fixture();
    assert.deepEqual(f.api.revoke(f.host, f.view.commandId), { outcome: 'retired' });
    assert.throws(() => f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate: 'create-separate' }));
    const g = await preview(); await g.api.execute(g.host, g.view.commandId, pin);
    const api = service(), view = api.open(g.host, g.port), before = effects();
    api.preview(g.host, view.viewId, { ...g.review, duplicate: 'create-separate' });
    await assert.rejects(api.execute(g.host, view.commandId, pin));
    assert.deepEqual(effects(), { ...before, audit_events: before.audit_events + 1 });
    assert.deepEqual(service().receipt(g.host, view.commandId), { outcome: 'retired' });
});
test('duplicate review recognizes accented names and repeated whitespace without choosing an identity', async () => {
    const f = await fixture();
    dbServer.insert(patients).values({ id: randomUUID(), firstName: 'ÉLENA', lastName: 'DE  ROSSI', taxCode: randomUUID() }).run();
    const review = { ...f.review, firstName: { action: 'correct' as const, value: 'Élena' }, lastName: { action: 'correct' as const, value: 'De Rossi' } };
    assert.throws(() => f.api.preview(f.host, f.view.viewId, review));
    f.api.preview(f.host, f.view.viewId, { ...review, duplicate: 'create-separate' });
});
test('existing non-UUID ambulatory identifiers retain the same reviewed destination', async () => {
    const f = await fixture('synthetic-legacy-scope');
    const duplicate = dbServer.select().from(patients).where(eq(patients.lastName, 'Rossi')).all().length ? 'create-separate' as const : 'none' as const;
    f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate });
    assert.deepEqual(await f.api.execute(f.host, f.view.commandId, pin), { outcome: 'applied' });
});
test('a source owned by another session or creation scope cannot open a review', async () => {
    const f = await fixture(), api = service(), before = effects();
    assert.throws(() => api.open(f.host, { ...f.port, session: {} }));
    assert.throws(() => api.open(f.host, { ...f.port, ambulatoryId: randomUUID() }));
    assert.deepEqual(effects(), before);
});
test('old operator receipt cannot be read in another scope or by another actor', async () => {
    const f = await preview(); await f.api.execute(f.host, f.view.commandId, pin);
    const other = randomUUID();
    dbServer.insert(users).values({ id: other, username: ['synthetic', 'other', other].join('-'), role: 'admin', passwordHash: 'synthetic-unusable', encryptedMasterKey: 'synthetic-unusable', salt: 'synthetic-unusable' }).run();
    assert.deepEqual(service().receipt(f.host, f.view.commandId), { outcome: 'applied' });
    assert.throws(() => service().receipt({ ...f.host, actorRef: other }, f.view.commandId));
    const g = await fixture();
    assert.throws(() => service().receipt(g.host, f.view.commandId));
});
test('a deleted patient is not proposed as a duplicate', async () => {
    const f = await fixture();
    dbServer.insert(patients).values({ id: randomUUID(), firstName: 'Mario', lastName: 'Rossi', taxCode: f.review.taxCode.value }).run();
    assert.throws(() => f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate: 'none' }));
    dbServer.update(patients).set({ deletedAt: new Date() }).run();
    assert.equal(f.api.preview(f.host, f.view.viewId, { ...f.review, duplicate: 'none' }).status, 'preview');
});
test.after(() => { cleanup(); dbServer.$client.close(); });
