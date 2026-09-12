/* @Codex — physical asset resolution is not a qualification. */
import assert from 'node:assert/strict';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const { resolveInstalledMacExecutionAssets } = await import('./execution-mac-assets.ts');
const { ExecutionError } = await import('./execution-contract.ts');

const sourceDirectory = process.env.MEDIFLOW_MAC_PUBLIC_SOURCE_DIR;
const c1ReceiptPath = process.env.MEDIFLOW_MAC_C1_RECEIPT;
const denied = (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-mac-assets-'));
    const assets = join(root, 'resources', 'chatgpt-execution', 'mac', 'codex-0.153.4');
    mkdirSync(join(assets, 'schema'), { recursive: true });
    writeFileSync(join(assets, 'codex'), 'synthetic executable bytes');
    writeFileSync(join(assets, 'mac-owner.c'), 'synthetic native source');
    if (sourceDirectory && c1ReceiptPath) {
        cpSync(sourceDirectory, join(assets, 'schema'), { recursive: true, dereference: false });
        cpSync(c1ReceiptPath, join(assets, 'C1-RECEIPT.json'), { dereference: false });
    }
    return { root, assets };
}

test('resolves only the fixed physical installed Mac asset layout', (t) => {
    if (!sourceDirectory || !c1ReceiptPath) { t.skip('MEDIFLOW_MAC_PUBLIC_SOURCE_DIR and MEDIFLOW_MAC_C1_RECEIPT not configured'); return; }
    const value = fixture();
    t.after(() => rmSync(value.root, { recursive: true, force: true }));
    const assets = join(realpathSync(value.root), 'resources', 'chatgpt-execution', 'mac', 'codex-0.153.4');
    assert.deepEqual(resolveInstalledMacExecutionAssets(value.root), {
        binaryPath: join(assets, 'codex'), nativeSourcePath: join(assets, 'mac-owner.c'),
        schemaDirectory: join(assets, 'schema'), c1ReceiptPath: join(assets, 'C1-RECEIPT.json'),
    });
});

test('rejects missing, symlinked, escaped, and pin-altered installed assets', (t) => {
    if (!sourceDirectory || !c1ReceiptPath) {
        const root = mkdtempSync(join(tmpdir(), 'mediflow-mac-assets-negative-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        assert.throws(() => resolveInstalledMacExecutionAssets(root), denied);
        return;
    }
    const value = fixture();
    t.after(() => rmSync(value.root, { recursive: true, force: true }));
    rmSync(join(value.assets, 'codex'));
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    writeFileSync(join(value.assets, 'codex'), 'synthetic executable bytes');
    rmSync(join(value.assets, 'mac-owner.c'));
    symlinkSync('/tmp/not-an-asset', join(value.assets, 'mac-owner.c'));
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    rmSync(join(value.assets, 'mac-owner.c'));
    writeFileSync(join(value.assets, 'mac-owner.c'), 'synthetic native source');
    rmSync(join(value.assets, 'schema'), { recursive: true });
    symlinkSync(sourceDirectory, join(value.assets, 'schema'));
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    rmSync(join(value.assets, 'schema'));
    cpSync(sourceDirectory, join(value.assets, 'schema'), { recursive: true, dereference: false });
    writeFileSync(join(value.assets, 'schema', 'config.schema.json'), 'altered public pin');
    assert.throws(() => resolveInstalledMacExecutionAssets(value.root), denied);
    assert.equal(lstatSync(join(value.assets, 'schema', 'config.schema.json')).isSymbolicLink(), false);
    assert.equal(dirname(value.assets).endsWith(join('mac')), true);
});
