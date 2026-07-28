/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = path.join(import.meta.dirname, 'run-native-probe.sh');

function writeExecutable(filePath, source) {
    fs.writeFileSync(filePath, source, { mode: 0o755 });
}

function createScenario({ waitForSignal = false, xcrunExit = 0, externalMediFlow = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-probe-'));
    const bin = path.join(root, 'bin');
    const appPath = path.join(root, 'MediFlow.app');
    const appExecutable = path.join(appPath, 'Contents', 'MacOS', 'MediFlow');
    const appLogPath = path.join(root, 'app.log');
    const appPidPath = path.join(root, 'app.pid');
    const pgrepLogPath = path.join(root, 'pgrep.log');
    const readyPath = path.join(root, 'xcrun-ready');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.dirname(appExecutable), { recursive: true });
    writeExecutable(appExecutable, `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$$" > "$MOCK_APP_PID"
printf 'uitest=%s\nsection=%s\n' "$MEDIFLOW_APPLE_UITEST_PATIENTS" "$MEDIFLOW_APPLE_INITIAL_SECTION" > "$MOCK_APP_LOG"
printf 'arg=%s\n' "$@" >> "$MOCK_APP_LOG"
while :; do /bin/sleep 1; done
`);
    writeExecutable(path.join(bin, 'pgrep'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "$MOCK_PGREP_LOG"
exit "$MOCK_PGREP_EXIT"
`);
    writeExecutable(path.join(bin, 'xcrun'), `#!/usr/bin/env bash
set -euo pipefail
for _ in {1..200}; do
  if [[ -s "$MOCK_APP_PID" && -s "$MOCK_APP_LOG" ]]; then
    break
  fi
  /bin/sleep 0.01
done
if [[ ! -s "$MOCK_APP_PID" || ! -s "$MOCK_APP_LOG" ]]; then
  exit 124
fi
if [[ "$MOCK_WAIT_FOR_SIGNAL" == 1 ]]; then
  : > "$MOCK_XCRUN_READY"
  /bin/sleep 10
fi
exit "$MOCK_XCRUN_EXIT"
`);
    return {
        root,
        appPath,
        appLogPath,
        appPidPath,
        pgrepLogPath,
        readyPath,
        env: {
            ...process.env,
            MEDIFLOW_NATIVE_PROBE_PGREP_BIN: path.join(bin, 'pgrep'),
            MEDIFLOW_NATIVE_PROBE_XCRUN_BIN: path.join(bin, 'xcrun'),
            MOCK_APP_LOG: appLogPath,
            MOCK_APP_PID: appPidPath,
            MOCK_WAIT_FOR_SIGNAL: waitForSignal ? '1' : '0',
            MOCK_XCRUN_READY: readyPath,
            MOCK_XCRUN_EXIT: String(xcrunExit),
            MOCK_PGREP_LOG: pgrepLogPath,
            MOCK_PGREP_EXIT: externalMediFlow ? '0' : '1',
        },
    };
}

function removeScenario(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

function runScenario(scenario) {
    return spawnSync('bash', [scriptPath, '--app-path', scenario.appPath], {
        encoding: 'utf8',
        env: scenario.env,
    });
}

function readAppPid(scenario) {
    return Number.parseInt(fs.readFileSync(scenario.appPidPath, 'utf8'), 10);
}

function assertProcessStopped(pid) {
    assert.throws(() => process.kill(pid, 0), (error) => error?.code === 'ESRCH');
}

test('launches the synthetic probe with volatile UI overrides and no defaults-domain mutation', () => {
    const scenario = createScenario();
    try {
        const result = runScenario(scenario);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(fs.readFileSync(scenario.appLogPath, 'utf8').trim().split('\n'), [
            'uitest=1',
            'section=patients',
            'arg=-ApplePersistenceIgnoreState',
            'arg=YES',
            'arg=-mediflow.apple.appearance.theme',
            'arg=system',
            'arg=-mediflow.apple.appearance.reduce-motion',
            'arg=false',
            'arg=-mediflow.apple.privacy.shield-enabled',
            'arg=false',
        ]);
        assertProcessStopped(readAppPid(scenario));
        const source = fs.readFileSync(scriptPath, 'utf8');
        assert.doesNotMatch(source, /DEFAULTS_DOMAIN|defaults\s+(?:delete|export|import)/);
        assert.doesNotMatch(source, /\bpkill\b|\bkillall\b/);
    } finally {
        removeScenario(scenario.root);
    }
});

test('refuses an external MediFlow process without launching or terminating it', () => {
    const scenario = createScenario({ externalMediFlow: true });
    try {
        const result = runScenario(scenario);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /will not terminate an external session/);
        assert.equal(fs.existsSync(scenario.appPidPath), false);
        assert.deepEqual(fs.readFileSync(scenario.pgrepLogPath, 'utf8').trim().split('\n'), ['-x', 'MediFlow']);
    } finally {
        removeScenario(scenario.root);
    }
});

test('probe contract binds each selected fixture row to its header and detail content across scroll', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, 'native-click-map-probe.swift'), 'utf8');
    assert.match(source, /func patientWorkspaceBinding\(/);
    assert.match(source, /containsAXText\(patientBoundText, in: snapshot\.detail\)/);
    assert.match(source, /patientBoundText: "RSSMRA80A01H501U"/);
    assert.match(source, /patientBoundText: "BNCNNA85M41F205X"/);
    assert.equal((source.match(/selectedItemsContain\("patient-cell-uitest-1", list: patientList\)/g) ?? []).length, 3);
    assert.equal((source.match(/selectedItemsContain\("patient-cell-uitest-2", list: secondPatientList\)/g) ?? []).length, 3);
    assert.match(source, /First patient row, header, and detail content remain bound after scroll/);
    assert.match(source, /Second patient row, header, and detail content remain bound after scroll/);
});

test('stops the synthetic app when xcrun fails', () => {
    const scenario = createScenario({ xcrunExit: 9 });
    try {
        const result = runScenario(scenario);
        assert.equal(result.status, 9, result.stderr);
        assertProcessStopped(readAppPid(scenario));
    } finally {
        removeScenario(scenario.root);
    }
});

async function waitForFile(filePath) {
    const deadline = Date.now() + 2_000;
    while (!fs.existsSync(filePath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(fs.existsSync(filePath), `timed out waiting for ${filePath}`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`stops the synthetic app on ${signal}`, async () => {
        const scenario = createScenario({ waitForSignal: true });
        try {
            const child = spawn('bash', [scriptPath, '--app-path', scenario.appPath], {
                detached: true,
                env: scenario.env,
            });
            await Promise.all([
                waitForFile(scenario.readyPath),
                waitForFile(scenario.appPidPath),
            ]);
            process.kill(-child.pid, signal);
            const exitCode = await new Promise((resolve) => child.once('exit', resolve));
            assert.equal(exitCode, signal === 'SIGINT' ? 130 : 143);
            assertProcessStopped(readAppPid(scenario));
        } finally {
            removeScenario(scenario.root);
        }
    });
}
