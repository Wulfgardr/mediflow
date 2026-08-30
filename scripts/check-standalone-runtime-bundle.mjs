// Codex: created 2026-05-02
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertNodeRuntime, readNodeContract, standaloneDirectory } from './node-runtime-contract.mjs';

const ANYDOC_WORKER_FILE = 'anydoc-local-extraction-worker.mjs';
const ANYDOC_WORKER_SHA256 = '34f2db3d788585dab175b284bc8f1f39395fb66a21780e1782a5d5067073e370';
const SYNTHETIC_RTF = Buffer.from('{\\rtf1\\ansi Synthetic standalone note.}', 'utf8');

function bundledWorkerFailure(standaloneDir) {
  const workerPath = path.join(standaloneDir, 'scripts', ANYDOC_WORKER_FILE);
  let workerStat;
  try {
    workerStat = fs.lstatSync(workerPath);
  } catch {
    return 'Standalone runtime does not contain the AnyDoc worker.';
  }
  if (!workerStat.isFile()) return 'Standalone runtime AnyDoc worker is not a regular file.';

  try {
    const root = fs.realpathSync(standaloneDir);
    const worker = fs.realpathSync(workerPath);
    const relative = path.relative(root, worker);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return 'Standalone runtime resolves the AnyDoc worker outside the bundle.';
    if (!fs.statSync(worker).isFile()) return 'Standalone runtime AnyDoc worker is not a regular file.';
    if (createHash('sha256').update(fs.readFileSync(worker)).digest('hex') !== ANYDOC_WORKER_SHA256) {
      return 'Standalone runtime AnyDoc worker digest does not match the packaged worker.';
    }
  } catch {
    return 'Standalone runtime cannot verify the AnyDoc worker.';
  }
  return null;
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-checker-self-test-'));
  const scriptsDir = path.join(root, 'scripts');
  const workerPath = path.join(scriptsDir, ANYDOC_WORKER_FILE);
  const sourceWorker = path.join(process.cwd(), 'scripts', ANYDOC_WORKER_FILE);
  try {
    fs.mkdirSync(scriptsDir);
    fs.copyFileSync(sourceWorker, workerPath);
    if (bundledWorkerFailure(root) !== null) throw new Error('expected bundled AnyDoc worker to pass');
    fs.rmSync(workerPath);
    if (bundledWorkerFailure(root) === null) throw new Error('missing bundled AnyDoc worker passed');
    fs.copyFileSync(sourceWorker, workerPath);
    fs.appendFileSync(workerPath, '\n// self-test tamper\n');
    if (bundledWorkerFailure(root) === null) throw new Error('tampered bundled AnyDoc worker passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--self-test') {
  runSelfTest();
  process.exit(0);
}

const root = process.cwd();
const standaloneDir = standaloneDirectory(root);
const serverPath = path.join(standaloneDir, 'server.js');
const runtimeContractPath = path.join(standaloneDir, 'mediflow-runtime-contract.json');
const pdfInspectorWorkerPath = path.join(standaloneDir, 'scripts', 'pdf-inspector-worker.mjs');

const forbiddenMatchers = [
  (relativePath) => /^medical\.db$/i.test(relativePath),
  (relativePath) => /\.(db|sqlite|sqlite3)$/i.test(relativePath),
  (relativePath) => /^tmp[-_/]/.test(relativePath),
  (relativePath) => /^docs\//.test(relativePath),
  (relativePath) => /^oss-assets\//.test(relativePath),
  (relativePath) => /^(README|PLANS|ARCHITECTURE|SECURITY|CONTRIBUTING|CHANGELOG)\.md$/i.test(relativePath),
];

if (!fs.existsSync(serverPath)) {
  console.error(`Missing ${path.relative(root, serverPath)}. Run npm run build before checking the runtime bundle.`);
  process.exit(1);
}
if (!fs.existsSync(runtimeContractPath)) {
  console.error('Missing standalone Node/ABI contract. Rebuild the runtime with npm run build.');
  process.exit(1);
}

const runtimeContract = JSON.parse(fs.readFileSync(runtimeContractPath, 'utf8'));
const currentRuntime = assertNodeRuntime(readNodeContract(root));
if (runtimeContract.node?.moduleVersion !== currentRuntime.moduleVersion ||
    runtimeContract.platform !== process.platform || runtimeContract.arch !== process.arch) {
  console.error(`Standalone runtime ABI/platform mismatch: built ${runtimeContract.node?.version}/${runtimeContract.node?.moduleVersion} ${runtimeContract.platform}-${runtimeContract.arch}, checking ${process.versions.node}/${process.versions.modules} ${process.platform}-${process.arch}.`);
  process.exit(1);
}

const requireFromStandalone = createRequire(serverPath);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertRealpathInsideStandalone(candidatePath, label) {
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(candidatePath);
  } catch (error) {
    fail(`Standalone runtime cannot resolve ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const relativePath = path.relative(standaloneDir, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    fail(`Standalone runtime resolved ${label} outside the bundle: ${resolvedPath}`);
  }

  return resolvedPath;
}

function sharpPlatformArch() {
  const isMuslLinux = process.platform === 'linux' && !process.report?.getReport().header.glibcVersionRuntime;
  return `${process.platform}${isMuslLinux ? 'musl' : ''}-${process.arch}`;
}

function sharpRuntimePackages() {
  const platformArch = sharpPlatformArch();
  const sharpPackageDir = path.dirname(path.dirname(sharpEntry));
  const sharpManifest = JSON.parse(fs.readFileSync(path.join(sharpPackageDir, 'package.json'), 'utf8'));
  const optionalDependencies = sharpManifest.optionalDependencies ?? {};
  const bindingPackage = `@img/sharp-${platformArch}`;
  const libvipsPackage = `@img/sharp-libvips-${platformArch}`;

  if (!optionalDependencies[bindingPackage]) {
    fail(`Standalone runtime sharp package does not declare a native binding for ${platformArch}.`);
  }

  return {
    bindingPackage,
    libvipsPackage: optionalDependencies[libvipsPackage] ? libvipsPackage : undefined,
  };
}

function nativeArtifacts(packageDir, label, matcher) {
  const artifacts = [];

  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidatePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(candidatePath);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && matcher(entry.name)) {
        artifacts.push(candidatePath);
      }
    }
  }

  collect(packageDir);
  if (artifacts.length === 0) {
    fail(`Standalone runtime does not contain ${label}.`);
  }

  for (const artifact of artifacts) {
    assertRealpathInsideStandalone(artifact, label);
  }
}

// @Codex: The child-process parser must be fully self-contained and byte-identical.
const anyDocWorkerFailure = bundledWorkerFailure(standaloneDir);
if (anyDocWorkerFailure) fail(anyDocWorkerFailure);
const anyDocWorkerPath = path.join(standaloneDir, 'scripts', ANYDOC_WORKER_FILE);
const packageScopes = fs.readdirSync(path.join(standaloneDir, 'node_modules'), { withFileTypes: true });
const firecrawlScope = packageScopes.find((entry) => entry.isDirectory() && entry.name === '@firecrawl')?.name;
const anyDocName = firecrawlScope
  ? fs.readdirSync(path.join(standaloneDir, 'node_modules', firecrawlScope), { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name === 'anydoc')?.name
  : undefined;
if (!firecrawlScope || !anyDocName) fail('Standalone runtime does not contain the AnyDoc package directory.');
const anyDocRequest = [firecrawlScope, anyDocName].join('/');
const anyDocEntry = requireFromStandalone.resolve(`${anyDocRequest}/index.js`);
assertRealpathInsideStandalone(anyDocEntry, 'AnyDoc entrypoint');
const anyDocPackageDir = path.dirname(requireFromStandalone.resolve(`${anyDocRequest}/package`));
assertRealpathInsideStandalone(anyDocPackageDir, 'AnyDoc package');
const anyDocManifest = JSON.parse(fs.readFileSync(path.join(anyDocPackageDir, 'package.json'), 'utf8'));
const anyDocNativePackage = Object.keys(anyDocManifest.optionalDependencies ?? {}).find((name) => {
  if (!name.startsWith(`${anyDocRequest}-`) || !name.includes(`-${process.platform}-${process.arch}`)) return false;
  return process.platform !== 'linux' || (process.report?.getReport().header.glibcVersionRuntime ? name.endsWith('-gnu') : name.endsWith('-musl'));
});
if (!anyDocNativePackage) fail('AnyDoc does not declare a native package for the current platform.');
const anyDocNativeManifest = requireFromStandalone.resolve(`${anyDocNativePackage}/package`);
const anyDocNativeDir = path.dirname(assertRealpathInsideStandalone(anyDocNativeManifest, `${anyDocNativePackage} package`));
nativeArtifacts(anyDocNativeDir, `${anyDocNativePackage} native binding`, (name) => name.endsWith('.node'));
const anyDocRun = spawnSync(process.execPath, [anyDocWorkerPath], {
  cwd: path.dirname(anyDocWorkerPath),
  env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
  input: SYNTHETIC_RTF,
  encoding: 'buffer',
  timeout: 15_000,
  windowsHide: true,
});
if (anyDocRun.error || anyDocRun.status !== 0 || !Buffer.isBuffer(anyDocRun.stdout)
    || anyDocRun.stdout.toString('utf8') !== 'Synthetic standalone note.\n') {
  fail('Standalone runtime AnyDoc worker did not extract the synthetic RTF with its allowlisted environment.');
}

let databaseEntry;
try {
  databaseEntry = requireFromStandalone.resolve('better-sqlite3');
} catch {
  fail('Standalone runtime does not contain better-sqlite3. Rebuild before packaging.');
}
assertRealpathInsideStandalone(databaseEntry, 'better-sqlite3');
const Database = requireFromStandalone(databaseEntry);
const probe = new Database(':memory:');
probe.prepare('select 1').get();
probe.close();

// @Codex: The isolated PDF worker must resolve its native binding inside the bundle.
if (!fs.existsSync(pdfInspectorWorkerPath)) {
  fail('Standalone runtime does not contain the PDF inspector worker.');
}
assertRealpathInsideStandalone(pdfInspectorWorkerPath, 'PDF inspector worker');
let pdfInspectorEntry;
const usesIntelMacFallback = process.platform === 'darwin' && process.arch === 'x64';
try {
  pdfInspectorEntry = requireFromStandalone.resolve('@firecrawl/pdf-inspector');
} catch {
  fail('Standalone runtime does not contain @firecrawl/pdf-inspector.');
}
const pdfInspectorPath = assertRealpathInsideStandalone(pdfInspectorEntry, 'PDF inspector entrypoint');
if (!usesIntelMacFallback) {
  const pdfInspector = requireFromStandalone(pdfInspectorPath);
  if (typeof pdfInspector.extractPagesMarkdown !== 'function') {
    fail('Standalone runtime PDF inspector API is incomplete.');
  }
}
const pdfInspectorPackageDir = path.dirname(requireFromStandalone.resolve('@firecrawl/pdf-inspector/package'));
const pdfInspectorManifest = JSON.parse(fs.readFileSync(path.join(pdfInspectorPackageDir, 'package.json'), 'utf8'));
const pdfInspectorBinding = Object.keys(pdfInspectorManifest.optionalDependencies ?? {}).find((name) => {
  if (!name.startsWith('@firecrawl/pdf-inspector-')) return false;
  const platform = name.includes(`-${process.platform}-`);
  const arch = name.includes(`-${process.arch}`);
  const libc = process.platform !== 'linux'
    || (process.report?.getReport().header.glibcVersionRuntime ? name.endsWith('-gnu') : name.endsWith('-musl'));
  return platform && arch && libc;
});
if (!pdfInspectorBinding && !usesIntelMacFallback) {
  fail('PDF inspector does not declare a binding for the current platform.');
}
if (pdfInspectorBinding) {
  const pdfInspectorBindingManifest = requireFromStandalone.resolve(`${pdfInspectorBinding}/package`);
  const pdfInspectorBindingDir = path.dirname(assertRealpathInsideStandalone(pdfInspectorBindingManifest, `${pdfInspectorBinding} package`));
  nativeArtifacts(pdfInspectorBindingDir, `${pdfInspectorBinding} native binding`, (name) => name.endsWith('.node'));
} else {
  const pdfJsEntry = requireFromStandalone.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  assertRealpathInsideStandalone(pdfJsEntry, 'Intel macOS PDF.js fallback');
}

// @Codex: Native image optimization must not resolve through source node_modules.
let sharpEntry;
try {
  sharpEntry = requireFromStandalone.resolve('sharp');
} catch (error) {
  fail(`Standalone runtime does not contain sharp: ${error instanceof Error ? error.message : String(error)}`);
}
assertRealpathInsideStandalone(sharpEntry, 'sharp entrypoint');

const { bindingPackage, libvipsPackage } = sharpRuntimePackages();
const bindingPackageManifest = requireFromStandalone.resolve(`${bindingPackage}/package`);
const bindingPackageDir = path.dirname(assertRealpathInsideStandalone(bindingPackageManifest, `${bindingPackage} package`));
nativeArtifacts(bindingPackageDir, `${bindingPackage} native binding`, (name) => name.endsWith('.node'));

if (libvipsPackage) {
  const libvipsPackageManifest = requireFromStandalone.resolve(`${libvipsPackage}/package`);
  const libvipsPackageDir = path.dirname(assertRealpathInsideStandalone(libvipsPackageManifest, `${libvipsPackage} package`));
  nativeArtifacts(libvipsPackageDir, `${libvipsPackage} native library`, (name) => /^libvips(?:-cpp)?[.\d-]*\.(?:dylib|so(?:\.\d+)*)$/i.test(name));
} else {
  nativeArtifacts(bindingPackageDir, `${bindingPackage} bundled libvips native library`, (name) => /^libvips(?:-cpp)?[.\d-]*\.dll$/i.test(name));
}

const Sharp = requireFromStandalone(sharpEntry);
const syntheticImage = await Sharp({
  create: {
    width: 64,
    height: 48,
    channels: 3,
    background: { r: 12, g: 92, b: 180 },
  },
}).png().toBuffer();
const { imageOptimizer } = requireFromStandalone('next/dist/server/image-optimizer');
const optimizedImage = await imageOptimizer(
  { buffer: syntheticImage, cacheControl: 'public, max-age=0', etag: 'synthetic-image' },
  { href: '/synthetic-image.png', mimeType: 'image/png', quality: 75, width: 32 },
  { experimental: {}, images: { minimumCacheTTL: 0 } },
  { isDev: false, silent: true },
);
const transformedMetadata = await Sharp(optimizedImage.buffer).metadata();
if (transformedMetadata.width !== 32 || transformedMetadata.height !== 24 || optimizedImage.buffer.equals(syntheticImage)) {
  fail('Standalone runtime Next image optimizer did not produce the expected 32x24 derivative.');
}

const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(standaloneDir, absolutePath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (forbiddenMatchers.some((matcher) => matcher(relativePath))) {
      violations.push(relativePath);
    }
  }
}

walk(standaloneDir);

if (violations.length > 0) {
  console.error('Standalone runtime bundle contains forbidden local/private artifacts:');
  for (const violation of violations.slice(0, 50)) {
    console.error(`- ${violation}`);
  }
  if (violations.length > 50) {
    console.error(`...and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log(`check:standalone-runtime-bundle passed (Node ${currentRuntime.version}, ABI ${currentRuntime.moduleVersion})`);
