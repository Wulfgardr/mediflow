#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { appendFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

function fixtureImportArguments(loader, options) {
    return ['--import', pathToFileURL(loader, options).href];
}

test('fixture preloads accept Windows drive paths and reserved filename characters', t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-preload-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const loader = path.join(directory, 'loader #% name.mjs');
    writeFileSync(loader, 'globalThis.fixturePreloaded = true;');
    const loaded = spawnSync(process.execPath, [...fixtureImportArguments(loader), '-e',
        'if (globalThis.fixturePreloaded !== true) process.exitCode = 7;'], { encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    const windowsPath = 'C:\\synthetic fixture\\loader #% name.mjs';
    const args = fixtureImportArguments(windowsPath, { windows: true });
    assert.deepEqual(args, ['--import', 'file:///C:/synthetic%20fixture/loader%20%23%25%20name.mjs']);
    const rejected = spawnSync(process.execPath, ['--import', windowsPath, '-e', ''], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /ERR_UNSUPPORTED_ESM_URL_SCHEME/u);
});

function launcherReceiptFile(directory) {
    const active = path.join(directory, 'active');
    const generations = existsSync(active) ? readdirSync(active).filter(name => /^owner-[a-f0-9]{32}$/u.test(name)) : [];
    return generations.length === 1 ? path.join(active, generations[0], 'instance.json') : path.join(directory, 'instance.json');
}

function launcherCrashFixture(t) {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-crash-')));
    const lock = path.join(directory, 'lock');
    const children = [];
    t.after(async () => {
        for (const { child, closed } of children) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            await closed;
        }
        rmSync(directory, { recursive: true, force: true });
    });
    function start(pauseAt = '', release = false, legacy = false) {
        const gate = path.join(directory, crypto.randomUUID() + '.resume');
        const child = spawn(process.execPath, ['--input-type=module', '-e', `
            import fs from 'node:fs';
            import path from 'node:path';
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            const identityQueries = [], query = cp.spawnSync;
            cp.spawnSync = (executable, args, options) => {
                const started = performance.now(), result = query(executable, args, options);
                if (process.platform === 'win32' && args?.at(-1)?.includes('Get-Process -Id ')) identityQueries.push({
                    elapsedMs: performance.now() - started, timeout: options.timeout, status: result.status,
                    signal: result.signal, error: result.error?.code,
                    stdout: String(result.stdout ?? '').slice(0, 512), stderr: String(result.stderr ?? '').slice(0, 1024),
                });
                return result;
            };
            const directory = ${JSON.stringify(lock)}, pauseAt = ${JSON.stringify(pauseAt)};
            const output = value => fs.writeSync(1, JSON.stringify(value) + '\\n');
            let paused = false;
            const pause = () => {
                if (paused) return;
                paused = true; output({ type: 'paused', at: pauseAt });
                while (!fs.existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            };
            const mkdir = fs.mkdirSync, rename = fs.renameSync, remove = fs.rmSync, link = fs.linkSync, unlink = fs.unlinkSync;
            fs.mkdirSync = (name, ...args) => {
                const result = mkdir(name, ...args);
                if (pauseAt === 'prepare' && (name === directory + '.recovery' || String(name).startsWith(directory + '.candidate-'))) pause();
                if (pauseAt === 'publish' && name === directory) pause();
                return result;
            };
            fs.renameSync = (source, target) => {
                const detach = (path.dirname(source) === path.join(directory, 'active') && path.basename(source).startsWith('owner-')) || source === path.join(directory, 'active');
                if (pauseAt === 'before-detach' && detach) pause();
                const result = rename(source, target);
                if (pauseAt === 'publish' && (target === directory || target === path.join(directory, 'active'))) pause();
                if (pauseAt === 'migration' && target === path.join(directory, 'protocol.json')) pause();
                if ((pauseAt === 'after-detach' || pauseAt === 'cleanup') && detach) pause();
                return result;
            };
            fs.rmSync = (name, ...args) => {
                const result = remove(name, ...args);
                if (pauseAt === 'cleanup' && name === path.join(directory, 'instance.json')) pause();
                return result;
            };
            fs.linkSync = (source, target) => {
                if (pauseAt === 'before-guard' && target === directory + '.recovery') pause();
                const result = link(source, target);
                if (pauseAt === 'guard' && target === directory + '.recovery') pause();
                return result;
            };
            fs.unlinkSync = name => {
                const result = unlink(name);
                if (pauseAt === 'legacy-unlinked' && name === path.join(directory, 'instance.json')) pause();
                return result;
            };
            syncBuiltinESMExports();
            const launcher = await import(${JSON.stringify(new URL('./mediflow.mjs', import.meta.url).href)});
            const keepAlive = setInterval(() => {}, 1000);
            try {
                let ownership;
                if (${legacy}) {
                    fs.mkdirSync(directory + '.recovery');
                    fs.mkdirSync(directory);
                    const receipt = { pid: process.pid, checkoutPath: ${JSON.stringify(repoRoot)} };
                    fs.writeFileSync(path.join(directory, 'instance.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
                    fs.rmdirSync(directory + '.recovery');
                    ownership = { claimed: true, receipt };
                } else ownership = launcher.claimLauncher(directory, ${JSON.stringify({ checkoutPath: repoRoot })}, { reuseLive: true });
                output({ type: 'result', ...ownership });
                if (${release}) { launcher.releaseLauncher(ownership); output({ type: 'released' }); }
            } catch (error) { output({ type: 'result', error: error.message, code: error.code, identityQueries }); }
            process.once('disconnect', () => clearInterval(keepAlive));
        `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const closed = once(child, 'close'); children.push({ child, closed });
        const events = [], waiting = [];
        let buffer = '', stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdout.on('data', chunk => {
            buffer += chunk;
            while (buffer.includes('\n')) {
                const end = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
                if (waiting.length) waiting.shift()(event); else events.push(event);
            }
        });
        return { child, closed, next: () => events.length ? Promise.resolve(events.shift()) : new Promise(resolve => waiting.push(resolve)),
            resume: () => writeFileSync(gate, ''), stderr: () => stderr };
    }
    return { directory, lock, start };
}

for (const phase of ['prepare', 'guard', 'publish']) test(`SIGKILL during launcher ${phase} cannot strand acquisition`, { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), owner = f.start(phase);
    assert.deepEqual(await owner.next(), { type: 'paused', at: phase });
    owner.child.kill('SIGKILL'); await owner.closed;
    t.diagnostic(JSON.stringify({ phase, signal: owner.child.signalCode, entries: readdirSync(f.directory),
        canonical: existsSync(f.lock) ? readdirSync(f.lock) : null }));
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }).claimed, true);
});

test('SIGKILL after publishing into an initialized protocol container remains recoverable', { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t); releaseLauncher(claimLauncher(f.lock, { checkoutPath: repoRoot }));
    const owner = f.start('publish'); assert.equal((await owner.next()).type, 'paused');
    owner.child.kill('SIGKILL'); await owner.closed;
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }).claimed, true);
});

for (const phase of ['prepare', 'publish']) test(`a legacy launcher paused during ${phase} remains protected even after its unexplained disappearance`, { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), owner = f.start(phase, false, true);
    assert.equal((await owner.next()).type, 'paused');
    const before = readdirSync(f.directory).sort();
    assert.throws(() => claimLauncher(f.lock, { checkoutPath: repoRoot }), /Stato legacy.*quiescenza/u);
    assert.deepEqual(readdirSync(f.directory).sort(), before);
    assert.equal(owner.child.exitCode, null);
    owner.child.kill('SIGKILL'); await owner.closed;
    assert.throws(() => claimLauncher(f.lock, { checkoutPath: repoRoot }), /Stato legacy.*quiescenza/u);
    assert.deepEqual(readdirSync(f.directory).sort(), before);
    if (phase === 'publish') assert.deepEqual(readdirSync(f.lock), []);
});

test('legacy interrupted cleanup and partial receipts require verified quiescence', t => {
    const f = launcherCrashFixture(t); mkdirSync(f.lock);
    assert.throws(() => claimLauncher(f.lock, { checkoutPath: repoRoot }), /Stato legacy.*quiescenza/u);
    assert.deepEqual(readdirSync(f.lock), []);
    const file = path.join(f.lock, 'instance.json'); writeFileSync(file, '{"pid":');
    assert.throws(() => claimLauncher(f.lock, { checkoutPath: repoRoot }), /Stato legacy.*quiescenza/u);
    assert.equal(readFileSync(file, 'utf8'), '{"pid":');
    assert.equal(existsSync(f.lock + '.recovery'), false);
});

test('the complete protocol marker prevents an older launcher from acquiring its anonymous mutex', { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), owned = claimLauncher(f.lock, { checkoutPath: repoRoot });
    const legacy = f.start('', false, true), result = await legacy.next();
    assert.equal(result.code, 'EEXIST'); assert.notEqual(result.claimed, true);
    assert.equal(JSON.parse(readFileSync(owned.receiptFile)).pid, process.pid);
});

test('a legacy acquisition that wins the protocol race remains the only writer', { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), incoming = f.start('before-guard'); assert.equal((await incoming.next()).type, 'paused');
    const legacy = f.start('prepare', false, true); assert.equal((await legacy.next()).type, 'paused');
    incoming.resume(); const denied = await incoming.next();
    assert.match(denied.error, /Stato legacy.*quiescenza/u); assert.notEqual(denied.claimed, true);
    legacy.resume(); const owned = await legacy.next(); assert.equal(owned.claimed, true);
    const current = claimLauncher(f.lock, { checkoutPath: repoRoot }, { reuseLive: true });
    assert.equal(current.claimed, false); assert.equal(current.receipt.pid, legacy.child.pid);
});

test('hard-link aliases of generation ownership and receipt remain denied', t => {
    const f = launcherCrashFixture(t), owned = claimLauncher(f.lock, { checkoutPath: repoRoot });
    for (const file of [owned.receiptFile, path.join(path.dirname(owned.receiptFile), 'owner.json')]) {
        const alias = path.join(f.directory, 'alias'); linkSync(file, alias);
        try { assert.throws(() => claimLauncher(f.lock, { checkoutPath: repoRoot }), /non valido/u); }
        finally { rmSync(alias); }
    }
});

test('an unavailable OS identity query cannot reclaim a live complete generation', t => {
    const f = launcherCrashFixture(t), owned = claimLauncher(f.lock, { checkoutPath: repoRoot });
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict'; import fs from 'node:fs'; import cp from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        const { claimLauncher } = await import(${JSON.stringify(new URL('./mediflow.mjs', import.meta.url).href)});
        const read = fs.readFileSync, run = cp.spawnSync, owner = ${process.pid};
        fs.readFileSync = (file, ...args) => {
            if (file === '/proc/' + owner + '/stat') throw Object.assign(new Error('synthetic inaccessible process'), { code: 'EPERM' });
            return read(file, ...args);
        };
        cp.spawnSync = (file, args, ...rest) => {
            if (args?.includes(String(owner)) || args?.some(arg => String(arg).includes('Get-Process -Id ' + owner + ')'))) return { status: 1, stdout: '' };
            return run(file, args, ...rest);
        };
        syncBuiltinESMExports();
        const ownership = claimLauncher(${JSON.stringify(f.lock)}, { checkoutPath: ${JSON.stringify(repoRoot)} }, { reuseLive: true });
        assert.equal(ownership.claimed, false); assert.equal(ownership.receipt.pid, owner);
    `], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(owned.receiptFile)).pid, process.pid);
});

test('six recoverers of a dead complete generation admit exactly one writer', { timeout: 30000 }, async t => {
    const f = launcherCrashFixture(t), dead = f.start();
    assert.equal((await dead.next()).claimed, true); dead.child.kill('SIGKILL'); await dead.closed;
    const contenders = Array.from({ length: 6 }, () => f.start());
    const results = await Promise.all(contenders.map(async contender => ({ ...await contender.next(), pid: contender.child.pid })));
    const winners = results.filter(result => result.claimed);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(JSON.parse(readFileSync(winners[0].receiptFile)).pid, winners[0].pid);
});

for (const phase of ['migration', 'legacy-unlinked']) test(`SIGKILL during legacy ${phase} keeps the verified dead owner recoverable`, { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t); mkdirSync(f.lock);
    atomicJson(path.join(f.lock, 'instance.json'), { pid: 2147483647, checkoutPath: repoRoot });
    const recovering = f.start(phase); assert.equal((await recovering.next()).type, 'paused');
    recovering.child.kill('SIGKILL'); await recovering.closed;
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }).claimed, true);
});

test('publication primitives reject an existing populated directory and an existing protocol guard', t => {
    const f = launcherCrashFixture(t), source = path.join(f.directory, 'prepared'), target = path.join(f.directory, 'occupied');
    mkdirSync(source); mkdirSync(target); writeFileSync(path.join(source, 'complete'), 'new'); writeFileSync(path.join(target, 'owner'), 'live');
    assert.throws(() => renameSync(source, target));
    assert.equal(readFileSync(path.join(target, 'owner'), 'utf8'), 'live');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        const prepared = ${JSON.stringify(path.join(source, 'complete'))}, guard = ${JSON.stringify(path.join(f.directory, 'guard'))};
        fs.linkSync(prepared, guard);
        try { fs.linkSync(prepared, guard); process.exitCode = 1; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (fs.readFileSync(guard, 'utf8') !== 'new') process.exitCode = 2;
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('missing and partial receipts preserve a live generation and recover only after its death', { timeout: 30000 }, async t => {
    const f = launcherCrashFixture(t);
    for (const mode of ['missing', 'partial', 'empty-object', 'incomplete-object']) {
        const owner = f.start(), original = await owner.next();
        assert.equal(original.claimed, true);
        if (mode === 'missing') rmSync(original.receiptFile);
        else writeFileSync(original.receiptFile, mode === 'partial' ? '{"pid":' : mode === 'empty-object' ? '{}' : JSON.stringify({ pid: owner.child.pid }));
        const current = claimLauncher(f.lock, { checkoutPath: repoRoot }, { reuseLive: true });
        assert.equal(current.claimed, false);
        assert.equal(current.receipt.pid, owner.child.pid);
        owner.child.kill('SIGKILL'); await owner.closed;
        const next = claimLauncher(f.lock, { checkoutPath: repoRoot });
        assert.equal(next.claimed, true);
        assert.notEqual(next.generation, original.generation);
        releaseLauncher(next);
    }
});

test('a live owner paused immediately after publication cannot be replaced', { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), owner = f.start('publish');
    assert.equal((await owner.next()).type, 'paused');
    const current = claimLauncher(f.lock, { checkoutPath: repoRoot }, { reuseLive: true });
    assert.equal(current.claimed, false); assert.equal(current.receipt.pid, owner.child.pid);
    owner.resume(); assert.equal((await owner.next()).claimed, true);
});

test('a delayed recoverer cannot detach the replacement live generation', { timeout: 30000 }, async t => {
    const f = launcherCrashFixture(t), dead = f.start();
    assert.equal((await dead.next()).claimed, true); dead.child.kill('SIGKILL'); await dead.closed;
    const delayed = f.start('before-detach');
    assert.equal((await delayed.next()).type, 'paused');
    const replacement = f.start(), published = await replacement.next();
    assert.equal(published.claimed, true);
    delayed.resume();
    const result = await delayed.next();
    assert.equal(result.claimed, false, JSON.stringify(result));
    assert.equal(result.receipt.pid, replacement.child.pid);
    assert.equal(JSON.parse(readFileSync(published.receiptFile)).pid, replacement.child.pid);
});

test('SIGKILL after recovery detaches a dead generation leaves acquisition recoverable', { timeout: 30000 }, async t => {
    const f = launcherCrashFixture(t), dead = f.start();
    assert.equal((await dead.next()).claimed, true); dead.child.kill('SIGKILL'); await dead.closed;
    const recovering = f.start('after-detach');
    assert.equal((await recovering.next()).type, 'paused');
    recovering.child.kill('SIGKILL'); await recovering.closed;
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }).claimed, true);
});

test('SIGKILL during generation cleanup does not strand the next acquisition', { timeout: 15000 }, async t => {
    const f = launcherCrashFixture(t), owner = f.start('cleanup', true);
    assert.equal((await owner.next()).claimed, true);
    assert.equal((await owner.next()).type, 'paused');
    owner.child.kill('SIGKILL'); await owner.closed;
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }).claimed, true);
});

test('delayed cleanup cannot remove a replacement live generation', { timeout: 30000 }, async t => {
    const f = launcherCrashFixture(t), owner = f.start('cleanup', true);
    assert.equal((await owner.next()).claimed, true); assert.equal((await owner.next()).type, 'paused');
    const replacement = f.start(), published = await replacement.next(); assert.equal(published.claimed, true);
    owner.resume(); assert.equal((await owner.next()).type, 'released');
    assert.equal(JSON.parse(readFileSync(published.receiptFile)).pid, replacement.child.pid);
    assert.equal(claimLauncher(f.lock, { checkoutPath: repoRoot }, { reuseLive: true }).claimed, false);
});

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
import { atomicJson, buildDecision, claimLauncher, releaseLauncher, findExistingInstance, needsTextMenu, parseArguments, requireFreePort, selectChoice, stopOwnedChild, textualChoice } from './mediflow.mjs';
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
    const owned = claimLauncher(lock, cleanIdentity);
    assert.throws(() => claimLauncher(lock, cleanIdentity), /già in corso/u);
    assert.equal(JSON.parse(readFileSync(owned.receiptFile, 'utf8')).pid, process.pid);
    releaseLauncher(owned);
    atomicJson(path.join(lock, 'instance.json'), { pid: 2147483647, checkoutPath: repoRoot });
    claimLauncher(lock, cleanIdentity);
    assert.equal(JSON.parse(readFileSync(launcherReceiptFile(lock), 'utf8')).pid, process.pid);
});

test('launcher ownership recovers a recycled PID but preserves an unverifiable live owner', t => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-recycled-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const lock = path.join(root, 'lock');
    claimLauncher(lock, cleanIdentity);
    let receiptFile = launcherReceiptFile(lock);
    const receipt = JSON.parse(readFileSync(receiptFile));
    assert.equal(typeof receipt.processIdentity, 'string');
    atomicJson(receiptFile, { ...receipt, processIdentity: 'previous-process-generation' });
    atomicJson(path.join(path.dirname(receiptFile), 'owner.json'), { ...receipt, processIdentity: 'previous-process-generation' });
    const owned = claimLauncher(lock, cleanIdentity);
    receiptFile = launcherReceiptFile(lock);
    assert.deepEqual(JSON.parse(readFileSync(receiptFile)), receipt);
    releaseLauncher(owned);
    receiptFile = path.join(lock, 'instance.json');
    atomicJson(receiptFile, { pid: process.pid, checkoutPath: repoRoot });
    assert.throws(() => claimLauncher(lock, cleanIdentity), /già in corso/u);
    assert.deepEqual(JSON.parse(readFileSync(receiptFile)), { pid: process.pid, checkoutPath: repoRoot });
});

test('concurrent launcher acquisition retains a single live writer', async t => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-launcher-contenders-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const lock = path.join(root, 'lock');
    mkdirSync(lock);
    atomicJson(path.join(lock, 'instance.json'), { pid: 2147483647, checkoutPath: repoRoot });
    const children = [];
    t.after(async () => {
        await Promise.all(children.map(async child => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const closed = once(child, 'close'); child.kill(); await closed;
        }));
    });
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', `
            const { claimLauncher } = await import(${JSON.stringify(new URL('./mediflow.mjs', import.meta.url).href)});
            const keepAlive = setInterval(() => {}, 1000);
            try { process.send(claimLauncher(${JSON.stringify(lock)}, ${JSON.stringify(cleanIdentity)}, { reuseLive: true })); }
            catch (error) { process.send({ error: error.message }); }
            process.once('disconnect', () => clearInterval(keepAlive));
        `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        children.push(child);
        const [result] = await once(child, 'message');
        return { ...result, pid: child.pid };
    }));
    const winners = results.filter(result => result.claimed);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(JSON.parse(readFileSync(launcherReceiptFile(lock))).pid, winners[0].pid);
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
    await stopOwnedChild(child, 3000, { allowIpcStop: true });
    assert.equal(child.exitCode, 0);
});

test('Windows shutdown sends no IPC frame without explicit permission', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import assert from 'node:assert/strict';
        import childProcess from 'node:child_process';
        import { EventEmitter } from 'node:events';
        import { syncBuiltinESMExports } from 'node:module';
        const { stopOwnedChild } = await import(${JSON.stringify(new URL('./mediflow.mjs', import.meta.url).href)});
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const frames = [], terminations = [];
        let child;
        childProcess.spawnSync = (command, args) => {
            terminations.push([command, args]);
            queueMicrotask(() => { child.exitCode = 1; child.emit('exit', 1); });
            return { status: 0 };
        };
        syncBuiltinESMExports();
        for (const allowIpcStop of [false, true]) {
            child = new EventEmitter();
            Object.assign(child, { pid: 424242, connected: true, exitCode: null, signalCode: null,
                send(frame, done) { frames.push(frame); done(); queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0); }); } });
            if (allowIpcStop) await stopOwnedChild(child, 1000, { allowIpcStop });
            else await stopOwnedChild(child, 1000);
            assert.equal(child.exitCode, allowIpcStop ? 0 : 1);
            assert.deepEqual(frames, allowIpcStop ? [{ type: 'mediflow-launcher-stop' }] : []);
            assert.deepEqual(terminations, [['taskkill', ['/pid', '424242', '/T', '/F']]]);
        }
    `], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
});


test('owned shutdown requires an observed exit and rejects failed OS termination', () => {
    const result = spawnSync(process.execPath, ['--input-type=module','-e', `
        import assert from 'node:assert/strict'; import cp from 'node:child_process';
        import { EventEmitter } from 'node:events'; import { syncBuiltinESMExports } from 'node:module';
        const { stopOwnedChild } = await import(${JSON.stringify(new URL('./mediflow.mjs', import.meta.url).href)});
        let child, outcome, calls, frames, groupAlive;
        const terminate = () => {
            calls++;
            if (outcome === 'error') throw Object.assign(new Error('synthetic EPERM'),{code:'EPERM'});
            if (outcome === 'status') return {status:1};
            if (outcome === 'exit') setTimeout(()=>{groupAlive=false;child.exitCode=0;child.emit('exit',0);},2);
            return {status:0};
        };
        cp.spawnSync = (command,args,options) => {
            assert.equal(command,'taskkill'); assert.deepEqual(args,['/pid','424242','/T','/F']);
            assert.ok(options.timeout > 0 && options.timeout <= 25);
            try { return terminate(); } catch(error) {return {status:null,error};}
        };
        process.kill = (pid,signal) => {
            assert.equal(pid,-424242);
            if (signal === 0) { if(groupAlive) return true; throw Object.assign(new Error('synthetic absent group'),{code:'ESRCH'}); }
            assert.ok(['SIGTERM','SIGKILL'].includes(signal));
            const result = terminate();
            if(result.status !== 0) throw Object.assign(new Error('synthetic EPERM'),{code:'EPERM'});
            return true;
        };
        syncBuiltinESMExports();
        for (const platform of ['win32','linux']) for (outcome of ['error','status','no-exit','exit','ipc-exit','ipc-error']) {
            for (const allowIpcStop of platform === 'win32' ? [false,true] : [false]) {
                if (outcome.startsWith('ipc-') && !allowIpcStop) continue;
                Object.defineProperty(process,'platform',{value:platform,configurable:true});
                calls=0;frames=[];groupAlive=true;child=new EventEmitter();
                Object.assign(child,{pid:424242,connected:true,exitCode:null,signalCode:null,
                    send(frame,done){frames.push(frame);done(outcome === 'ipc-error' ? Object.assign(new Error('synthetic IPC EPERM'),{code:'EPERM'}) : null);if(outcome === 'ipc-exit') queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});}});
                const pending=stopOwnedChild(child,25,{allowIpcStop});
                if (outcome === 'exit' || outcome === 'ipc-exit') await pending;
                else await assert.rejects(pending,error=>error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED'
                    && (outcome === 'no-exit' ? /Exit.*non osservato/u.test(error.cause?.message)
                        : outcome === 'status' && platform === 'win32' ? /taskkill: 1/u.test(error.cause?.message) : error.cause?.code === 'EPERM'));
                assert.equal(child.listenerCount('exit'),0);
                assert.deepEqual(frames,platform === 'win32' && allowIpcStop ? [{type:'mediflow-launcher-stop'}] : []);
                const count=calls;child.emit('exit',0);
                await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,count);
                console.log(JSON.stringify({platform,outcome,allowIpcStop,calls,exit:child.exitCode}));
            }
        }
    `],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
});

test('POSIX terminal group proof is retained across delayed child exit and repeated stop', () => {
    const result = spawnSync(process.execPath,['--input-type=module','-e',`
        import assert from 'node:assert/strict'; import {EventEmitter} from 'node:events';
        import {stopOwnedChild} from ${JSON.stringify(new URL('./mediflow.mjs',import.meta.url).href)};
        Object.defineProperty(process,'platform',{value:'linux'});
        let probes=0,signals=0;
        process.kill=(pid,signal)=>{
            assert.equal(pid,-424243);
            if(signal !== 0) {signals++;throw new Error('A retired group must never receive another signal');}
            if(++probes !== 1) throw new Error('The retired group ID now belongs to a successor');
            throw Object.assign(new Error('absent original group'),{code:'ESRCH'});
        };
        const child=new EventEmitter();Object.assign(child,{pid:424243,exitCode:null,signalCode:null});
        setTimeout(()=>{child.exitCode=0;child.emit('exit',0);},30);
        await stopOwnedChild(child,50);
        await stopOwnedChild(child,50);
        await new Promise(resolve=>setTimeout(resolve,60));
        assert.equal(probes,1);assert.equal(signals,0);assert.equal(child.listenerCount('exit'),0);
        for(const code of ['EPERM','EIO']) {
            let observations=0;
            process.kill=(pid,signal)=>{assert.equal(pid,-424244);assert.equal(signal,0);observations++;throw Object.assign(new Error(code),{code});};
            const terminalLeader=new EventEmitter();Object.assign(terminalLeader,{pid:424244,exitCode:0,signalCode:null});
            await assert.rejects(stopOwnedChild(terminalLeader,50),error=>error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED' && error.cause.code === code);
            assert.equal(terminalLeader.listenerCount('exit'),0);
            await new Promise(resolve=>setTimeout(resolve,60));assert.equal(observations,1);
        }
    `],{encoding:'utf8',timeout:2000});
    assert.equal(result.status,0,result.stderr);
});

test('POSIX stop drains the native reaped-child batch before signalling a group', {skip:process.platform === 'win32'}, t => {
    const result = spawnSync(process.execPath,['--input-type=module','-e',`
        import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
        import {stopOwnedChild} from ${JSON.stringify(new URL('./mediflow.mjs',import.meta.url).href)};
        const kill=process.kill.bind(process), children=[0,1].map(()=>spawn(process.execPath,['-e',"process.on('message',()=>process.exit(0));process.send('ready')"],{detached:true,stdio:['ignore','ignore','ignore','ipc']}));
        const closed=children.map(child=>once(child,'exit'));
        let pending,observed=null;const calls=[];
        try {
            await Promise.all(children.map(child=>new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(new Error('Owned child readiness timeout')),2000);
                child.once('message',()=>{clearTimeout(timer);resolve();});
                child.once('error',error=>{clearTimeout(timer);reject(error);});
            })));
            for(const child of children) child.once('exit',()=>{
                const other=children.find(value=>value!==child);
                if(pending || other.exitCode !== null || other.signalCode !== null) return;
                let absent=false;try{kill(other.pid,0);}catch(error){if(error.code !== 'ESRCH') throw error;absent=true;}
                if(!absent) return;
                observed={callbackPid:child.pid,reapedPid:other.pid,exitCode:other.exitCode,signalCode:other.signalCode};
                process.kill=(pid,signal)=>{
                    assert.equal(pid,-other.pid);calls.push({pid,signal});return true;
                };
                pending=stopOwnedChild(other,100);pending.catch(()=>{});
            });
            for(const child of children) child.send('exit');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
            await Promise.all(closed);
            assert.ok(observed,'Native pending exit window was not reached');
            await assert.rejects(pending,error=>error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED');
            assert.deepEqual(calls.filter(call=>call.signal !== 0),[],'A reaped leader with a pending Node callback authorised a signal');
            const count=calls.length;
            await new Promise(resolve=>setTimeout(resolve,120));assert.equal(calls.length,count);
            assert.equal(children.reduce((total,child)=>total+child.listenerCount('exit'),0),0);
            console.log(JSON.stringify({node:process.version,uv:process.versions.uv,observed,calls,cleanupConfirmed:true}));
        } finally {
            process.kill=kill;
            for(const child of children) if(child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            await Promise.all(closed);
        }
    `],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stdout+result.stderr);
        t.diagnostic(result.stdout.trim());
});

for (const scenario of ['terminal-first','signal-terminal-first','retry-after-failure','before-term','pending-exit-callback','after-term','before-kill','owned-leader-alive']) {
    test(`POSIX ambiguous group never receives an unowned signal: ${scenario}`, t => {
        const result = spawnSync(process.execPath,['--input-type=module','-e',`
            import assert from 'node:assert/strict'; import {EventEmitter} from 'node:events';
            import {stopOwnedChild} from ${JSON.stringify(new URL('./mediflow.mjs',import.meta.url).href)};
            Object.defineProperty(process,'platform',{value:'linux'});
            const scenario=${JSON.stringify(scenario)}, child=new EventEmitter(), calls=[];
            Object.assign(child,{pid:424245,exitCode:scenario === 'terminal-first' ? 0 : null,signalCode:scenario === 'signal-terminal-first' ? 'SIGTERM' : null});
            let probes=0,absent=false,escalationDue=false;
            const timers=new Set(),immediates=new Set(),later=setTimeout,clearLater=clearTimeout,immediate=setImmediate,clearNow=clearImmediate;
            globalThis.setTimeout=(fn,ms,...args)=>{const handle=later((...values)=>{timers.delete(handle);if(ms === 12) escalationDue=true;fn(...values);},ms,...args);timers.add(handle);return handle;};
            globalThis.clearTimeout=handle=>{timers.delete(handle);clearLater(handle);};
            globalThis.setImmediate=(fn,...args)=>{const handle=immediate((...values)=>{immediates.delete(handle);fn(...values);},...args);immediates.add(handle);return handle;};
            globalThis.clearImmediate=handle=>{immediates.delete(handle);clearNow(handle);};
            process.kill=(pid,signal)=>{
                assert.equal(pid,-child.pid);calls.push({signal,terminal:child.exitCode !== null || child.signalCode !== null});
                if(signal === 0) {
                    if(absent) throw Object.assign(new Error('original group absent'),{code:'ESRCH'});
                    probes++;
                    if(scenario === 'before-term' && probes >= 2) child.exitCode=0;
                    if(scenario === 'before-kill' && escalationDue) child.exitCode=0;
                    return true;
                }
                if(signal === 'SIGTERM') {
                    if(scenario === 'retry-after-failure') {child.exitCode=0;throw Object.assign(new Error('owned command failed'),{code:'EPERM'});}
                    if(scenario === 'after-term') setTimeout(()=>{child.exitCode=0;},2);
                }
                if(signal === 'SIGKILL' && scenario === 'owned-leader-alive') {
                    absent=true;child.signalCode='SIGKILL';child.emit('exit',null,'SIGKILL');
                }
                return true;
            };
            if(scenario === 'pending-exit-callback') queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});
            if(scenario === 'owned-leader-alive') await stopOwnedChild(child,25);
            else await assert.rejects(stopOwnedChild(child,25),error=>error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED');
            assert.equal(timers.size,0);assert.equal(immediates.size,0);
            const signals=calls.filter(call=>call.signal !== 0);
            assert.deepEqual(signals.map(call=>call.signal),scenario === 'owned-leader-alive' ? ['SIGTERM','SIGKILL'] : ['retry-after-failure','after-term','before-kill'].includes(scenario) ? ['SIGTERM'] : []);
            assert.ok(signals.every(call=>!call.terminal),'A non-null signal was sent after the leader became terminal');
            assert.equal(child.listenerCount('exit'),0);
            if(scenario !== 'owned-leader-alive') {
                child.exitCode=0;
                const count=calls.length;
                await assert.rejects(stopOwnedChild(child,25),error=>error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED');
                assert.equal(calls.slice(count).filter(call=>call.signal !== 0).length,0,'Explicit retry signalled an ambiguous successor');
                assert.equal(timers.size,0);assert.equal(immediates.size,0);
            }
            const count=calls.length;
            await new Promise(resolve=>setTimeout(resolve,40));
            assert.equal(calls.length,count,'A late timer observed or signalled a successor');
            assert.equal(child.listenerCount('exit'),0);
            console.log(JSON.stringify({scenario,signals,probes,lateCalls:false,timers:timers.size,immediates:immediates.size}));
        `],{encoding:'utf8',timeout:2000});
        assert.equal(result.status,0,result.stdout+result.stderr);
        t.diagnostic(result.stdout.trim());
    });
}

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
        for (const file of [state.preferencesFile, launcherReceiptFile(state.lockDirectory)]) {
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

async function waitForFixtureClose(closed, timeoutMs = 5000) {
    let timer;
    try {
        return await Promise.race([closed, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Owned fixture process did not close.')), timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}

async function stopFixtureChild(child, closed) {
    if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
            const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8', timeout: 5000 });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stdout + result.stderr);
        } else assert.equal(child.kill('SIGTERM'), true);
    }
    await waitForFixtureClose(closed);
}

const ordinaryFixtureCleanups = new WeakMap();

function registerOrdinaryFixtureCleanup(t, cleanup) {
    let cleanups = ordinaryFixtureCleanups.get(t);
    if (!cleanups) {
        cleanups = [];
        ordinaryFixtureCleanups.set(t, cleanups);
        t.after(async () => {
            const errors = [];
            for (const close of cleanups) try { await close(); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('\n'));
        });
    }
    cleanups.push(cleanup);
}

async function ordinaryLauncherFixture(t, remembered, args = [], reuse = true, webIdentity = true, overrides = {}, initialOwner = null, lifecycle = null) {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-ordinary-launcher-~')));
    const source = path.join(directory, 'source'), home = path.join(directory, 'home'), data = path.join(directory, 'data');
    mkdirSync(path.join(source, 'scripts'), { recursive: true }); mkdirSync(home); mkdirSync(data);
    const stopControl = path.join(directory, 'stop.json'), runtimePid = path.join(directory, 'runtime-pid.json');
    const groupHistory = path.join(directory,'owned-groups.ndjson'), groupCleanup = path.join(directory,'owned-group-cleanup');
    const stopTrace = path.join(directory, 'stop-trace.ndjson'), stopLoader = path.join(directory, 'stop-loader.mjs');
    const observationFile = path.join(directory, 'stop-observation.ndjson'), ownerLoader = path.join(directory, 'owner-loader.mjs');
    const controlRequest = path.join(directory, 'drain-request.json'), controlReply = path.join(directory, 'drain-reply.json');
    const fixtureGeneration = crypto.randomUUID();
    writeFileSync(ownerLoader, String.raw`
            import fs from 'node:fs'; import cp from 'node:child_process'; import crypto from 'node:crypto';
            import { registerHooks, syncBuiltinESMExports } from 'node:module';
            const owned = new Map(), spawn = cp.spawn, run = cp.spawnSync, kill = process.kill.bind(process);
            const record = value => {
                const event = { actualOS: process.platform, ...owned.get(value.pid)?.identity, ...value, at: Date.now() };
                fs.appendFileSync(${JSON.stringify(observationFile)}, JSON.stringify(event) + '\n');
                process.stderr.write('FIXTURE_STOP_OBSERVATION ' + JSON.stringify(event) + '\n');
            };
            globalThis[Symbol.for('mediflow.fixture.stop-observation')] = record;
            cp.spawn = (executable, argv, options) => {
                if (executable !== process.execPath || argv[0] !== ${JSON.stringify(path.join(source, 'scripts/source-runtime.mjs'))}) throw new Error('FIXTURE_FOREIGN_CHILD_DENIED');
                const inheritedStderr = options.stdio[2] === 2;
                const child = spawn(executable, argv, inheritedStderr ? { ...options, stdio: [options.stdio[0], options.stdio[1], 'pipe'] } : options);
                if (inheritedStderr) child.stderr.on('data', bytes => process.stderr.write(bytes));
                const identity = { pid: child.pid, inheritedStderr, node: process.version, execPath: process.execPath, uv: process.versions.uv, generation: crypto.randomUUID(), parentPid: process.pid, executable, argv,
                    pgid: process.platform !== 'win32' && options.detached ? child.pid : null, detached: options.detached };
                const exited = new Promise(resolve => child.once('exit', (code, signal) => { record({ type: 'child-exit', pid: child.pid, code, signal }); resolve(); }));
                const stderrClosed = new Promise(resolve => child.stderr.once('close', () => { record({ type: 'child-stderr-close', pid: child.pid }); resolve(); }));
                owned.set(child.pid, { child, identity, terminal: Promise.all([exited, stderrClosed]) });
                record({ type: 'child-created', pid: child.pid });
                return child;
            };
            if (${process.env.MEDIFLOW_FIXTURE_STOP_DENY === '1'}) {
                process.kill = (pid, signal) => {
                    if (signal !== 0 && [...owned.values()].some(({identity}) => pid === identity.pid || pid === -identity.pgid)) {
                        throw Object.assign(new Error('SYNTHETIC_OBSERVED_STOP_EPERM'), { code: 'EPERM' });
                    }
                    return kill(pid, signal);
                };
                cp.spawnSync = (executable, argv, ...rest) => {
                    if (executable !== 'taskkill') return run(executable, argv, ...rest);
                    if (!owned.has(Number(argv[1]))) throw new Error('FIXTURE_FOREIGN_CHILD_DENIED');
                    return { status: null, error: Object.assign(new Error('SYNTHETIC_OBSERVED_STOP_EPERM'), { code: 'EPERM' }) };
                };
            }
            syncBuiltinESMExports();
            registerHooks({ load(url, context, next) {
                const result = next(url, context);
                if (url === ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/mediflow.mjs')).href)}) {
                    record({ type: 'hook-active', url, node: process.version, execPath: process.execPath, uv: process.versions.uv });
                    const text = String(result.source), from = text.indexOf('export async function stopOwnedChild'), to = text.indexOf('export function installDesktopEntry', from);
                    if (from < 0 || to < from) throw new Error('FIXTURE_STOP_HELPER_NOT_FOUND');
                    const helper = text.slice(from, to).replace('if (settled) return;',
                        'if (settled) return; globalThis[Symbol.for("mediflow.fixture.stop-observation")]({type:"stop-result",pid:child.pid,allowIpcStop,groupAbsent,exitCode:child.exitCode,signalCode:child.signalCode,cause:cause ? {code:cause.code,message:cause.message} : null});');
                    result.source = text.slice(0, from) + helper + text.slice(to);
                }
                return result;
            }});
            const drainOwned = async () => {
                record({ type: 'cleanup-start' });
                if (${Boolean(lifecycle?.group)}) {
                    fs.writeFileSync(${JSON.stringify(groupCleanup)}, 'owned fixture cleanup');
                    const deadline = Date.now() + 2000;
                    for (const {identity} of owned.values()) for (;;) {
                        try { kill(-identity.pgid, 0); }
                        catch (error) { if (error.code === 'ESRCH') break; throw error; }
                        if (Date.now() >= deadline) throw new Error('FIXTURE_COOPERATIVE_GROUP_STILL_PRESENT');
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                } else for (const {child} of owned.values()) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await Promise.all([...owned.values()].map(({terminal}) => terminal));
                for (const {identity} of owned.values()) if (identity.pgid !== null) {
                    try { kill(-identity.pgid, 0); }
                    catch (error) {
                        if (error.code !== 'ESRCH') throw error;
                        record({ type: 'drain-group-absent', pid: identity.pid }); continue;
                    }
                    throw new Error('FIXTURE_OWNED_GROUP_STILL_PRESENT');
                }
                record({ type: 'cleanup-children-terminal' });
            };
            const reply = (request, error = null) => {
                const result = { fixtureGeneration: ${JSON.stringify(fixtureGeneration)}, requestId: request.requestId, pid: process.pid,
                    error: error ? { code: error.code, message: error.message } : null };
                const temporary = ${JSON.stringify(controlReply)} + '.tmp';
                fs.writeFileSync(temporary, JSON.stringify(result), { mode: 0o600 });
                fs.renameSync(temporary, ${JSON.stringify(controlReply)});
                record({ type: 'control-replied', ...result });
            };
            const controlTimer = setInterval(() => {
                if (!fs.existsSync(${JSON.stringify(controlRequest)})) return;
                clearInterval(controlTimer);
                let request;
                try {
                    request = JSON.parse(fs.readFileSync(${JSON.stringify(controlRequest)}, 'utf8'));
                    if (request.fixtureGeneration !== ${JSON.stringify(fixtureGeneration)} || request.pid !== process.pid || typeof request.requestId !== 'string') throw new Error('FIXTURE_CONTROL_SCOPE_DENIED');
                    record({ type: 'control-received', ...request });
                } catch (error) { record({ type: 'control-error', message: error.message }); return; }
                drainOwned().then(() => {
                    if (${JSON.stringify(process.env.MEDIFLOW_FIXTURE_CONTROL_FAULT)} === 'reply-error') throw Object.assign(new Error('SYNTHETIC_FIXTURE_CONTROL_DELIVERY'), { code: 'SYNTHETIC_FIXTURE_CONTROL_DELIVERY' });
                    if (${JSON.stringify(process.env.MEDIFLOW_FIXTURE_CONTROL_FAULT)} === 'terminal-before-reply') {
                        record({ type: 'control-terminal-before-reply', requestId: request.requestId });
                        process.emit('SIGTERM'); return;
                    }
                    reply(request);
                }).catch(error => { record({ type: 'control-error', code: error.code, message: error.message }); reply(request, error); })
                    .catch(error => process.stderr.write('FIXTURE_CONTROL_REPLY_FAILED ' + error.message + '\n', () => {}));
            }, 10);
            controlTimer.unref();
    `);
    if (lifecycle) {
        atomicJson(stopControl, lifecycle);
        if (lifecycle.group) writeFileSync(path.join(source, 'scripts/group-descendant.mjs'), `
            import http from 'node:http'; import fs from 'node:fs';
            fs.appendFileSync(${JSON.stringify(observationFile)}, JSON.stringify({type:'descendant-runtime',pid:process.pid,generation:process.argv[2],node:process.version,execPath:process.execPath,uv:process.versions.uv,actualOS:process.platform,at:Date.now()})+'\\n');
            setInterval(() => { if(fs.existsSync(${JSON.stringify(groupCleanup)})) process.exit(0); },10);
            process.on('SIGTERM', () => {});
            process.once('exit', code => fs.appendFileSync(${JSON.stringify(observationFile)}, JSON.stringify({type:'descendant-terminal',pid:process.pid,generation:process.argv[2],code,at:Date.now()})+'\\n'));
            const server = http.createServer((_request,response) => response.end('owned-descendant-alive'));
            server.listen(0, '127.0.0.1', () => process.send({pid:process.pid,port:server.address().port}));
        `);
        writeFileSync(stopLoader, `
            import fs from 'node:fs'; import cp from 'node:child_process';
            import { registerHooks, syncBuiltinESMExports } from 'node:module';
            const run = cp.spawnSync, nativeKill = process.kill.bind(process);
            const kill = (pid,signal) => {
                if (pid < 0 && !${Boolean(lifecycle.group)}) throw new Error('FIXTURE_NATIVE_GROUP_DENIED');
                return nativeKill(pid,signal);
            };
            const stop = (pid, signal) => {
                const owned = JSON.parse(fs.readFileSync(${JSON.stringify(runtimePid)})).pid;
                if (pid !== owned) throw new Error('FIXTURE_FOREIGN_PID_DENIED');
                const { failure } = JSON.parse(fs.readFileSync(${JSON.stringify(stopControl)}));
                fs.appendFileSync(${JSON.stringify(stopTrace)}, JSON.stringify({pid,signal,failure}) + '\\n');
                if (failure === 'error') throw Object.assign(new Error('SYNTHETIC_STOP_EPERM'), {code:'EPERM'});
                if (failure === 'status') return {status:1};
                if (failure === 'no-exit') return {status:0};
                kill(pid, 'SIGTERM'); return {status:0};
            };
            cp.spawnSync = (command,args,...rest) => {
                if (command !== 'taskkill') return run(command,args,...rest);
                if (args.length !== 4 || args[0] !== '/pid' || args[2] !== '/T' || args[3] !== '/F') throw new Error('FIXTURE_STOP_SCOPE_DENIED');
                try { return stop(Number(args[1]), 'taskkill'); } catch(error) { return {status:null,error}; }
            };
            process.kill = (pid,signal) => pid < 0 && ${Boolean(lifecycle.group)} ? (() => {
                const owned = JSON.parse(fs.readFileSync(${JSON.stringify(runtimePid)})).pid;
                if (pid !== -owned) throw new Error('FIXTURE_FOREIGN_GROUP_DENIED');
                const {failure} = JSON.parse(fs.readFileSync(${JSON.stringify(stopControl)}));
                if (signal === 0 && failure?.startsWith('probe-')) {
                    let terminal = false;
                    try { kill(owned,0); } catch(error) { if(error.code !== 'ESRCH') throw error; terminal = true; }
                    if (terminal) throw Object.assign(new Error('SYNTHETIC_GROUP_' + failure),{code:failure.slice(6)});
                }
                if (signal !== 0) fs.appendFileSync(${JSON.stringify(stopTrace)}, JSON.stringify({pid:owned,signal}) + '\\n');
                if (signal === 'SIGKILL' && failure === 'group-no-exit') return true;
                try { return kill(pid,signal); }
                catch(error) {
                    if(signal === 0) fs.appendFileSync(${JSON.stringify(stopTrace)},JSON.stringify({pid:owned,signal,error:error.code})+'\\n');
                    throw error;
                }
            })() : pid < 0 ? (() => {
                const owned = JSON.parse(fs.readFileSync(${JSON.stringify(runtimePid)})).pid;
                if (pid !== -owned) throw new Error('FIXTURE_FOREIGN_GROUP_DENIED');
                if (signal === 0) return kill(owned,0);
                const result = stop(owned,signal);
                if (result.status !== 0) throw Object.assign(new Error('SYNTHETIC_STOP_EPERM'),{code:'EPERM'});
                return true;
            })() : kill(pid,signal);
            syncBuiltinESMExports();
            process.on('message', frame => { if (frame?.type === 'fixture-signal') process.emit('SIGTERM'); });
            registerHooks({load(url,context,next) {
                const result = next(url,context);
                if (url === ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/mediflow.mjs')).href)}) {
                    process.stderr.write('FIXTURE_STOP_PLATFORM ' + JSON.stringify({actualOS:process.platform,simulatedStopPlatform:${JSON.stringify(lifecycle.platform)},url}) + '\\n');
                    let text = String(result.source);
                    const from = text.indexOf('export async function stopOwnedChild'), to = text.indexOf('export function installDesktopEntry',from);
                    if (from < 0 || to < from) throw new Error('FIXTURE_STOP_HELPER_NOT_FOUND');
                    text = text.slice(0,from) + text.slice(from,to).replaceAll('process.platform', ${JSON.stringify(JSON.stringify(lifecycle.platform))}) + text.slice(to);
                    result.source = text.replace('stopOwnedChild(child, 8000,', 'stopOwnedChild(child, ${lifecycle.group ? 600 : 60},')
                        .replace('const finish = cause => {', 'const finish = cause => { if(cause) process.stderr.write("FIXTURE_STOP_CAUSE " + cause.code + " " + cause.message + String.fromCharCode(10));');
                }
                return result;
            }});`);
    }
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
        import fs from 'node:fs';
        import { spawn } from 'node:child_process';
        import crypto from 'node:crypto';
        import { webIdentityProof } from ${JSON.stringify(new URL('./local-ui-web-identity.mjs', import.meta.url).href)};
        import { installLocalUiWebNavigation } from ${JSON.stringify(new URL('./local-ui-web-navigation.mjs', import.meta.url).href)};
        export const verifySourceRuntime = () => ({ identity: ${JSON.stringify(identity)} });
        if (process.argv[1].endsWith('source-runtime.mjs')) {
            fs.appendFileSync(${JSON.stringify(observationFile)}, JSON.stringify({type:'child-runtime',pid:process.pid,node:process.version,execPath:process.execPath,uv:process.versions.uv,actualOS:process.platform,at:Date.now()})+'\\n');
            ${lifecycle?.group ? `
                setInterval(() => { if(fs.existsSync(${JSON.stringify(groupCleanup)})) process.exit(0); },10);
                const generation = crypto.randomUUID();
                const descendant = spawn(process.execPath,[${JSON.stringify(path.join(source,'scripts/group-descendant.mjs'))},generation],{stdio:['ignore','ignore','pipe','ipc']});
                const recordDescendant = value => fs.appendFileSync(${JSON.stringify(observationFile)}, JSON.stringify({pid:descendant.pid,parentPid:process.pid,generation,actualOS:process.platform,node:process.version,execPath:process.execPath,...value,at:Date.now()})+'\\n');
                recordDescendant({type:'descendant-created'});
                descendant.stderr.resume();
                descendant.once('exit', (code,signal) => recordDescendant({type:'descendant-exit',code,signal}));
                descendant.stderr.once('close', () => recordDescendant({type:'descendant-stderr-close'}));
                fs.appendFileSync(${JSON.stringify(groupHistory)},JSON.stringify({pid:process.pid,descendantPid:descendant.pid,generation})+'\\n');
                const info = await new Promise((resolve,reject) => {
                    const timer = setTimeout(() => reject(new Error('Owned descendant readiness timeout')),2000);
                    descendant.once('message', value => {clearTimeout(timer);resolve(value);});
                    descendant.once('error', error => {clearTimeout(timer);reject(error);});
                });
                fs.writeFileSync(${JSON.stringify(runtimePid)}, JSON.stringify({pid:process.pid,descendantPid:info.pid,port:info.port}));
                process.on('SIGTERM', () => process.exit(0));
            ` : lifecycle ? `fs.writeFileSync(${JSON.stringify(runtimePid)}, JSON.stringify({pid:process.pid}));` : ''}
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
                    const proof = ${JSON.stringify(webIdentity)} === 'invalid-delayed' ? '0'.repeat(64) : webIdentityProof(process.env.MEDIFLOW_LOCAL_UI_WEB_SECRET, challenge);
                    process.stderr.write('FIXTURE_IDENTITY_PROOF\\n');
                    res.setHeader('Content-Length', '64');
                    if (${JSON.stringify(webIdentity)}.toString().endsWith('delayed')) setTimeout(() => res.end(proof), 100); else res.end(proof); return;
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
    if (initialOwner) {
        mkdirSync(stateFiles.lockDirectory);
        atomicJson(path.join(stateFiles.lockDirectory, 'instance.json'), { checkoutPath: identity.checkoutPath, ...initialOwner });
    }
    let output = '';
    const socket = createHttpServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn(process.execPath, [...fixtureImportArguments(ownerLoader), ...(lifecycle ? fixtureImportArguments(stopLoader) : []), path.join(source, 'scripts/mediflow.mjs'), ...(reuse ? ['--riusa'] : []), '--senza-browser', ...args], {
        env: { ...process.env, ...overrides, ...options.env, HOME: home, USERPROFILE: home, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const closed = Promise.all([once(child, 'exit'), once(child.stderr, 'close')]).then(([exit]) => exit);
    let resolveTerminal, terminalFailureObserved = false, cleanupTask = null, ownerRecorded = false, launcherClosed = false, drainTask = null;
    const terminal = new Promise(resolve => { resolveTerminal = resolve; });
    const observations = () => existsSync(observationFile) ? readFileSync(observationFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const recordLauncher = (type, fields = {}) => appendFileSync(observationFile, JSON.stringify({ type, pid: child.pid, at: Date.now(), ...fields }) + '\n');
    {
        child.once('exit', (code, signal) => recordLauncher('launcher-exit', { code, signal }));
        child.stderr.once('close', () => recordLauncher('launcher-stderr-close'));
        closed.then(exit => { launcherClosed = true; resolveTerminal({ type: 'closed', exit }); });
    }
    child.stderr.on('data', chunk => {
        output += chunk;
        if (!ownerRecorded && output.includes('Avvio:')) {
            const file = launcherReceiptFile(stateFiles.lockDirectory);
            recordLauncher('launcher-owner', { receipt: JSON.parse(readFileSync(file)), generation: path.basename(path.dirname(file)) });
            ownerRecorded = true;
        }
        if (String(chunk).includes('Arresto non verificato. Proprietà conservata')) resolveTerminal({ type: 'stop-unconfirmed' });
    });
    const assertObservationHook = () => {
        const hooks = observations().filter(event => event.type === 'hook-active');
        assert.deepEqual(hooks.map(({ url, node, execPath }) => ({ url, node, execPath })),
            [{ url: pathToFileURL(path.join(source, 'scripts/mediflow.mjs')).href, node: process.version, execPath: process.execPath }], output);
    };
    const waitForTerminal = async () => {
        let result;
        try { result = await waitForFixtureClose(terminal, 10_000); }
        catch (error) { result = { type: 'terminal-deadline', message: error.message }; }
        assertObservationHook();
        if (result.type === 'closed') return result.exit;
        terminalFailureObserved = true;
        assert.equal(child.exitCode, null, output); assert.equal(child.signalCode, null, output);
        const current = claimLauncher(stateFiles.lockDirectory, { checkoutPath: source + path.sep }, { reuseLive: true });
        try { assert.equal(current.claimed, false); assert.equal(current.receipt.pid, child.pid); }
        finally { if (current.claimed) releaseLauncher(current); }
        recordLauncher('owner-preserved', { ownerHeld: true, newClaimDenied: true });
        const diagnostic = { result, ownerHeld: true, newClaimDenied: true, observations: observations(), output };
        t.diagnostic(JSON.stringify(diagnostic));
        throw Object.assign(new Error('MEDIFLOW_FIXTURE_TERMINAL_UNCONFIRMED ' + JSON.stringify(diagnostic)), { code: 'MEDIFLOW_FIXTURE_TERMINAL_UNCONFIRMED' });
    };
    const quiescent = new Set();
    const attestQuiescence = () => {
        assertObservationHook();
        const events = observations(), created = events.filter(event => event.type === 'child-created');
        for (const { pid, generation, pgid } of created) {
            for (const type of ['child-exit', 'child-stderr-close']) assert.ok(events.some(event => event.type === type && event.pid === pid && event.generation === generation), JSON.stringify({type,pid,generation,events}));
            if (pgid !== null) {
                assert.throws(() => process.kill(-pgid, 0), { code: 'ESRCH' }, 'Owned fixture group still exists');
                if (!quiescent.has(generation)) recordLauncher('cleanup-group-absent', { pid, generation, pgid });
                quiescent.add(generation);
            }
        }
        for (const descendant of events.filter(event => event.type === 'descendant-created')) {
            assert.ok(created.some(event => event.pid === descendant.parentPid), 'Descendant has no registered owned parent');
            assert.throws(() => process.kill(descendant.pid, 0), { code: 'ESRCH' });
            if (!quiescent.has(descendant.generation)) recordLauncher('cleanup-descendant-absent', { pid: descendant.pid, generation: descendant.generation });
            quiescent.add(descendant.generation);
        }
    };
    const postStop = async phase => {
        const owner = observations().find(event => event.type === 'launcher-owner');
        assert.equal(owner?.receipt.pid, child.pid, 'Owned chooser identity missing');
        const endpoint = new URL('stop', owner.receipt.choiceUrl);
        const response = await fetch(endpoint, { method: 'POST', headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' },
            body: '{}', signal: AbortSignal.timeout(1000) });
        recordLauncher('chooser-stop', { phase, status: response.status });
        assert.equal(response.status, 200);
        await response.text();
    };
    const drain = () => drainTask ||= (async () => {
        const request = { fixtureGeneration, requestId: crypto.randomUUID(), pid: child.pid };
        recordLauncher('control-request', request);
        atomicJson(controlRequest, request);
        const deadline = Date.now() + 5000;
        for (;;) {
            if (existsSync(controlReply)) {
                const result = JSON.parse(readFileSync(controlReply, 'utf8'));
                assert.equal(result.fixtureGeneration, fixtureGeneration, 'FIXTURE_CONTROL_REPLY_MISMATCH');
                assert.equal(result.requestId, request.requestId, 'FIXTURE_CONTROL_REPLY_MISMATCH');
                assert.equal(result.pid, child.pid, 'FIXTURE_CONTROL_REPLY_MISMATCH');
                if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
                recordLauncher('control-acknowledged', { requestId: request.requestId });
                return;
            }
            if (launcherClosed) { recordLauncher('control-closed-before-reply', { requestId: request.requestId }); return; }
            assert.ok(Date.now() < deadline, 'FIXTURE_CONTROL_REPLY_TIMEOUT');
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    })();
    const cleanup = () => cleanupTask ||= (async () => {
        const failures = [];
        try {
            if (!terminalFailureObserved && child.exitCode === null && child.signalCode === null) {
                await postStop('shutdown');
                await waitForTerminal();
            }
        } catch (error) {
            failures.push(error);
            if (!terminalFailureObserved && child.exitCode === null && child.signalCode === null) {
                try { await waitForTerminal(); } catch (terminalError) { failures.push(terminalError); }
            }
        }
        if (child.exitCode === null && child.signalCode === null) {
            try { await drain(); }
            catch (error) { failures.push(error); recordLauncher('control-failed', { code: error.code, message: error.message }); }
        }
        try {
            attestQuiescence();
            if (child.exitCode === null && child.signalCode === null) await postStop('cleanup');
            await waitForFixtureClose(closed);
            attestQuiescence();
        } catch (error) {
            failures.push(error);
            recordLauncher('cleanup-unconfirmed', { message: error.message, observations: observations() });
            if (child.connected) child.disconnect();
            child.stderr.unref(); child.unref();
        }
        const events = observations(), cleanupConfirmed = !events.some(event => event.type === 'cleanup-unconfirmed');
        const receipt = { directory, launcher: child.pid, observations: events, cleanupConfirmed };
        if (process.env.MEDIFLOW_FIXTURE_OBSERVATION_AUDIT) appendFileSync(process.env.MEDIFLOW_FIXTURE_OBSERVATION_AUDIT, JSON.stringify(receipt) + '\n');
        t.diagnostic(JSON.stringify(receipt));
        if (cleanupConfirmed) try { rmSync(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'));
    })();
    registerOrdinaryFixtureCleanup(t, cleanup);
    const until = async predicate => {
        const deadline = Date.now() + 10_000;
        while (!predicate()) {
            assert.equal(child.exitCode, null, output);
            if (Date.now() > deadline) assert.fail(output);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };
    return { source, data, stateFiles, child, closed, until, waitForTerminal, observations, cleanup, stopControl, stopTrace, runtimePid, requestGroupCleanup: () => writeFileSync(groupCleanup,'owned fixture cleanup'), environment: { ...process.env, ...overrides, ...options.env, HOME: home, USERPROFILE: home }, expected: { dataDir: data, sourceFingerprint: identity.sourceFingerprint }, output: () => output };
}


for (const scenario of ['signal','chooser','error','switch','probe-EPERM','probe-EIO','group-no-exit']) {
    test(`POSIX owned group stays claimed until its descendant is terminal: ${scenario}`, {timeout:15000,skip:process.platform === 'win32'}, async t => {
        const failure = scenario === 'switch' ? 'probe-EPERM' : scenario.startsWith('probe-') || scenario === 'group-no-exit' ? scenario : null;
        const f = await ordinaryLauncherFixture(t,'web',['--scelta','web'],true,scenario !== 'error',{},null,{platform:process.platform,group:true,failure});
        if (scenario !== 'error') await f.until(() => f.output().includes('Pronto:'));
        else await f.until(() => existsSync(f.stopTrace));
        const receiptFile = launcherReceiptFile(f.stateFiles.lockDirectory), receipt = JSON.parse(readFileSync(receiptFile));
        const stop = async () => {
            const endpoint = new URL('stop',receipt.choiceUrl);
            const response = await fetch(endpoint,{method:'POST',headers:{Origin:endpoint.origin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)});
            assert.equal(response.status,200); await response.text();
        };
        if (scenario === 'signal') f.child.kill('SIGTERM');
        else if (scenario === 'switch') {
            const endpoint = new URL('choose',receipt.choiceUrl);
            const response = await fetch(endpoint,{method:'POST',headers:{Origin:endpoint.origin,'Content-Type':'application/json'},body:JSON.stringify({choice:'agenti'}),signal:AbortSignal.timeout(1000)});
            assert.equal(response.status,202); await response.text();
        } else if (scenario !== 'error') await stop();
        await f.until(() => existsSync(f.stopTrace));
        const {pid,descendantPid,port} = JSON.parse(readFileSync(f.runtimePid));
        await new Promise(resolve => setTimeout(resolve,80));
        assert.throws(() => process.kill(pid,0),{code:'ESRCH'},'Leader should already be terminal');
        process.kill(descendantPid,0); process.kill(-pid,0);
        assert.equal(await (await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(1000)})).text(),'owned-descendant-alive');
        const assertHeld = () => {
            const candidate = claimLauncher(f.stateFiles.lockDirectory,{checkoutPath:f.source+path.sep},{reuseLive:true});
            try { assert.equal(candidate.claimed,false,'A second writer acquired while a descendant is alive'); }
            finally { if(candidate.claimed) releaseLauncher(candidate); }
            assert.equal(candidate.receipt.pid,f.child.pid);
            assert.equal(JSON.parse(readFileSync(receiptFile)).pid,f.child.pid);
            assert.equal(f.child.exitCode,null,f.output()); assert.equal(f.child.signalCode,null,f.output());
            assert.doesNotMatch(f.output(),/unhandled|MediFlow arrestato\./iu);
        };
        assertHeld();
        await f.until(() => f.output().includes('Arresto non verificato'));
        assertHeld();
        const trace = readFileSync(f.stopTrace,'utf8');
        assert.deepEqual(trace.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.signal !== 0).map(entry => entry.signal),['SIGTERM']);
        const retryAndAssertHeld = async () => {
            const errors = f.output().split('Arresto non verificato').length;
            await stop();
            await f.until(() => f.output().split('Arresto non verificato').length > errors);
            assertHeld(); process.kill(descendantPid,0);
            assert.equal(readFileSync(f.stopTrace,'utf8'),trace,'An explicit retry signalled the ambiguous group');
        };
        await retryAndAssertHeld();
        atomicJson(f.stopControl,{platform:process.platform,group:true,failure:null});
        await retryAndAssertHeld();
        assert.match(f.output().split('FIXTURE_STOP_CAUSE ').at(-1),/^undefined Continuità/u);
        assert.equal(await (await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(1000)})).text(),'owned-descendant-alive');
        f.requestGroupCleanup();
        const deadline = Date.now() + 2000;
        for (const target of [descendantPid,-pid]) for (;;) {
            try { process.kill(target,0); }
            catch(error) { if(error.code === 'ESRCH') break; if(error.code !== 'EPERM') throw error; }
            assert.ok(Date.now() < deadline,'Owned fixture quiescence was not confirmed');
            await new Promise(resolve => setTimeout(resolve,10));
        }
        assertHeld();
        await stop(); await waitForFixtureClose(f.closed);
        assert.throws(() => process.kill(-pid,0),{code:'ESRCH'});
        assert.throws(() => process.kill(descendantPid,0),{code:'ESRCH'});
        await assert.rejects(fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(1000)}));
        assert.equal(existsSync(path.join(f.stateFiles.lockDirectory,'active')),false);
        const successor = claimLauncher(f.stateFiles.lockDirectory,{checkoutPath:f.source+path.sep});
        try {
            assert.equal(successor.claimed,true);
            const finalTrace = readFileSync(f.stopTrace,'utf8');
            assert.deepEqual(finalTrace.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.signal !== 0).map(entry => entry.signal),['SIGTERM']);
            await new Promise(resolve => setTimeout(resolve,650));
            assert.equal(readFileSync(f.stopTrace,'utf8'),finalTrace,'A late timer observed or signalled the retired group');
            assert.equal(JSON.parse(readFileSync(successor.receiptFile)).pid,process.pid);
            process.kill(process.pid,0);
            t.diagnostic(JSON.stringify({scenario,leader:pid,descendant:descendantPid,groupAbsent:true,successor:process.pid,lateSignals:false}));
        } finally { releaseLauncher(successor); }
    });
}

for (const simulatedStopPlatform of ['win32', 'linux']) for (const failure of simulatedStopPlatform === 'win32' ? ['error', 'status', 'no-exit'] : ['error', 'no-exit']) {
    for (const trigger of ['signal', 'chooser', 'error', 'switch']) test(`unconfirmed ${simulatedStopPlatform} ${failure} stop via ${trigger} retains the live owner`, { timeout: 15000 }, async t => {
        const actualOS = process.platform;
        const f = await ordinaryLauncherFixture(t, 'web', ['--scelta', 'web'], true, trigger !== 'error', {}, null, {platform:simulatedStopPlatform,failure});
        if (trigger !== 'error') await f.until(() => f.output().includes('Pronto:'));
        else await f.until(() => existsSync(f.stopTrace));
        const file = launcherReceiptFile(f.stateFiles.lockDirectory), receipt = JSON.parse(readFileSync(file));
        const stop = async () => {
            const endpoint = new URL('stop', receipt.choiceUrl);
            const response = await fetch(endpoint, {method:'POST',headers:{Origin:endpoint.origin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)});
            assert.equal(response.status,200); await response.text();
        };
        if (trigger === 'signal') {
            if (actualOS === 'win32') f.child.send({type:'fixture-signal'});
            else f.child.kill('SIGTERM');
        } else if (trigger === 'chooser') await stop();
        else if (trigger === 'switch') {
            const endpoint = new URL('choose',receipt.choiceUrl);
            const response = await fetch(endpoint,{method:'POST',headers:{Origin:endpoint.origin,'Content-Type':'application/json'},body:JSON.stringify({choice:'agenti'}),signal:AbortSignal.timeout(1000)});
            assert.equal(response.status,202); await response.text();
        }
        await f.until(() => existsSync(f.stopTrace));
        await new Promise(resolve=>setTimeout(resolve,150));
        const pid = JSON.parse(readFileSync(f.runtimePid)).pid;
        process.kill(pid,0);
        const current = claimLauncher(f.stateFiles.lockDirectory,{checkoutPath:f.source+path.sep},{reuseLive:true});
        t.diagnostic(JSON.stringify({actualOS,simulatedStopPlatform,failure,trigger,runtimeAlive:pid,launcher:f.child.pid,claimed:current.claimed}));
        try { assert.equal(current.claimed,false,'A second writer acquired while the owned runtime is alive'); }
        finally { if (current.claimed) releaseLauncher(current); }
        assert.equal(current.receipt.pid,f.child.pid);
        await f.until(() => f.output().includes('Arresto non verificato'));
        assert.equal(f.child.exitCode,null,f.output()); assert.equal(f.child.signalCode,null,f.output());
        assert.equal(JSON.parse(readFileSync(file)).pid,f.child.pid);
        assert.doesNotMatch(f.output(),/unhandled|MediFlow arrestato\./iu);
        const activations = f.output().split('\n').filter(line=>line.startsWith('FIXTURE_STOP_PLATFORM '))
            .map(line=>JSON.parse(line.slice('FIXTURE_STOP_PLATFORM '.length)));
        assert.deepEqual(activations,[{actualOS,simulatedStopPlatform,url:pathToFileURL(path.join(f.source,'scripts/mediflow.mjs')).href}],f.output());
        const frames = f.output().split('\n').filter(line=>line.startsWith('FIXTURE_NAVIGATION '))
            .map(line=>JSON.parse(line.slice('FIXTURE_NAVIGATION '.length)));
        assert.deepEqual(frames,simulatedStopPlatform === 'win32' && trigger !== 'error' ? [{type:'mediflow-launcher-stop'}] : [],f.output());
        const trace = readFileSync(f.stopTrace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
        assert.deepEqual(trace.map(({signal})=>signal),simulatedStopPlatform === 'win32' ? ['taskkill'] : failure === 'error' ? ['SIGTERM'] : ['SIGTERM','SIGKILL']);
        for (const entry of trace) { assert.equal(entry.pid,pid); assert.equal(entry.failure,failure); }
        const causes = f.output().split('\n').filter(line=>line.startsWith('FIXTURE_STOP_CAUSE '));
        const expectedCause = failure === 'error' ? 'EPERM SYNTHETIC_STOP_EPERM'
            : failure === 'status' ? 'undefined taskkill: 1'
                : simulatedStopPlatform === 'win32' ? 'undefined Exit del processo posseduto non osservato.'
                    : 'undefined Exit del processo posseduto o scomparsa del gruppo non osservato.';
        assert.deepEqual(causes,['FIXTURE_STOP_CAUSE '+expectedCause],f.output());
        t.diagnostic(JSON.stringify({actualOS,simulatedStopPlatform,failure,trigger,activations,frames,trace,causes}));
        atomicJson(f.stopControl,{platform:simulatedStopPlatform,failure:null});
        await stop(); await waitForFixtureClose(f.closed);
        assert.equal(existsSync(path.join(f.stateFiles.lockDirectory,'active')),false);
        const successor = claimLauncher(f.stateFiles.lockDirectory,{checkoutPath:f.source+path.sep});
        try {
            assert.equal(successor.claimed,true);
            const finalTrace = readFileSync(f.stopTrace);
            await new Promise(resolve=>setTimeout(resolve,100));
            assert.deepEqual(readFileSync(f.stopTrace),finalTrace,'A late timer signalled the retired runtime');
            assert.equal(JSON.parse(readFileSync(successor.receiptFile)).pid,process.pid);
        } finally { releaseLauncher(successor); }
    });
}

for (const scenario of ['stop-timeout','readiness-error','exit']) test(`CI smoke preserves an unconfirmed runtime and its fixture: ${scenario}`, t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(),'mediflow-smoke-stop-contract-')));
    t.after(()=>rmSync(directory,{recursive:true,force:true}));
    const fixture = path.join(directory,'fixture'), trace = path.join(directory,'result.json'); mkdirSync(fixture);
    const result = spawnSync(process.execPath,['--input-type=module','-e',`
        import fs from 'node:fs'; import {EventEmitter} from 'node:events';
        import {registerHooks,syncBuiltinESMExports} from 'node:module';
        const events={forced:0,removed:0,unhandled:[],error:null};let live=true,spawns=0;
        const primary=new EventEmitter();Object.assign(primary,{pid:424242,exitCode:null,signalCode:null,stderr:new EventEmitter()});
        globalThis[Symbol.for('smoke-owned-fixture')]=primary;
        const remove=fs.rmSync;fs.mkdtempSync=()=>${JSON.stringify(fixture)};
        fs.rmSync=(file,...args)=>{if(file===${JSON.stringify(fixture)}){events.removed++;return;}return remove(file,...args);};
        syncBuiltinESMExports();
        process.on('unhandledRejection',error=>events.unhandled.push(error.message));
        globalThis.fetch=async url=>{
            const pathname=new URL(url).pathname;
            if(pathname.endsWith('/state'))return {json:async()=>({ready:true})};
            if(pathname.endsWith('/go'))return {status:303,headers:{get:()=> 'http://127.0.0.1:3000'}};
            if(pathname.endsWith('/stop')){
                if(${JSON.stringify(scenario)}==='exit')queueMicrotask(()=>{live=false;primary.exitCode=0;primary.emit('exit',0);});
                return {status:200,text:async()=> 'stopping'};
            }
            throw new Error('Unexpected fixture request');
        };
        globalThis[Symbol.for('smoke-probe')]=async()=>{
            if(${JSON.stringify(scenario)}==='readiness-error')throw new Error('SYNTHETIC_READINESS_FAILURE');
            return {ok:live};
        };
        globalThis[Symbol.for('smoke-spawn')]=()=>{
            if(spawns++===0){queueMicrotask(()=>primary.stderr.emit('data','Avvio: http://127.0.0.1:3001/'+ 'a'.repeat(48) +'/'));return primary;}
            const second=new EventEmitter();second.stderr=new EventEmitter();
            queueMicrotask(()=>{second.stderr.emit('data','già attivo');second.emit('exit',0);});return second;
        };
        globalThis[Symbol.for('smoke-force')]=async()=>{events.forced++;if(${JSON.stringify(scenario)}==='stop-timeout')throw new Error('SYNTHETIC_FORCED_STOP_FAILURE');};
        registerHooks({load(url,context,next){
            if(url==='node:child_process')return {format:'module',shortCircuit:true,source:'export const spawn=globalThis[Symbol.for("smoke-spawn")];'};
            if(url===${JSON.stringify(new URL('./launcher-helpers.mjs',import.meta.url).href)})return {format:'module',shortCircuit:true,source:'export const readProductIdentity=()=>({sourceFingerprint:"synthetic"});export const probeRunningInstance=globalThis[Symbol.for("smoke-probe")];'};
            if(url===${JSON.stringify(new URL('./mediflow.mjs',import.meta.url).href)})return {format:'module',shortCircuit:true,source:'export const stopOwnedChild=globalThis[Symbol.for("smoke-force")];'};
            const result=next(url,context);
            if(url===${JSON.stringify(new URL('./ci-start-smoke.mjs',import.meta.url).href)})result.source=String(result.source).replaceAll('15000','60').replaceAll('1000','60');
            return result;
        }});
        const hold=setInterval(()=>{},1000);
        const save=()=>fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({...events,live}));
        const watchdog=setTimeout(()=>{save();process.exit(42);},500);
        try{await import(${JSON.stringify(new URL('./ci-start-smoke.mjs',import.meta.url).href)});}
        catch(error){events.error=error.message;process.exitCode=1;}
        finally{clearTimeout(watchdog);clearInterval(hold);save();}
    `],{env:{...process.env,PORT:'3000'},encoding:'utf8',timeout:2000});
    const observed = JSON.parse(readFileSync(trace));
    t.diagnostic(JSON.stringify({scenario,...observed}));
    assert.equal(result.status,scenario === 'exit' ? 0 : 1,result.stderr);
    assert.deepEqual(observed.unhandled,[]); assert.equal(observed.forced,0);
    assert.equal(observed.removed,scenario === 'exit' ? 1 : 0);
    assert.equal(observed.live,scenario !== 'exit');
    if (scenario === 'readiness-error') assert.equal(observed.error,'SYNTHETIC_READINESS_FAILURE');
    if (scenario === 'stop-timeout') assert.match(observed.error,/arresto.*non verificato/iu);
});

test('headless ordinary runtime cannot acknowledge plugin navigation', async t => {
    const f = await ordinaryLauncherFixture(t, 'agenti');
    await f.until(() => f.output().includes('Pronto:'));
    const receipt = JSON.parse(readFileSync(launcherReceiptFile(f.stateFiles.lockDirectory)));
    const endpoint = new URL('navigate', receipt.choiceUrl);
    const response = await fetch(endpoint, { method: 'POST', headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'history', requestId: crypto.randomUUID(), expiresAt: Date.now() + 5000 }) });
    assert.notEqual(response.status, 202);
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
    await assert.rejects(navigateOwnedLocalUiRuntime(f.child, 'history', new AbortController().signal, Date.now() + 5000, f.expected));
    assert.equal(JSON.parse(readFileSync(f.stateFiles.preferencesFile)).choice, 'agenti');
});

test('ordinary and plugin startup recover a stale owner before choosing pairing', async t => {
    for (const reuse of [false, true]) {
        for (const owner of [{ pid: 2147483647 }, { pid: process.pid, processIdentity: 'previous-process-generation' }]) {
            const f = await ordinaryLauncherFixture(t, 'web', ['--scelta', 'web'], reuse, true, {}, owner);
            await f.until(() => f.output().includes('Pronto:'));
            const receipt = JSON.parse(readFileSync(launcherReceiptFile(f.stateFiles.lockDirectory)));
            assert.equal(receipt.pid, f.child.pid);
            assert.equal(typeof receipt.processIdentity, 'string');
            const state = await (await fetch(new URL('state', receipt.choiceUrl))).json();
            assert.equal(state.navigationReady, true);
            if (reuse) assert.equal(await navigateOwnedLocalUiRuntime(f.child, 'history', AbortSignal.timeout(2000), Date.now() + 1500, f.expected), true);
            if (reuse) assert.equal(JSON.parse(readFileSync(f.stateFiles.preferencesFile)).choice, 'web');
        }
    }
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
    const receiptFile = launcherReceiptFile(f.stateFiles.lockDirectory);
    const original = readFileSync(receiptFile);
    const requests = [];
    const foreign = createHttpServer((request, response) => { requests.push(request.url); response.end('{}'); });
    await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
    const script = `
        import assert from 'node:assert/strict';
        import cp from 'node:child_process';
        import { once } from 'node:events';
        import { registerHooks, syncBuiltinESMExports } from 'node:module';
        const spawn = cp.spawn, launchers = [];
        cp.spawn = (command, args, options) => {
            assert.equal(command, process.execPath);
            assert.deepEqual(args, [${JSON.stringify(path.join(f.source, 'scripts/mediflow.mjs'))}, '--riusa']);
            assert.equal(options.cwd, ${JSON.stringify(f.source)});
            const child = spawn(command, args, options);
            launchers.push({ child, exited: once(child, 'exit') });
            return child;
        };
        syncBuiltinESMExports();
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
        finally {
            try {
                for (const {child} of launchers) if (child.connected) child.disconnect();
                await Promise.all(launchers.map(({exited}) => exited));
                assert.equal(launchers.length, 1);
            } finally { clearInterval(keepAlive); }
        }
    `;
    const deny = async () => {
        const processUnderTest = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, HOME: path.dirname(f.source) + '/home', USERPROFILE: path.dirname(f.source) + '/home',
                XDG_CONFIG_HOME: path.dirname(f.source) + '/home/config', APPDATA: path.dirname(f.source) + '/home/Roaming' } });
        const closed = Promise.all([once(processUnderTest, 'exit'), once(processUnderTest.stderr, 'close')]);
        let stderr = ''; processUnderTest.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => processUnderTest.kill('SIGKILL'), 5000);
        try { const [[status]] = await closed; assert.equal(status, 0, stderr); }
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
    } finally {
        try { writeFileSync(receiptFile, original, { mode: 0o600 }); }
        finally { await new Promise(resolve => { foreign.close(resolve); foreign.closeAllConnections(); }); }
    }
});

for (const scenario of ['remove-error', 'pending-launcher']) test(scenario === 'remove-error'
    ? 'a fixture cleanup error fails visibly without retaining the foreign listener'
    : 'denied fixture launchers exit before their working directory is removed', { timeout: 30000 }, async t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-cleanup-regression-')));
    const trace = path.join(directory, 'fixture.json'), ledger = path.join(directory, 'launchers.ndjson'), loader = path.join(directory, 'fault.mjs');
    writeFileSync(loader, `
        import fs from 'node:fs';
        import path from 'node:path';
        import cp from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        const remove = fs.rmSync, write = fs.writeFileSync, spawn = cp.spawn;
        const record = value => fs.appendFileSync(${JSON.stringify(ledger)}, JSON.stringify(value) + '\\n');
        cp.spawn = (command, args, options) => {
            const child = spawn(command, args, options);
            if (options?.detached && path.basename(options.cwd || '') === 'source') {
                record({pid:child.pid,directory:path.dirname(options.cwd),event:'spawn'});
                child.once('exit', () => record({pid:child.pid,event:'exit'}));
            }
            return child;
        };
        fs.writeFileSync = (file, bytes, ...args) => {
            if (${JSON.stringify(scenario)} === 'pending-launcher' && String(file).endsWith(path.join('source','scripts','mediflow.mjs'))) {
                bytes = String(bytes).replace('await bridgeExistingLocalUi(requestsDirectory,',
                    "const fixtureHold = setInterval(() => {},1000); process.once('disconnect', () => setTimeout(() => clearInterval(fixtureHold),500)); await bridgeExistingLocalUi(requestsDirectory,");
            }
            return write(file, bytes, ...args);
        };
        fs.rmSync = (file, ...args) => {
            if (path.basename(String(file)).startsWith('mediflow-ordinary-launcher-')) {
                fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ directory: String(file) }));
                if (${JSON.stringify(scenario)} === 'remove-error') throw Object.assign(new Error('SYNTHETIC_FIXTURE_CLEANUP_EPERM'), { code: 'EPERM' });
                const events = fs.existsSync(${JSON.stringify(ledger)}) ? fs.readFileSync(${JSON.stringify(ledger)},'utf8').trim().split('\\n').map(JSON.parse) : [];
                const launched = events.filter(event => event.event === 'spawn' && event.directory === String(file));
                if (!launched.length) throw new Error('FIXTURE_LAUNCH_OBSERVATION_MISSING');
                for (const {pid} of launched) {
                    try { process.kill(pid,0); }
                    catch (error) { if(error.code === 'ESRCH') continue; throw error; }
                    throw new Error('SYNTHETIC_FIXTURE_CWD_STILL_OWNED ' + pid);
                }
            }
            return remove(file, ...args);
        };
        syncBuiltinESMExports();`);
    const env = { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(loader).href }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [...fixtureImportArguments(loader), '--test', '--test-isolation=none', '--test-reporter=spec',
        '--test-name-pattern=^plugin refuses forged receipts,', fileURLToPath(import.meta.url)],
        { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    t.after(async () => {
        await stopFixtureChild(child, closed);
        if (existsSync(ledger)) {
            const deadline = Date.now() + 5000;
            for (const {pid,event} of readFileSync(ledger,'utf8').trim().split('\n').map(JSON.parse)) if (event === 'spawn') for (;;) {
                try { process.kill(pid,0); } catch(error) { if(error.code === 'ESRCH') break; throw error; }
                assert.ok(Date.now() < deadline, 'Owned denied launcher did not exit');
                await new Promise(resolve => setTimeout(resolve,10));
            }
        }
        if (existsSync(trace)) rmSync(JSON.parse(readFileSync(trace)).directory, { recursive: true, force: true });
        rmSync(directory, { recursive: true, force: true });
    });
    const [code] = await waitForFixtureClose(closed, 20000);
    assert.equal(code, scenario === 'remove-error' ? 1 : 0, output);
    assert.match(output, scenario === 'remove-error' ? /SYNTHETIC_FIXTURE_CLEANUP_EPERM/u : /pass 1/u);
    assert.match(output, scenario === 'remove-error' ? /fail 1/u : /fail 0/u);
    assert.match(output, /cancelled 0/u);
});

test('disconnecting the plugin leaves its ordinary runtime alive and usable', { timeout: 12000 }, async t => {
    const f = await ordinaryLauncherFixture(t, 'web');
    await f.until(() => f.output().includes('Pronto:'));
    assert.equal(await navigateOwnedLocalUiRuntime(f.child, 'history', new AbortController().signal, Date.now() + 5000, f.expected), true);
    f.child.disconnect();
    const receipt = JSON.parse(readFileSync(launcherReceiptFile(f.stateFiles.lockDirectory)));
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
    await f.waitForTerminal();
    assert.equal(f.child.exitCode, 1);
    assert.equal(existsSync(path.join(f.stateFiles.lockDirectory, 'active')), false);
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
});

test('cancellation during an unverified Web startup sends no navigation frame', async t => {
    const f = await ordinaryLauncherFixture(t, 'web', ['--scelta', 'web'], true, 'invalid-delayed');
    await f.until(() => f.output().includes('FIXTURE_IDENTITY_PROOF'));
    f.child.send({ type: 'mediflow-local-ui-cancel', requestId: crypto.randomUUID() });
    await f.waitForTerminal();
    assert.equal(f.child.exitCode, 1);
    assert.doesNotMatch(f.output(), /FIXTURE_NAVIGATION/);
    const events = f.observations(), created = events.filter(event => event.type === 'child-created');
    assert.equal(created.length, 1);
    assert.deepEqual(events.filter(event => event.type === 'child-runtime').map(({node,execPath}) => ({node,execPath})),
        [{node:process.version,execPath:process.execPath}]);
    assert.equal(created[0].pgid, process.platform === 'win32' ? null : created[0].pid);
    const stopped = events.filter(event => event.type === 'stop-result');
    assert.ok(stopped.length > 0);
    for (const event of stopped) { assert.equal(event.cause, null); assert.equal(event.allowIpcStop, false); }
    assert.equal(events.filter(event => event.type === 'child-exit' && event.generation === created[0].generation).length, 1);
    assert.equal(events.filter(event => event.type === 'child-stderr-close' && event.generation === created[0].generation).length, 1);
});

for (const [name, count, controlFault] of [
    ['cancellation during an unverified Web startup sends no navigation frame', 1],
    ['ordinary and plugin startup recover a stale owner before choosing pairing', 4],
    ['IPC cancellation during the Web identity proof cannot dispatch a late intent', 1],
    ['disconnecting the plugin leaves its ordinary runtime alive and usable', 1],
    ['ordinary and plugin startup recover a stale owner before choosing pairing', 4, 'reply-error'],
    ['disconnecting the plugin leaves its ordinary runtime alive and usable', 1, 'terminal-before-reply'],
]) test(`unverified stop fails visibly and drains all owned fixtures: ${name}${controlFault ? " (" + controlFault + ")" : ""}`, { timeout: 30000 }, async t => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-stop-audit-~')));
    const audit = path.join(directory, 'cleanup.ndjson');
    const env = { ...process.env, MEDIFLOW_FIXTURE_STOP_DENY: '1', MEDIFLOW_FIXTURE_CONTROL_FAULT: controlFault || '', MEDIFLOW_FIXTURE_OBSERVATION_AUDIT: audit };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap',
        '--test-name-pattern=^' + name + '$', fileURLToPath(import.meta.url)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    t.after(async () => { await stopFixtureChild(child, closed); rmSync(directory, { recursive: true, force: true }); });
    const [code] = await waitForFixtureClose(closed, 25000);
    assert.equal(code, 1, output);
    assert.match(output, /MEDIFLOW_FIXTURE_TERMINAL_UNCONFIRMED/u);
    assert.match(output, /fail 1/u); assert.match(output, /cancelled 0/u);
    assert.doesNotMatch(output, /asynchronous activity|uncaughtException|unhandledRejection/u);
    if (controlFault === 'reply-error') assert.match(output, /SYNTHETIC_FIXTURE_CONTROL_DELIVERY/u);
    if (name !== 'cancellation during an unverified Web startup sends no navigation frame') assert.match(output, /failureType: 'hookFailed'/u);
    const receipts = readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(receipts.length, count, output);
    for (const { observations: events, cleanupConfirmed, directory: fixture, launcher } of receipts) {
        assert.equal(cleanupConfirmed, true);
        assert.equal(existsSync(fixture), false);
        assert.equal(events.filter(event => event.type === 'hook-active' && event.node === process.version && event.execPath === process.execPath && event.url === pathToFileURL(path.join(fixture, 'source/scripts/mediflow.mjs')).href && event.url.includes('%7E')).length, 1);
        assert.ok(events.some(event => event.type === 'stop-result' && event.cause?.code === 'EPERM' && event.cause.message === 'SYNTHETIC_OBSERVED_STOP_EPERM'));
        const held = events.findIndex(event => event.type === 'owner-preserved' && event.ownerHeld && event.newClaimDenied);
        assert.ok(held >= 0 && held < events.findIndex(event => event.type === 'cleanup-start'));
        const created = events.filter(event => event.type === 'child-created');
        assert.equal(created.length, 1);
        assert.deepEqual(created.map(({actualOS,node,execPath,uv}) => ({actualOS,node,execPath,uv})),
            [{actualOS:process.platform,node:process.version,execPath:process.execPath,uv:process.versions.uv}]);
        for (const { pid, generation } of created) for (const type of ['child-exit', 'child-stderr-close']) {
            assert.equal(events.filter(event => event.type === type && event.pid === pid && event.generation === generation).length, 1);
        }
        assert.equal(events.filter(event => event.type === 'cleanup-group-absent').length, process.platform === 'win32' ? 0 : 1);
        assert.equal(events.filter(event => event.type === 'launcher-exit' && event.pid === launcher).length, 1);
        assert.equal(events.filter(event => event.type === 'launcher-stderr-close').length, 1);
        const requests = events.filter(event => event.type === 'control-request');
        assert.equal(requests.length, 1);
        assert.equal(events.filter(event => event.type === 'control-received' && event.requestId === requests[0].requestId && event.fixtureGeneration === requests[0].fixtureGeneration && event.pid === launcher).length, 1);
        if (controlFault === 'terminal-before-reply') {
            assert.equal(events.filter(event => event.type === 'control-closed-before-reply').length, 1);
            assert.equal(events.filter(event => event.type === 'control-acknowledged').length, 0);
        } else assert.equal(events.filter(event => event.type === 'control-replied' && event.requestId === requests[0].requestId).length, 1);
        if (controlFault === 'reply-error') assert.ok(events.some(event => event.type === 'control-failed' && event.code === 'SYNTHETIC_FIXTURE_CONTROL_DELIVERY'));

    }
    t.diagnostic(JSON.stringify({ expectedFailure: true, exit: code, failureType: output.match(/failureType: '([^']+)'/u)?.[1], receipts }));
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
    const receipt = JSON.parse(readFileSync(launcherReceiptFile(f.stateFiles.lockDirectory)));
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
        const receipt = JSON.parse(readFileSync(launcherReceiptFile(f.stateFiles.lockDirectory)));
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
