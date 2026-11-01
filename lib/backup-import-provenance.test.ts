import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackupArtifact, createEmptyDataset, type BackupDataset } from './backup-artifact';
import { snapshotBackupAudit, type BackupAuditRow } from './backup-audit';

const root = process.env.MEDIFLOW_DATA_DIR || tmpdir();
mkdirSync(root, { recursive: true });
process.env.MEDIFLOW_DATA_DIR = mkdtempSync(join(root, 'origin-'));
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { users, patients, therapies, auditEvents } = load('./schema.ts') as typeof import('./schema.ts');
const { bindSyntheticArchiveSessions, issueSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { executeTherapyStatusCommand, readTherapyStatusReceipt } = load('./therapy-status-command-service.ts') as typeof import('./therapy-status-command-service.ts');
const { restoreBackupArtifact } = load('./backup-restore-executor.ts') as typeof import('./backup-restore-executor.ts');
const { listAuditEvents, summarizeAuditEvents } = load('./security/audit.ts') as typeof import('./security/audit.ts');
const generation = bindSyntheticArchiveSessions('synthetic-origin-bootstrap');
const syntheticUsername = 'synthetic-origin-admin';
const actor = { id: 'synthetic-origin-admin', username: syntheticUsername, role: 'admin' };
dbServer.insert(users).values({ ...actor, passwordHash: 'synthetic', encryptedMasterKey: 'synthetic', salt: 'synthetic' }).run();
const session = issueSyntheticWebSession(actor, 'origin-before');
const sql = openDbServer();
const localCommand = { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: generation, patientId: 'local-patient', therapyId: 'local-therapy', expectedVersion: 1 };
dbServer.insert(patients).values({ id: localCommand.patientId, firstName: 'Persona', lastName: 'Sintetica', taxCode: 'SYNTHETIC-ORIGIN' }).run();
dbServer.insert(therapies).values({ id: localCommand.therapyId, patientId: localCommand.patientId, drugName: 'Farmaco sintetico', dosage: 'Dose sintetica', status: 'active', startDate: new Date(), version: 1 }).run();
const localReceipt = executeTherapyStatusCommand(session, { ...localCommand, target: 'suspended' });
const localAudit = sql.prepare('SELECT * FROM audit_events WHERE event_id=?').get(localReceipt.auditEventId);

let imported: BackupDataset['therapyStatusCommands'];
let forged: BackupAuditRow;
let afterSession: ReturnType<typeof issueSyntheticWebSession>;
test('real restore of a hostile ledger keeps exact history but the readers never attest local execution', async () => {
    const commandId = randomUUID(), eventId = randomUUID(), committedAt = Math.floor(Date.now() / 1000);
    forged = { eventId, schemaVersion: 1, eventType: 'therapy.updated', occurredAt: committedAt, outcome: 'success', actorType: 'user', actorRef: actor.id,
        subjectType: 'therapy', subjectRef: 'imported-therapy', sourceSurface: 'native', requestId: commandId, redactedMetadata: JSON.stringify({ resourceVersion: 2 }), createdAt: committedAt };
    const row = { commandId, protocol: 'therapy.status.change.v1', archiveGeneration: generation, actorRef: actor.id, patientId: 'imported-patient', therapyId: 'imported-therapy',
        expectedVersion: 1, target: 'suspended', outcome: 'applied', reason: null, committedAt, resultVersion: 2, resultEndDate: null, auditEventId: eventId, auditSnapshot: JSON.stringify(forged) };
    imported = [row, { ...row, commandId: randomUUID(), target: null, outcome: 'closed', resultVersion: null, auditEventId: null, auditSnapshot: null },
        { ...row, commandId: randomUUID(), target: 'active', outcome: 'rejected', reason: 'version_conflict', resultVersion: null, auditEventId: null, auditSnapshot: null }];
    const payload = createEmptyDataset(); payload.therapyStatusCommands = imported;
    payload.auditEvents = [forged, ...Array.from({ length: 650 }, (_, index) => ({ ...forged, eventId: `synthetic-flood-${index}`, requestId: null, occurredAt: committedAt + index + 1 }))];
    const artifact = await createBackupArtifact(payload);
    restoreBackupArtifact(artifact, () => false);
    afterSession = issueSyntheticWebSession(actor, 'origin-after');
    for (const row of imported!) {
        const { commandId, protocol, archiveGeneration, patientId, therapyId, expectedVersion } = row;
        const receipt = readTherapyStatusReceipt(afterSession, { commandId, protocol, archiveGeneration, patientId, therapyId, expectedVersion } as typeof localCommand);
        assert.equal(receipt.outcome, 'terminal');
        if (receipt.outcome === 'terminal') {
            assert.equal(receipt.origin, 'imported'); assert.equal(receipt.historical, true); assert.equal(receipt.receipt.outcome, row.outcome);
        }
    }
    const preservedLocal = readTherapyStatusReceipt(afterSession, localCommand);
    assert.equal(preservedLocal.outcome, 'terminal');
    if (preservedLocal.outcome === 'terminal') assert.equal(preservedLocal.origin, 'local');
    assert.deepEqual(sql.prepare('SELECT * FROM audit_events WHERE event_id=?').get(localReceipt.auditEventId), localAudit);
    const saved = dbServer.select().from(auditEvents).all().find(row => row.eventId === eventId)!;
    assert.deepEqual(snapshotBackupAudit(saved), forged);
});

test('imported events and their markers cannot occupy the local read limit or inflate local metrics', async () => {
    const local = await listAuditEvents({ limit: 2, eventType: 'therapy.updated' });
    assert.equal(local.length, 1); assert.equal(local[0]!.eventId, localReceipt.auditEventId); assert.equal(local[0]!.origin, 'local');
    const history = await listAuditEvents({ limit: 200, origin: 'imported' });
    assert.equal(history.length, 200); assert.ok(history.every(row => row.origin === 'imported'));
    const exact = await listAuditEvents({ origin: 'imported', eventType: 'therapy.updated', actorRef: actor.id, limit: 200 });
    assert.equal(exact.length, 200);
    const summary = summarizeAuditEvents([...local, ...history]);
    assert.equal(summary.totalEvents, 1); assert.equal(summary.importedEvents, 200);
    assert.equal(summary.sourceSurfaces.native, 0); assert.equal(summary.sourceSurfaces.web, 1);
    assert.deepEqual(summary.topEventTypes, [{ eventType: 'therapy.updated', count: 1 }]);
    const ordinary = await listAuditEvents({ limit: 200 });
    assert.ok(ordinary.some(row => row.eventId === localReceipt.auditEventId));
    assert.ok(ordinary.every(row => !['backup.audit.imported', 'backup.therapy-command.imported'].includes(row.eventType)));
});

test.after(() => sql.close());

test('portable audit and command markers cannot reclassify an existing local row', async () => {
    const before = sql.prepare('SELECT * FROM audit_events WHERE event_id=?').get(localReceipt.auditEventId);
    const now = Math.floor(Date.now() / 1000);
    const payload = createEmptyDataset();
    payload.auditEvents = ['backup.audit.imported', 'backup.therapy-command.imported'].map((eventType, index) => ({
        eventId: randomUUID(), schemaVersion: 1, eventType, occurredAt: now, outcome: 'success', actorType: 'system', actorRef: 'claimed-local-host',
        subjectType: index ? 'therapy_command' : 'audit_event', subjectRef: index ? localCommand.commandId : localReceipt.auditEventId,
        sourceSurface: 'web', requestId: null, redactedMetadata: null, createdAt: now,
    }));
    restoreBackupArtifact(await createBackupArtifact(payload), () => false);
    const renewed = issueSyntheticWebSession(actor, 'origin-poisoned-markers');
    const result = readTherapyStatusReceipt(renewed, localCommand);
    assert.equal(result.outcome, 'terminal');
    if (result.outcome === 'terminal') assert.equal(result.origin, 'local');
    assert.deepEqual(sql.prepare('SELECT * FROM audit_events WHERE event_id=?').get(localReceipt.auditEventId), before);
    assert.equal((await listAuditEvents({ eventType: 'therapy.updated', limit: 2 })).some(row => row.eventId === localReceipt.auditEventId), true);
    assert.equal(sql.prepare("SELECT 1 FROM portable_import_origins WHERE kind='therapy_command' AND ref=?").get(localCommand.commandId), undefined);
});
