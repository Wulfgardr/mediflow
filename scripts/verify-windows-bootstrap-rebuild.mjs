import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function peByteDifferences(delivered, rebuilt) {
  const differences = [];
  for (let offset = 0; offset < Math.max(delivered.length, rebuilt.length); offset++) {
    if (delivered[offset] !== rebuilt[offset]) differences.push({ offset: `0x${offset.toString(16)}`,
      delivered: delivered[offset] ?? null, rebuilt: rebuilt[offset] ?? null });
  }
  return differences;
}

export function assertBootstrapBytesEqual(delivered, rebuilt) {
  assert.deepEqual(rebuilt, delivered, 'Delivered Windows bootstrap differs from source rebuild');
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
    const rebuilt = fs.readFileSync(path.join(directory, files[0]));
    console.log(JSON.stringify({ type: 'bootstrap-byte-comparison', arch: process.arch,
      differences: peByteDifferences(delivered[0], rebuilt) }));
    assertBootstrapBytesEqual(delivered[0], rebuilt);
    console.log('Windows bootstrap matches source rebuild byte for byte; no exclusions.');
  } finally {
    files.forEach((name, index) => fs.writeFileSync(path.join(directory, name), delivered[index]));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verify();
