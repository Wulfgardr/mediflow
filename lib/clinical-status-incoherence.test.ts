import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* WUL-800, punto 7: conteggio in sola lettura delle righe incoerenti, su SQLite reale e dati sintetici. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'status-incoherence-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { countClinicalStatusIncoherence } = await import('./clinical-status-incoherence.ts');
const file = join(dir, 'medical.db');
const sql = new Database(file);
test.after(() => { sql.close(); dbServer.$client.close(); });

sql.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('p', 'Synthetic', 'Patient', 'SYNTHETIC')").run();
const insert = (statement: string, ...values: unknown[]) => sql.prepare(statement).run(...values);
insert("INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date, end_date) VALUES ('t1','p','ENC:x','ENC:x','stopped',1,NULL)");
insert("INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date, end_date) VALUES ('t2','p','ENC:x','ENC:x','completed',1,2)");
insert("INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date) VALUES ('t3','p','ENC:x','ENC:x','legacy',1)");
insert("INSERT INTO prosthetic_prescriptions (id, patient_id, prescribed_at, description, status, collaudo_at) VALUES ('r1','p',1,'ENC:x','tested',NULL)");
insert("INSERT INTO prosthetic_prescriptions (id, patient_id, prescribed_at, description, status, collaudo_at) VALUES ('r2','p',1,'ENC:x','delivered',5)");
insert("INSERT INTO siss_handoff_events (id, patient_id, action, module_label, started_at, outcome, completed_at) VALUES ('s1','p','menu.open','Menu',1,'started',3)");
insert("INSERT INTO siss_handoff_events (id, patient_id, action, module_label, started_at, outcome, completed_at) VALUES ('s2','p','menu.open','Menu',1,'blocked',NULL)");
insert("INSERT INTO checkups (id, patient_id, date, title, status) VALUES ('c1','p',1,'ENC:x','done')");
insert("INSERT INTO checkups (id, patient_id, date, title, status) VALUES ('c2','p',1,'ENC:x','sometime')");

test('counts the saved rows that contradict the rules, aliases included, and nothing else', () => {
    const counts = countClinicalStatusIncoherence(sql);
    assert.equal(counts.therapyCompletedWithoutEndDate, 1, 'stopped vale come completed');
    assert.equal(counts.therapyUnknownStatus, 1);
    assert.equal(counts.prostheticTestedWithoutCollaudoDate, 1);
    assert.equal(counts.prostheticCollaudoOnUntestedStatus, 1);
    assert.equal(counts.sissHandoffStartedWithCompletionDate, 1);
    assert.equal(counts.sissHandoffClosedWithoutCompletionDate, 1);
    assert.equal(counts.checkupUnknownStatus, 1, 'done è un alias, sometime no');
    assert.equal(counts.servicePrescriptionUnknownStatus, 0);
});

test('the command opens the archive read-only, prints counts only and leaves the file identical', () => {
    sql.pragma('wal_checkpoint(TRUNCATE)');
    const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
    const before = digest();
    const run = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/count-clinical-status-incoherence.ts', file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, number>;
    assert.ok(Object.values(printed).every((value) => Number.isInteger(value)));
    assert.equal(printed.therapyCompletedWithoutEndDate, 1);
    assert.doesNotMatch(run.stdout, /ENC:|Synthetic|SYNTHETIC|"t1"|"r1"/);
    assert.equal(digest(), before);
});
