/* @Codex — deterministic synthetic layout/pin checks; no native readiness claim. */
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { installSyntheticPackagingPins } from '../../scripts/fixtures/mac-packaging-test-loader.mjs';
import { assetParts, installedFixture, runStage, snapshot, syntheticFiles } from '../../scripts/fixtures/mac-packaging-test-support.mjs';

installSyntheticPackagingPins();
const { resolveInstalledMacExecutionAssets, macExecutionAssetLayout } = await import('./execution-mac-assets.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const denied = (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary';

for (const bundle of [false, true]) {
    const label = bundle ? 'app' : 'standalone';
    test(`${label}: resolves the complete physical layout without writing`, (t) => {
        const value = installedFixture(t, bundle), before = snapshot(value.directory);
        assert.deepEqual(resolveInstalledMacExecutionAssets(value.root), {
            binaryPath: value.binaryPath, nativeSourcePath: join(value.assets, 'mac-owner.c'),
            schemaDirectory: join(value.assets, 'schema'), c1ReceiptPath: join(value.assets, 'C1-RECEIPT.json'),
        });
        assert.equal(existsSync(join(value.assets, 'codex')), !bundle);
        assert.deepEqual(snapshot(value.directory), before);
    });
    for (const name of Object.keys(syntheticFiles)) {
        test(`${label}: missing and same-length altered ${name} are denied`, (t) => {
            const value = installedFixture(t, bundle), target = name === 'codex' ? value.binaryPath : join(value.assets, name);
            const original = readFileSync(target), changed = Buffer.from(original);
            changed[changed.length - 1] ^= 1;
            writeFileSync(target, changed);
            assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
            rmSync(target);
            assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
        });
        test(`${label}: a file symlink for ${name} is denied`, (t) => {
            const value = installedFixture(t, bundle), target = name === 'codex' ? value.binaryPath : join(value.assets, name);
            const outside = join(value.directory, 'outside-asset');
            renameSync(target, outside); symlinkSync(outside, target);
            assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
        });
    }
    test(`${label}: root alias, ancestor alias, traversal and relative paths are denied`, (t) => {
        const value = installedFixture(t, bundle);
        const alias = join(value.directory, 'alias'); symlinkSync(value.root, alias);
        const ancestor = join(value.directory, 'parent-alias'); symlinkSync(dirname(value.root), ancestor);
        for (const candidate of [alias, join(ancestor, value.root.split('/').at(-1)!), `${value.root}/../${value.root.split('/').at(-1)}`,
            `${value.root}/`, `${value.root}//`, 'relative', `${value.root}\n`]) {
            assert.throws(() => resolveInstalledMacExecutionAssets(candidate), denied);
        }
    });
    test(`${label}: symlinked schema and every deployment directory are denied`, (t) => {
        const value = installedFixture(t, bundle);
        const directories = [join(value.assets, 'schema'), ...assetParts.map((_, i) => join(value.root, ...assetParts.slice(0, i + 1)))];
        if (value.app) directories.push(dirname(value.binaryPath), join(value.app.contents, 'Helpers'), value.app.app, value.app.contents);
        for (let index = 0; index < directories.length; index += 1) {
            const target = directories[index], outside = join(value.directory, `moved-${index}`);
            renameSync(target, outside); symlinkSync(outside, target);
            assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
            rmSync(target); renameSync(outside, target);
        }
    });
    test(`${label}: unexpected files, non-executable or set-id binary are denied`, (t) => {
        const value = installedFixture(t, bundle), extra = join(value.assets, 'alternate-codex');
        writeFileSync(extra, syntheticFiles.codex);
        assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied); rmSync(extra);
        chmodSync(value.binaryPath, 0o644);
        assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
        chmodSync(value.binaryPath, 0o4755);
        assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    });
}

test('app: legacy Resources binary is not a fallback, even with identical bytes', (t) => {
    const value = installedFixture(t, true);
    cpSync(value.binaryPath, join(value.assets, 'codex'));
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    rmSync(value.binaryPath);
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
});
test('app: foreign helper, missing bundle markers and false bundle shapes are denied', (t) => {
    const value = installedFixture(t, true);
    const wrong = join(value.app!.contents, 'Helpers', 'foreign-codex');
    renameSync(value.binaryPath, wrong);
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    renameSync(wrong, value.binaryPath);
    for (const target of [join(value.app!.contents, 'Info.plist'), join(value.app!.contents, 'MacOS/MediFlow'), join(value.root, 'server.js')]) {
        const bytes = readFileSync(target); rmSync(target);
        assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
        writeFileSync(target, bytes, { mode: 0o755 });
    }
    for (const parts of [['Fake.app'], ['Fake.app', 'standalone'], ['NotAnApp', 'Contents', 'Resources', 'WebRuntime'],
        ['Fake.app', 'Contents', 'Elsewhere', 'WebRuntime'], ['Outer.app', 'Inner.app', 'Contents', 'Resources', 'WebRuntime']]) {
        const root = join(value.directory, ...parts); mkdirSync(root, { recursive: true });
        assert.throws(() => macExecutionAssetLayout(root), denied);
    }
});
test('real production pins reject the synthetic payload; no permissive validator is installed', (t) => {
    const value = installedFixture(t, true);
    const result = runStage(value, { realPins: true, args: ['--check', '--installation-root', value.root] });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /unqualified_boundary/);
});
