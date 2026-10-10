import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('catalog smoke waits for the server writer before removing its workspace', async t => {
  const root = mkdtempSync(join(tmpdir(), 'mediflow-catalog-cleanup-'));
  const data = join(root, 'synthetic-data');
  const bin = join(root, 'bin');
  const scripts = join(root, 'scripts');
  const cli = join(root, 'node_modules/next/dist/bin');
  // Satisfy the wrapper's dependency-directory preflight without installing or
  // running packages: the synthetic Next CLI below owns the real child writer.
  const dependencyDirectories = ['typescript', '@types/react', '@types/node']
    .map(name => join(root, 'node_modules', name));
  for (const path of [bin, scripts, cli, data, ...dependencyDirectories]) mkdirSync(path, { recursive: true });
  const stopped = join(data, 'writer-stopped.json');
  const pidFile = join(data, 'controller.pid');
  t.after(async () => {
    // Also reap the synthetic controller when the old npx launcher is under test.
    if (existsSync(pidFile) && !existsSync(stopped)) {
      try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      for (let i = 0; i < 100 && !existsSync(stopped); i++) await delay(20);
      assert.ok(existsSync(stopped), 'synthetic writer must stop before fixture cleanup');
    }
    rmSync(root, { recursive: true, force: true });
  });
  copyFileSync(new URL('./network-home-base-catalog-read-smoke.sh', import.meta.url), join(scripts, 'network-home-base-catalog-read-smoke.sh'));
  // Only external preparation/HTTP/test commands are synthetic. Run the actual
  // smoke script, including its real background launch, EXIT trap, wait and rm.
  writeFileSync(join(bin, 'node'), `#!/bin/bash\ncase "$1" in\n  */prepare-e2e-db.mjs|--test) exit 0 ;;\n  *) exec "$TEST_NODE" "$@" ;;\nesac\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\ntest -f "$MEDIFLOW_DATA_DIR/writer-ready"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\n"$TEST_NODE" "$TEST_ROOT/node_modules/next/dist/bin/next" "$@" &\nchild=$!\ntrap 'exit 0' TERM\nwait "$child"\n`, { mode: 0o755 });
  writeFileSync(join(cli, 'next'), `
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const workspace = process.argv.find(arg => arg.endsWith('/next-workspace'));
const data = process.env.MEDIFLOW_DATA_DIR;
fs.writeFileSync(path.join(data, 'controller.pid'), String(process.pid));
const writer = fork(path.join(process.env.TEST_ROOT, 'writer.cjs'), [workspace], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
writer.once('message', () => fs.writeFileSync(path.join(data, 'writer-ready'), 'ready'));
process.on('SIGTERM', () => writer.kill('SIGTERM'));
writer.once('exit', () => process.exit(0));
`);
  writeFileSync(join(root, 'writer.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
const workspace = process.argv[2];
const output = path.join(workspace, '.next-network-smoke/dev');
fs.mkdirSync(output, { recursive: true });
const timer = setInterval(() => {
  try { fs.writeFileSync(path.join(output, 'active'), 'writing'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}, 10);
process.send('ready');
process.on('SIGTERM', () => setTimeout(() => {
  clearInterval(timer);
  fs.writeFileSync(path.join(process.env.MEDIFLOW_DATA_DIR, 'writer-stopped.json'), JSON.stringify({ workspaceExisted: fs.existsSync(workspace) }));
  process.exit(0);
}, 100));
`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_NODE: process.execPath, TEST_ROOT: root,
    MEDIFLOW_NETWORK_SMOKE_DATA_DIR: data, E2E_BASE_URL: 'http://127.0.0.1:3200' };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  const result = spawnSync('bash', [join(scripts, 'network-home-base-catalog-read-smoke.sh')], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(stopped), 'writer exited before smoke cleanup returned');
  assert.equal(JSON.parse(readFileSync(stopped, 'utf8')).workspaceExisted, true, 'workspace still exists at writer shutdown');
  assert.equal(existsSync(join(data, 'next-workspace')), false, 'cleanup removes the workspace after shutdown');
});
