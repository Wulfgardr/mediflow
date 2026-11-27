import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_VOICE_READY = 'MEDIFLOW_LOCAL_VOICE_READY';
export const LOCAL_VOICE_MANIFEST_RELATIVE = 'scripts/local-voice-binary.json';
export const LOCAL_VOICE_BINARY_RELATIVE = 'native/local-voice/target/release/mediflow-voice';
export const LOCAL_VOICE_MAX_BINARY_BYTES = 256 * 1024 * 1024;

/** @param {string[]} executables the only programs the confined service may execute, as resolved paths */
export function localVoiceSandboxProfile(executables) {
  return '(version 1) (allow default) (deny network*)'
    + ' (allow network-bind (local ip "localhost:*")) (allow network-inbound (local ip "localhost:*"))'
    + ' (deny file-write*) (deny process-fork)'
    + ` (deny process-exec) (allow process-exec ${executables.map(file => `(literal ${JSON.stringify(file)})`).join(' ')})`
    + ' (deny lsopen) (deny appleevent-send)';
}

/** A script runs through the interpreter its first line names: that interpreter is the only other program it may execute. @param {string} binary @param {Buffer} bytes the verified bytes the binary was staged from */
export function localVoiceExecutables(binary, bytes) {
  const resolved = realpathSync(binary);
  const head = bytes.subarray(0, 512).toString('latin1');
  const interpreter = head.startsWith('#!') ? head.slice(2).split(/\s/u).find(Boolean) : undefined;
  return interpreter && path.isAbsolute(interpreter) ? [resolved, realpathSync(interpreter)] : [resolved];
}

const SHA256_RE = /^[a-f0-9]{64}$/u;

export function sha256Buffer(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function sha256Matches(actual, expected) {
  if (!SHA256_RE.test(actual ?? '') || !SHA256_RE.test(expected ?? '')) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function readRegularBinaryBytes(file, maxBytes = LOCAL_VOICE_MAX_BINARY_BYTES) {
  if (!file || !path.isAbsolute(file)) return { ok: false, reason: 'invalid' };
  let stat;
  try { stat = lstatSync(file); }
  catch (error) { return { ok: false, reason: error?.code === 'ENOENT' ? 'absent' : 'invalid' }; }
  if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, reason: 'invalid' };
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(file, flags);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size <= 0 || opened.size > maxBytes) return { ok: false, reason: 'invalid' };
    return { ok: true, bytes: readFileSync(fd) };
  } catch (error) {
    return { ok: false, reason: error?.code === 'ENOENT' ? 'absent' : 'invalid' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readLocalVoiceManifest(root) {
  const file = path.join(root, LOCAL_VOICE_MANIFEST_RELATIVE);
  const read = readRegularBinaryBytes(file, 1024 * 1024);
  if (!read.ok) return null;
  let parsed;
  try { parsed = JSON.parse(read.bytes.toString('utf8')); }
  catch { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1
    || typeof parsed.version !== 'string' || !parsed.version.trim()
    || parsed.binary !== 'mediflow-voice'
    || typeof parsed.relativePath !== 'string' || !parsed.relativePath.trim()
    || !parsed.platforms || typeof parsed.platforms !== 'object') return null;
  return parsed;
}

export function pinnedLocalVoiceEntry(root, { platform = process.platform, arch = process.arch, version } = {}) {
  if (platform !== 'darwin') return { ok: false, reason: 'unsupported' };
  const manifest = readLocalVoiceManifest(root);
  if (!manifest) return { ok: false, reason: 'manifest-invalid' };
  if (version && manifest.version !== version) return { ok: false, reason: 'version-mismatch' };
  const key = `${platform}-${arch}`;
  const entry = manifest.platforms[key];
  if (!entry || typeof entry !== 'object' || !SHA256_RE.test(entry.sha256 ?? '')) return { ok: false, reason: 'unpinned', key };
  const expectedBytes = Number.isInteger(entry.bytes) && entry.bytes > 0 ? entry.bytes : undefined;
  return { ok: true, key, manifest, entry: { ...entry, bytes: expectedBytes } };
}

export function verifyLocalVoiceBinary(binary, { root, expectedSha256, expectedBytes, platform = process.platform, arch = process.arch, version } = {}) {
  if (platform !== 'darwin') return { ok: false, reason: 'unsupported' };
  let targetSha256 = expectedSha256;
  let targetBytes = expectedBytes;
  if (targetSha256 !== undefined) {
    if (!SHA256_RE.test(targetSha256)) return { ok: false, reason: 'manifest-invalid' };
  } else {
    if (!root) return { ok: false, reason: 'manifest-invalid' };
    const pinned = pinnedLocalVoiceEntry(root, { platform, arch, version });
    if (!pinned.ok) return pinned;
    targetSha256 = pinned.entry.sha256;
    targetBytes = pinned.entry.bytes;
  }
  const read = readRegularBinaryBytes(binary);
  if (!read.ok) return read;
  const actualSha256 = sha256Buffer(read.bytes);
  if (!sha256Matches(actualSha256, targetSha256) || (targetBytes !== undefined && read.bytes.length !== targetBytes)) {
    return { ok: false, reason: 'mismatch', sha256: actualSha256, expectedSha256: targetSha256 };
  }
  return { ok: true, sha256: actualSha256, bytes: read.bytes };
}

export function localVoiceBinary(root, env = process.env) {
  return env.MEDIFLOW_LOCAL_VOICE_BINARY || path.join(root, LOCAL_VOICE_BINARY_RELATIVE);
}

/** @param {string} binary @param {NodeJS.Platform} [platform] @param {string[]} [executables] */
export function localVoiceLaunch(binary, platform = process.platform, executables = [binary]) {
  if (platform === 'darwin') return { command: '/usr/bin/sandbox-exec', args: ['-p', localVoiceSandboxProfile(executables), binary] };
  return { command: binary, args: [] };
}

function stageVerifiedBinary(bytes) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'mediflow-voice-'));
  chmodSync(directory, 0o700);
  const stagedBinary = path.join(directory, 'mediflow-voice');
  try {
    writeFileSync(stagedBinary, bytes, { flag: 'wx', mode: 0o500 });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(directory, { recursive: true, force: true });
  };
  return { stagedBinary, cleanup };
}

export async function startLocalVoiceService({ binary, expectedSha256, expectedBytes, models, secret = crypto.randomBytes(32).toString('hex'), platform = process.platform, timeoutMs = 10_000 }) {
  if (!SHA256_RE.test(expectedSha256 ?? '')) throw new Error('local-voice-sha256-required');
  if (models !== undefined && !path.isAbsolute(models)) throw new Error('local-voice-models-not-absolute');
  let bytes;
  if (platform === 'darwin') {
    const check = verifyLocalVoiceBinary(binary, { expectedSha256, expectedBytes, platform });
    if (!check.ok) throw new Error(`local-voice-binary-${check.reason}`);
    bytes = check.bytes;
  } else {
    if (!path.isAbsolute(binary) || !existsSync(binary)) throw new Error('local-voice-binary-missing');
    const read = readRegularBinaryBytes(binary);
    if (!read.ok) throw new Error(`local-voice-binary-${read.reason}`);
    if (!sha256Matches(sha256Buffer(read.bytes), expectedSha256)) throw new Error('local-voice-binary-mismatch');
    bytes = read.bytes;
  }
  if (!SHA256_RE.test(secret)) throw new Error('local-voice-secret');
  const staged = stageVerifiedBinary(bytes);
  let child;
  try {
    const executables = localVoiceExecutables(staged.stagedBinary, bytes);
    const { command, args } = localVoiceLaunch(executables[0], platform, executables);
    const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', ...(models ? { MEDIFLOW_LOCAL_VOICE_MODELS: models } : {}) };
    child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  } catch (error) {
    staged.cleanup();
    throw error;
  }
  child.stdin.on('error', () => {});
  child.stdin.write(`${secret}\n`);
  const exited = new Promise(resolve => child.once('exit', code => { staged.cleanup(); resolve(code); }));
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('local-voice-start-timeout')); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); staged.cleanup(); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('local-voice-exited')); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        const match = buffer.match(new RegExp(`^${LOCAL_VOICE_READY} (\\{[^\\r\\n]+\\})$`, 'mu'));
        if (match) { clearTimeout(timer); resolve(JSON.parse(match[1]).port); }
        else if (buffer.length > 4096) { clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('local-voice-start-output')); }
      });
    });
  } catch (error) {
    staged.cleanup();
    throw error;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    child.kill('SIGKILL');
    staged.cleanup();
    throw new Error('local-voice-port');
  }
  const endpoint = { url: `http://127.0.0.1:${port}`, secret };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) { staged.cleanup(); return; }
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await exited;
    clearTimeout(timer);
    staged.cleanup();
  };
  return { ...endpoint, pid: /** @type {number} */ (child.pid), stop, exited };
}

export function superviseLocalVoiceService({ binary, expectedSha256, expectedBytes, models, publish, log = () => {}, restarts = 3, start = startLocalVoiceService }) {
  let service = null, starting = null, stopped = false, left = restarts;
  const launch = () => starting ||= (async () => {
    try {
      const started = await start({ binary, expectedSha256, expectedBytes, models });
      if (stopped) { await started.stop(); return null; }
      service = started;
      void started.exited.then(() => {
        if (service !== started) return;
        service = null;
        publish(null);
        if (stopped) return;
        if (left-- > 0) { log('Il servizio della voce si è arrestato: riavvio.'); void launch().then(endpoint => endpoint && publish(endpoint)); }
        else log('Il servizio della voce si è arrestato più volte: registrazione locale non disponibile fino al prossimo avvio.');
      });
      return { url: started.url, secret: started.secret };
    } catch (error) {
      log(`Voce locale non avviata: ${error.message}`);
      return null;
    } finally { starting = null; }
  })();
  return {
    ensure: async () => service ? { url: service.url, secret: service.secret } : launch(),
    current: () => service ? { url: service.url, secret: service.secret } : null,
    pid: () => service?.pid ?? null,
    stop: async () => { stopped = true; await starting; await service?.stop(); service = null; },
  };
}
