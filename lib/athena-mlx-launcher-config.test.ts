/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { resolveAthenaMlxGenerateBin } from './athena-mlx-launcher-config.ts';
import { resolveAthenaMlxLauncher } from './athena-mlx-runtime.ts';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-athena-config-')));
const directory = path.join(root, 'Application Support', 'runner');
fs.mkdirSync(directory, { recursive: true });
const runner = path.join(directory, 'mlx_lm.generate');
fs.writeFileSync(runner, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); // Never executed.
const message = 'ATHENA MLX direct runner configuration rejected.';
const key = 'MEDIFLOW_ATHENA_MLX_GENERATE_BIN';
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

function withRunner(value: string | undefined, body: () => void): void {
    const original = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    try { body(); }
    finally { if (original === undefined) delete process.env[key]; else process.env[key] = original; }
}

test('undefined alone means optional runner', () => {
    assert.equal(resolveAthenaMlxGenerateBin(undefined), undefined);
});
test('absolute executable path with internal spaces is preserved as one exact value', () => {
    assert.equal(resolveAthenaMlxGenerateBin(runner), runner);
});
for (const [label, value] of [
    ['empty', ''], ['blank', ' \t\n '], ['relative', './mlx_lm.generate'],
    ['arguments', `${runner} --help`], ['quoted', `"${runner}"`], ['padding', ` ${runner} `],
    ['missing', path.join(root, 'missing', 'mlx_lm.generate')], ['basename', process.execPath],
] as const) test(`explicit ${label} runner is rejected without leaking paths`, () => {
    assert.throws(() => resolveAthenaMlxGenerateBin(value), { message });
});
test('non-string JavaScript caller is denied rather than treated as absent', () => {
    for (const value of [null, 42, {}, []]) {
        assert.throws(() => resolveAthenaMlxGenerateBin(value as unknown as string), { message });
    }
});
test('directory named mlx_lm.generate is not a runner', () => {
    const value = path.join(root, 'directory', 'mlx_lm.generate');
    fs.mkdirSync(value, { recursive: true });
    assert.throws(() => resolveAthenaMlxGenerateBin(value), { message });
});
test('file without executable permission is denied', { skip: process.platform === 'win32' }, () => {
    const value = path.join(root, 'no-execute', 'mlx_lm.generate');
    fs.mkdirSync(path.dirname(value)); fs.writeFileSync(value, 'synthetic\n', { mode: 0o600 });
    assert.throws(() => resolveAthenaMlxGenerateBin(value), { message });
});
test('host-owned symlink follows existing runner policy; broken target is denied', (t) => {
    const link = path.join(root, 'link', 'mlx_lm.generate');
    fs.mkdirSync(path.dirname(link));
    const target = path.join(root, 'synthetic-executable');
    fs.writeFileSync(target, 'synthetic\n', { mode: 0o700 });
    try { fs.symlinkSync(target, link, 'file'); }
    catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            t.skip('Windows account cannot create symlinks'); return;
        }
        throw error;
    }
    assert.equal(resolveAthenaMlxGenerateBin(link), link);
    fs.unlinkSync(target);
    assert.throws(() => resolveAthenaMlxGenerateBin(link), { message });
});
test('runner availability is checked again on each resolution', () => {
    const value = path.join(root, 'transient', 'mlx_lm.generate');
    fs.mkdirSync(path.dirname(value)); fs.writeFileSync(value, 'synthetic\n', { mode: 0o700 });
    assert.equal(resolveAthenaMlxGenerateBin(value), value);
    fs.unlinkSync(value);
    assert.throws(() => resolveAthenaMlxGenerateBin(value), { message });
});
test('actual ATHENA launcher returns direct executable with no prefix arguments', () => {
    withRunner(runner, () => {
        const launcher = resolveAthenaMlxLauncher();
        assert.deepEqual(launcher, { mode: 'direct', command: runner, prefixArgs: [] });
        assert.ok(Object.isFrozen(launcher)); assert.ok(Object.isFrozen(launcher.prefixArgs));
    });
});
test('actual ATHENA launcher retains historical optional uvx selection without executing it', () => {
    withRunner(undefined, () => {
        const launcher = resolveAthenaMlxLauncher();
        assert.equal(launcher.mode, 'uvx');
        assert.equal(launcher.command, process.env.MEDIFLOW_UVX_BIN || 'uvx');
        assert.equal(launcher.prefixArgs.at(-1), 'mlx_lm.generate');
    });
});
for (const [label, value] of [['empty', ''], ['blank', ' \t '], ['arguments', `${runner} --help`]] as const) {
    test(`actual ATHENA launcher rejects ${label} override without silently selecting uvx`, () => {
        withRunner(value, () => { assert.throws(resolveAthenaMlxLauncher, { message }); });
    });
}
