/* @Codex — resolves a fixed deployed payload; it does not qualify execution. */
import 'server-only';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { MAC_C1_RECEIPT, MAC_CONFIG_SOURCE, readPinnedMacFile } from './execution-mac-config';
import { ExecutionError } from './execution-contract';

const RELATIVE_ROOT = ['resources', 'chatgpt-execution', 'mac', 'codex-0.153.4'] as const;
const SCHEMA_FILES = Object.freeze([
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

const fail = (): never => { throw new ExecutionError('unqualified_boundary'); };

function physicalDirectory(path: string): string {
    try {
        const status = lstatSync(path);
        if (!status.isDirectory() || status.isSymbolicLink()) fail();
        return realpathSync(path);
    } catch { return fail(); }
}

function physicalFile(path: string): string {
    try {
        const status = lstatSync(path);
        if (!status.isFile() || status.isSymbolicLink()) fail();
        return path;
    } catch { return fail(); }
}

function contained(root: string, ...parts: string[]): string {
    const candidate = normalize(join(root, ...parts));
    if (relative(root, candidate).startsWith('..') || !candidate.startsWith(root + '/')) fail();
    return candidate;
}

/** Resolves only the packaged, immutable layout. Missing or altered assets remain HELD. */
export function resolveInstalledMacExecutionAssets(installationRoot: string = process.cwd()): InstalledMacExecutionAssets {
    if (typeof installationRoot !== 'string' || !isAbsolute(installationRoot) || normalize(installationRoot) !== installationRoot) fail();
    const root = physicalDirectory(resolve(installationRoot));
    let assetRoot = root;
    for (const part of RELATIVE_ROOT) assetRoot = physicalDirectory(contained(assetRoot, part));
    const schemaDirectory = physicalDirectory(contained(assetRoot, 'schema'));
    const binaryPath = physicalFile(contained(assetRoot, 'codex'));
    const nativeSourcePath = physicalFile(contained(assetRoot, 'mac-owner.c'));
    const c1ReceiptPath = physicalFile(contained(assetRoot, 'C1-RECEIPT.json'));
    for (const [name, pin] of SCHEMA_FILES) readPinnedMacFile(physicalFile(contained(schemaDirectory, name)), pin);
    readPinnedMacFile(c1ReceiptPath, MAC_C1_RECEIPT);
    return Object.freeze({ binaryPath, nativeSourcePath, schemaDirectory, c1ReceiptPath });
}
