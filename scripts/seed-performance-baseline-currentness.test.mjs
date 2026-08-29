/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const NODE_24 = process.version.startsWith('v24.');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSeed(dataDir) {
  const result = spawnSync(process.execPath, [
    'scripts/run-strip-types.mjs',
    'scripts/seed-performance-baseline.mjs',
    '--data-dir', dataDir,
    '--patients', '2',
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

test('performance seed gives every synthetic attachment stable canonical currentness', { skip: !NODE_24 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-performance-currentness-'));
  const firstDir = path.join(root, 'first');
  const secondDir = path.join(root, 'second');

  try {
    const first = runSeed(firstDir);
    const second = runSeed(secondDir);
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
