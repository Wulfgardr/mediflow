import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { macosWebRuntimePayloadFailure, macosWebRuntimeRequiredFiles } from './macos-web-runtime-payload.mjs';

function syntheticStandalone(t, arch) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-macos-payload-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const standalone = path.join(directory, 'standalone');
  for (const file of macosWebRuntimeRequiredFiles(arch)) {
    fs.mkdirSync(path.dirname(path.join(standalone, file)), { recursive: true });
    fs.writeFileSync(path.join(standalone, file), 'synthetic\n');
  }
  return { directory, standalone };
}

for (const arch of ['arm64', 'x64']) {
  test(`a complete ${arch} standalone satisfies the macOS packaging contract`, (t) => {
    const { standalone } = syntheticStandalone(t, arch);
    assert.equal(macosWebRuntimePayloadFailure(standalone, 'darwin', arch), null);
  });
}

test('the contract names only files of the requested architecture', () => {
  assert.ok(macosWebRuntimeRequiredFiles('arm64').includes('node_modules/@img/sharp-darwin-arm64/index.cjs'));
  assert.ok(macosWebRuntimeRequiredFiles('x64').includes('node_modules/@napi-rs/canvas-darwin-x64/package.json'));
  assert.ok(macosWebRuntimeRequiredFiles('arm64').every((file) => !file.includes('{arch}') && !path.isAbsolute(file) && !file.split('/').includes('..')));
  assert.throws(() => macosWebRuntimeRequiredFiles('ia32'), /Unsupported macOS WebRuntime architecture/);
});

test('each required file the standalone build omits is reported before Xcode runs', (t) => {
  const { standalone } = syntheticStandalone(t, 'arm64');
  for (const file of macosWebRuntimeRequiredFiles('arm64')) {
    const absolute = path.join(standalone, file);
    fs.renameSync(absolute, `${absolute}.omitted`);
    const failure = macosWebRuntimePayloadFailure(standalone, 'darwin', 'arm64');
    fs.renameSync(`${absolute}.omitted`, absolute);
    assert.match(failure ?? '', /check-macos-web-runtime-native-payload\.sh/);
    assert.ok(failure.includes(file), `${file} must be named`);
  }
});

test('a required path that is a directory or escapes the standalone is refused', (t) => {
  const { directory, standalone } = syntheticStandalone(t, 'arm64');
  const worker = path.join(standalone, 'scripts/anydoc-pdf-page-worker.mjs');
  fs.rmSync(worker);
  fs.mkdirSync(worker);
  assert.match(macosWebRuntimePayloadFailure(standalone, 'darwin', 'arm64') ?? '', /anydoc-pdf-page-worker\.mjs/);
  fs.rmdirSync(worker);
  fs.writeFileSync(path.join(directory, 'outside.mjs'), 'synthetic\n');
  fs.symlinkSync(path.join(directory, 'outside.mjs'), worker);
  assert.match(macosWebRuntimePayloadFailure(standalone, 'darwin', 'arm64') ?? '', /anydoc-pdf-page-worker\.mjs/);
  fs.rmSync(worker);
  fs.symlinkSync(path.join(standalone, 'node_modules/pdf-lib/package.json'), worker);
  assert.equal(macosWebRuntimePayloadFailure(standalone, 'darwin', 'arm64'), null);
});

test('the macOS contract does not apply to Linux or Windows standalone builds', (t) => {
  const { standalone } = syntheticStandalone(t, 'x64');
  fs.rmSync(path.join(standalone, 'node_modules'), { recursive: true });
  assert.equal(macosWebRuntimePayloadFailure(standalone, 'linux', 'x64'), null);
  assert.equal(macosWebRuntimePayloadFailure(standalone, 'win32', 'x64'), null);
});
