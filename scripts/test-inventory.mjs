#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectUnitTestFiles } from './unit-test-selection.mjs';
import { collectExplicitNpmSelections, collectNpmScriptBinding, collectClaimsSelfTestSelection } from './explicit-npm-test-selection.mjs';
import { collectHeadlessPortableTests } from './run-headless-portable-tests.mjs';

const headlessSuite = Object.freeze({ script: 'test:headless-portable', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts' });

export async function collectHeadlessInventorySelection(root) {
  try {
    const binding = collectNpmScriptBinding(root, headlessSuite, 'node scripts/run-headless-portable-tests.mjs');
    return { files: await collectHeadlessPortableTests(root), errors: [], binding };
  } catch (error) {
    return { files: [], errors: [error.message], binding: null };
  }
}

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceExtension = /\.(?:[cm]?[jt]sx?|py|rs|swift|sh|bash|bats|ps1|command|c|h|m|mm)$/u;
const conventionalName = /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py|[^/]+Tests?\.swift|[^/]+[-_]test\.(?:sh|py)|test[^/]*\.rs)$)/u;
const signals = [
  ['node-test', /(?:from\s*['"]node:test['"]|(?:require|import)\s*\(\s*['"]node:test['"])/u],
  ['playwright-test', /(?:from\s*['"]@playwright\/test['"]|require\s*\(\s*['"]@playwright\/test['"])/u],
  ['swift-test', /\bXCTestCase\b|@Test\b|@Suite\b|\bimport\s+Testing\b/u],
  ['python-test', /\b(?:import\s+(?:unittest|pytest)|from\s+(?:unittest|pytest)\s+import)|^\s*(?:async\s+)?def\s+test_\w+\s*\(/mu],
  ['rust-test', /#\s*\[\s*(?:(?:tokio|async_std)::)?test(?:\s*\(|\s*\])/u],
  ['shell-test', /(?:^|\n)\s*@test\b|--self-test\b|\b(?:assert_eq|assert_equal|assert_success|assert_failure)\b/u],
  ['assertion-script', /(?:from\s*['"](?:node:)?assert(?:\/strict)?['"]|require\s*\(\s*['"](?:node:)?assert(?:\/strict)?['"])/u],
];

function validPath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f\\]/u.test(value)
    && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/u.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function text(bytes, label) {
  if (typeof bytes === 'string') return bytes;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`Invalid UTF-8: ${label}`); }
}

/** Heuristic candidate discovery only. Never imports or evaluates source text. */
export function discoverCandidates(paths, readSource) {
  if (!Array.isArray(paths) || typeof readSource !== 'function') throw new Error('Invalid discovery input');
  const seen = new Set();
  const candidates = [];
  for (const relative of paths) {
    if (!validPath(relative)) throw new Error(`Invalid inventory path: ${JSON.stringify(relative)}`);
    if (seen.has(relative)) throw new Error(`Duplicate discovery path: ${relative}`);
    seen.add(relative);
    const named = conventionalName.test(relative);
    // Extensionless executable scripts are inspected as well. Unknown extensions
    // remain a stated discovery limitation; no directory is excluded.
    if (!named && !sourceExtension.test(relative) && path.posix.extname(relative)) continue;
    const source = text(readSource(relative), relative);
    const found = named ? ['conventional-test-name'] : [];
    for (const [name, pattern] of signals) if (pattern.test(source)) found.push(name);
    if (found.length) candidates.push({ path: relative, signals: found });
  }
  return candidates.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Compare explicit mappings with real selector output; unresolved is never waived. */
export function checkInventory(candidates, manifest, selections) {
  const errors = [];
  const unresolved = [];
  const discovered = new Set();
  const entries = new Map();
  const suites = new Map();
  const add = (code, detail) => errors.push(`${code}: ${detail}`);
  if (!Array.isArray(candidates)) { add('INVALID_CANDIDATES', 'expected array'); candidates = []; }
  for (const candidate of candidates) {
    const file = candidate?.path;
    if (!validPath(file)) { add('INVALID_CANDIDATE_PATH', JSON.stringify(file)); continue; }
    if (discovered.has(file)) add('DUPLICATE_CANDIDATE', file);
    discovered.add(file);
  }
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.entries)
    || Object.keys(manifest).some(key => !['version', 'entries'].includes(key))) {
    add('INVALID_MANIFEST', 'expected version 1 and entries only');
  }
  for (const entry of Array.isArray(manifest?.entries) ? manifest.entries : []) {
    if (!validPath(entry?.path)) { add('INVALID_ENTRY_PATH', JSON.stringify(entry?.path)); continue; }
    if (entries.has(entry.path)) add('DUPLICATE_ENTRY', entry.path);
    entries.set(entry.path, entry);
    if (Object.keys(entry).some(key => !['path', 'selection'].includes(key))) add('INVALID_ENTRY_FIELDS', entry.path);
    const selection = entry.selection;
    if (selection?.state === 'unresolved') {
      unresolved.push(entry.path);
      if (typeof selection.reason !== 'string' || !selection.reason.trim()
        || Object.keys(selection).some(key => !['state', 'reason'].includes(key))) add('INVALID_UNRESOLVED', entry.path);
    } else if (selection?.state === 'mapped') {
      if (!Array.isArray(selection.suiteIds) || !selection.suiteIds.length
        || selection.suiteIds.some(id => typeof id !== 'string' || !id.trim())
        || new Set(selection.suiteIds).size !== selection.suiteIds.length
        || Object.keys(selection).some(key => !['state', 'suiteIds'].includes(key))) add('INVALID_MAPPING', entry.path);
    } else add('INVALID_SELECTION_STATE', entry.path);
  }
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    add('INVALID_SELECTIONS', 'expected object'); selections = {};
  }
  for (const [id, selection] of Object.entries(selections)) {
    if (!selection || !Array.isArray(selection.files) || !Array.isArray(selection.errors)) {
      add('INVALID_SUITE', id); continue;
    }
    for (const error of selection.errors) add('INCOMPLETE_SELECTION', `${id}: ${String(error)}`);
    if (!selection.files.length) add('EMPTY_SELECTION', id);
    const files = new Set();
    for (const file of selection.files) {
      if (!validPath(file)) { add('INVALID_SELECTED_PATH', `${id}: ${JSON.stringify(file)}`); continue; }
      if (files.has(file)) add('DUPLICATE_SELECTED_PATH', `${id}: ${file}`);
      files.add(file);
      if (!entries.has(file)) add('SELECTED_WITHOUT_ENTRY', `${id}: ${file}`);
      if (!discovered.has(file)) add('SELECTED_WITHOUT_CANDIDATE', `${id}: ${file}`);
    }
    suites.set(id, files);
  }
  for (const file of discovered) if (!entries.has(file)) add('UNREGISTERED_CANDIDATE', file);
  for (const [file, entry] of entries) {
    if (!discovered.has(file)) add('STALE_ENTRY', file);
    if (entry.selection?.state !== 'mapped' || !Array.isArray(entry.selection.suiteIds)) continue;
    for (const id of entry.selection.suiteIds) {
      if (!suites.has(id)) add('UNKNOWN_SUITE', `${file}: ${String(id)}`);
      else if (!suites.get(id).has(file)) add('MAPPED_NOT_SELECTED', `${id}: ${file}`);
    }
  }
  return { errors, unresolved, integrityPassed: errors.length === 0,
    selectionComplete: errors.length === 0 && unresolved.length === 0 };
}

async function cli(args) {
  const mode = args.shift();
  if (!['integrity', 'complete'].includes(mode)) throw new Error('Usage: test-inventory.mjs integrity|complete [--root PATH] [--manifest PATH]');
  let root = defaultRoot;
  let manifestPath;
  const seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (!['--root', '--manifest'].includes(flag) || seen.has(flag) || !args[0] || args[0].startsWith('--')) throw new Error('Invalid or duplicate CLI option');
    seen.add(flag);
    const value = args.shift();
    if (flag === '--root') root = path.resolve(value); else manifestPath = value;
  }
  root = fs.realpathSync(root);
  const raw = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 32 * 1024 * 1024 });
  const names = text(raw, 'Git paths');
  if (names && !names.endsWith('\0')) throw new Error('Git path list is not NUL-terminated');
  const paths = names ? names.slice(0, -1).split('\0') : [];
  const candidates = discoverCandidates(paths, relative => {
    const file = path.join(root, relative);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Source is not a regular file: ${relative}`);
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep)) throw new Error(`Source escapes root: ${relative}`);
    return fs.readFileSync(file);
  });
  const manifest = JSON.parse(text(fs.readFileSync(path.resolve(root, manifestPath ?? 'test-inventory.v1.json')), 'manifest'));
  let unit;
  try { unit = { files: collectUnitTestFiles(root), errors: [] }; }
  catch (error) { unit = { files: [], errors: [error.message] }; }
  const result = checkInventory(candidates, manifest, { unit, ...collectExplicitNpmSelections(root),
    'npm:test:headless-portable': await collectHeadlessInventorySelection(root),
    'npm:check:claims:self-test': collectClaimsSelfTestSelection(root) });
  for (const error of result.errors) process.stderr.write(`${error}\n`);
  printReport(result);
  return mode === 'complete' ? Number(!result.selectionComplete) : Number(!result.integrityPassed);
}

function printReport(result) {
  console.log(`Inventory integrity: ${result.integrityPassed ? 'PASS' : 'FAIL'}`);
  console.log(`Selection completeness: ${result.selectionComplete ? 'COMPLETE' : 'INCOMPLETE'}`);
  console.log(`Unresolved selection: ${result.unresolved.length}`);
  console.log('Execution evidence: NOT_ASSESSED');
  console.log('Npm CI bindings: configured literal calls only; reachability and lifecycle effects NOT_ASSESSED');
  console.log('C14 acceptance: NOT_ASSESSED');
  console.log('Discovery: heuristic filename/source signals; not semantic completeness or C14 acceptance.');
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    // stdin/eval importers need not identify an existing file. Other filesystem
    // errors must propagate instead of turning a failed CLI into silent success.
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

if (isCliEntrypoint()) {
  try { process.exitCode = await cli(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`INVENTORY_ERROR: ${error.message}\n`);
    console.log('Inventory integrity: FAIL\nSelection completeness: INCOMPLETE\nUnresolved selection: UNKNOWN\nExecution evidence: NOT_ASSESSED\nC14 acceptance: NOT_ASSESSED');
    process.exitCode = 1;
  }
}
