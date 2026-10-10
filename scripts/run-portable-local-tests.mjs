import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { portableLocalTestCommands } from './portable-local-test-selection.mjs';

export function runPortableLocalCommands(root, commands, { spawn = spawnSync, env = process.env } = {}) {
  const outcomes = [];
  for (const command of commands) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-local-onboarding-portable-')));
    const childEnv = { ...env, ...command.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DATA_DIR: directory,
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', PATH: `${path.dirname(process.execPath)}${path.delimiter}${env.PATH ?? ''}` };
    let result;
    try {
      console.log(`Portable synthetic recipe: ${command.id}`);
      if (command.bootstrap) result = spawn(process.execPath, ['scripts/prepare-e2e-db.mjs'], { cwd: root, env: childEnv, stdio: 'inherit', shell: false });
      if (!result || (!result.error && !result.signal && result.status === 0))
        result = spawn(command.executable, command.args, { cwd: root, env: childEnv, stdio: 'inherit', shell: false });
      outcomes.push({ id: command.id, status: result.status, signal: result.signal ?? null, error: result.error?.message ?? null });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  return outcomes;
}
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required');
    const commands = portableLocalTestCommands(root);
    const requested = process.argv.slice(2);
    if (new Set(requested).size !== requested.length || requested.some(id => !commands.some(command => command.id === id))) throw new Error('Unknown or duplicate recipe ID');
    const outcomes = runPortableLocalCommands(root, requested.length ? commands.filter(command => requested.includes(command.id)) : commands);
    console.log(JSON.stringify({ outcomes }));
    process.exitCode = outcomes.some(result => result.status !== 0 || result.signal || result.error) ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
