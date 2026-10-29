import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { retryReport, writeRetryReport } from './report-xcuitest-retries.mjs';

const background = 'MediFlowMobileAppUITests.swift:279: Failed to get background assertion for application';
const failure = text => ({ nodeType: 'Failure Message', name: text });
const attempt = (result, messages = []) => ({ nodeType: 'Repetition', name: 'Repetition', result,
  children: messages.map(failure) });
const testCase = (children = [], result = 'Passed', name = 'Suite/testAgenda()') => ({
  nodeType: 'Test Case', nodeIdentifier: name, name, result, children,
});
const tree = (...children) => ({ testNodes: [{ nodeType: 'Test Plan', name: 'Plan', children }] });

test('first-attempt passes and intentional skips have no recovered failures', () => {
  const report = retryReport(tree(testCase(), testCase([], 'Skipped', 'Suite/testIPad()')));
  assert.equal(report.failed, false);
  assert.match(report.markdown, /Nessun test ripetuto/);
});

test('reports a recovered background assertion even when parent is Failed', () => {
  const report = retryReport(tree(testCase([attempt('Failed', [background]), attempt('Passed')], 'Failed')));
  assert.equal(report.failed, false);
  assert.match(report.markdown, /Suite\/testAgenda\(\)/);
  assert.match(report.markdown, /Failed → Passed/);
  assert.match(report.markdown, /riuscito dopo un fallimento/);
  assert.match(report.markdown, /swift:279: Failed to get background assertion/);
  assert.match(report.markdown, /infrastruttura/);
});

test('finds repetitions below per-device and configuration wrappers', () => {
  const wrapped = { nodeType: 'Test Case Run', name: 'iPad', children: [
    { nodeType: 'Test Plan Configuration', name: 'Default', children: [
      attempt('Failed', ['Failed to boot simulator: launchd_sim failed to respond']), attempt('Passed'),
    ] },
  ] };
  assert.equal(retryReport(tree(testCase([wrapped]))).failed, false);
  assert.match(retryReport(tree(testCase([wrapped]))).markdown, /Failed → Passed/);
});

test('a recovered content assertion is red, never classified as infrastructure', () => {
  const report = retryReport(tree(testCase([
    attempt('Failed', ['MediFlowMobileAppUITests.swift:1226: XCTAssertEqual failed: Agenda non pronta']),
    attempt('Passed'),
  ])));
  assert.equal(report.failed, true);
  assert.match(report.markdown, /XCTAssertEqual failed: Agenda non pronta/);
  assert.match(report.markdown, /prodotto o errore non riconosciuto/);
});

test('all first-attempt errors are checked, not just the infrastructure signature', () => {
  const report = retryReport(tree(testCase([
    attempt('Failed', [background, 'XCTAssertEqual failed: testo incompleto']), attempt('Passed'),
  ])));
  assert.equal(report.failed, true);
  assert.match(report.markdown, /testo incompleto/);
});

test('an assertion quoting an infrastructure error remains red', () => {
  assert.equal(retryReport(tree(testCase([
    attempt('Failed', [`XCTAssertTrue failed: ${background}`]), attempt('Passed'),
  ]))).failed, true);
});

test('a failure outside the repetition nodes cannot be hidden by an infrastructure retry', () => {
  assert.equal(retryReport(tree(testCase([
    attempt('Failed', [background]), attempt('Passed'), failure('XCTAssertEqual failed'),
  ]))).failed, true);
});

test('ordinary launch crashes, missing errors and final failures remain red', () => {
  for (const messages of [[], ['Failed to launch com.mediflow.mobile: application crashed'],
    ['Simulator device failed to launch the application.']]) {
    assert.equal(retryReport(tree(testCase([attempt('Failed', messages), attempt('Passed')]))).failed, true);
  }
  assert.equal(retryReport(tree(testCase([attempt('Failed', [background]), attempt('Failed', [background])]))).failed, true);
  assert.equal(retryReport(tree(testCase([failure('XCTAssertFalse failed')], 'Failed'))).failed, true);
});

test('unsupported or empty evidence fails closed', () => {
  for (const data of [{}, tree(), tree(testCase([], 'unknown')),
    tree(testCase([attempt('unknown'), attempt('Passed')])), { testNodes: [null] }]) {
    assert.throws(() => retryReport(data));
  }
});

test('renders failure text safely without hiding its signature', () => {
  const report = retryReport(tree(testCase([
    attempt('Failed', ['XCTAssertEqual failed: <script> | unexpected\nnext line']), attempt('Passed'),
  ])));
  assert.match(report.markdown, /&lt;script&gt; &#124; unexpected<br>next line/);
});

test('writes summary and raw xcresult JSON even when the retry policy fails', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-retries-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, 'tests.xcresult');
  const summary = path.join(directory, 'summary.md');
  const data = tree(testCase([attempt('Failed', ['XCTAssertEqual failed']), attempt('Passed')]));
  assert.equal(writeRetryReport(bundle, { extract: () => JSON.stringify(data), summary }).failed, true);
  assert.match(readFileSync(summary, 'utf8'), /XCTAssertEqual failed/);
  assert.deepEqual(JSON.parse(readFileSync(`${bundle}.tests.json`, 'utf8')), data);
});

test('extraction and schema errors are written to the summary and stay red', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-retries-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const extract of [() => { throw new Error('xcresulttool extraction failed'); }, () => '{}']) {
    const bundle = path.join(directory, 'tests.xcresult');
    const report = writeRetryReport(bundle, { extract, summary: path.join(directory, 'summary.md') });
    assert.equal(report.failed, true);
    assert.match(readFileSync(`${bundle}.retries.md`, 'utf8'), /Impossibile verificare/);
  }
});
