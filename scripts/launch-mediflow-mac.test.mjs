#!/usr/bin/env node
/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launcherSource = path.join(repoRoot, 'scripts', 'Launch_MediFlowMac.command');

function writeExecutable(filePath, source) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  fs.chmodSync(filePath, 0o755);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-mac-launcher-test-'));
  const home = path.join(root, 'home');
  const scripts = path.join(root, 'scripts');
  const invalidBin = path.join(root, 'invalid-bin');
  const toolsBin = path.join(root, 'tools-bin');
  const derived = path.join(root, 'derived');
  const attemptsLog = path.join(root, 'node-attempts.log');
  const selectedNodeLog = path.join(root, 'selected-node.log');
  const selectedOverrideLog = path.join(root, 'selected-override.log');
  const setupLog = path.join(root, 'setup.log');
  const buildLog = path.join(root, 'build.log');
  const openLog = path.join(root, 'open.log');
  const validNode = path.join(home, '.nvm', 'versions', 'node', 'v24.19.0', 'bin', 'node');

  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(launcherSource, path.join(scripts, 'Launch_MediFlowMac.command'));
  fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
  fs.writeFileSync(path.join(scripts, 'launcher-helpers.mjs'), 'process.exit(1);\n');

  writeExecutable(path.join(invalidBin, 'node'), `#!/bin/bash
printf 'invalid\\n' >> "$MEDIFLOW_TEST_NODE_ATTEMPTS"
exit 1
`);
writeExecutable(validNode, `#!/bin/bash
case "\${2:-}" in
  check-runtime)
    printf 'valid\\n' >> "$MEDIFLOW_TEST_NODE_ATTEMPTS"
    exit 0
    ;;
  identity-summary)
    printf '  Versione prodotto: 0.8.5\\n'
    printf '  Checkout: %s\\n' "$MEDIFLOW_TEST_ROOT"
    printf '  Sorgente: test@abc123:clean\\n'
    exit 0
    ;;
  *) exit 1 ;;
esac
`);
  writeExecutable(path.join(scripts, 'native-setup.sh'), `#!/bin/bash
printf '%s\\n' "$(command -v node)" > "$MEDIFLOW_TEST_SELECTED_NODE"
printf '%s\\n' "\${MEDIFLOW_NODE_BINARY:-}" > "$MEDIFLOW_TEST_SELECTED_OVERRIDE"
touch "$MEDIFLOW_TEST_SETUP_LOG"
`);
  writeExecutable(path.join(scripts, 'build-apple-macos-app.sh'), `#!/bin/bash
mkdir -p "$MEDIFLOW_MAC_DERIVED_DATA/Build/Products/$MEDIFLOW_MAC_CONFIG/MediFlow.app"
touch "$MEDIFLOW_TEST_BUILD_LOG"
`);
  writeExecutable(path.join(toolsBin, 'open'), `#!/bin/bash
printf '%s\\n' "$*" > "$MEDIFLOW_TEST_OPEN_LOG"
`);

  return {
    root, home, invalidBin, toolsBin, derived, attemptsLog, selectedNodeLog,
    selectedOverrideLog, setupLog, buildLog, openLog, validNode,
  };
}

function runLauncher(scenario) {
  return spawnSync('/bin/bash', [path.join(scenario.root, 'scripts', 'Launch_MediFlowMac.command')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: scenario.home,
      PATH: `${scenario.invalidBin}:${scenario.toolsBin}:/usr/bin:/bin`,
      MEDIFLOW_MAC_CONFIG: 'Debug',
      MEDIFLOW_MAC_DERIVED_DATA: scenario.derived,
      MEDIFLOW_TEST_NODE_ATTEMPTS: scenario.attemptsLog,
      MEDIFLOW_TEST_ROOT: scenario.root,
      MEDIFLOW_TEST_SELECTED_NODE: scenario.selectedNodeLog,
      MEDIFLOW_TEST_SELECTED_OVERRIDE: scenario.selectedOverrideLog,
      MEDIFLOW_TEST_SETUP_LOG: scenario.setupLog,
      MEDIFLOW_TEST_BUILD_LOG: scenario.buildLog,
      MEDIFLOW_TEST_OPEN_LOG: scenario.openLog,
    },
  });
}

test('selects a contract-compatible Node 24 before native setup and build', (t) => {
  const scenario = createFixture();
  t.after(() => fs.rmSync(scenario.root, { recursive: true, force: true }));

  const result = runLauncher(scenario);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Versione prodotto: 0\.8\.5/);
  assert.match(result.stdout, new RegExp(`Checkout: ${scenario.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(result.stdout, /Sorgente: test@abc123:clean/);
  assert.deepEqual(fs.readFileSync(scenario.attemptsLog, 'utf8').trim().split('\n'), ['invalid', 'valid']);
  assert.equal(fs.readFileSync(scenario.selectedNodeLog, 'utf8').trim(), scenario.validNode);
  assert.equal(fs.readFileSync(scenario.selectedOverrideLog, 'utf8').trim(), scenario.validNode);
  assert.ok(fs.existsSync(scenario.setupLog));
  assert.ok(fs.existsSync(scenario.buildLog));
  assert.match(fs.readFileSync(scenario.openLog, 'utf8'), /MediFlow\.app/);
});

test('fails closed before native setup when no Node satisfies the runtime contract', (t) => {
  const scenario = createFixture();
  t.after(() => fs.rmSync(scenario.root, { recursive: true, force: true }));
  fs.rmSync(scenario.validNode);

  const result = runLauncher(scenario);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node 24\.x/);
  assert.match(result.stderr, /npm ci/);
  assert.equal(fs.existsSync(scenario.setupLog), false);
  assert.equal(fs.existsSync(scenario.buildLog), false);
  assert.equal(fs.existsSync(scenario.openLog), false);
});
