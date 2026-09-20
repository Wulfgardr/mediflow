#!/usr/bin/env node
// @Codex

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCOPE_ROOTS = new Set([
  '.github',
  'app',
  'components',
  'contracts',
  'drizzle',
  'e2e',
  'hooks',
  'lib',
  'native',
  'packages',
  'scripts',
  'test',
  'tests',
  'tools',
]);

const ROOT_TOOLING_FILES = new Set([
  'Dockerfile',
  'Start-MediFlow.ps1',
  'Start_MediFlow.command',
  'ecosystem.config.js',
  'eslint.config.mjs',
  'next.config.ts',
  'package.json',
  'playwright.config.ts',
  'postcss.config.mjs',
  'tailwind.config.ts',
]);

const SOURCE_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cjs',
  '.command',
  '.h',
  '.js',
  '.jsx',
  '.m',
  '.mjs',
  '.mm',
  '.mts',
  '.py',
  '.ps1',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
]);

const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

// These are versioned or locally present inputs which are intentionally outside
// a first-party source/debt inventory. The filter is path based so a source file
// whose name merely contains "evidence" remains eligible.
const EXCLUDED_SEGMENTS = new Set([
  '.build',
  '.next',
  '.swiftpm',
  'Assets.xcassets',
  'Build',
  'DerivedData',
  'artifacts',
  'coverage',
  'dist',
  'evidence-archive',
  'evidence-archives',
  'fixtures',
  'generated',
  'logs',
  'meta',
  'MediFlowSQLiteC',
  'node_modules',
  'out',
  'playwright-report',
  'runtime',
  'screenshots',
  'test-results',
  'tmp',
  'vendor',
]);

const EXCLUDED_PREFIXES = ['.next-', 'tmp-', 'tmp_'];

const TEST_SEGMENTS = new Set(['e2e', 'test', 'tests', '__tests__']);
const TESTS_ROOTED_IN_OTHER_SEGMENTS = new Set(['Tests']);

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function isExcluded(relativePath) {
  const segments = relativePath.split('/');
  return segments.some((segment) => {
    if (EXCLUDED_SEGMENTS.has(segment)) return true;
    return EXCLUDED_PREFIXES.some((prefix) => segment.startsWith(prefix));
  });
}

function extensionOf(relativePath) {
  return path.extname(relativePath).toLowerCase();
}

function isScopePath(relativePath) {
  const firstSegment = relativePath.split('/')[0];
  return SCOPE_ROOTS.has(firstSegment) || ROOT_TOOLING_FILES.has(relativePath);
}

function isCandidatePath(relativePath) {
  if (!isScopePath(relativePath)) return false;
  if (isExcluded(relativePath)) return false;
  if (ROOT_TOOLING_FILES.has(relativePath)) return true;
  const extension = extensionOf(relativePath);
  return SOURCE_EXTENSIONS.has(extension) || CONFIG_EXTENSIONS.has(extension) || extension === '.sql';
}

function exclusionReason(relativePath) {
  const segments = relativePath.split('/');
  const segment = segments.find((entry) => {
    if (EXCLUDED_SEGMENTS.has(entry)) return true;
    return EXCLUDED_PREFIXES.some((prefix) => entry.startsWith(prefix));
  });
  if (!segment) return null;
  if (segment === 'node_modules') return 'node_modules';
  if (segment === 'vendor' || segment === 'MediFlowSQLiteC' || segment === 'sqlite3.c' || segment === 'sqlite3.h') return 'vendor';
  if (segment === 'artifacts') return 'artifacts';
  if (segment === 'fixtures') return 'fixtures';
  if (segment === 'generated' || segment === 'meta') return 'generated';
  if (segment === 'runtime') return 'runtime';
  if (segment === 'tmp' || segment.startsWith('tmp-') || segment.startsWith('tmp_')) return 'tmp';
  if (segment === 'screenshots') return 'evidence-archive';
  return 'generated-or-build';
}

function isTestPath(relativePath) {
  const segments = relativePath.split('/');
  if (segments.some((segment) => TEST_SEGMENTS.has(segment) || TESTS_ROOTED_IN_OTHER_SEGMENTS.has(segment))) {
    return true;
  }
  const basename = segments.at(-1) || '';
  return /(?:^|\.)test\.|(?:^|\.)spec\./u.test(basename);
}

function categoryFor(relativePath) {
  if (isTestPath(relativePath)) return 'tests';
  const firstSegment = relativePath.split('/')[0];
  if (firstSegment === 'app' || firstSegment === 'components' || firstSegment === 'hooks') return 'web';
  if (firstSegment === 'lib') return 'lib';
  if (firstSegment === 'packages') return 'packages';
  if (firstSegment === 'native') return 'native';
  return 'tooling';
}

function kindFor(relativePath) {
  if (extensionOf(relativePath) === '.sql') return 'migration';
  return CONFIG_EXTENSIONS.has(extensionOf(relativePath)) ? 'config' : 'source';
}

function lineCount(content) {
  if (content.length === 0) return 0;
  return content.split(/\r\n|\n|\r/u).length - 1 + (/[\r\n]$/u.test(content) ? 0 : 1);
}

function summarize(records) {
  const result = {};
  for (const record of records) {
    const current = result[record.category] || { files: 0, lines: 0, bytes: 0 };
    current.files += 1;
    current.lines += record.lines;
    current.bytes += record.bytes;
    result[record.category] = current;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function summarizeExtensions(records) {
  const result = {};
  for (const record of records) {
    const extension = record.extension || '[no extension]';
    result[extension] = (result[extension] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function buildInventory() {
  const trackedPaths = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const candidates = trackedPaths.filter(isCandidatePath);
  const excluded = {};
  const excludedPaths = {};
  const excludedCandidates = trackedPaths.filter((relativePath) => {
    if (!isScopePath(relativePath) || !isExcluded(relativePath)) return false;
    const extension = extensionOf(relativePath);
    return SOURCE_EXTENSIONS.has(extension) || CONFIG_EXTENSIONS.has(extension) || extension === '.sql';
  });

  for (const relativePath of excludedCandidates) {
    const reason = exclusionReason(relativePath) || 'generated-or-build';
    excluded[reason] = (excluded[reason] || 0) + 1;
    const paths = excludedPaths[reason] || [];
    paths.push(relativePath);
    excludedPaths[reason] = paths;
  }

  const records = candidates.map((relativePath) => {
    const content = readFileSync(path.join(ROOT, relativePath));
    return {
      path: relativePath,
      category: categoryFor(relativePath),
      kind: kindFor(relativePath),
      extension: extensionOf(relativePath),
      lines: lineCount(content.toString('utf8')),
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  });

  const byHash = new Map();
  for (const record of records) {
    const paths = byHash.get(record.sha256) || [];
    paths.push(record.path);
    byHash.set(record.sha256, paths);
  }
  const duplicateGroups = [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }))
    .sort((left, right) => left.paths[0].localeCompare(right.paths[0]));

  const status = git(['status', '--porcelain=v1']);
  return {
    schema: 'mediflow.first-party-code-inventory.v1',
    root: ROOT,
    head: git(['rev-parse', 'HEAD']),
    worktreeClean: status === '',
    trackedFiles: trackedPaths.length,
    candidateFiles: candidates.length,
    excludedCandidateFiles: excludedCandidates.length,
    scopeRoots: [...SCOPE_ROOTS].sort(),
    excluded,
    excludedPaths: Object.fromEntries(
      Object.entries(excludedPaths)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, paths]) => [reason, paths.sort()]),
    ),
    categories: summarize(records),
    extensions: summarizeExtensions(records),
    duplicateGroups,
    records,
  };
}

function printSummary(inventory) {
  console.log(inventory.schema);
  console.log(`HEAD ${inventory.head}`);
  console.log(`Worktree ${inventory.worktreeClean ? 'clean' : 'dirty'}; tracked files ${inventory.trackedFiles}`);
  console.log(`Included first-party source/config/migration files ${inventory.candidateFiles}`);
  console.log(`Excluded scoped candidate files ${inventory.excludedCandidateFiles}`);
  console.log('Categories:');
  for (const [category, summary] of Object.entries(inventory.categories)) {
    console.log(`  ${category}: ${summary.files} files, ${summary.lines} lines, ${summary.bytes} bytes`);
  }
  console.log('Extensions:');
  for (const [extension, count] of Object.entries(inventory.extensions)) {
    console.log(`  ${extension}: ${count}`);
  }
  console.log(`Exact duplicate content groups ${inventory.duplicateGroups.length}`);
  for (const group of inventory.duplicateGroups) {
    console.log(`  ${group.sha256.slice(0, 12)} ${group.paths.join(' = ')}`);
  }
  console.log(`Excluded by filter: ${JSON.stringify(inventory.excluded)}`);
}

const inventory = buildInventory();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(inventory, null, 2));
} else {
  printSummary(inventory);
}
