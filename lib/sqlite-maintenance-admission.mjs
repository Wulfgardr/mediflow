/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';

const SUFFIX = '.maintenance-admission';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ROOT_NAMES = new Set(['protocol.json', 'leases', 'gate', 'intent.json']);

export class SqliteMaintenanceHoldError extends Error {
  constructor(reason = 'unverified_state') {
    super(`SQLITE_MAINTENANCE_HOLD: ${reason}`);
    this.name = 'SqliteMaintenanceHoldError';
    this.code = 'SQLITE_MAINTENANCE_HOLD';
    this.reason = reason;
  }
}

class GateBusy extends SqliteMaintenanceHoldError {
  constructor() { super('admission_busy'); }
}

function hold(reason) { throw new SqliteMaintenanceHoldError(reason); }
function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function directory(file) {
  const info = stat(file);
  if (!info?.isDirectory() || info.isSymbolicLink()) hold('invalid_directory');
}
function regular(file) {
  const info = stat(file);
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) hold('invalid_file');
  return info !== null;
}
function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeRecord(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
function readRecord(file) {
  if (!regular(file)) hold('missing_record');
  if (fs.statSync(file).size > 4096) hold('invalid_record');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function same(actual, expected) {
  return actual !== null && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).sort().join(',') === Object.keys(expected).sort().join(',')
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
}
function context(file) {
  // better-sqlite3 trims the whole filename before native open. Reject any
  // such spelling BEFORE filesystem checks or deriving a separate lease key.
  if (typeof file !== 'string' || !file || file === ':memory:' || file.trim() !== file) hold('invalid_target');
  const parent = path.dirname(path.resolve(file));
  directory(parent);
  const target = path.join(fs.realpathSync(parent), path.basename(file));
  if (target.trim() !== target) hold('invalid_target');
  regular(target);
  return { target, root: target + SUFFIX };
}
function layout(ctx) {
  let created = false;
  try { fs.mkdirSync(ctx.root, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (created) {
    fs.mkdirSync(path.join(ctx.root, 'leases'), { mode: 0o700 });
    writeRecord(path.join(ctx.root, 'protocol.json'), { version: 1, target: ctx.target });
    syncDirectory(path.dirname(ctx.root));
  }
  directory(ctx.root);
  directory(path.join(ctx.root, 'leases'));
  if (fs.readdirSync(ctx.root).some(name => !ROOT_NAMES.has(name))) hold('unknown_artifact');
  if (!same(readRecord(path.join(ctx.root, 'protocol.json')), { version: 1, target: ctx.target })) hold('protocol_mismatch');
  if (stat(path.join(ctx.root, 'gate'))) directory(path.join(ctx.root, 'gate'));
  regular(path.join(ctx.root, 'intent.json'));
}
function gate(ctx, operation) {
  layout(ctx);
  const dir = path.join(ctx.root, 'gate');
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new GateBusy(); throw error; }
  const marker = { version: 1, id: randomUUID(), target: ctx.target, pid: process.pid };
  // A failed or interrupted marker write deliberately leaves the gate on HOLD.
  writeRecord(path.join(dir, 'owner.json'), marker);
  try { return operation(); }
  finally {
    directory(dir);
    if (fs.readdirSync(dir).join(',') !== 'owner.json'
      || !same(readRecord(path.join(dir, 'owner.json')), marker)) hold('gate_ownership_lost');
    fs.unlinkSync(path.join(dir, 'owner.json'));
    fs.rmdirSync(dir);
    syncDirectory(ctx.root);
  }
}
function assertRecord(record, ctx, id, role) {
  if (!record || record.version !== 1 || record.target !== ctx.target || record.id !== id
    || !UUID.test(id) || !Number.isSafeInteger(record.pid) || record.pid < 1
    || !/^[a-z][a-z0-9-]{0,63}$/.test(record.role)
    || (role !== undefined && record.role !== role)
    || Object.keys(record).sort().join(',') !== 'id,pid,role,target,version') hold('invalid_participant');
}
function leases(ctx) {
  return fs.readdirSync(path.join(ctx.root, 'leases')).map(name => {
    if (!name.endsWith('.json')) hold('unknown_participant');
    const id = name.slice(0, -5);
    const record = readRecord(path.join(ctx.root, 'leases', name));
    assertRecord(record, ctx, id);
    return record;
  });
}
function noRecoveryArtifacts(ctx) {
  const base = path.basename(ctx.target);
  if (fs.readdirSync(path.dirname(ctx.target)).some(name => name === base + '.swap-recovery'
    || name.startsWith(base + '.old-') || name.startsWith(base + '.repair-tmp'))) hold('swap_recovery_pending');
}
function normalize(error) {
  return error instanceof SqliteMaintenanceHoldError ? error : new SqliteMaintenanceHoldError('unverified_state');
}
function timeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) hold('invalid_deadline');
  return performance.now() + value;
}
async function waitGate(ctx, deadline, operation) {
  for (;;) {
    try { return gate(ctx, operation); }
    catch (error) {
      if (!(error instanceof GateBusy) || performance.now() >= deadline) throw error;
      await delay(Math.min(10, Math.max(1, deadline - performance.now())));
    }
  }
}

/** Register before native open. Only successful native close permits lease removal. */
export function openAdmittedSqlite(file, { role = 'participant', sqliteOptions = {} } = {}) {
  let ctx, record;
  try {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(role)) hold('invalid_role');
    ctx = context(file);
    record = { version: 1, target: ctx.target, id: randomUUID(), role, pid: process.pid };
    gate(ctx, () => {
      leases(ctx);
      if (regular(path.join(ctx.root, 'intent.json'))) hold('maintenance_pending');
      noRecoveryArtifacts(ctx);
      writeRecord(path.join(ctx.root, 'leases', record.id + '.json'), record);
    });
  } catch (error) { throw normalize(error); }

  let db;
  try { db = new Database(ctx.target, sqliteOptions); }
  catch (error) {
    // No returned native handle proves no later close. Keep registration on
    // uncertain constructor failure; never guess that it is safe to reap it.
    throw normalize(error);
  }
  let released = false;
  return Object.freeze({
    database: db,
    async close({ timeoutMs = 1000 } = {}) {
      if (released) return;
      try {
        const deadline = timeout(timeoutMs);
        if (db.open) db.close();
        if (db.open) hold('native_close_incomplete');
        await waitGate(ctx, deadline, () => {
          const file = path.join(ctx.root, 'leases', record.id + '.json');
          if (!same(readRecord(file), record)) hold('lease_ownership_lost');
          fs.unlinkSync(file);
          syncDirectory(path.dirname(file));
        });
        released = true;
      } catch (error) { throw normalize(error); }
    },
  });
}

/**
 * Orders intent before new admissions and waits for registered handles to close.
 * The callback belongs to an already-drained lifecycle owner, NOT a Web route.
 * A callback failure/crash preserves intent; its effects cannot be guessed away.
 */
export async function runWithSqliteMaintenance(file, { timeoutMs = 1000 } = {}, operation) {
  let ctx, intent, started = false, published = false;
  try {
    if (typeof operation !== 'function') hold('invalid_operation');
    const deadline = timeout(timeoutMs);
    ctx = context(file);
    intent = { version: 1, target: ctx.target, id: randomUUID(), role: 'maintenance', pid: process.pid };
    await waitGate(ctx, deadline, () => {
      leases(ctx);
      if (regular(path.join(ctx.root, 'intent.json'))) hold('maintenance_pending');
      writeRecord(path.join(ctx.root, 'intent.json'), intent);
      published = true;
    });
    for (;;) {
      const remaining = await waitGate(ctx, deadline, () => {
        if (!same(readRecord(path.join(ctx.root, 'intent.json')), intent)) hold('intent_ownership_lost');
        return leases(ctx).length;
      });
      if (performance.now() >= deadline) hold('drain_timeout');
      if (remaining === 0) break;
      await delay(Math.min(10, Math.max(1, deadline - performance.now())));
    }
    started = true;
    const result = await operation();
    await waitGate(ctx, timeout(1000), () => {
      if (!same(readRecord(path.join(ctx.root, 'intent.json')), intent) || leases(ctx).length !== 0) hold('intent_ownership_lost');
      fs.unlinkSync(path.join(ctx.root, 'intent.json'));
      syncDirectory(ctx.root);
    });
    return result;
  } catch (error) {
    if (published && !started) {
      // This invocation never reached its callback; remove only its verified
      // intent. No stale PID/mtime cleanup and no removal after callback entry.
      try {
        await waitGate(ctx, timeout(1000), () => {
          if (!same(readRecord(path.join(ctx.root, 'intent.json')), intent)) hold('intent_ownership_lost');
          fs.unlinkSync(path.join(ctx.root, 'intent.json'));
          syncDirectory(ctx.root);
        });
      } catch { /* Uncertain ownership/durability remains HOLD. */ }
    }
    throw normalize(error);
  }
}
