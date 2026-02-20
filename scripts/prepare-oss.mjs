/* @Codex */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.resolve(__dirname, 'prepare-oss.js');

const result = spawnSync(process.execPath, [scriptPath], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
