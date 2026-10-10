#!/usr/bin/env node
// Every test file must be taken by a suite selector, or be listed in
// test-selection-exclusions.json with a reason and an owner. A new or renamed
// test that no suite runs fails this check.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectCiDispositionSelections } from './ci-disposition-selection.mjs';
import { collectNativeToolSelections } from './native-tool-test-selection.mjs';
import { collectLocalTestSelections } from './local-test-selection.mjs';
import { collectAdditionalInventorySelections } from './additional-inventory-selection.mjs';
import { collectPlaywrightTestFiles } from './playwright-test-selection.mjs';
import { collectUnitTestFiles } from './unit-test-selection.mjs';
import { collectExplicitNpmSelections, collectNpmScriptBinding, collectGuardSelfTestSelections, collectSyntheticPluginSelections } from './explicit-npm-test-selection.mjs';
import { collectHeadlessPortableTests } from './run-headless-portable-tests.mjs';
import { collectSwiftInventorySelection, SWIFT_SUITE_ID } from './swift-test-selection.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const EXCLUSIONS = 'test-selection-exclusions.json';
const sourceExtension = /\.(?:[cm]?[jt]sx?|py|rs|swift|sh|bash|bats|ps1|command|c|h|m|mm)$/u;
const conventionalName = /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py|[^/]+Tests?\.swift|[^/]+[-_]test\.(?:sh|py)|test[^/]*\.rs)$)/u;
// A file without a conventional name is still a test when it loads a test framework.
const signals = [
  /(?:from\s*['"]node:test['"]|(?:require|import)\s*\(\s*['"]node:test['"])/u,
  /(?:from\s*['"]@playwright\/test['"]|require\s*\(\s*['"]@playwright\/test['"])/u,
  /\bXCTestCase\b|@Test\b|@Suite\b|\bimport\s+Testing\b/u,
  /\b(?:import\s+(?:unittest|pytest)|from\s+(?:unittest|pytest)\s+import)|^\s*(?:async\s+)?def\s+test_\w+\s*\(/mu,
  /#\s*\[\s*(?:(?:tokio|async_std)::)?test(?:\s*\(|\s*\])/u,
  /(?:^|\n)\s*@test\b|--self-test\b|\b(?:assert_eq|assert_equal|assert_success|assert_failure)\b/u,
  /(?:from\s*['"](?:node:)?assert(?:\/strict)?['"]|require\s*\(\s*['"](?:node:)?assert(?:\/strict)?['"])/u,
];

/** Test files by name or by framework import. Never imports or evaluates source text. */
export function discoverTestFiles(paths, readSource) {
  return paths.filter((file) => {
    if (conventionalName.test(file)) return true;
    if (!sourceExtension.test(file) && path.posix.extname(file)) return false;
    const source = readSource(file);
    return signals.some((pattern) => pattern.test(source));
  }).sort();
}

/** `selections` maps a suite to `{ files, errors }`; `exclusions` is the hand-kept list. */
export function checkTestSelection(testFiles, selections, exclusions) {
  const errors = [];
  const selected = new Set();
  for (const [suite, selection] of Object.entries(selections)) {
    for (const error of selection.errors ?? []) errors.push(`INCOMPLETE_SELECTION: ${suite}: ${error}`);
    if (!selection.files?.length) errors.push(`EMPTY_SELECTION: ${suite}`);
    for (const file of selection.files ?? []) selected.add(file);
  }
  const excluded = new Map();
  for (const entry of Array.isArray(exclusions) ? exclusions : [{}]) {
    const valid = typeof entry?.path === 'string' && [entry.reason, entry.owner].every((value) => typeof value === 'string' && value.trim())
      && Object.keys(entry).every((key) => ['path', 'reason', 'owner'].includes(key));
    if (!valid || excluded.has(entry.path)) errors.push(`INVALID_EXCLUSION: ${JSON.stringify(entry?.path)}`);
    else excluded.set(entry.path, entry);
  }
  const known = new Set(testFiles);
  for (const file of testFiles) {
    if (!selected.has(file) && !excluded.has(file)) errors.push(`TEST_NOT_SELECTED: ${file}`);
  }
  for (const file of excluded.keys()) {
    if (!known.has(file)) errors.push(`STALE_EXCLUSION: ${file}`);
    if (selected.has(file)) errors.push(`EXCLUDED_BUT_SELECTED: ${file}`);
  }
  for (const file of selected) if (!known.has(file)) errors.push(`SELECTED_NOT_A_TEST: ${file}`);
  return { errors, selected: selected.size, excluded: excluded.size };
}

function suite(collect) {
  try { return { files: collect(), errors: [] }; }
  catch (error) { return { files: [], errors: [error.message] }; }
}

async function collectSelections(root) {
  let headless;
  try {
    collectNpmScriptBinding(root, { script: 'test:headless-portable', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts' }, 'node scripts/run-headless-portable-tests.mjs');
    headless = { files: await collectHeadlessPortableTests(root), errors: [] };
  } catch (error) { headless = { files: [], errors: [error.message] }; }
  return {
    unit: suite(() => collectUnitTestFiles(root)),
    ...collectExplicitNpmSelections(root),
    'npm:test:headless-portable': headless,
    ...collectGuardSelfTestSelections(root),
    ...collectSyntheticPluginSelections(root),
    [SWIFT_SUITE_ID]: collectSwiftInventorySelection(root),
    'npm:test:e2e': suite(() => {
      collectNpmScriptBinding(root, { script: 'test:e2e', workflow: '.github/workflows/e2e.yml', job: 'e2e' }, 'playwright test --workers=1');
      return collectPlaywrightTestFiles(root);
    }),
    ...collectCiDispositionSelections(root),
    ...collectLocalTestSelections(root),
    ...collectAdditionalInventorySelections(root),
    ...collectNativeToolSelections(root),
  };
}

async function main(root) {
  const listed = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  const testFiles = discoverTestFiles(listed.split('\0').filter(Boolean), (file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const exclusions = JSON.parse(fs.readFileSync(path.join(root, EXCLUSIONS), 'utf8'));
  const result = checkTestSelection(testFiles, await collectSelections(root), exclusions);
  for (const error of result.errors) process.stderr.write(`${error}\n`);
  console.log(`Test files: ${testFiles.length}; taken by a suite: ${result.selected}; excluded with a reason: ${result.excluded}`);
  console.log(`Test selection: ${result.errors.length === 0 ? 'COMPLETE' : 'INCOMPLETE'}`);
  return Number(result.errors.length > 0);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(fs.realpathSync(process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot));
}
