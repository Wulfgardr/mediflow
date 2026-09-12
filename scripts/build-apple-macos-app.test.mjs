/* @Codex — executes the REAL builder, stager and Resources guard with synthetic
 * inputs and mocked Apple tools. This is an ordering/layout test, NOT Xcode,
 * codesign, Gatekeeper, notarization or runtime-smoke evidence. No downloads. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { appRoot, assetParts, fixture, repositoryRoot, snapshot, syntheticFiles, write } from './fixtures/mac-packaging-test-support.mjs';

function dependencies(web) {
  const arch = process.arch;
  for (const file of ['scripts/anydoc-pdf-page-worker.mjs', 'node_modules/pdf-lib/package.json', 'node_modules/pdfjs-dist/package.json',
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/@napi-rs/canvas/package.json', `node_modules/@napi-rs/canvas-darwin-${arch}/package.json`]) write(path.join(web, file), '{}\n');
  for (const file of [`node_modules/@firecrawl/anydoc-darwin-${arch}/anydoc.darwin-${arch}.node`,
    `node_modules/@img/sharp-darwin-${arch}/lib/sharp-darwin-${arch}-1.0.0.node`, `node_modules/@img/sharp-libvips-darwin-${arch}/lib/libvips-cpp.1.0.0.dylib`,
    `node_modules/@napi-rs/canvas-darwin-${arch}/skia.darwin-${arch}.node`, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'node_modules/fsevents/fsevents.node']) {
    write(path.join(web, file), Buffer.concat([Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from('synthetic dependency')]), 0o755);
  }
  for (const [file, code] of [
    ['node_modules/@firecrawl/anydoc/index.js', `const binding = require('@firecrawl/anydoc-darwin-${arch}');`],
    ['node_modules/@napi-rs/canvas/js-binding.js', `return require('@napi-rs/canvas-darwin-${arch}');`],
    [`node_modules/@img/sharp-darwin-${arch}/index.cjs`, `require.resolve('@img/sharp-libvips-darwin-${arch}/binary');\nmodule.exports = require('./lib/sharp-darwin-${arch}-1.0.0.node');`],
    ['node_modules/better-sqlite3/lib/database.js', "addon = require('bindings')('better_sqlite3.node');"],
    ['node_modules/fsevents/fsevents.js', 'const Native = require("./fsevents.node");'],
  ]) write(path.join(web, file), code + '\n');
  write(path.join(web, 'node_modules/sharp/node_modules/semver/bin/semver.js'), '// safe non-native link target\n');
  fs.mkdirSync(path.join(web, 'node_modules/sharp/node_modules/.bin'));
  fs.symlinkSync('../semver/bin/semver.js', path.join(web, 'node_modules/sharp/node_modules/.bin/semver'));
}

const driver = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import { appRoot } from './scripts/fixtures/mac-packaging-test-support.mjs';
const [command, ...args] = process.argv.slice(2), root = process.env.MEDIFLOW_PACKAGING_TEST_ROOT;
if (!root) throw new Error('Missing synthetic test root');
fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ command, args }) + '\n');
const target = args.at(-1) ?? '', base = path.basename(target), statePath = path.join(root, 'tool-state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const helper = base === 'mediflow-chatgpt-codex';
const emit = (cmd, name) => console.log('Load command 0\n          cmd ' + cmd + '\n         ' + (cmd === 'LC_RPATH' ? 'path ' : 'name ') + name + ' (offset 24)');
switch (command) {
  case 'npm':
    if (args.join(' ') !== 'run check:standalone-runtime-bundle') throw new Error('Unexpected npm invocation');
    break;
  case 'generate': case 'record-stager': break;
  case 'xcodebuild':
    appRoot(path.join(process.env.MEDIFLOW_MAC_DERIVED_DATA, 'Build/Products', process.env.MEDIFLOW_MAC_CONFIG));
    console.log('SYNTHETIC Xcode stub, no compilation'); break;
  case 'lipo':
    if (args[0] !== '-verify_arch' || !helper || process.env.MEDIFLOW_PACKAGING_TEST_BAD_ARCH === '1') process.exit(88);
    break;
  case 'file': {
    const s = fs.statSync(target);
    const bytes = s.isFile() ? fs.readFileSync(target) : Buffer.alloc(0);
    console.log(target + ': ' + (bytes.length >= 4 && bytes.readUInt32BE(0) === 0xfeedfacf ? 'Mach-O 64-bit bundle' : 'JavaScript source'));
    break;
  }
  case 'otool':
    if (['mediflow-web-anydoc.node', 'mediflow-web-libvips.dylib', 'mediflow-web-canvas.node'].includes(base)) emit('LC_ID_DYLIB', '@loader_path/' + base);
    else if (base === 'mediflow-web-sharp.node') {
      emit('LC_LOAD_DYLIB', state.linked ? '@loader_path/mediflow-web-libvips.dylib' : '@rpath/libvips-cpp.1.0.0.dylib');
      if (!state.noRpath) emit('LC_RPATH', '@loader_path/../../sharp-libvips-darwin-' + process.arch + '/lib');
    } else if (!['mediflow-web-better-sqlite3.node', 'mediflow-web-fsevents.node'].includes(base)) throw new Error('Unknown mock Mach-O target');
    emit('LC_LOAD_DYLIB', '/usr/lib/libSystem.B.dylib'); break;
  case 'install_name_tool':
    if (helper) throw new Error('Pinned helper must not be rewritten');
    if (args[0] === '-change') state.linked = true;
    else if (args[0] === '-delete_rpath') state.noRpath = true;
    else if (args[0] !== '-id') throw new Error('Unexpected rewrite');
    save(); break;
  case 'codesign':
    if (helper && (args[0] !== '--verify' || !args.includes('--strict'))) throw new Error('Pinned helper must only be verified');
    if (helper && process.env.MEDIFLOW_PACKAGING_TEST_BAD_SIGNATURE === '1') process.exit(86);
    if (args[0] === '--remove-signature' && base === 'mediflow-web-sharp.node') { state.linked = false; state.noRpath = false; save(); }
    if (args[0] === '--force' && target.endsWith('.app')) {
      fs.mkdirSync(path.join(target, 'Contents/_CodeSignature'), { recursive: true });
      fs.writeFileSync(path.join(target, 'Contents/_CodeSignature/CodeResources'), 'SYNTHETIC SEAL NOT SIGNATURE');
      if (process.env.MEDIFLOW_PACKAGING_TEST_MUTATE_ON_SEAL === '1') {
        const binary = path.join(target, 'Contents/Helpers/mediflow-chatgpt-codex'), bytes = fs.readFileSync(binary);
        bytes[bytes.length - 1] ^= 1; fs.writeFileSync(binary, bytes);
      }
    }
    if (args[0] === '--verify' && target.endsWith('.app') && process.env.MEDIFLOW_PACKAGING_TEST_BAD_OUTER === '1') process.exit(87);
    break;
  default: throw new Error('Unrecognized test tool ' + command);
}
`;

function buildFixture(t) {
  const input = fixture(t), root = path.join(input.directory, 'repo with spaces');
  for (const file of ['scripts/build-apple-macos-app.sh', 'scripts/check-macos-web-runtime-native-payload.sh',
    'scripts/stage-chatgpt-execution-mac-assets.ts', 'scripts/run-strip-types.mjs',
    'scripts/fixtures/mac-packaging-test-loader.mjs', 'scripts/fixtures/mac-packaging-test-support.mjs',
    ...['execution-mac-assets.ts', 'execution-mac-config.ts', 'execution-mac-native.ts', 'execution-mac-state.ts', 'execution-sandbox.ts', 'execution-contract.ts'].map(name => 'lib/chatgpt-execution/' + name)]) {
    const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, file), destination); fs.chmodSync(destination, file.endsWith('.sh') ? 0o755 : 0o644);
  }
  const web = path.join(root, '.next/standalone');
  write(path.join(web, 'server.js'), '// not an actual web build\n'); dependencies(web);
  write(path.join(root, '.next/static/synthetic.js'), '// synthetic static asset\n');
  write(path.join(root, 'scripts/local-api-tls-proxy.mjs'), '// synthetic proxy, never run\n');
  const driverPath = write(path.join(root, 'tool-driver.mjs'), driver);
  write(path.join(root, 'scripts/generate-apple-xcodeproj.sh'), `#!/bin/bash\nexec "${process.execPath}" "${driverPath}" generate "$@"\n`, 0o755);
  const bin = path.join(root, 'test-bin');
  for (const command of ['npm', 'xcodebuild', 'codesign', 'otool', 'install_name_tool', 'file', 'lipo']) {
    write(path.join(bin, command), `#!/bin/bash\nexec "${process.execPath}" "${driverPath}" ${command} "$@"\n`, 0o755);
  }
  write(path.join(bin, 'node'), `#!/bin/bash
if [[ "\${1:-}" == */scripts/run-strip-types.mjs && "\${2:-}" == */stage-chatgpt-execution-mac-assets.ts ]]; then
  "${process.execPath}" "${driverPath}" record-stager "$@"
  script="$2"; shift 2
  exec "${process.execPath}" --import "${path.join(root, 'scripts/fixtures/mac-packaging-test-loader.mjs')}" "$script" "$@"
fi
exec "${process.execPath}" "$@"
`, 0o755);
  const env = { ...process.env, NODE_OPTIONS: '', PATH: `${bin}:${process.env.PATH}`, DEVELOPER_DIR: path.join(root, 'synthetic-Xcode'),
    MEDIFLOW_SKIP_WEB_BUILD: '1', MEDIFLOW_NEXT_DIST_DIR: '.next', MEDIFLOW_MAC_CONFIG: 'Debug', MEDIFLOW_MAC_DERIVED_DATA: path.join(root, 'derived'),
    MEDIFLOW_PACKAGING_TEST_ROOT: root, MEDIFLOW_PACKAGING_TEST_PINS: 'synthetic-only', MEDIFLOW_CODESIGN_IDENTITY: '',
    MEDIFLOW_CHATGPT_EXECUTION_BINARY: input.binary, MEDIFLOW_CHATGPT_EXECUTION_NATIVE_SOURCE: input.nativeSource,
    MEDIFLOW_CHATGPT_EXECUTION_SCHEMA_DIRECTORY: input.schemaDirectory, MEDIFLOW_CHATGPT_EXECUTION_C1_RECEIPT: input.c1Receipt };
  return { ...input, root, env, web, app: path.join(root, 'derived/Build/Products/Debug/MediFlow.app'),
    run(overrides = {}) { return spawnSync('bash', [path.join(root, 'scripts/build-apple-macos-app.sh')], { cwd: root, encoding: 'utf8', env: { ...env, ...overrides }, timeout: 180_000, maxBuffer: 1024 * 1024 }); },
    events() { const file = path.join(root, 'events.jsonl'); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; } };
}
const pass = result => assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
const deny = result => assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);

for (const identity of ['', '-', 'Synthetic Developer ID']) {
  test(`mocked build/signing pipeline (${identity || 'unsigned outer app'}) preserves pins and all six dependency targets`, t => {
    const input = buildFixture(t), result = input.run({ MEDIFLOW_CODESIGN_IDENTITY: identity }); pass(result);
    assert.match(result.stdout, /runtime smoke still required/);
    const helper = path.join(input.app, 'Contents/Helpers/mediflow-chatgpt-codex');
    assert.deepEqual(fs.readFileSync(helper), syntheticFiles.codex);
    assert.deepEqual(fs.readFileSync(path.join(input.web, ...assetParts, 'codex')), syntheticFiles.codex);
    assert.equal(fs.existsSync(path.join(input.app, 'Contents/Resources/WebRuntime', ...assetParts, 'codex')), false);
    const targets = fs.readdirSync(path.join(input.app, 'Contents/Frameworks')).sort();
    assert.deepEqual(targets, ['mediflow-web-anydoc.node', 'mediflow-web-better-sqlite3.node', 'mediflow-web-canvas.node', 'mediflow-web-fsevents.node', 'mediflow-web-libvips.dylib', 'mediflow-web-sharp.node']);
    const events = input.events();
    const helperEvents = events.filter(e => ['codesign', 'install_name_tool'].includes(e.command) && e.args.at(-1) === helper);
    assert.ok(helperEvents.length >= 2);
    assert.ok(helperEvents.every(e => e.command === 'codesign' && e.args.join(' ').startsWith('--verify --strict ')));
    const seal = events.findIndex(e => e.command === 'codesign' && e.args[0] === '--force' && e.args.at(-1) === input.app);
    if (identity) {
      assert.ok(seal > 0);
      assert.ok(events.slice(seal + 1).filter(e => e.command === 'record-stager').every(e => e.args.includes('--check')));
      assert.equal(events.slice(seal + 1).some(e => e.command === 'install_name_tool' || e.command === 'codesign' && e.args[0] === '--force'), false);
      const before = snapshot(input.app), count = events.length;
      deny(input.run({ MEDIFLOW_CODESIGN_IDENTITY: identity }));
      assert.deepEqual(snapshot(input.app), before);
      assert.equal(input.events().length, count, 'sealed output must be rejected before Xcode/staging');
    } else assert.equal(seal, -1);
  });
}
test('invalid existing helper signature fails before native rewriting, with no attempted helper re-sign', t => {
  const input = buildFixture(t), result = input.run({ MEDIFLOW_PACKAGING_TEST_BAD_SIGNATURE: '1', MEDIFLOW_CODESIGN_IDENTITY: '-' });
  deny(result); assert.match(result.stderr, /no re-signing is allowed/);
  assert.equal(input.events().some(e => e.command === 'install_name_tool'), false);
  assert.equal(input.events().some(e => e.command === 'codesign' && e.args[0] === '--force'), false);
});
test('a post-seal byte change is rejected by the actual pinned-file validator', t => {
  const input = buildFixture(t), result = input.run({ MEDIFLOW_PACKAGING_TEST_MUTATE_ON_SEAL: '1', MEDIFLOW_CODESIGN_IDENTITY: '-' });
  deny(result); assert.match(result.stderr, /unqualified_boundary/);
  assert.doesNotMatch(result.stdout, /Runnable macOS app candidate/);
});
test('outer signature rejection is not bypassed or reported as a runnable app', t => {
  const input = buildFixture(t), result = input.run({ MEDIFLOW_PACKAGING_TEST_BAD_OUTER: '1', MEDIFLOW_CODESIGN_IDENTITY: '-' });
  deny(result); assert.doesNotMatch(result.stdout, /Runnable macOS app candidate/);
  assert.deepEqual(fs.readFileSync(path.join(input.app, 'Contents/Helpers/mediflow-chatgpt-codex')), syntheticFiles.codex);
});
test('missing staging inputs fail before Xcode rather than producing a HELD helper', t => {
  const input = buildFixture(t);
  deny(input.run({ MEDIFLOW_CHATGPT_EXECUTION_BINARY: '' }));
  assert.equal(input.events().some(e => e.command === 'xcodebuild'), false);
});
test('helper architecture rejection stops packaging before dependency rewriting or app signing', t => {
  const input = buildFixture(t), result = input.run({ MEDIFLOW_PACKAGING_TEST_BAD_ARCH: '1', MEDIFLOW_CODESIGN_IDENTITY: '-' });
  deny(result); assert.doesNotMatch(result.stdout, /Runnable macOS app candidate/);
  assert.equal(input.events().some(e => e.command === 'install_name_tool' || e.command === 'codesign' && e.args[0] === '--force'), false);
});
for (const overlay of ['.next', '.next/static', 'public']) {
  test(`copied ${overlay} overlay symlink is rejected before writing through it`, t => {
    const input = buildFixture(t), outside = path.join(input.directory, 'unrelated-overlay');
    write(path.join(outside, 'sentinel.txt'), 'must stay unchanged\n');
    const link = path.join(input.web, overlay); fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    const before = snapshot(outside), result = input.run();
    deny(result); assert.match(result.stderr, /Nonphysical app directory/);
    assert.deepEqual(snapshot(outside), before);
    assert.equal(input.events().some(e => e.command === 'record-stager' && e.args.includes('--relocate-bundle')), false);
  });
}
test('a pre-existing proxy symlink is rejected before Xcode or any asset staging', t => {
  const input = buildFixture(t), outside = write(path.join(input.directory, 'unrelated-proxy.mjs'), '// must stay unchanged\n');
  appRoot(path.dirname(input.app));
  fs.symlinkSync(outside, path.join(input.app, 'Contents/Resources/local-api-tls-proxy.mjs'));
  const before = fs.readFileSync(outside), result = input.run();
  deny(result); assert.match(result.stderr, /Nonphysical proxy destination/);
  assert.deepEqual(fs.readFileSync(outside), before);
  assert.equal(input.events().length, 0);
});
