#!/usr/bin/env node
/* @Codex */
// Cross-platform gate for the Apple MLX lane.
// MLX (mlx_lm) runs only on macOS Apple Silicon. On every other platform this
// wrapper exits 0 with a clear message instead of failing with a cryptic error,
// so `npm run` on Windows/Linux stays green. Ollama is the cross-platform runtime.
import { spawnSync } from 'node:child_process';

const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
const target = process.argv[2];

if (!isAppleSilicon) {
    console.log(
        `[mlx] Salto "${target ?? 'mlx'}": MLX e disponibile solo su macOS Apple Silicon ` +
        `(rilevato ${process.platform}/${process.arch}). Usa Ollama come runtime cross-platform.`,
    );
    process.exit(0);
}

const COMMANDS = {
    benchmark: { cmd: './.venv_mlx/bin/python3', args: ['scripts/mlx-chat-batch-runner.py', ...process.argv.slice(3)] },
    test: { cmd: 'bash', args: ['scripts/mlx-chat-batch-runner-test.sh'] },
};

const chosen = COMMANDS[target];
if (!chosen) {
    console.error(`[mlx] Target sconosciuto: "${target}". Usa "benchmark" o "test".`);
    process.exit(1);
}

const result = spawnSync(chosen.cmd, chosen.args, { stdio: 'inherit' });
if (result.error) {
    console.error(`[mlx] Avvio fallito: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
