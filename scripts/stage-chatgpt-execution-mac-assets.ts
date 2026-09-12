/* @Codex — explicit public inputs; all writes precede the outer app signature. */
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
    MAC_EXECUTION_SCHEMA_FILES, macExecutionAssetLayout, physicalMacAssetPath,
    resolveInstalledMacExecutionAssets, verifyMacExecutionAssetFiles,
    type InstalledMacExecutionAssets, type MacExecutionAssetLayout,
} from '../lib/chatgpt-execution/execution-mac-assets';

const REQUIRED = ['installation-root', 'binary', 'native-source', 'schema-directory', 'c1-receipt'] as const;
type ArgumentName = typeof REQUIRED[number];
type Mode = 'stage' | 'check' | 'relocate-bundle';
function fail(message: string): never { throw new Error(`CHATGPT_EXECUTION_MAC_ASSETS: ${message}`); }

function parseArguments(argv: readonly string[]): { mode: Mode; values: Partial<Record<ArgumentName, string>> } {
    const values: Partial<Record<ArgumentName, string>> = Object.create(null);
    let mode: Mode = 'stage';
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--check' || argument === '--relocate-bundle') {
            if (mode !== 'stage') fail('modalita CLI duplicata');
            mode = argument === '--check' ? 'check' : 'relocate-bundle';
            continue;
        }
        const name = /^--([a-z0-9-]+)$/u.exec(argument)?.[1] as ArgumentName | undefined;
        if (!name || !REQUIRED.includes(name) || values[name] || index + 1 >= argv.length) fail('ingressi CLI non validi');
        const value = argv[++index];
        if (!value || value.startsWith('--')) fail('ingressi CLI non validi');
        values[name!] = value;
    }
    for (const name of mode === 'stage' ? REQUIRED : ['installation-root'] as const) if (!values[name]) fail(`manca --${name}`);
    if (mode !== 'stage' && Object.keys(values).length !== 1) fail('la modalita non ammette percorsi sorgente');
    return { mode, values };
}

function exists(path: string): boolean {
    try { lstatSync(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function unsignedBundle(layout: MacExecutionAssetLayout): void {
    if (layout.bundleContents && (exists(join(layout.bundleContents, '_CodeSignature')) || exists(join(layout.bundleContents, 'CodeResources'))))
        fail('bundle gia firmato: usare una build non firmata; nessuno staging dopo firma');
}

function safeDirectories(root: string, destination: string): void {
    physicalMacAssetPath(root, 'directory');
    const delta = relative(root, destination);
    if (!delta || delta === '..' || delta.startsWith(`..${sep}`)) fail('destinazione fuori dal root');
    let current = root;
    for (const part of delta.split(sep)) {
        current = join(current, part);
        if (!exists(current)) mkdirSync(current, { mode: 0o755 });
        physicalMacAssetPath(current, 'directory');
    }
}

function exactEntries(path: string, names: readonly string[]): void {
    physicalMacAssetPath(path, 'directory');
    if (JSON.stringify(readdirSync(path).sort()) !== JSON.stringify([...names].sort())) fail('payload esistente non idempotente');
}

function sourceSet(values: Partial<Record<ArgumentName, string>>): InstalledMacExecutionAssets {
    const source = Object.freeze({ binaryPath: values.binary!, nativeSourcePath: values['native-source']!,
        schemaDirectory: values['schema-directory']!, c1ReceiptPath: values['c1-receipt']! });
    try { verifyMacExecutionAssetFiles(source); }
    catch { fail('sorgente non fisica o pin pubblico non valido'); }
    return source;
}

function copy(source: string, target: string, mode: number): void {
    physicalMacAssetPath(source, 'file');
    physicalMacAssetPath(dirname(target), 'directory');
    copyFileSync(source, target, constants.COPYFILE_EXCL); // Never overwrite a link, partial payload or previous deployment.
    chmodSync(target, mode); // Metadata only; never change signed executable bytes.
    physicalMacAssetPath(target, 'file');
}

function stage(layout: MacExecutionAssetLayout, sources: InstalledMacExecutionAssets): void {
    unsignedBundle(layout);
    // Validate ALL public sources before creating anything. A matching existing
    // deployment is a read-only no-op; a partial/altered deployment is not repaired.
    verifyMacExecutionAssetFiles(sources);
    if (exists(layout.assetDirectory) || layout.bundleContents && exists(layout.assets.binaryPath)) {
        try { resolveInstalledMacExecutionAssets(layout.installationRoot); }
        catch { fail('payload esistente non idempotente'); }
        return;
    }
    safeDirectories(layout.installationRoot, layout.assets.schemaDirectory);
    if (layout.bundleContents) safeDirectories(layout.bundleContents, layout.binaryDirectory);
    copy(sources.binaryPath, layout.assets.binaryPath, 0o755);
    copy(sources.nativeSourcePath, layout.assets.nativeSourcePath, 0o644);
    copy(sources.c1ReceiptPath, layout.assets.c1ReceiptPath, 0o644);
    for (const [name] of MAC_EXECUTION_SCHEMA_FILES) copy(join(sources.schemaDirectory, name), join(layout.assets.schemaDirectory, name), 0o644);
    resolveInstalledMacExecutionAssets(layout.installationRoot);
}

/** Migration of the exact standalone copy just injected by the app builder.
 * Only this pinned codex is relocated. No caller-chosen helper path, re-signing,
 * install_name_tool, link or binary mutation is permitted. A previous identical
 * helper from an unsigned incremental build can be reused, never overwritten. */
function relocateBundle(layout: MacExecutionAssetLayout): void {
    if (!layout.bundleContents) fail('relocation richiede Contents/Resources/WebRuntime in un bundle fisico');
    unsignedBundle(layout);
    const legacyBinary = join(layout.assetDirectory, 'codex');
    if (!exists(legacyBinary)) {
        resolveInstalledMacExecutionAssets(layout.installationRoot); // Idempotent only for the complete split layout.
        return;
    }
    exactEntries(layout.assetDirectory, ['C1-RECEIPT.json', 'codex', 'mac-owner.c', 'schema']);
    exactEntries(layout.assets.schemaDirectory, MAC_EXECUTION_SCHEMA_FILES.map(([name]) => name));
    const legacy = { ...layout.assets, binaryPath: legacyBinary };
    verifyMacExecutionAssetFiles(legacy); // All seven pins, before creating Helpers.
    if (exists(layout.assets.binaryPath)) {
        verifyMacExecutionAssetFiles(layout.assets);
    } else {
        safeDirectories(layout.bundleContents, layout.binaryDirectory);
        copy(legacyBinary, layout.assets.binaryPath, 0o755);
        verifyMacExecutionAssetFiles(layout.assets);
    }
    // Copy/check/delete, not a symlink or byte-transforming move. Failed checks
    // leave the duplicate and therefore a layout which the resolver denies.
    unsignedBundle(layout);
    verifyMacExecutionAssetFiles(legacy);
    unlinkSync(legacyBinary);
    resolveInstalledMacExecutionAssets(layout.installationRoot);
}

try {
    const { mode, values } = parseArguments(process.argv.slice(2));
    const root = values['installation-root']!;
    if (mode === 'check') {
        resolveInstalledMacExecutionAssets(root); // No staging, even after signing.
    } else {
        const layout = macExecutionAssetLayout(root);
        unsignedBundle(layout);
        if (mode === 'relocate-bundle') relocateBundle(layout);
        else stage(layout, sourceSet(values));
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : 'CHATGPT_EXECUTION_MAC_ASSETS: staging fallito');
    process.exitCode = 1;
}
