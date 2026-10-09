import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackupArtifact, createEmptyDataset, parseBackupArtifact, serializeBackupArtifact } from './backup-artifact';

const originalAudit: BackupAuditRow = {
    eventId: 'synthetic-history-1', schemaVersion: 2, eventType: 'patient.updated',
    occurredAt: 1783000001, outcome: 'success', actorType: 'user', actorRef: 'synthetic-actor',
    subjectType: 'patient', subjectRef: 'synthetic-removed-patient', sourceSurface: 'api',
    requestId: '', redactedMetadata: '{ "changedFields": ["version"], "resourceVersion": 2 }', createdAt: null,
};

test('v1 preserves all thirteen original audit fields without requiring a live subject', async () => {
    const payload = { ...createEmptyDataset(), auditEvents: [originalAudit] };
    const artifact = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(payload)));
    assert.deepEqual(artifact.payload.auditEvents, [originalAudit]);
    assert.equal(artifact.manifest.recordCounts.auditEvents, 1);
    assert.ok(artifact.manifest.collections.includes('auditEvents'));
});

test('v1 keeps omitted history distinct from an explicitly included empty snapshot', async () => {
    const payload = createEmptyDataset();
    delete payload.auditEvents;
    const omitted = await parseBackupArtifact(await createBackupArtifact(payload));
    const empty = await parseBackupArtifact(await createBackupArtifact({ ...payload, auditEvents: [] }));
    assert.equal(Object.hasOwn(omitted.payload, 'auditEvents'), false);
    assert.equal(omitted.manifest.collections.includes('auditEvents'), false);
    assert.deepEqual(empty.payload.auditEvents, []);
    assert.equal(empty.manifest.recordCounts.auditEvents, 0);
});

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupArtifactInputChecksum, stableStringify } from './backup-artifact';
import { runBackupRestorePreflight } from './backup-restore-preflight';
import { canonicalizeBackupAuditRows, type BackupAuditRow } from './backup-audit';
import { serializeBackupArtifact as serializeScheduledBackupArtifact } from '../scripts/run-scheduled-backup.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOADER = path.join(ROOT, 'scripts/register-strip-types-loader.mjs');
const checksum = (payload: unknown) => createHash('sha256').update(stableStringify(payload)).digest('hex');

function runNode(dataDir: string, args: string[], extra: Record<string, string> = {}): string {
    return execFileSync(process.execPath, args, {
        cwd: ROOT, encoding: 'utf8',
        env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', ...extra },
    }).trim();
}

function evalNode(dataDir: string, source: string, extra: Record<string, string> = {}): string {
    return runNode(dataDir, ['--import', LOADER, '--input-type=module', '--eval', source], extra);
}

function prepare(dataDir: string): void {
    runNode(dataDir, ['scripts/prepare-e2e-db.mjs']);
    evalNode(dataDir, "await import('./lib/db-server.ts');");
}

function seedAudit(db: Database.Database, row: typeof originalAudit): void {
    db.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(...Object.values(row));
}

const commandReviewId = `review_${'a'.repeat(32)}`;
const commandAudit: BackupAuditRow = {
    ...originalAudit, eventId: `event_${'b'.repeat(32)}`, schemaVersion: 1,
    eventType: 'ai.review.accepted', subjectType: 'ai_review', subjectRef: commandReviewId,
    actorRef: `actor_${'c'.repeat(32)}`, requestId: null, redactedMetadata: null,
};
const commandStateInsert = 'INSERT INTO durable_review_command_states (review_id, review_state, revision, action, created_at) VALUES (?, ?, ?, ?, ?)';
const commandStateValues = [commandReviewId, 'accepted', 2, 'accept', 1783000001];
const commandOperationInsert = 'INSERT INTO durable_review_command_operations (id, review_id, idempotency_key, command_digest, result_snapshot, audit_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
const commandOperationValues = [
    'command-operation-synthetic', commandReviewId, 'idem_aaaaaaaaaaaaaaaa', 'a'.repeat(64),
    JSON.stringify({ reviewId: commandReviewId, state: 'accepted', revision: 2, eventId: commandAudit.eventId }),
    commandAudit.eventId, 1783000001,
];

const webBackupDatasetScript = [
    "const source = ts.createSourceFile('route.ts', fs.readFileSync('app/api/system/backup-restore/route.ts','utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);",
    "const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['sortBackupRows','filterRowsByReference','buildBackupDataset'].includes(node.name?.text)).map(node => node.getText(source)).join('\\n');",
    "const schemaImport = source.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/lib/schema' && ts.isNamedImports(node.importClause?.namedBindings));",
    "const names = schemaImport.importClause.namedBindings.elements.map(node => node.name.text);",
    "const code = ts.transpileModule(functions, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;",
    "const buildWebBackupDataset = new Function('dbServer','tables','sql','snapshotBackupAudit','enrichBackupPatientsWithAmbulatoryLinks', 'const {' + names.join(',') + '} = tables; const backupSchema = tables; ' + code + '; return buildBackupDataset;')(dbServer,tables,sql,snapshotBackupAudit,enrichBackupPatientsWithAmbulatoryLinks);",
].join('\n');

const webBackupExportScript = [
    "import fs from 'node:fs'; import ts from 'typescript'; import {sql} from 'drizzle-orm';",
    "import {dbServer} from './lib/db-server.ts'; import * as tables from './lib/schema.ts';",
    "import {snapshotBackupAudit} from './lib/backup-audit.ts';",
    "import {enrichBackupPatientsWithAmbulatoryLinks} from './lib/backup-patient-ambulatory-links.ts';",
    "import {serializeBackupArtifact} from './lib/backup-artifact.ts';",
    webBackupDatasetScript,
    "let artifact = null, error = null; try { artifact = JSON.parse(await serializeBackupArtifact(buildWebBackupDataset())); } catch (caught) { error = caught.message; }",
    "console.log(JSON.stringify({artifact,error}));",
].join('\n');

function retainImage(db: Database.Database, label: string): Promise<void> {
    const evidence = process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR;
    if (!evidence) return Promise.resolve();
    fs.mkdirSync(evidence, { recursive: true });
    return db.backup(path.join(evidence, label + '.db')).then(() => {});
}

const restoreScript = [
    "import fs from 'node:fs'; import path from 'node:path'; import Database from 'better-sqlite3';",
    "import { parseBackupArtifact } from './lib/backup-artifact.ts';",
    "import { restoreBackupArtifact } from './lib/backup-restore-executor.ts';",
    "const db = new Database(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));",
    "const snapshot = () => db.transaction(() => Object.fromEntries(db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all().map(({name}) => [name, db.prepare('SELECT * FROM ' + JSON.stringify(name)).all().sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])))();",
    "const before = snapshot(); let result = null, error = null, fence = 0;",
    "const evidence = process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR; if (evidence) { fs.mkdirSync(evidence, {recursive:true}); await db.backup(path.join(evidence, process.env.AUDIT_RESTORE_MODE + '-before-initialized.db')); }",
    "const mode = process.env.AUDIT_RESTORE_MODE;",
    "if (mode === 'abort' || mode === 'ignore') db.exec(\"CREATE TRIGGER audit_recovery_owned_fault BEFORE INSERT ON audit_events WHEN NEW.event_id = 'synthetic-history-1' BEGIN SELECT RAISE(\" + (mode === 'abort' ? \"ABORT, 'SYNTHETIC_AUDIT_ABORT'\" : 'IGNORE') + \"); END\");",
    "try { const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.AUDIT_ARTIFACT_PATH, 'utf8'))); if (mode === 'negative-zero-occurredAt' || mode === 'negative-zero-createdAt') artifact.payload.auditEvents[0][mode.slice('negative-zero-'.length)] = -0; result = restoreBackupArtifact(artifact, () => { fence++; return false; }); } catch (caught) { error = caught.message; }",
    "const after = snapshot();",
    "if (mode === 'abort' || mode === 'ignore') db.exec('DROP TRIGGER audit_recovery_owned_fault');",
    "let appendOnly = false; try { db.prepare('UPDATE audit_events SET event_type = event_type').run(); } catch (caught) { appendOnly = String(caught).includes('append-only'); }",
    "if (evidence) await db.backup(path.join(evidence, mode + '-target.db'));",
    "db.close(); console.log(JSON.stringify({result,error,fence,before,after,appendOnly}));",
].join('\n');

function restore(dataDir: string, artifactPath: string, mode: string) {
    return JSON.parse(evalNode(dataDir, restoreScript, {
        AUDIT_ARTIFACT_PATH: artifactPath, AUDIT_RESTORE_MODE: mode,
    })) as {
        result: { sourceChecksum: string; audit: { coverage: string; inserted: number; reused: number } } | null;
        error: string | null; fence: number; before: Record<string, unknown[]>; after: Record<string, unknown[]>;
        appendOnly: boolean;
    };
}

test('rejects duplicate IDs, lossy seconds and incomplete or non-data audit records', async () => {
    for (const rows of [
        [originalAudit, originalAudit],
        [{ ...originalAudit, occurredAt: originalAudit.occurredAt + 0.5 }],
        [{ ...originalAudit, createdAt: '' }],
        [{ ...originalAudit, schemaVersion: 0 }],
        [{ ...originalAudit, redactedMetadata: {} }],
        [{ ...originalAudit, extra: 'unrecognized' }],
    ]) {
        await assert.rejects(() => createBackupArtifact({ ...createEmptyDataset(), auditEvents: rows }), /audit/i);
        const raw = JSON.parse(await serializeBackupArtifact({ ...createEmptyDataset(), auditEvents: [originalAudit] }));
        raw.payload.auditEvents = rows; raw.manifest.recordCounts.auditEvents = rows.length;
        raw.manifest.checksum = checksum(raw.payload);
        await assert.rejects(() => parseBackupArtifact(raw), /audit/i);
    }
});

test('rejects signed zero audit seconds before JSON or SQLite can erase the sign', async () => {
    for (const field of ['occurredAt', 'createdAt'] as const) {
        const row = { ...originalAudit, [field]: -0 };
        assert.throws(() => canonicalizeBackupAuditRows([row]), /audit.*invalid/i);
        await assert.rejects(() => createBackupArtifact({ ...createEmptyDataset(), auditEvents: [row] }), /audit/i);
        await assert.rejects(() => serializeScheduledBackupArtifact({ ...createEmptyDataset(), auditEvents: [row] }), /audit/i);
        const raw = JSON.parse(await serializeBackupArtifact({ ...createEmptyDataset(), auditEvents: [originalAudit] }));
        raw.payload.auditEvents = [row]; raw.manifest.checksum = checksum(raw.payload);
        await assert.rejects(() => parseBackupArtifact(raw), /audit/i);
        const wire = JSON.stringify(raw).replace(`"${field}":0`, `"${field}":-0`);
        assert.ok(Object.is(JSON.parse(wire).payload.auditEvents[0][field], -0));
        await assert.rejects(() => parseBackupArtifact(JSON.parse(wire)), /audit/i);
    }
});

test('constructed signed zero is rejected before mutation while zero seconds support repeated restore', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-zero-'));
    try {
        const dir = path.join(work, 'target'); prepare(dir);
        const db = new Database(path.join(dir, 'medical.db'));
        try { seedAudit(db, { ...originalAudit, eventId: 'zero-target-history' }); }
        finally { db.close(); }
        const zero = { ...originalAudit, eventId: 'zero-source-history', occurredAt: 0, createdAt: 0 };
        const artifactPath = path.join(work, 'zero.mediflow');
        fs.writeFileSync(artifactPath, await serializeBackupArtifact({ ...createEmptyDataset(), auditEvents: [zero] }));
        const evidence = process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR;
        if (evidence) { fs.mkdirSync(evidence, { recursive: true }); fs.copyFileSync(artifactPath, path.join(evidence, 'zero.mediflow')); }
        for (const field of ['occurredAt', 'createdAt']) {
            const rejected = restore(dir, artifactPath, 'negative-zero-' + field);
            assert.match(rejected.error ?? '', /audit row.*invalid/i);
            assert.equal(rejected.fence, 0);
            assert.deepEqual(rejected.after, rejected.before);
        }
        const first = restore(dir, artifactPath, 'zero-first');
        assert.equal(first.error, null);
        assert.deepEqual(first.result?.audit, { coverage: 'included', inserted: 1, reused: 0 });
        const repeated = restore(dir, artifactPath, 'zero-repeat');
        assert.equal(repeated.error, null);
        assert.deepEqual(repeated.result?.audit, { coverage: 'included', inserted: 0, reused: 1 });
        assert.deepEqual(repeated.after, repeated.before);
        assert.equal((repeated.after.audit_events as { occurred_at: number; created_at: number | null }[])
            .filter(row => row.occurred_at === 0 && row.created_at === 0).length, 1);
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

for (const coverage of ['omitted', 'included'] as const) {
    test(`${coverage} empty audit restore preserves preexisting target history and coverage`, async () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-coverage-'));
        try {
            const dir = path.join(work, 'target'); prepare(dir);
            const db = new Database(path.join(dir, 'medical.db'));
            try {
                seedAudit(db, { ...originalAudit, eventId: 'coverage-target-history' });
                db.prepare("INSERT INTO ambulatories (id,name,type) VALUES ('coverage-before','Synthetic before','synthetic')").run();
            } finally { db.close(); }
            const payload = createEmptyDataset();
            if (coverage === 'omitted') delete payload.auditEvents;
            payload.ambulatories = [{ id: 'coverage-after', name: 'Synthetic after', type: 'synthetic', createdAt: '2026-07-02T12:00:00.000Z' }];
            const artifactPath = path.join(work, 'coverage.mediflow');
            fs.writeFileSync(artifactPath, await serializeBackupArtifact(payload));
            const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            const mode = 'coverage-' + coverage;
            const first = restore(dir, artifactPath, mode + '-first');
            assert.equal(first.error, null); assert.equal(first.fence, 1); assert.equal(first.appendOnly, true);
            assert.deepEqual(first.result?.audit, { coverage, inserted: 0, reused: 0 });
            assert.equal(first.result?.sourceChecksum, raw.manifest.checksum);
            assert.deepEqual(first.after.audit_events, first.before.audit_events);
            assert.equal(first.after.audit_events.length, 1);
            assert.deepEqual(first.after.ambulatories.map(row => (row as { id: string }).id), ['coverage-after']);
            const repeated = restore(dir, artifactPath, mode + '-repeat');
            assert.equal(repeated.error, null);
            assert.deepEqual(repeated.result?.audit, { coverage, inserted: 0, reused: 0 });
            assert.deepEqual(repeated.after, repeated.before);
            const evidence = process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR;
            if (evidence) fs.copyFileSync(artifactPath, path.join(evidence, mode + '.mediflow'));
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });
}

test('legacy normalization retains original checksum and omitted coverage in preflight', async () => {
    const payload = createEmptyDataset(); delete payload.auditEvents;
    const raw = JSON.parse(await serializeBackupArtifact(payload));
    delete raw.payload.headlessSoapEntryCommits;
    delete raw.manifest.recordCounts.headlessSoapEntryCommits;
    raw.manifest.collections = raw.manifest.collections.filter((name: string) => name !== 'headlessSoapEntryCommits');
    raw.manifest.checksum = checksum(raw.payload);
    const original = raw.manifest.checksum;
    const parsed = await parseBackupArtifact(raw);
    assert.notEqual(parsed.manifest.checksum, original);
    assert.equal(backupArtifactInputChecksum(parsed), original);
    assert.equal(Object.hasOwn(parsed.payload, 'auditEvents'), false);
    const preflight = await runBackupRestorePreflight(raw);
    assert.equal(preflight.result.ok, true);
    assert.deepEqual(preflight.result.audit, { coverage: 'omitted', sourceChecksum: original });
});

test('scheduled snapshot restores original audits, preserves target history and rolls back faults', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-recovery-'));
    const sourceDir = path.join(work, 'source'), targetDir = path.join(work, 'target');
    const backupDir = path.join(work, 'backups');
    try {
        prepare(sourceDir); prepare(targetDir);
        evalNode(sourceDir, [
            "import { dbServer } from './lib/db-server.ts'; import { patients, ambulatories, patientsToAmbulatories } from './lib/schema.ts';",
            "import { updatePatientOperation } from './lib/patient-update-operation.ts';",
            "dbServer.insert(ambulatories).values({id:'audit-amb',name:'Synthetic audit',type:'synthetic',createdAt:new Date(1783000000000)}).run();",
            "dbServer.insert(patients).values({id:'audit-patient',firstName:'Synthetic',lastName:'Before',taxCode:'SYNTHETIC-AUDIT',ambulatoryId:'audit-amb',version:1,createdAt:new Date(1783000000000)}).run();",
            "dbServer.insert(patientsToAmbulatories).values({patientId:'audit-patient',ambulatoryId:'audit-amb',assignedAt:new Date(1783000000000)}).run();",
            "const result = updatePatientOperation({patientId:'audit-patient',expectedVersion:1,values:{lastName:'After',updatedAt:new Date(1783000001000)},setPrimaryAmbulatory:false,audit:{actorType:'user',actorRef:'synthetic-operator',sourceSurface:'web',requestId:'synthetic-required-update'}});",
            "if (result.status !== 200) throw new Error('Synthetic patient update failed');",
        ].join('\n'));
        const source = new Database(path.join(sourceDir, 'medical.db'));
        const target = new Database(path.join(targetDir, 'medical.db'));
        try {
            seedAudit(source, originalAudit);
            seedAudit(source, { ...originalAudit, eventId: 'synthetic-history-0', outcome: 'denied', subjectRef: null, requestId: null, redactedMetadata: '', createdAt: 0 });
            seedAudit(source, { ...originalAudit, eventId: 'synthetic-history-2', outcome: 'failure', subjectRef: '', requestId: '', redactedMetadata: null, createdAt: 1783000007 });
            const exclusive = { ...originalAudit, eventId: 'synthetic-target-only', actorRef: 'target-historical-actor' };
            seedAudit(target, exclusive);
            await retainImage(source, 'source'); await retainImage(target, 'initial-target');
            const exported = JSON.parse(runNode(sourceDir, ['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: backupDir,
            })) as { artifactPath: string };
            const bytes = fs.readFileSync(exported.artifactPath);
            const digest = createHash('sha256').update(bytes).digest('hex');
            const raw = JSON.parse(bytes.toString());
            assert.equal(raw.payload.auditEvents.length, 4);
            assert.equal(raw.payload.auditEvents.filter((row: { eventType: string }) => row.eventType === 'patient.updated').length, 4);
            const evidence = process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR;
            if (evidence) fs.copyFileSync(exported.artifactPath, path.join(evidence, 'original.mediflow'));

            const first = restore(targetDir, exported.artifactPath, 'first');
            assert.equal(first.error, null);
            assert.deepEqual(first.result?.audit, { coverage: 'included', inserted: 4, reused: 0 });
            assert.equal(first.result?.sourceChecksum, raw.manifest.checksum);
            assert.equal(first.appendOnly, true);
            const sourceAudits = source.prepare('SELECT * FROM audit_events ORDER BY event_id').all();
            const recovered = target.prepare("SELECT * FROM audit_events WHERE event_id != 'synthetic-target-only' ORDER BY event_id").all();
            assert.deepEqual(recovered, sourceAudits);
            assert.equal((target.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_id = 'synthetic-target-only'").get() as { n: number }).n, 1);
            const repeated = restore(targetDir, exported.artifactPath, 'repeat');
            assert.deepEqual(repeated.result?.audit, { coverage: 'included', inserted: 0, reused: 4 });
            assert.deepEqual(repeated.after, repeated.before);

            const reexport = JSON.parse(runNode(targetDir, ['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(work, 'union'),
            })) as { artifactPath: string };
            assert.equal(JSON.parse(fs.readFileSync(reexport.artifactPath, 'utf8')).payload.auditEvents.length, 5);

            for (const mode of ['collision', 'abort', 'ignore']) {
                const dir = path.join(work, mode); prepare(dir);
                const db = new Database(path.join(dir, 'medical.db'));
                try {
                    if (mode === 'collision') seedAudit(db, { ...originalAudit, requestId: null });
                    db.prepare("INSERT INTO ambulatories (id,name,type,created_at) VALUES ('target-sentinel','Synthetic sentinel','synthetic',1783000000)").run();
                    await retainImage(db, mode + '-before');
                } finally { db.close(); }
                const failed = restore(dir, exported.artifactPath, mode);
                assert.ok(failed.error?.includes(mode === 'collision' ? 'audit collision' : mode === 'abort' ? 'SYNTHETIC_AUDIT_ABORT' : 'audit insertion did not persist'));
                assert.equal(failed.fence, mode === 'collision' ? 0 : 1);
                assert.deepEqual(failed.after, failed.before);
            }
            assert.equal(createHash('sha256').update(fs.readFileSync(exported.artifactPath)).digest('hex'), digest);
            if (evidence) fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({first:first.result,repeated:repeated.result,sourceAuditCount:4,targetAuditCount:5,originalFileSha256:digest,controls:['collision','abort','ignore']}, null, 2));
        } finally { source.close(); target.close(); }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('Web export rejects either durable command collection without changing source rows', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-command-export-'));
    try {
        for (const history of ['state', 'operation', 'both']) {
            const dir = path.join(work, history); prepare(dir);
            const db = new Database(path.join(dir, 'medical.db'));
            try {
                db.prepare("INSERT INTO ambulatories (id,name,type) VALUES ('command-amb','Synthetic command','synthetic')").run();
                db.prepare("INSERT INTO patients (id,first_name,last_name,tax_code,ambulatory_id,version) VALUES ('command-patient','Synthetic','Before','SYNTHETIC-COMMAND','command-amb',1)").run();
                seedAudit(db, originalAudit);
                seedAudit(db, commandAudit);
                if (history !== 'operation') db.prepare(commandStateInsert).run(...commandStateValues);
                if (history !== 'state') db.prepare(commandOperationInsert).run(...commandOperationValues);
                const snapshot = () => db.transaction(() => Object.fromEntries(
                    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
                        .map(({ name }) => [name, db.prepare('SELECT * FROM ' + JSON.stringify(name)).all()
                            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]),
                ))();
                const before = snapshot();
                const result = JSON.parse(evalNode(dir, webBackupExportScript));
                assert.equal(result.artifact, null, history);
                assert.match(result.error ?? '', /Durable review command state requires its append-only audit ledger\./, history);
                assert.deepEqual(snapshot(), before, history);
                assert.deepEqual(before.audit_events, db.prepare('SELECT * FROM audit_events ORDER BY event_id').all()
                    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
                assert.equal((db.prepare("SELECT last_name FROM patients WHERE id='command-patient'").get() as { last_name: string }).last_name, 'Before');
            } finally { db.close(); }
        }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('Web export rejects command history committed before the snapshot first read', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-command-first-read-'));
    try {
        prepare(work);
        const db = new Database(path.join(work, 'medical.db'));
        try {
            db.prepare("INSERT INTO ambulatories (id,name,type) VALUES ('first-read-amb','Synthetic first read','synthetic')").run();
            db.prepare("INSERT INTO patients (id,first_name,last_name,tax_code,ambulatory_id,version) VALUES ('first-read-patient','Synthetic','Before','SYNTHETIC-FIRST-READ','first-read-amb',1)").run();
            seedAudit(db, originalAudit);
            assert.equal((db.prepare('SELECT COUNT(*) AS n FROM durable_review_command_states').get() as { n: number }).n, 0);
            assert.equal((db.prepare('SELECT COUNT(*) AS n FROM durable_review_command_operations').get() as { n: number }).n, 0);
            const script = [
                "import path from 'node:path'; import Database from 'better-sqlite3';",
                "const originalPrepare = Database.prototype.prepare; let fired = false;",
                "Database.prototype.prepare = function(statement) { const prepared = originalPrepare.call(this, statement); if (!fired && /from\\s+[\"']?ambulatories[\"']?(?:\\s|$)/i.test(statement)) { fired = true; const other = new Database(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));",
                "other.transaction(() => { other.prepare(\"UPDATE patients SET last_name='After', version=2 WHERE id='first-read-patient'\").run(); other.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(JSON.parse(process.env.SNAPSHOT_COMMAND_AUDIT_ROW))); other.prepare(process.env.SNAPSHOT_COMMAND_STATE_INSERT).run(...JSON.parse(process.env.SNAPSHOT_COMMAND_STATE_VALUES)); other.prepare(process.env.SNAPSHOT_COMMAND_OPERATION_INSERT).run(...JSON.parse(process.env.SNAPSHOT_COMMAND_OPERATION_VALUES)); })(); other.close(); } return prepared; };",
                webBackupExportScript,
            ].join('\n');
            const result = JSON.parse(evalNode(work, script, {
                SNAPSHOT_COMMAND_AUDIT_ROW: JSON.stringify(commandAudit),
                SNAPSHOT_COMMAND_STATE_INSERT: commandStateInsert, SNAPSHOT_COMMAND_STATE_VALUES: JSON.stringify(commandStateValues),
                SNAPSHOT_COMMAND_OPERATION_INSERT: commandOperationInsert, SNAPSHOT_COMMAND_OPERATION_VALUES: JSON.stringify(commandOperationValues),
            }));
            assert.equal(result.artifact, null);
            assert.match(result.error ?? '', /Durable review command state requires its append-only audit ledger\./);
            assert.equal((db.prepare('SELECT COUNT(*) AS n FROM durable_review_command_states').get() as { n: number }).n, 1);
            assert.equal((db.prepare('SELECT COUNT(*) AS n FROM durable_review_command_operations').get() as { n: number }).n, 1);
            assert.deepEqual(db.prepare('SELECT event_id FROM audit_events ORDER BY event_id').all(),
                [commandAudit.eventId, originalAudit.eventId].sort().map(event_id => ({ event_id })));
            assert.deepEqual(db.prepare("SELECT last_name, version FROM patients WHERE id='first-read-patient'").get(), { last_name: 'After', version: 2 });
        } finally { db.close(); }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('manual and scheduled producers keep one SQLite snapshot across a concurrent clinical/audit/command commit', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-snapshot-'));
    try {
        for (const producer of ['manual', 'scheduled']) {
            const dir = path.join(work, producer); prepare(dir);
            const db = new Database(path.join(dir, 'medical.db'));
            try {
                db.prepare("INSERT INTO ambulatories (id,name,type) VALUES ('snapshot-amb','Synthetic snapshot','synthetic')").run();
                db.prepare("INSERT INTO patients (id,first_name,last_name,tax_code,ambulatory_id,version) VALUES ('snapshot-patient','Synthetic','Before','SYNTHETIC-SNAPSHOT','snapshot-amb',1)").run();
                seedAudit(db, { ...originalAudit, eventId: 'synthetic-before', subjectRef: 'snapshot-patient' });
            } finally { db.close(); }
            const concurrentRow = { ...originalAudit, eventId: 'synthetic-concurrent', subjectRef: 'snapshot-patient' };
            const script = [
                "import fs from 'node:fs'; import path from 'node:path'; import Database from 'better-sqlite3';",
                "import ts from 'typescript'; import {sql} from 'drizzle-orm';",
                "import {dbServer} from './lib/db-server.ts'; import * as tables from './lib/schema.ts';",
                "import {snapshotBackupAudit} from './lib/backup-audit.ts';",
                "import {enrichBackupPatientsWithAmbulatoryLinks} from './lib/backup-patient-ambulatory-links.ts';",
                "import {serializeBackupArtifact} from './lib/backup-artifact.ts';",
                "const originalPrepare = Database.prototype.prepare; let fired = false;",
                "Database.prototype.prepare = function(statement) { const prepared = originalPrepare.call(this, statement); if (!fired && /from\\s+[\"']?patients[\"']?(?:\\s|$)/i.test(statement)) { fired = true; const other = new Database(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));",
                "other.transaction(() => { other.prepare(\"UPDATE patients SET last_name='After', version=2 WHERE id='snapshot-patient'\").run(); other.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(JSON.parse(process.env.SNAPSHOT_AUDIT_ROW))); other.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(JSON.parse(process.env.SNAPSHOT_COMMAND_AUDIT_ROW))); other.prepare(process.env.SNAPSHOT_COMMAND_STATE_INSERT).run(...JSON.parse(process.env.SNAPSHOT_COMMAND_STATE_VALUES)); other.prepare(process.env.SNAPSHOT_COMMAND_OPERATION_INSERT).run(...JSON.parse(process.env.SNAPSHOT_COMMAND_OPERATION_VALUES)); })(); other.close(); } return prepared; };",
                "if (process.env.SNAPSHOT_PRODUCER === 'scheduled') { process.argv[1] = path.resolve('scripts/run-scheduled-backup.mjs'); await import('./scripts/run-scheduled-backup.mjs'); } else {",
                webBackupDatasetScript,
                "console.log(await serializeBackupArtifact(buildWebBackupDataset())); }",
            ].join('\n');
            const output = evalNode(dir, script, {
                SNAPSHOT_PRODUCER: producer, SNAPSHOT_AUDIT_ROW: JSON.stringify(concurrentRow),
                SNAPSHOT_COMMAND_AUDIT_ROW: JSON.stringify(commandAudit),
                SNAPSHOT_COMMAND_STATE_INSERT: commandStateInsert, SNAPSHOT_COMMAND_STATE_VALUES: JSON.stringify(commandStateValues),
                SNAPSHOT_COMMAND_OPERATION_INSERT: commandOperationInsert, SNAPSHOT_COMMAND_OPERATION_VALUES: JSON.stringify(commandOperationValues),
                MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(dir, 'backups'),
            });
            const result = JSON.parse(output);
            const raw = producer === 'scheduled' ? JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')) : result;
            const artifact = await parseBackupArtifact(raw);
            assert.equal(artifact.payload.patients[0].lastName, 'Before');
            assert.equal(artifact.payload.patients[0].version, 1);
            assert.deepEqual(artifact.payload.auditEvents?.map(row => row.eventId), ['synthetic-before']);
            assert.deepEqual(artifact.payload.durableReviewCommandStates, []);
            assert.deepEqual(artifact.payload.durableReviewCommandOperations, []);
            assert.equal(artifact.manifest.recordCounts.durableReviewCommandStates, 0);
            assert.equal(artifact.manifest.recordCounts.durableReviewCommandOperations, 0);
            const observed = new Database(path.join(dir, 'medical.db'));
            try {
                assert.equal((observed.prepare("SELECT last_name FROM patients WHERE id='snapshot-patient'").get() as { last_name: string }).last_name, 'After');
                assert.equal((observed.prepare("SELECT version FROM patients WHERE id='snapshot-patient'").get() as { version: number }).version, 2);
                assert.equal((observed.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n, 3);
                const statesBefore = observed.prepare('SELECT * FROM durable_review_command_states').all();
                const operationsBefore = observed.prepare('SELECT * FROM durable_review_command_operations').all();
                const auditsBefore = observed.prepare('SELECT * FROM audit_events ORDER BY event_id').all();
                assert.equal(statesBefore.length, 1);
                assert.equal(operationsBefore.length, 1);
                const fresh = JSON.parse(evalNode(dir, webBackupExportScript));
                assert.equal(fresh.artifact, null);
                assert.match(fresh.error ?? '', /Durable review command state requires its append-only audit ledger\./);
                assert.deepEqual(observed.prepare('SELECT * FROM durable_review_command_states').all(), statesBefore);
                assert.deepEqual(observed.prepare('SELECT * FROM durable_review_command_operations').all(), operationsBefore);
                assert.deepEqual(observed.prepare('SELECT * FROM audit_events ORDER BY event_id').all(), auditsBefore);
                assert.equal((observed.prepare("SELECT last_name FROM patients WHERE id='snapshot-patient'").get() as { last_name: string }).last_name, 'After');
                await retainImage(observed, producer + '-snapshot-current');
                if (process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.MEDIFLOW_AUDIT_EVIDENCE_DIR, producer + '-snapshot.mediflow'), JSON.stringify(raw));
            } finally { observed.close(); }
        }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a missing source audit table stays omitted, while a present empty table is included', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-absence-'));
    try {
        const db = new Database(path.join(work, 'medical.db'));
        db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
        const exportOnce = () => {
            const run = JSON.parse(runNode(work, ['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(work, 'backups'),
            })) as { artifactPath: string };
            return JSON.parse(fs.readFileSync(run.artifactPath, 'utf8'));
        };
        const omitted = await parseBackupArtifact(exportOnce());
        assert.equal(Object.hasOwn(omitted.payload, 'auditEvents'), false);
        db.exec('CREATE TABLE audit_events (event_id TEXT PRIMARY KEY, schema_version INTEGER, event_type TEXT, occurred_at INTEGER, outcome TEXT, actor_type TEXT, actor_ref TEXT, subject_type TEXT, subject_ref TEXT, source_surface TEXT, request_id TEXT, redacted_metadata TEXT, created_at INTEGER)');
        const empty = await parseBackupArtifact(exportOnce());
        assert.deepEqual(empty.payload.auditEvents, []);
        assert.equal(empty.manifest.recordCounts.auditEvents, 0);
        db.close();
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
