/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const simulatorId = '11111111-2222-3333-4444-555555555555';
const iOS = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const bootedDevice = { udid: simulatorId, name: 'Fixture iPad', isAvailable: true, state: 'Booted' };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow simulator tooling '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  const project = path.join(root, 'native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj');
  const data = path.join(root, 'synthetic-data');
  for (const dir of [scripts, bin, project, data]) fs.mkdirSync(dir, { recursive: true });
  for (const script of ['build-mobile-sim-app.sh', 'mobile-home-base-paired-smoke.sh']) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', script), path.join(scripts, script));
  }
  fs.writeFileSync(path.join(project, 'project.pbxproj'), 'tracked project fixture');
  fs.writeFileSync(path.join(data, 'medical.db'), 'synthetic tooling fixture; no database contents');
  fs.writeFileSync(path.join(data, 'local-api-token'), 'synthetic-tooling-token');
  fs.writeFileSync(path.join(root, 'devices.json'), JSON.stringify({ devices: { [iOS]: [bootedDevice] } }));

  // All Apple/process/backend commands are fake; Node and plist parsing are real.
  const fakeTool = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.TOOLING_FIXTURE_ROOT;
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ tool, args, developer: process.env.DEVELOPER_DIR }) + '\\n');
if (tool === 'xcrun') {
  if (args.join(' ') === '--sdk iphonesimulator --show-sdk-version') {
    if (process.env.FAKE_SDK_MISSING) process.exit(1);
    console.log(process.env.FAKE_SDK_VERSION || '27.0');
  } else if (args.join(' ') === 'simctl list devices available -j') {
    process.stdout.write(fs.readFileSync(path.join(root, 'devices.json')));
  } else if (args[0] === 'simctl' && args[1] === 'install') {
    console.log('fixture install diagnostic');
    process.exit(Number(process.env.FAKE_INSTALL_EXIT || 0));
  } else if (args[0] !== 'simctl' || args[1] !== 'terminate') {
    throw new Error('Unexpected simulator operation');
  }
} else if (tool === 'xcodebuild') {
  console.log('fixture build diagnostic');
  if (process.env.FAKE_BUILD_EXIT) process.exit(Number(process.env.FAKE_BUILD_EXIT));
  if (!process.env.FAKE_SKIP_PRODUCT) {
    const derived = args[args.indexOf('-derivedDataPath') + 1];
    const app = path.join(derived, 'Build/Products/Debug-iphonesimulator/MediFlow.app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'Info.plist'), \`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>\${process.env.FAKE_APP_ID || 'com.mediflow.mobile'}</string>
<key>CFBundleSupportedPlatforms</key><array><string>\${process.env.FAKE_APP_PLATFORM || 'iPhoneSimulator'}</string></array>
<key>CFBundleExecutable</key><string>MediFlow</string>
</dict></plist>\`);
    if (!process.env.FAKE_NO_EXECUTABLE) fs.writeFileSync(path.join(app, 'MediFlow'), 'fixture executable', { mode: 0o755 });
  }
} else if (tool === 'curl') {
  process.exit(7); // Stop the smoke before any authentication or pairing request.
} else if (tool !== 'sqlite3') {
  throw new Error('Unexpected external operation');
}
`;
  for (const tool of ['xcrun', 'xcodebuild', 'curl', 'sqlite3']) {
    fs.writeFileSync(path.join(bin, tool), fakeTool, { mode: 0o755 });
  }
  // A regression that regenerates the project must be observable even if ignored.
  fs.writeFileSync(path.join(scripts, 'generate-apple-xcodeproj.sh'), '#!/bin/bash\ntouch "${TOOLING_FIXTURE_ROOT}/regenerated"\nexit 99\n', { mode: 0o755 });
  const env = {
    PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    DEVELOPER_DIR: path.join(root, 'Selected Xcode/Contents/Developer'),
    TOOLING_FIXTURE_ROOT: root,
    MEDIFLOW_DATA_DIR: data,
    MEDIFLOW_MOBILE_SMOKE_ARTIFACT_DIR: path.join(root, 'artifacts'),
    MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN: 'synthetic-tooling-pin',
    MEDIFLOW_MOBILE_SMOKE_HTTP_URL: 'http://127.0.0.1:3997',
    MEDIFLOW_MOBILE_SMOKE_HTTPS_URL: 'https://127.0.0.1:3998',
  };
  return {
    root, project, env,
    app: path.join(root, 'tmp-ios-sim-dd/Build/Products/Debug-iphonesimulator/MediFlow.app'),
    run(args = [], overrides = {}, script = 'build-mobile-sim-app.sh') {
      return spawnSync('/bin/bash', [path.join(scripts, script), ...args], {
        cwd: os.tmpdir(), env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
      });
    },
    devices(devices) { fs.writeFileSync(path.join(root, 'devices.json'), JSON.stringify({ devices })); },
    calls() {
      const file = path.join(root, 'calls.jsonl');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
    },
  };
}

test('build uses SDK-default simulator signing, the canonical project, and leaves simulators alone', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${f.app}\n`);
  assert.match(result.stderr, /fixture build diagnostic/);
  const build = f.calls().find(({ tool }) => tool === 'xcodebuild');
  assert.deepEqual(build.args, ['-project', f.project, '-scheme', 'MediFlowMobileApp', '-configuration', 'Debug',
    '-derivedDataPath', path.join(f.root, 'tmp-ios-sim-dd'), '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', 'build']);
  assert.ok(!build.args.some((argument) => argument.startsWith('CODE_SIGNING_')));
  assert.ok(f.calls().every(({ developer }) => developer === f.env.DEVELOPER_DIR));
  assert.ok(!f.calls().some(({ args }) => args[0] === 'simctl'));
  assert.equal(fs.readFileSync(path.join(f.project, 'project.pbxproj'), 'utf8'), 'tracked project fixture');
  assert.ok(!fs.existsSync(path.join(f.root, 'regenerated')));
});

test('relative derived-data paths with spaces resolve from the repository', (t) => {
  const f = fixture(t);
  const result = f.run([], { MEDIFLOW_IOS_DERIVED_DATA: 'custom derived data' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${path.join(f.root, 'custom derived data/Build/Products/Debug-iphonesimulator/MediFlow.app')}\n`);
});

test('install requires an explicit UDID; an alias or simulator name cannot select another device', (t) => {
  const f = fixture(t);
  for (const value of ['', 'booted', 'Fixture iPad']) {
    const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: value });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit MEDIFLOW_IOS_SIMULATOR_ID UDID/);
  }
  assert.deepEqual(f.calls(), []);
});

for (const [label, devices] of [
  ['shutdown', { [iOS]: [{ ...bootedDevice, state: 'Shutdown' }] }],
  ['unavailable', { [iOS]: [{ ...bootedDevice, isAvailable: false }] }],
  ['absent', { [iOS]: [] }],
  ['non-iOS', { 'com.apple.CoreSimulator.SimRuntime.watchOS-27-0': [bootedDevice] }],
]) {
  test(`install rejects a ${label} target before building`, (t) => {
    const f = fixture(t);
    f.devices(devices);
    const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /available, iOS and already booted/);
    assert.ok(!f.calls().some(({ tool, args }) => tool === 'xcodebuild' || args[1] === 'install'));
  });
}

test('explicit install uses the verified product and exact UDID without booting or launching', (t) => {
  const f = fixture(t);
  const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${f.app}\n`);
  assert.match(result.stderr, /fixture install diagnostic/);
  assert.deepEqual(f.calls().filter(({ args }) => args[0] === 'simctl').map(({ args }) => args), [
    ['simctl', 'list', 'devices', 'available', '-j'], ['simctl', 'install', simulatorId, f.app],
  ]);
});

test('failed rebuild propagates its status and never installs a stale product', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId, FAKE_BUILD_EXIT: '65' });
  assert.equal(result.status, 65);
  assert.equal(result.stdout, '');
  assert.ok(!f.calls().some(({ args }) => args[1] === 'install'));
});

for (const [label, overrides, message] of [
  ['missing product', { FAKE_SKIP_PRODUCT: '1' }, /did not produce/],
  ['wrong bundle', { FAKE_APP_ID: 'com.example.unrelated' }, /Bundle identifier mismatch/],
  ['bundle expectation override', { MEDIFLOW_IOS_BUNDLE_ID: 'com.example.expected' }, /Bundle identifier mismatch/],
  ['device product', { FAKE_APP_PLATFORM: 'iPhoneOS' }, /Expected an iPhoneSimulator app/],
  ['missing executable', { FAKE_NO_EXECUTABLE: '1' }, /Missing app executable/],
]) {
  test(`${label} is rejected before installation`, (t) => {
    const f = fixture(t);
    const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId, ...overrides });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.ok(!f.calls().some(({ args }) => args[1] === 'install'));
  });
}

test('install failure propagates without emitting a success path', (t) => {
  const f = fixture(t);
  const result = f.run(['--install'], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId, FAKE_INSTALL_EXIT: '9' });
  assert.equal(result.status, 9);
  assert.equal(result.stdout, '');
});

for (const overrides of [{ FAKE_SDK_MISSING: '1' }, { FAKE_SDK_VERSION: '25.0' }]) {
  test(`unusable selected SDK ${JSON.stringify(overrides)} fails without toolchain substitution`, (t) => {
    const f = fixture(t);
    const result = f.run([], overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SDK 26\+ is required/);
    assert.ok(f.calls().every(({ tool, developer }) => tool === 'xcrun' && developer === f.env.DEVELOPER_DIR));
    assert.ok(!fs.existsSync(path.join(f.root, 'tmp-ios-sim-dd')));
  });
}

for (const [stage, overrides, status] of [
  ['build', { FAKE_BUILD_EXIT: '65' }, 65],
  ['install', { FAKE_INSTALL_EXIT: '9' }, 9],
]) {
  test(`paired smoke ${stage} failure stops before backend, credentials, cleanup or artifacts`, (t) => {
    const f = fixture(t);
    const result = f.run([], overrides, 'mobile-home-base-paired-smoke.sh');
    assert.equal(result.status, status, result.stderr);
    assert.ok(f.calls().every(({ tool, args }) => tool === 'xcodebuild' || (tool === 'xcrun' && args[1] !== 'terminate')));
    assert.ok(!fs.existsSync(f.env.MEDIFLOW_MOBILE_SMOKE_ARTIFACT_DIR));
    assert.doesNotMatch(result.stdout, /Minting temporary paired credentials/);
  });
}

test('paired smoke installs the inferred booted iPad before its first backend check', (t) => {
  const f = fixture(t);
  f.devices({ [iOS]: [{ ...bootedDevice, udid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Fixture iPhone' }, bootedDevice] });
  const result = f.run([], {}, 'mobile-home-base-paired-smoke.sh');
  assert.equal(result.status, 1, result.stderr); // The fixture's backend is deliberately unavailable.
  assert.match(result.stdout, /Local backend is not reachable/);
  const calls = f.calls();
  const installIndex = calls.findIndex(({ args }) => args[1] === 'install');
  assert.ok(installIndex > 0);
  assert.deepEqual(calls[installIndex].args, ['simctl', 'install', simulatorId, f.app]);
  assert.ok(calls.findIndex(({ tool }) => tool === 'sqlite3') > installIndex);
  assert.ok(calls.findIndex(({ tool }) => tool === 'curl') > installIndex);
  assert.doesNotMatch(result.stdout, /Minting temporary paired credentials/);
});

test('paired smoke rejects a shutdown explicit target instead of using another booted device', (t) => {
  const f = fixture(t);
  f.devices({ [iOS]: [{ ...bootedDevice, state: 'Shutdown' }, { ...bootedDevice, udid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] });
  const result = f.run([], { MEDIFLOW_IOS_SIMULATOR_ID: simulatorId }, 'mobile-home-base-paired-smoke.sh');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /No matching booted iOS simulator/);
  assert.ok(f.calls().every(({ tool, args }) => tool === 'xcrun' && args[1] === 'list'));
  assert.ok(!fs.existsSync(f.env.MEDIFLOW_MOBILE_SMOKE_ARTIFACT_DIR));
});
