#!/usr/bin/env node
/* @Codex — WUL-697/689. Explicit, local, offline installation only. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { demand, InstallError } from './redaction-install/guards.mjs';
import { install, verify } from './redaction-install/engine.mjs';
import { createMacAdapter } from './redaction-install/process.mjs';

export const HELP = `MediFlow redaction OFFLINE installer (Node 24, macOS; no downloads).
install --root ABS_EMPTY_READINESS_REDACTION_DIR --python ABS_BASE_PYTHON
  --worker ABS_WORKER_PY --model ABS_MODEL_DIR --wheelhouse ABS_WHEELHOUSE_DIR
  --manifest ABS_JSON --manifest-sha256 SHA256 --manifest-bytes BYTES
verify --root ABS_READINESS_REDACTION_DIR --python ABS_BASE_PYTHON
  --manifest ABS_JSON --manifest-sha256 SHA256 --manifest-bytes BYTES
  --receipt-sha256 SHA256_FROM_SUCCESSFUL_INSTALL

Root must be the operator-selected ai/rollout-readiness/redaction directory.
All paths must be absolute, physical (no destination symlink) and protected.
install requires a missing or empty, owned root; it never overwrites or repairs.
verify is read-only and requires the same externally checked input manifest.
The input schema is mediflow.redaction-offline-input.v1; see the delivery VALIDATION.
Local hashes prove byte integrity, not provenance, safety, readiness or consent.
No latest.json, QA report, rollout record or clinical admission is produced.
`;
export function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help')) return { mode: 'help' };
  const [mode, ...rest] = argv;
  demand(mode === 'install' || mode === 'verify', 'usage_invalid');
  const fields = { '--root': 'root', '--python': 'python', '--manifest': 'manifest',
    '--manifest-sha256': 'manifestSha256', '--manifest-bytes': 'manifestBytes',
    ...(mode === 'install' ? { '--worker': 'worker', '--model': 'model', '--wheelhouse': 'wheelhouse' } : { '--receipt-sha256': 'receiptSha256' }) };
  const options = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    const field = fields[rest[i]], value = rest[i + 1];
    demand(field && typeof value === 'string' && value.length > 0 && !value.startsWith('--') && !Object.hasOwn(options, field), 'usage_invalid');
    options[field] = value;
  }
  demand(Object.values(fields).every(field => Object.hasOwn(options, field)), 'usage_invalid');
  demand(/^[1-9][0-9]*$/.test(options.manifestBytes), 'manifest_digest_required');
  options.manifestBytes = Number(options.manifestBytes); return options;
}
export async function productionContract() {
  // Canonical public pins are imported, never copied, changed or overridden.
  const p = await import('../lib/redaction-runtime-identity.ts');
  return Object.freeze({ target: Object.freeze({ platform: 'darwin', arch: process.arch }),
    runtimeSchema: p.REDACTION_RUNTIME_SCHEMA, adapter: p.REDACTION_RUNTIME_ADAPTER,
    model: p.REDACTION_RUNTIME_MODEL, revision: p.REDACTION_RUNTIME_REVISION,
    packages: p.REDACTION_RUNTIME_PACKAGES, files: p.REDACTION_RUNTIME_FILES, workerSha256: p.REDACTION_WORKER_SHA256 });
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.mode === 'help') { console.log(HELP); return; }
  demand(process.versions.node.split('.')[0] === '24', 'node24_required');
  demand(process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch), 'macos_required');
  const contract = await productionContract(), adapter = createMacAdapter();
  const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const outcome = await (options.mode === 'install' ? install : verify)(options, contract, adapter, controller.signal);
    console.log(JSON.stringify(outcome));
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => {
    const e = error instanceof InstallError ? error : new InstallError('installer_failed');
    console.error(JSON.stringify({ status: 'failed', code: e.code, phase: e.phase, rollback: e.rollback ?? 'not_started',
      authority: 'installation_only' }));
    process.exitCode = e.code === 'interrupted' ? 130 : 1;
  });
}
