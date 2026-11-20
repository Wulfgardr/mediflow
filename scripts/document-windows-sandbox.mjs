import { spawnSync } from 'node:child_process';
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

export function stageWindowsDocumentChild(root, env) {
  const command = path.join(root, bootstrap);
  if (process.arch !== 'x64' || !fs.existsSync(command) || !physicalEntry(command) || !fs.statSync(command).isFile()
      || createHash('sha256').update(fs.readFileSync(command)).digest('hex') !== '8f103266ab99c957cd0b228160b5bc3ac0d0bb97a785e36edde58c6ae31a68d0') {
    throw new Error('Windows document sandbox unavailable.');
  }
  const temp = fs.realpathSync.native(os.tmpdir());
  const stage = fs.mkdtempSync(path.join(temp, 'mediflow-document-'));
  const profile = 'MediFlow.Document.' + randomUUID().replaceAll('-', '');
  let profileMayExist = false;
  const cleanup = () => {
    let stageRemoved = false;
    try {
      fs.rmSync(stage, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      stageRemoved = true;
    } catch {}
    if (profileMayExist) {
      const removal = spawnSync(command, ['--delete-profile', profile], {
        env, stdio: 'ignore', windowsHide: true, timeout: 5000,
      });
      profileMayExist = removal.error !== undefined || removal.status !== 0;
    }
    return stageRemoved && !profileMayExist;
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
  return {
    root: stage,
    launch: nodeArgs => {
      profileMayExist = true;
      return {
        command,
        args: [profile, stage, node, [node, ...nodeArgs].map(quoteWindowsArgument).join(' ')],
        cleanup,
      };
    },
  };
}
