import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ordinaryLauncherEnvironment } from './runtime-environment.mjs';

try {
  if (process.argv.length !== 2 || process.execArgv.length || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
  if (Object.keys(config).sort().join(',') !== 'dataDir,nodePath,revision,schemaVersion,sourceRoot'
    || config.schemaVersion !== 1 || !/^[0-9a-f]{40}$/u.test(config.revision)) throw new Error('unavailable');
  for (const name of ['sourceRoot', 'nodePath', 'dataDir']) {
    if (typeof config[name] !== 'string' || !path.isAbsolute(config[name]) || fs.realpathSync(config[name]) !== config[name]
      || fs.lstatSync(config[name]).isSymbolicLink()) throw new Error('unavailable');
  }
  if (fs.realpathSync(process.execPath) !== config.nodePath) throw new Error('unavailable');
  const child = spawn(config.nodePath, [path.join(config.sourceRoot, 'scripts/source-runtime.mjs'), 'local-ui'], {
    cwd: config.sourceRoot, shell: false, stdio: ['inherit', 'inherit', 'pipe'],
    env: { ...ordinaryLauncherEnvironment(config.dataDir),
      MEDIFLOW_PLUGIN_EXPECTED_REVISION: config.revision },
  });
  child.stderr.resume();
  const stop = () => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5_000);
    timer.unref(); child.once('exit', () => clearTimeout(timer));
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.once('error', () => { process.stderr.write('MediFlow navigation unavailable.\n'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (code !== 0 || signal) { process.stderr.write('MediFlow navigation unavailable.\n'); process.exitCode = 1; }
  });
} catch { process.stderr.write('MediFlow navigation unavailable.\n'); process.exitCode = 1; }
