// External diagnostic: observe the first render, return its exact raw result.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parsePhaseStderr } from './pdf-phase-records.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const WORKER_SHA256 = '31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67';
export const PRELOAD_SHA256 = '3ee154b1832b6c2ffea51ffd82efdeab06312f094a5d5e09b910965d4349cdec';
export const CHECKER_GIT_BLOB = 'b942b38bec7c5a8a3d1f620ad550a1e0f35a5410';
export function verifyChecker(source) {
  // Checkout CRLF is allowed; source passed to the oracle is never rewritten.
  const canonical = Buffer.from(source.replace(/\r\n/g, '\n'));
  const blob = createHash('sha1').update(`blob ${canonical.length}\0`).update(canonical).digest('hex');
  if (blob !== CHECKER_GIT_BLOB) throw new Error('Pinned checker mismatch');
}

// Keep only complete, individually validated records. Never export unknown text.
export function parseColdPhaseStderr(stderr) {
  if (!Buffer.isBuffer(stderr)) {
    return { phases: [], rejectedBytes: null,
      truncatedTail: false, nonProbeStderr: true };
  }
  const examined = stderr.subarray(0, 64 * 1024);
  const phases = [];
  let cursor = 0;
  let rejectedBytes = stderr.length - examined.length;
  while (cursor < examined.length) {
    const end = examined.indexOf(10, cursor);
    if (end < 0) break;
    const line = examined.subarray(cursor, end + 1);
    const parsed = parsePhaseStderr(line);
    if (phases.length < 48 && !parsed.nonProbeStderr && parsed.phases.length === 1) {
      phases.push(parsed.phases[0]);
    } else rejectedBytes += line.length;
    cursor = end + 1;
  }
  const tailBytes = examined.length - cursor;
  return { phases, rejectedBytes: rejectedBytes + tailBytes, truncatedTail: tailBytes > 0,
    nonProbeStderr: rejectedBytes > 0 || tailBytes > 0 };
}

function persist(file, value, first = false) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 64 * 1024) throw new Error('Receipt bound exceeded');
  if (first) {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } else {
    const pending = `${file}.pending`;
    const fd = fs.openSync(pending, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(pending, file);
  }
}

export function createColdRenderObserver({ worker, checker, preload, receiptPath,
  spawn = spawnSync, now = () => performance.now(), writeReceipt = persist }) {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required');
  verifyChecker(checker);
  if (sha256(fs.readFileSync(worker)) !== WORKER_SHA256 || sha256(preload) !== PRELOAD_SHA256) {
    throw new Error('Pinned diagnostic/worker mismatch');
  }
  const receipt = { schemaVersion: 1, qualification: 'diagnostic-only; never a release gate',
    state: 'prepared', order: 'first PDF render in this checker; no warming baseline',
    osCaches: 'not measured; no claim of globally cold machine',
    node: process.versions.node, platform: process.platform, arch: process.arch,
    checkerSha256: sha256(checker), workerSha256: WORKER_SHA256, preloadSha256: PRELOAD_SHA256,
    callsBeforeRender: 0, rendersObserved: 0 };
  // Setup fails closed before any renderer if a new receipt cannot be created.
  writeReceipt(receiptPath, receipt, true);
  let renderResult;
  let observed = false;
  const flush = () => {
    try { writeReceipt(receiptPath, receipt); return true; }
    catch { receipt.persistenceFailed = true; return false; }
  };
  const observe = (callback, fallback) => { try { return callback(); } catch { return fallback; } };
  function observedSpawn(executable, args, options) {
    const isWorker = Array.isArray(args) && args.includes(worker);
    if (!isWorker || !args.includes('--allow-addons')) {
      if (isWorker && !observed) receipt.callsBeforeRender += 1;
      return Reflect.apply(spawn, this, arguments);
    }
    if (observed) throw new Error('Second diagnostic renderer forbidden');
    const packageRoot = path.dirname(path.dirname(worker));
    const expectedArgs = ['--max-old-space-size=256', '--permission', '--disable-warning=SecurityWarning',
      `--allow-fs-read=${packageRoot}`, '--allow-addons', worker];
    if (executable !== process.execPath || JSON.stringify(args) !== JSON.stringify(expectedArgs)
      || options.cwd !== path.dirname(worker) || options.encoding !== 'buffer'
      || options.timeout !== 30_000 || options.maxBuffer !== 4 * 1024 * 1024
      || options.windowsHide !== true || !Buffer.isBuffer(options.input)
      || JSON.stringify(Object.keys(options.env).sort()) !== JSON.stringify(['NAPI_RS_ENFORCE_VERSION_CHECK', 'NODE_ENV'])
      || options.env.NODE_ENV !== 'production' || options.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '1'
      || options.stdio !== undefined || options.killSignal !== undefined) {
      throw new Error('Original render contract changed');
    }
    observed = true;
    receipt.state = 'render-started';
    receipt.rendersObserved = 1;
    receipt.contract = { timeoutMs: options.timeout, maxBuffer: options.maxBuffer,
      oldSpaceMiB: 256, permissionArgumentsUnchanged: true, environmentUnchanged: true,
      optionsObjectUnchanged: true, inputBytes: options.input.length, inputSha256: sha256(options.input),
      argumentChange: 'one data-URI --import immediately before worker path' };
    flush();
    const workerIndex = args.indexOf(worker);
    const diagnosticArgs = [...args.slice(0, workerIndex),
      '--import=data:text/javascript;base64,' + preload.toString('base64'), ...args.slice(workerIndex)];
    const started = observe(now, null);
    try { renderResult = Reflect.apply(spawn, this, [executable, diagnosticArgs, options]); }
    catch (error) {
      receipt.state = 'spawn-threw';
      flush();
      throw error;
    }
    const captured = observe(() => {
      const parsed = parseColdPhaseStderr(renderResult.stderr);
      const finished = observe(now, null);
      receipt.state = 'render-returned';
      receipt.transport = { elapsedMs: Number.isFinite(started) && Number.isFinite(finished)
        ? Math.max(0, Math.round(finished - started)) : null, status: renderResult.status,
      signal: ['SIGTERM', 'SIGKILL', null].includes(renderResult.signal) ? renderResult.signal : 'other',
      errorCode: renderResult.error ? (['ETIMEDOUT', 'ENOBUFS', 'ENOENT'].includes(renderResult.error.code)
        ? renderResult.error.code : 'other') : null,
      stdoutBytes: renderResult.stdout?.length ?? null, stderrBytes: renderResult.stderr?.length ?? null };
      receipt.observation = parsed;
      receipt.lastPhase = parsed.phases.at(-1)?.phase ?? null;
      receipt.workerDigestAfter = observe(() => sha256(fs.readFileSync(worker)), null);
      return true;
    }, false);
    if (!captured) receipt.observationFailed = true;
    flush();
    // In particular, NEVER strip probe stderr or replace timeout/status/stdout.
    return renderResult;
  }
  return { spawn: observedSpawn, receipt, flush, result: () => renderResult };
}

export const diagnosticExitCode = () => 1;
