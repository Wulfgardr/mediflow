/** Temporary reporter: metadata from the original image case in the full suite. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_CAPTURE_BYTES, reduceReport } from './ocr-causal-ci.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imageFile = path.join(sourceRoot, 'e2e/document-upload-ocr.spec.ts');
const imageTitle = 'Estrazione locale: image, dalla UI al risultato corrente';
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const natural = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function gitPin(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], {
    cwd: sourceRoot, encoding: 'utf8', timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  const value = result.stdout?.trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value || '') ? value : null;
}

export default class OcrCausalSuiteReporter {
  constructor() {
    this.selected = new Set();
    this.attempts = [];
    this.directory = null;
    this.pin = { sourceHead: null, sourceTree: null, requestedPrHead: null };
    this.errorCode = 'NONE';
    this.fullSuiteStatus = 'notEnded';
  }

  onBegin(_config, suite) {
    try {
      const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP);
      const expected = path.join(runnerTemp, 'ocr-causal-suite-export');
      const directory = process.env.OCR_CAUSAL_SUITE_EXPORT_DIR;
      const st = fs.lstatSync(directory);
      if (directory !== expected || !st.isDirectory() || st.isSymbolicLink()
          || st.uid !== process.getuid() || (st.mode & 0o077) !== 0
          || fs.readdirSync(directory).length !== 0)
        throw new Error('EXPORT_DIRECTORY_INVALID');
      this.directory = directory;
      if (process.versions.node !== '24.21.0' || process.versions.modules !== '137')
        throw new Error('NODE_PIN_MISMATCH');
      if (process.env.MEDIFLOW_OCR_CAUSAL_CAPTURE !== '1'
          || process.env.NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_PROBE !== '1'
          || process.env.NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_SYNTHETIC_ONLY !== '1')
        throw new Error('PROBE_OPT_IN_MISSING');
      this.pin.sourceHead = gitPin('HEAD^{commit}');
      this.pin.sourceTree = gitPin('HEAD^{tree}');
      this.pin.requestedPrHead = /^[a-f0-9]{40}$/.test(process.env.OCR_CAUSAL_REQUESTED_PR_HEAD || '')
        ? process.env.OCR_CAUSAL_REQUESTED_PR_HEAD : null;
      if (!this.pin.sourceHead || !this.pin.sourceTree) throw new Error('SOURCE_PIN_UNAVAILABLE');
      this.selected = new Set(suite.allTests().filter(test =>
        path.resolve(test.location.file) === imageFile && test.title === imageTitle));
      if (this.selected.size !== 1) throw new Error('TARGET_CARDINALITY');
    } catch (error) {
      this.errorCode = new Set(['EXPORT_DIRECTORY_INVALID', 'PROBE_OPT_IN_MISSING',
        'SOURCE_PIN_UNAVAILABLE', 'TARGET_CARDINALITY', 'NODE_PIN_MISMATCH']).has(error?.message)
        ? error.message : 'REPORTER_SETUP_UNAVAILABLE';
    }
    this.persist();
  }

  onTestEnd(test, result) {
    if (!this.selected.has(test)) return;
    try {
      if (this.errorCode !== 'NONE' || test.expectedStatus !== 'passed'
          || this.attempts.length >= 2 || result.retry !== this.attempts.length
          || !statuses.has(result.status) || !natural(result.duration, 300000))
        throw new Error('ATTEMPT_SEQUENCE_INVALID');
      const matches = result.attachments.filter(a => a.name === 'ocr-causal-metadata');
      // Body only; never follow attachment paths or copy other reports/artifacts.
      const attachments = matches.length === 1 && matches[0].contentType === 'application/json'
        && Buffer.isBuffer(matches[0].body) && matches[0].body.length <= MAX_CAPTURE_BYTES
        ? [{ name: 'ocr-causal-metadata', contentType: 'application/json',
          body: matches[0].body.toString('base64') }] : [];
      this.attempts.push({ status: result.status, duration: result.duration,
        retry: result.retry, attachments });
    } catch { this.errorCode = 'ATTEMPT_SEQUENCE_INVALID'; }
    // Retain retry0 before retry1 starts. Hard termination after this write leaves
    // an explicit notEnded suite status, never a successful final verdict.
    this.persist();
  }

  onEnd(result) {
    this.fullSuiteStatus = new Set(['passed', 'failed', 'timedout', 'interrupted']).has(result.status)
      ? result.status : 'unknown';
    this.persist();
    // Do not override the original full-suite status or exit code.
  }

  persist() {
    if (!this.directory) return;
    try {
      const last = this.attempts.at(-1)?.status;
      const outcome = last === 'passed' ? (this.attempts.length === 2 ? 'flaky' : 'expected')
        : last === 'skipped' ? 'skipped' : 'unexpected';
      const reduced = reduceReport(JSON.stringify({ suites: [{ specs: [{
        title: imageTitle, file: 'document-upload-ocr.spec.ts',
        tests: [{ status: outcome, results: this.attempts }],
      }] }] }), null);
      const captures = reduced.captures;
      const summary = {
        schema: 'mediflow.ocr_causal_full_suite_summary.v1', ...this.pin,
        nodeMajor: Number(process.versions.node.split('.')[0]), nodeMinor: Number(process.versions.node.split('.')[1]),
        nodePatch: Number(process.versions.node.split('.')[2]), nodeAbi: Number(process.versions.modules),
        fullSuiteStatus: this.fullSuiteStatus, originalCliExitCode: null,
        processExitObservation: 'not_available_at_reporter_boundary',
        runtimeIdentityMatch: null, runtimeIdentityObservation: 'not_attested_by_reporter',
        selectedTargetCount: Math.min(this.selected.size, 2), actualAttemptCount: this.attempts.length,
        attemptCountKnown: this.fullSuiteStatus !== 'notEnded' && this.errorCode === 'NONE',
        captureQualification: this.errorCode === 'NONE' ? reduced.qualification : 'INCONCLUSIVE',
        errorCode: this.errorCode === 'NONE' ? reduced.errorCode : this.errorCode,
        originalImageOutcome: this.fullSuiteStatus === 'notEnded' ? 'pending' : reduced.originalTestOutcome,
        attempts: reduced.attempts,
      };
      for (const { filename, capture } of captures) this.write(filename, capture);
      this.write('ocr-causal-suite-summary.json', summary);
    } catch { this.errorCode = 'METADATA_WRITE_UNAVAILABLE'; }
  }

  write(filename, value) {
    const destination = path.join(this.directory, filename);
    const temporary = `${destination}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, destination);
  }
}
