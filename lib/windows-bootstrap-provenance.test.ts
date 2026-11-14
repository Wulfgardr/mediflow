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

test('real verification CLI denies runner drift and byte drift and restores delivered files', t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-provenance-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const directory = path.join(scripts, 'windows-launcher-bootstrap/prebuilds/win32-x64');
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    const tools = { architecture: 'x64', compiler: '19.52.1.0', linker: '14.52.1.0', msvc: '14.52.1', windowsSdk: '10.0.26100.0' };
    const binary = Buffer.from('synthetic native bytes');
    const manifest = JSON.stringify({ build: { compiler: tools.compiler } });
    fs.writeFileSync(path.join(directory, 'system-directory.node'), binary);
    fs.writeFileSync(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'toolchain.json'), JSON.stringify(tools));
    const measured = path.join(root, 'measured.json');
    const preparer = path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs');
    const rebuild = (bytes: Buffer) => fs.writeFileSync(preparer, `
        import fs from 'node:fs';
        fs.writeFileSync(${JSON.stringify(path.join(directory, 'system-directory.node'))}, Buffer.from(${JSON.stringify([...bytes])}));
        fs.writeFileSync(${JSON.stringify(path.join(directory, 'manifest.json'))}, ${JSON.stringify(manifest)});
    `);
    const verify = (actual: Record<string, string>) => {
        fs.writeFileSync(measured, JSON.stringify(actual));
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
            Object.defineProperty(process, 'platform', { value: 'win32' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            process.argv = [process.execPath, ${JSON.stringify(verifier)}, '--toolchain', ${JSON.stringify(measured)}];
            await import(${JSON.stringify(pathToFileURL(verifier).href)});
        `], { env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' }, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        assert.deepEqual(fs.readFileSync(path.join(directory, 'system-directory.node')), binary);
        assert.equal(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'), manifest);
        return result;
    };
    rebuild(binary);
    const positive = verify(tools);
    assert.equal(positive.status, 0, positive.stderr);
    assert.match(positive.stdout, /matches source rebuild byte for byte/u);
    for (const field of Object.keys(tools)) {
        const result = verify({ ...tools, [field]: 'changed' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /toolchain differs/u);
    }
    rebuild(Buffer.from('changed synthetic bytes'));
    const changedBytes = verify(tools);
    assert.notEqual(changedBytes.status, 0);
    assert.match(changedBytes.stderr, /differs from source rebuild/u);
});


test('real verification CLI selects the ARM64 rebuild digest by measured tool versions', async t => {
    const records = JSON.parse(fs.readFileSync(new URL('../scripts/windows-launcher-bootstrap/arm64-rebuilds.json', import.meta.url), 'utf8'));
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-arm64-rebuilds-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const directory = path.join(scripts, 'windows-launcher-bootstrap/prebuilds/win32-arm64');
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    // Synthetic payloads exercise the real CLI without adding another shipped binary.
    const payloads = records.map((record: { toolchain: { compiler: string } }) => Buffer.from(`synthetic ARM64 ${record.toolchain.compiler}`));
    records.forEach((record: { sha256: string }, i: number) => { record.sha256 = createHash('sha256').update(payloads[i]).digest('hex'); });
    fs.writeFileSync(path.join(scripts, 'windows-launcher-bootstrap/arm64-rebuilds.json'), JSON.stringify(records));
    const delivered = payloads[1];
    const manifest = JSON.stringify({ build: { compiler: records[1].toolchain.compiler } });
    fs.writeFileSync(path.join(directory, 'system-directory.node'), delivered);
    fs.writeFileSync(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'toolchain.json'), JSON.stringify(records[1].toolchain));
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
            Object.defineProperty(process, 'arch', { value: 'arm64' });
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
            assert.match(result.stdout, /matches source rebuild/u);
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

test('real verification CLI preserves explicit two-build regeneration before new ARM64 digests are registered', t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-arm64-regeneration-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const directory = path.join(scripts, 'windows-launcher-bootstrap/prebuilds/win32-arm64');
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    const records = JSON.parse(fs.readFileSync(new URL('../scripts/windows-launcher-bootstrap/arm64-rebuilds.json', import.meta.url), 'utf8'));
    fs.writeFileSync(path.join(scripts, 'windows-launcher-bootstrap/arm64-rebuilds.json'), JSON.stringify(records));
    const event = path.join(root, 'event.json');
    const measured = path.join(root, 'measured.json');
    const fresh = Buffer.from('fresh synthetic ARM64 from changed source');
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
                Object.defineProperty(process, 'arch', { value: 'arm64' });
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
