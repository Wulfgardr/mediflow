#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { navigateOwnedLocalUiRuntime } from './local-ui-runtime.mjs';
import { createServer as createHttpServer } from 'node:http';

test('IPC navigation rejects a disconnected generation and an already cancelled request', async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'identity', cancelled.signal));
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'SYNTHETIC_SENTINEL', AbortSignal.timeout(2000)));
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
});

test('ordinary launcher forwards only closed navigation intents without giving the caller runtime shutdown ownership', async () => {
    const intents = [];
    let stopped = false;
    const page = await createChoiceServer({ root: repoRoot,
        state: () => ({ ready: true, navigationReady: true, url: 'http://127.0.0.1:32123' }),
        choose() {}, install() {}, stop() { stopped = true; },
        navigate(intent) { intents.push(intent); },
    });
    try {
        const endpoint = new URL('navigate', page.url);
        const post = body => fetch(endpoint, { method: 'POST',
            headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), expiresAt: Date.now() + 5000, ...body }) });
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


test('cold plugin startup forwards ordinary launcher environment and preserves the remembered choice', t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-plugin-environment-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source'), data = path.join(directory, 'data');
    mkdirSync(source); mkdirSync(data);
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { registerHooks } from 'node:module';
        import { EventEmitter } from 'node:events';
        const launcherHelpers = ${JSON.stringify(new URL('./launcher-helpers.mjs', import.meta.url).href)};
        const launcherState = ${JSON.stringify(new URL('./launcher-state.mjs', import.meta.url).href)};
        globalThis.captureSpawn = (_exe, args, options) => {
            process.stdout.write(JSON.stringify({ args, env: options.env }));
            const child = new EventEmitter(); child.unref = () => {};
            queueMicrotask(() => child.emit('error', new Error('synthetic-stop')));
            return child;
        };
        registerHooks({ load(url, context, nextLoad) {
            if (url === launcherHelpers) return { format: 'module', shortCircuit: true, source:
                'export const readProductIdentity = () => ({ worktreeHash: "clean", revision: "aaaaaaaaaaaa" }); export const probeRunningInstance = () => {};'};
            if (url === launcherState) return { format: 'module', shortCircuit: true, source:
                'export const prepareLauncherState = () => ({ lockDirectory: ' + JSON.stringify(${JSON.stringify(directory)}) + ' });' };
            if (url === 'node:child_process') return { format: 'module', shortCircuit: true, source:
                'export const spawn = globalThis.captureSpawn;' };
            return nextLoad(url, context);
        } });
        const { createLocalUiRuntimeNavigator } = await import(${JSON.stringify(new URL('./local-ui-runtime.mjs', import.meta.url).href)});
        const navigate = createLocalUiRuntimeNavigator({ sourceRoot: ${JSON.stringify(source)}, dataDir: ${JSON.stringify(data)}, revision: 'a'.repeat(40) });
        try { await navigate('history', new AbortController().signal); } catch (error) {
            if (error.message !== 'navigation_unavailable') throw error;
        }
    `], { encoding: 'utf8', env: { ...process.env,
        HOME: directory, LANG: 'it_IT.UTF-8', TMPDIR: directory, XDG_CONFIG_HOME: path.join(directory, 'config'),
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', SYNTHETIC_E2E_FLAG: '1',
        MEDIFLOW_PLUGIN_TEST_SECRET: 'never-forward', NODE_OPTIONS: '',
        MEDIFLOW_ATHENA_MLX_GENERATE_BIN: '/synthetic/runner', MEDIFLOW_ATHENA_MODEL_DIR: '/synthetic/model',
        MEDIFLOW_ATHENA_MLX_PYTHON: '3.12', MEDIFLOW_ATHENA_MLX_LM_PACKAGE: 'mlx-lm==0.29.1',
        MEDIFLOW_ATHENA_MAX_TOKENS: '512', MEDIFLOW_ATHENA_SEED: '17', MEDIFLOW_UVX_BIN: '/synthetic/uvx',
    } });
    assert.equal(result.status, 0, result.stderr);
    const { args, env } = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(env).filter(key => /E2E/iu.test(key)), []);
    for (const [key, value] of Object.entries({ HOME: directory, LANG: 'it_IT.UTF-8', TMPDIR: directory,
        XDG_CONFIG_HOME: path.join(directory, 'config'), MEDIFLOW_DATA_DIR: data })) assert.equal(env[key], value, key);
    for (const name of ['MEDIFLOW_ATHENA_MLX_GENERATE_BIN', 'MEDIFLOW_ATHENA_MODEL_DIR', 'MEDIFLOW_ATHENA_MLX_PYTHON',
        'MEDIFLOW_ATHENA_MLX_LM_PACKAGE', 'MEDIFLOW_ATHENA_MAX_TOKENS', 'MEDIFLOW_ATHENA_SEED', 'MEDIFLOW_UVX_BIN']) {
        assert.equal(env[name], ({ MEDIFLOW_ATHENA_MLX_GENERATE_BIN: '/synthetic/runner', MEDIFLOW_ATHENA_MODEL_DIR: '/synthetic/model',
          MEDIFLOW_ATHENA_MLX_PYTHON: '3.12', MEDIFLOW_ATHENA_MLX_LM_PACKAGE: 'mlx-lm==0.29.1',
          MEDIFLOW_ATHENA_MAX_TOKENS: '512', MEDIFLOW_ATHENA_SEED: '17', MEDIFLOW_UVX_BIN: '/synthetic/uvx' })[name], name);
    }
    assert.equal(env.MEDIFLOW_PLUGIN_TEST_SECRET, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.PATH, `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`);
    assert.deepEqual(args.slice(1), ['--riusa']);
});

async function ordinaryLauncherFixture(t, remembered, args = [], reuse = true, webIdentity = true, overrides = {}) {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-ordinary-launcher-')));
    const source = path.join(directory, 'source'), home = path.join(directory, 'home'), data = path.join(directory, 'data');
    mkdirSync(path.join(source, 'scripts'), { recursive: true }); mkdirSync(home); mkdirSync(data);
    for (const name of ['mediflow.mjs', 'mediflow-launcher-page.mjs', 'launcher-state.mjs', 'local-ui-web-identity.mjs', 'local-ui-pairing-transport.mjs']) {
        const bytes = readFileSync(path.join(repoRoot, 'scripts', name), 'utf8');
        writeFileSync(path.join(source, 'scripts', name), name === 'mediflow.mjs' ? bytes.replace('const startOptionalOllama = () => {', 'const startOptionalOllama = () => { process.stderr.write(\"FIXTURE_OLLAMA_START\\n\"); return;') : bytes);
    }
    mkdirSync(path.join(source, 'node_modules/next'), { recursive: true });
    mkdirSync(path.join(source, 'node_modules/better-sqlite3'), { recursive: true });
    writeFileSync(path.join(source, 'node_modules/next/package.json'), '{}');
    writeFileSync(path.join(source, 'node_modules/better-sqlite3/package.json'), '{}');
    const identity = { checkoutPath: source + path.sep, revision: 'aaaaaaaaaaaa', worktreeHash: 'clean', sourceFingerprint: 'synthetic@aaaaaaaaaaaa:clean' };
    writeFileSync(path.join(source, 'scripts/launcher-helpers.mjs'), `
        export * from ${JSON.stringify(new URL('./launcher-helpers.mjs', import.meta.url).href)};
        export const checkNode = () => ({ ok: true });
        export const knownMainUpdates = () => 0;
        export const openUrl = url => { process.stderr.write('FIXTURE_OPEN ' + url + '\\n'); return 0; };
        export const readProductIdentity = () => (${JSON.stringify(identity)});`);
    writeFileSync(path.join(source, 'scripts/build-input-metadata.mjs'), 'export const macDerivedDataDirectory = () => "/synthetic-no-native";');
    writeFileSync(path.join(source, 'scripts/source-runtime.mjs'), `
        import http from 'node:http';
        import { webIdentityProof } from ${JSON.stringify(new URL('./local-ui-web-identity.mjs', import.meta.url).href)};
        import { installLocalUiWebNavigation } from ${JSON.stringify(new URL('./local-ui-web-navigation.mjs', import.meta.url).href)};
        export const verifySourceRuntime = () => ({ identity: ${JSON.stringify(identity)} });
        if (process.argv[1].endsWith('source-runtime.mjs')) {
            let live = true;
            const pairing = () => globalThis[Symbol.for('mediflow.local-ui.pairing.v1')];
            installLocalUiWebNavigation(process, 'http://127.0.0.1:' + process.env.PORT, () => {});
            const server = http.createServer(async (_req, res) => {
                if (_req.url === '/fixture-pairing') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(pairing().snapshot())); return; }
                if (_req.url === '/fixture-decision') { let body = ''; for await (const part of _req) body += part;
                    const value = JSON.parse(body); const ok = pairing().decide(value.nonce, value.allow, {current:()=>live}, value.code);
                    res.end(JSON.stringify({ok})); return; }
                if (_req.url === '/fixture-lock') { live = false; pairing().snapshot(); res.end('{}'); return; }
                if (_req.url === '/fixture-env') { res.end(JSON.stringify(process.env)); return; }
                if (${JSON.stringify(webIdentity)} && _req.url === '/api/plugin-local-ui/identity') {
                    let challenge = ''; for await (const part of _req) challenge += part;
                    const proof = webIdentityProof(process.env.MEDIFLOW_LOCAL_UI_WEB_SECRET, challenge);
                    process.stderr.write('FIXTURE_IDENTITY_PROOF\\n');
                    res.setHeader('Content-Length', '64');
                    if (${JSON.stringify(webIdentity)} === 'delayed') setTimeout(() => res.end(proof), 100); else res.end(proof); return;
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ...${JSON.stringify(identity)}, fingerprint: 'synthetic' })); });
            server.listen(Number(process.env.PORT), '127.0.0.1', () => {
                process.stderr.write('MEDIFLOW_HEADLESS_WEB_READY ' + JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port }) + '\\n');
            });
            process.on('message', frame => process.stderr.write('FIXTURE_NAVIGATION ' + JSON.stringify(frame) + '\\n'));
            process.on('SIGTERM', () => { server.close(); process.disconnect?.(); });
        }`);
    const options = { home, env: { MEDIFLOW_DATA_DIR: data, XDG_CONFIG_HOME: path.join(home, 'config'), APPDATA: path.join(home, 'Roaming') } };
    const launcherStateSource = new URL('./launcher-state.mjs', import.meta.url).href;
    const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { prepareLauncherState } = await import(${JSON.stringify(launcherStateSource)});
        console.log(JSON.stringify(prepareLauncherState(${JSON.stringify(source)}, ${JSON.stringify(options)})));`], { encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    const stateFiles = JSON.parse(setup.stdout);
    atomicJson(stateFiles.preferencesFile, { schemaVersion: 1, choice: remembered });
    let output = '';
    const socket = createHttpServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn(process.execPath, [path.join(source, 'scripts/mediflow.mjs'), ...(reuse ? ['--riusa'] : []), '--senza-browser', ...args], {
        env: { ...process.env, ...overrides, ...options.env, HOME: home, USERPROFILE: home, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
        rmSync(directory, { recursive: true, force: true });
    });
    child.stderr.on('data', chunk => { output += chunk; });
    const until = async predicate => {
        const deadline = Date.now() + 10_000;
        while (!predicate()) {
            assert.equal(child.exitCode, null, output);
            if (Date.now() > deadline) assert.fail(output);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };
    return { source, data, stateFiles, child, until, environment: { ...process.env, ...overrides, ...options.env, HOME: home, USERPROFILE: home }, expected: { dataDir: data, sourceFingerprint: identity.sourceFingerprint }, output: () => output };
}

test('headless ordinary runtime cannot acknowledge plugin navigation', async t => {
    const f = await ordinaryLauncherFixture(t, 'agenti');
    await f.until(() => f.output().includes('Pronto:'));
    const receipt = JSON.parse(readFileSync(path.join(f.stateFiles.lockDirectory, 'instance.json')));
    const endpoint = new URL('navigate', receipt.choiceUrl);
    const response = await fetch(endpoint, { method: 'POST', headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'history', requestId: crypto.randomUUID(), expiresAt: Date.now() + 5000 }) });
    assert.notEqual(response.status, 202);
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'history', new AbortController().signal, Date.now() + 5000, f.expected));
    assert.equal(JSON.parse(readFileSync(f.stateFiles.preferencesFile)).choice, 'agenti');
});

test('cancelled navigation is bound to its request and cannot dispatch after a delayed handoff', async () => {
    const intents = [];
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const page = await createChoiceServer({ root: repoRoot,
        state: () => ({ ready: true, navigationReady: true }), choose() {}, install() {}, stop() {},
        async navigate(intent, request) { entered(); await gate; request.signal.throwIfAborted(); intents.push(intent); },
    });
    const endpoint = new URL('navigate', page.url), requestId = crypto.randomUUID();
    const post = (route, body, signal) => fetch(new URL(route, page.url), { method: 'POST', signal,
        headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const controller = new AbortController();
    try {
        const pending = post('navigate', { intent: 'history', requestId, expiresAt: Date.now() + 5000 }, controller.signal);
        // If the protocol is missing, the old launcher returns immediately instead of entering the handoff.
        await Promise.race([waiting, pending.then(r => assert.equal(r.status, 202))]);
        controller.abort();
        await assert.rejects(pending);
        assert.equal((await post('cancel-navigation', { requestId })).status, 202);
        release(); await new Promise(resolve => setTimeout(resolve, 20));
        assert.deepEqual(intents, []);
        assert.notEqual((await post('navigate', { intent: 'identity', requestId, expiresAt: Date.now() + 5000 })).status, 202);
    } finally { release(); await page.close(); }
});

test('internal reuse startup never overwrites ordinary preferences', async t => {
    const f = await ordinaryLauncherFixture(t, 'agenti', ['--scelta', 'web']);
    await f.until(() => f.output().includes('Pronto:'));
    assert.equal(JSON.parse(readFileSync(f.stateFiles.preferencesFile)).choice, 'agenti');
});

test('ordinary web runtime accepts navigation and keeps remembered preferences', async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    assert.equal(await navigateOwnedLocalUiRuntime(f.child, 'history', new AbortController().signal, Date.now() + 5000, f.expected), true);
    await f.until(() => f.output().includes('FIXTURE_NAVIGATION'));
    assert.equal(JSON.parse(readFileSync(f.stateFiles.preferencesFile)).choice, 'web');
});


test('IPC cancellation revokes exactly its request before a delayed acknowledgement', async () => {
    const { EventEmitter } = await import('node:events');
    const child = new EventEmitter();
    Object.assign(child, { connected: true, exitCode: null, signalCode: null });
    const frames = [];
    child.send = (frame, done) => { frames.push(frame); done(); };
    const controller = new AbortController();
    const pending = navigateOwnedLocalUiRuntime(child, 'history', controller.signal);
    controller.abort(); await assert.rejects(pending);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].type, 'mediflow-local-ui-cancel');
    assert.equal(frames[1].requestId, frames[0].requestId);
    child.emit('message', { type: 'mediflow-local-ui-result', requestId: frames[0].requestId, status: 'accepted' });
    assert.equal(child.listenerCount('message'), 0);
});

test('a rejected navigation handoff revokes its request before returning an error', async () => {
    const revoked = [], requestId = crypto.randomUUID();
    const page = await createChoiceServer({ root: repoRoot, state: () => ({ ready: true, navigationReady: true }),
        choose() {}, install() {}, stop() {}, navigate() { throw new Error('synthetic handoff failure'); },
        cancelNavigation(id) { revoked.push(id); },
    });
    try {
        const endpoint = new URL('navigate', page.url);
        const response = await fetch(endpoint, { method: 'POST', headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent: 'history', requestId, expiresAt: Date.now() + 5000 }) });
        assert.notEqual(response.status, 202); assert.deepEqual(revoked, [requestId]);
    } finally { await page.close(); }
});


test('reuse-only startup retains ordinary optional service initialization', async t => {
    for (const reuse of [false, true]) {
        const f = await ordinaryLauncherFixture(t, 'web', [], reuse);
        await f.until(() => f.output().includes('Pronto:'));
        assert.equal(f.output().split('FIXTURE_OLLAMA_START').length - 1, 1, `reuse=${reuse}`);
    }
});

test('a public fingerprint and forged live PID cannot authorize a foreign listener', async () => {
    const sourceFingerprint = 'synthetic@0123456789ab:clean';
    const received = [];
    const server = createHttpServer((request, response) => {
        received.push(request.url);
        response.setHeader('Content-Type', 'application/json');
        if (request.url.endsWith('/state')) response.end(JSON.stringify({ ready: true, navigationReady: true, url: origin }));
        else if (request.url.endsWith('/navigate')) { response.statusCode = 202; response.end(); }
        else response.end(JSON.stringify({ revision: '0123456789ab', sourceFingerprint, fingerprint: 'public' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const pid of [process.pid, 1]) await assert.rejects(navigateOwnedLocalUiRuntime({ pid, checkoutPath: repoRoot,
            dataDir: '/synthetic-only', choiceUrl: origin + '/' + 'a'.repeat(48) + '/' },
            'history', new AbortController().signal), /navigation_unavailable/);
        assert.deepEqual(received, []);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('README reproduces the preference-preserving reuse-only invocation', () => {
    const readme = readFileSync(path.join(repoRoot, 'plugins/mediflow-local-ui/README.md'), 'utf8');
    assert.match(readme, /node scripts\/mediflow\.mjs --riusa/);
    assert.doesNotMatch(readme, /--scelta web --senza-browser --riusa/);
});


test('plugin refuses forged receipts, replacement ports and lock directory aliases at the real entry', async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    const requests = [];
    const foreign = createHttpServer((request, response) => { requests.push(request.url); response.end('{}'); });
    await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => foreign.close(resolve)));
    const receiptFile = path.join(f.stateFiles.lockDirectory, 'instance.json');
    const original = readFileSync(receiptFile);
    const script = `
        import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
            if (url === ${JSON.stringify(new URL('./launcher-helpers.mjs', import.meta.url).href)}) return { format: 'module', shortCircuit: true,
                source: 'export const readProductIdentity = () => ({ worktreeHash: "clean", revision: "aaaaaaaaaaaa" });' };
            return next(url, context);
        } });
        const { createLocalUiRuntimeNavigator } = await import(${JSON.stringify(new URL('./local-ui-runtime.mjs', import.meta.url).href)});
        const navigate = createLocalUiRuntimeNavigator({ sourceRoot: ${JSON.stringify(f.source)}, dataDir: ${JSON.stringify(f.data)}, revision: 'a'.repeat(40) });
        const keepAlive = setInterval(() => {}, 1000);
        try { await navigate('history', AbortSignal.timeout(3000)); process.exitCode = 7; }
        catch (error) { if (error.message !== 'navigation_unavailable') throw error; }
        finally { clearInterval(keepAlive); }
    `;
    const deny = async () => {
        const processUnderTest = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, HOME: path.dirname(f.source) + '/home', USERPROFILE: path.dirname(f.source) + '/home',
                XDG_CONFIG_HOME: path.dirname(f.source) + '/home/config', APPDATA: path.dirname(f.source) + '/home/Roaming' } });
        let stderr = ''; processUnderTest.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => processUnderTest.kill('SIGKILL'), 5000);
        try { const [status] = await once(processUnderTest, 'exit'); assert.equal(status, 0, stderr); }
        finally { clearTimeout(timer); }
    };
    try {
        for (const pid of [process.pid, 1]) {
            atomicJson(receiptFile, { pid, checkoutPath: f.source + path.sep, dataDir: f.data,
                choiceUrl: `http://127.0.0.1:${foreign.address().port}/${'a'.repeat(48)}/` });
            await deny();
        }
        const reusedPort = foreign.address().port;
        await new Promise(resolve => foreign.close(resolve));
        await new Promise(resolve => foreign.listen(reusedPort, '127.0.0.1', resolve));
        await deny();
        const lock = f.stateFiles.lockDirectory, moved = lock + '.synthetic';
        renameSync(lock, moved); symlinkSync(moved, lock, 'dir');
        try { await deny(); } finally { rmSync(lock); renameSync(moved, lock); }
        rmSync(receiptFile); symlinkSync(f.stateFiles.preferencesFile, receiptFile);
        try { await deny(); } finally { rmSync(receiptFile); }
        assert.deepEqual(requests, []);
    } finally { writeFileSync(receiptFile, original, { mode: 0o600 }); }
});

test('disconnecting the plugin leaves its ordinary runtime alive and usable', { timeout: 12000 }, async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    assert.equal(await navigateOwnedLocalUiRuntime(f.child, 'history', new AbortController().signal, Date.now() + 5000, f.expected), true);
    f.child.disconnect();
    const receipt = JSON.parse(readFileSync(path.join(f.stateFiles.lockDirectory, 'instance.json')));
    const state = await (await fetch(new URL('state', receipt.choiceUrl), { signal: AbortSignal.timeout(3000) })).json();
    assert.equal(state.ready, true);
    assert.equal((await fetch(state.url, { signal: AbortSignal.timeout(3000) })).status, 200);
    assert.equal(f.child.exitCode, null);
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'search', new AbortController().signal), /navigation_unavailable/);
});


test('IPC rejects replay, expiry, revoked IDs and extra fields without new navigation', async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    const send = frame => new Promise(resolve => {
        const receive = result => { if (result.requestId === frame.requestId) { f.child.off('message', receive); resolve(result.status); } };
        f.child.on('message', receive); f.child.send(frame);
    });
    const request = { type: 'mediflow-local-ui-navigate', requestId: crypto.randomUUID(), intent: 'identity', expiresAt: Date.now() + 5000, ...f.expected };
    assert.equal(await send(request), 'accepted');
    assert.equal(await send(request), 'denied');
    for (const frame of [{ ...request, requestId: crypto.randomUUID(), expiresAt: Date.now() - 1 },
        { ...request, requestId: crypto.randomUUID(), patientId: 'SYNTHETIC_SENTINEL' }]) assert.equal(await send(frame), 'denied');
    const revoked = { ...request, requestId: crypto.randomUUID() };
    f.child.send({ type: 'mediflow-local-ui-cancel', requestId: revoked.requestId });
    assert.equal(await send(revoked), 'denied');
    await f.until(() => f.output().includes('FIXTURE_NAVIGATION'));
    const navigation = f.output().split('\n').filter(line => line.includes('mediflow.local-ui.navigation.v1'));
    assert.equal(navigation.length, 1);
});


test('the inherited peer must retain the expected archive and source generation', async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    for (const expected of [{ dataDir: '/different-archive', sourceFingerprint: 'synthetic@aaaaaaaaaaaa:clean' },
        { dataDir: f.data, sourceFingerprint: 'different-generation' }]) {
        await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'history', AbortSignal.timeout(2000), Date.now() + 5000, expected));
    }
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
});


test('cold navigator waits for the inherited peer handshake before its first request', t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-ipc-handshake-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source'), data = path.join(directory, 'data');
    mkdirSync(path.join(source, 'scripts'), { recursive: true }); mkdirSync(data);
    writeFileSync(path.join(source, 'scripts/mediflow.mjs'), `
        process.on('message', () => {});
        process.once('disconnect', () => process.exit(0));
        setTimeout(() => {
            process.on('message', frame => {
                if (frame.type === 'mediflow-local-ui-navigate') process.send({type:'mediflow-local-ui-result',requestId:frame.requestId,status:'accepted'});
            });
            process.send({type:'mediflow-local-ui-connected',dataDir:process.env.MEDIFLOW_DATA_DIR,sourceFingerprint:'synthetic'});
        }, 100);`);
    const script = `
        import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
            if (url === ${JSON.stringify(new URL('./launcher-helpers.mjs', import.meta.url).href)}) return { format: 'module', shortCircuit: true,
                source: 'export const readProductIdentity = () => ({ worktreeHash: "clean", revision: "aaaaaaaaaaaa", sourceFingerprint:"synthetic" });' };
            return next(url, context);
        } });
        const { createLocalUiRuntimeNavigator } = await import(${JSON.stringify(new URL('./local-ui-runtime.mjs', import.meta.url).href)});
        const keepAlive = setInterval(() => {}, 1000);
        try { await createLocalUiRuntimeNavigator({sourceRoot:${JSON.stringify(source)}, dataDir:${JSON.stringify(data)}, revision:'a'.repeat(40)})('history',AbortSignal.timeout(1500)); }
        finally {clearInterval(keepAlive);}
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 4000, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
});


test('a public revision response cannot establish owned Web identity', async t => {
    const f = await ordinaryLauncherFixture(t, 'web', ['--scelta', 'web'], true, false);
    await f.until(() => f.output().includes('Pronto:') || f.output().includes('identità Web'));
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'history', AbortSignal.timeout(2000), Date.now() + 1500, f.expected));
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
});

test('cold navigator restarts after the owned launcher exits after handshake', t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-ipc-handshake-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source'), data = path.join(directory, 'data');
    mkdirSync(path.join(source, 'scripts'), { recursive: true }); mkdirSync(data);
    writeFileSync(path.join(source, 'scripts/mediflow.mjs'), `
        process.on('message', () => {});
        process.once('disconnect', () => process.exit(0));
        setTimeout(() => {
            process.on('message', frame => {
                if (frame.type === 'mediflow-local-ui-navigate') { process.send({type:'mediflow-local-ui-result',requestId:frame.requestId,status:'accepted'}, () => { process.disconnect(); process.exit(0); }); }
            });
            process.send({type:'mediflow-local-ui-connected',dataDir:process.env.MEDIFLOW_DATA_DIR,sourceFingerprint:'synthetic'});
        }, 100);`);
    const script = `
        import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
            if (url === ${JSON.stringify(new URL('./launcher-helpers.mjs', import.meta.url).href)}) return { format: 'module', shortCircuit: true,
                source: 'export const readProductIdentity = () => ({ worktreeHash: "clean", revision: "aaaaaaaaaaaa", sourceFingerprint:"synthetic" });' };
            return next(url, context);
        } });
        const { createLocalUiRuntimeNavigator } = await import(${JSON.stringify(new URL('./local-ui-runtime.mjs', import.meta.url).href)});
        const keepAlive = setInterval(() => {}, 1000);
        try { const navigate = createLocalUiRuntimeNavigator({sourceRoot:${JSON.stringify(source)}, dataDir:${JSON.stringify(data)}, revision:'a'.repeat(40)}); await navigate('history',AbortSignal.timeout(1500)); await new Promise(r=>setTimeout(r,150)); await navigate('identity',AbortSignal.timeout(1500)); }
        finally {clearInterval(keepAlive);}
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 4000, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('an existing ordinary launcher pairs only after code confirmation in its Web and revokes on lock', async t => {
    const f = await ordinaryLauncherFixture(t, 'web', [], false);
    await f.until(() => f.output().includes('Pronto:'));
    const receipt = JSON.parse(readFileSync(path.join(f.stateFiles.lockDirectory, 'instance.json')));
    const state = await (await fetch(new URL('state', receipt.choiceUrl))).json();
    let output = '';
    const bridge = spawn(process.execPath, [path.join(f.source, 'scripts/mediflow.mjs'), '--riusa'], {
        env: f.environment, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    bridge.stderr.on('data', chunk => { output += chunk; });
    t.after(async () => { if (bridge.connected) { const exited = once(bridge, 'exit'); bridge.disconnect(); await exited; } });
    await f.until(() => output.includes('FIXTURE_OPEN '));
    const codeUrl = output.match(/FIXTURE_OPEN (http[^\s]+)/u)[1];
    const html = await (await fetch(codeUrl)).text();
    const code = html.match(/<code[^>]*>([a-f0-9]{24})<\/code>/u)[1];
    let pending;
    for (let index = 0; index < 100; index++) {
        pending = (await (await fetch(state.url + '/fixture-pairing')).json()).pending[0];
        if (pending) break;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(pending);
    assert.equal(await navigateOwnedLocalUiRuntime(bridge, 'history', AbortSignal.timeout(1500), Date.now()+1400, f.expected), false);
    const decision = await fetch(state.url + '/fixture-decision', { method: 'POST', body: JSON.stringify({nonce:pending.nonce, allow:true, code}) });
    assert.equal((await decision.json()).ok, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await navigateOwnedLocalUiRuntime(bridge, 'history', AbortSignal.timeout(1500), Date.now()+1400, f.expected), true);
    await fetch(state.url + '/fixture-lock');
    await f.until(() => !bridge.connected);
    await assert.rejects(navigateOwnedLocalUiRuntime(bridge, 'identity', AbortSignal.timeout(1000), Date.now()+900, f.expected));
    assert.equal((await (await fetch(state.url + '/fixture-pairing')).json()).active.length, 0);
    assert.equal(f.child.exitCode, null);
});

test('ordinary Web children preserve supported configuration through the plugin environment', async t => {
    const configured = { MEDIFLOW_ATHENA_MLX_GENERATE_BIN:'/synthetic/runner', MEDIFLOW_ATHENA_MODEL_DIR:'/synthetic/model',
      MEDIFLOW_ATHENA_MLX_PYTHON:'3.12', MEDIFLOW_ATHENA_MLX_LM_PACKAGE:'mlx-lm==0.29.1',
      MEDIFLOW_ATHENA_MAX_TOKENS:'512', MEDIFLOW_ATHENA_SEED:'17', MEDIFLOW_UVX_BIN:'/synthetic/uvx',
      MEDIFLOW_ICD_WHO_ENABLED:'1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST:'synthetic-image',
      MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID:'synthetic-dataset', MEDIFLOW_NETWORK_DISABLED:'1', MEDIFLOW_ATTACHMENT_MAX_BYTES:'4096' };
    const { ordinaryLauncherEnvironment } = await import('../plugins/mediflow-local-ui/src/runtime-environment.mjs');
    const environments = [];
    for (const [reuse, config] of [[false, configured], [true, ordinaryLauncherEnvironment('/synthetic', configured)]]) {
        const f = await ordinaryLauncherFixture(t, 'web', [], reuse, true, config);
        await f.until(() => f.output().includes('Pronto:'));
        const receipt = JSON.parse(readFileSync(path.join(f.stateFiles.lockDirectory, 'instance.json')));
        const state = await (await fetch(new URL('state', receipt.choiceUrl))).json();
        const environment = await (await fetch(state.url + '/fixture-env')).json();
        environments.push(Object.fromEntries(Object.keys(configured).map(key=>[key,environment[key]])));
    }
    assert.deepEqual(environments[1], environments[0]);
    assert.deepEqual(environments[0], configured);
});


test('IPC cancellation during the Web identity proof cannot dispatch a late intent', async t => {
    const f = await ordinaryLauncherFixture(t, 'web', [], true, 'delayed');
    await f.until(() => f.output().includes('Pronto:'));
    const requestId = crypto.randomUUID();
    const result = new Promise(resolve => { const receive = frame => { if(frame.requestId === requestId) { f.child.off('message',receive); resolve(frame.status); } }; f.child.on('message',receive); });
    f.child.send({type:'mediflow-local-ui-navigate',requestId,intent:'history',expiresAt:Date.now()+5000,...f.expected});
    await f.until(() => (f.output().match(/FIXTURE_IDENTITY_PROOF/gu) ?? []).length >= 2);
    f.child.send({type:'mediflow-local-ui-cancel',requestId});
    assert.equal(await result, 'denied');
    assert.doesNotMatch(f.output(), /mediflow.local-ui.navigation.v1/);
});
