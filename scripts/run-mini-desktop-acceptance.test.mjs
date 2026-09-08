/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  MINI_DESKTOP_ACCEPTANCE_TESTS, requireMiniAcceptanceFiles, miniAcceptanceEnvironment,
  withMiniAcceptanceDataDir, miniAcceptanceSummary, executeMiniAcceptanceStages,
} from './run-mini-desktop-acceptance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tap = '# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const quiet = { writeOut: () => undefined, writeErr: () => undefined };

test('fixed roster includes real production Mini, not only package-level transports', () => {
  const files = requireMiniAcceptanceFiles(root);
  assert.deepEqual(files, [...MINI_DESKTOP_ACCEPTANCE_TESTS]);
  assert.ok(files.includes('lib/security/portable-supervisor-mini-production.test.ts'));
  assert.equal(files.length, 4);
  assert.equal(Object.isFrozen(MINI_DESKTOP_ACCEPTANCE_TESTS), true);
});

test('a partial checkout fails rather than silently discovering a smaller suite', () => {
  withMiniAcceptanceDataDir((directory) => {
    assert.throws(() => requireMiniAcceptanceFiles(directory), /Required acceptance file missing: .nvmrc/u);
    for (const relative of ['.nvmrc', 'package.json', 'package-lock.json',
      'scripts/prepare-e2e-db.mjs', 'scripts/run-strip-types.mjs', 'scripts/register-strip-types-loader.mjs',
      'lib/security/portable-supervisor-production.ts', 'lib/security/web-auth-lifecycle-owner-test-fixture.ts',
      'packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.7.tgz',
      ...MINI_DESKTOP_ACCEPTANCE_TESTS]) {
      fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
      fs.writeFileSync(path.join(directory, relative), 'fixture');
    }
    assert.deepEqual(requireMiniAcceptanceFiles(directory), [...MINI_DESKTOP_ACCEPTANCE_TESTS]);
    const productionTest = path.join(directory, MINI_DESKTOP_ACCEPTANCE_TESTS.at(-1));
    fs.rmSync(productionTest);
    assert.throws(() => requireMiniAcceptanceFiles(directory), /portable-supervisor-mini-production.test.ts/u);
    fs.mkdirSync(productionTest);
    assert.throws(() => requireMiniAcceptanceFiles(directory), /portable-supervisor-mini-production.test.ts/u);
  });
});

test('child environment preserves OS essentials but never caller data or provider activation', () => {
  withMiniAcceptanceDataDir((directory) => {
    const env = miniAcceptanceEnvironment({
      Path: 'synthetic-path', SystemRoot: 'synthetic-windows', HOME: 'synthetic-home',
      MEDIFLOW_DATA_DIR: 'caller-owned', MEDIFLOW_E2E_DATA_DIR: 'caller-owned-e2e',
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '0', MEDIFLOW_STRIP_TYPES_NODE: 'other-runtime',
      MEDIFLOW_ATHENA_MLX_GENERATE_BIN: 'not-selected', E2E_USERNAME: 'not-selected',
      NODE_OPTIONS: '--not-selected', NODE_PATH: 'not-selected', NODE_TEST_CONTEXT: 'not-selected',
      OPENAI_API_KEY: 'synthetic-not-a-credential', NEXT_PHASE: 'phase-production-build',
    }, directory);
    assert.equal(env.Path, 'synthetic-path');
    assert.equal(env.SystemRoot, 'synthetic-windows');
    assert.equal(env.HOME, 'synthetic-home');
    assert.equal(env.MEDIFLOW_DATA_DIR, directory);
    assert.equal(env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY, '1');
    assert.equal(env.MEDIFLOW_STRIP_TYPES_NODE, process.execPath);
    assert.equal(env.E2E_USERNAME, 'synthetic-mini-acceptance');
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_TEST_CONTEXT', 'OPENAI_API_KEY',
      'MEDIFLOW_ATHENA_MLX_GENERATE_BIN', 'MEDIFLOW_E2E_DATA_DIR', 'NEXT_PHASE']) assert.equal(key in env, false);
    assert.throws(() => miniAcceptanceEnvironment({}, 'relative'), /must be absolute/u);
  });
});

test('owned directory survives through the action and is removed on success or exception', () => {
  const sentinel = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-caller-sentinel-'));
  const original = process.env.MEDIFLOW_DATA_DIR;
  process.env.MEDIFLOW_DATA_DIR = sentinel;
  let successPath, failurePath;
  try {
    fs.writeFileSync(path.join(sentinel, 'medical.db'), 'synthetic sentinel, not a database');
    const result = withMiniAcceptanceDataDir((directory) => {
      successPath = directory;
      assert.equal(fs.realpathSync(directory), directory);
      assert.notEqual(directory, sentinel);
      fs.writeFileSync(path.join(directory, 'medical.db'), 'synthetic-owned');
      return 17;
    });
    assert.equal(result, 17);
    assert.equal(fs.existsSync(successPath), false);
    assert.throws(() => withMiniAcceptanceDataDir((directory) => {
      failurePath = directory; throw new Error('synthetic failure');
    }), /synthetic failure/u);
    assert.equal(fs.existsSync(failurePath), false);
    assert.equal(fs.readFileSync(path.join(sentinel, 'medical.db'), 'utf8'), 'synthetic sentinel, not a database');
  } finally {
    if (original === undefined) delete process.env.MEDIFLOW_DATA_DIR; else process.env.MEDIFLOW_DATA_DIR = original;
    fs.rmSync(sentinel, { recursive: true, force: true });
  }
});

test('authentic bootstrap and strip-types commands share the fresh directory and exact runtime', () => {
  withMiniAcceptanceDataDir((dataDir) => {
    const calls = [];
    const result = executeMiniAcceptanceStages({ root, dataDir, parentEnv: {}, ...quiet,
      spawnSyncImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, signal: null, stdout: calls.length === 2 ? tap : '', stderr: '' };
      },
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.tests, 4);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.command, process.execPath);
      assert.equal(call.options.cwd, root);
      assert.equal(call.options.shell, false);
      assert.equal(call.options.env.MEDIFLOW_DATA_DIR, dataDir);
      assert.equal(call.options.env.MEDIFLOW_STRIP_TYPES_NODE, process.execPath);
      assert.equal(call.options.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY, '1');
      assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
    }
    assert.deepEqual(calls[0].args, [path.join(root, 'scripts/prepare-e2e-db.mjs')]);
    assert.deepEqual(calls[1].args, [path.join(root, 'scripts/run-strip-types.mjs'),
      '--test', '--test-concurrency=1', '--test-reporter=tap', ...MINI_DESKTOP_ACCEPTANCE_TESTS]);
  });
});

for (const phase of [1, 2]) {
  for (const ending of ['nonzero', 'signal', 'spawn_error', 'throw']) {
    test(`orchestration stops on ${ending} in stage ${phase} without an acceptance pass`, () => {
      withMiniAcceptanceDataDir((dataDir) => {
        let calls = 0;
        const result = executeMiniAcceptanceStages({ root, dataDir, parentEnv: {}, ...quiet,
          spawnSyncImpl: () => {
            calls += 1;
            if (calls !== phase) return { status: 0, signal: null, stdout: '' };
            if (ending === 'throw') throw new Error('synthetic failure');
            if (ending === 'nonzero') return { status: 9, signal: null, stdout: tap };
            if (ending === 'signal') return { status: null, signal: 'SIGTERM', stdout: tap };
            return { status: 0, signal: null, error: new Error('synthetic failure'), stdout: tap };
          },
        });
        assert.equal(calls, phase);
        assert.equal(result.status, 'failed');
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.stages.length, phase);
        assert.equal(result.summary, null);
      });
    });
  }
}

test('zero exit with skipped, absent, duplicate, partial or empty TAP evidence cannot pass', () => {
  assert.equal(miniAcceptanceSummary(tap).tests, 4);
  assert.equal(miniAcceptanceSummary(tap.replaceAll('\n', '\r\n')).tests, 4);
  for (const stdout of ['', tap + tap, tap.replace('# tests 4', '# tests 0'),
    tap.replace('# pass 4', '# pass 3'), tap.replace('# skipped 0', '# skipped 1'),
    tap.replace('# todo 0', '# todo 1'), tap.replace('# fail 0', '# fail 1'),
    tap.replace('# cancelled 0', '# cancelled 1'), tap.replace('# todo 0\n', '')]) {
    assert.equal(miniAcceptanceSummary(stdout), null);
    withMiniAcceptanceDataDir((dataDir) => {
      let calls = 0;
      const result = executeMiniAcceptanceStages({ root, dataDir, parentEnv: {}, ...quiet,
        spawnSyncImpl: () => ({ status: 0, signal: null, stdout: ++calls === 2 ? stdout : '' }),
      });
      assert.equal(result.status, 'failed');
      assert.equal(result.stages.at(-1).error, 'incomplete_test_evidence');
    });
  }
});

test('real CLI rejects unsupported arguments without starting a bootstrap', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-mini-desktop-acceptance.mjs'),
    '--skip-preflight'], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).status, 'blocked');
  assert.match(JSON.parse(result.stderr).reason, /Usage:/u);
});

// This runs the real node:test TAP reporter, not an AIP host or a database.
test('TAP evidence gate accepts a real passing child test and rejects a real skipped child test', () => {
  withMiniAcceptanceDataDir((directory) => {
    const target = path.join(directory, 'reporter.test.mjs');
    for (const skip of [false, true]) {
      fs.writeFileSync(target, `import { test } from 'node:test';\ntest('synthetic reporter', { skip: ${skip} }, () => {});\n`);
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', target], {
        env: miniAcceptanceEnvironment(process.env, directory), encoding: 'utf8', timeout: 5_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      const summary = miniAcceptanceSummary(result.stdout);
      if (skip) assert.equal(summary, null);
      else assert.equal(summary?.tests, 1);
    }
  });
});
