#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    classifyRevisionPayload,
    hashWorktreeStatus,
    inspectPort,
    knownMainUpdates,
    probeRunningInstance,
    readProductIdentity,
    waitForInstanceAndOpen,
} from './launcher-helpers.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('known updates stop an older main, but do not block an updated or development checkout', (t) => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-git-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Synthetic');
    git('config', 'user.email', 'synthetic@example.invalid');
    git('commit', '--allow-empty', '-m', 'first');
    const earlier = git('rev-parse', 'HEAD');
    assert.equal(knownMainUpdates(cwd), 0, 'a source archive without an upstream can still start');
    git('commit', '--allow-empty', '-m', 'update');
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
    git('remote', 'add', 'origin', cwd);
    git('config', 'branch.main.remote', 'origin');
    git('config', 'branch.main.merge', 'refs/heads/main');
    git('reset', '--hard', earlier);
    assert.equal(knownMainUpdates(cwd), 1);
    const denied = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/launcher-helpers.mjs'), 'check-source-current'], { cwd, encoding: 'utf8' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /git pull --ff-only/);
    git('switch', '-c', 'codex/synthetic-development');
    assert.equal(knownMainUpdates(cwd), 0);
    git('switch', 'main');
    git('merge', '--ff-only', 'origin/main');
    assert.equal(knownMainUpdates(cwd), 0);
});

test('product identity reports the exact checkout, version, and source fingerprint', () => {
    const identity = readProductIdentity(repoRoot);
    assert.equal(identity.version, '0.9.0');
    assert.equal(identity.checkoutPath, repoRoot);
    assert.equal(identity.sourceFingerprint, `${identity.branch}@${identity.revision}:${identity.worktreeHash}`);
});

test('worktree hash matches the server algorithm and ignores edge whitespace', () => {
    const status = ' M MediFlow.sh\n?? scripts/launcher-helpers.test.mjs\n';
    const expected = crypto.createHash('sha1').update(status.trim()).digest('hex').slice(0, 12);
    assert.equal(hashWorktreeStatus(status), expected);
    assert.equal(hashWorktreeStatus('  \n'), 'clean');
});

test('revision classification reuses only an exact MediFlow source fingerprint', () => {
    const payload = { revision: 'abc123', sourceFingerprint: 'main@abc123:clean', fingerprint: 'runtime' };
    assert.deepEqual(classifyRevisionPayload(payload, payload.sourceFingerprint), {
        ok: true, revision: 'abc123', sourceFingerprint: payload.sourceFingerprint,
    });
    assert.equal(classifyRevisionPayload(payload, 'other@def456:clean').reason, 'source-mismatch');
    assert.equal(classifyRevisionPayload({ sourceFingerprint: payload.sourceFingerprint }, payload.sourceFingerprint).reason, 'not-mediflow');
});

test('running-instance probe calls the revision endpoint and fails closed', async () => {
    const requested = [];
    const matchingFetch = async (url) => {
        requested.push(String(url));
        return new Response(JSON.stringify({ revision: 'abc123', sourceFingerprint: 'main@abc123:clean', fingerprint: 'runtime' }));
    };
    assert.equal((await probeRunningInstance('http://localhost:3000', 'main@abc123:clean', matchingFetch)).ok, true);
    assert.equal(requested[0], 'http://localhost:3000/api/system/revision');

    const foreignFetch = async () => new Response('<html>not MediFlow</html>');
    assert.equal((await probeRunningInstance('http://127.0.0.1:3000', 'main@abc123:clean', foreignFetch)).reason, 'unreachable-or-invalid');
    assert.equal((await probeRunningInstance('http://example.com:3000', 'main@abc123:clean', matchingFetch)).reason, 'url-not-allowed');
});

test('port inspection distinguishes free, occupied, and unknown', () => {
    const occupied = inspectPort(3000, {
        platform: 'darwin',
        spawnSyncImpl: () => ({ status: 0, stdout: 'p4242\n', stderr: '' }),
    });
    assert.deepEqual(occupied, { state: 'occupied', pid: '4242', reason: '' });

    const free = inspectPort(3000, {
        platform: 'darwin',
        spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' }),
    });
    assert.deepEqual(free, { state: 'free', pid: '', reason: '' });

    const unknown = inspectPort(3000, {
        platform: 'darwin',
        spawnSyncImpl: () => ({ status: null, stdout: '', stderr: '', error: new Error('lsof unavailable') }),
    });
    assert.deepEqual(unknown, { state: 'unknown', pid: '', reason: 'lsof unavailable' });

    const windowsOccupied = inspectPort(3000, {
        platform: 'win32',
        spawnSyncImpl: () => ({
            status: 0,
            stdout: '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    7654\r\n',
            stderr: '',
        }),
    });
    assert.deepEqual(windowsOccupied, { state: 'occupied', pid: '7654', reason: '' });

    const windowsUnknown = inspectPort(3000, {
        platform: 'win32',
        spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'access denied' }),
    });
    assert.deepEqual(windowsUnknown, { state: 'unknown', pid: '', reason: 'access denied' });
    assert.equal(inspectPort(0).state, 'unknown');
});

test('Linux inspection falls back to ss without treating a missing PID as free', () => {
    const commands = [];
    const result = inspectPort(3000, {
        platform: 'linux',
        spawnSyncImpl: (command) => {
            commands.push(command);
            if (command === 'lsof') return { status: null, stdout: '', stderr: '', error: new Error('missing') };
            return { status: 0, stdout: 'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:*\n', stderr: '' };
        },
    });
    assert.deepEqual(commands, ['lsof', 'ss']);
    assert.deepEqual(result, { state: 'occupied', pid: '', reason: '' });
});

test('readiness polling opens only after an exact fingerprint match', async () => {
    let elapsedMs = 0;
    let probeCount = 0;
    const events = [];
    const result = await waitForInstanceAndOpen('http://localhost:3000', 'main@abc123:clean', {
        timeoutMs: 500,
        intervalMs: 100,
        now: () => elapsedMs,
        sleep: async (milliseconds) => { elapsedMs += milliseconds; },
        probe: async () => {
            probeCount += 1;
            events.push(`probe-${probeCount}`);
            if (probeCount < 3) return { ok: false, reason: 'source-mismatch' };
            return { ok: true, revision: 'abc123', sourceFingerprint: 'main@abc123:clean' };
        },
        open: (url) => {
            events.push(`open-${url}`);
            return 0;
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.browserOpened, true);
    assert.equal(result.attempts, 3);
    assert.deepEqual(events, [
        'probe-1',
        'probe-2',
        'probe-3',
        'open-http://localhost:3000',
    ]);
});

test('a free-port race ending in a mismatched listener times out without opening', async () => {
    const initial = inspectPort(3000, {
        platform: 'darwin',
        spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' }),
    });
    assert.equal(initial.state, 'free');

    let elapsedMs = 0;
    let openCount = 0;
    const result = await waitForInstanceAndOpen('http://localhost:3000', 'main@abc123:clean', {
        timeoutMs: 200,
        intervalMs: 100,
        now: () => elapsedMs,
        sleep: async (milliseconds) => { elapsedMs += milliseconds; },
        probe: async () => ({ ok: false, reason: 'source-mismatch' }),
        open: () => { openCount += 1; return 0; },
    });

    assert.deepEqual(result, {
        ok: false,
        reason: 'timeout',
        lastReason: 'source-mismatch',
        attempts: 3,
        browserOpened: false,
    });
    assert.equal(openCount, 0);
});

test('a verified instance stays valid when the local browser cannot be opened', async () => {
    const result = await waitForInstanceAndOpen('http://localhost:3000', 'main@abc123:clean', {
        probe: async () => ({ ok: true, revision: 'abc123', sourceFingerprint: 'main@abc123:clean' }),
        open: () => 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'browser-open-failed');
    assert.equal(result.browserOpened, false);
});


import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { atomicJson, buildDecision, claimLauncher, findExistingInstance, needsTextMenu, parseArguments, requireFreePort, selectChoice, stopOwnedChild, textualChoice } from './mediflow.mjs';
import { createChoiceServer } from './mediflow-launcher-page.mjs';
import { navigateExistingLocalUiRuntime } from './local-ui-runtime.mjs';
import { createServer as createHttpServer } from 'node:http';

test('runtime navigation checks archive, source identity and cancellation before sending an intent', async () => {
    const sourceFingerprint = 'synthetic@0123456789ab:clean';
    const revision = createHttpServer((_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ revision: '0123456789ab', sourceFingerprint, fingerprint: 'synthetic' }));
    });
    await new Promise(resolve => revision.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${revision.address().port}`;
    const received = [];
    const page = await createChoiceServer({ root: repoRoot, state: () => ({ ready: true, url: origin }),
        choose() {}, install() {}, stop() {}, navigate(intent) { received.push(intent); } });
    const receipt = { pid: process.pid, checkoutPath: repoRoot, dataDir: '/synthetic-only', choiceUrl: page.url };
    const expected = { sourceRoot: repoRoot, dataDir: '/synthetic-only', sourceFingerprint };
    try {
        assert.equal(await navigateExistingLocalUiRuntime(receipt, expected, 'history', new AbortController().signal), true);
        await assert.rejects(navigateExistingLocalUiRuntime({ ...receipt, dataDir: '/different-archive' }, expected, 'identity', new AbortController().signal));
        await assert.rejects(navigateExistingLocalUiRuntime(receipt, { ...expected, sourceFingerprint: 'changed' }, 'identity', new AbortController().signal));
        const cancelled = new AbortController(); cancelled.abort();
        await assert.rejects(navigateExistingLocalUiRuntime(receipt, expected, 'identity', cancelled.signal));
        await assert.rejects(navigateExistingLocalUiRuntime(receipt, expected, 'SYNTHETIC_SENTINEL', new AbortController().signal));
        assert.deepEqual(received, ['history']);
    } finally { await page.close(); await new Promise(resolve => revision.close(resolve)); }
});

test('ordinary launcher forwards only closed navigation intents without giving the caller runtime shutdown ownership', async () => {
    const intents = [];
    let stopped = false;
    const page = await createChoiceServer({ root: repoRoot,
        state: () => ({ ready: true, url: 'http://127.0.0.1:32123' }),
        choose() {}, install() {}, stop() { stopped = true; },
        navigate(intent) { intents.push(intent); },
    });
    try {
        const endpoint = new URL('navigate', page.url);
        const post = body => fetch(endpoint, { method: 'POST',
            headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await post({ intent: 'history' })).status, 202);
        assert.deepEqual(intents, ['history']);
        for (const body of [{ intent: 'history', patientId: 'SYNTHETIC_SENTINEL' },
            { intent: 'clinical' }, { profile: 'clinical' }, { intent: 'history', stop: true }]) {
            assert.equal((await post(body)).status, 400);
        }
        assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: '{"intent":"search"}' })).status, 403);
        assert.deepEqual(intents, ['history']);
        assert.equal(stopped, false);
        assert.equal((await fetch(new URL('state', page.url))).status, 200);
    } finally { await page.close(); }
});

const cleanIdentity = { checkoutPath: repoRoot, revision: 'abc123456789', worktreeHash: 'clean', sourceFingerprint: 'main@abc123456789:clean' };

test('remembered choice respects explicit choice, choose flag, availability and dirty sources', () => {
    const input = { remembered: 'web', nativeAvailable: false, dirty: false };
    assert.equal(selectChoice(input), 'web');
    assert.equal(selectChoice({ ...input, forceChoice: true }), null);
    assert.equal(selectChoice({ ...input, explicit: 'agenti', forceChoice: true }), 'agenti');
    assert.equal(selectChoice({ ...input, dirty: true }), null);
    assert.equal(selectChoice({ ...input, remembered: 'mac', nativeAvailable: true, dirty: true }), null);
    assert.equal(selectChoice({ ...input, remembered: 'mac' }), null);
    assert.equal(selectChoice({ ...input, remembered: 'sviluppo', dirty: true }), null);
    assert.throws(() => selectChoice({ ...input, explicit: 'mac' }));
    assert.throws(() => parseArguments(['--scelta', 'untrusted']));
    assert.equal(parseArguments(['--scelta', 'web', '--senza-browser']).choice, 'web');
});

test('production reuses only the verified build for the current clean source', () => {
    const verified = { identity: { revision: 'abc1234567890123456789', sourceFingerprint: cleanIdentity.sourceFingerprint } };
    assert.equal(buildDecision(cleanIdentity, null), 'build');
    assert.equal(buildDecision(cleanIdentity, verified), 'reuse');
    assert.equal(buildDecision(cleanIdentity, { identity: { ...verified.identity, revision: 'other' } }), 'build');
    assert.equal(buildDecision(cleanIdentity, { identity: { ...verified.identity, sourceFingerprint: 'another-branch' } }), 'build');
    assert.equal(buildDecision({ ...cleanIdentity, worktreeHash: 'dirty' }, verified), 'development-only');
    assert.throws(() => buildDecision({ ...cleanIdentity, revision: 'unknown' }, null));
});

test('text fallback offers the same available actions and never silently enables development', async () => {
    assert.equal(needsTextMenu('linux', {}), true);
    assert.equal(needsTextMenu('linux', { WAYLAND_DISPLAY: 'wayland-0' }), false);
    assert.equal(needsTextMenu('darwin', {}, 1), true);
    const output = [], answers = ['invalid', '3'];
    assert.equal(await textualChoice({ nativeAvailable: false, dirty: true,
        question: async () => answers.shift(), write: line => output.push(line) }), 'sviluppo');
    assert.ok(output.some(line => line.includes('per sviluppo')));
    assert.equal(await textualChoice({ nativeAvailable: false, dirty: false, question: async () => '', write: () => {} }), 'web');
});

test('preferences are atomically replaced with a readable choice', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-preferences-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'preferences.json');
    atomicJson(file, { schemaVersion: 1, choice: 'web' });
    atomicJson(file, { schemaVersion: 1, choice: 'agenti' });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).choice, 'agenti');
});

test('launcher ownership refuses a live owner and recovers only a dead receipt', t => {
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-owner-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const lock = path.join(root, 'lock');
    claimLauncher(lock, cleanIdentity);
    assert.throws(() => claimLauncher(lock, cleanIdentity), /già in corso/u);
    assert.equal(JSON.parse(readFileSync(path.join(lock, 'instance.json'), 'utf8')).pid, process.pid);
    atomicJson(path.join(lock, 'instance.json'), { pid: 2147483647, checkoutPath: repoRoot });
    claimLauncher(lock, cleanIdentity);
    assert.equal(JSON.parse(readFileSync(path.join(lock, 'instance.json'), 'utf8')).pid, process.pid);
});

async function fakeRuntime(t, fingerprint = cleanIdentity.sourceFingerprint) {
    const server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ revision: cleanIdentity.revision, sourceFingerprint: fingerprint, fingerprint }));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('choice page serves locally, rejects cross-origin actions and redirects only after verified readiness', async (t) => {
    const target = await fakeRuntime(t);
    const state = { ready: false, busy: false, message: 'Scegli', url: null };
    const chosen = [];
    const page = await createChoiceServer({ root: repoRoot, state: () => state,
        choose: (...args) => chosen.push(args), install: () => {}, stop: async () => {} });
    t.after(page.close);
    const response = await fetch(page.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Nel browser/u);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
    const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(page.url).origin }, body: JSON.stringify(body) });
    assert.equal((await fetch(new URL('choose', page.url), { ...post({ choice: 'web' }), headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await fetch(new URL('/state', page.url))).status, 404);
    assert.equal((await fetch(new URL('go', page.url), { redirect: 'manual' })).status, 409);
    assert.equal((await fetch(new URL('choose', page.url), post({ choice: 'web', remember: true }))).status, 202);
    assert.deepEqual(chosen, [['web', true]]);
    const ready = await waitForInstanceAndOpen(target, cleanIdentity.sourceFingerprint, { open: () => 0 });
    assert.equal(ready.ok, true);
    Object.assign(state, { ready: true, url: target });
    const redirect = await fetch(new URL('go', page.url), { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get('location'), target);
});

test('same-folder receipt reuses an exact running instance and refuses changed sources', async (t) => {
    const target = await fakeRuntime(t);
    const page = await createChoiceServer({ root: repoRoot, state: () => ({ ready: true, url: target }),
        choose: () => {}, install: () => {}, stop: async () => {} });
    t.after(page.close);
    const receipt = { pid: process.pid, checkoutPath: repoRoot, choiceUrl: page.url };
    assert.equal((await findExistingInstance(receipt, cleanIdentity)).url, target);
    assert.equal(await findExistingInstance({ ...receipt, checkoutPath: '/another/folder' }, cleanIdentity), null);
    await assert.rejects(findExistingInstance(receipt, { ...cleanIdentity, sourceFingerprint: 'changed' }), /non corrisponde/u);
    await assert.rejects(requireFreePort(Number(new URL(target).port)), /non è disponibile/u);
    assert.equal((await probeRunningInstance(target, cleanIdentity.sourceFingerprint)).ok, true);
});

test('shutdown asks an owned runtime to stop and waits for its exit', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => process.exit(0)); process.on('message', m => { if(m.type === 'mediflow-launcher-stop') process.exit(0); }); process.send('ready');"],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32' });
    await once(child, 'message');
    await stopOwnedChild(child, 3000);
    assert.equal(child.exitCode, 0);
});


import { launcherConfigDirectory, prepareLauncherState } from './launcher-state.mjs';

test('launcher configuration follows the operating system, independently of the archive', () => {
    assert.equal(launcherConfigDirectory({ platform: 'darwin', home: '/Users/synthetic', env: {} }), '/Users/synthetic/Library/Application Support/MediFlow/launcher');
    assert.equal(launcherConfigDirectory({ platform: 'linux', home: '/home/synthetic', env: {} }), '/home/synthetic/.config/mediflow/launcher');
    assert.equal(launcherConfigDirectory({ platform: 'linux', home: '/home/synthetic', env: { XDG_CONFIG_HOME: '/custom/config' } }), '/custom/config/mediflow/launcher');
    assert.equal(launcherConfigDirectory({ platform: 'win32', home: 'C:\\Users\\synthetic', env: { APPDATA: 'C:\\Roaming' } }), 'C:\\Roaming\\MediFlow\\launcher');
    assert.throws(() => launcherConfigDirectory({ platform: 'linux', home: '/home/synthetic', env: { XDG_CONFIG_HOME: 'relative' } }));
});

function launcherStateFixture(t) {
    const home = mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-state-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const dataDir = path.join(home, 'archive');
    const options = { home, env: { MEDIFLOW_DATA_DIR: dataDir, APPDATA: path.join(home, 'Roaming'), XDG_CONFIG_HOME: path.join(home, 'config') } };
    return { home, dataDir, options };
}

test('launcher preferences and ownership never create or write to the selected archive', t => {
    const { home, dataDir, options } = launcherStateFixture(t);
    const state = prepareLauncherState(repoRoot, options);
    assert.equal(existsSync(dataDir), false);
    mkdirSync(dataDir);
    writeFileSync(path.join(dataDir, 'clinical-backup.zip'), 'untouched');
    atomicJson(state.preferencesFile, { schemaVersion: 1, choice: 'web' });
    claimLauncher(state.lockDirectory, cleanIdentity);
    assert.deepEqual(prepareLauncherState(repoRoot, options), state);
    assert.deepEqual(readdirSync(dataDir), ['clinical-backup.zip']);
    assert.equal(readFileSync(path.join(dataDir, 'clinical-backup.zip'), 'utf8'), 'untouched');
    const other = path.join(home, 'other-source');
    mkdirSync(other);
    assert.notEqual(prepareLauncherState(other, options).preferencesFile, state.preferencesFile);
    if (process.platform !== 'win32') {
        for (const directory of [path.dirname(path.dirname(state.preferencesFile)), path.dirname(state.preferencesFile), state.lockDirectory]) {
            assert.equal(statSync(directory).mode & 0o777, 0o700);
        }
        for (const file of [state.preferencesFile, path.join(state.lockDirectory, 'instance.json')]) {
            assert.equal(statSync(file).mode & 0o777, 0o600);
        }
    }
});

test('migration moves only exact launcher preferences and an inactive receipt for this source', t => {
    const { dataDir, options } = launcherStateFixture(t);
    mkdirSync(dataDir);
    const state = prepareLauncherState(repoRoot, options);
    const lock = path.join(dataDir, path.basename(state.lockDirectory));
    mkdirSync(lock);
    atomicJson(path.join(lock, 'instance.json'), { pid: 2147483647, checkoutPath: repoRoot });
    atomicJson(path.join(dataDir, 'launcher-preferences.json'), { schemaVersion: 1, choice: 'web' });
    writeFileSync(path.join(dataDir, 'backup.db'), 'untouched');
    prepareLauncherState(repoRoot, options);
    assert.deepEqual(readdirSync(dataDir), ['backup.db']);
    assert.equal(JSON.parse(readFileSync(state.preferencesFile)).choice, 'web');
    assert.equal(JSON.parse(readFileSync(path.join(path.dirname(state.preferencesFile), 'legacy-instance.json'))).checkoutPath, repoRoot);
});

test('migration preserves unknown files, symlinks and active launcher ownership', t => {
    const { dataDir, options } = launcherStateFixture(t);
    mkdirSync(dataDir);
    const state = prepareLauncherState(repoRoot, options);
    const lock = path.join(dataDir, path.basename(state.lockDirectory));
    mkdirSync(lock);
    atomicJson(path.join(lock, 'instance.json'), { pid: process.pid, checkoutPath: repoRoot });
    assert.throws(() => prepareLauncherState(repoRoot, options), /ancora in corso/u);
    atomicJson(path.join(lock, 'instance.json'), { pid: 2147483647, checkoutPath: '/unknown-source' });
    atomicJson(path.join(dataDir, 'launcher-preferences.json'), { schemaVersion: 1, choice: 'web', unknown: true });
    prepareLauncherState(repoRoot, options);
    assert.equal(existsSync(lock), true);
    assert.equal(existsSync(state.preferencesFile), false);
    rmSync(path.join(dataDir, 'launcher-preferences.json'));
    atomicJson(state.preferencesFile, { schemaVersion: 1, choice: 'agenti' });
    symlinkSync(state.preferencesFile, path.join(dataDir, 'launcher-preferences.json'));
    prepareLauncherState(repoRoot, options);
    assert.equal(readFileSync(path.join(dataDir, 'launcher-preferences.json'), 'utf8'), readFileSync(state.preferencesFile, 'utf8'));
});

test('migration preserves both preferences when a newer configuration already exists', t => {
    const { dataDir, options } = launcherStateFixture(t);
    mkdirSync(dataDir);
    const state = prepareLauncherState(repoRoot, options);
    atomicJson(state.preferencesFile, { schemaVersion: 1, choice: 'agenti' });
    atomicJson(path.join(dataDir, 'launcher-preferences.json'), { schemaVersion: 1, choice: 'web' });
    prepareLauncherState(repoRoot, options);
    assert.deepEqual(readdirSync(dataDir), []);
    assert.equal(JSON.parse(readFileSync(state.preferencesFile)).choice, 'agenti');
    assert.ok(readdirSync(path.dirname(state.preferencesFile)).some(name => name.includes('.migrated-')));
});


test('overlapping configuration and archive paths fail before creating either directory', t => {
    const { home, options } = launcherStateFixture(t);
    const config = path.join(home, 'overlap');
    const platform = process.platform === 'win32' ? 'win32' : 'linux';
    const overlapping = { ...options, platform, env: platform === 'win32' ? { APPDATA: config, MEDIFLOW_DATA_DIR: config } : { XDG_CONFIG_HOME: config, MEDIFLOW_DATA_DIR: config } };
    assert.throws(() => prepareLauncherState(repoRoot, overlapping), /si sovrappone/u);
    assert.equal(existsSync(config), false);
    overlapping.env.MEDIFLOW_DATA_DIR = path.join(config, platform === 'win32' ? 'MediFlow/launcher/clinical' : 'mediflow/launcher/clinical');
    assert.throws(() => prepareLauncherState(repoRoot, overlapping), /si sovrappone/u);
    assert.equal(existsSync(config), false);
});
