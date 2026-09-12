/* @Codex — fixed physical deployment layouts, not an execution qualification. */
import 'server-only';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, parse, relative, sep } from 'node:path';
import { MAC_C1_RECEIPT, MAC_CONFIG_SOURCE, readPinnedMacFile } from './execution-mac-config';
import { MAC_NATIVE_SOURCE } from './execution-mac-native';
import { EXECUTION_SUBSTRATE } from './execution-sandbox';
import { ExecutionError } from './execution-contract';

export const MAC_EXECUTION_HELPER_NAME = 'mediflow-chatgpt-codex';
export const MAC_EXECUTION_ASSET_PARTS = Object.freeze(['resources', 'chatgpt-execution', 'mac', 'codex-0.153.4']);
// Size of the already-qualified public artifact; the digest authority is unchanged.
export const MAC_EXECUTION_BINARY_PIN = Object.freeze({ bytes: 220584000, sha256: EXECUTION_SUBSTRATE.codexSha256 });
export const MAC_EXECUTION_SCHEMA_FILES = Object.freeze([
    ['config.schema.json', MAC_CONFIG_SOURCE],
    ['RECEIPT.json', MAC_CONFIG_SOURCE.receipt],
    ['config-loader-mod.rs', MAC_CONFIG_SOURCE.loader],
    ['LOADER-RECEIPT.json', { bytes: MAC_CONFIG_SOURCE.loader.receiptBytes, sha256: MAC_CONFIG_SOURCE.loader.receiptSha256 }],
] as const);

export type InstalledMacExecutionAssets = Readonly<{
    binaryPath: string;
    nativeSourcePath: string;
    schemaDirectory: string;
    c1ReceiptPath: string;
}>;
export type MacExecutionAssetLayout = Readonly<{
    installationRoot: string;
    bundleContents: string | null;
    assetDirectory: string;
    binaryDirectory: string;
    assets: InstalledMacExecutionAssets;
}>;

const fail = (): never => { throw new ExecutionError('unqualified_boundary'); };

/** No realpath coercion: reject aliases, including symlinks ABOVE the given root.
 * Only ancestors of the supplied path are inspected, never the host filesystem. */
export function physicalMacAssetPath(path: string, kind: 'file' | 'directory'): string {
    try {
        if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || /[\x00-\x1f\x7f]/u.test(path)) fail();
        const root = parse(path).root;
        let current = root;
        const parts = path.slice(root.length).split(sep).filter(Boolean);
        for (let index = 0; index < parts.length; index += 1) {
            current = join(current, parts[index]);
            const status = lstatSync(current);
            if (status.isSymbolicLink() || (index === parts.length - 1 && kind === 'file' ? !status.isFile() : !status.isDirectory())) fail();
        }
        if (kind === 'file' && !parts.length || realpathSync(path) !== path) fail();
        return path;
    } catch { return fail(); }
}

function child(root: string, ...parts: string[]): string {
    const candidate = join(root, ...parts), delta = relative(root, candidate);
    if (!delta || delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)) fail();
    return candidate;
}

/** The server cwd is either a normal standalone root or EXACTLY the packaged
 * .app/Contents/Resources/WebRuntime. Malformed bundle paths never fall back to
 * standalone. Bundle markers establish structure only, not signing or trust. */
export function macExecutionAssetLayout(installationRoot: string): MacExecutionAssetLayout {
    const root = physicalMacAssetPath(installationRoot, 'directory');
    const parts = root.split(sep);
    const appAncestors = parts.filter(part => part.endsWith('.app'));
    const resources = dirname(root), contents = dirname(resources), app = dirname(contents);
    const bundleShaped = basename(root) === 'WebRuntime' && basename(resources) === 'Resources' && basename(contents) === 'Contents';
    let bundleContents: string | null = null;
    if (appAncestors.length || bundleShaped) {
        if (!bundleShaped || appAncestors.length !== 1 || !basename(app).endsWith('.app')) fail();
        physicalMacAssetPath(child(contents, 'Info.plist'), 'file');
        const executable = physicalMacAssetPath(child(contents, 'MacOS', 'MediFlow'), 'file');
        if (!(lstatSync(executable).mode & 0o111)) fail();
        physicalMacAssetPath(child(root, 'server.js'), 'file');
        bundleContents = contents;
    }
    const assetDirectory = child(root, ...MAC_EXECUTION_ASSET_PARTS);
    const binaryDirectory = bundleContents
        ? child(bundleContents, 'Helpers') : assetDirectory;
    return Object.freeze({ installationRoot: root, bundleContents, assetDirectory, binaryDirectory,
        assets: Object.freeze({ binaryPath: child(binaryDirectory, bundleContents ? MAC_EXECUTION_HELPER_NAME : 'codex'), nativeSourcePath: child(assetDirectory, 'mac-owner.c'),
            schemaDirectory: child(assetDirectory, 'schema'), c1ReceiptPath: child(assetDirectory, 'C1-RECEIPT.json') }) });
}

/** Used by the build-time stager for its explicit public inputs too. This checks
 * bytes only; it cannot issue an authority or select a runtime executable. */
export function verifyMacExecutionAssetFiles(assets: InstalledMacExecutionAssets): void {
    physicalMacAssetPath(assets.schemaDirectory, 'directory');
    for (const [name, pin] of MAC_EXECUTION_SCHEMA_FILES) readPinnedMacFile(physicalMacAssetPath(child(assets.schemaDirectory, name), 'file'), pin);
    readPinnedMacFile(physicalMacAssetPath(assets.c1ReceiptPath, 'file'), MAC_C1_RECEIPT);
    readPinnedMacFile(physicalMacAssetPath(assets.nativeSourcePath, 'file'), MAC_NATIVE_SOURCE);
    readPinnedMacFile(physicalMacAssetPath(assets.binaryPath, 'file'), MAC_EXECUTION_BINARY_PIN);
    const mode = lstatSync(assets.binaryPath).mode;
    if (!(mode & 0o111) || mode & 0o6000) fail();
    // Rewalk containment after hashing. Runtime qualification separately copies,
    // pins and protects its own bytes; this resolver is not a TOCTOU lease.
    for (const path of [assets.binaryPath, assets.nativeSourcePath, assets.c1ReceiptPath]) physicalMacAssetPath(path, 'file');
    physicalMacAssetPath(assets.schemaDirectory, 'directory');
}

function exactEntries(path: string, expected: readonly string[]): void {
    physicalMacAssetPath(path, 'directory');
    if (JSON.stringify(readdirSync(path).sort()) !== JSON.stringify([...expected].sort())) fail();
}

/** Read-only, including when used after signing. No environment path overrides,
 * symlinks, legacy fallback inside an app, or alternate binary candidates. */
export function resolveInstalledMacExecutionAssets(installationRoot: string = process.cwd()): InstalledMacExecutionAssets {
    try {
        const layout = macExecutionAssetLayout(installationRoot);
        exactEntries(layout.assetDirectory, layout.bundleContents
            ? ['C1-RECEIPT.json', 'mac-owner.c', 'schema'] : ['C1-RECEIPT.json', 'codex', 'mac-owner.c', 'schema']);
        exactEntries(layout.assets.schemaDirectory, MAC_EXECUTION_SCHEMA_FILES.map(([name]) => name));
        if (layout.bundleContents) physicalMacAssetPath(layout.binaryDirectory, 'directory');
        verifyMacExecutionAssetFiles(layout.assets);
        macExecutionAssetLayout(installationRoot);
        return layout.assets;
    } catch { return fail(); }
}
