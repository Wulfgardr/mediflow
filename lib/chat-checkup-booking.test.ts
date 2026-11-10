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
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { parseBackupArtifact } from './backup-artifact';

const data = mkdtempSync(join(tmpdir(), 'mediflow-chat-booking-'));
process.env.MEDIFLOW_DATA_DIR = data;
const load = createRequire(import.meta.url);
const cookies = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const { nativeProfileSelectionOwner } = load('./security/native-profile-selection-owner.ts') as typeof import('./security/native-profile-selection-owner');
const { createChatCheckupBookingService, agendaRevision, parseCheckupBookingCommand } = load('./chat-checkup-booking.ts') as typeof import('./chat-checkup-booking');
const { createCheckupOperation } = load('./checkup-write-operation.ts') as typeof import('./checkup-write-operation');
const { issueSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture');
const pin = ['2', '4', '6', '8'].join('');
const passwordHash = bcrypt.hashSync(pin, 4);
let tick = Date.now();
const tomorrow = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000 + 9 * 3_600_000).toISOString();

async function fixture() {
    const scope = randomUUID(), patientId = randomUUID();
    dbServer.insert(ambulatories).values({ id: scope, name: 'Sintetico', isDefault: true }).run();
    const context = syntheticNetworkPatientAuthority(dbServer, scope);
    context.pairedClient.grantedCapabilities.push('network.replica.readonly-checkups', 'network.replica.write-checkups', 'network.replica.readonly-patients');
    dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [context.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration() }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    dbServer.update(users).set({ passwordHash, failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, context.session.userId)).run();
    cookies.cookies.set('ambulatory_id', scope);
    cookies.cookies.set('mediflow_session', context.session.id);
    dbServer.insert(patients).values({ id: patientId, firstName: 'Sintetico', lastName: 'Paziente', taxCode: randomUUID() }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: scope }).run();
    const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
    owner.issueSelection({ expectedEpoch: 0, patientId, ambulatoryId: scope });
    const epoch = owner.snapshotSelectionEpoch(context.session);
    const service = createChatCheckupBookingService(() => tick);
    const view = await service.open(context, patientId, epoch);
    const command = { commandId: randomUUID(), protocol: 'checkup.booking.v1' as const, archiveGeneration: currentArchiveGeneration(), patientId,
        expectedAgendaRevision: view.agendaRevision, date: tomorrow, title: 'Controllo' };
    return { context, command, epoch, service, owner, viewId: view.viewId, view, patientId };
}
function effects(patientId: string, commandId: string) {
    const db = dbServer.$client;
    return {
        checkups: db.prepare('SELECT id,date,title,status,version FROM checkups WHERE patient_id=? ORDER BY id').all(patientId),
        audits: db.prepare('SELECT outcome,source_surface AS surface FROM audit_events WHERE request_id=?').all(commandId),
    };
}

test('booking with native preview, real PIN, shared writer, audit and receipt that survives a restart', async () => {
    const f = await fixture();
    assert.match(f.command.expectedAgendaRevision, /^[0-9a-f]{64}$/u);
    assert.deepEqual([f.view.rows, f.view.omitted], [[], 0]);
    await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const receipt = await f.service.execute(f.context, f.command.commandId, pin);
    assert.equal(receipt.outcome, 'applied'); assert.equal(receipt.resultVersion, 1); assert.equal(receipt.checkupId, f.command.commandId);
    const after = effects(f.patientId, f.command.commandId);
    assert.deepEqual(after.checkups, [{ id: f.command.commandId, date: Date.parse(tomorrow) / 1000, title: 'Controllo', status: 'pending', version: 1 }]);
    assert.deepEqual(after.audits, [{ outcome: 'success', surface: 'native' }]);
    const restarted = createChatCheckupBookingService(() => tick);
    const recovered = await restarted.receipt(f.context, f.command.commandId);
    assert.equal(recovered.outcome, 'terminal');
    if (recovered.outcome === 'terminal') {
        assert.equal(recovered.receipt.auditEventId, receipt.auditEventId);
        assert.deepEqual(recovered.current, { version: 1, status: 'pending' });
        assert.equal(recovered.receipt.historical, false);
    }
    assert.deepEqual(await restarted.revoke(f.context, f.command.commandId), { outcome: 'applied' });
    await assert.rejects(restarted.revoke({ ...f.context, scopeAmbulatoryId: randomUUID() }, f.command.commandId));
    await assert.rejects(restarted.receipt({ ...f.context, session: { ...f.context.session, userId: randomUUID() } }, f.command.commandId));
});

test('wrong PIN cannot book and consumes the one-shot preview', async () => {
    const control = await fixture(); await control.service.preview(control.context, control.command, control.epoch, control.viewId);
    assert.equal((await control.service.execute(control.context, control.command.commandId, pin)).outcome, 'applied');
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    await assert.rejects(f.service.execute(f.context, f.command.commandId, '0000'));
    await assert.rejects(f.service.execute(f.context, f.command.commandId, pin));
    assert.deepEqual(effects(f.patientId, f.command.commandId), { checkups: [], audits: [] });
});

test('a stale agenda revision is rejected durably and reads the same outcome after a restart', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const web = createCheckupOperation({ patientId: f.patientId, checkupId: randomUUID(), values: { id: randomUUID(), patientId: f.patientId, date: new Date(tomorrow), title: 'Altro', status: 'pending' },
        changedFields: ['date', 'title'], mode: 'web', audit: { archiveGeneration: currentArchiveGeneration(), actorType: 'user', actorRef: f.context.session.userId, sourceSurface: 'web', requestId: null, flags: ['auth:web'] } });
    assert.equal(web.status, 201);
    const rejected = await f.service.execute(f.context, f.command.commandId, pin);
    assert.deepEqual([rejected.outcome, rejected.reason, rejected.checkupId], ['rejected', 'version_conflict', null]);
    assert.equal(effects(f.patientId, f.command.commandId).checkups.length, 1);
    assert.deepEqual(effects(f.patientId, f.command.commandId).audits, [{ outcome: 'denied', surface: 'native' }]);
    const restarted = createChatCheckupBookingService(() => tick);
    const recovered = await restarted.receipt(f.context, f.command.commandId);
    assert.equal(recovered.outcome, 'terminal');
    if (recovered.outcome === 'terminal') assert.equal(recovered.receipt.outcome, 'rejected');
    assert.deepEqual(await restarted.revoke(f.context, f.command.commandId), { outcome: 'rejected' });
});

test('double submission with the same commandId writes once and a reused commandId cannot open a second preview', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const [first, second] = await Promise.allSettled([f.service.execute(f.context, f.command.commandId, pin), f.service.execute(f.context, f.command.commandId, pin)]);
    assert.deepEqual([first.status, second.status].sort(), ['fulfilled', 'rejected']);
    await assert.rejects(f.service.execute(f.context, f.command.commandId, pin));
    const view = await f.service.open(f.context, f.patientId, f.epoch);
    await assert.rejects(f.service.preview(f.context, { ...f.command, expectedAgendaRevision: view.agendaRevision }, f.epoch, view.viewId));
    const after = effects(f.patientId, f.command.commandId);
    assert.equal(after.checkups.length, 1); assert.deepEqual(after.audits, [{ outcome: 'success', surface: 'native' }]);
});

test('a restart loses the pending authorization: unknown receipt, no execution, retirement is idempotent', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const restarted = createChatCheckupBookingService(() => tick);
    assert.deepEqual(await restarted.receipt(f.context, f.command.commandId), { outcome: 'unknown' });
    await assert.rejects(restarted.execute(f.context, f.command.commandId, pin));
    assert.deepEqual(await restarted.revoke(f.context, f.command.commandId), { outcome: 'retired' });
    assert.deepEqual(effects(f.patientId, f.command.commandId), { checkups: [], audits: [] });
});

test('fields not chosen in the native window, another patient, expiry and selection change fail closed', async () => {
    const f = await fixture();
    for (const invalid of [{ ...f.command, approved: true }, { ...f.command, title: 'Prenota tutto' }, { ...f.command, date: '2020-01-01T09:00:00.000Z' },
        { ...f.command, date: 'domani' }, { ...f.command, patientId: randomUUID() }]) await assert.rejects(f.service.preview(f.context, invalid, f.epoch, f.viewId));
    const expired = await fixture(); await expired.service.preview(expired.context, expired.command, expired.epoch, expired.viewId);
    tick += 30_000;
    await assert.rejects(expired.service.execute(expired.context, expired.command.commandId, pin));
    const moved = await fixture(); await moved.service.preview(moved.context, moved.command, moved.epoch, moved.viewId);
    moved.owner.issueSelection({ expectedEpoch: moved.epoch, patientId: moved.patientId, ambulatoryId: moved.context.scopeAmbulatoryId });
    await assert.rejects(moved.service.execute(moved.context, moved.command.commandId, pin));
    for (const value of [expired, moved]) assert.deepEqual(effects(value.patientId, value.command.commandId), { checkups: [], audits: [] });
});

test('native HTTP route: paired session, closed JSON, PIN, no-store and a 403 on replay', async () => {
    const f = await fixture();
    const route = load('../app/api/auth/native/checkup-booking/route.ts') as typeof import('../app/api/auth/native/checkup-booking/route');
    function invoke(body: unknown, paired = true) {
        const headers = new Headers(f.context.request.headers);
        headers.set('x-mediflow-expected-ambulatory-id', f.context.scopeAmbulatoryId);
        if (!paired) headers.delete('x-mediflow-paired-client-token');
        return route.POST(new Request('https://127.0.0.1/api/auth/native/checkup-booking', { method: 'POST', headers, body: JSON.stringify(body) }));
    }
    const opened = await invoke({ operation: 'open', patientId: f.patientId, selectionEpoch: f.epoch });
    assert.equal(opened.status, 200);
    const { viewId, agendaRevision } = await opened.json();
    const preview = { operation: 'preview', command: { ...f.command, expectedAgendaRevision: agendaRevision }, selectionEpoch: f.epoch, viewId };
    assert.equal((await invoke(preview, false)).status, 401);
    assert.equal((await invoke({ ...preview, approved: true })).status, 400);
    assert.equal((await invoke(preview)).status, 200);
    const execute = { operation: 'execute', commandId: f.command.commandId, pin };
    assert.equal((await invoke({ ...execute, date: tomorrow })).status, 400);
    const response = await invoke(execute);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).outcome, 'applied');
    assert.equal((await invoke(execute)).status, 403);
    assert.equal((await (await invoke({ operation: 'receipt', commandId: f.command.commandId })).json()).outcome, 'terminal');
});

test('the portable backup still exports and validates after a chat booking and a rejected one', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    assert.equal((await f.service.execute(f.context, f.command.commandId, pin)).outcome, 'applied');
    const stale = await fixture(); await stale.service.preview(stale.context, stale.command, stale.epoch, stale.viewId);
    const other = await stale.service.open(stale.context, stale.patientId, stale.epoch);
    assert.equal(other.agendaRevision, stale.command.expectedAgendaRevision);
    const winner = { ...stale.command, commandId: randomUUID() };
    await stale.service.preview(stale.context, winner, stale.epoch, other.viewId);
    assert.equal((await stale.service.execute(stale.context, winner.commandId, pin)).outcome, 'applied');
    assert.equal((await stale.service.execute(stale.context, stale.command.commandId, pin)).outcome, 'rejected');
    const auth = load('./security/server-auth') as { requireSession: () => Promise<unknown> };
    const original = auth.requireSession;
    const web = issueSyntheticWebSession({ id: f.context.session.userId, username: f.context.session.username, role: 'admin' }, randomUUID());
    auth.requireSession = async () => web;
    try {
        const route = load('../app/api/system/backup-restore/route.ts') as typeof import('../app/api/system/backup-restore/route');
        const exported = await route.GET();
        assert.equal(exported.status, 200);
        const artifact = await parseBackupArtifact(await exported.json());
        assert.ok(artifact.payload.checkups.some(row => row.id === f.command.commandId));
        for (const [id, outcome] of [[f.command.commandId, 'success'], [stale.command.commandId, 'denied']]) {
            assert.ok((artifact.payload.auditEvents ?? []).some(row => row.requestId === id && row.sourceSurface === 'native' && row.outcome === outcome));
        }
    } finally { auth.requireSession = original; }
});

test('the native view shows the agenda read with the same revision: dates and states only, no free text', async () => {
    const f = await fixture();
    const db = dbServer.$client;
    // Un solo istante per scritture e attese: letto due volte, a cavallo di un secondo i due valori divergono.
    const now = Math.floor(Date.now() / 1000);
    const at = (days: number) => now + days * 86_400;
    db.prepare("INSERT INTO checkups (id,patient_id,date,title,notes,status,version) VALUES (?,?,?,?,?,?,1)").run(randomUUID(), f.patientId, at(9), 'Testo libero da non mostrare', 'ENC:a:b', 'done');
    db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version,deleted_at) VALUES (?,?,?,?,?,1,?)").run(randomUUID(), f.patientId, at(3), 'Eliminato', 'pending', at(0));
    db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(randomUUID(), f.patientId, at(2), 'Altro', 'pending');
    const view = await f.service.open(f.context, f.patientId, f.epoch);
    assert.deepEqual(view.rows, [{ date: new Date(at(2) * 1000).toISOString(), status: 'pending' }, { date: new Date(at(9) * 1000).toISOString(), status: 'completed' }]);
    assert.equal(view.omitted, 0);
    assert.equal(JSON.stringify(view).includes('Testo libero'), false);
    assert.notEqual(view.agendaRevision, f.command.expectedAgendaRevision);
    await assert.rejects(f.service.preview(f.context, f.command, f.epoch, view.viewId));
    for (let i = 0; i < 20; i++) db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(randomUUID(), f.patientId, at(10 + i), 'Serie', 'pending');
    const full = await f.service.open(f.context, f.patientId, f.epoch);
    assert.deepEqual([full.rows.length, full.omitted], [20, 2]);
});

test('a long history does not hide the upcoming agenda: only checkups from today, nearest first, with the count left out', async () => {
    const f = await fixture();
    const db = dbServer.$client;
    const day = 86_400, now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 25; i++) db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(randomUUID(), f.patientId, now - (400 + i) * day, 'Storico', 'completed');
    db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(randomUUID(), f.patientId, now + 13 * day, 'Collega', 'pending');
    const view = await f.service.open(f.context, f.patientId, f.epoch);
    assert.deepEqual(view.rows, [{ date: new Date((now + 13 * day) * 1000).toISOString(), status: 'pending' }]);
    assert.equal(view.omitted, 0);
    db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(randomUUID(), f.patientId, now - 500 * day, 'Storico', 'completed');
    await assert.rejects(f.service.preview(f.context, { ...f.command, expectedAgendaRevision: view.agendaRevision }, f.epoch, view.viewId));
});

test('a row created with the command id after the preview is never this booking: no applied receipt from execute', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const other = randomUUID();
    dbServer.$client.prepare("INSERT INTO patients (id,first_name,last_name,tax_code) VALUES (?,?,?,?)").run(other, 'Altro', 'Paziente', randomUUID());
    dbServer.$client.prepare("INSERT INTO patients_to_ambulatories (patient_id,ambulatory_id) VALUES (?,?)").run(other, f.context.scopeAmbulatoryId);
    dbServer.$client.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(f.command.commandId, other, Math.floor(Date.now() / 1000) + 86_400, 'Scelto da un altro canale', 'pending');
    const result = await f.service.execute(f.context, f.command.commandId, pin).then(r => r.outcome, () => 'denied');
    assert.notEqual(result, 'applied');
    assert.equal(effects(f.patientId, f.command.commandId).checkups.length, 0);
});

test('the revision changes when a row is replaced even if count and version sum stay equal', async () => {
    const f = await fixture();
    const db = dbServer.$client;
    const insert = (id: string) => db.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(id, f.patientId, Math.floor(Date.now() / 1000) + 86_400, 'Controllo', 'pending');
    insert(randomUUID());
    const view = await f.service.open(f.context, f.patientId, f.epoch);
    const command = { ...f.command, expectedAgendaRevision: view.agendaRevision };
    await f.service.preview(f.context, command, f.epoch, view.viewId);
    db.prepare('DELETE FROM checkups WHERE patient_id=?').run(f.patientId);
    insert(randomUUID());
    const outcome = await f.service.execute(f.context, command.commandId, pin);
    assert.deepEqual([outcome.outcome, outcome.reason], ['rejected', 'version_conflict']);
    const revision = dbServer.transaction(tx => agendaRevision(tx, f.patientId), { behavior: 'immediate' });
    assert.notEqual(revision, view.agendaRevision);
});

test('a booked row restored without its audit reads as applied, never as retired', async () => {
    const f = await fixture();
    dbServer.$client.prepare("INSERT INTO checkups (id,patient_id,date,title,status,version) VALUES (?,?,?,?,?,1)").run(f.command.commandId, f.patientId, Math.floor(Date.now() / 1000) + 86_400, 'Controllo', 'pending');
    const restarted = createChatCheckupBookingService(() => tick);
    const recovered = await restarted.receipt(f.context, f.command.commandId);
    assert.equal(recovered.outcome, 'terminal');
    if (recovered.outcome === 'terminal') assert.deepEqual([recovered.receipt.outcome, recovered.receipt.historical, recovered.receipt.auditEventId], ['applied', true, null]);
    assert.deepEqual(await restarted.revoke(f.context, f.command.commandId), { outcome: 'applied' });
    await assert.rejects(restarted.revoke({ ...f.context, scopeAmbulatoryId: randomUUID() }, f.command.commandId));
    const other = randomUUID();
    dbServer.insert(patients).values({ id: other, firstName: 'Altro', lastName: 'Paziente', taxCode: randomUUID() }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: other, ambulatoryId: f.context.scopeAmbulatoryId }).run();
    f.owner.issueSelection({ expectedEpoch: f.epoch, patientId: other, ambulatoryId: f.context.scopeAmbulatoryId });
    await assert.rejects(restarted.revoke(f.context, f.command.commandId));
    await assert.rejects(restarted.receipt(f.context, f.command.commandId));
});

test('a receipt imported by a restore is marked historical', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const receipt = await f.service.execute(f.context, f.command.commandId, pin);
    dbServer.$client.prepare("INSERT INTO portable_import_origins (kind,ref,import_event_id,origin) VALUES ('audit',?,?,'imported')").run(receipt.auditEventId, receipt.auditEventId);
    const recovered = await createChatCheckupBookingService(() => tick).receipt(f.context, f.command.commandId);
    assert.equal(recovered.outcome === 'terminal' && recovered.receipt.historical, true);
});

test('dates are accepted from the start of the local day, not from 24 hours earlier', () => {
    const now = new Date(); now.setHours(10, 0, 0, 0);
    const local = (days: number, hours: number) => { const at = new Date(now); at.setDate(at.getDate() + days); at.setHours(hours, 0, 0, 0); return at.toISOString(); };
    const command = { commandId: randomUUID(), protocol: 'checkup.booking.v1', archiveGeneration: currentArchiveGeneration(), patientId: 'p', expectedAgendaRevision: 'a'.repeat(64), title: 'Controllo' };
    assert.ok(parseCheckupBookingCommand({ ...command, date: local(0, 8) }, now.getTime()));
    assert.equal(parseCheckupBookingCommand({ ...command, date: local(-1, 20) }, now.getTime()), null);
    assert.equal(parseCheckupBookingCommand({ ...command, date: local(0, 9), expectedAgendaRevision: 7 }, now.getTime()), null);
});

test.after(() => { cleanup(); dbServer.$client.close(); });
