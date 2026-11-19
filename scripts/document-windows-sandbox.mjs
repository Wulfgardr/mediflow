import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bootstrap = 'scripts/document-windows-sandbox/launcher-x64.exe';

const documentAssets = [
  'lib/pdf-raster-preflight.mjs',
  'scripts/anydoc-local-extraction-worker.mjs',
  'scripts/anydoc-pdf-page-worker.mjs',
  'scripts/document-child-network-guard.mjs',
  'scripts/anydoc-pdf-renderer-profiles.json',
  'scripts/anydoc-tesseract-artifacts.json',
  'node_modules/@firecrawl/anydoc',
  'node_modules/@firecrawl/anydoc-win32-x64-msvc',
  'node_modules/@napi-rs/canvas',
  'node_modules/@napi-rs/canvas-win32-x64-msvc',
  'node_modules/@pdf-lib/standard-fonts',
  'node_modules/@pdf-lib/upng',
  'node_modules/pako',
  'node_modules/tslib',
  'node_modules/pdf-lib',
  'node_modules/pdfjs-dist/package.json',
  'node_modules/pdfjs-dist/legacy/build',
  'node_modules/pdfjs-dist/standard_fonts',
  'node_modules/mediflow-ocr-tesseract',
];

function physicalEntry(file) {
  const stat = fs.lstatSync(file);
  return !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile())
    && fs.realpathSync.native(file).toLowerCase() === file.toLowerCase();
}

function quoteWindowsArgument(value) {
  return '"' + value.replace(/(\\*)"/gu, '$1$1\\"').replace(/\\+$/u, '$&$&') + '"';
}

export function stageWindowsDocumentChild(root) {
  const command = path.join(root, bootstrap);
  if (process.arch !== 'x64' || !fs.existsSync(command) || !physicalEntry(command) || !fs.statSync(command).isFile()
      || createHash('sha256').update(fs.readFileSync(command)).digest('hex') !== '5c724a330e2ab1e7d601af362a89490cb39794a043adb6f0a7f24a62bff08117') {
    throw new Error('Windows document sandbox unavailable.');
  }
  const temp = fs.realpathSync.native(os.tmpdir());
  const stage = fs.mkdtempSync(path.join(temp, 'mediflow-document-'));
  const cleanup = () => {
    try {
      fs.rmSync(stage, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      return true;
    } catch { return false; }
  };
  const node = path.join(stage, 'node.exe');
  try {
    fs.copyFileSync(process.execPath, node, fs.constants.COPYFILE_EXCL);
    for (const relative of documentAssets) {
      const source = path.join(root, relative);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, path.join(stage, relative), {
        recursive: true, force: false, errorOnExist: true,
        filter: entry => {
          if (!physicalEntry(entry)) throw new Error('Windows document sandbox asset is not physical.');
          return true;
        },
      });
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  const profile = 'MediFlow.Document.' + randomUUID().replaceAll('-', '');
  return {
    root: stage,
    cleanup,
    launch: nodeArgs => ({
      command,
      args: [profile, stage, node, [node, ...nodeArgs].map(quoteWindowsArgument).join(' ')],
      cleanup,
    }),
  };
}
