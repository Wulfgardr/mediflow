/* @Codex — explicit build-time staging of public Mac execution assets only. */
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { resolveInstalledMacExecutionAssets } from '../lib/chatgpt-execution/execution-mac-assets';
import { MAC_C1_RECEIPT, MAC_CONFIG_SOURCE, readPinnedMacFile } from '../lib/chatgpt-execution/execution-mac-config';

const ASSET_PATH = ['resources', 'chatgpt-execution', 'mac', 'codex-0.153.4'] as const;
const SCHEMA_FILES = ['config.schema.json', 'RECEIPT.json', 'config-loader-mod.rs', 'LOADER-RECEIPT.json'] as const;
const REQUIRED = ['installation-root', 'binary', 'native-source', 'schema-directory', 'c1-receipt'] as const;
type ArgumentName = typeof REQUIRED[number];

const fail = (message: string): never => { throw new Error(`CHATGPT_EXECUTION_MAC_ASSETS: ${message}`); };

function parseArguments(argv: readonly string[]): Record<ArgumentName, string> {
    const values = Object.create(null) as Record<ArgumentName, string>;
    for (let index = 0; index < argv.length; index += 1) {
        const match = /^--([a-z0-9-]+)$/u.exec(argv[index]);
        const rawName = match?.[1];
        if (!rawName) fail('ingressi CLI non validi');
        const name = rawName as ArgumentName;
        if (!REQUIRED.includes(name) || values[name] || index + 1 >= argv.length) fail('ingressi CLI non validi');
        const value = argv[++index];
        if (!value || value.startsWith('--')) fail('ingressi CLI non validi');
        values[name] = value;
    }
    for (const name of REQUIRED) if (!values[name]) fail(`manca --${name}`);
    return values;
}

function regularSource(path: string): string {
    try {
        const value = resolve(path), status = lstatSync(value);
        if (!isAbsolute(path) || normalize(path) !== path || !status.isFile() || status.isSymbolicLink()) fail('sorgente non fisica');
        return value;
    } catch { return fail('sorgente non fisica'); }
}

function safeDirectories(root: string, parts: readonly string[]): string {
    if (!isAbsolute(root) || normalize(root) !== root) fail('installation root non valido');
    let current = root;
    try {
        const status = lstatSync(current);
        if (!status.isDirectory() || status.isSymbolicLink() || realpathSync(current) !== current) fail('installation root non fisico');
        for (const part of parts) {
            const next = join(current, part);
            if (relative(root, next).startsWith('..')) fail('destinazione fuori dal root');
            try {
                const nextStatus = lstatSync(next);
                if (!nextStatus.isDirectory() || nextStatus.isSymbolicLink() || realpathSync(next) !== next) fail('destinazione non fisica');
            } catch {
                mkdirSync(next, { mode: 0o755 });
            }
            current = next;
        }
        return current;
    } catch (error) { if (error instanceof Error && error.message.startsWith('CHATGPT_EXECUTION_MAC_ASSETS:')) throw error; return fail('destinazione non preparabile'); }
}

function validatePublicSources(schemaDirectory: string, c1Receipt: string): void {
    const status = lstatSync(schemaDirectory);
    if (!status.isDirectory() || status.isSymbolicLink()) fail('schema directory non fisica');
    try {
        readPinnedMacFile(regularSource(join(schemaDirectory, 'config.schema.json')), MAC_CONFIG_SOURCE);
        readPinnedMacFile(regularSource(join(schemaDirectory, 'RECEIPT.json')), MAC_CONFIG_SOURCE.receipt);
        readPinnedMacFile(regularSource(join(schemaDirectory, 'config-loader-mod.rs')), MAC_CONFIG_SOURCE.loader);
        readPinnedMacFile(regularSource(join(schemaDirectory, 'LOADER-RECEIPT.json')), {
            bytes: MAC_CONFIG_SOURCE.loader.receiptBytes, sha256: MAC_CONFIG_SOURCE.loader.receiptSha256,
        });
        readPinnedMacFile(c1Receipt, MAC_C1_RECEIPT);
    } catch { fail('pin pubblico non valido'); }
}

function samePhysicalBytes(source: string, target: string): boolean {
    try {
        const status = lstatSync(target);
        if (!status.isFile() || status.isSymbolicLink()) return false;
        const left = readFileSync(source), right = readFileSync(target);
        return left.equals(right) && createHash('sha256').update(left).digest('hex') === createHash('sha256').update(right).digest('hex');
    } catch { return false; }
}

function existingPayload(destination: string, binary: string, nativeSource: string, schemaDirectory: string, c1Receipt: string): boolean {
    try {
        if (!lstatSync(destination).isDirectory()
            || JSON.stringify(readdirSync(destination).sort()) !== JSON.stringify(['C1-RECEIPT.json', 'codex', 'mac-owner.c', 'schema'])
            || JSON.stringify(readdirSync(join(destination, 'schema')).sort()) !== JSON.stringify([...SCHEMA_FILES].sort())) return false;
        resolveInstalledMacExecutionAssets(dirname(dirname(dirname(dirname(destination)))));
        return samePhysicalBytes(binary, join(destination, 'codex'))
            && samePhysicalBytes(nativeSource, join(destination, 'mac-owner.c'))
            && samePhysicalBytes(c1Receipt, join(destination, 'C1-RECEIPT.json'))
            && SCHEMA_FILES.every(name => samePhysicalBytes(join(schemaDirectory, name), join(destination, 'schema', name)));
    } catch { return false; }
}

function stage(values: Record<ArgumentName, string>): void {
    const requestedRoot = resolve(values['installation-root']);
    if (!isAbsolute(values['installation-root']) || normalize(values['installation-root']) !== values['installation-root']) fail('installation root non canonico');
    const requestedRootStatus = lstatSync(requestedRoot);
    if (!requestedRootStatus.isDirectory() || requestedRootStatus.isSymbolicLink()) fail('installation root non fisico');
    const root = realpathSync(requestedRoot);
    const binary = regularSource(values.binary), nativeSource = regularSource(values['native-source']);
    const schemaDirectory = resolve(values['schema-directory']);
    if (!isAbsolute(values['schema-directory']) || normalize(values['schema-directory']) !== values['schema-directory']) fail('schema directory non valido');
    const c1Receipt = regularSource(values['c1-receipt']);
    validatePublicSources(schemaDirectory, c1Receipt);
    const destination = join(root, ...ASSET_PATH);
    try {
        lstatSync(destination);
        if (!existingPayload(destination, binary, nativeSource, schemaDirectory, c1Receipt)) fail('payload esistente non idempotente');
        return;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('CHATGPT_EXECUTION_MAC_ASSETS:')) throw error;
    }
    safeDirectories(root, ASSET_PATH);
    const schemaDestination = safeDirectories(destination, ['schema']);
    copyFileSync(binary, join(destination, 'codex'));
    copyFileSync(nativeSource, join(destination, 'mac-owner.c'));
    for (const name of SCHEMA_FILES) copyFileSync(regularSource(join(schemaDirectory, name)), join(schemaDestination, name));
    copyFileSync(c1Receipt, join(destination, 'C1-RECEIPT.json'));
    resolveInstalledMacExecutionAssets(root);
}

try { stage(parseArguments(process.argv.slice(2))); }
catch (error) { console.error(error instanceof Error ? error.message : 'CHATGPT_EXECUTION_MAC_ASSETS: staging fallito'); process.exitCode = 1; }
