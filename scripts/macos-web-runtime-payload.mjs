import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = Object.freeze([
  'scripts/anydoc-pdf-page-worker.mjs',
  'node_modules/pdf-lib/package.json',
  'node_modules/pdfjs-dist/package.json',
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  'node_modules/@napi-rs/canvas/package.json',
  'node_modules/@napi-rs/canvas-darwin-{arch}/package.json',
  'node_modules/@firecrawl/anydoc/index.js',
  'node_modules/@napi-rs/canvas/js-binding.js',
  'node_modules/@img/sharp-darwin-{arch}/index.cjs',
  'node_modules/better-sqlite3/lib/database.js',
]);

export function macosWebRuntimeRequiredFiles(arch) {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported macOS WebRuntime architecture: ${arch}`);
  return REQUIRED_FILES.map((file) => file.replace('{arch}', arch));
}

function isContainedFile(root, relative) {
  try {
    const real = fs.realpathSync(path.join(root, relative));
    return real.startsWith(root + path.sep) && fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

export function macosWebRuntimePayloadFailure(standaloneDir, platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin') return null;
  const root = fs.realpathSync(standaloneDir);
  const missing = macosWebRuntimeRequiredFiles(arch).filter((relative) => !isContainedFile(root, relative));
  if (missing.length === 0) return null;
  return 'Standalone runtime lacks files that scripts/check-macos-web-runtime-native-payload.sh requires in MediFlow.app: '
    + `${missing.join(', ')}. Trace them into the standalone build (next.config.ts) or drop them from scripts/macos-web-runtime-payload.mjs.`;
}
