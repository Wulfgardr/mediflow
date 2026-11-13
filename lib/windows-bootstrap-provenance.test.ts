import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { SCHEDULED_BACKUP_RUNTIME_ROSTER } from '../scripts/scheduled-backup-runtime-contract.mjs';
import * as provenance from '../scripts/verify-windows-bootstrap-rebuild.mjs';
import { assertBootstrapBytesEqual, peByteDifferences } from '../scripts/verify-windows-bootstrap-rebuild.mjs';

test('committed Windows bootstrap pairs match the scheduled backup runtime admission pins', () => {
    for (const arch of ['x64', 'arm64']) {
        for (const name of ['system-directory.node', 'manifest.json']) {
            const relative = `scripts/windows-launcher-bootstrap/prebuilds/win32-${arch}/${name}`;
            const entry = SCHEDULED_BACKUP_RUNTIME_ROSTER.find(item => item.path === relative);
            assert.ok(entry, relative);
            const bytes = fs.readFileSync(new URL(`../${relative}`, import.meta.url));
            assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, relative);
        }
    }
});

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
    const directory = path.join(scripts, 'windows-launcher-bootstrap/prebuilds/win32-arm64');
    fs.mkdirSync(directory, { recursive: true });
    const verifier = path.join(scripts, 'verify-windows-bootstrap-rebuild.mjs');
    fs.copyFileSync(new URL('../scripts/verify-windows-bootstrap-rebuild.mjs', import.meta.url), verifier);
    const tools = { architecture: 'arm64', compiler: '19.52.1.0', linker: '14.52.1.0', msvc: '14.52.1', windowsSdk: '10.0.26100.0' };
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
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            process.argv = [process.execPath, ${JSON.stringify(verifier)}, '--toolchain', ${JSON.stringify(measured)}];
            await import(${JSON.stringify(pathToFileURL(verifier).href)});
        `], { encoding: 'utf8', timeout: 10000 });
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
