import cp from 'node:child_process';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { windowsTaskkillCommand } from '../windows-system-command.mjs';

function boundedText(value, limit) {
  const present = typeof value === 'string' || Buffer.isBuffer(value);
  const text = present ? String(value) : '';
  let low = 0, high = text.length;
  while (low < high) {
    const end = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(0, end))) <= limit) low = end;
    else high = end - 1;
  }
  return { text: text.slice(0, low), present, empty: text.length === 0, truncated: low < text.length, totalCodeUnits: text.length };
}

function ownIdentityQuery(command, args) {
  return typeof command === 'string' && path.win32.basename(command).toLowerCase() === 'powershell.exe'
    && Array.isArray(args) && args.length === 4 && args[0] === '-NoProfile' && args[1] === '-NonInteractive' && args[2] === '-Command'
    && args[3] === `$ErrorActionPreference='Stop'; (Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`;
}

const run = cp.spawnSync;
cp.spawnSync = (command, args, ...options) => {
  if (ownIdentityQuery(command, args)) {
    const startedAt = new Date().toISOString();
    const start = process.hrtime.bigint();
    let result, failure, threw = false;
    try { result = run(command, args, ...options); }
    catch (error) { failure = error; threw = true; }
    const end = process.hrtime.bigint();
    try {
      const error = threw ? failure : result?.error;
      process.stderr.write('[launcher-identity-query] ' + JSON.stringify({
        type: 'launcher-identity-query', launcherPid: process.pid, queryPid: process.pid,
        node: process.version, arch: process.arch, uv: process.versions.uv,
        command: boundedText(command, 512), startedAt, startMonotonicNs: String(start), endMonotonicNs: String(end),
        elapsedMs: Number(end - start) / 1e6, threw, status: result?.status ?? null,
        signal: boundedText(result?.signal, 32), stdout: boundedText(result?.stdout, 1024), stderr: boundedText(result?.stderr, 1024),
        error: error == null ? null : { code: boundedText(error.code, 64), errno: boundedText(error.errno == null ? undefined : String(error.errno), 64),
          syscall: boundedText(error.syscall, 128), message: boundedText(error.message, 256) },
      }) + '\n');
    } catch { /* Diagnostic delivery must not replace the observed return or throw. */ }
    if (threw) throw failure;
    return result;
  }
  if (args?.length !== 4 || args[0] !== '/pid' || args[2] !== '/T' || args[3] !== '/F') return run(command, args, ...options);
  if (command !== windowsTaskkillCommand()) throw new Error('Gate observed an unadmitted system stop command.');
  const result = run(command, args, ...options);
  process.stderr.write('[windows-system-stop] ' + JSON.stringify({ arch: process.arch, command, pid: args[1],
    status: result.status, error: result.error?.code ?? null }) + '\n');
  return result;
};
syncBuiltinESMExports();
