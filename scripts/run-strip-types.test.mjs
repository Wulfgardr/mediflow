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

test('run-strip-types erases type-only named imports during in-memory transpile', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-strip-types-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'helper.ts'),
      'export interface HelperType { value: number; }\nexport const value = 42;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'entry.ts'),
      "import { HelperType, value } from './helper';\nconst result: HelperType = { value };\nconsole.log(result.value);\n",
      'utf8',
    );

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

test('run-strip-types expands --glob into matching test files', () => {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-run-strip-types-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'one.test.ts'), "import test from 'node:test';\ntest('one', () => {});\n", 'utf8');
    fs.writeFileSync(path.join(tempDir, 'nested', 'two.test.ts'), "import test from 'node:test';\ntest('two', () => {});\n", 'utf8');

    const relativePattern = `${path.relative(repoRoot, tempDir)}/**/*.test.ts`;
    const result = spawnSync(process.execPath, [runnerPath, '--test', '--glob', relativePattern], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /tests 2/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('run-strip-types lowers import.meta.url for CommonJS test execution', () => {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-run-strip-types-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'entry.test.ts'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { fileURLToPath } from 'node:url';",
        "test('import meta url resolves this file', () => {",
        "  assert.equal(fileURLToPath(import.meta.url).endsWith('entry.test.ts'), true);",
        "});",
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(process.execPath, [runnerPath, '--test', path.join(tempDir, 'entry.test.ts')], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /tests 1/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('run-strip-types can exclude files from glob expansion', () => {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-run-strip-types-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'one.test.ts'), "import test from 'node:test';\ntest('one', () => {});\n", 'utf8');
    fs.writeFileSync(path.join(tempDir, 'skip.test.ts'), "throw new Error('excluded test should not load');\n", 'utf8');

    const relativeDir = path.relative(repoRoot, tempDir);
    const result = spawnSync(
      process.execPath,
      [
        runnerPath,
        '--test',
        '--exclude',
        `${relativeDir}/skip.test.ts`,
        '--glob',
        `${relativeDir}/**/*.test.ts`,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /tests 1/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
