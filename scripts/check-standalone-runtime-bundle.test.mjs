/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checker = path.join(root, 'scripts', 'check-standalone-runtime-bundle.mjs');
const node = process.execPath;

function runSelfTest(argument) {
  return spawnSync(node, [checker, argument], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

test('standalone checker rejects retired PDF runtime reintroduction', () => {
  const result = runSelfTest('--self-test=pdf-retirement');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('standalone checker preserves AnyDoc worker and native binding guards', () => {
  const result = runSelfTest('--self-test');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const source = fs.readFileSync(checker, 'utf8');
  assert.match(source, /bundledWorkerFailure\(standaloneDir\)/);
  assert.match(source, /createHash\('sha256'\).*ANYDOC_WORKER_SHA256/s);
  assert.match(source, /resolve\(`\$\{anyDocNativePackage\}\/package`\)/);
  assert.match(source, /nativeArtifacts\(anyDocNativeDir,[\s\S]*?name\.endsWith\('\.node'\)/);
});
