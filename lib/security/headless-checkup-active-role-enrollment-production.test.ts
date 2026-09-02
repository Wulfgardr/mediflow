/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-enrollment-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
  env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const production = await import('./headless-checkup-active-role-enrollment-production.ts');

test('composes one server-only, PIN-only checkup enrollment function', () => {
  assert.equal(typeof production.enrollHeadlessCheckupActiveRoleAttestation, 'function');
  assert.equal(production.enrollHeadlessCheckupActiveRoleAttestation.length, 1);
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-enrollment-production.ts', import.meta.url), 'utf8');
  assert.match(source, /readAuthenticatedWebSession/u); assert.match(source, /isWebAdminSession/u);
  assert.match(source, /verifyHostCredentials/u); assert.match(source, /createHeadlessCheckupActiveRoleAttestationStoreV1/u);
  assert.doesNotMatch(source, /physician-review|session-physician-review|active-review-binding|clinical-diary|fabric/iu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
