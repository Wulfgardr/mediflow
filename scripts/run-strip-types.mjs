#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const registerLoaderPath = path.join(__dirname, 'register-strip-types-loader.mjs');

if (args.length === 0) {
  console.error('Usage: node scripts/run-strip-types.mjs <script-or-node-arg> [...args]');
  process.exit(2);
}

function resolveCommand(command) {
  if (!command) return null;
  if (command.includes('/')) return command;

  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, command);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function collectCandidates() {
  const pathNodes = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, 'node'));

  return [
    resolveCommand(process.env.MEDIFLOW_STRIP_TYPES_NODE),
    process.execPath,
    ...pathNodes,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function supportsStripTypes(nodePath) {
  if (!nodePath || !fs.existsSync(nodePath)) return false;
  const result = spawnSync(nodePath, ['--experimental-strip-types', '--import', registerLoaderPath, '-e', ''], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

const nodePath = collectCandidates().find(supportsStripTypes);

if (!nodePath) {
  console.error('No Node.js runtime with --experimental-strip-types and module.registerHooks support was found.');
  console.error('Install/select a compatible Node.js runtime, or set MEDIFLOW_STRIP_TYPES_NODE to a compatible node binary.');
  process.exit(1);
}

const result = spawnSync(nodePath, ['--experimental-strip-types', '--import', registerLoaderPath, ...args], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
