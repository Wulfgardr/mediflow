import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { windowsTaskkillCommand } from '../windows-system-command.mjs';

const run = cp.spawnSync;
cp.spawnSync = (command, args, ...options) => {
  if (args?.length !== 4 || args[0] !== '/pid' || args[2] !== '/T' || args[3] !== '/F') return run(command, args, ...options);
  if (command !== windowsTaskkillCommand()) throw new Error('Gate observed an unadmitted system stop command.');
  const result = run(command, args, ...options);
  process.stderr.write('[windows-system-stop] ' + JSON.stringify({ arch: process.arch, command, pid: args[1],
    status: result.status, error: result.error?.code ?? null }) + '\n');
  return result;
};
syncBuiltinESMExports();
