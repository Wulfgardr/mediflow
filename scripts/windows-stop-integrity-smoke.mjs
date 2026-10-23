import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAdmittedSqlite } from '../lib/sqlite-maintenance-admission.mjs';
import { stopOwnedChild } from './mediflow.mjs';

const script = fileURLToPath(import.meta.url);
const record = event => console.error('[windows-stop-integrity] ' + JSON.stringify({ ...event,
  at: Date.now(), monotonicNs: process.hrtime.bigint().toString(), node: process.version, execPath: process.execPath, uv: process.versions.uv }));
const bounded = async (operation, milliseconds) => {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic stop observation deadline.')), milliseconds);
  })]); } finally { clearTimeout(timer); }
};

export function committedArchiveProbe(directory, token, write = false) {
  const file = path.join(directory, 'medical.db');
  assert.ok(fs.statSync(file).isFile(), 'Web must initialize its own archive first');
  const lease = openAdmittedSqlite(file, { role: 'synthetic-stop-smoke', sqliteOptions: { fileMustExist: true } });
  try {
    const db = lease.database;
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    if (write) {
      db.exec('CREATE TABLE launcher_stop_smoke (token TEXT PRIMARY KEY)');
      db.transaction(() => db.prepare('INSERT INTO launcher_stop_smoke VALUES (?)').run(token))();
    }
    assert.deepEqual(db.prepare('SELECT token FROM launcher_stop_smoke').all(), [{ token }]);
    record({ type: write ? 'archive-committed' : 'archive-verified', file, token, integrity: 'ok' });
  } finally { lease.closeSync(); }
}

export async function windowsTransactionTreeProbe(directory) {
  assert.equal(process.platform, 'win32', 'The tree/rollback gate requires real Windows');
  const fixture = fs.mkdtempSync(path.join(directory, 'forced-tree-'));
  const generation = crypto.randomUUID(), database = path.join(fixture, 'synthetic.db');
  const child = spawn(process.execPath, [script, '--tree-leader', fixture, generation], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: fixture, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  });
  record({ type: 'leader-created', pid: child.pid, generation, fixture });
  let stopAttempted = false, confirmed = false;
  const exit = new Promise(resolve => child.once('exit', (code, signal) => {
    record({ type: 'leader-exit', pid: child.pid, generation, code, signal }); resolve();
  }));
  const stderrClosed = new Promise(resolve => child.stderr.once('close', () => {
    record({ type: 'leader-stderr-close', pid: child.pid, generation }); resolve();
  }));
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  let ready, failed;
  const readiness = new Promise((resolve, reject) => {
    ready = frame => {
      if (frame?.type !== 'transaction-open') return;
      if (frame.generation !== generation || frame.leader !== child.pid) { reject(new Error('Synthetic tree identity mismatch')); return; }
      resolve(frame);
    };
    failed = error => reject(error);
    child.on('message', ready); child.on('error', failed);
    exit.then(() => reject(new Error('Synthetic leader exited before readiness')));
  });
  try {
    const frame = await bounded(readiness, 8000);
    assert.ok(Number.isSafeInteger(frame.writer) && frame.writer > 0);
    assert.equal(frame.openRows, 128); assert.ok(frame.walBytes > 0);
    const url = `http://127.0.0.1:${frame.port}`;
    assert.equal(await fetch(url, { signal: AbortSignal.timeout(1000) }).then(response => response.text()), generation);
    record({ type: 'transaction-open', ...frame, database });
    stopAttempted = true;
    await stopOwnedChild(child, 8000);
    await bounded(Promise.all([exit, stderrClosed]), 5000);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }), 'The transaction descendant must no longer serve HTTP');
    const lease = openAdmittedSqlite(database, { role: 'synthetic-stop-check', sqliteOptions: { fileMustExist: true } });
    try {
      const db = lease.database;
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.prepare('SELECT id, value FROM synthetic_stop_rows ORDER BY id').all(), [{ id: 'committed', value: generation }]);
    } finally { lease.closeSync(); }
    confirmed = true;
    record({ type: 'tree-rollback-confirmed', pid: child.pid, writer: frame.writer, generation, integrity: 'ok', incompleteRows: 0 });
  } finally {
    child.off('message', ready); child.off('error', failed);
    if (!stopAttempted && child.exitCode === null && child.signalCode === null) {
      stopAttempted = true;
      try { await stopOwnedChild(child, 8000); await bounded(Promise.all([exit, stderrClosed]), 5000); }
      catch (error) { record({ type: 'cleanup-unconfirmed', pid: child.pid, generation, message: error.message }); }
    }
    if (confirmed) fs.rmSync(fixture, { recursive: true });
    else {
      record({ type: 'fixture-preserved', pid: child.pid, generation, fixture, stopAttempted, exitCode: child.exitCode, signalCode: child.signalCode });
      if (child.connected) child.disconnect();
      child.stderr.unref(); child.unref();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [mode, directory, generation] = process.argv.slice(2);
  assert.ok(process.connected && /^[a-f0-9-]{36}$/u.test(generation));
  assert.equal(process.env.MEDIFLOW_DATA_DIR, directory);
  assert.equal(process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY, '1');
  if (mode === '--transaction-writer') {
    const lease = openAdmittedSqlite(path.join(directory, 'synthetic.db'), { role: 'synthetic-stop-writer' });
    const db = lease.database;
    db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); db.pragma('cache_size = 8');
    db.exec('CREATE TABLE synthetic_stop_rows (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO synthetic_stop_rows VALUES (?,?)').run('committed', generation);
    db.exec('BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO synthetic_stop_rows VALUES (?,?)');
    for (let index = 0; index < 128; index++) insert.run('incomplete-' + index, 'synthetic-'.repeat(1024));
    assert.equal(db.inTransaction, true);
    const server = http.createServer((_request, response) => response.end(generation));
    server.listen(0, '127.0.0.1', () => process.send({ type: 'transaction-open', generation, writer: process.pid,
      port: server.address().port, openRows: 128, walBytes: fs.statSync(path.join(directory, 'synthetic.db-wal')).size }, error => {
      if (error) { record({ type: 'writer-delivery-error', message: error.message }); process.exitCode = 1; server.close(); }
    }));
  } else {
    assert.equal(mode, '--tree-leader');
    const writer = spawn(process.execPath, [script, '--transaction-writer', directory, generation], {
      env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    record({ type: 'writer-created', leader: process.pid, pid: writer.pid, generation });
    writer.stderr.on('data', bytes => process.stderr.write(bytes));
    writer.once('exit', (code, signal) => record({ type: 'writer-exit', pid: writer.pid, generation, code, signal }));
    writer.stderr.once('close', () => record({ type: 'writer-stderr-close', pid: writer.pid, generation }));
    writer.on('error', error => { record({ type: 'writer-error', message: error.message }); process.exitCode = 1; });
    writer.on('message', frame => {
      assert.equal(frame.writer, writer.pid); assert.equal(frame.generation, generation);
      process.send({ ...frame, leader: process.pid }, error => {
        if (error) { record({ type: 'leader-delivery-error', message: error.message }); process.exitCode = 1; }
      });
    });
  }
}
