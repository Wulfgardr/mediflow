// PDF-only local validation; two children: materialize, then observed render.
// For Windows use checker-cold-preload on the FIRST complete postbuild checker.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createColdRenderObserver, sha256, diagnosticExitCode } from './cold-render-observer.mjs';

const [repositoryArgument, workerArgument, receiptArgument] = process.argv.slice(2);
if (!repositoryArgument || !workerArgument || !receiptArgument || process.argv.length !== 5) {
  throw new Error('Usage: node run-pdf-phase-probe.mjs REPOSITORY WORKER NEW_RECEIPT');
}
const repository = fs.realpathSync(repositoryArgument);
const worker = fs.realpathSync(workerArgument);
const checker = fs.readFileSync(path.join(repository, 'scripts/check-standalone-runtime-bundle.mjs'), 'utf8');
const helperSource = checker.slice(checker.indexOf('function encodePdfChildFrame('),
  checker.indexOf('function bundledAppleVisionScriptFailure('));
const observer = createColdRenderObserver({ worker, checker,
  preload: fs.readFileSync(new URL('./pdf-phase-preload.mjs', import.meta.url)),
  receiptPath: path.resolve(receiptArgument) });
const { formatPdfSmokeFailure } = await import(pathToFileURL(path.join(repository, 'scripts/anydoc-pdf-smoke-diagnostics.mjs')));
const context = vm.createContext({ fs, path, process, Buffer, formatPdfSmokeFailure,
  ANYDOC_PDF_CHILD_SCHEMA_VERSION: checker.match(/const ANYDOC_PDF_CHILD_SCHEMA_VERSION = '([^']+)';/)?.[1],
  ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB: 256, spawnSync: observer.spawn });
vm.runInContext(helperSource, context);
const failure = context.framedPdfPageWorkerSmokeFailure(worker);
observer.receipt.originalOracleHelpersSha256 = sha256(helperSource);
observer.receipt.originalOracleFailure = failure;
const framed = context.decodePdfChildFrame(observer.result()?.stdout);
observer.receipt.syntheticFrame = { status: ['rendered', 'error'].includes(framed?.header?.status) ? framed.header.status : null,
  width: framed?.header?.pages?.[0]?.width === 144 ? 144 : null,
  height: framed?.header?.pages?.[0]?.height === 72 ? 72 : null };
observer.flush();
console.log(JSON.stringify(observer.receipt, null, 2));
// No instrumented result can be a qualifying gate, even if the sink failed.
process.exitCode = diagnosticExitCode();
