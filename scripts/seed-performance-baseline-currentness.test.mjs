/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createDecipheriv } from 'node:crypto';

const NODE_24 = process.version.startsWith('v24.');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSeed(dataDir, patients = 2) {
  const result = spawnSync(process.execPath, [
    'scripts/run-strip-types.mjs',
    'scripts/seed-performance-baseline.mjs',
    '--data-dir', dataDir,
    '--patients', String(patients),
    '--entries-per-patient', '0',
    '--observations-per-patient', '0',
    '--documents-per-patient', '2',
  ], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: { ...process.env, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function readAttachmentCurrentness(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`
      SELECT id, document_source_ref, document_revision, document_freshness_epoch
      FROM attachments
      ORDER BY id
    `).all();
  } finally {
    db.close();
  }
}

function decryptFixture(value) {
  const [, iv, payload] = value.split(':');
  const bytes = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm',
    Buffer.from('83c4f061bfd9c7d14fe63f7566fc0aa980b16019d8d8ab4a8ef971b52508b6db', 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString());
}

test('performance seed can open and submit the current patient editor without changing related rows', { skip: !NODE_24 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-performance-editor-'));
  try {
    const seed = runSeed(root);
    const db = new Database(seed.dbPath, { readonly: true });
    let record;
    try {
      const patient = db.prepare('SELECT * FROM patients ORDER BY id LIMIT 1').get();
      record = {
        id: patient.id, version: patient.version, firstName: patient.first_name, lastName: patient.last_name,
        taxCode: patient.tax_code, birthDate: new Date(patient.birth_date * 1000).toISOString(),
        diagnoses: decryptFixture(patient.diagnoses),
        checkups: db.prepare('SELECT * FROM checkups WHERE patient_id = ? ORDER BY id').all(patient.id).map(row => ({
          id: row.id, patientId: row.patient_id, version: row.version, title: row.title,
          date: new Date(row.date * 1000).toISOString(), status: row.status, source: row.source,
          notes: decryptFixture(row.notes),
        })),
      };
    } finally { db.close(); }
    // Use the actual form schema/session through the existing Node24 loader.
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { PatientEditSession } from '@/lib/patient-edit-session';
      import { patientSchema } from '@/lib/schemas';
      const session = new PatientEditSession(JSON.parse(fs.readFileSync(0, 'utf8')));
      const draft = patientSchema.parse(session.getDefaultValues());
      const writes = [];
      const port = Object.fromEntries(['updatePatient', 'updateCheckup', 'deleteCheckup', 'createCheckup'].map(key =>
        [key, async (...args) => { writes.push({ key, args }); }]));
      await session.submit({ ...draft, firstName: 'BaselineAggiornata' }, port, () => 'unexpected-create');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].key, 'updatePatient');
      assert.equal(writes[0].args[0], 'perf-patient-000000');
      assert.equal(writes[0].args[1].version, 1);
    `], { cwd: ROOT_DIR, input: JSON.stringify(record), encoding: 'utf8',
      env: { ...process.env, MEDIFLOW_DATA_DIR: root, MEDIFLOW_STRIP_TYPES_NODE: process.execPath } });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('performance seed gives every synthetic attachment stable canonical currentness', { skip: !NODE_24 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-performance-currentness-'));
  const firstDir = path.join(root, 'first');
  const secondDir = path.join(root, 'second');

  try {
    const first = runSeed(firstDir);
    const second = runSeed(secondDir);
    assert.equal(first.schemaVersion, 'mediflow.performance_seed.v2');
    assert.equal(first.fixtureRevision, 2);
    assert.deepEqual(first.cardinalities, { users: 1, ambulatories: 1, patients: 2, memberships: 2,
      entries: 0, observations: 0, checkups: 4, attachments: 4 });
    assert.match(first.logicalSHA256, /^[0-9a-f]{64}$/u);
    assert.equal(first.logicalSHA256, second.logicalSHA256, 'independent seed runs must have identical logical contents');
    const changed = runSeed(path.join(root, 'changed'), 3);
    assert.notEqual(first.logicalSHA256, changed.logicalSHA256, 'a changed workload must have a different identity');
    const firstRows = readAttachmentCurrentness(first.dbPath);
    const secondRows = readAttachmentCurrentness(second.dbPath);

    assert.equal(firstRows.length, 4);
    assert.deepEqual(firstRows, secondRows);
    assert.equal(new Set(firstRows.map((row) => row.document_source_ref)).size, firstRows.length);
    assert.deepEqual(firstRows[0], {
      id: 'perf-patient-000000-document-00',
      document_source_ref: 'f3d48e61988095ded6ef7776b0a95c52cbd41e25c5bad07e172c601d5e240435',
      document_revision: 1,
      document_freshness_epoch: 1,
    });

    for (const row of firstRows) {
      assert.match(row.id, /^perf-patient-\d{6}-document-\d{2}$/u);
      assert.match(row.document_source_ref, /^[0-9a-f]{64}$/u);
      assert.equal(row.document_revision, 1);
      assert.equal(row.document_freshness_epoch, 1);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
