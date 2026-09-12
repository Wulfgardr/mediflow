/* @Codex — synthetic test data only; never imported by production code. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const testLoader = path.join(repositoryRoot, 'scripts/fixtures/mac-packaging-test-loader.mjs');
export const assetParts = ['resources', 'chatgpt-execution', 'mac', 'codex-0.153.4'];
export const helperParts = ['Helpers'];
export const syntheticFiles = Object.freeze({
  codex: Buffer.concat([Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from('SYNTHETIC PACKAGING ONLY\n')]),
  'mac-owner.c': Buffer.from('/* synthetic native source, never compiled */\n'),
  'C1-RECEIPT.json': Buffer.from('{"synthetic":"C1 receipt, not qualification"}\n'),
  'schema/config.schema.json': Buffer.from('{"synthetic":"input schema"}\n'),
  'schema/RECEIPT.json': Buffer.from('{"synthetic":"schema receipt"}\n'),
  'schema/config-loader-mod.rs': Buffer.from('// synthetic loader source\n'),
  'schema/LOADER-RECEIPT.json': Buffer.from('{"synthetic":"loader receipt"}\n'),
});
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function write(file, bytes, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { mode });
  return file;
}
export function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-packaging-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const installationRoot = path.join(directory, 'standalone');
  fs.mkdirSync(installationRoot);
  write(path.join(installationRoot, 'server.js'), '// synthetic server, never started\n');
  const source = path.join(directory, 'public-input');
  for (const [name, bytes] of Object.entries(syntheticFiles)) write(path.join(source, name), bytes, name === 'codex' ? 0o755 : 0o644);
  return { directory, installationRoot, source, binary: path.join(source, 'codex'), nativeSource: path.join(source, 'mac-owner.c'),
    schemaDirectory: path.join(source, 'schema'), c1Receipt: path.join(source, 'C1-RECEIPT.json') };
}
export function appRoot(directory, name = 'MediFlow.app') {
  const contents = path.join(directory, name, 'Contents');
  write(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>MediFlow</string></dict></plist>\n');
  write(path.join(contents, 'MacOS/MediFlow'), 'synthetic app executable, never launched\n', 0o755);
  const web = path.join(contents, 'Resources/WebRuntime');
  write(path.join(web, 'server.js'), '// synthetic server, never started\n');
  return { contents, web, app: path.dirname(contents), helper: path.join(contents, ...helperParts, 'mediflow-chatgpt-codex') };
}
export function installedFixture(t, bundle = false) {
  const input = fixture(t);
  const app = bundle ? appRoot(input.directory) : null;
  const root = app?.web ?? input.installationRoot;
  const assets = path.join(root, ...assetParts);
  for (const [name, bytes] of Object.entries(syntheticFiles)) {
    write(name === 'codex' && app ? app.helper : path.join(assets, name), bytes, name === 'codex' ? 0o755 : 0o644);
  }
  return { ...input, root, assets, app, binaryPath: app?.helper ?? path.join(assets, 'codex') };
}
export function runStage(input, options = {}) {
  const args = options.args ?? ['--installation-root', input.installationRoot,
    '--binary', input.binary, '--native-source', input.nativeSource,
    '--schema-directory', input.schemaDirectory, '--c1-receipt', input.c1Receipt];
  return spawnSync(process.execPath, ['--import', testLoader,
    path.join(repositoryRoot, 'scripts/stage-chatgpt-execution-mac-assets.ts'), ...args], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NODE_OPTIONS: '', MEDIFLOW_PACKAGING_TEST_PINS: options.realPins ? '' : 'synthetic-only' },
  });
}
export function snapshot(root) {
  const result = {};
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), status = fs.lstatSync(file), key = path.relative(root, file);
      if (status.isSymbolicLink()) result[key] = { link: fs.readlinkSync(file), ino: status.ino };
      else if (status.isDirectory()) visit(file);
      else result[key] = { bytes: status.size, mode: status.mode, ino: status.ino, mtime: status.mtimeMs,
        ctime: status.ctimeMs, sha256: digest(fs.readFileSync(file)) };
    }
  }
  visit(root);
  return result;
}
