/* @Codex — real macOS-only native tests over synthetic processes, never a provider,
 * account, fabricated OS receipt or issuer. Non-Mac skip is NOT an acceptance pass.
 * node scripts/run-strip-types.mjs --test native/MediFlowMac/ExecutionCustodian/custodian.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:net';
import { Duplex } from 'node:stream';
const { buildMacCustodian, launchMacCustodian, MacNativeBuildError } = await import('../../../lib/chatgpt-execution/execution-mac-native.ts');
const { executionSandboxProfile, EXECUTION_CONFIG } = await import('../../../lib/chatgpt-execution/execution-sandbox.ts');
const { MacOwnerSequence, parseMacOwnerFrame } = await import('../../../lib/chatgpt-execution/execution-mac-state.ts');
const nonce = '0123456789abcdef0123456789abcdef';
const syntheticStub = `#define _DARWIN_C_SOURCE 1
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
int main(int argc, char **argv) {
 if (argc == 2 && !strcmp(argv[1], "--version")) { puts("SYNTHETIC_CUSTODY_TEST_ONLY"); return 0; }
 signal(SIGTERM, SIG_IGN);
 for (;;) pause();
 return 1;
}
`;
async function bounded<T>(work: Promise<T>, ms = 8000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('native-test-timeout')), ms); })]); }
    finally { clearTimeout(timer); }
}
async function fixture() {
    assert.notEqual(process.getuid?.(), 0, 'nonprivileged Mac required; never run sudo');
    const root = realpathSync(mkdtempSync('/private/tmp/mfmac-native-test-')); chmodSync(root, 0o700);
    const servers: Server[] = [], owners: ReturnType<typeof launchMacCustodian>[] = [];
    let unsafe = false;
    for (const name of ['runtime', 'codex', 'work', 'tmp', 'config', 'cache', 'data']) mkdirSync(join(root, name), { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', HOME: root, TMPDIR: join(root, 'tmp'), CODEX_HOME: join(root, 'codex'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
    const command = (path: string, args: string[]) => {
        const result = spawnSync(path, args, { cwd: root, env, shell: false, timeout: 30000, maxBuffer: 16384, encoding: 'utf8' });
        if (result.error || result.signal) unsafe = true;
        assert.equal(result.status, 0, 'fixed local native test command failed (no upstream/credential log)');
        return result.stdout.trim();
    };
    async function dispose() {
        for (const owner of owners) owner.close();
        try { await bounded(Promise.all(owners.map(owner => owner.finished))); } catch { unsafe = true; }
        if (owners.some(owner => !owner.drained())) unsafe = true;
        for (const server of servers) await bounded(new Promise<void>(resolve => server.close(() => resolve())));
        if (unsafe) throw new Error(`unconfirmed-owned-drain; retain only this synthetic root: ${root}`);
        rmSync(root, { recursive: true, force: false });
        for (const suffix of ['.sock', '.sentinel']) { try { rmSync(root + suffix); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    }
    try {
        const source = join(dirname(fileURLToPath(import.meta.url)), 'mac-owner.c');
        const native = buildMacCustodian(root, source);
        const compiler = realpathSync(command('/usr/bin/xcrun', ['--find', 'clang']));
        const sdk = command('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
        command('/usr/bin/codesign', ['--verify', '--strict', '-R', '=anchor apple', compiler]);
        writeFileSync(join(root, 'runtime', 'synthetic.c'), syntheticStub, { mode: 0o400, flag: 'wx' });
        const binary = join(root, 'runtime', 'codex');
        command(compiler, ['-std=c11', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk, '-mmacosx-version-min=13.0', join(root, 'runtime', 'synthetic.c'), '-o', binary]);
        chmodSync(binary, 0o500);
        async function listener(path?: string) {
            const server = createServer(socket => { socket.on('error', () => undefined); socket.destroy(); }); servers.push(server);
            await new Promise<void>((resolve, reject) => { server.once('error', reject); if (path) server.listen(path, resolve); else server.listen(0, '127.0.0.1', resolve); });
            const address = server.address(); return address && typeof address !== 'string' ? address.port : 0;
        }
        const proxyPort = await listener(), deniedPort = await listener(); await listener(root + '.sock');
        writeFileSync(root + '.sentinel', 'native-test-sentinel', { mode: 0o600, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'probe-ports'), `${proxyPort} ${deniedPort}\n`, { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'codex', 'config.toml'), EXECUTION_CONFIG, { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'public-ca.pem'), 'PUBLIC_CA_SYNTHETIC_TEST_ONLY', { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'profile.sb'), executionSandboxProfile(root, binary, proxyPort), { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'profile-probe.sb'), executionSandboxProfile(root, binary, proxyPort, native.helper), { mode: 0o400, flag: 'wx' });
        return { root, native, env, dispose, markUnsafe: () => { unsafe = true; },
            owner(mode: 'probe' | 'version' | 'server') { const owner = launchMacCustodian(root, nonce, mode, env, () => undefined); owners.push(owner); return owner; } };
    } catch (e) { if (e instanceof MacNativeBuildError && e.drainUnconfirmed) unsafe = true; await dispose(); throw e; }
}
test('native: fast exec readiness, setsid/no descendants, protected files, IPC, direct reap and lease', {
    skip: process.platform !== 'darwin', timeout: 120000,
}, async t => {
    const f = await fixture();
    try {
        await t.test('20 fast version exits retain READY/START/STOP and direct reaping evidence', async () => {
            for (let i = 0; i < 20; i++) {
                const owner = f.owner('version'), output = owner.collect(); void output.catch(() => undefined);
                await bounded(owner.started);
                assert.equal(await bounded(output), 'SYNTHETIC_CUSTODY_TEST_ONLY\n');
                assert.equal(owner.drained(), true); assert.equal(owner.live(), false);
            }
        });
        await t.test('same native profile: no fork/posix_spawn, changed session, config/CA, TCP/Unix/Mach', async () => {
            const owner = f.owner('probe'), output = owner.collect(); void output.catch(() => undefined);
            await bounded(owner.started);
            assert.equal(await bounded(output), 'MAC_PROBE_OK_V1\n');
            assert.equal(owner.drained(), true); assert.equal(owner.live(), false);
            assert.equal(readFileSync(f.root + '.sentinel', 'utf8'), 'native-test-sentinel');
            assert.equal(readFileSync(join(f.root, 'codex', 'config.toml'), 'utf8'), EXECUTION_CONFIG);
        });
        await t.test('SIGTERM-resistant synthetic process closes with authenticated native reaping', async () => {
            const owner = f.owner('server'); await bounded(owner.started);
            assert.equal(owner.live(), true); assert.equal(owner.drained(), false);
            owner.close(); assert.equal(owner.live(), false);
            await bounded(owner.finished);
            assert.equal(owner.drained(), true); assert.ok(owner.exitCode() === -9 || owner.exitCode() === -15);
        });
        await t.test('lost JS lease withdraws even when cleanup is authentically proved', async () => {
            const child = spawn(f.native.helper, ['server', f.root, nonce], { cwd: join(f.root, 'work'), env: f.env, shell: false,
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
            const channel = child.stdio[3]; assert.ok(channel instanceof Duplex);
            const state = new MacOwnerSequence(); let buffer = '', protocolError: unknown;
            child.stdout!.resume(); child.stderr!.resume(); child.stdin!.end();
            channel.on('error', e => { protocolError = e; });
            channel.on('data', (chunk: Buffer) => {
                try {
                    buffer += chunk.toString('ascii');
                    let end;
                    while ((end = buffer.indexOf('\n')) >= 0) {
                        state.accept(parseMacOwnerFrame(buffer.slice(0, end), nonce), performance.now()); buffer = buffer.slice(end + 1);
                    }
                    assert.ok(buffer.length <= 160);
                } catch (e) { protocolError = e; channel.end('C\n'); }
            });
            // One initial lease only: no timer, heartbeat or fabricated STOP.
            channel.write('P\n');
            try {
                await bounded(new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { state.exited(code, signal); resolve(); }); }));
                assert.equal(protocolError, undefined); assert.equal(buffer, '');
                assert.equal(state.reason, 2); assert.equal(state.failed, true); assert.equal(state.live(performance.now()), false);
                assert.equal(state.drained, true);
            } catch (e) { f.markUnsafe(); if (!channel.destroyed) channel.end('C\n'); throw e; }
        });
    } finally { await f.dispose(); }
});
