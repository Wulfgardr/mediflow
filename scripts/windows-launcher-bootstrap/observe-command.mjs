import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { windowsTaskkillCommand } from '../windows-system-command.mjs';

const run = cp.spawnSync;
cp.spawnSync = (command, args, ...options) => {
  if (args?.length !== 4 || args[0] !== '/pid' || args[2] !== '/T' || args[3] !== '/F') return run(command, args, ...options);
  if (command !== windowsTaskkillCommand()) throw new Error('Gate observed an unadmitted system stop command.');
  const result = run(command, args, { ...options[0], stdio: ['ignore', 'pipe', 'pipe'] }, ...options.slice(1));
  try {
    process.stderr.write('[windows-system-stop] ' + JSON.stringify({ arch: process.arch, command, argv: args, pid: args[1],
      timeout: options[0]?.timeout, windowsHide: options[0]?.windowsHide,
      hasEnv: Object.hasOwn(options[0] ?? {}, 'env'), hasCwd: Object.hasOwn(options[0] ?? {}, 'cwd'),
      status: result.status, signal: result.signal,
      error: result.error == null ? result.error : Object.fromEntries(
        ['name', 'code', 'errno', 'syscall', 'path', 'message'].filter(key => result.error[key] !== undefined).map(key => [key, result.error[key]])),
      stdout: result.stdout == null ? result.stdout : { bytes: result.stdout.byteLength, base64: result.stdout.toString('base64') },
      stderr: result.stderr == null ? result.stderr : { bytes: result.stderr.byteLength, base64: result.stderr.toString('base64') },
    }) + '\n');
  } catch {}
  return result;
};
syncBuiltinESMExports();
