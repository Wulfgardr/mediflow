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
const detectLibcTracePattern = './node_modules/detect-libc/**/*';
const pnpmNestedSharpSemverTracePattern = './node_modules/.pnpm/node_modules/semver/**/*';
const npmNestedSharpSemverTracePattern = './node_modules/sharp/node_modules/semver/**/*';
const sharpTracePattern = './node_modules/sharp/**/*';
const anyDocPdfWorkerTracePattern = './scripts/anydoc-pdf-page-worker.mjs';
const pdfLibTracePattern = './node_modules/pdf-lib/**/*';
const pdfLibScopeTracePattern = './node_modules/@pdf-lib/**/*';
const pdfJsManifestTracePattern = './node_modules/pdfjs-dist/package.json';
const pdfJsLegacyTracePattern = './node_modules/pdfjs-dist/legacy/build/**/*';
const webAuthOwnerPackage = '@mediflow/web-auth-lifecycle-owner';
const webAuthOwnerTracePattern = './node_modules/@mediflow/web-auth-lifecycle-owner/**/*';
const appleVisionCanvasPackage = '@napi-rs/canvas';
const appleVisionCanvasTracePattern = './node_modules/@napi-rs/canvas/**/*';
const appleVisionCanvasBackendTracePattern = './node_modules/@napi-rs/canvas-darwin-arm64/**/*';
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
  assert.match(source, /bundledAppleVisionScriptFailure\(standaloneDir\)/);
  assert.match(source, /createHash\('sha256'\).*APPLE_VISION_SCRIPT_SHA256/s);
});

test('standalone checker pins and smokes the isolated PDF page worker', () => {
  const result = runSelfTest('--self-test=pdf-page-worker');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const source = fs.readFileSync(checker, 'utf8');
  assert.match(source, /ANYDOC_PDF_PAGE_WORKER_SHA256 = '[a-f0-9]{64}'/u);
  assert.match(source, /bundledPdfPageWorkerFailure\(standaloneDir\)/u);
  assert.match(source, /bundledPdfPageWorkerTraceFailure\(standaloneDir\)/u);
  assert.match(source, /standalonePdfChildDependenciesFailure\(standaloneDir, requireFromStandalone\)/u);
  assert.match(source, /framedPdfPageWorkerSmokeFailure/u);
  assert.match(source, /--max-old-space-size=\$\{ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB\}/u);
  assert.match(source, /--permission/u);
  assert.match(source, /--allow-fs-read=\$\{packageRoot\}/u);
  assert.match(source, /allowAddons \? \['--allow-addons'\] : \[\]/u);
  assert.match(source, /missing PDF page worker passed/u);
  assert.match(source, /tampered PDF page worker passed/u);
  assert.match(source, /symlinked PDF page worker passed/u);
});

test('digest-pinned text workers retain exact LF bytes on every checkout', () => {
  const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  for (const worker of [
    'scripts/anydoc-local-extraction-worker.mjs',
    'scripts/anydoc-pdf-page-worker.mjs',
    'scripts/apple-vision-ocr.swift',
  ]) {
    assert.ok(
      attributes.split(/\r?\n/u).includes(`${worker} text eol=lf`),
      `${worker} is not pinned to LF checkout bytes`,
    );
  }
});

test('standalone checker rejects Apple Vision canvas drift, symlinks, and unexpected files', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, () => {
  const result = runSelfTest('--self-test=apple-vision-canvas');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const source = fs.readFileSync(checker, 'utf8');
  assert.match(source, /APPLE_VISION_CANVAS_VERSION = '0\.1\.100'/);
  assert.match(source, /does not match the exact pinned file roster/);
  assert.match(source, /contains a symbolic link/);
  assert.match(source, /createCanvas\(1, 1\)\.toBuffer\('image\/png'\)/);
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

test('standalone config traces the complete sharp libc detector', () => {
  const configSource = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const includes = configSource.match(/outputFileTracingIncludes:\s*\{[\s\S]*?["']\/\*["']:\s*\[([\s\S]*?)\]/u)?.[1];
  assert.ok(includes, 'missing global outputFileTracingIncludes roster');
  assert.ok(includes.includes(`"${detectLibcTracePattern}"`), 'detect-libc implementation is not traced for standalone sharp');
  assert.ok(includes.includes('"./scripts/apple-vision-ocr.swift"'), 'Apple Vision OCR script is not traced for standalone');
});

test('standalone config traces the isolated PDF worker dependency closure', () => {
  const configSource = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const includes = configSource.match(/outputFileTracingIncludes:\s*\{[\s\S]*?["']\/\*["']:\s*\[([\s\S]*?)\]/u)?.[1];
  const externals = configSource.match(/serverExternalPackages:\s*\[([^\]]*)\]/u)?.[1];
  assert.ok(includes, 'missing global outputFileTracingIncludes roster');
  assert.ok(externals, 'missing serverExternalPackages roster');
  for (const pattern of [
    anyDocPdfWorkerTracePattern,
    pdfLibTracePattern,
    pdfLibScopeTracePattern,
    pdfJsManifestTracePattern,
    pdfJsLegacyTracePattern,
    appleVisionCanvasTracePattern,
    appleVisionCanvasBackendTracePattern,
  ]) {
    assert.ok(includes.includes(`"${pattern}"`), `isolated PDF runtime is not tracing ${pattern}`);
  }
  assert.doesNotMatch(externals, /['"](?:pdf-lib|pdfjs-dist|@napi-rs\/canvas)['"]/u);
});

/* @Codex */
test('standalone config traces the installed semver layout for sharp', () => {
  const configSource = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const includes = configSource.match(/outputFileTracingIncludes:\s*\{[\s\S]*?["']\/\*["']:\s*\[([\s\S]*?)\]/u)?.[1];
  assert.ok(includes, 'missing global outputFileTracingIncludes roster');
  const pnpmSemver = fs.globSync(pnpmNestedSharpSemverTracePattern, { cwd: root });
  const npmSemver = fs.globSync(npmNestedSharpSemverTracePattern, { cwd: root });
  assert.ok(pnpmSemver.length > 0 || npmSemver.length > 0, 'installed sharp does not expose nested semver');
  assert.ok(
    (pnpmSemver.length > 0 && includes.includes(`"${pnpmNestedSharpSemverTracePattern}"`))
      || (npmSemver.length > 0 && includes.includes(`"${sharpTracePattern}"`)),
    'installed sharp semver layout is not traced for standalone',
  );
  assert.ok([...pnpmSemver, ...npmSemver].some((candidate) => candidate.endsWith('/functions/coerce.js')),
    'installed sharp semver does not provide functions/coerce.js');
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

test('standalone config traces the pinned Apple Vision canvas runtime', () => {
  const configSource = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const includes = configSource.match(/outputFileTracingIncludes:\s*\{[\s\S]*?["']\/\*["']:\s*\[([\s\S]*?)\]/u)?.[1];
  assert.ok(includes, 'missing global outputFileTracingIncludes roster');
  assert.ok(includes.includes(`"${appleVisionCanvasTracePattern}"`), 'Apple Vision canvas package is not fully traced');
  assert.ok(includes.includes(`"${appleVisionCanvasBackendTracePattern}"`), 'Apple Vision canvas backend is not fully traced');

  const installedManifest = JSON.parse(fs.readFileSync(
    path.join(root, 'node_modules', '@napi-rs', 'canvas', 'package.json'),
    'utf8',
  ));
  assert.equal(installedManifest.name, appleVisionCanvasPackage);
  assert.equal(installedManifest.version, '0.1.100');
  assert.equal(installedManifest.optionalDependencies?.['@napi-rs/canvas-darwin-arm64'], '0.1.100');
});
