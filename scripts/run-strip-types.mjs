#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const registerLoaderPath = path.join(__dirname, 'register-strip-types-loader.mjs');
const registerLoaderUrl = pathToFileURL(registerLoaderPath).href;

if (args.length === 0) {
  console.error('Usage: node scripts/run-strip-types.mjs <script-or-node-arg> [...args]');
  console.error('       node scripts/run-strip-types.mjs --test --glob "lib/**/*.test.ts"');
  console.error('       node scripts/run-strip-types.mjs --test --exclude lib/db-backed.test.ts --glob "lib/**/*.test.ts"');
  process.exit(2);
}

function walkFiles(startDir) {
  if (!fs.existsSync(startDir)) return [];
  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function expandGlob(pattern) {
  const normalized = pattern.split(path.sep).join('/');
  const deepWildcard = '/**/';
  const wildcardIndex = normalized.indexOf(deepWildcard);

  if (wildcardIndex === -1) {
    const directPath = path.resolve(repoRoot, pattern);
    return fs.existsSync(directPath) ? [directPath] : [];
  }

  const rawBase = normalized.slice(0, wildcardIndex);
  const rawSuffix = normalized.slice(wildcardIndex + deepWildcard.length);
  const baseDir = path.resolve(repoRoot, rawBase || '.');
  const suffix = rawSuffix.replace(/^\*/, '');

  return walkFiles(baseDir)
    .filter((filePath) => filePath.split(path.sep).join('/').endsWith(suffix))
    .sort();
}

function expandArgs(rawArgs) {
  const expandedArgs = [];
  const seenGlobMatches = new Set();
  const excludedMatches = new Set();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg !== '--exclude' && arg !== '--exclude-glob') continue;

    const pattern = rawArgs[index + 1];
    if (!pattern) {
      console.error(`${arg} requires a pattern`);
      process.exit(2);
    }
    index += 1;

    const matches = arg === '--exclude-glob'
      ? expandGlob(pattern)
      : [path.resolve(repoRoot, pattern)];

    for (const match of matches) {
      excludedMatches.add(match);
    }
  }

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--exclude' || arg === '--exclude-glob') {
      index += 1;
      continue;
    }

    if (arg !== '--glob') {
      expandedArgs.push(arg);
      continue;
    }

    const pattern = rawArgs[index + 1];
    if (!pattern) {
      console.error('--glob requires a pattern');
      process.exit(2);
    }
    index += 1;

    const matches = expandGlob(pattern);
    if (matches.length === 0) {
      console.error(`No files matched --glob ${pattern}`);
      process.exit(1);
    }

    for (const match of matches) {
      if (excludedMatches.has(match)) continue;
      if (seenGlobMatches.has(match)) continue;
      seenGlobMatches.add(match);
      expandedArgs.push(match);
    }
  }

  return expandedArgs;
}

function resolveCommand(command) {
  if (!command) return null;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) return command;

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
  const result = spawnSync(nodePath, ['--experimental-strip-types', '--import', registerLoaderUrl, '-e', ''], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function childEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST')) {
      delete env[key];
    }
  }
  return env;
}

const nodePath = collectCandidates().find(supportsStripTypes);

if (!nodePath) {
  console.error('No Node.js runtime with --experimental-strip-types and module.registerHooks support was found.');
  console.error('Install/select a compatible Node.js runtime, or set MEDIFLOW_STRIP_TYPES_NODE to a compatible node binary.');
  process.exit(1);
}

const nodeArgs = expandArgs(args);
const result = spawnSync(nodePath, ['--experimental-strip-types', '--import', registerLoaderUrl, ...nodeArgs], {
  env: childEnvironment(),
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
