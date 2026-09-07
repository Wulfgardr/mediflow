/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountHost } from '../../lib/chatgpt-account/account-host';

// This executable fixture owns only synthetic state. It never calls Codex or a network.
const fixtureSource = `#!${process.execPath}
/* @Codex: synthetic app-server executable. */
const fs = require('node:fs');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
        fs.writeFileSync(process.env.CODEX_HOME + '/synthetic-state', 'synthetic-only');
        process.stdout.write(JSON.stringify({ id: request.id, result: {
            userAgent: 'synthetic', home: process.env.HOME, codexHome: process.env.CODEX_HOME,
            cwd: process.cwd(), argv: process.argv.slice(2), envKeys: Object.keys(process.env),
            config: fs.readFileSync(process.env.CODEX_HOME + '/config.toml', 'utf8'), pid: process.pid
        } }) + '\\n');
    }
});
`;

test('host spawns an isolated executable with fixed argv/env, private homes, and verified cleanup/restart', async () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'mediflow-account-fixture-'));
    const binary = join(fixtures, 'synthetic-codex'); writeFileSync(binary, fixtureSource, { mode: 0o700 }); chmodSync(binary, 0o700);
    const host = createAccountHost(binary);
    const roots: string[] = [];
    try {
        assert.equal(host.configured, true);
        for (let attempt = 0; attempt < 2; attempt++) {
            const transport = await host.createTransport();
            const value = await transport.request('initialize', {}) as { home: string; codexHome: string; cwd: string; argv: string[]; envKeys: string[]; config: string; pid: number };
            roots.push(value.home);
            assert.notEqual(value.home, process.env.HOME);
            assert.notEqual(value.codexHome, process.env.CODEX_HOME);
            assert.equal(realpathSync(value.cwd), realpathSync(join(value.home, 'work')));
            assert.equal(statSync(value.home).mode & 0o777, 0o700);
            assert.equal(statSync(join(value.codexHome, 'config.toml')).mode & 0o777, 0o600);
            assert.deepEqual(value.argv, ['app-server', '--listen', 'stdio://']);
            assert.deepEqual(value.envKeys.filter((key) => !(process.platform === 'darwin' && key === '__CF_USER_TEXT_ENCODING')).sort(), ['HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'NODE_ENV', 'PATH', 'LANG'].sort());
            assert.match(value.config, /cli_auth_credentials_store = "ephemeral"/);
            assert.match(value.config, /forced_login_method = "chatgpt"/);
            assert.match(value.config, /\[analytics\]\nenabled = false/);
            assert.equal(readFileSync(join(value.codexHome, 'synthetic-state'), 'utf8'), 'synthetic-only');
            assert.equal(await transport.close(), true);
            assert.equal(existsSync(value.home), false);
            assert.throws(() => process.kill(value.pid, 0), /ESRCH/);
        }
        assert.notEqual(roots[0], roots[1]);
        assert.equal(await host.dispose(), true);
    } finally { await host.dispose(); rmSync(fixtures, { recursive: true, force: true }); }
});
test('missing, relative, and nonexistent host binaries fail without spawning', async () => {
    for (const binary of [undefined, 'codex', '/synthetic/nonexistent/codex']) {
        const host = createAccountHost(binary);
        await assert.rejects(host.createTransport(), /host_unavailable/);
        assert.equal(await host.dispose(), true);
    }
});

test('parent exit kills only its synthetic account child; leftover home is never reused', async () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'mediflow-account-exit-fixture-'));
    const binary = join(fixtures, 'synthetic-codex'); writeFileSync(binary, fixtureSource, { mode: 0o700 });
    const script = join(fixtures, 'parent.ts');
    writeFileSync(script, `/* @Codex: synthetic parent shutdown. */
import { createAccountHost } from ${JSON.stringify(join(process.cwd(), 'lib/chatgpt-account/account-host.ts'))};
(async () => {
 const host = createAccountHost(${JSON.stringify(binary)});
 const transport = await host.createTransport();
 const value = await transport.request('initialize', {});
 process.stdout.write(JSON.stringify(value) + '\\n', () => process.exit(0));
})();
`);
    let home: string | undefined;
    try {
        const parent = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', script], { encoding: 'utf8', timeout: 5000 });
        assert.equal(parent.status, 0, parent.stderr);
        const value = JSON.parse(parent.stdout.trim()) as { home: string; pid: number }; home = value.home;
        let alive = true;
        for (let i = 0; i < 20; i++) {
            try { process.kill(value.pid, 0); } catch { alive = false; break; }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(alive, false);
        // This test created the synthetic directory; production never scans orphan homes.
    } finally { if (home) rmSync(home, { recursive: true, force: true }); rmSync(fixtures, { recursive: true, force: true }); }
});
test('host rejects an initialize response reporting a different Codex home', async () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'mediflow-account-home-fixture-'));
    const binary = join(fixtures, 'synthetic-codex');
    writeFileSync(binary, fixtureSource.replace('codexHome: process.env.CODEX_HOME,', "codexHome: '/synthetic/wrong-home',"), { mode: 0o700 });
    const host = createAccountHost(binary);
    try {
        const transport = await host.createTransport();
        await assert.rejects(transport.request('initialize', {}), /protocol_error/);
        assert.equal(await host.dispose(), true);
    } finally { await host.dispose(); rmSync(fixtures, { recursive: true, force: true }); }
});
