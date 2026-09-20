/* @Codex: synthetic data only. Frame fixtures test the observer, never a PDF/OCR engine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { formatPdfSmokeFailure } from './anydoc-pdf-smoke-diagnostics.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCHEMA = 'mediflow.anydoc_pdf_child_protocol.v1';
const WORKER_HASH = '31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67';
const SENTINEL = 'SYNTHETIC_PRIVATE_FIELD_NOT_FOR_DIAGNOSTICS';
// Match the production runner's explicit test-data rule before invoking any child.
if (!process.env.MEDIFLOW_DATA_DIR?.trim()) {
  throw new Error('MEDIFLOW_TEST_DATA_DIR_REQUIRED: provide a dedicated synthetic test directory.');
}

function frame(header, body = Buffer.alloc(0)) {
  return textFrame(JSON.stringify(header), body);
}
function textFrame(text, body = Buffer.alloc(0)) {
  const bytes = Buffer.from(text);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes, body]);
}
function workerError(reason = 'invalid_request') {
  return { schemaVersion: SCHEMA, status: 'error', reason, bodyByteLength: 0 };
}
function completed(stdout, overrides = {}) {
  return { status: 0, signal: null, stdout, stderr: Buffer.alloc(0), ...overrides };
}
function diagnostic(result, stage = 'materialize', check = 'response') {
  const message = formatPdfSmokeFailure(stage, check, result);
  assert.ok(Buffer.byteLength(message) < 1024, 'diagnostic remains bounded');
  assert.ok(!message.includes(SENTINEL), 'child content is never disclosed');
  assert.ok(message.startsWith('Standalone PDF page worker failed '));
  return JSON.parse(message.split('Diagnostic: ')[1]);
}

for (const reason of [
  'invalid_request', 'malformed_or_encrypted_pdf', 'page_count_mismatch',
  'resource_limit', 'engine_unavailable', 'render_failed', 'timeout',
  'recognition_failed', 'empty_output',
]) {
  test(`recognized worker failure is not called a malformed frame: ${reason}`, () => {
    const info = diagnostic(completed(frame(workerError(reason))));
    assert.equal(info.frame, 'worker_error');
    assert.equal(info.reason, reason);
    assert.equal(info.response, 'error');
    assert.equal(info.completion, 'completed');
    assert.equal(info.exitCode, 0);
  });
}

test('bounded framing observations distinguish short, incomplete and noncanonical envelopes', () => {
  const longPrefix = Buffer.alloc(4); longPrefix.writeUInt32BE(65_537);
  const incomplete = Buffer.alloc(4); incomplete.writeUInt32BE(12);
  const invalidUtf8 = Buffer.from([0, 0, 0, 1, 255]);
  for (const [output, expected] of [
    [undefined, 'stdout_unavailable'], [Buffer.alloc(0), 'no_stdout'],
    [Buffer.from([1, 2, 3]), 'prefix_incomplete'], [Buffer.alloc(4), 'header_length_out_of_range'],
    [longPrefix, 'header_length_out_of_range'], [incomplete, 'header_incomplete'],
    [invalidUtf8, 'header_encoding_invalid'], [textFrame('{'), 'header_json_invalid'],
    [textFrame(` ${JSON.stringify(workerError())}`), 'header_noncanonical'],
    [textFrame('null'), 'header_not_record'], [textFrame('[]'), 'header_not_record'],
    [frame({ ...workerError(), schemaVersion: SENTINEL }), 'schema_mismatch'],
    [frame({ ...workerError(), bodyByteLength: 1 }), 'body_length_mismatch'],
    [frame({ ...workerError(), bodyByteLength: -1 }), 'body_length_mismatch'],
  ]) {
    assert.equal(diagnostic(completed(output)).frame, expected);
  }
});

test('only an exact, known, bodyless error envelope exposes an enumerated reason', () => {
  for (const [header, body] of [
    [{ ...workerError(), debug: SENTINEL }, undefined],
    [workerError(SENTINEL), undefined],
    [{ ...workerError(), bodyByteLength: SENTINEL.length }, Buffer.from(SENTINEL)],
  ]) {
    const info = diagnostic(completed(frame(header, body)));
    assert.equal(info.frame, 'error_envelope_invalid');
    assert.equal(info.reason, null);
    assert.equal(info.response, null);
  }
});

test('canonical success envelopes remain unvalidated and cannot indicate smoke success', () => {
  for (const status of ['materialized', 'rendered', 'recognized']) {
    const info = diagnostic(completed(frame({
      schemaVersion: SCHEMA, status, bodyByteLength: SENTINEL.length,
      pages: [{ page: -1, path: SENTINEL }],
    }, Buffer.from(SENTINEL))));
    assert.equal(info.frame, 'success_envelope_unvalidated');
    assert.equal(info.response, status);
    assert.equal(info.reason, null);
  }
  const unknown = diagnostic(completed(frame({ ...workerError(), status: SENTINEL })));
  assert.equal(unknown.frame, 'status_unrecognized');
  assert.equal(unknown.response, null);
});

test('transport failures are independent of frame observations and never log raw errors', () => {
  const validError = frame(workerError());
  const timeout = diagnostic(completed(validError, {
    status: null, signal: 'SIGTERM',
    error: { code: 'ETIMEDOUT', message: SENTINEL, path: SENTINEL, stack: SENTINEL },
  }), 'render', 'transport');
  assert.equal(timeout.completion, 'spawn_error');
  assert.equal(timeout.spawnError, 'ETIMEDOUT');
  assert.equal(timeout.signal, 'SIGTERM');
  assert.equal(timeout.frame, 'worker_error');
  for (const [override, expected] of [
    [{ status: 1 }, 'nonzero_or_missing_exit'],
    [{ status: null, signal: 'SIGKILL' }, 'signalled'],
    [{ stderr: null }, 'stderr_unavailable'],
    [{ stderr: Buffer.from(SENTINEL) }, 'stderr_present'],
    [{ error: { code: SENTINEL, message: SENTINEL } }, 'spawn_error'],
  ]) {
    assert.equal(diagnostic(completed(validError, override), 'materialize', 'transport').completion, expected);
  }
  const unknown = diagnostic(completed(validError, { signal: SENTINEL, status: Number.MAX_SAFE_INTEGER }));
  assert.equal(unknown.signal, 'other');
  assert.equal(unknown.exitCode, null);
  assert.equal(diagnostic(null, SENTINEL, SENTINEL).stage, 'unknown');
});

test('output/header observation is bounded without truncating output into an accepted frame', () => {
  const overLimit = Buffer.alloc(4 * 1024 * 1024 + 1);
  frame(workerError()).copy(overLimit);
  const info = diagnostic(completed(overLimit, { stderr: overLimit }));
  assert.equal(info.frame, 'stdout_over_smoke_limit');
  assert.equal(info.stdoutBytes, 'over_smoke_limit');
  assert.equal(info.stderrBytes, 'over_smoke_limit');
  assert.equal(info.reason, null);
  const header = Buffer.alloc(4); header.writeUInt32BE(0xffffffff);
  assert.equal(diagnostic(completed(header)).headerBytes, 'over_header_limit');
});

test('real pinned worker failure survives the original permissions and exact environment', () => {
  const worker = path.join(root, 'scripts', 'anydoc-pdf-page-worker.mjs');
  assert.equal(createHash('sha256').update(fs.readFileSync(worker)).digest('hex'), WORKER_HASH);
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=256', '--permission', '--disable-warning=SecurityWarning',
    `--allow-fs-read=${root}`, worker, '--self-test=valid-failure',
  ], {
    cwd: path.dirname(worker),
    env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
    input: Buffer.alloc(0), encoding: 'buffer', timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.length, 0);
  assert.equal(diagnostic(result).reason, 'malformed_or_encrypted_pdf');
});

test('real checker still exits 1 on an intentionally incomplete physical package; no fabricated worker', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pdf-diagnostic-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.mkdirSync(path.join(directory, 'synthetic-data'));
  for (const name of [
    'check-standalone-runtime-bundle.mjs', 'anydoc-pdf-smoke-diagnostics.mjs',
    'node-runtime-contract.mjs', 'anydoc-pdf-page-worker.mjs',
    'anydoc-pdf-renderer-profiles.json', 'anydoc-tesseract-artifacts.json',
  ]) {
    fs.copyFileSync(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  }
  const copiedWorker = fs.readFileSync(path.join(directory, 'scripts', 'anydoc-pdf-page-worker.mjs'));
  assert.equal(createHash('sha256').update(copiedWorker).digest('hex'), WORKER_HASH);
  // The package deliberately has NO dependencies. Its real import failure must
  // remain a failed smoke. This is not a claim about the reported Windows/Linux VM.
  const result = spawnSync(process.execPath, [
    path.join(directory, 'scripts', 'check-standalone-runtime-bundle.mjs'), '--self-test=pdf-page-worker',
  ], {
    cwd: directory, encoding: 'utf8', timeout: 40_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MEDIFLOW_DATA_DIR: path.join(directory, 'synthetic-data') },
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'safe smoke failure omits paths and an exception stack');
  assert.ok(!result.stderr.includes(directory));
  const info = JSON.parse(lines[0].split('Diagnostic: ')[1]);
  assert.equal(info.stage, 'materialize');
  assert.equal(info.check, 'response');
  assert.equal(info.completion, 'completed');
  assert.equal(info.reason, 'invalid_request');
  assert.equal(info.frame, 'worker_error');
});
