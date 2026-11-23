import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getTableName } from 'drizzle-orm';
import { parseBackupArtifact, serializeBackupArtifact, type BackupArtifact, type BackupDataset } from './backup-artifact';
import { cassetteItems } from './agent-cassette-contract';
import { readAgentCassette, AGENT_CASSETTE_COMPLETE } from './agent-cassette-store';
import { PATIENT_CHILD_TABLES } from './patient-cascade';
import { RETENTION_HOLDS_KEY } from './retention-policy';
import { placeRetentionHold } from './retention-store';
import { captureAttachmentExtractionLocatorGeneration, isCurrentAttachmentExtractionLocatorGeneration } from './domain/documents/attachment-extraction-locator-revocation';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';

process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const directory = mkdtempSync(join(tmpdir(), 'mf-retention-restore-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const load = createRequire(import.meta.url);
const auth = load('./security/server-auth') as typeof import('./security/server-auth');
const credentials = load('./security/host-credential-verification') as typeof import('./security/host-credential-verification');
const original = { requireSession: auth.requireSession, verifyRestoreCredentials: credentials.verifyRestoreCredentials };
const { openDbServer, dbServer } = await import('./db-server');
const sqlite = openDbServer();
const { issueSyntheticWebSession, retireSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture');
const { isCurrentServerSession } = await import('./security/current-session-authority');
const { readSqliteArchiveGeneration } = await import('./archive-generation');
const { restoreSnapshot, readRestoreReceipt, readRestorePreviewSnapshot } = await import('./backup-restore-receipt');
const { restoreBackupArtifact } = await import('./backup-restore-executor');
const backup = await import('../app/api/system/backup-restore/route');
const verify = await import('../app/api/system/backup-restore/verify/route');
const receipts = await import('../app/api/system/backup-restore/receipts/[id]/route');
const purge = await import('../app/api/system/purge-patient/route');
const second = 1795000000;
const doctor = { id: 'synthetic-restore-admin', role: 'admin', username: randomUUID() };
const archiveTables = PATIENT_CHILD_TABLES.map(child => getTableName(child.table));
let session: ReturnType<typeof issueSyntheticWebSession>;

test.beforeEach(() => {
    sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM settings WHERE key=?').run(RETENTION_HOLDS_KEY);
        sqlite.exec('DELETE FROM agent_cassettes; DELETE FROM entry_revisions');
        for (const table of archiveTables) sqlite.prepare(`DELETE FROM ${table}`).run();
        sqlite.exec('DELETE FROM patients; DELETE FROM ambulatories');
    }).immediate();
    signIn();
});
test.after(() => {
    Object.assign(auth, { requireSession: original.requireSession });
    Object.assign(credentials, { verifyRestoreCredentials: original.verifyRestoreCredentials });
    retireSyntheticWebSession(session);
});
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));

function signIn() {
    session = issueSyntheticWebSession(doctor, randomUUID());
    Object.assign(auth, { requireSession: async () => session });
    Object.assign(credentials, { verifyRestoreCredentials: async () => ({ kind: 'verified', account: doctor }) });
}

function seedPatient(id: string) {
    const ambulatory = id + '-clinic';
    sqlite.prepare("INSERT INTO ambulatories (id,name) VALUES (?,'Sintetico')").run(ambulatory);
    sqlite.prepare("INSERT INTO patients(id,first_name,last_name,tax_code,ambulatory_id,deleted_at) VALUES (?,'Persona','Sintetica',?,?,?)").run(id, id, ambulatory, second);
    sqlite.prepare('INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id,assigned_at) VALUES (?,?,?)').run(id, ambulatory, second);
    sqlite.prepare("INSERT INTO attachments(id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch) VALUES (?,?,'Sintetico','application/pdf',3,'test.pdf','ENC:synthetic:document',?,1,1)")
        .run(id + '-file', id, createHash('sha256').update(id).digest('hex'));
}

function seedClinicalGraph(id: string) {
    seedPatient(id);
    const entry = id + '-entry', event = randomUUID(), prescription = id + '-prescription', item = id + '-item';
    sqlite.prepare("INSERT INTO entries(id,patient_id,type,date,content,version) VALUES (?,?,'note',?,'ENC:synthetic:note',2)").run(entry, id, second);
    sqlite.prepare("INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,redacted_metadata) VALUES (?,'entry.updated',?,'success','user',?,'entry',?,'web',?)")
        .run(event, second, doctor.id, entry, JSON.stringify({ changedFields: ['content'], resourceVersion: 2 }));
    sqlite.prepare("INSERT INTO entry_revisions(event_id,entry_id,version,title,content,corrected_at) VALUES (?,?,1,'ENC:synthetic:title','ENC:synthetic:previous',?)").run(event, entry, second);
    sqlite.prepare("INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date) VALUES (?,?,'Farmaco sintetico','Dose sintetica','active',?)").run(id + '-therapy', id, second);
    sqlite.prepare("INSERT INTO checkups(id,patient_id,date,title) VALUES (?,?,?,'Controllo sintetico')").run(id + '-checkup', id, second);
    sqlite.prepare("INSERT INTO prosthetic_prescriptions(id,patient_id,prescribed_at,description) VALUES (?,?,?,'Ausilio sintetico')").run(id + '-prosthetic', id, second);
    sqlite.prepare("INSERT INTO service_prescriptions(id,patient_id,prescribed_at,service_name) VALUES (?,?,?,'Prestazione sintetica')").run(prescription, id, second);
    sqlite.prepare("INSERT INTO service_prescription_items(id,patient_id,prescription_id,service_name) VALUES (?,?,?,'Voce sintetica')").run(item, id, prescription);
    sqlite.prepare("INSERT INTO observations(id,patient_id,code_system,code,display,unit_system,unit_code,value,observed_at,service_prescription_item_id) VALUES (?,?,'loinc','synthetic','Sintetico','ucum','1','10',?,?)").run(id + '-observation', id, second, item);
    sqlite.prepare("INSERT INTO siss_handoff_events(id,patient_id,action,module_label,started_at) VALUES (?,?,'synthetic','Sintetico',?)").run(id + '-handoff', id, second);
    sqlite.prepare("INSERT INTO document_diagnosis_proposals(id,patient_id,source_document_key,attachment_id,candidate_key,payload,confidence) VALUES (?,?,?,?,?,'{}','synthetic')").run(id + '-proposal', id, id + '-source', id + '-file', id + '-candidate');
}

function placeHold(patientId: string, attachmentId?: string) {
    dbServer.transaction(tx => placeRetentionHold(tx, { patientId, attachmentId, confirmed: true, expectedRevision: 0, reason: 'litigation' },
        doctor.id, second, () => {}), { behavior: 'immediate' });
}

function request(route: string, body: unknown, headers?: Record<string, string>) {
    return new Request('http://localhost/api/system/' + route, { method: 'POST', headers: {
        origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
        'x-mediflow-archive-generation': readSqliteArchiveGeneration(sqlite), ...headers,
    }, body: JSON.stringify(body) });
}

async function retire(patientId: string) {
    const response = await purge.POST(request('purge-patient', { patientId, version: 1 }));
    assert.equal(response.status, 200);
}

async function exported(): Promise<BackupArtifact> {
    const response = await backup.GET();
    assert.equal(response.status, 200);
    return response.json();
}

async function artifactWith(source: BackupArtifact, modify: (payload: BackupDataset) => void): Promise<BackupArtifact> {
    const payload = structuredClone(source.payload);
    modify(payload);
    return JSON.parse(await serializeBackupArtifact(payload));
}

function preview(artifact: BackupArtifact) {
    return verify.POST(request('backup-restore/verify', artifact));
}

function execute(artifact: BackupArtifact, id: string, expectedSnapshot: string) {
    return backup.POST(request('backup-restore', artifact, {
        'x-mediflow-restore-id': id, 'x-mediflow-restore-snapshot': expectedSnapshot, 'x-mediflow-restore-confirmation': 'RIPRISTINA',
        'x-mediflow-restore-source-checksum': artifact.manifest.checksum, 'x-mediflow-restore-credential': JSON.stringify({ pin: randomUUID() }),
    }));
}

async function assertBlock(response: Response, reason: string) {
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.code, 'restore_blocked');
    assert.equal(body.reason, reason);
    assert.doesNotMatch(body.error, /synthetic-/);
    if (reason === 'retired_patient_material') assert.match(body.error, /backup successivo alla cancellazione.*nuova destinazione/);
}

async function assertDenied(artifact: BackupArtifact, reason: string, stale?: string) {
    const id = randomUUID();
    const original = { snapshot: restoreSnapshot(sqlite), generation: readSqliteArchiveGeneration(sqlite) };
    const locator = captureAttachmentExtractionLocatorGeneration();
    if (!stale) await assertBlock(await preview(artifact), reason);
    await assertBlock(await execute(artifact, id, stale ?? original.snapshot), reason);
    assert.equal(restoreSnapshot(sqlite), original.snapshot);
    assert.equal(readSqliteArchiveGeneration(sqlite), original.generation);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locator), true);
    assert.equal(isCurrentServerSession(session), true);
    assert.equal(readRestoreReceipt(sqlite, id), null);
    const parsed = await parseBackupArtifact(artifact);
    let fenceCalled = false;
    assert.throws(() => restoreBackupArtifact(parsed, () => { fenceCalled = true; return true; }, { id, expectedSnapshot: stale ?? original.snapshot }), { reason });
    assert.equal(fenceCalled, false);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locator), true);
}

for (const mode of ['missing-attachment', 'changed-attachment', 'missing-patient', 'missing-entry', 'missing-membership', 'unreadable-holds'] as const) {
    test(mode + ' is blocked during preview and execution, with archive and authority intact', async () => {
        const patientId = 'synthetic-' + mode;
        if (mode === 'missing-entry') seedClinicalGraph(patientId);
        else seedPatient(patientId);
        const artifact = await artifactWith(await exported(), payload => {
            if (mode === 'changed-attachment') payload.attachments[0].data = 'ENC:synthetic:different';
            if (mode === 'missing-attachment' || mode === 'missing-patient') payload.attachments = [];
            if (mode === 'missing-patient') payload.patients = [];
            if (mode === 'missing-entry') { payload.entries = []; payload.entryRevisions = []; }
            if (mode === 'missing-membership') {
                const [row] = payload.patients;
                row.assignedAmbulatoryIds = []; row.assignedAmbulatoryMemberships = []; row.ambulatoryId = null;
            }
        });
        const documentOnly = mode === 'missing-attachment' || mode === 'changed-attachment';
        if (mode === 'unreadable-holds') sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,'invalid')").run(RETENTION_HOLDS_KEY);
        else placeHold(patientId, documentOnly ? patientId + '-file' : undefined);
        await assertDenied(artifact, mode === 'unreadable-holds' ? 'retention_unreadable' : 'legal_hold');
    });
}

test('a compatible backup preserves a held graph and restores unrelated records while holding the writer lock', async () => {
    const id = 'synthetic-compatible';
    seedClinicalGraph(id);
    seedPatient('synthetic-other');
    const whole = await exported();
    const artifact = await artifactWith(whole, payload => {
        payload.patients.find(row => row.id === 'synthetic-other')!.notes = 'ENC:synthetic:restored';
        const attachment = payload.attachments.find(row => row.patientId === id)!;
        attachment.createdAt = Date.parse(attachment.createdAt as string) / 1000;
    });
    placeHold(id);
    const previewResponse = await preview(artifact);
    assert.equal(previewResponse.status, 200);
    const selected = await previewResponse.json();
    assert.equal(selected.excludedRetiredPatients ?? 0, 0);
    const writer = new Database(join(directory, 'medical.db'), { timeout: 0 });
    try {
        const parsed = await parseBackupArtifact(artifact);
        restoreBackupArtifact(parsed, () => {
            assert.equal(sqlite.inTransaction, true);
            assert.throws(() => writer.exec('BEGIN IMMEDIATE'), { code: 'SQLITE_BUSY' });
            return true;
        }, { id: randomUUID(), expectedSnapshot: selected.expectedSnapshot });
    } finally { writer.close(); }
    assert.equal(sqlite.prepare("SELECT notes FROM patients WHERE id='synthetic-other'").pluck().get(), 'ENC:synthetic:restored');
    assert.ok(sqlite.prepare('SELECT value FROM settings WHERE key=?').get(RETENTION_HOLDS_KEY));
    assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
});

function command(patientId: string, withClinicalValue = false) {
    return { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: readSqliteArchiveGeneration(sqlite),
        actorRef: doctor.id, patientId, therapyId: patientId + '-therapy', expectedVersion: 1,
        outcome: withClinicalValue ? 'rejected' : 'closed', reason: withClinicalValue ? 'version_conflict' : null,
        target: withClinicalValue ? 'active' : null, committedAt: second, resultVersion: null, resultEndDate: null, auditEventId: null, auditSnapshot: null };
}

test('a retired patient stays absent with every clinical dependency excluded and audit and opaque command history retained', async () => {
    const retired = 'synthetic-retired', other = 'synthetic-keep';
    seedClinicalGraph(retired);
    seedClinicalGraph(other);
    const historicCommand = command(retired);
    const artifact = await artifactWith(await exported(), payload => {
        payload.therapyStatusCommands!.push(historicCommand);
    });
    await retire(retired);
    const history = sqlite.prepare('SELECT * FROM audit_events ORDER BY rowid').all();
    const marker = sqlite.prepare('SELECT * FROM patient_retired_ids WHERE id=?').get(retired);
    const selection = await preview(artifact);
    assert.equal(selection.status, 200);
    const selected = await selection.json();
    const id = randomUUID();
    const response = await execute(artifact, id, selected.expectedSnapshot);
    assert.equal(response.status, 200);
    assert.equal(sqlite.prepare('SELECT 1 FROM patients WHERE id=?').get(retired), undefined);
    assert.equal(selected.excludedRetiredPatients, 1);
    const body = await response.json();
    assert.equal(body.receipt.excludedRetiredPatients, 1);
    assert.equal(body.receipt.sourceChecksum, artifact.manifest.checksum);
    for (const table of archiveTables) {
        assert.equal(sqlite.prepare(`SELECT 1 FROM ${table} WHERE patient_id=?`).get(retired), undefined, table);
        assert.ok(sqlite.prepare(`SELECT 1 FROM ${table} WHERE patient_id=?`).get(other), table);
    }
    assert.deepEqual(sqlite.prepare('SELECT entry_id FROM entry_revisions').pluck().all(), [other + '-entry']);
    assert.deepEqual(sqlite.prepare('SELECT * FROM patient_retired_ids WHERE id=?').get(retired), marker);
    assert.deepEqual(sqlite.prepare('SELECT * FROM audit_events ORDER BY rowid').all().slice(0, history.length), history);
    assert.equal(sqlite.prepare('SELECT patient_id FROM therapy_status_commands WHERE command_id=?').pluck().get(historicCommand.commandId), retired);
    signIn();
    const reread = await receipts.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) });
    assert.equal(reread.status, 200);
    assert.deepEqual(await reread.json(), body.receipt);
});

async function cassetteFixture() {
    const f = await agentCassetteFixture();
    try {
        f.run(() => {
            f.store.open(f.principal, f.visitId, f.anchor);
            f.store.add(f.principal, f.visitId, 1, f.item);
            f.store.close(f.principal, f.visitId, 2);
        });
        return { ...f.rows()[0], archiveGeneration: readSqliteArchiveGeneration(sqlite) };
    } finally { f.database.close(); }
}

for (const kind of ['unbound-cassette', 'imported-cassette-audit', 'changed-cassette', 'audit-values', 'therapy-values'] as const) {
    test('refuses ' + kind + ' with retirement and leaves the local archive and authority intact', async () => {
        const id = 'synthetic-' + kind;
        seedPatient(id);
        const cassette = kind.includes('cassette') ? await cassetteFixture() : null;
        if (kind === 'imported-cassette-audit' || kind === 'changed-cassette') {
            seedPatient(id + '-other');
            recordAppliedCassette(cassette!, id + '-other', kind === 'imported-cassette-audit');
        }
        const artifact = await artifactWith(await exported(), payload => {
            if (kind === 'unbound-cassette') payload.agentCassettes = [cassette!];
            if (kind === 'changed-cassette') payload.agentCassettes![0] = { ...cassette!, modifiedAt: cassette!.modifiedAt + 1 };
            if (kind === 'therapy-values') payload.therapyStatusCommands!.push(command(id, true));
            if (kind === 'audit-values') payload.auditEvents!.push({ eventId: randomUUID(), schemaVersion: 1, occurredAt: second,
                eventType: 'patient.updated', subjectType: 'patient', subjectRef: id, outcome: 'success',
                actorType: 'user', actorRef: doctor.id, sourceSurface: 'web', requestId: null, createdAt: second,
                redactedMetadata: JSON.stringify({ clinicalValue: 'Sintetico', resourceVersion: 2 }) });
        });
        await retire(id);
        await assertDenied(artifact, 'retired_patient_material');
    });
}

function recordAppliedCassette(cassette: Awaited<ReturnType<typeof cassetteFixture>>, patientId: string, imported: boolean) {
    const { id, actorRef, agentRef, mandateRef, modelProvider } = cassette;
    sqlite.prepare('INSERT INTO agent_cassettes(id,mandate_ref,agent_ref,actor_ref,archive_generation,public_key,wrapped_private_key,model_provider,allows_clinical_egress,anchor_ciphertext,items_ciphertext,status,revision,deposited_at,modified_at) VALUES (@id,@mandateRef,@agentRef,@actorRef,@archiveGeneration,@publicKey,@wrappedPrivateKey,@modelProvider,@allowsClinicalEgress,@anchorCiphertext,@itemsCiphertext,@status,@revision,@depositedAt,@modifiedAt)').run(cassette);
    const write = sqlite.prepare("INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,request_id,redacted_metadata,proposer_ref,mandate_ref,model_provider,created_at) VALUES (?,?,?,'success','user',?,?,?,'agent',?,?,?,?,?,?)");
    const patientEvent = randomUUID();
    write.run(patientEvent, 'patient.updated', second, actorRef, 'patient', patientId, id, null, agentRef, mandateRef, modelProvider, second);
    for (const item of cassetteItems(cassette)) {
        write.run(randomUUID(), 'agent.item.applied', second, actorRef, 'agent_operation', item.id, id, null, agentRef, mandateRef, modelProvider, second);
    }
    const receipt = randomUUID();
    write.run(receipt, 'agent.visit.applied', second, actorRef, 'agent_operation', id, 'review:' + patientId,
        JSON.stringify({ flags: ['review', AGENT_CASSETTE_COMPLETE] }), agentRef, mandateRef, modelProvider, second);
    if (imported) sqlite.prepare("INSERT INTO portable_import_origins(kind,ref,import_event_id,origin) VALUES ('audit',?,?,'imported')").run(patientEvent, receipt);
}

test('a fully applied, identical cassette with local binding to a non-retired patient is restored', async () => {
    const id = 'synthetic-cassette-retired';
    seedPatient(id);
    seedPatient('synthetic-cassette-kept');
    const cassette = await cassetteFixture();
    recordAppliedCassette(cassette, 'synthetic-cassette-kept', false);
    const artifact = await exported();
    await retire(id);
    const response = await preview(artifact);
    assert.equal(response.status, 200);
    const selection = await response.json();
    assert.equal(selection.excludedRetiredPatients, 1);
    assert.equal((await execute(artifact, randomUUID(), selection.expectedSnapshot)).status, 200);
    assert.deepEqual(readAgentCassette(sqlite, cassette.id, cassette.actorRef), cassette);
});

for (const change of ['hold', 'purge', 'purge-with-cassette'] as const) {
    test(change + ' committed after preview invalidates execution before any restore mutation', async () => {
        const id = 'synthetic-late-' + change;
        seedPatient(id);
        const whole = await exported();
        const cassette = change === 'purge-with-cassette' ? await cassetteFixture() : null;
        const artifact = await artifactWith(whole, payload => {
            if (change === 'hold') payload.attachments = [];
            if (cassette) payload.agentCassettes = [cassette];
        });
        const response = await preview(artifact);
        assert.equal(response.status, 200);
        const selection = await response.json();
        assert.equal(selection.expectedSnapshot, readRestorePreviewSnapshot());
        if (change === 'hold') placeHold(id, id + '-file');
        else await retire(id);
        await assertDenied(artifact, change === 'hold' ? 'legal_hold' : cassette ? 'retired_patient_material' : 'snapshot', selection.expectedSnapshot);
    });
}
