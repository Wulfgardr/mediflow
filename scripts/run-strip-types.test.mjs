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
      env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(tempDir, 'data'), MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
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
      env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(tempDir, 'data'), MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
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
      env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(tempDir, 'data'), MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
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
      env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(tempDir, 'data'), MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
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
        env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(tempDir, 'data'), MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
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

/* @Codex: every subprocess uses synthetic HOME and/or an explicit fixture. */
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-runner-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(directory, args, env = {}) {
  return spawnSync(process.execPath, [runnerPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: directory, USERPROFILE: directory,
      MEDIFLOW_STRIP_TYPES_NODE: process.execPath, ...env },
    encoding: 'utf8', timeout: 30_000,
  });
}

for (const value of [undefined, '', '   ']) {
  test(`preflight denies ${JSON.stringify(value)} before probe or target import`, (t) => {
    const directory = fixture(t);
    const target = path.join(directory, 'entry.test.ts');
    const marker = path.join(directory, 'target-ran');
    // The real module must never load; HOME is also synthetic as defense in depth.
    fs.writeFileSync(target, `import '@/lib/db-server';
import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
    const probe = path.join(directory, 'probe');
    const probeMarker = path.join(directory, 'probe-ran');
    fs.writeFileSync(probe, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(probeMarker)}, 'unexpected');`);
    fs.chmodSync(probe, 0o700);
    const result = run(directory, ['--test', target], {
      MEDIFLOW_DATA_DIR: value, MEDIFLOW_STRIP_TYPES_NODE: probe,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /MEDIFLOW_TEST_DATA_DIR_REQUIRED/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(probeMarker), false);
    assert.equal(fs.existsSync(path.join(directory, 'Library')), false);
    assert.equal(fs.existsSync(path.join(directory, '.mediflow')), false);
  });
}

test('explicit synthetic directory receives eager DB initialization; default stays absent', (t) => {
  const directory = fixture(t);
  const dataDir = path.join(directory, 'explicit data');
  const target = path.join(directory, 'db.test.ts');
  fs.writeFileSync(target, `import '@/lib/db-server';
import test from 'node:test'; import assert from 'node:assert/strict';
import { resolveDataPath } from '@/lib/data-dir';
test('explicit target', () => assert.equal(resolveDataPath('medical.db'), ${JSON.stringify(path.join(dataDir, 'medical.db'))}));`);
  const result = run(directory, ['--test', target], { MEDIFLOW_DATA_DIR: dataDir, NEXT_PHASE: '', NODE_ENV: 'test' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.statSync(path.join(dataDir, 'medical.db')).size > 0);
  assert.equal(fs.existsSync(path.join(directory, 'Library')), false);
  assert.equal(fs.existsSync(path.join(directory, '.mediflow')), false);
  // The runner must not delete caller-owned state after its child exits.
  assert.equal(fs.existsSync(dataDir), true);
});

test('nested runner preserves explicit relative env and fixture cleanup', (t) => {
  const directory = fixture(t);
  const dataDir = path.relative(repoRoot, path.join(directory, 'explicit'));
  fs.mkdirSync(path.resolve(repoRoot, dataDir));
  const owned = path.join(directory, 'child-owned');
  const marker = path.join(directory, 'nested-ran');
  const child = path.join(directory, 'child.test.ts');
  fs.writeFileSync(child, `import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('inherited environment', () => {
  assert.equal(process.env.MEDIFLOW_DATA_DIR, ${JSON.stringify(dataDir)});
  assert.equal(process.env.MEDIFLOW_RUNNER_SENTINEL, 'synthetic');
  fs.mkdirSync(${JSON.stringify(owned)});
  fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
});
test.after(() => fs.rmSync(${JSON.stringify(owned)}, { recursive: true, force: true }));`);
  const outer = path.join(directory, 'outer.test.ts');
  fs.writeFileSync(outer, `import test from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process';
test('nested runner', () => {
  const result = spawnSync(process.execPath, [${JSON.stringify(runnerPath)}, '--test', ${JSON.stringify(child)}], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /tests 1/);
});`);
  const result = run(directory, ['--test', outer], { MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_RUNNER_SENTINEL: 'synthetic' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(path.resolve(repoRoot, dataDir)), true);
});

test('failed target keeps exit status and runs fixture cleanup without deleting caller data', (t) => {
  const directory = fixture(t);
  const dataDir = path.join(directory, 'caller-owned');
  fs.mkdirSync(dataDir);
  const owned = path.join(directory, 'child-owned');
  const target = path.join(directory, 'fail.test.ts');
  fs.writeFileSync(target, `import test from 'node:test'; import fs from 'node:fs';
fs.mkdirSync(${JSON.stringify(owned)});
test.after(() => fs.rmSync(${JSON.stringify(owned)}, { recursive: true, force: true }));
test('intentional fixture failure', () => { throw new Error('synthetic failure'); });`);
  const result = run(directory, ['--test', target], { MEDIFLOW_DATA_DIR: dataDir });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /synthetic failure/);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(dataDir), true);
});
