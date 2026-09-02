/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-grant-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
  env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const production = await import('./headless-checkup-active-role-session-grant-production.ts');

test('exports only the checkup-specific process owner without ambient auth resolution', () => {
  assert.deepEqual(Reflect.ownKeys(production.headlessCheckupActiveRoleSessionGrant).sort(),
    ['dispose', 'issue', 'withCurrent', 'withCurrentRequest']);
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-session-grant-production.ts', import.meta.url), 'utf8');
  assert.match(source, /peekSession/u); assert.match(source, /registerServerSessionResource/u);
  assert.doesNotMatch(source, /readAuthenticatedWebSession|acquireAuthenticated|cookies|physician-review|fresh-review|proof|writer|ipc/iu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
