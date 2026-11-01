import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function canonicalPe(bytes) {
  const result = Buffer.from(bytes);
  assert.equal(result.readUInt16LE(0), 0x5a4d);
  const pe = result.readUInt32LE(0x3c);
  assert.equal(result.readUInt32LE(pe), 0x4550);
  const optional = pe + 24;
  assert.equal(result.readUInt16LE(optional), 0x20b);
  const exportRva = result.readUInt32LE(optional + 112);
  const sections = optional + result.readUInt16LE(pe + 20);
  let exportOffset;
  for (let index = 0; index < result.readUInt16LE(pe + 6); index++) {
    const section = sections + index * 40;
    const start = result.readUInt32LE(section + 12);
    const size = result.readUInt32LE(section + 16);
    if (exportRva >= start && exportRva + 40 <= start + size) {
      exportOffset = result.readUInt32LE(section + 20) + exportRva - start;
      break;
    }
  }
  assert.ok(exportOffset !== undefined, 'Missing PE export directory');
  // MSVC embeds build time in the COFF and export headers. All other bytes,
  // including machine code, imports and exports, must compare exactly.
  result.fill(0, pe + 8, pe + 12);
  result.fill(0, exportOffset + 4, exportOffset + 8);
  return result;
}

function verify() {
  assert.equal(process.platform, 'win32');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const directory = path.join(root, 'scripts/windows-launcher-bootstrap/prebuilds', `win32-${process.arch}`);
  const files = ['system-directory.node', 'manifest.json'];
  const delivered = files.map(name => fs.readFileSync(path.join(directory, name)));
  try {
    for (const name of files) fs.unlinkSync(path.join(directory, name));
    const build = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-windows-launcher-bootstrap.mjs'), 'build'],
      { cwd: root, stdio: 'inherit', timeout: 180000, windowsHide: true });
    assert.ok(!build.error && build.status === 0, 'Bootstrap rebuild failed');
    assert.deepEqual(canonicalPe(fs.readFileSync(path.join(directory, files[0]))), canonicalPe(delivered[0]),
      'Delivered Windows bootstrap differs from source rebuild');
    console.log('Windows bootstrap matches source rebuild (only two PE timestamps excluded).');
  } finally {
    files.forEach((name, index) => fs.writeFileSync(path.join(directory, name), delivered[index]));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verify();
