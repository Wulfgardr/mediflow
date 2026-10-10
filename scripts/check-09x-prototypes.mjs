import { PROTOTYPE_TEST_FILES } from './additional-test-selection.mjs';
/* @Codex */
// Standalone research/prototype suite; it does not qualify a product release.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.versions.node.split('.')[0] !== '24' || process.argv.length !== 2) {
  console.error('Use Node 24 and no arguments: node scripts/check-09x-prototypes.mjs');
  process.exit(1);
}
const tests = PROTOTYPE_TEST_FILES;
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit', timeout: 60_000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
