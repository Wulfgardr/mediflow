/* real confined probe on this Mac, synthetic targets only. No account, quota or
 * Codex binary: the native custodian applies the profile and probes itself. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { buildMacCustodian, launchMacCustodian } = await import('./execution-mac-native.ts');
const { executionSandboxProfile } = await import('./execution-sandbox.ts');
const { MAC_BOUNDARY_PROBE_CHECKS, macBoundaryProbePassed, parseMacBoundaryProbeLine } = await import('./execution-mac-probe.ts');

const nativeSource = fileURLToPath(new URL('../../native/MediFlowMac/ExecutionCustodian/mac-owner.c', import.meta.url));
const mac = { skip: process.platform !== 'darwin' };
const listen = (server: Server, where: number | string) => new Promise<void>((resolve, reject) => {
    server.once('error', reject); if (typeof where === 'number') server.listen(where, '127.0.0.1', resolve); else server.listen(where, resolve);
});

/** Same layout the qualification prepares, with synthetic home and archive. */
async function probeWith(profile: (root: string, binary: string, proxyPort: number, helper: string, home: string) => string) {
    const root = realpathSync(mkdtempSync('/private/tmp/mfmac-'));
    const outside = realpathSync(mkdtempSync('/private/tmp/mfprobe-targets-'));
    const servers: Server[] = [];
    try {
        chmodSync(root, 0o700);
        for (const name of ['runtime', 'codex', 'work', 'tmp', 'config', 'cache', 'data']) mkdirSync(join(root, name), { mode: 0o700 });
        const home = join(outside, 'home'), data = join(outside, 'data');
        mkdirSync(home); mkdirSync(data); writeFileSync(join(data, 'medical.db'), 'archivio sintetico');
        const native = buildMacCustodian(root, nativeSource);
        writeFileSync(join(root, 'codex', 'config.toml'), 'synthetic = true\n', { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'public-ca.pem'), 'synthetic', { mode: 0o400, flag: 'wx' });
        const proxy = createServer(socket => socket.destroy()), other = createServer(socket => socket.destroy()), unix = createServer(socket => socket.destroy());
        servers.push(proxy, other, unix);
        await listen(proxy, 0); await listen(other, 0); await listen(unix, root + '.sock');
        const port = (server: Server) => (server.address() as { port: number }).port;
        const binary = join(root, 'runtime', 'codex');
        writeFileSync(join(root, 'runtime', 'profile-probe.sb'), profile(root, binary, port(proxy), native.helper, home), { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'probe-ports'), `${port(proxy)} ${port(other)}\n`, { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'probe-paths'), `${home}\n${data}\n${join(data, 'medical.db')}\n/var/run/mDNSResponder\n`, { mode: 0o400, flag: 'wx' });
        writeFileSync(root + '.sentinel', 'MediFlow synthetic boundary sentinel', { mode: 0o600, flag: 'wx' });
        const env = { NODE_ENV: 'production' as const, HOME: root, TMPDIR: join(root, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
        const owner = launchMacCustodian(root, '0123456789abcdef0123456789abcdef', 'probe', env, () => undefined);
        const text = await owner.collect();
        await owner.finished;
        return { checks: parseMacBoundaryProbeLine(text), drained: owner.drained() };
    } finally {
        await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
        for (const path of [root, root + '.sentinel', root + '.sock', root + '.escape', outside]) rmSync(path, { recursive: true, force: true });
    }
}
const failed = (checks: Record<string, string> | null) => MAC_BOUNDARY_PROBE_CHECKS.filter(name => checks?.[name] === 'failed');

test('the production profile passes every check of the real confined probe', mac, async () => {
    const run = await probeWith((root, binary, port, helper) => executionSandboxProfile(root, binary, port, helper));
    assert.ok(run.checks && run.drained);
    assert.deepEqual(failed(run.checks), []);
    assert.equal(macBoundaryProbePassed(run.checks), true);
});
test('a permissive profile fails the probe on every boundary it no longer enforces', mac, async () => {
    const run = await probeWith(() => '(version 1)\n(allow default)\n');
    assert.ok(run.checks && run.drained);
    assert.equal(macBoundaryProbePassed(run.checks), false);
    for (const name of ['outside_read', 'outside_write', 'home_read', 'data_read', 'database_read', 'loopback_other',
        'unix_socket', 'mach_lookup', 'external_network'] as const) assert.equal(run.checks[name], 'failed', name);
});
test('a single widened read of the personal home is caught by its own check', mac, async () => {
    const run = await probeWith((root, binary, port, helper, home) =>
        executionSandboxProfile(root, binary, port, helper) + `(allow file-read* (subpath ${JSON.stringify(home)}))\n`);
    assert.ok(run.checks);
    assert.deepEqual(failed(run.checks), ['home_read']);
});
test('a widened network rule is caught before any provider egress', mac, async () => {
    const run = await probeWith((root, binary, port, helper) => executionSandboxProfile(root, binary, port, helper) + '(allow network-outbound)\n');
    assert.ok(run.checks);
    assert.deepEqual(failed(run.checks), ['loopback_other', 'unix_socket', 'external_network']);
});
test('only a complete, ordered result line counts; absent is allowed for the archive alone', () => {
    const line = (values: string[]) => `MAC_PROBE_V2 ${MAC_BOUNDARY_PROBE_CHECKS.map((name, i) => `${name}=${values[i]}`).join(' ')}\n`;
    const all = MAC_BOUNDARY_PROBE_CHECKS.map(() => '1');
    assert.equal(macBoundaryProbePassed(parseMacBoundaryProbeLine(line(all))!), true);
    const absentDb = all.map((v, i) => MAC_BOUNDARY_PROBE_CHECKS[i] === 'database_read' ? '2' : v);
    assert.equal(macBoundaryProbePassed(parseMacBoundaryProbeLine(line(absentDb))!), true);
    assert.equal(parseMacBoundaryProbeLine(line(all.map((v, i) => i === 0 ? '2' : v))), null);
    assert.equal(parseMacBoundaryProbeLine(line(all).replace('fork=1 spawn=1', 'spawn=1 fork=1')), null);
    assert.equal(parseMacBoundaryProbeLine(line(all).trimEnd()), null);
    assert.equal(parseMacBoundaryProbeLine('MAC_PROBE_OK_V1\n'), null);
});
