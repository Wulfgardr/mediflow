// Codex: created 2026-05-02
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertNodeRuntime, readNodeContract, standaloneDirectory } from './node-runtime-contract.mjs';

const ANYDOC_WORKER_FILE = 'anydoc-local-extraction-worker.mjs';
const ANYDOC_WORKER_SHA256 = '5d6e2e60f1d71f3fd45065961258a7debe8a96e017abdcee92823986c8f08c67';
const ANYDOC_PDF_PAGE_WORKER_FILE = 'anydoc-pdf-page-worker.mjs';
const ANYDOC_PDF_PAGE_WORKER_SHA256 = 'b33e5363e25cfdb20a7cc6e852e38e2c331bdd54d86eed989a1d300fa92fc821';
const ANYDOC_PDF_CHILD_SCHEMA_VERSION = 'mediflow.anydoc_pdf_child_protocol.v1';
const ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB = 256;
const ANYDOC_LOCAL_EXTRACTION_ROUTE_DIRECTORY = path.join(
  'server', 'app', 'api', 'attachments', '[id]', 'local-extraction',
);
const APPLE_VISION_SCRIPT_FILE = 'apple-vision-ocr.swift';
const APPLE_VISION_SCRIPT_SHA256 = 'fb87dd9c0ca98a9ac68840c7c4c7517fec8199dbbd3dc1b3c93ad617d80dc314';
const APPLE_VISION_CANVAS_PACKAGE = '@napi-rs/canvas';
const APPLE_VISION_CANVAS_BACKEND = '@napi-rs/canvas-darwin-arm64';
const APPLE_VISION_CANVAS_VERSION = '0.1.100';
const APPLE_VISION_CANVAS_FILES = Object.freeze([
  'LICENSE', 'README.md', 'geometry.js', 'index.d.ts', 'index.js', 'js-binding.js',
  'load-image.js', 'node-canvas.d.ts', 'node-canvas.js', 'package.json',
]);
const APPLE_VISION_CANVAS_BACKEND_FILES = Object.freeze([
  'README.md', 'package.json', 'skia.darwin-arm64.node',
]);
const PDF_INSPECTOR_WORKER_FILE = 'pdf-inspector-worker.mjs';
const PDF_ROUTE_DIRECTORY = path.join('server', 'app', 'api', 'pdf-extract');
const PDF_RUNTIME_REFERENCE = /(?:pdf-inspector-worker\.mjs|pdf-inspector-router|(?:node_modules[\\/])?@firecrawl[\\/]pdf-inspector(?:[-/]|$))/i;
const SYNTHETIC_RTF = Buffer.from('{\\rtf1\\ansi Synthetic standalone note.}', 'utf8');
const WEB_AUTH_OWNER_PACKAGE = '@mediflow/web-auth-lifecycle-owner';
const WEB_AUTH_OWNER_VERSION = '0.8.6';
const WEB_AUTH_OWNER_KEYS = Object.freeze([
  'abort', 'abortAdminReset', 'abortResourceUse', 'abortUserRetirement', 'begin', 'beginResourceUse',
  'bootstrapControl', 'commitAdminReset', 'commitResourceUse', 'commitUserRetirement', 'issue',
  'mintResourcePort', 'prepareAdminReset', 'prepareUserRetirement', 'registerPrivateResource',
  'releaseResourcePort', 'resolve', 'retire', 'retireForUser',
  'unregisterPrivateResource', 'withCurrentResourceBinding',
]);
const WEB_AUTH_OWNER_FILES = Object.freeze([
  ['index.d.ts', '647385b9d57d2bd2309f70de08866d326736c200f2fce201e54857ec63da3987'],
  ['index.js', '1abc52ee8abe9fd25b28046f1f00ecc2f09d699ba220c61e6222730c22ca44c5'],
  ['internal/control-record.cjs', '3d443096679799ffde96e744060de5be59c9a86ddb383bdd975de75c913b9aa4'],
  ['internal/owner.cjs', 'f9d5e54e89a41788ecdf228841473a7210616fc054d9b3e3ded6316a91c94d2d'],
  ['internal/session-activation.cjs', '5ed4c9543f8bc15903c0915a8565b997d697d004e9ccfaaa54a3da6236a2aa96'],
  ['internal/session-cell.cjs', '4cd0c2e9f8b40b346d43a93de561e20e85c5662fc8a2f9a0a170403fc80c2e31'],
  ['internal/session-resolver.cjs', '75409d670b8411dbadcc95e4bd9bfebeff47d2f687bde0d638809bb9114b5fa0'],
  ['internal/session-resource.cjs', '127de77dfb73f91f313e5318fd64e838f3f5e3147e801e19b492e0876127d876'],
  ['internal/session-retirement.cjs', '8848c92cb88635c6c09baf685839e7c6f1aca40d667ea6580e84e275349f1516'],
  ['internal/support/successor-fence.cjs', '7e36178331d5f899d81d877603acb0100eef1436d1873287ad4b27ccc227e7ff'],
  ['internal/support/value.cjs', '9f0968a0290c6184c898f06de2c408540d4eda1ecd0e3e80ae013bb37a782be1'],
  ['package.json', '06f785441953621ac6b2fd6f313471f8bbd33bd730d1e603de94b45da382f99d'],
]);

/* @Codex: P12 proves that the externalized final owner is a physical standalone copy
   and that its process-local authority cannot survive an A-to-B runtime restart. */
const WEB_AUTH_OWNER_PROCESS_A = String.raw`
'use strict';
const owner = require(process.argv[1]);
const control = owner.bootstrapControl();
if (!control) throw new Error('control bootstrap denied');
const attempt = owner.begin('login', {
  controlId: control.controlId,
  ifMatch: control.etag,
  idempotencyKey: 'synthetic-idempotency-standalone-p12-a',
});
if (!attempt) throw new Error('synthetic login begin denied');
const issued = owner.issue(attempt, {
  id: 'user.synthetic.standalone-p12',
  username: 'synthetic-standalone-p12',
  role: 'clinician',
});
if (!issued) throw new Error('synthetic session issue denied');
if (owner.resolve(issued.sessionId, control.controlId).status !== 'active') {
  throw new Error('synthetic session was not active in process A');
}
process.stdout.write(JSON.stringify({ sessionId: issued.sessionId, controlId: control.controlId }));
`;
const WEB_AUTH_OWNER_PROCESS_B = String.raw`
'use strict';
const fs = require('node:fs');
const owner = require(process.argv[1]);
const locators = JSON.parse(fs.readFileSync(0, 'utf8'));
const resolution = owner.resolve(locators.sessionId, locators.controlId);
if (!resolution || resolution.status !== 'absent') {
  throw new Error('process B resolved authority created by process A');
}
process.stdout.write(resolution.status);
`;

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

/* @Codex: the PDF parser and renderer execute only through this digest-pinned,
   physically bundled child. A trace reference is required from the exact route. */
function bundledPdfPageWorkerFailure(standaloneDir) {
  const workerPath = path.join(standaloneDir, 'scripts', ANYDOC_PDF_PAGE_WORKER_FILE);
  try {
    const workerStat = fs.lstatSync(workerPath);
    if (!workerStat.isFile() || workerStat.isSymbolicLink()) {
      return 'Standalone PDF page worker is not a physical regular file.';
    }
    const root = fs.realpathSync(standaloneDir);
    const worker = fs.realpathSync(workerPath);
    const relative = path.relative(root, worker);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || !fs.statSync(worker).isFile()) {
      return 'Standalone runtime resolves the PDF page worker outside the bundle.';
    }
    if (createHash('sha256').update(fs.readFileSync(worker)).digest('hex') !== ANYDOC_PDF_PAGE_WORKER_SHA256) {
      return 'Standalone PDF page worker digest does not match the pinned child.';
    }
  } catch {
    return 'Standalone runtime does not contain the PDF page worker.';
  }
  return null;
}

function bundledPdfPageWorkerTraceFailure(standaloneDir) {
  const distDirectoryName = path.basename(path.dirname(standaloneDir));
  const routeDirectory = path.join(standaloneDir, distDirectoryName, ANYDOC_LOCAL_EXTRACTION_ROUTE_DIRECTORY);
  const routePath = path.join(routeDirectory, 'route.js');
  const tracePath = path.join(routeDirectory, 'route.js.nft.json');
  let trace;
  try {
    if (!fs.lstatSync(routePath).isFile() || !fs.lstatSync(tracePath).isFile()) {
      return 'Standalone AnyDoc route or trace is not a physical regular file.';
    }
    trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  } catch {
    return 'Standalone runtime does not contain a valid AnyDoc route trace.';
  }
  if (trace?.version !== 1 || !Array.isArray(trace.files)
      || trace.files.some((entry) => typeof entry !== 'string')) {
    return 'Standalone AnyDoc route trace has an invalid shape.';
  }
  const expectedWorker = path.resolve(standaloneDir, 'scripts', ANYDOC_PDF_PAGE_WORKER_FILE);
  if (!trace.files.some((entry) => path.resolve(routeDirectory, entry) === expectedWorker)) {
    return 'Standalone AnyDoc route trace does not reference the PDF page worker.';
  }
  return null;
}

function encodePdfChildFrame(header, bodies) {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(headerBytes.byteLength, 0);
  return Buffer.concat([prefix, headerBytes, ...bodies]);
}

function decodePdfChildFrame(output) {
  if (!Buffer.isBuffer(output) || output.byteLength < 5) return null;
  const headerLength = output.readUInt32BE(0);
  if (headerLength < 1 || headerLength > 64 * 1024 || output.byteLength < 4 + headerLength) return null;
  const headerText = output.subarray(4, 4 + headerLength).toString('utf8');
  let header;
  try { header = JSON.parse(headerText); } catch { return null; }
  if (JSON.stringify(header) !== headerText) return null;
  return { header, body: output.subarray(4 + headerLength) };
}

function syntheticPdfPage() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 3 >>\nstream\nq Q\nendstream',
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(parts.reduce((total, part) => total + part.byteLength, 0));
    parts.push(Buffer.from(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`));
  }
  const xrefOffset = parts.reduce((total, part) => total + part.byteLength, 0);
  const xref = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`xref\n0 5\n0000000000 65535 f \n${xref}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

function runPdfChild(workerPath, input, { allowAddons = false, args = [] } = {}) {
  const packageRoot = path.dirname(path.dirname(workerPath));
  const runtimeArguments = [
    `--max-old-space-size=${ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB}`,
    '--permission',
    '--disable-warning=SecurityWarning',
    `--allow-fs-read=${packageRoot}`,
    ...(allowAddons ? ['--allow-addons'] : []),
    workerPath,
    ...args,
  ];
  return spawnSync(process.execPath, runtimeArguments, {
    cwd: path.dirname(workerPath),
    env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
    input,
    encoding: 'buffer',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

function framedPdfPageWorkerSmokeFailure(workerPath) {
  const source = syntheticPdfPage();
  const materialize = runPdfChild(workerPath, encodePdfChildFrame({
    schemaVersion: ANYDOC_PDF_CHILD_SCHEMA_VERSION,
    operation: 'materialize',
    pageCount: 1,
    sourceByteLength: source.byteLength,
  }, [source]));
  if (materialize.error || materialize.status !== 0 || materialize.signal !== null
      || !Buffer.isBuffer(materialize.stderr) || materialize.stderr.byteLength !== 0) {
    return 'Standalone PDF page worker did not complete the framed materialization smoke.';
  }
  const materialized = decodePdfChildFrame(materialize.stdout);
  const page = materialized?.header?.pages?.[0];
  if (materialized?.header?.schemaVersion !== ANYDOC_PDF_CHILD_SCHEMA_VERSION
      || materialized.header.status !== 'materialized'
      || materialized.header.bodyByteLength !== materialized.body.byteLength
      || !Array.isArray(materialized.header.pages) || materialized.header.pages.length !== 1
      || page?.page !== 1 || page?.byteLength !== materialized.body.byteLength
      || materialized.body.byteLength < 1) {
    return 'Standalone PDF page worker emitted an invalid materialization frame.';
  }

  const render = runPdfChild(workerPath, encodePdfChildFrame({
    schemaVersion: ANYDOC_PDF_CHILD_SCHEMA_VERSION,
    operation: 'render',
    pages: [{ page: 1, byteLength: materialized.body.byteLength }],
    bodyByteLength: materialized.body.byteLength,
  }, [materialized.body]), { allowAddons: true });
  if (render.error || render.status !== 0 || render.signal !== null
      || !Buffer.isBuffer(render.stderr) || render.stderr.byteLength !== 0) {
    return 'Standalone PDF page worker did not complete the framed rendering smoke.';
  }
  const rendered = decodePdfChildFrame(render.stdout);
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return rendered?.header?.schemaVersion === ANYDOC_PDF_CHILD_SCHEMA_VERSION
      && rendered.header.status === 'error' && rendered.header.reason === 'engine_unavailable'
      && rendered.header.bodyByteLength === 0 && rendered.body.byteLength === 0
      ? null
      : 'Standalone PDF page worker did not fail closed on an unsupported rendering host.';
  }
  const raster = rendered?.header?.pages?.[0];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (rendered?.header?.schemaVersion !== ANYDOC_PDF_CHILD_SCHEMA_VERSION
      || rendered.header.status !== 'rendered'
      || rendered.header.bodyByteLength !== rendered.body.byteLength
      || !Array.isArray(rendered.header.pages) || rendered.header.pages.length !== 1
      || raster?.page !== 1 || raster?.byteLength !== rendered.body.byteLength
      || raster?.width !== 144 || raster?.height !== 72
      || !Number.isSafeInteger(raster?.durationMs) || raster.durationMs < 0
      || !rendered.body.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
    return 'Standalone PDF page worker emitted an invalid rendering frame.';
  }
  return null;
}

function bundledAppleVisionScriptFailure(standaloneDir) {
  const scriptPath = path.join(standaloneDir, 'scripts', APPLE_VISION_SCRIPT_FILE);
  try {
    if (!fs.lstatSync(scriptPath).isFile()) return 'Standalone Apple Vision OCR script is not a regular file.';
    const root = fs.realpathSync(standaloneDir);
    const script = fs.realpathSync(scriptPath);
    const relative = path.relative(root, script);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(script).isFile()) {
      return 'Standalone runtime resolves the Apple Vision OCR script outside the bundle.';
    }
    if (createHash('sha256').update(fs.readFileSync(script)).digest('hex') !== APPLE_VISION_SCRIPT_SHA256) {
      return 'Standalone Apple Vision OCR script digest does not match the packaged script.';
    }
  } catch {
    return 'Standalone runtime does not contain the Apple Vision OCR script.';
  }
  return null;
}

/* @Codex: OCR rasterization needs the exact physical N-API package pair in the
   standalone runtime. An exact roster also rejects accidental secret files. */
function standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return null;

  const packageDirectory = path.join(standaloneDir, 'node_modules', '@napi-rs', 'canvas');
  const backendDirectory = path.join(standaloneDir, 'node_modules', '@napi-rs', 'canvas-darwin-arm64');

  try {
    for (const [candidate, label] of [
      [path.join(standaloneDir, 'node_modules'), 'node_modules directory'],
      [path.join(standaloneDir, 'node_modules', '@napi-rs'), '@napi-rs scope directory'],
      [packageDirectory, `${APPLE_VISION_CANVAS_PACKAGE} package directory`],
      [backendDirectory, `${APPLE_VISION_CANVAS_BACKEND} package directory`],
    ]) {
      const stat = fs.lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return `Standalone runtime ${label} is not a physical directory.`;
      }
    }

    function exactPhysicalRoster(directory, expectedFiles, label) {
      const pending = [directory];
      const roster = [];
      while (pending.length > 0) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const candidate = path.join(current, entry.name);
          const stat = fs.lstatSync(candidate);
          if (stat.isSymbolicLink()) return `${label} contains a symbolic link.`;
          if (stat.isDirectory()) pending.push(candidate);
          else if (!stat.isFile()) return `${label} contains a non-file package entry.`;
          else roster.push(path.relative(directory, candidate).split(path.sep).join('/'));
        }
      }
      roster.sort();
      if (JSON.stringify(roster) !== JSON.stringify(expectedFiles)) {
        return `${label} does not match the exact pinned file roster.`;
      }
      return null;
    }

    const packageRosterFailure = exactPhysicalRoster(
      packageDirectory,
      APPLE_VISION_CANVAS_FILES,
      `Standalone runtime ${APPLE_VISION_CANVAS_PACKAGE}`,
    );
    if (packageRosterFailure) return packageRosterFailure;
    const backendRosterFailure = exactPhysicalRoster(
      backendDirectory,
      APPLE_VISION_CANVAS_BACKEND_FILES,
      `Standalone runtime ${APPLE_VISION_CANVAS_BACKEND}`,
    );
    if (backendRosterFailure) return backendRosterFailure;

    const packageManifestPath = path.join(packageDirectory, 'package.json');
    const backendManifestPath = path.join(backendDirectory, 'package.json');
    const packageManifest = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
    const backendManifest = JSON.parse(fs.readFileSync(backendManifestPath, 'utf8'));
    if (packageManifest?.name !== APPLE_VISION_CANVAS_PACKAGE
        || packageManifest?.version !== APPLE_VISION_CANVAS_VERSION
        || packageManifest?.main !== 'index.js'
        || packageManifest?.optionalDependencies?.[APPLE_VISION_CANVAS_BACKEND] !== APPLE_VISION_CANVAS_VERSION) {
      return `Standalone runtime does not contain pinned ${APPLE_VISION_CANVAS_PACKAGE} ${APPLE_VISION_CANVAS_VERSION}.`;
    }
    if (backendManifest?.name !== APPLE_VISION_CANVAS_BACKEND
        || backendManifest?.version !== APPLE_VISION_CANVAS_VERSION
        || backendManifest?.main !== 'skia.darwin-arm64.node'
        || JSON.stringify(backendManifest?.cpu) !== '["arm64"]'
        || JSON.stringify(backendManifest?.os) !== '["darwin"]') {
      return `Standalone runtime does not contain pinned ${APPLE_VISION_CANVAS_BACKEND} ${APPLE_VISION_CANVAS_VERSION}.`;
    }

    for (const [request, expectedPath] of [
      [`${APPLE_VISION_CANVAS_PACKAGE}/package.json`, packageManifestPath],
      [`${APPLE_VISION_CANVAS_BACKEND}/package.json`, backendManifestPath],
      [APPLE_VISION_CANVAS_PACKAGE, path.join(packageDirectory, 'index.js')],
    ]) {
      if (fs.realpathSync(requireFromStandalone.resolve(request)) !== fs.realpathSync(expectedPath)) {
        return `Standalone runtime did not resolve ${request} from its physical copy.`;
      }
    }

    const nativePath = path.join(backendDirectory, 'skia.darwin-arm64.node');
    const nativeStat = fs.lstatSync(nativePath);
    if (!nativeStat.isFile() || nativeStat.isSymbolicLink()) {
      return `Standalone runtime ${APPLE_VISION_CANVAS_BACKEND} native binding is not a physical regular file.`;
    }
    const canvas = requireFromStandalone(APPLE_VISION_CANVAS_PACKAGE);
    if (typeof canvas?.createCanvas !== 'function') {
      return `Standalone runtime ${APPLE_VISION_CANVAS_PACKAGE} cannot load its pinned native backend.`;
    }
    canvas.createCanvas(1, 1).toBuffer('image/png');
  } catch (error) {
    return `Standalone runtime cannot inspect Apple Vision canvas dependencies: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

function standalonePdfChildDependenciesFailure(standaloneDir, requireFromStandalone) {
  try {
    const pdfLibEntry = requireFromStandalone.resolve('pdf-lib');
    const pdfLibManifest = requireFromStandalone.resolve('pdf-lib/package.json');
    const pdfJsEntry = requireFromStandalone.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfJsManifest = requireFromStandalone.resolve('pdfjs-dist/package.json');
    const requireFromPdfLib = createRequire(pdfLibEntry);
    const standardFontsEntry = requireFromPdfLib.resolve('@pdf-lib/standard-fonts');
    const upngEntry = requireFromPdfLib.resolve('@pdf-lib/upng');
    const runtimeEntries = [
      pdfLibEntry,
      pdfLibManifest,
      pdfJsEntry,
      pdfJsManifest,
      standardFontsEntry,
      upngEntry,
      requireFromPdfLib.resolve('pako'),
      requireFromPdfLib.resolve('tslib'),
      createRequire(standardFontsEntry).resolve('pako'),
      createRequire(upngEntry).resolve('pako'),
    ];
    const root = fs.realpathSync(standaloneDir);
    for (const entry of runtimeEntries) {
      const stat = fs.lstatSync(entry);
      const realEntry = fs.realpathSync(entry);
      const relative = path.relative(root, realEntry);
      if (!stat.isFile() || stat.isSymbolicLink() || !relative
          || relative.startsWith('..') || path.isAbsolute(relative)
          || !fs.statSync(realEntry).isFile()) {
        return 'Standalone PDF child dependency resolved outside its physical bundle copy.';
      }
    }
    const pdfLib = JSON.parse(fs.readFileSync(pdfLibManifest, 'utf8'));
    const pdfJs = JSON.parse(fs.readFileSync(pdfJsManifest, 'utf8'));
    if (pdfLib?.name !== 'pdf-lib' || pdfLib?.version !== '1.17.1'
        || pdfJs?.name !== 'pdfjs-dist' || pdfJs?.version !== '4.10.38') {
      return 'Standalone PDF child dependency versions do not match the pinned runtime.';
    }
  } catch {
    return 'Standalone runtime does not contain the complete PDF child dependency closure.';
  }
  return null;
}

function retiredPdfRuntimeFailure(standaloneDir) {
  const pending = [standaloneDir];
  const visited = new Set();
  while (pending.length > 0) {
    const directory = pending.pop();
    const realDirectory = fs.realpathSync(directory);
    if (visited.has(realDirectory)) continue;
    visited.add(realDirectory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(standaloneDir, absolute);
      if (PDF_RUNTIME_REFERENCE.test(relative)) {
        return 'Standalone runtime contains retired PDF inspector code.';
      }
      if (entry.name === 'package.json' && (entry.isFile() || entry.isSymbolicLink())) {
        try {
          const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
          if (typeof manifest?.name === 'string' && /^@firecrawl\/pdf-inspector(?:-|$)/iu.test(manifest.name)) {
            return 'Standalone runtime contains a renamed retired PDF inspector package.';
          }
          if (typeof manifest?.resolved === 'string' && PDF_RUNTIME_REFERENCE.test(manifest.resolved)) {
            return 'Standalone runtime contains retired PDF inspector package provenance.';
          }
        } catch {
          // Other package validation remains owned by its runtime gate.
        }
      }
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(absolute).isDirectory())) pending.push(absolute);
    }
  }

  const distDirectoryName = path.basename(path.dirname(standaloneDir));
  const routeDirectory = path.join(standaloneDir, distDirectoryName, PDF_ROUTE_DIRECTORY);
  const routePath = path.join(routeDirectory, 'route.js');
  const tracePath = path.join(routeDirectory, 'route.js.nft.json');
  let routeSource;
  let traceSource;
  try {
    if (!fs.lstatSync(routePath).isFile() || !fs.lstatSync(tracePath).isFile()) {
      return 'Standalone runtime retired PDF route or trace is not a regular file.';
    }
    routeSource = fs.readFileSync(routePath, 'utf8');
    traceSource = fs.readFileSync(tracePath, 'utf8');
  } catch {
    return 'Standalone runtime does not contain the retired PDF route and trace.';
  }

  let trace;
  try {
    trace = JSON.parse(traceSource);
  } catch {
    return 'Standalone runtime retired PDF route trace is invalid JSON.';
  }
  if (trace?.version !== 1 || !Array.isArray(trace.files)
      || trace.files.some((entry) => typeof entry !== 'string')) {
    return 'Standalone runtime retired PDF route trace has an invalid shape.';
  }
  if (PDF_RUNTIME_REFERENCE.test(routeSource) || trace.files.some((entry) => PDF_RUNTIME_REFERENCE.test(entry))) {
    return 'Standalone runtime retired PDF route still references executable PDF inspector code.';
  }
  return null;
}

function standaloneWebAuthOwnerInspection(standaloneDir, requireFromStandalone) {
  const nodeModulesDirectory = path.join(standaloneDir, 'node_modules');
  const scopeDirectory = path.join(nodeModulesDirectory, '@mediflow');
  const packageDirectory = path.join(scopeDirectory, 'web-auth-lifecycle-owner');
  const expectedEntry = path.join(packageDirectory, 'index.js');
  const manifestPath = path.join(packageDirectory, 'package.json');

  try {
    for (const [candidate, label] of [
      [nodeModulesDirectory, 'node_modules directory'],
      [scopeDirectory, '@mediflow scope directory'],
      [packageDirectory, `${WEB_AUTH_OWNER_PACKAGE} package directory`],
    ]) {
      const stat = fs.lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return { failure: `Standalone runtime ${label} is not a physical directory.` };
      }
    }

    const realStandalone = fs.realpathSync(standaloneDir);
    const realPackage = fs.realpathSync(packageDirectory);
    const expectedRealPackage = path.join(realStandalone, 'node_modules', '@mediflow', 'web-auth-lifecycle-owner');
    if (realPackage !== expectedRealPackage) {
      return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} resolves outside its physical package directory.` };
    }

    const pending = [packageDirectory];
    const roster = [];
    while (pending.length > 0) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
          return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} contains a symbolic link.` };
        }
        if (stat.isDirectory()) pending.push(candidate);
        else if (!stat.isFile()) {
          return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} contains a non-file package entry.` };
        } else {
          roster.push([
            path.relative(packageDirectory, candidate).split(path.sep).join('/'),
            createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),
          ]);
        }
      }
    }
    roster.sort(([left], [right]) => left.localeCompare(right));

    const manifestStat = fs.lstatSync(manifestPath);
    const entryStat = fs.lstatSync(expectedEntry);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()
        || !entryStat.isFile() || entryStat.isSymbolicLink()) {
      return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} root files are not physical regular files.` };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest?.name !== WEB_AUTH_OWNER_PACKAGE || manifest?.version !== WEB_AUTH_OWNER_VERSION
        || manifest?.main !== './index.js' || manifest?.exports !== './index.js') {
      return { failure: `Standalone runtime does not contain the final ${WEB_AUTH_OWNER_PACKAGE} ${WEB_AUTH_OWNER_VERSION} manifest.` };
    }
    if (JSON.stringify(roster) !== JSON.stringify(WEB_AUTH_OWNER_FILES)) {
      return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} does not match the exact final file roster.` };
    }

    const resolvedEntry = requireFromStandalone.resolve(WEB_AUTH_OWNER_PACKAGE);
    if (fs.realpathSync(resolvedEntry) !== fs.realpathSync(expectedEntry)) {
      return { failure: `Standalone runtime did not resolve ${WEB_AUTH_OWNER_PACKAGE} from its physical copy.` };
    }

    const owner = requireFromStandalone(WEB_AUTH_OWNER_PACKAGE);
    const keys = Reflect.ownKeys(owner).slice().sort();
    if (!Object.isFrozen(owner) || keys.length !== WEB_AUTH_OWNER_KEYS.length
        || keys.some((key, index) => key !== WEB_AUTH_OWNER_KEYS[index])
        || WEB_AUTH_OWNER_KEYS.some((key) => typeof owner[key] !== 'function')
        || Reflect.has(owner, 'createOwner')) {
      return { failure: `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} root is not the frozen exact 21-function API.` };
    }

    return { failure: null, entryPath: expectedEntry };
  } catch (error) {
    return {
      failure: `Standalone runtime cannot inspect ${WEB_AUTH_OWNER_PACKAGE}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function webAuthOwnerRestartFailure(entryPath) {
  const childEnvironment = {
    MEDIFLOW_SESSION_TTL_MS: '60000',
    NODE_ENV: 'production',
    NODE_OPTIONS: '',
    NO_COLOR: '1',
  };
  const commonOptions = {
    cwd: path.dirname(path.dirname(path.dirname(path.dirname(entryPath)))),
    encoding: 'utf8',
    env: childEnvironment,
    timeout: 10_000,
    windowsHide: true,
  };
  const processA = spawnSync(process.execPath, ['-e', WEB_AUTH_OWNER_PROCESS_A, entryPath], commonOptions);
  if (processA.error || processA.status !== 0 || processA.signal !== null || processA.stderr !== '') {
    return `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} process A could not create a synthetic session.`;
  }

  let locators;
  try {
    locators = JSON.parse(processA.stdout);
  } catch {
    return `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} process A emitted invalid locators.`;
  }
  if (!locators || Object.getPrototypeOf(locators) !== Object.prototype
      || Object.keys(locators).join(',') !== 'sessionId,controlId'
      || !/^[0-9a-f]{64}$/u.test(locators.sessionId)
      || !/^[0-9a-f]{64}$/u.test(locators.controlId)) {
    return `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} process A emitted data other than exact synthetic locators.`;
  }

  const processB = spawnSync(process.execPath, ['-e', WEB_AUTH_OWNER_PROCESS_B, entryPath], {
    ...commonOptions,
    input: processA.stdout,
  });
  if (processB.error || processB.status !== 0 || processB.signal !== null
      || processB.stderr !== '' || processB.stdout !== 'absent') {
    return `Standalone runtime ${WEB_AUTH_OWNER_PACKAGE} process B did not deny process A authority as absent.`;
  }
  return null;
}

function runWebAuthOwnerSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-auth-owner-checker-'));
  const standaloneDir = path.join(root, 'standalone');
  const serverPath = path.join(standaloneDir, 'server.js');
  const installedPackage = path.join(process.cwd(), 'node_modules', '@mediflow', 'web-auth-lifecycle-owner');
  const copiedPackage = path.join(standaloneDir, 'node_modules', '@mediflow', 'web-auth-lifecycle-owner');
  try {
    fs.mkdirSync(path.dirname(copiedPackage), { recursive: true });
    fs.cpSync(installedPackage, copiedPackage, { recursive: true, dereference: false });
    fs.writeFileSync(serverPath, "'use strict';\n");
    const requireFromStandalone = createRequire(serverPath);
    const inspection = standaloneWebAuthOwnerInspection(standaloneDir, requireFromStandalone);
    if (inspection.failure || !inspection.entryPath) throw new Error(inspection.failure ?? 'missing entry path');
    const restartFailure = webAuthOwnerRestartFailure(inspection.entryPath);
    if (restartFailure) throw new Error(restartFailure);

    const manifestPath = path.join(copiedPackage, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entryPath = path.join(copiedPackage, 'index.js');
    fs.appendFileSync(entryPath, '\n// synthetic roster drift\n');
    const rosterMismatch = standaloneWebAuthOwnerInspection(standaloneDir, requireFromStandalone).failure;
    if (!rosterMismatch?.includes('exact final file roster')) throw new Error('roster mismatch passed');
    fs.copyFileSync(path.join(installedPackage, 'index.js'), entryPath);
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: '0.8.4' }, null, 2)}\n`);
    const mismatch = standaloneWebAuthOwnerInspection(standaloneDir, requireFromStandalone).failure;
    if (!mismatch?.includes(WEB_AUTH_OWNER_VERSION)) throw new Error('version mismatch passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-checker-self-test-'));
  const scriptsDir = path.join(root, 'scripts');
  const workerPath = path.join(scriptsDir, ANYDOC_WORKER_FILE);
  const sourceWorker = path.join(process.cwd(), 'scripts', ANYDOC_WORKER_FILE);
  const visionPath = path.join(scriptsDir, APPLE_VISION_SCRIPT_FILE);
  const sourceVision = path.join(process.cwd(), 'scripts', APPLE_VISION_SCRIPT_FILE);
  try {
    fs.mkdirSync(scriptsDir);
    fs.copyFileSync(sourceWorker, workerPath);
    if (bundledWorkerFailure(root) !== null) throw new Error('expected bundled AnyDoc worker to pass');
    fs.rmSync(workerPath);
    if (bundledWorkerFailure(root) === null) throw new Error('missing bundled AnyDoc worker passed');
    fs.copyFileSync(sourceWorker, workerPath);
    fs.appendFileSync(workerPath, '\n// self-test tamper\n');
    if (bundledWorkerFailure(root) === null) throw new Error('tampered bundled AnyDoc worker passed');
    fs.copyFileSync(sourceVision, visionPath);
    if (bundledAppleVisionScriptFailure(root) !== null) throw new Error('expected bundled Apple Vision OCR script to pass');
    fs.appendFileSync(visionPath, '\n// self-test tamper\n');
    if (bundledAppleVisionScriptFailure(root) === null) throw new Error('tampered Apple Vision OCR script passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runPdfPageWorkerSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pdf-page-worker-checker-'));
  const standaloneDir = path.join(root, '.next-self-test', 'standalone');
  const scriptsDir = path.join(standaloneDir, 'scripts');
  const workerPath = path.join(scriptsDir, ANYDOC_PDF_PAGE_WORKER_FILE);
  const sourceWorker = path.join(process.cwd(), 'scripts', ANYDOC_PDF_PAGE_WORKER_FILE);
  const routeDirectory = path.join(
    standaloneDir,
    '.next-self-test',
    ANYDOC_LOCAL_EXTRACTION_ROUTE_DIRECTORY,
  );
  const routePath = path.join(routeDirectory, 'route.js');
  const tracePath = path.join(routeDirectory, 'route.js.nft.json');

  function writeValidTrace() {
    const relativeWorker = path.relative(routeDirectory, workerPath).split(path.sep).join('/');
    fs.writeFileSync(tracePath, `${JSON.stringify({ version: 1, files: [relativeWorker] })}\n`);
  }

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(routeDirectory, { recursive: true });
    fs.writeFileSync(routePath, "'use strict';\n");
    fs.copyFileSync(sourceWorker, workerPath);
    writeValidTrace();
    if (bundledPdfPageWorkerFailure(standaloneDir) !== null) {
      throw new Error('expected the pinned PDF page worker to pass');
    }
    if (bundledPdfPageWorkerTraceFailure(standaloneDir) !== null) {
      throw new Error('expected the AnyDoc route trace to reference the PDF page worker');
    }
    const smokeFailure = framedPdfPageWorkerSmokeFailure(sourceWorker);
    if (smokeFailure) throw new Error(smokeFailure);

    fs.rmSync(workerPath);
    if (!bundledPdfPageWorkerFailure(standaloneDir)?.includes('does not contain')) {
      throw new Error('missing PDF page worker passed');
    }
    fs.copyFileSync(sourceWorker, workerPath);
    fs.appendFileSync(workerPath, '\n// synthetic digest drift\n');
    if (!bundledPdfPageWorkerFailure(standaloneDir)?.includes('digest')) {
      throw new Error('tampered PDF page worker passed');
    }
    fs.rmSync(workerPath);
    fs.symlinkSync(sourceWorker, workerPath, process.platform === 'win32' ? 'file' : undefined);
    if (!bundledPdfPageWorkerFailure(standaloneDir)?.includes('physical regular file')) {
      throw new Error('symlinked PDF page worker passed');
    }
    fs.rmSync(workerPath);
    fs.copyFileSync(sourceWorker, workerPath);
    fs.writeFileSync(tracePath, '{"version":1,"files":[]}\n');
    if (!bundledPdfPageWorkerTraceFailure(standaloneDir)?.includes('does not reference')) {
      throw new Error('missing AnyDoc route trace reference passed');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runAppleVisionCanvasSelfTest() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-apple-vision-canvas-checker-'));
  const standaloneDir = path.join(root, 'standalone');
  const serverPath = path.join(standaloneDir, 'server.js');
  const installedScope = path.join(process.cwd(), 'node_modules', '@napi-rs');
  const copiedScope = path.join(standaloneDir, 'node_modules', '@napi-rs');
  const copiedPackage = path.join(copiedScope, 'canvas');
  const copiedBackend = path.join(copiedScope, 'canvas-darwin-arm64');
  try {
    fs.mkdirSync(copiedScope, { recursive: true });
    fs.cpSync(path.join(installedScope, 'canvas'), copiedPackage, { recursive: true, dereference: false });
    fs.cpSync(path.join(installedScope, 'canvas-darwin-arm64'), copiedBackend, { recursive: true, dereference: false });
    fs.writeFileSync(serverPath, "'use strict';\n");
    const requireFromStandalone = createRequire(serverPath);
    if (standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone) !== null) {
      throw new Error('expected pinned Apple Vision canvas packages to pass');
    }

    const unexpectedSecret = path.join(copiedPackage, '.env');
    fs.writeFileSync(unexpectedSecret, 'SYNTHETIC_SECRET_MUST_NOT_SHIP=1\n');
    if (!standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone)?.includes('exact pinned file roster')) {
      throw new Error('unexpected package file passed');
    }
    fs.rmSync(unexpectedSecret);

    const copiedEntry = path.join(copiedPackage, 'index.js');
    fs.rmSync(copiedEntry);
    fs.symlinkSync(path.join(installedScope, 'canvas', 'index.js'), copiedEntry);
    if (!standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone)?.includes('symbolic link')) {
      throw new Error('symlinked package file passed');
    }
    fs.rmSync(copiedEntry);
    fs.copyFileSync(path.join(installedScope, 'canvas', 'index.js'), copiedEntry);

    const backendManifestPath = path.join(copiedBackend, 'package.json');
    const backendManifest = JSON.parse(fs.readFileSync(backendManifestPath, 'utf8'));
    fs.writeFileSync(backendManifestPath, `${JSON.stringify({ ...backendManifest, version: '0.1.99' }, null, 2)}\n`);
    if (!standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone)?.includes(APPLE_VISION_CANVAS_VERSION)) {
      throw new Error('backend version drift passed');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runPdfRetirementSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pdf-retirement-checker-'));
  const standaloneDir = path.join(root, '.next-self-test', 'standalone');
  const routeDirectory = path.join(standaloneDir, '.next-self-test', PDF_ROUTE_DIRECTORY);
  const workerPath = path.join(standaloneDir, 'scripts', PDF_INSPECTOR_WORKER_FILE);
  const packageRoot = path.join(standaloneDir, 'node_modules', '@firecrawl');

  function reset() {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(routeDirectory, { recursive: true });
    fs.writeFileSync(path.join(routeDirectory, 'route.js'), 'export {};\n');
    fs.writeFileSync(path.join(routeDirectory, 'route.js.nft.json'), '{"version":1,"files":["./route_client-reference-manifest.js"]}\n');
  }

  function expectFailure(label, mutate) {
    reset();
    mutate();
    if (retiredPdfRuntimeFailure(standaloneDir) === null) throw new Error(`${label} passed`);
  }

  try {
    reset();
    if (retiredPdfRuntimeFailure(standaloneDir) !== null) throw new Error('valid retired PDF bundle failed');
    expectFailure('retired PDF worker file', () => {
      fs.mkdirSync(path.dirname(workerPath), { recursive: true });
      fs.writeFileSync(workerPath, 'retired worker');
    });
    expectFailure('retired PDF worker symlink', () => {
      const target = path.join(root, 'retired-worker-target');
      fs.mkdirSync(target);
      fs.mkdirSync(path.dirname(workerPath), { recursive: true });
      fs.symlinkSync(target, workerPath, process.platform === 'win32' ? 'junction' : 'dir');
    });
    expectFailure('retired PDF package', () => fs.mkdirSync(path.join(packageRoot, 'pdf-inspector'), { recursive: true }));
    expectFailure('retired PDF native package', () => fs.mkdirSync(path.join(packageRoot, 'pdf-inspector-darwin-arm64'), { recursive: true }));
    expectFailure('renamed retired PDF package', () => {
      const renamed = path.join(standaloneDir, 'node_modules', 'renamed-parser');
      fs.mkdirSync(renamed, { recursive: true });
      fs.writeFileSync(path.join(renamed, 'package.json'), '{"name":"@firecrawl/pdf-inspector"}');
    });
    expectFailure('renamed retired PDF native package', () => {
      const renamed = path.join(standaloneDir, 'node_modules', 'renamed-native');
      fs.mkdirSync(renamed, { recursive: true });
      fs.writeFileSync(path.join(renamed, 'package.json'), '{"name":"@firecrawl/pdf-inspector-darwin-arm64"}');
      fs.writeFileSync(path.join(renamed, 'renamed.node'), 'synthetic native');
    });
    expectFailure('symlinked renamed retired PDF package', () => {
      const target = path.join(root, 'renamed-package-target');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'package.json'), '{"name":"@firecrawl/pdf-inspector"}');
      const renamed = path.join(standaloneDir, 'node_modules', 'renamed-parser');
      fs.mkdirSync(path.dirname(renamed), { recursive: true });
      fs.symlinkSync(target, renamed, process.platform === 'win32' ? 'junction' : 'dir');
    });
    expectFailure('retired PDF router', () => {
      const router = path.join(standaloneDir, 'server', 'chunks', 'pdf-inspector-router.js');
      fs.mkdirSync(path.dirname(router), { recursive: true });
      fs.writeFileSync(router, 'export {};\n');
    });
    expectFailure('missing retired route trace', () => fs.rmSync(path.join(routeDirectory, 'route.js.nft.json')));
    expectFailure('invalid retired route trace', () => fs.writeFileSync(path.join(routeDirectory, 'route.js.nft.json'), '{'));
    expectFailure('invalid retired route trace shape', () => fs.writeFileSync(path.join(routeDirectory, 'route.js.nft.json'), '{"version":2,"files":[]}'));
    expectFailure('PDF inspector trace reference', () => fs.writeFileSync(
      path.join(routeDirectory, 'route.js.nft.json'),
      '{"version":1,"files":["../../node_modules/@firecrawl/pdf-inspector/index.js"]}',
    ));
    expectFailure('PDF worker compiled reference', () => fs.appendFileSync(
      path.join(routeDirectory, 'route.js'),
      'import("../../../../../scripts/pdf-inspector-worker.mjs");\n',
    ));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--self-test') {
  runSelfTest();
  process.exit(0);
}
if (process.argv[2] === '--self-test=pdf-retirement') {
  runPdfRetirementSelfTest();
  process.exit(0);
}
if (process.argv[2] === '--self-test=web-auth-owner') {
  runWebAuthOwnerSelfTest();
  process.exit(0);
}
if (process.argv[2] === '--self-test=apple-vision-canvas') {
  runAppleVisionCanvasSelfTest();
  process.exit(0);
}
if (process.argv[2] === '--self-test=pdf-page-worker') {
  runPdfPageWorkerSelfTest();
  process.exit(0);
}

const root = process.cwd();
const standaloneDir = standaloneDirectory(root);
const serverPath = path.join(standaloneDir, 'server.js');
const runtimeContractPath = path.join(standaloneDir, 'mediflow-runtime-contract.json');

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

const retiredPdfFailure = retiredPdfRuntimeFailure(standaloneDir);
if (retiredPdfFailure) fail(retiredPdfFailure);

const webAuthOwnerInspection = standaloneWebAuthOwnerInspection(standaloneDir, requireFromStandalone);
if (webAuthOwnerInspection.failure || !webAuthOwnerInspection.entryPath) {
  fail(webAuthOwnerInspection.failure ?? `Standalone runtime cannot resolve ${WEB_AUTH_OWNER_PACKAGE}.`);
}
const webAuthOwnerRestart = webAuthOwnerRestartFailure(webAuthOwnerInspection.entryPath);
if (webAuthOwnerRestart) fail(webAuthOwnerRestart);
const appleVisionCanvasFailure = standaloneAppleVisionCanvasFailure(standaloneDir, requireFromStandalone);
if (appleVisionCanvasFailure) fail(appleVisionCanvasFailure);
const pdfChildDependenciesFailure = standalonePdfChildDependenciesFailure(standaloneDir, requireFromStandalone);
if (pdfChildDependenciesFailure) fail(pdfChildDependenciesFailure);
const pdfPageWorkerFailure = bundledPdfPageWorkerFailure(standaloneDir);
if (pdfPageWorkerFailure) fail(pdfPageWorkerFailure);
const pdfPageWorkerTraceFailure = bundledPdfPageWorkerTraceFailure(standaloneDir);
if (pdfPageWorkerTraceFailure) fail(pdfPageWorkerTraceFailure);
const pdfPageWorkerSmokeFailure = framedPdfPageWorkerSmokeFailure(
  path.join(standaloneDir, 'scripts', ANYDOC_PDF_PAGE_WORKER_FILE),
);
if (pdfPageWorkerSmokeFailure) fail(pdfPageWorkerSmokeFailure);

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
const appleVisionScriptFailure = bundledAppleVisionScriptFailure(standaloneDir);
if (appleVisionScriptFailure) fail(appleVisionScriptFailure);
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
