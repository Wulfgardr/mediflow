import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');
const loader = pathToFileURL(path.join(root, 'scripts/register-strip-types-loader.mjs')).href;
const worker = `
  import fs from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  import { syncBuiltinESMExports } from 'node:module';
  const [syntheticHome, rejectLegacyProbe] = process.argv.slice(1);
  os.homedir = () => syntheticHome;
  const exists = fs.existsSync;
  fs.existsSync = (value) => {
    if (rejectLegacyProbe === 'yes' && path.resolve(String(value)) === path.join(process.cwd(), 'medical.db')) {
      throw new Error('UNEXPECTED_LEGACY_SOURCE_PROBE');
    }
    return exists(value);
  };
  syncBuiltinESMExports();
  const { openDbServer, dbServer } = await import('@/lib/db-server');
  if (rejectLegacyProbe === 'sticky-copy-failure') {
    const { default: assert } = await import('node:assert/strict');
    const { resolveDataPath } = await import('@/lib/data-dir');
    let failure;
    try { openDbServer(); } catch (error) { failure = error; }
    assert.ok(failure, 'corrupt legacy copy must deny opening');
    assert.equal(fs.existsSync(resolveDataPath('medical.db')), false, 'failed copy created an empty clinical database');
    fs.renameSync(path.join(process.cwd(), 'medical.db'), path.join(process.cwd(), 'preserved-corrupt-original'));
    assert.throws(() => openDbServer(), error => error === failure);
    assert.throws(() => dbServer.$client.open, error => error === failure);
    assert.equal(fs.existsSync(resolveDataPath('medical.db')), false, 'retry silently created a new clinical database');
  } else openDbServer();
`;

function bootstrap(sandbox, { directory, disableLegacy = false, rejectLegacyProbe = false, stickyCopyFailure = false } = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  delete env.MEDIFLOW_DATA_DIR;
  delete env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY;
  delete env.NEXT_PHASE;
  if (directory !== undefined) env.MEDIFLOW_DATA_DIR = directory;
  if (disableLegacy) env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', loader, '--input-type=module', '-e', worker,
    path.join(sandbox, 'synthetic-home'), stickyCopyFailure ? 'sticky-copy-failure' : rejectLegacyProbe ? 'yes' : 'no',
  ], { cwd: sandbox, env, encoding: 'utf8', timeout: 30_000 });
}

function expectReady(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function marker(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='synthetic_context_marker'").get()) return null;
    return db.prepare('SELECT value FROM synthetic_context_marker').pluck().get();
  } finally { db.close(); }
}

function withLegacy(run) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-data-isolation-'));
  const source = path.join(sandbox, 'medical.db');
  try {
    // No legacy source exists yet. This creates the real canonical schema only
    // inside the owned sandbox, independently of any database in the checkout.
    expectReady(bootstrap(sandbox, { directory: sandbox, disableLegacy: true }));
    const db = new Database(source);
    try {
      db.exec("CREATE TABLE synthetic_context_marker (value TEXT NOT NULL); INSERT INTO synthetic_context_marker VALUES ('SYNTHETIC-LEGACY');");
    } finally { db.close(); }
    const before = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    run(sandbox, source);
    assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'), before);
    assert.equal(marker(source), 'SYNTHETIC-LEGACY');
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

test('explicit A and B data roots start empty without probing the legacy source and preserve their own data on restart', () => {
  withLegacy((sandbox) => {
    for (const context of ['A', 'B']) {
      const directory = path.join(sandbox, context);
      expectReady(bootstrap(sandbox, { directory, rejectLegacyProbe: true }));
      const dbPath = path.join(directory, 'medical.db');
      assert.equal(marker(dbPath), null);
      const db = new Database(dbPath);
      try {
        assert.deepEqual(db.prepare('SELECT count(*) AS count FROM patients').get(), { count: 0 });
        assert.deepEqual(db.prepare('SELECT count(*) AS count FROM users').get(), { count: 0 });
        db.exec('CREATE TABLE synthetic_context_marker (value TEXT NOT NULL)');
        db.prepare('INSERT INTO synthetic_context_marker VALUES (?)').run(`SYNTHETIC-${context}`);
      } finally { db.close(); }
      expectReady(bootstrap(sandbox, { directory, rejectLegacyProbe: true }));
      assert.equal(marker(dbPath), `SYNTHETIC-${context}`);
    }
  });
});

test('relative explicit data root also excludes implicit legacy import', () => {
  withLegacy((sandbox) => {
    expectReady(bootstrap(sandbox, { directory: './relative-context', rejectLegacyProbe: true }));
    assert.equal(marker(path.join(sandbox, 'relative-context/medical.db')), null);
  });
});

test('legacy-copy opt-out protects the default data root before probing the source', () => {
  withLegacy((sandbox) => {
    expectReady(bootstrap(sandbox, { disableLegacy: true, rejectLegacyProbe: true }));
    const dataDir = process.platform === 'darwin' ? 'Library/Application Support/MediFlow' : '.mediflow';
    assert.equal(marker(path.join(sandbox, 'synthetic-home', dataDir, 'medical.db')), null);
  });
});

test('historical default-root migration still copies a compatible synthetic legacy database', () => {
  withLegacy((sandbox) => {
    expectReady(bootstrap(sandbox));
    const dataDir = process.platform === 'darwin' ? 'Library/Application Support/MediFlow' : '.mediflow';
    assert.equal(marker(path.join(sandbox, 'synthetic-home', dataDir, 'medical.db')), 'SYNTHETIC-LEGACY');
  });
});

function auditObjects(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'audit_events%' ORDER BY type, name").all()
      .map((row) => `${row.type}:${row.name}`);
  } finally { db.close(); }
}

test('startup stops when the append-only audit schema cannot be established', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-schema-'));
  try {
    const directory = path.join(sandbox, 'context');
    const dbPath = path.join(directory, 'medical.db');
    expectReady(bootstrap(sandbox, { directory, rejectLegacyProbe: true }));
    const ready = auditObjects(dbPath);
    assert.ok(ready.includes('table:audit_events'));
    assert.ok(ready.includes('trigger:audit_events_no_update'));
    assert.ok(ready.includes('trigger:audit_events_no_delete'));

    // A same-named view makes the table creation a no-op and the index creation
    // fail, so the store would otherwise run without an audit table or triggers.
    const db = new Database(dbPath);
    try {
      db.exec('DROP TABLE audit_events; CREATE VIEW audit_events AS SELECT 1 AS event_id;');
    } finally { db.close(); }

    const result = bootstrap(sandbox, { directory, rejectLegacyProbe: true });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /views may not be indexed/);
    assert.deepEqual(auditObjects(dbPath), ['view:audit_events']);
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});


test('failed legacy copy cannot create an empty archive and failed opening remains sticky', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-legacy-copy-failure-'));
  const corrupt = 'SYNTHETIC-CORRUPT-NOT-A-DATABASE';
  try {
    fs.writeFileSync(path.join(sandbox, 'medical.db'), corrupt);
    expectReady(bootstrap(sandbox, { stickyCopyFailure: true }));
    assert.equal(fs.readFileSync(path.join(sandbox, 'preserved-corrupt-original'), 'utf8'), corrupt);
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});
