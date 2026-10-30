import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const run = args[0] === '--run';
const target = [process.execPath, `${root}scripts/run-strip-types.mjs`, `${root}scripts/athena-quality/run.ts`, ...args];
// Fuori da macOS manca il sandbox: run.ts nega la release e poi rifiuta la piattaforma prima di ogni esecuzione.
const child = run && process.platform === 'darwin'
    ? spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', ...target], { cwd: root, stdio: 'inherit' })
    : spawnSync(target[0], target.slice(1), { cwd: root, stdio: 'inherit' });
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
