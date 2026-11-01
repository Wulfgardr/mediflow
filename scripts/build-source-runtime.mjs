import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const phases = [
  ['build-input-metadata.mjs', '--source', '.'],
  ['node-runtime-contract.mjs', 'verify'],
  ['source-runtime.mjs', 'build', ...process.argv.slice(2)],
  ['node-runtime-contract.mjs', 'write-standalone-manifest'],
  ['check-standalone-runtime-bundle.mjs'],
  ['source-runtime.mjs', 'prepare'],
];
for (const [script, ...args] of phases) {
  execFileSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
}
