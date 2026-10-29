import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const run = args[0] === '--run';
if (run && process.platform !== 'darwin') {
    console.error('MLX_UNAVAILABLE: banco reale richiede macOS e sandbox deny network; nessun ripiego');
    process.exit(1);
}
const target = [process.execPath, `${root}scripts/run-strip-types.mjs`, `${root}scripts/athena-quality/run.ts`, ...args];
const child = run
    ? spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', ...target], { cwd: root, stdio: 'inherit' })
    : spawnSync(target[0], target.slice(1), { cwd: root, stdio: 'inherit' });
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
