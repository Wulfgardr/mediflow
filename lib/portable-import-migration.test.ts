import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';

function original() {
    const parent = process.env.MEDIFLOW_DATA_DIR || tmpdir(); mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, 'v6-')), file = join(root, 'medical.db');
    const db = openVersionedSqliteDatabase(file);
    db.exec('DROP TABLE portable_import_origins; PRAGMA user_version=6;');
    db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,notes) VALUES (?,?,?,?,?)').run('synthetic-upgrade', 'Persona', 'Sintetica', 'SYNTHETIC-UPGRADE', 'ENC:synthetic:preserved');
    db.prepare('INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface) VALUES (?,?,1,?,?,?,?,?,?)')
        .run('untrusted-history-marker', 'backup.audit.imported', 'success', 'system', 'claimed-host', 'audit_event', 'arbitrary-local-event', 'web');
    const patients = db.prepare('SELECT * FROM patients').all();db.close();return { root, file, patients };
}
test('v6 upgrades to v8 atomically, keeps a verified original and never derives authority from old markers', () => {
    const f = original(), db = openVersionedSqliteDatabase(f.file);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
    assert.equal(CURRENT_SQLITE_SCHEMA_VERSION, 8);
    assert.deepEqual(db.prepare('SELECT * FROM patients').all(), f.patients);
    assert.deepEqual(db.prepare('SELECT * FROM portable_import_origins').all(), []);
    const copies = readdirSync(f.root).filter(name => name.includes('.schema-original-v6-'));
    assert.equal(copies.length, 1);
    const before = new Database(join(f.root, copies[0]!), { readonly: true });
    assert.equal(before.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(before.prepare('SELECT * FROM patients').all(), f.patients);before.close();
    db.close();openVersionedSqliteDatabase(f.file).close();
    assert.equal(readdirSync(f.root).filter(name => name.includes('.schema-original-v6-')).length, 1);
});
test('a failure after provenance DDL rolls back schema, stamp and clinical rows', () => {
    const f = original();
    assert.throws(() => openVersionedSqliteDatabase(f.file, file => {
        const db = new Database(file), exec = db.exec.bind(db);
        db.exec = source => { const result = exec(source); if (source.includes('portable_import_origins_no_delete')) throw new Error('SYNTHETIC_ORIGIN_DDL_FAILURE'); return result; };
        return db;
    }), /SYNTHETIC_ORIGIN_DDL_FAILURE/);
    const db = new Database(f.file, { readonly: true });
    assert.equal(db.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(db.prepare('SELECT * FROM patients').all(), f.patients);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='portable_import_origins'").get(), undefined);db.close();
});

for (const version of [6, 7]) for (const history of ['settings', 'legacy', 'none']) test(`v${version} ${history} history fixes the old set once and propagates unattested origin`, async () => {
    const { execFileSync } = await import('node:child_process');
    const f = original(), before = new Database(f.file);
    if (version === 7) {
        before.exec(`CREATE TABLE portable_import_origins (
            kind TEXT NOT NULL CHECK (kind IN ('audit', 'therapy_command')),
            ref TEXT NOT NULL CHECK (length(ref) > 0), import_event_id TEXT NOT NULL REFERENCES audit_events(event_id), PRIMARY KEY(kind,ref));
            CREATE TRIGGER portable_import_origins_no_update BEFORE UPDATE ON portable_import_origins BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;
            CREATE TRIGGER portable_import_origins_no_delete BEFORE DELETE ON portable_import_origins BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;
            PRAGMA user_version=7;`);
    }
    const actor = 'synthetic-origin-migration', commandId = '22222222-2222-4222-8222-222222222222';
    const generation = before.prepare('SELECT generation FROM archive_generation').pluck().get() as string;
    before.prepare('INSERT INTO users(id,username,password_hash,encrypted_master_key,salt,role) VALUES (?,?,?,?,?,?)').run(actor, actor, 'synthetic', 'synthetic', 'synthetic', 'admin');
    before.prepare("INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,source_surface) VALUES ('historical-native','therapy.updated',1,'success','user',?,'therapy','native')").run(actor);
    before.prepare("INSERT INTO therapy_status_commands VALUES (?,'therapy.status.change.v1',?,?,'synthetic-upgrade','synthetic-therapy',1,NULL,'closed',NULL,1,NULL,NULL,NULL,NULL)").run(commandId,generation,actor);
    if (history === 'settings') before.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('archive.restore.receipt.'+commandId, JSON.stringify({ id: commandId, sourceChecksum: 'a'.repeat(64), archiveGeneration: generation, completedAt: new Date().toISOString() }));
    if (history === 'legacy') before.exec("INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,source_surface) VALUES ('legacy-root','backup.portable.imported',1,'success','system','synthetic','backup','web')");
    if (version === 7 && history === 'legacy') before.exec("INSERT INTO portable_import_origins(kind,ref,import_event_id) VALUES ('audit','historical-native','legacy-root')");
    const auditBefore = before.prepare('SELECT * FROM audit_events ORDER BY event_id').all(); before.close();
    const code = `
        import { createRequire } from 'node:module';
        const load=createRequire(process.cwd()+'/lib/portable-import-migration.test.ts');
        const {openDbServer}=load('./db-server.ts');const db=openDbServer();
        const {issueSyntheticWebSession}=load('./security/web-auth-lifecycle-owner-test-fixture.ts');
        const {readTherapyStatusReceipt}=load('./therapy-status-command-service.ts');
        const {listAuditEvents,summarizeAuditEvents,writeAuditEvent}=load('./security/audit.ts');
        const username=${JSON.stringify(actor)};
        const session=issueSyntheticWebSession({id:username,username,role:'admin'},'synthetic-migration-session');
        const receipt=readTherapyStatusReceipt(session,{commandId:${JSON.stringify(commandId)},protocol:'therapy.status.change.v1',archiveGeneration:${JSON.stringify(generation)},patientId:'synthetic-upgrade',therapyId:'synthetic-therapy',expectedVersion:1});
        const filters={eventType:'therapy.updated',limit:2};
        const local=await listAuditEvents(filters), imported=await listAuditEvents({...filters,origin:'imported'}), unattested=await listAuditEvents({...filters,origin:'unattested'});
        await writeAuditEvent({eventType:'therapy.updated',actorType:'user',actorRef:username,subjectType:'therapy',sourceSurface:'web',outcome:'success'});
        const future=await listAuditEvents(filters);
        console.log('RESULT:'+JSON.stringify({receipt,local,imported,unattested,summary:summarizeAuditEvents([...local,...imported,...unattested]),future}));db.close();`;
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types','--import','./scripts/register-strip-types-loader.mjs','--input-type=module','-e',code], { env: { ...process.env, MEDIFLOW_DATA_DIR: f.root }, encoding:'utf8' });
    const result = JSON.parse(stdout.split('\n').find(line => line.startsWith('RESULT:'))!.slice(7));
    const restored = history !== 'none', known = version === 7 && history === 'legacy';
    assert.equal(result.receipt.origin, restored ? 'unattested' : 'local');
    assert.equal(result.receipt.historical, restored);
    assert.equal(result.local.length, restored ? 0 : 1);
    assert.equal(result.imported.length, known ? 1 : 0);
    assert.equal(result.unattested.length, restored && !known ? 1 : 0);
    assert.equal(result.summary.totalEvents, restored ? 0 : 1);
    assert.equal(result.summary.sourceSurfaces.native, restored ? 0 : 1);
    assert.equal(result.summary.unattestedEvents, restored && !known ? 1 : 0);
    assert.equal(result.future.length, restored ? 1 : 2);
    const after = openVersionedSqliteDatabase(f.file);
    for (const row of auditBefore as {event_id:string}[]) assert.deepEqual(after.prepare('SELECT * FROM audit_events WHERE event_id=?').get(row.event_id), row);
    assert.equal(after.prepare("SELECT count(*) FROM portable_import_origins WHERE kind='audit' AND origin='unattested'").pluck().get(), restored ? auditBefore.length - Number(known) : 0);
    assert.deepEqual(after.pragma('foreign_key_check'), []); after.close();
});
