/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const helperUrl = pathToFileURL(path.join(import.meta.dirname, 'test-data-dir.mjs')).href;

test('owned temp data dir uses its physical path, while explicit paths retain caller ownership', () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-test-data-dir-')));
  try {
    const physical = path.join(sandbox, 'physical');
    const alias = path.join(sandbox, 'alias');
    fs.mkdirSync(physical);
    fs.symlinkSync(physical, alias, 'dir');
    const program = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { acquireTestDataDir, cleanupTestDataDir } from ${JSON.stringify(helperUrl)};
      const owned = acquireTestDataDir({}, 'mediflow-owned-');
      try {
        assert.equal(owned.owned, true);
        assert.equal(owned.dataDir, fs.realpathSync(owned.dataDir));
        assert.equal(fs.existsSync(owned.dataDir), true);
        const explicitAlias = acquireTestDataDir({ MEDIFLOW_DATA_DIR: ${JSON.stringify(alias)} });
        assert.deepEqual(explicitAlias, { dataDir: ${JSON.stringify(alias)}, owned: false });
        cleanupTestDataDir(explicitAlias);
        assert.equal(fs.existsSync(${JSON.stringify(alias)}), true);
        const explicitRelative = acquireTestDataDir({ MEDIFLOW_DATA_DIR: 'relative-synthetic-data' });
        assert.deepEqual(explicitRelative, { dataDir: 'relative-synthetic-data', owned: false });
        cleanupTestDataDir(explicitRelative);
      } finally {
        cleanupTestDataDir(owned);
      }
      assert.equal(fs.existsSync(owned.dataDir), false);
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: alias },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(fs.readdirSync(physical), []);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
