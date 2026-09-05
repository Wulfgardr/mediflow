/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');

test('rebuilds from migrations when the legacy database has no users table', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-prepare-e2e-'));
  const dataDir = path.join(sandbox, 'mediflow-data');
  try {
    fs.cpSync(path.join(root, 'drizzle'), path.join(sandbox, 'drizzle'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'medical.db'), '');

    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare-e2e-db.mjs')], {
      cwd: sandbox,
      env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true });
    try {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get());
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('isolated mode ignores a valid legacy database', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-prepare-e2e-isolated-'));
  const seedDir = path.join(sandbox, 'seed-data');
  const dataDir = path.join(sandbox, 'isolated-data');
  const prepare = (directory, extraEnvironment = {}) => spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'prepare-e2e-db.mjs')],
    {
      cwd: sandbox,
      env: { ...process.env, MEDIFLOW_DATA_DIR: directory, ...extraEnvironment },
      encoding: 'utf8',
    },
  );
  try {
    fs.cpSync(path.join(root, 'drizzle'), path.join(sandbox, 'drizzle'), { recursive: true });
    const seed = prepare(seedDir);
    assert.equal(seed.status, 0, `${seed.stdout}\n${seed.stderr}`);
    fs.copyFileSync(path.join(seedDir, 'medical.db'), path.join(sandbox, 'medical.db'));
    const legacy = new Database(path.join(sandbox, 'medical.db'));
    try { legacy.exec('CREATE TABLE legacy_copy_marker (id INTEGER PRIMARY KEY)'); }
    finally { legacy.close(); }

    const isolated = prepare(dataDir, { MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' });
    assert.equal(isolated.status, 0, `${isolated.stdout}\n${isolated.stderr}`);
    const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true });
    try {
      assert.equal(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_copy_marker'",
      ).get(), undefined);
    } finally { db.close(); }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
