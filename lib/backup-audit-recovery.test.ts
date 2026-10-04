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
import type { BackupAuditRow } from './backup-audit';

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
    "try { const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.AUDIT_ARTIFACT_PATH, 'utf8'))); result = restoreBackupArtifact(artifact, () => { fence++; return false; }); } catch (caught) { error = caught.message; }",
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

test('manual and scheduled producers keep one SQLite snapshot across a concurrent clinical/audit commit', async () => {
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
                "other.transaction(() => { other.prepare(\"UPDATE patients SET last_name='After', version=2 WHERE id='snapshot-patient'\").run(); other.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(JSON.parse(process.env.SNAPSHOT_AUDIT_ROW))); })(); other.close(); } return prepared; };",
                "if (process.env.SNAPSHOT_PRODUCER === 'scheduled') { process.argv[1] = path.resolve('scripts/run-scheduled-backup.mjs'); await import('./scripts/run-scheduled-backup.mjs'); } else {",
                "const source = ts.createSourceFile('route.ts', fs.readFileSync('app/api/system/backup-restore/route.ts','utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);",
                "const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['sortBackupRows','filterRowsByReference','buildBackupDataset'].includes(node.name?.text)).map(node => node.getText(source)).join('\\n');",
                "const schemaImport = source.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/lib/schema' && ts.isNamedImports(node.importClause?.namedBindings));",
                "const names = schemaImport.importClause.namedBindings.elements.map(node => node.name.text);",
                "const code = ts.transpileModule(functions, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;",
                "const snapshot = new Function('dbServer','tables','sql','snapshotBackupAudit','enrichBackupPatientsWithAmbulatoryLinks', 'const {' + names.join(',') + '} = tables; const backupSchema = tables; ' + code + '; return buildBackupDataset();')(dbServer,tables,sql,snapshotBackupAudit,enrichBackupPatientsWithAmbulatoryLinks);",
                "console.log(await serializeBackupArtifact(snapshot)); }",
            ].join('\n');
            const output = evalNode(dir, script, {
                SNAPSHOT_PRODUCER: producer, SNAPSHOT_AUDIT_ROW: JSON.stringify(concurrentRow),
                MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(dir, 'backups'),
            });
            const result = JSON.parse(output);
            const raw = producer === 'scheduled' ? JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')) : result;
            const artifact = await parseBackupArtifact(raw);
            assert.equal(artifact.payload.patients[0].lastName, 'Before');
            assert.deepEqual(artifact.payload.auditEvents?.map(row => row.eventId), ['synthetic-before']);
            const observed = new Database(path.join(dir, 'medical.db'));
            try {
                assert.equal((observed.prepare("SELECT last_name FROM patients WHERE id='snapshot-patient'").get() as { last_name: string }).last_name, 'After');
                assert.equal((observed.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n, 2);
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
