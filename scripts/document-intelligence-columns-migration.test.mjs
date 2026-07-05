import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIGRATION_PATH = path.join(ROOT_DIR, 'drizzle', '0015_document_intelligence_runtime_columns.sql');

function readMigrationStatements() {
  return fs
    .readFileSync(MIGRATION_PATH, 'utf8')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function runSql(dbPath, sql, options = {}) {
  const result = spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exited with ${result.status}`);
  }
  return result;
}

function queryLines(dbPath, sql) {
  const result = runSql(dbPath, sql);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function columnNames(dbPath, tableName) {
  return queryLines(dbPath, `SELECT name FROM pragma_table_info('${tableName}') ORDER BY cid;`);
}

function createPreMigrationTables(dbPath) {
  runSql(dbPath, `
    CREATE TABLE patients (
      id text PRIMARY KEY NOT NULL,
      ai_summary text
    );

    CREATE TABLE observations (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      value text NOT NULL
    );
  `);
}

function applyMigrationWithDuplicateColumnGuard(dbPath) {
  for (const statement of readMigrationStatements()) {
    const result = runSql(dbPath, `${statement};`, { allowFailure: true });
    if (result.status !== 0 && !/duplicate column name/i.test(result.stderr)) {
      throw new Error(result.stderr || result.stdout || `sqlite3 exited with ${result.status}`);
    }
  }
}

test('document intelligence runtime columns migration adds explicit columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-0015-migration-'));
  const dbPath = path.join(dir, 'medical.db');
  try {
    createPreMigrationTables(dbPath);
    runSql(dbPath, fs.readFileSync(MIGRATION_PATH, 'utf8'));

    assert.deepEqual(
      ['ai_summary_generated_at', 'ai_summary_context_hash'].filter((column) => columnNames(dbPath, 'patients').includes(column)),
      ['ai_summary_generated_at', 'ai_summary_context_hash'],
    );
    assert.deepEqual(
      ['ref_low', 'ref_high', 'ref_text'].filter((column) => columnNames(dbPath, 'observations').includes(column)),
      ['ref_low', 'ref_high', 'ref_text'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('document intelligence runtime columns migration is safe after runtime ensureColumn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-0015-existing-'));
  const dbPath = path.join(dir, 'medical.db');
  try {
    createPreMigrationTables(dbPath);
    runSql(dbPath, fs.readFileSync(MIGRATION_PATH, 'utf8'));

    assert.doesNotThrow(() => applyMigrationWithDuplicateColumnGuard(dbPath));
    assert.ok(columnNames(dbPath, 'patients').includes('ai_summary_generated_at'));
    assert.ok(columnNames(dbPath, 'observations').includes('ref_text'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
