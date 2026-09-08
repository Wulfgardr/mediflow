/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSupervisorTestUrls } from './test-fixtures/portable-supervisor-import-urls.mjs';

test('supervisor test URLs preserve native absolute paths with spaces, Unicode, # and %', () => {
  const root = path.join(os.tmpdir(), 'synthetic supervisor # 100% città');
  const { rootUrl, loaderUrl } = createSupervisorTestUrls(root);
  assert.equal(fileURLToPath(rootUrl), `${path.resolve(root)}${path.sep}`);
  assert.equal(fileURLToPath(loaderUrl), path.join(root, 'scripts', 'register-strip-types-loader.mjs'));
  assert.equal(new URL(rootUrl).protocol, 'file:');
  assert.equal(new URL(rootUrl).hash, '');
  assert.equal(new URL(rootUrl).search, '');
  assert.match(rootUrl, /%23/);
  assert.match(rootUrl, /%25/);
  assert.equal(fileURLToPath(new URL('lib/security/probe.mjs', rootUrl)),
    path.join(root, 'lib', 'security', 'probe.mjs'));
});

test('real Node --import and dynamic import resolve the encoded test checkout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic supervisor # 100% città-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  // Deliberate synthetic modules inside an isolated temporary fixture, not product stand-ins.
  fs.writeFileSync(path.join(root, 'scripts', 'register-strip-types-loader.mjs'),
    "globalThis.syntheticSupervisorImportProbe = 'loader-ready';\n");
  fs.writeFileSync(path.join(root, 'probe.mjs'), "export const value = 'module-ready';\n");
  const { rootUrl, loaderUrl } = createSupervisorTestUrls(root);
  const script = `
const url = (relative) => new URL(relative, ${JSON.stringify(rootUrl)}).href;
const { value } = await import(url('probe.mjs'));
process.stdout.write(JSON.stringify([globalThis.syntheticSupervisorImportProbe, value]));
`;
  const result = spawnSync(process.execPath, ['--import', loaderUrl, '--input-type=module', '--eval', script], {
    cwd: root,
    env: { MEDIFLOW_DATA_DIR: root },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['loader-ready', 'module-ready']);
});
