import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, users, settings } from '../schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../network-pairing-model';
import { currentArchiveGeneration } from './archive-session-generation';
import { clearAllSessions, retireServerSessionForLogout } from './server-session';
import { beginWebAuthControl, issueWebAuthControl } from './web-auth-control-transport';
import type { AmbulatoryCommandMarker } from '../ambulatory-destructive-command-contract';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'ambulatory-command-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server'); openDbServer();
const { createAmbulatoryDestructiveService, AMBULATORY_COMMAND_REFERENCE_HEADER } = load('./ambulatory-destructive-service.ts') as typeof import('./ambulatory-destructive-service');
const { deleteAmbulatory, createAmbulatory } = load('../ambulatory-write.ts') as typeof import('../ambulatory-write');
const sql = dbServer.$client;
const origin = 'http://127.0.0.1:31998';
type Service = ReturnType<typeof createAmbulatoryDestructiveService>;
type Native = ReturnType<typeof syntheticNetworkPatientAuthority>;
test.after(() => { clearAllSessions(); cleanup(); sql.close(); });

function seed() {
    clearAllSessions(); cookieState.cookies.clear();
    sql.exec('DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
    dbServer.update(users).set({ role: 'admin' }).run();
    dbServer.insert(ambulatories).values([{ id: 'scope', name: 'Sede inventata', type: 'live', isDefault: true, version: 1, createdAt: new Date(1000) },
        { id: 'target', name: 'Test inventato', type: 'test', isDefault: false, version: 1, createdAt: new Date(2000) }]).run();
    const native = syntheticNetworkPatientAuthority(dbServer, 'scope');
    native.pairedClient.grantedCapabilities.push('network.ambulatories.write');
    setClients([native.pairedClient]);
    return native;
}
function setClients(clients: Native['pairedClient'][]) {
    dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients, intents: [] })), archiveGeneration: currentArchiveGeneration() }) })
        .where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}
function request(headers: Record<string, string> = {}) {
    return new Request(`${origin}/api/auth/ambulatory-commands`, { method: 'POST', headers: {
        origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-mediflow-archive-generation': currentArchiveGeneration(), ...headers } });
}
function open(service: Service, native: Native, marker?: AmbulatoryCommandMarker, operation = 'ambulatory.clear-test.v1') {
    const initial = request({ ...Object.fromEntries(native.request.headers), 'x-mediflow-expected-ambulatory-id': 'scope' });
    const command = marker ?? { operation, originalScopeId: 'scope', ambulatoryId: 'target', expectedVersion: 1 };
    const opened = service.begin(initial, native.session, native.pairedClient, { purpose: marker ? 'recover' : 'execute', command }, marker ? null : 'scope');
    assert.equal(opened.status, 200, JSON.stringify(opened.value)); assert.ok(opened.control);
    const login = () => {
        const attempt = beginWebAuthControl('login', Object.freeze({ controlId: opened.control!.controlId, ifMatch: opened.control!.etag, idempotencyKey: randomUUID() }));
        assert.ok(attempt);
        const web = issueWebAuthControl(attempt, { id: native.session.userId, username: native.session.username, role: native.session.role }); assert.ok(web);
        return { 'x-mediflow-archive-generation': initial.headers.get('x-mediflow-archive-generation')!, [AMBULATORY_COMMAND_REFERENCE_HEADER]: String(opened.value.reference), cookie: `mediflow_session=${web.sessionId}; mediflow_auth_control=${opened.control!.controlId}` };
    };
    return { opened, initial, login };
}
function prepare(service: Service, native: Native, operation?: string) {
    const flow = open(service, native, undefined, operation), headers = flow.login();
    const preview = service.preview(request(headers)); assert.equal(preview.status, 200, JSON.stringify(preview.value));
    const marker = preview.value.marker as AmbulatoryCommandMarker;
    const execute = () => service.execute(request(headers), { operation: marker.operation, planDigest: marker.planDigest,
        confirmation: marker.operation === 'ambulatory.clear-test.v1' ? 'SVUOTA' : 'ELIMINA' });
    return { ...flow, headers, marker, execute, preview };
}
function recover(service: Service, native: Native, marker: AmbulatoryCommandMarker, close = false) {
    const flow = open(service, native, marker); return service.recover(request(flow.login()), close);
}
function patient(id: string, live = false) {
    dbServer.insert(patients).values({ id, firstName: 'PRIVATE-FIRST', lastName: 'PRIVATE-LAST', taxCode: id, version: 1, notes: 'PRIVATE-NOTE' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'target' }).run();
    if (live) dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'scope' }).run();
}
function snapshot() {
    return { ambulatory: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(), patients: sql.prepare('SELECT * FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all(), ledger: sql.prepare('SELECT * FROM ambulatory_destructive_commands ORDER BY command_id').all() };
}

test('one clear command, audited exact effects, public receipt excludes patient plan and audit snapshots', () => {
    const native = seed(), service = createAmbulatoryDestructiveService(); patient('test-only'); patient('live', true);
    const flow = prepare(service, native), before = snapshot();
    const accepted = flow.execute(); assert.equal(accepted.status, 200);
    assert.equal(accepted.value.outcome, 'terminal');
    const receipt = accepted.value.receipt as Record<string, unknown>; assert.equal(receipt.outcome, 'applied');
    assert.deepEqual(receipt.result, { targetVersion: 2, affectedAmbulatories: [{ id: 'target', version: 2 }],
        clear: { tombstonedPatients: 1, unlinkedPatients: 1, preservedLivePatients: 1, removedMembershipRows: 2 } });
    assert.doesNotMatch(JSON.stringify(accepted.value), /PRIVATE-|auditSnapshots|auditEventId|deviceTokenHash|patientId/);
    const after = snapshot(); assert.equal(after.audit.length - before.audit.length, 3); assert.equal(after.ledger.length - before.ledger.length, 1);
    assert.deepEqual(flow.execute(), accepted); assert.deepEqual(snapshot(), after);
    assert.equal(recover(createAmbulatoryDestructiveService(), native, flow.marker).value.outcome, 'terminal');
});

for (const mutation of ['different-patient', 'other-type', 'lifecycle'] as const) {
    test(`changed ${mutation} rejects the frozen plan with no clinical or success-audit effect`, () => {
        const native = seed(), service = createAmbulatoryDestructiveService(); patient('original', true);
        const flow = prepare(service, native);
        if (mutation === 'different-patient') { dbServer.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.ambulatoryId, 'target')).run(); patient('replacement', true); }
        if (mutation === 'other-type') dbServer.update(ambulatories).set({ type: 'test' }).where(eq(ambulatories.id, 'scope')).run();
        if (mutation === 'lifecycle') dbServer.update(patients).set({ deletedAt: new Date(1000), deletionReason: 'prior' }).run();
        const before = snapshot();
        const denied = flow.execute(); assert.equal((denied.value.receipt as Record<string, unknown>).outcome, 'rejected');
        const after = snapshot(); assert.deepEqual(after.ambulatory, before.ambulatory); assert.deepEqual(after.patients, before.patients);
        assert.deepEqual(after.memberships, before.memberships); assert.deepEqual(after.audit, before.audit);
        assert.equal(after.ledger.length, before.ledger.length + 1);
    });
}

for (const [table, operation] of [['audit_events', 'INSERT'], ['patients', 'UPDATE'], ['ambulatories', 'UPDATE'], ['patients_to_ambulatories', 'DELETE'], ['ambulatory_destructive_commands', 'INSERT']] as const) {
    for (const fault of ['ABORT', 'IGNORE']) test(`${table} ${fault} rolls back effect, audit and command receipt`, () => {
        const native = seed(), service = createAmbulatoryDestructiveService(); patient('one');
        const flow = prepare(service, native), before = snapshot();
        sql.exec(`CREATE TRIGGER synthetic_ambulatory_fault BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(${fault}${fault === 'ABORT' ? ", 'synthetic fault'" : ''}); END`);
        try { assert.throws(flow.execute); } finally { sql.exec('DROP TRIGGER synthetic_ambulatory_fault'); }
        assert.deepEqual(snapshot(), before);
        assert.equal(flow.execute().status, 409, 'failed dispatch is not rearmed');
        assert.equal(recover(service, native, flow.marker).value.outcome, 'unknown');
    });
}

test('close of absent command uses original binding without current target/scope/CAS and blocks late execute', () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native);
    dbServer.delete(ambulatories).run();
    const before = snapshot(), closed = recover(createAmbulatoryDestructiveService(), native, flow.marker, true);
    assert.equal((closed.value.receipt as Record<string, unknown>).outcome, 'closed');
    assert.equal((flow.execute().value.receipt as Record<string, unknown>).outcome, 'closed');
    assert.deepEqual(snapshot().ambulatory, before.ambulatory); assert.deepEqual(snapshot().audit, before.audit);
});

test('delete receipt survives target and scope disappearance, without selecting a replacement scope', () => {
    const native = seed(), service = createAmbulatoryDestructiveService();
    const flow = prepare(service, native, 'ambulatory.delete.v1');
    const accepted = flow.execute(); assert.equal((accepted.value.receipt as Record<string, unknown>).outcome, 'applied');
    dbServer.delete(ambulatories).run();
    const after = recover(createAmbulatoryDestructiveService(), native, flow.marker);
    assert.deepEqual(after, accepted);
});

test('legacy no-event target deleted and recreated through canonical writers invalidates ABA preview', () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native, 'ambulatory.delete.v1');
    const web = { ...native.session, authChannel: 'web' as const };
    assert.equal(deleteAmbulatory({ request: request(), session: web }, 'target', 1).status, 200);
    assert.equal(createAmbulatory({ request: request(), session: web }, { id: 'target', name: 'Test inventato', type: 'test', isDefault: false, createdAt: new Date(2000) }).status, 201);
    const before = snapshot();
    assert.equal((flow.execute().value.receipt as Record<string, unknown>).outcome, 'rejected');
    assert.deepEqual(snapshot().ambulatory, before.ambulatory); assert.deepEqual(snapshot().audit, before.audit);
});

test('challenge starts after login completes and expires without renewal', () => {
    let offset = -90_000;
    const native = seed(), service = createAmbulatoryDestructiveService({ now: () => Date.now() + offset }), flow = open(service, native);
    offset = 0;
    const headers = flow.login(), preview = service.preview(request(headers));
    assert.equal(preview.status, 200, '90 seconds of login preparation do not consume the 30-second authorization');
    offset = 30_001;
    const marker = preview.value.marker as AmbulatoryCommandMarker, before = snapshot();
    assert.equal(service.execute(request(headers), { operation: marker.operation, planDigest: marker.planDigest, confirmation: 'SVUOTA' }).value.code, 'AMBULATORY_CHALLENGE_EXPIRED');
    offset = 0;
    assert.equal(service.preview(request(headers)).value.code, 'AMBULATORY_AUTHORIZATION_EXPIRED', 'clock rollback must not revive an expired authorization'); assert.deepEqual(snapshot(), before);
});

test('another control cannot confirm and native revocation denies use while exact WebP3 retirement remains available', async () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), a = prepare(service, native), b = prepare(service, native);
    const bad = { ...a.headers, cookie: b.headers.cookie }, before = snapshot();
    assert.equal(service.execute(request(bad), { operation: a.marker.operation, planDigest: a.marker.planDigest, confirmation: 'SVUOTA' }).status, 401);
    assert.deepEqual(snapshot(), before);
    retireServerSessionForLogout(native.session.id);
    assert.equal(a.execute().status, 401); assert.deepEqual(snapshot(), before);
    assert.equal((await service.retire(request(a.headers))).status, 204);
});

test('same actor on another paired device cannot read or close the receipt', () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native); flow.execute();
    const other = syntheticNetworkPatientAuthority(dbServer, 'scope', { clientId: 'synthetic-other-device' });
    other.pairedClient.grantedCapabilities.push('network.ambulatories.write'); setClients([native.pairedClient, other.pairedClient]);
    const before = snapshot();
    assert.equal(recover(service, other, flow.marker).status, 403); assert.equal(recover(service, other, flow.marker, true).status, 403);
    assert.deepEqual(snapshot(), before);
});

test('manual and scheduled serializers retain exact terminals while JSON restore unions postbackup rows without replay', async () => {
    const native = seed(), service = createAmbulatoryDestructiveService(); patient('backup-patient');
    const applied = prepare(service, native); assert.equal((applied.execute().value.receipt as Record<string, unknown>).outcome, 'applied');
    const { captureAmbulatoryCommands, readAmbulatoryCommandRows, validateAmbulatoryCommandRows } = await import('../ambulatory-destructive-command-backup');
    const { createEmptyDataset, createBackupArtifact, parseBackupArtifact } = await import('../backup-artifact');
    const { restoreBackupArtifact } = await import('../backup-restore-executor');
    const { serializeBackupArtifact } = await import('../../scripts/run-scheduled-backup.mjs');
    const captured = captureAmbulatoryCommands(sql);
    const payload = { ...createEmptyDataset(), ambulatoryDestructiveCommands: captured.rows, auditEvents: captured.audits };
    const artifact = await createBackupArtifact(payload);
    const parsed = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(payload)));
    assert.deepEqual(parsed.payload.ambulatoryDestructiveCommands, artifact.payload.ambulatoryDestructiveCommands);
    dbServer.update(ambulatories).set({ version: 1 }).where(eq(ambulatories.id, 'target')).run();
    const closed = prepare(service, native);
    assert.equal((recover(service, native, closed.marker, true).value.receipt as Record<string, unknown>).outcome, 'closed');
    const afterBackup = readAmbulatoryCommandRows(sql);
    const collided = { ...payload, ambulatoryDestructiveCommands: captured.rows.map(row => row.commandId === applied.marker.commandId ? { ...row, deviceTokenHash: 'f'.repeat(64) } : row) };
    const invalid = await createBackupArtifact(collided); let fences = 0;
    const before = snapshot();
    assert.throws(() => restoreBackupArtifact(invalid, () => { fences++; return true; }), /ambulatory command/);
    assert.equal(fences, 0); assert.deepEqual(snapshot(), before);
    restoreBackupArtifact(artifact, () => true);
    assert.deepEqual(readAmbulatoryCommandRows(sql), afterBackup);
    assert.equal(sql.prepare<[], { n: number }>('SELECT count(*) n FROM patients').get()!.n, 0, 'historical applied does not recreate its patient effect');
    const current = syntheticNetworkPatientAuthority(dbServer, 'absent');
    current.pairedClient.grantedCapabilities.push('network.ambulatories.write'); setClients([current.pairedClient]);
    const observed = recover(createAmbulatoryDestructiveService(), current, applied.marker);
    assert.equal(observed.value.historical, true);
    assert.equal((observed.value.receipt as Record<string, unknown>).outcome, 'applied');
    validateAmbulatoryCommandRows(readAmbulatoryCommandRows(sql), captureAmbulatoryCommands(sql).audits);
});

for (const [mutation, validationError, blockedReason] of [
    ['result-json', SyntaxError, 'ambulatory_destructive_commands'],
    ['result-shape', /Invalid ambulatory command receipt/, 'ambulatory_destructive_commands'],
    ['snapshots-json', SyntaxError, 'ambulatory_destructive_commands'],
    ['snapshots-shape', /Backup audit collection is invalid/, 'ambulatory_destructive_commands'],
    ['missing-audit', /Ambulatory command audit binding/, 'ambulatory_destructive_commands'],
    ['altered-audit', /Ambulatory command audit binding/, 'therapy_status_commands'],
    ['actor-binding', /Ambulatory command audit binding/, 'therapy_status_commands'],
    ['request-binding', /Ambulatory command audit binding/, 'therapy_status_commands'],
    ['version-binding', /Ambulatory command main audit version/, 'therapy_status_commands'],
] as const) {
    test(`restore rejects applied command ${mutation} before the mutation fence with the archive unchanged`, async () => {
        const native = seed(), service = createAmbulatoryDestructiveService(); patient('invalid-backup-patient');
        const applied = prepare(service, native); assert.equal((applied.execute().value.receipt as Record<string, unknown>).outcome, 'applied');
        const { captureAmbulatoryCommands, validateAmbulatoryCommandRows } = await import('../ambulatory-destructive-command-backup');
        const { createEmptyDataset, createBackupArtifact, BackupArtifactError } = await import('../backup-artifact');
        const { restoreBackupArtifact, BackupRestoreBlockedError } = await import('../backup-restore-executor');
        const captured = captureAmbulatoryCommands(sql);
        const original = captured.rows.find(row => row.commandId === applied.marker.commandId); assert.ok(original);
        const payload = { ...createEmptyDataset(), ambulatoryDestructiveCommands: [structuredClone(original)], auditEvents: structuredClone(captured.audits) };
        const artifact = await createBackupArtifact(payload);
        assert.deepEqual(validateAmbulatoryCommandRows(payload.ambulatoryDestructiveCommands, payload.auditEvents), payload.ambulatoryDestructiveCommands);
        const row = payload.ambulatoryDestructiveCommands[0];
        const snapshots = JSON.parse(row.auditSnapshots as string) as typeof payload.auditEvents;
        const main = snapshots.find(audit => audit.eventType === 'ambulatory.cleared'); assert.ok(main);
        const audit = payload.auditEvents.find(audit => audit.eventId === main.eventId); assert.ok(audit);
        if (mutation === 'result-json') row.resultJson = '{';
        else if (mutation === 'result-shape') row.resultJson = JSON.stringify({ ...JSON.parse(row.resultJson as string), targetVersion: 0 });
        else if (mutation === 'snapshots-json') row.auditSnapshots = '[';
        else if (mutation === 'snapshots-shape') row.auditSnapshots = '{}';
        else if (mutation === 'missing-audit') payload.auditEvents = payload.auditEvents.filter(value => value.eventId !== main.eventId);
        else if (mutation === 'altered-audit') audit.occurredAt += 1;
        else {
            if (mutation === 'actor-binding') main.actorRef = audit.actorRef = 'synthetic-other-actor';
            else if (mutation === 'request-binding') main.requestId = audit.requestId = randomUUID();
            else {
                const metadata = JSON.parse(main.redactedMetadata!); metadata.resourceVersion += 1;
                main.redactedMetadata = audit.redactedMetadata = JSON.stringify(metadata);
            }
            row.auditSnapshots = JSON.stringify(snapshots);
        }
        const before = snapshot(), generation = currentArchiveGeneration();
        assert.throws(() => validateAmbulatoryCommandRows(payload.ambulatoryDestructiveCommands, payload.auditEvents), validationError);
        await assert.rejects(createBackupArtifact(payload), error => error instanceof BackupArtifactError
            && error.code === 'invalid-manifest' && error.message === 'Ambulatory command ledger or audit is invalid.');
        let fences = 0;
        assert.throws(() => restoreBackupArtifact({ ...artifact, payload }, () => { fences++; return true; }),
            error => error instanceof BackupRestoreBlockedError && error.reason === blockedReason);
        assert.equal(fences, 0); assert.deepEqual(snapshot(), before); assert.equal(currentArchiveGeneration(), generation);
    });
}

test('raw staged replacement preserves local postbackup ledger and its audits while clinical state comes from the snapshot', async () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native);
    flow.execute();
    const { captureAmbulatoryCommands, preserveAmbulatoryCommands, readAmbulatoryCommandRows } = await import('../ambulatory-destructive-command-backup');
    const { openVersionedSqliteDatabase } = await import('../sqlite-schema-open');
    const { replaceSqliteDatabase, createVerifiedSqliteSnapshotSync } = await import('../sqlite-repair');
    const { rotateSqliteArchiveGeneration } = await import('../archive-generation');
    const root = mkdtempSync(join(dataDir, 'raw-')), source = join(root, 'old.db'), destination = join(root, 'medical.db');
    openVersionedSqliteDatabase(source).close(); createVerifiedSqliteSnapshotSync(sql.name, destination);
    const current = openVersionedSqliteDatabase(destination), captured = captureAmbulatoryCommands(current);
    let installed: Database.Database | undefined;
    try {
        await replaceSqliteDatabase({ sourcePath: source, destPath: destination, connection: current,
            prepareReplacement: staging => { const candidate = openVersionedSqliteDatabase(staging, undefined, { prepareReplacement: true });
                try { candidate.transaction(() => { preserveAmbulatoryCommands(captured, candidate); rotateSqliteArchiveGeneration(candidate); }).immediate(); }
                finally { candidate.close(); } },
            reopenConnection: () => { installed = openVersionedSqliteDatabase(destination); return installed; } });
        assert.deepEqual(readAmbulatoryCommandRows(installed!), captured.rows);
        assert.equal(installed!.prepare<[], { n: number }>('SELECT count(*) n FROM patients').get()!.n, 0);
        captureAmbulatoryCommands(installed!);
    } finally { if (current.open) current.close(); if (installed?.open) installed.close(); }
});

test('authorization expiring after the first check is rechecked after plan inspection before any DML', () => {
    let dispatch = false, calls = 0;
    const native = seed(), service = createAmbulatoryDestructiveService({ now: () => Date.now() + (dispatch && ++calls >= 6 ? 31_000 : 0) });
    const flow = prepare(service, native), before = snapshot(); dispatch = true;
    assert.equal(flow.execute().value.code, 'AMBULATORY_CHALLENGE_EXPIRED');
    assert.deepEqual(snapshot(), before);
});
for (const fault of ['ABORT', 'IGNORE']) test(`delete ${fault} after fallback promotion rolls back versions, all audits and receipt`, () => {
    const native = seed(), service = createAmbulatoryDestructiveService();
    dbServer.update(ambulatories).set({ isDefault: false }).where(eq(ambulatories.id, 'scope')).run();
    dbServer.update(ambulatories).set({ isDefault: true }).where(eq(ambulatories.id, 'target')).run();
    const flow = prepare(service, native, 'ambulatory.delete.v1'), before = snapshot();
    sql.exec(`CREATE TRIGGER synthetic_delete_fault BEFORE DELETE ON ambulatories BEGIN SELECT RAISE(${fault}${fault === 'ABORT' ? ", 'synthetic fault'" : ''}); END`);
    try { assert.throws(flow.execute); } finally { sql.exec('DROP TRIGGER synthetic_delete_fault'); }
    assert.deepEqual(snapshot(), before);
});
test('role, peer and generation retirement deny confirmation without mutation', async () => {
    const { rotateSqliteArchiveGeneration, ArchiveReplacedError } = await import('../archive-generation');
    for (const change of ['role', 'peer', 'generation']) {
        const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native);
        if (change === 'role') dbServer.update(users).set({ role: 'operator' }).where(eq(users.id, native.session.userId)).run();
        if (change === 'peer') setClients([]);
        if (change === 'generation') sql.transaction(() => rotateSqliteArchiveGeneration(sql)).immediate();
        const before = snapshot();
        if (change === 'generation') assert.throws(flow.execute, ArchiveReplacedError);
        else assert.equal(flow.execute().status, change === 'role' ? 403 : 401);
        assert.deepEqual(snapshot(), before);
    }
});
test('rotated credential on the same declared clientId cannot reconstruct the old receipt authority', async () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native); flow.execute();
    const { hashNetworkPairedClientToken } = await import('../network-pairing-model');
    const { createNativeServerSession, captureNativeLoginSessionFence } = await import('./server-session');
    const { bindSessionToArchive } = await import('./archive-session-generation');
    const token = 'synthetic-repaired-device-token', client = { ...native.pairedClient, tokenHash: hashNetworkPairedClientToken(token) };
    setClients([client]);
    const fresh = createNativeServerSession({ id: native.session.userId, username: native.session.username, role: 'admin' },
        { clientId: client.clientId, clientPlatform: client.clientPlatform, tokenHash: client.tokenHash }, captureNativeLoginSessionFence());
    assert.ok(fresh); bindSessionToArchive(fresh, currentArchiveGeneration());
    const newRequest = new Request(native.request.url, { headers: { ...Object.fromEntries(native.request.headers), 'x-mediflow-paired-client-token': token } });
    const repaired = { ...native, session: fresh, pairedClient: client, request: newRequest }, before = snapshot();
    assert.equal(recover(service, repaired, flow.marker).status, 403);
    assert.equal(recover(service, repaired, flow.marker, true).status, 403);
    assert.deepEqual(snapshot(), before);
});

test('named HTTP transport rejects cross-origin, cross-site, plain text, anonymous and client-selected IDs without clinical effect', async () => {
    const native = seed(), { ambulatoryDestructiveHttp } = await import('./ambulatory-destructive-http');
    cookieState.cookies.set('mediflow_session', native.session.id); cookieState.cookies.set('ambulatory_id', 'scope');
    const body = { purpose: 'execute', command: { operation: 'ambulatory.clear-test.v1', originalScopeId: 'scope', ambulatoryId: 'target', expectedVersion: 1 } };
    const headers = { ...Object.fromEntries(native.request.headers), origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-mediflow-expected-ambulatory-id': 'scope' };
    const before = snapshot();
    for (const patch of [{ origin: 'http://localhost:31998' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) {
        const req = new Request(`${origin}/api/auth/ambulatory-commands/begin`, { method: 'POST', headers: { ...headers, ...patch }, body: JSON.stringify(body) });
        assert.equal((await ambulatoryDestructiveHttp(req, 'begin')).status, 403); assert.equal(req.bodyUsed, false);
    }
    const anonymous = new Request(`${origin}/api/auth/ambulatory-commands/begin`, { method: 'POST', headers: { ...headers, 'x-mediflow-paired-client-token': 'invalid' }, body: JSON.stringify(body) });
    assert.equal((await ambulatoryDestructiveHttp(anonymous, 'begin')).status, 401); assert.equal(anonymous.bodyUsed, false);
    for (const command of [{ ...body.command, commandId: randomUUID() }, { ...body.command, operation: 'first-ambulatory.create.v1' }, { ...body.command, grant: true }]) {
        const req = new Request(`${origin}/api/auth/ambulatory-commands/begin`, { method: 'POST', headers, body: JSON.stringify({ ...body, command }) });
        assert.equal((await ambulatoryDestructiveHttp(req, 'begin')).status, 400);
    }
    const large = new Request(`${origin}/api/auth/ambulatory-commands/begin`, { method: 'POST', headers, body: ' '.repeat(4097) });
    assert.equal((await ambulatoryDestructiveHttp(large, 'begin')).status, 413);
    assert.deepEqual(snapshot(), before);
});

test('production HTTP adapter admits only the dedicated control and named confirmation, then fresh receipt recovery without scope', async () => {
    const native = seed(), { ambulatoryDestructiveHttp } = await import('./ambulatory-destructive-http');
    cookieState.cookies.set('mediflow_session', native.session.id); cookieState.cookies.set('ambulatory_id', 'scope');
    const base = { ...Object.fromEntries(native.request.headers), origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    async function httpBegin(body: unknown, scoped: boolean) {
        const req = new Request(`${origin}/api/auth/ambulatory-commands/begin`, { method: 'POST', headers: { ...base, ...(scoped ? { 'x-mediflow-expected-ambulatory-id': 'scope' } : {}) }, body: JSON.stringify(body) });
        const response = await ambulatoryDestructiveHttp(req, 'begin'); assert.equal(response.status, 200, await response.clone().text());
        const opened = await response.json(), control = /mediflow_auth_control=([^;]+)/u.exec(response.headers.get('set-cookie')!)![1];
        const attempt = beginWebAuthControl('login', Object.freeze({ controlId: control, ifMatch: response.headers.get('etag')!.slice(1, -1), idempotencyKey: randomUUID() })); assert.ok(attempt);
        const issued = issueWebAuthControl(attempt, { id: native.session.userId, username: native.session.username, role: 'admin' }); assert.ok(issued);
        return { [AMBULATORY_COMMAND_REFERENCE_HEADER]: opened.reference, cookie: `mediflow_session=${issued.sessionId}; mediflow_auth_control=${control}` };
    }
    const headers = await httpBegin({ purpose: 'execute', command: { operation: 'ambulatory.clear-test.v1', originalScopeId: 'scope', ambulatoryId: 'target', expectedVersion: 1 } }, true);
    const call = (action: Parameters<typeof ambulatoryDestructiveHttp>[1], body: unknown, headers: Record<string, string>) => ambulatoryDestructiveHttp(new Request(`${origin}/api/auth/ambulatory-commands/${action}`, { method: 'POST', headers: { ...base, ...headers }, body: JSON.stringify(body) }), action);
    const preview = await call('preview', {}, headers); assert.equal(preview.status, 200); const marker = (await preview.json()).marker;
    const before = snapshot();
    assert.equal((await call('execute', { operation: marker.operation, planDigest: marker.planDigest, confirmation: true }, headers)).status, 400); assert.deepEqual(snapshot(), before);
    const accepted = await call('execute', { operation: marker.operation, planDigest: marker.planDigest, confirmation: 'SVUOTA' }, headers);
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('cache-control'), 'no-store');
    dbServer.delete(ambulatories).run();
    const recovery = await httpBegin({ purpose: 'recover', command: marker }, false), result = await call('receipt', {}, recovery);
    assert.equal(result.status, 200); assert.equal((await result.json()).receipt.outcome, 'applied');
    assert.equal((await call('execute', { operation: marker.operation, planDigest: marker.planDigest, confirmation: 'SVUOTA' }, recovery)).status, 401);
    assert.equal((await call('retire', {}, recovery)).status, 204);
});

test('raw replacement rejects a divergent terminal before target promotion and preserves the local ledger', async () => {
    const native = seed(), service = createAmbulatoryDestructiveService(), flow = prepare(service, native);
    recover(service, native, flow.marker, true);
    const { captureAmbulatoryCommands, preserveAmbulatoryCommands, insertAmbulatoryCommandUnion, readAmbulatoryCommandRows } = await import('../ambulatory-destructive-command-backup');
    const { openVersionedSqliteDatabase } = await import('../sqlite-schema-open');
    const { replaceSqliteDatabase, createVerifiedSqliteSnapshotSync } = await import('../sqlite-repair');
    const { statSync } = await import('node:fs');
    const root = mkdtempSync(join(dataDir, 'raw-collision-')), source = join(root, 'old.db'), destination = join(root, 'medical.db');
    const candidate = openVersionedSqliteDatabase(source), closed = captureAmbulatoryCommands(sql).rows.find(row => row.commandId === flow.marker.commandId)!;
    candidate.transaction(() => insertAmbulatoryCommandUnion(candidate, [{ ...closed, deviceTokenHash: 'f'.repeat(64) }])).immediate(); candidate.close();
    createVerifiedSqliteSnapshotSync(sql.name, destination); const beforeInode = statSync(destination).ino;
    const current = openVersionedSqliteDatabase(destination), captured = captureAmbulatoryCommands(current);
    try {
        await assert.rejects(replaceSqliteDatabase({ sourcePath: source, destPath: destination, connection: current,
            reopenConnection: () => { assert.fail('collision must precede promotion and reopen'); },
            prepareReplacement: staging => { const replacement = openVersionedSqliteDatabase(staging, undefined, { prepareReplacement: true });
                try { preserveAmbulatoryCommands(captured, replacement); } finally { replacement.close(); } },
        }), /collision/);
    } finally { if (current.open) current.close(); }
    assert.equal(statSync(destination).ino, beforeInode);
    const after = openVersionedSqliteDatabase(destination);
    try { assert.deepEqual(readAmbulatoryCommandRows(after), captured.rows); captureAmbulatoryCommands(after); } finally { after.close(); }
});
