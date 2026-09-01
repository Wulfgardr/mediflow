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
const webAuthOwnerPackage = '@mediflow/web-auth-lifecycle-owner';
const webAuthOwnerTracePattern = './node_modules/@mediflow/web-auth-lifecycle-owner/**/*';
const webAuthOwnerRoster = [
  'index.d.ts',
  'index.js',
  'internal/control-record.cjs',
  'internal/owner.cjs',
  'internal/session-activation.cjs',
  'internal/session-cell.cjs',
  'internal/session-resolver.cjs',
  'internal/session-resource.cjs',
  'internal/session-retirement.cjs',
  'internal/support/successor-fence.cjs',
  'internal/support/value.cjs',
  'package.json',
];

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

  const source = fs.readFileSync(checker, 'utf8');
  assert.match(source, /node_modules.*@firecrawl.*pdf-inspector/s);
  assert.match(source, /pdf-inspector-router/);
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

test('standalone checker proves web auth owner physical copy and restart denial', () => {
  const result = runSelfTest('--self-test=web-auth-owner');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const source = fs.readFileSync(checker, 'utf8');
  assert.match(source, /WEB_AUTH_OWNER_VERSION = '0\.8\.6'/);
  assert.match(source, /['"]withCurrentResourceBinding['"]/);
  assert.match(source, /root is not the frozen exact 21-function API/);
  assert.match(source, /does not match the exact final file roster/);
  assert.match(source, /process A emitted data other than exact synthetic locators/);
  assert.match(source, /process B did not deny process A authority as absent/);
  assert.doesNotMatch(source, /@mediflow\/web-auth-lifecycle-owner\/internal/);
});

test('standalone config externalizes and traces the exact web auth owner package roster', () => {
  const configSource = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const includes = configSource.match(/outputFileTracingIncludes:\s*\{[\s\S]*?["']\/\*["']:\s*\[([\s\S]*?)\]/u)?.[1];
  assert.ok(includes, 'missing global outputFileTracingIncludes roster');
  assert.ok(includes.includes(`"${webAuthOwnerTracePattern}"`), 'web auth owner is not traced as a complete package');
  assert.match(
    configSource,
    /serverExternalPackages:\s*\[[^\]]*['"]@mediflow\/web-auth-lifecycle-owner['"]/u,
  );

  const installedPackage = path.join(root, 'node_modules', '@mediflow', 'web-auth-lifecycle-owner');
  const matchedRoster = fs.globSync(webAuthOwnerTracePattern, { cwd: root })
    .filter((candidate) => fs.statSync(path.join(root, candidate)).isFile())
    .map((candidate) => path.relative(installedPackage, path.join(root, candidate)).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(matchedRoster, webAuthOwnerRoster);
  assert.equal(webAuthOwnerPackage, JSON.parse(fs.readFileSync(path.join(installedPackage, 'package.json'), 'utf8')).name);
});
