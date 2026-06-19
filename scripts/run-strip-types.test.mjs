/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repoRoot, 'scripts', 'run-strip-types.mjs');

test('run-strip-types executes TypeScript with extensionless relative imports', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-strip-types-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'helper.ts'), 'export const value: number = 42;\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'entry.ts'), "import { value } from './helper';\nconsole.log(value);\n", 'utf8');

    const result = spawnSync(process.execPath, [runnerPath, path.join(tempDir, 'entry.ts')], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '42');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
