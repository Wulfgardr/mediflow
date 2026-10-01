// Load only for the FIRST full postbuild checker, after compilation + manifest.
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createColdRenderObserver, diagnosticExitCode } from './cold-render-observer.mjs';

const checkerPath = fs.realpathSync(process.argv[1]);
if (path.basename(checkerPath) !== 'check-standalone-runtime-bundle.mjs') {
  throw new Error('Cold observer requires the standalone checker');
}
const repository = path.dirname(path.dirname(checkerPath));
if (process.cwd() !== repository || process.env.MEDIFLOW_NEXT_DIST_DIR) {
  throw new Error('Cold observer requires the default candidate build directory');
}
// Match the original checker's lexical path; do not substitute a realpath alias.
const worker = path.join(process.cwd(), '.next/standalone/scripts/anydoc-pdf-page-worker.mjs');
const receiptPath = process.env.MEDIFLOW_PDF_COLD_RECEIPT;
if (!receiptPath || !path.isAbsolute(receiptPath)) throw new Error('Explicit absolute receipt path required');
const observer = createColdRenderObserver({ worker, checker: fs.readFileSync(checkerPath, 'utf8'),
  preload: fs.readFileSync(new URL('./pdf-phase-preload.mjs', import.meta.url)), receiptPath });
childProcess.spawnSync = observer.spawn;
syncBuiltinESMExports();
process.once('exit', (exitCode) => {
  observer.receipt.originalCheckerExitCode = exitCode;
  observer.receipt.qualification = 'diagnostic-only; raw probe stderr retained for original oracle';
  observer.flush();
  // Always nonqualifying, including when logging failed and the checker passed.
  process.exitCode = diagnosticExitCode();
});
