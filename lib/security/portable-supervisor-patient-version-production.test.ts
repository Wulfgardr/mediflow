/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-supervisor-patient-version-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;
const bootstrap = new Database(databasePath);
for (const migration of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', migration), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.prepare(`INSERT INTO ambulatories (id, name, type, is_default)
  VALUES (?, ?, 'test', 1), (?, ?, 'test', 0)`).run(
  'ambulatory.synthetic.supervisor.a', 'Synthetic Supervisor A',
  'ambulatory.synthetic.supervisor.b', 'Synthetic Supervisor B',
);
bootstrap.prepare(`INSERT INTO patients
  (id, first_name, last_name, tax_code, is_archived, version)
  VALUES (?, ?, ?, ?, 0, 7)`).run(
  'patient.synthetic.supervisor.a', 'Synthetic', 'Patient', 'SYNTHETIC-CODE',
);
bootstrap.prepare(`INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id)
  VALUES (?, ?)`).run('patient.synthetic.supervisor.a', 'ambulatory.synthetic.supervisor.a');
bootstrap.close();

const {
  PortableSupervisorPatientVersionProductionV1Error,
  createPortableSupervisorPatientVersionProductionV1,
} = await import('./portable-supervisor-patient-version-production.ts');
const { dbServer } = await import('../db-server.ts');
const readVersion = createPortableSupervisorPatientVersionProductionV1();

after(() => { dbServer.$client.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function rejected(code: string) {
  return (error: unknown) => error instanceof PortableSupervisorPatientVersionProductionV1Error
    && error.code === code && !/patient\.synthetic|ambulatory\.synthetic/iu.test(error.message);
}

test('returns a synchronous version only for the exact live membership', () => {
  assert.equal(readVersion('patient.synthetic.supervisor.a', 'ambulatory.synthetic.supervisor.a'), 7);
  assert.throws(() => readVersion(
    'patient.synthetic.supervisor.a', 'ambulatory.synthetic.supervisor.b',
  ), rejected('patient_unavailable'));

  const sqlite = new Database(databasePath);
  try {
    sqlite.prepare('UPDATE patients SET version = 8 WHERE id = ?').run('patient.synthetic.supervisor.a');
    assert.equal(readVersion('patient.synthetic.supervisor.a', 'ambulatory.synthetic.supervisor.a'), 8);
    sqlite.prepare('UPDATE patients SET is_archived = 1 WHERE id = ?').run('patient.synthetic.supervisor.a');
    assert.throws(() => readVersion(
      'patient.synthetic.supervisor.a', 'ambulatory.synthetic.supervisor.a',
    ), rejected('patient_unavailable'));
  } finally { sqlite.close(); }
});

test('rejects malformed identifiers before querying host membership', () => {
  for (const pair of [
    ['', 'ambulatory.synthetic.supervisor.a'],
    ['patient.synthetic.supervisor.a', '../ambulatory'],
    [`patient.${'x'.repeat(129)}`, 'ambulatory.synthetic.supervisor.a'],
  ]) {
    assert.throws(() => readVersion(pair[0]!, pair[1]!), rejected('input_invalid'));
  }
});
