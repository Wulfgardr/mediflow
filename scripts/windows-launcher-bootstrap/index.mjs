import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deny = () => { throw new Error('Windows bootstrap artifact unavailable or invalid.'); };
const regular = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase()) deny();
  return fs.readFileSync(file);
};

export function loadSystemDirectoryBinding() {
  const arch = process.arch;
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(arch) || Number(process.versions.napi) < 1) deny();
  const directory = path.join(root, 'prebuilds', `win32-${arch}`);
  const manifest = JSON.parse(regular(path.join(directory, 'manifest.json')).toString('utf8'));
  const binary = path.join(directory, 'system-directory.node');
  const bytes = regular(binary);
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.arch !== arch
    || manifest.napiVersion !== 1 || manifest.binary !== 'system-directory.node'
    || manifest.bytes !== bytes.length || manifest.sha256 !== sha256(bytes)
    || manifest.sourceSha256 !== sha256(regular(path.join(root, 'system-directory.c')))
    || manifest.recipeSha256 !== sha256(regular(path.join(root, 'build.ps1')))
    || manifest.builderSha256 !== sha256(regular(path.join(root, '..', 'prepare-windows-launcher-bootstrap.mjs')))) deny();
  const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset + 6 > bytes.length
    || bytes.readUInt32LE(offset) !== 0x4550 || bytes.readUInt16LE(offset + 4) !== (arch === 'x64' ? 0x8664 : 0xaa64)) deny();
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length !== 2
    || [...manifest.dependencies].sort().join(',').toLowerCase() !== 'kernel32.dll,node.exe') deny();
  const binding = createRequire(import.meta.url)(binary);
  if (Object.keys(binding).join(',') !== 'getSystemDirectory' || typeof binding.getSystemDirectory !== 'function') deny();
  return binding;
}
