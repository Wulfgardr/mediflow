// One unchanged baseline smoke, then one instrumented synthetic render.
// This harness never turns an instrumented invocation into a gate success.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parsePhaseStderr, probeExitCode } from './pdf-phase-records.mjs';

const [repositoryArgument, workerArgument] = process.argv.slice(2);
if (!repositoryArgument || !workerArgument || process.argv.length !== 4) {
  throw new Error('Usage: node run-pdf-phase-probe.mjs REPOSITORY WORKER');
}
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required');
const repository = fs.realpathSync(repositoryArgument);
const worker = fs.realpathSync(workerArgument);
const checkerPath = path.join(repository, 'scripts/check-standalone-runtime-bundle.mjs');
const checker = fs.readFileSync(checkerPath, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedWorker = checker.match(/const ANYDOC_PDF_PAGE_WORKER_SHA256 = '([a-f0-9]{64})';/)?.[1];
const workerDigest = sha256(fs.readFileSync(worker));
if (!expectedWorker || workerDigest !== expectedWorker) throw new Error('Worker digest mismatch');
const schema = checker.match(/const ANYDOC_PDF_CHILD_SCHEMA_VERSION = '([^']+)';/)?.[1];
const oldSpace = checker.match(/const ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB = (\d+);/)?.[1];
if (!schema || oldSpace !== '256') throw new Error('Unexpected child protocol or memory contract');
const helperSource = checker.slice(checker.indexOf('function encodePdfChildFrame('),
  checker.indexOf('function bundledAppleVisionScriptFailure('));
if (!helperSource.includes('function framedPdfPageWorkerSmokeFailure(')) throw new Error('Missing original oracle');
const { formatPdfSmokeFailure } = await import(pathToFileURL(path.join(repository, 'scripts/anydoc-pdf-smoke-diagnostics.mjs')));
const controls = [];
let exactRenderInvocation;
const context = vm.createContext({ fs, path, process, Buffer, formatPdfSmokeFailure,
  ANYDOC_PDF_CHILD_SCHEMA_VERSION: schema,
  ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB: Number(oldSpace),
  spawnSync(executable, args, options) {
    const start = performance.now();
    const result = spawnSync(executable, args, options);
    controls.push({ stage: controls.length === 0 ? 'materialize' : 'render',
      elapsedMs: Math.round(performance.now() - start), status: result.status,
      signal: result.signal, errorCode: result.error?.code ?? null,
      stdoutBytes: result.stdout?.length ?? 0, stderrBytes: result.stderr?.length ?? 0 });
    if (controls.length === 2) exactRenderInvocation = { executable, args, options };
    return result;
  },
});
vm.runInContext(helperSource, context);
const baselineFailure = context.framedPdfPageWorkerSmokeFailure(worker);
const receipt = { purpose: 'external diagnostic only; instrumented result is not a smoke gate',
  node: process.versions.node, platform: process.platform, arch: process.arch,
  checkerSha256: sha256(checker), originalOracleHelpersSha256: sha256(helperSource),
  workerSha256: workerDigest, baseline: { failure: baselineFailure, controls } };
if (!exactRenderInvocation) {
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = 1;
} else {
  const preload = fs.readFileSync(new URL('./pdf-phase-preload.mjs', import.meta.url));
  receipt.preloadSha256 = sha256(preload);
  const { executable, args, options } = exactRenderInvocation;
  const workerIndex = args.indexOf(worker);
  if (workerIndex < 0) throw new Error('Original worker argument missing');
  const diagnosticArgs = [...args.slice(0, workerIndex),
    '--import=data:text/javascript;base64,' + preload.toString('base64'), ...args.slice(workerIndex)];
  const start = performance.now();
  const result = spawnSync(executable, diagnosticArgs, options);
  const { phases, nonProbeStderr } = parsePhaseStderr(result.stderr);
  const framed = context.decodePdfChildFrame(result.stdout);
  receipt.diagnostic = { elapsedMs: Math.round(performance.now() - start),
    status: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    stdoutBytes: result.stdout?.length ?? 0, stderrBytes: result.stderr?.length ?? 0,
    nonProbeStderr, phases,
    frameStatus: framed?.header?.status ?? null,
    width: framed?.header?.pages?.[0]?.width ?? null, height: framed?.header?.pages?.[0]?.height ?? null,
    childReportedDurationMs: framed?.header?.pages?.[0]?.durationMs ?? null,
    originalTimeoutMs: options.timeout, originalMaxBuffer: options.maxBuffer,
    environmentUnchanged: Object.keys(options.env).sort().join(',') === 'NAPI_RS_ENFORCE_VERSION_CHECK,NODE_ENV',
    instrumentedGateResult: 'not evaluated; diagnostic stderr intentionally rejects original gate' };
  receipt.probeFilesOutsideRepository = !fileURLToPath(import.meta.url).startsWith(repository + path.sep);
  receipt.workerDigestAfter = sha256(fs.readFileSync(worker));
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = probeExitCode(baselineFailure, !(result.error || result.status !== 0 || nonProbeStderr || framed?.header?.status !== 'rendered'
      || receipt.workerDigestAfter !== workerDigest || !phases.some((entry) => entry.phase === 'canvas-native-init-exit')
      || !phases.some((entry) => entry.phase === 'stdout-write')));
}
