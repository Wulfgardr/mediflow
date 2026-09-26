/* @Codex */
// Standalone research/prototype suite; it does not qualify a product release.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.versions.node.split('.')[0] !== '24' || process.argv.length !== 2) {
  console.error('Use Node 24 and no arguments: node scripts/check-09x-prototypes.mjs');
  process.exit(1);
}
const tests = [
  'scripts/patient-rights-dry-run.test.mjs',
  'prototypes/longitudinal-review/model.test.mjs',
  'scripts/synthetic-followup-projection.test.mjs',
  'lib/domain/documents/document-quality-corpus.test.mjs',
  'scripts/verify-fhir-validator-cache.test.mjs',
  'scripts/synthetic-handoff-packet.test.mjs',
  'scripts/synthetic-cohort-analysis.test.mjs',
];
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit', timeout: 60_000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
