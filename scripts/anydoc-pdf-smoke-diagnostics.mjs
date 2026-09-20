/* @Codex: failure-only diagnostics for the synthetic standalone PDF smoke.
 * This is build/checker tooling, not a worker protocol or an admission validator.
 * Never return child text, exception messages, paths, input bytes or body previews.
 * Bounds mirror the existing smoke observer; they do not change its spawn limits.
 */
const SCHEMA_VERSION = 'mediflow.anydoc_pdf_child_protocol.v1';
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_SMOKE_OUTPUT_BYTES = 4 * 1024 * 1024;
const WORKER_REASONS = new Set([
  'invalid_request', 'malformed_or_encrypted_pdf', 'page_count_mismatch',
  'resource_limit', 'engine_unavailable', 'render_failed', 'timeout',
  'recognition_failed', 'empty_output',
]);
const SPAWN_CODES = new Set([
  'ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'EIO',
  'ENOMEM', 'EAGAIN', 'EMFILE', 'ENFILE',
]);
const SIGNALS = new Set([
  'SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGILL',
  'SIGBUS', 'SIGFPE', 'SIGHUP', 'SIGBREAK',
]);
const PLATFORMS = new Set(['darwin', 'win32', 'linux', 'aix', 'freebsd', 'openbsd', 'sunos', 'android']);
const ARCHITECTURES = new Set(['arm64', 'x64', 'arm', 'ia32', 'ppc64', 's390x', 'riscv64', 'loong64']);

function byteCount(value) {
  if (!Buffer.isBuffer(value)) return null;
  return value.byteLength <= MAX_SMOKE_OUTPUT_BYTES ? value.byteLength : 'over_smoke_limit';
}

function frameObservation(output) {
  const observed = { frame: 'stdout_unavailable', headerBytes: null, response: null, reason: null };
  const withFrame = (frame) => ({ ...observed, frame });
  if (!Buffer.isBuffer(output)) return observed;
  // Do not parse unbounded output, even if called independently of spawnSync.
  if (output.byteLength > MAX_SMOKE_OUTPUT_BYTES) return withFrame('stdout_over_smoke_limit');
  if (output.byteLength === 0) return withFrame('no_stdout');
  if (output.byteLength < 4) return withFrame('prefix_incomplete');
  const headerLength = output.readUInt32BE(0);
  observed.headerBytes = headerLength <= MAX_HEADER_BYTES ? headerLength : 'over_header_limit';
  if (headerLength < 1 || headerLength > MAX_HEADER_BYTES) return withFrame('header_length_out_of_range');
  if (output.byteLength < 4 + headerLength) return withFrame('header_incomplete');
  const headerBytes = output.subarray(4, 4 + headerLength);
  const headerText = headerBytes.toString('utf8');
  if (!Buffer.from(headerText, 'utf8').equals(headerBytes)) return withFrame('header_encoding_invalid');
  let header;
  try { header = JSON.parse(headerText); } catch { return withFrame('header_json_invalid'); }
  try {
    if (JSON.stringify(header) !== headerText) return withFrame('header_noncanonical');
  } catch {
    return withFrame('header_canonicalization_failed');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return withFrame('header_not_record');
  if (header.schemaVersion !== SCHEMA_VERSION) return withFrame('schema_mismatch');
  const bodyLength = output.byteLength - 4 - headerLength;
  if (!Number.isSafeInteger(header.bodyByteLength) || header.bodyByteLength !== bodyLength) {
    return withFrame('body_length_mismatch');
  }
  if (header.status === 'error') {
    const keys = Object.keys(header);
    if (keys.length !== 4 || !keys.every((key) => ['schemaVersion', 'status', 'reason', 'bodyByteLength'].includes(key))
        || bodyLength !== 0 || !WORKER_REASONS.has(header.reason)) {
      return withFrame('error_envelope_invalid');
    }
    observed.response = 'error';
    observed.reason = header.reason;
    return withFrame('worker_error');
  }
  if (header.status === 'materialized' || header.status === 'rendered' || header.status === 'recognized') {
    observed.response = header.status;
    // Deliberately NOT "valid": page descriptors, PNGs and expected stage remain
    // the existing checker's responsibility. This helper can only describe failure.
    return withFrame('success_envelope_unvalidated');
  }
  return withFrame('status_unrecognized');
}

/**
 * Format only an ALREADY rejected synthetic smoke result. The caller retains all
 * acceptance checks. This function does no I/O and cannot turn a failure into a pass.
 * Its text is for an operator, not a new persisted or cross-process contract.
 * @param {'materialize'|'render'} operation
 * @param {'transport'|'response'|'unsupported_host'} failedCheck
 * @param {import('node:child_process').SpawnSyncReturns<Buffer>} result
 * @returns {string}
 */
export function formatPdfSmokeFailure(operation, failedCheck, result) {
  const stage = operation === 'materialize' || operation === 'render' ? operation : 'unknown';
  const check = ['transport', 'response', 'unsupported_host'].includes(failedCheck) ? failedCheck : 'unknown';
  const child = result && typeof result === 'object' ? result : {};
  const exitCode = Number.isSafeInteger(child.status) && child.status >= -2_147_483_648 && child.status <= 4_294_967_295
    ? child.status : null;
  const signal = child.signal == null ? null : SIGNALS.has(child.signal) ? child.signal : 'other';
  const spawnError = child.error ? SPAWN_CODES.has(child.error.code) ? child.error.code : 'other' : null;
  const stderrBytes = byteCount(child.stderr);
  const completion = spawnError ? 'spawn_error'
    : signal ? 'signalled'
      : child.status !== 0 ? 'nonzero_or_missing_exit'
        : stderrBytes === null ? 'stderr_unavailable'
          : stderrBytes !== 0 ? 'stderr_present' : 'completed';
  const observation = {
    stage, check, completion, exitCode, signal, spawnError,
    stdoutBytes: byteCount(child.stdout), stderrBytes,
    ...frameObservation(child.stdout),
    node: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(process.versions.node) ? process.versions.node : 'other',
    platform: PLATFORMS.has(process.platform) ? process.platform : 'other',
    arch: ARCHITECTURES.has(process.arch) ? process.arch : 'other',
  };
  return `Standalone PDF page worker failed the ${stage} smoke. Diagnostic: ${JSON.stringify(observation)}`;
}
