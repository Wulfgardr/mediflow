import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as provenance from '../scripts/verify-windows-bootstrap-rebuild.mjs';
import { assertBootstrapBytesEqual, peByteDifferences } from '../scripts/verify-windows-bootstrap-rebuild.mjs';

for (const arch of ['x64', 'arm64']) {
    test(`Windows ${arch} provenance comparison rejects every changed byte including timestamps`, () => {
        const original = fs.readFileSync(new URL(`../scripts/windows-launcher-bootstrap/prebuilds/win32-${arch}/system-directory.node`, import.meta.url));
        assert.doesNotThrow(() => assertBootstrapBytesEqual(original, Buffer.from(original)));
        const pe = original.readUInt32LE(0x3c);
        for (const offset of [pe + 8, 0x1680, original.length - 1]) {
            const changed = Buffer.from(original);
            changed[offset] ^= 1;
            assert.throws(() => assertBootstrapBytesEqual(original, changed));
            assert.deepEqual(peByteDifferences(original, changed), [{ offset: `0x${offset.toString(16)}`, delivered: original[offset], rebuilt: changed[offset] }]);
        }
        assert.throws(() => assertBootstrapBytesEqual(original, original.subarray(0, -1)));
    });
}

test('Windows rebuild rejects changed or incomplete toolchain provenance even when binary bytes match', () => {
    assert.equal(typeof provenance.assertBootstrapToolchainEqual, 'function');
    const tools: Record<string, string> = { architecture: 'arm64', compiler: '19.52.1.0', linker: '14.52.1.0', msvc: '14.52.1', windowsSdk: '10.0.26100.0' };
    assert.doesNotThrow(() => provenance.assertBootstrapToolchainEqual(tools, { ...tools }));
    for (const field of Object.keys(tools)) {
        assert.throws(() => provenance.assertBootstrapToolchainEqual(tools, { ...tools, [field]: 'different' }), /toolchain differs/u);
        assert.throws(() => provenance.assertBootstrapToolchainEqual(tools, { ...tools, [field]: undefined }), /toolchain/u);
        const incomplete = { ...tools };
        delete incomplete[field];
        assert.throws(() => provenance.assertBootstrapToolchainEqual(incomplete, incomplete), /toolchain/u);
    }
});

for (const arch of ['x64', 'arm64']) test(`real verification CLI selects the ${arch} rebuild digest by measured tool versions`, async t => {
    const records = JSON.parse(fs.readFileSync(new URL(`../scripts/windows-launcher-bootstrap/${arch}-rebuilds.json`, import.meta.url), 'utf8'));
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-rebuilds-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const directory = path.join(scripts, `windows-launcher-bootstrap/prebuilds/win32-${arch}`);
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    const payloads = records.map((record: { toolchain: { compiler: string } }) => Buffer.from(`synthetic ${arch} ${record.toolchain.compiler}`));
    records.forEach((record: { sha256: string }, i: number) => { record.sha256 = createHash('sha256').update(payloads[i]).digest('hex'); });
    fs.writeFileSync(path.join(scripts, `windows-launcher-bootstrap/${arch}-rebuilds.json`), JSON.stringify(records));
    const deliveredIndex = arch === 'x64' ? 0 : 1;
    const delivered = payloads[deliveredIndex];
    const manifest = JSON.stringify({ build: { compiler: records[deliveredIndex].toolchain.compiler } });
    fs.writeFileSync(path.join(directory, 'system-directory.node'), delivered);
    fs.writeFileSync(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'toolchain.json'), JSON.stringify(records[deliveredIndex].toolchain));
    const measured = path.join(root, 'measured.json');
    const run = (tools: Record<string, string>, bytes: Buffer) => {
        fs.writeFileSync(measured, JSON.stringify(tools));
        fs.writeFileSync(path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs'), `
            import fs from 'node:fs';
            fs.writeFileSync(${JSON.stringify(path.join(directory, 'system-directory.node'))}, Buffer.from(${JSON.stringify([...bytes])}));
            fs.writeFileSync(${JSON.stringify(path.join(directory, 'manifest.json'))}, ${JSON.stringify(JSON.stringify({ build: { compiler: tools.compiler } }))});
        `);
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
            Object.defineProperty(process, 'platform', { value: 'win32' });
            Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });
            process.argv = [process.execPath, ${JSON.stringify(verifier)}, '--toolchain', ${JSON.stringify(measured)}];
            await import(${JSON.stringify(pathToFileURL(verifier).href)});
        `], { env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' }, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        assert.deepEqual(fs.readFileSync(path.join(directory, 'system-directory.node')), delivered);
        assert.equal(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'), manifest);
        return result;
    };
    for (const [i, version] of ['14.51', '14.52'].entries()) {
        await t.test(`${version} accepts its complete rebuild`, () => {
            const result = run(records[i].toolchain, payloads[i]);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, i === deliveredIndex ? /byte for byte/u : /SHA-256 for measured toolchain/u);
        });
        await t.test(`${version} rejects the other compiler's complete rebuild`, () => {
            const result = run(records[i].toolchain, payloads[1 - i]);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /differs from source rebuild/u);
        });
        await t.test(`${version} rejects a changed byte`, () => {
            const changed = Buffer.from(payloads[i]);
            changed[changed.length - 1] ^= 1;
            const result = run(records[i].toolchain, changed);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /differs from source rebuild/u);
        });
    }
    for (const field of Object.keys(records[0].toolchain)) {
        for (const value of ['unknown', undefined]) {
            await t.test(`rejects ${field}=${value} with measured and expected versions`, () => {
                const result = run({ ...records[0].toolchain, [field]: value }, payloads[0]);
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /Unknown Windows bootstrap toolchain/u);
                assert.match(result.stderr, /actual=/u);
                assert.match(result.stderr, /expected=/u);
                assert.match(result.stderr, /19\.51\.36260\.0/u);
                assert.match(result.stderr, /19\.52\.37029\.0/u);
            });
        }
    }
});

for (const arch of ['x64', 'arm64']) test(`real verification CLI preserves explicit two-build regeneration before new ${arch} digests are registered`, t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-regeneration-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const directory = path.join(scripts, `windows-launcher-bootstrap/prebuilds/win32-${arch}`);
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    const records = JSON.parse(fs.readFileSync(new URL(`../scripts/windows-launcher-bootstrap/${arch}-rebuilds.json`, import.meta.url), 'utf8'));
    fs.writeFileSync(path.join(scripts, `windows-launcher-bootstrap/${arch}-rebuilds.json`), JSON.stringify(records));
    const event = path.join(root, 'event.json');
    const measured = path.join(root, 'measured.json');
    const fresh = Buffer.from(`fresh synthetic ${arch} from changed source`);
    for (const compiler of [records[1].toolchain.compiler, '19.99.1.0']) {
        const tools = { ...records[1].toolchain, compiler };
        const manifest = JSON.stringify({ build: { compiler } });
        fs.writeFileSync(path.join(directory, 'toolchain.json'), JSON.stringify(tools));
        fs.writeFileSync(measured, JSON.stringify(tools));
        const run = (eventName: string, input: boolean | string, changed = false) => {
            fs.writeFileSync(path.join(directory, 'system-directory.node'), fresh);
            fs.writeFileSync(path.join(directory, 'manifest.json'), manifest);
            fs.writeFileSync(event, JSON.stringify({ inputs: { regenerate_bootstrap: input } }));
            const rebuilt = Buffer.from(fresh);
            if (changed) rebuilt[0] ^= 1;
            fs.writeFileSync(path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs'), `
                import fs from 'node:fs';
                fs.writeFileSync(${JSON.stringify(path.join(directory, 'system-directory.node'))}, Buffer.from(${JSON.stringify([...rebuilt])}));
                fs.writeFileSync(${JSON.stringify(path.join(directory, 'manifest.json'))}, ${JSON.stringify(manifest)});
            `);
            const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
                Object.defineProperty(process, 'platform', { value: 'win32' });
                Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });
                process.argv = [process.execPath, ${JSON.stringify(verifier)}, '--toolchain', ${JSON.stringify(measured)}];
                await import(${JSON.stringify(pathToFileURL(verifier).href)});
            `], { env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: event }, encoding: 'utf8', timeout: 10000 });
            assert.ifError(result.error);
            assert.deepEqual(fs.readFileSync(path.join(directory, 'system-directory.node')), fresh);
            assert.equal(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'), manifest);
            return result;
        };
        for (const input of [true, 'true']) {
            const positive = run('workflow_dispatch', input);
            if (compiler === '19.99.1.0') {
                assert.notEqual(positive.status, 0);
                assert.match(positive.stderr, /Unknown Windows bootstrap toolchain/u);
                continue;
            }
            assert.equal(positive.status, 0, positive.stderr);
            assert.match(positive.stdout, /matches source rebuild byte for byte/u);
            const changed = run('workflow_dispatch', input, true);
            assert.notEqual(changed.status, 0);
            assert.match(changed.stderr, /differs from source rebuild/u);
        }
        for (const input of [false, 'false', '']) {
            assert.notEqual(run('workflow_dispatch', input).status, 0, 'Ordinary dispatch must retain committed pins');
        }
        assert.notEqual(run('pull_request', true).status, 0, 'An input on another event must not enable regeneration');
    }
});

test('native x64 verifier rejects unknown tools and altered delivered or rebuilt bytes', {
    skip: process.env.MEDIFLOW_BOOTSTRAP_NATIVE_PROBE !== 'true',
}, async t => {
    assert.equal(process.platform, 'win32');
    assert.equal(process.arch, 'x64');
    assert.ok(process.env.RUNNER_TEMP);
    const measured = path.join(process.env.RUNNER_TEMP, 'bootstrap-toolchain.json');
    const tools = JSON.parse(fs.readFileSync(measured, 'utf8'));
    const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'mf-bootstrap-native-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    fs.mkdirSync(scripts);
    for (const file of ['prepare-windows-launcher-bootstrap.mjs', 'verify-windows-bootstrap-rebuild.mjs', 'windows-system-command.mjs']) {
        fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(scripts, file));
    }
    const bootstrap = path.join(scripts, 'windows-launcher-bootstrap');
    fs.cpSync(new URL('../scripts/windows-launcher-bootstrap/', import.meta.url), bootstrap, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    const reject = (toolchain: string, reason: RegExp) => {
        const result = spawnSync(process.execPath, [verifier, '--toolchain', toolchain], {
            env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' },
            encoding: 'utf8', timeout: 190000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, reason);
        return result.stdout;
    };

    await t.test('rejects unknown SDK with the real compiler version', () => {
        const unknown = path.join(root, 'unknown-toolchain.json');
        fs.writeFileSync(unknown, JSON.stringify({ ...tools, windowsSdk: 'unknown' }));
        const stdout = reject(unknown, /Unknown Windows bootstrap toolchain/u);
        assert.doesNotMatch(stdout, /"type":"bootstrap-built"/u);
    });

    const binary = path.join(bootstrap, 'prebuilds/win32-x64/system-directory.node');
    const original = fs.readFileSync(binary);
    await t.test('rejects a one-byte change to the delivered PE', () => {
        const changed = Buffer.from(original);
        changed[original.readUInt32LE(0x3c) + 8] ^= 1;
        fs.writeFileSync(binary, changed);
        try {
            const stdout = reject(measured, /SHA-256 over all bytes/u);
            assert.doesNotMatch(stdout, /"type":"bootstrap-built"/u);
        } finally {
            fs.writeFileSync(binary, original);
        }
    });

    await t.test('rejects changed bytes from a real rebuild with the known toolchain', probe => {
        const source = path.join(bootstrap, 'system-directory.c');
        const content = fs.readFileSync(source, 'utf8');
        const marker = 'Windows system directory unavailable.';
        assert.ok(content.includes(marker));
        fs.writeFileSync(source, content.replace(marker, 'Windows system directory unavailable!'));
        const stdout = reject(measured, /SHA-256 over all bytes/u);
        const build = stdout.split(/\r?\n/u).find(line => line.startsWith('{"type":"bootstrap-built"'));
        assert.ok(build, stdout);
        probe.diagnostic(build);
        assert.deepEqual(fs.readFileSync(binary), original);
    });
});
