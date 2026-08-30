/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
    symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { gunzipSync } from 'node:zlib';

import {
    allowedGenericLoaderExpressions,
    createRequireBypassFixtures,
    createRequireUnresolvedFixtures,
    inventoryModuleImports,
    moduleImportBypassFixtures,
    unsafeLoaderIdentityFixtures,
} from './module-import-inventory.test-support.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PACKAGE = '@mediflow/web-auth-lifecycle-owner';
const PACKAGE_ROOT = 'packages/web-auth-lifecycle-owner';
const PACKAGE_MANIFEST_FILE = `${PACKAGE_ROOT}/package.json`;
const PACKAGE_ENTRY_FILE = `${PACKAGE_ROOT}/index.js`;
const PREPARED_PACKAGE_TARBALL = `${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.tgz`;
const PREPARED_PACKAGE_PROVENANCE = `${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.provenance.json`;
const PREPARED_PACKAGE_DEPENDENCY = `file:${PREPARED_PACKAGE_TARBALL}`;
const PREPARED_PACKAGE_VERSION = '0.8.5-prepared.0';
const PREPARED_PACKAGE_SHA256 = '4f03a28891ff1dbe4539e2a297334d7bbeee23dfc42c7cf4793fb38c3fde5d5a';
const PREPARED_PROVENANCE_SHA256 = '9c7dfeb27b9cfc7fbfb1d08a71478912cb9d51e31b662b4bc587b4bb1b61b96a';
const PREPARED_PACKAGE_INTEGRITY = 'sha512-m0ZCMZQ8Mgothnd/Dig5o6pgpkd8YJRB24cTMcXrTJUKr4qO0GEYwcgbgprRkM0aRiLTAOCcXDMHHih3KIvM6A==';
const PREPARED_INDEX_SHA256 = '7bc72383ad0639480702aadb8bad2cacf135c2c1b1cb7013a68ed5eef6d26a4f';
const PREPARED_MANIFEST_SHA256 = 'ee606c50ba3a13d072143aa3149afe39f1a8ceee9ce4982f9a99ceacb53b0db7';
const ADAPTER = 'lib/security/web-auth-lifecycle-owner-adapter';
const ADAPTER_FILE = `${ADAPTER}.ts`;
const ADAPTER_TEST = `${ADAPTER}.test`;
const ADAPTER_TEST_FILE = `${ADAPTER_TEST}.ts`;
const THIS_FILE = 'lib/security/web-auth-lifecycle-owner-boundary.test.ts';
// @Codex: this exact selector is tooling metadata, not a package load or ownership edge.
const ESLINT_CONFIG_FILE = 'eslint.config.mjs';
const OWNER_COMMONJS_LINT_GLOB = `${PACKAGE_ROOT}/**/*.cjs`;
const OWNER_COMMONJS_LINT_CONFIG_SHA256 = '57d021a63d44c33c891d514daac17a58e4409fd7b7b639583c97e74e92a1a1ae';
const OWNER_TARGETS = [
    'lib/security/web-auth-control-record', 'lib/security/web-auth-control-owner', 'lib/security/server-session',
    'lib/security/server-session-projection-owner', 'lib/security/server-session-projection-owner-production',
] as const;
const IMPORT_FORMS = new Set([
    'named', 'default', 'namespace', 'side-effect', 're-export', 'require', 'dynamic', 'import-type',
    'require-options', 'dynamic-options',
]);
const UNRESOLVED_LOADER_FORMS = new Set([
    'unsupported-expression', 'protected-loader-unsupported', 'reserved-loader-identity', 'code-loader',
]);
const PRE_CUTOVER_UNRESOLVED_LOADERS = new Map([
    ['lib/security/server-session.test.ts', 'e32f86d5ede4060e3d55ed776832aefd3a92d88a2b197e7aedc0aa08bdc71e13'],
    ['native/MediFlowMac/Tests/MediFlowCoreTests/Fixtures/generate-fixture.mjs', '9e3019e28cc78f170dfffe8ab82fc2c744be8b9a6e0875f4116e20bd9ad45897'],
    ['scripts/backup-restore-drill.mjs', 'b9ab5380c602d87971fe67b27db756e3cb1d57bff51d4154b322ae13150ad711'],
    ['scripts/backup-restore-date-fields.test.mjs', 'fb3879de5c0518074b2983c24930fbc0913be8a800e29f923cf205879b19f531'],
    ['scripts/check-standalone-runtime-bundle.mjs', '913a76e3ef30fbe314aceabf7b3ce0d4ac1bc2c8e0e2de2c61115e9c6fe54ea5'],
    ['scripts/durable-review-record-store-worker.mjs', '4302cd00c488a2edb7039dfe3acf32ee083944942afc63db015cf0cd9f728fa4'],
    ['scripts/node-runtime-contract.mjs', '55638610b2445124751f1bb4381ce84afac3bf4be405e5e5ee07474b0a96488b'],
]);
const AUTHORITY_ROSTER_SHA256 = '8cef18fd9f1e29f5f48a285092c9cd159e0be707a27d4977cbb43cf4df77b08d';
const PRE_CUTOVER_GLOBAL_OWNER_SHA256 = 'ae959c2ba88cb768b106aa52d7fec1ea2f6acc7407db194ad9765799ec2fa854';
const PRE_CUTOVER_GLOBAL_OWNER = 'lib/security/server-session-projection-owner-production.ts';
const DORMANT_ADAPTER_SOURCE = "import 'server-only';\nexport const lifecycleOwnerAdapterState = 'dormant_prepared' as const;\nexport type LifecycleOwnerAdapterState = typeof lifecycleOwnerAdapterState;";
const PREPARED_PACKAGE_MANIFEST = `{\n  "name": "${PACKAGE}",\n  "version": "0.8.5-prepared.0",\n  "private": true,\n  "type": "commonjs",\n  "main": "./index.js",\n  "exports": "./index.js",\n  "files": ["index.js", "internal/"],\n  "engines": { "node": ">=24 <25" }\n}\n`;
const PREPARED_PACKAGE_ENTRY = "/* @Codex */\n'use strict';\nmodule.exports = Object.freeze(Object.create(null));\n";
const STATEFUL_AUTHORITY_MODULES = new Set([
    'active-review-binding', 'audit', 'in-process-preview-job-control', 'module-import-inventory.test-support', 'pin-change',
    'server-session-projection-owner-production', 'server-session', 'session-physician-review-authority',
    'smart-import-browser-orchestrator', 'smart-import-context-proposal-browser-adapter',
    'smart-import-projection-attachment-browser-normalizer', 'smart-import-selection-browser-adapter',
    'web-auth-control-owner', 'web-auth-session-issuer',
].map((name) => `lib/security/${name}.ts`));
type Sources = Readonly<Record<string, string>>;
type ExpectedFile = Readonly<{ path: string; bytes: number; sha256: string }>;
type PreparedContract = Readonly<{
    version: string; sequence: number; manifest: string; tarball: string; provenancePath: string; dependency: string;
    tar: ExpectedFile & Readonly<{ integrity: string }>; provenance: unknown; predecessor?: Readonly<{
        version: string; tarSha256: string; provenanceSha256: string }>;
    inputs: readonly ExpectedFile[]; roster: readonly (ExpectedFile & Readonly<{ type: 'file'; mode: '0644' }>)[];
    artifacts: readonly ExpectedFile[];
}>;
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const decodedIdentity = (value: string): string | null => { let decoded = value; try { for (let index = 0; index < 4; index += 1) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } return decoded; } catch { return null; } };
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, JSON.parse(canonical(item))]))
    : Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item))) : value);
const sourceFiles = (root: string): Record<string, string> => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory() && !['.git', '.next', 'node_modules'].includes(entry.name)) return walk(absolute);
        return entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name) ? [absolute] : [];
    });
    return Object.fromEntries(walk(root).map((absolute) => [path.relative(root, absolute), readFileSync(absolute, 'utf8')]));
};
const ast = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const printed = (file: string, source: string) => ts.createPrinter({ removeComments: true }).printFile(ast(file, source));
const DORMANT_ADAPTER_CONTRACT = printed(ADAPTER_FILE, DORMANT_ADAPTER_SOURCE);
const parseErrors = (file: string, source: string) =>
    (ast(file, source) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length;
type ScanOps = Readonly<{ exists(value: string): boolean; realpath(value: string): string;
    read(value: string): string;
    readdir(value: string): ReadonlyArray<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }> }>;
const SCAN_OPS: ScanOps = { exists: existsSync, realpath: realpathSync.native,
    read: (value) => readFileSync(value, 'utf8'),
    readdir: (value) => readdirSync(value, { withFileTypes: true }) };
const ownerPackageCopies = (root: string, ops = SCAN_OPS) => {
    const sourceRoot = path.join(root, PACKAGE_ROOT); let sourceReal: string | null = null;
    try { if (ops.exists(sourceRoot)) sourceReal = ops.realpath(sourceRoot); } catch { return ['<unscannable>']; }
    const pending = [path.join(root, 'node_modules')]; const seen = new Set<string>();
    const seenPackages = new Set<string>(); const found: string[] = [];
    const inspectPackage = (packageRoot: string, logicalName: string): void => {
        let real: string;
        try { real = ops.realpath(packageRoot); } catch { found.push('<unscannable>'); return; }
        if (seenPackages.has(real)) return; seenPackages.add(real);
        const manifestFile = path.join(packageRoot, 'package.json'); let manifestName: unknown;
        try { if (ops.exists(manifestFile)) manifestName = (JSON.parse(ops.read(manifestFile)) as { name?: unknown }).name; }
        catch { found.push('<unscannable>'); return; }
        if (logicalName === PACKAGE || manifestName === PACKAGE || (sourceReal !== null && real === sourceReal))
            found.push(packageRoot);
        pending.push(path.join(packageRoot, 'node_modules'));
    };
    while (pending.length > 0) {
        const directory = pending.pop()!; if (!ops.exists(directory)) continue;
        let real: string; try { real = ops.realpath(directory); } catch { return [...found, '<unscannable>']; }
        if (seen.has(real)) continue; seen.add(real); if (seen.size > 4_096) return [...found, '<scan-limit>'];
        try { for (const entry of ops.readdir(directory)) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const candidate = path.join(directory, entry.name);
            if (entry.name === '.pnpm') {
                for (const item of ops.readdir(candidate)) if (item.isDirectory() || item.isSymbolicLink())
                    pending.push(path.join(candidate, item.name, 'node_modules'));
            } else if (entry.name.startsWith('@')) {
                for (const item of ops.readdir(candidate)) if (item.isDirectory() || item.isSymbolicLink())
                    inspectPackage(path.join(candidate, item.name), `${entry.name}/${item.name}`);
            } else inspectPackage(candidate, entry.name);
        } } catch { return [...found, '<unscannable>']; }
    }
    return found;
};
const importInventoryErrors = (sources: Sources, allowAdapterTestUse = false,
    packageAliases: ReadonlySet<string> = new Set()): string[] => {
    const errors: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
        const dormantPackageFile = file === PACKAGE_ENTRY_FILE || file.startsWith(`${PACKAGE_ROOT}/internal/`);
        const futureSuccessorFence = file === `${PACKAGE_ROOT}/internal/support/successor-fence.cjs`
            && source === PREPARED_2_SUCCESSOR_FENCE;
        const unresolvedLoaderIsKnown = PRE_CUTOVER_UNRESOLVED_LOADERS.get(file) === digest(source);
        const packageTarget = path.join(path.dirname(file), PACKAGE);
        const packageUses = inventoryModuleImports({ file, source, target: packageTarget, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const packageRelevant = packageUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown));
        const packageSourceUses = inventoryModuleImports({ file, source, target: PACKAGE_ENTRY_FILE, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const packageSourceRelevant = packageSourceUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown));
        if (!dormantPackageFile && (packageRelevant.length > 0 || packageSourceRelevant.length > 0))
            errors.push(`${file}:package-load`);
        for (const alias of packageAliases) {
            if (alias.startsWith('<')) continue;
            const aliasUses = inventoryModuleImports({ file, source, target: path.join(path.dirname(file), alias),
                repositoryRoot: ROOT, allowUnresolvedExpressions: allowedGenericLoaderExpressions });
            if (aliasUses.some((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
                || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown)))
                errors.push(`${file}:package-alias-load`);
        }
        const packageAst = ast(file, source); let deniedPackageLiteral = false; let directPackageLoad = false;
        const constants = new Map<string, ts.Expression>();
        const collectConstants = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
            ts.forEachChild(node, collectConstants);
        };
        collectConstants(packageAst);
        const staticString = (node: ts.Expression, seen = new Set<string>()): string | null => {
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
                const left = staticString(node.left, seen); const right = staticString(node.right, seen);
                return left === null || right === null ? null : left + right;
            }
            if (ts.isTemplateExpression(node)) {
                let value = node.head.text; for (const span of node.templateSpans) { const part = staticString(span.expression, seen);
                    if (part === null) return null; value += part + span.literal.text; } return value;
            }
            if (ts.isIdentifier(node) && !seen.has(node.text) && constants.has(node.text))
                return staticString(constants.get(node.text)!, new Set(seen).add(node.text));
            return null;
        };
        const visitPackage = (node: ts.Node): void => {
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node) || ts.isIdentifier(node)) {
                const value = staticString(node); const sourcePath = value === null ? null
                    : path.resolve(path.dirname(path.join(ROOT, file)), value);
                const decoded = value === null ? null : decodedIdentity(value);
                const packageRelative = sourcePath === null ? null : path.relative(path.join(ROOT, PACKAGE_ROOT), sourcePath);
                const ownerIdentity = value === PACKAGE || value?.startsWith(`${PACKAGE}/`)
                    || (packageRelative !== null && packageRelative !== '' && !packageRelative.startsWith('..')
                        && !path.isAbsolute(packageRelative)) || sourcePath === path.join(ROOT, PACKAGE_ROOT)
                    || [...packageAliases].some((alias) => decoded === alias || decoded?.startsWith(`${alias}/`));
                if (ownerIdentity) { const parent = node.parent;
                    const isDirectPackageLoad = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
                        && parent.moduleSpecifier === node
                        || (ts.isCallExpression(parent) && parent.arguments[0] === node
                            && (parent.expression.kind === ts.SyntaxKind.ImportKeyword
                                || ts.isIdentifier(parent.expression) && parent.expression.text === 'require'));
                    const lintFilesProperty = ts.isArrayLiteralExpression(parent) ? parent.parent : undefined;
                    const allowedLintSelector = file === ESLINT_CONFIG_FILE && value === OWNER_COMMONJS_LINT_GLOB
                        && digest(source) === OWNER_COMMONJS_LINT_CONFIG_SHA256
                        && ts.isArrayLiteralExpression(parent) && lintFilesProperty !== undefined
                        && ts.isPropertyAssignment(lintFilesProperty)
                        && lintFilesProperty.initializer === parent
                        && (ts.isIdentifier(lintFilesProperty.name) || ts.isStringLiteral(lintFilesProperty.name))
                        && lintFilesProperty.name.text === 'files';
                    if (!allowedLintSelector) deniedPackageLiteral = true;
                    if (isDirectPackageLoad) directPackageLoad = true; }
            }
            ts.forEachChild(node, visitPackage);
        };
        visitPackage(packageAst); if ((deniedPackageLiteral && file !== THIS_FILE && !dormantPackageFile)
            || (directPackageLoad && !dormantPackageFile))
            errors.push(`${file}:package-literal`);
        const adapterUses = inventoryModuleImports({ file, source, target: ADAPTER, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const allowedTestUse = allowAdapterTestUse && file === ADAPTER_TEST_FILE && adapterUses.every((use) =>
            (use.form === 'named' && !use.typeOnly) || (use.form === 'import-type' && use.typeOnly));
        const adapterRelevant = adapterUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown)
            || source.includes('web-auth-lifecycle-owner-adapter'));
        if (adapterRelevant.length > 0 && !allowedTestUse && !futureSuccessorFence) errors.push(`${file}:adapter-load`);
        const adapterTestUses = inventoryModuleImports({ file, source, target: ADAPTER_TEST, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const adapterTestRelevant = adapterTestUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || ((UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown)
                && source.includes('web-auth-lifecycle-owner-adapter.test')));
        if (file !== ADAPTER_TEST_FILE && adapterTestRelevant.length > 0) errors.push(`${file}:adapter-test-reachability`);
        if (parseErrors(file, source) > 0) errors.push(`${file}:parse`);
    }
    return errors;
};
const authorityRosterDigest = (sources: Sources) => {
    const roster: Array<readonly [string, string, string, string, boolean]> = [];
    for (const target of OWNER_TARGETS) for (const [file, source] of Object.entries(sources)) {
        for (const use of inventoryModuleImports({ file, source, target, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions })) {
            if (IMPORT_FORMS.has(use.form)) roster.push([target, use.file, use.form, use.symbol, use.typeOnly]);
        }
    }
    roster.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return digest(JSON.stringify(roster));
};
const statefulAuthorityModules = (sources: Sources) => new Set(Object.entries(sources).filter(([file, source]) =>
    file.startsWith('lib/security/') && !file.endsWith('.test.ts') && file !== ADAPTER_FILE
    && /(?:owner|authority|session|control)/iu.test(`${file} ${source}`)
    && /(?:new\s+(?:Map|Set|WeakMap)\b|globalThis\b|Symbol\.for\s*\()/u.test(source)).map(([file]) => file));

const dormantAdapterErrors = (source: string): string[] => {
    const errors: string[] = []; const tree = ast(ADAPTER_FILE, source); let serverOnly = 0;
    const banned = new Set(['Map', 'Set', 'WeakMap', 'global', 'globalThis', 'process', 'require', 'eval', 'Function', 'createRequire']);
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && banned.has(node.text)) errors.push(`adapter:${node.text}`);
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
            && node.getText(tree).match(/(?:\.cache\b|Symbol\s*(?:\.|\[)\s*['"]?for)/u)) errors.push('adapter:ambient');
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) errors.push('adapter:call');
        ts.forEachChild(node, visit);
    };
    visit(tree);
    if (/(?:select(?:ion)?Owner|ownerSelector|historicalOwner|legacyOwner|server-session-projection-owner-production)/iu.test(source)) errors.push('adapter:owner-selector');
    for (const statement of tree.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
            if (!statement.importClause && specifier === 'server-only') serverOnly += 1;
            else if (!statement.importClause?.isTypeOnly
                && !(statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
                    && statement.importClause.namedBindings.elements.every((item) => item.isTypeOnly))) errors.push('adapter:runtime-import');
            continue;
        }
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
        if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
            && statement.declarationList.declarations.every((item) => item.initializer
                && /^(?:['"`][\s\S]*['"`]|(?:true|false)|\d+)(?:\s+as\s+const)?$/u.test(item.initializer.getText(tree)))) continue;
        errors.push('adapter:stateful-declaration');
    }
    if (serverOnly !== 1) errors.push('adapter:server-only');
    if (printed(ADAPTER_FILE, source) !== DORMANT_ADAPTER_CONTRACT) errors.push('adapter:exact-contract');
    return [...new Set(errors)];
};

type PackageSourceOps = Readonly<{
    exists(value: string): boolean;
    read(value: string): string;
    realpath(value: string): string;
    readdir(value: string): ReadonlyArray<{
        name: string; isFile(): boolean; isDirectory?(): boolean; isSymbolicLink(): boolean;
    }>;
}>;
const PACKAGE_SOURCE_OPS: PackageSourceOps = {
    exists: (value) => { try { lstatSync(value); return true; } catch { return false; } },
    read: (value) => readFileSync(value, 'utf8'), realpath: realpathSync.native,
    readdir: (value) => readdirSync(value, { withFileTypes: true }),
};
const packageSourceArtifacts = (root: string, ops = PACKAGE_SOURCE_OPS): Sources => {
    const directory = path.join(root, PACKAGE_ROOT);
    if (!ops.exists(directory)) return {};
    try {
        if (ops.realpath(directory) !== path.join(ops.realpath(root), PACKAGE_ROOT))
            return { '<package-source-symlink>': '' };
        const walk = (relative = ''): Array<readonly [string, string]> => ops.readdir(path.join(directory, relative))
            .flatMap((entry) => {
                const nested = path.join(relative, entry.name); const file = path.join(PACKAGE_ROOT, nested);
                if (entry.isSymbolicLink()) return [[`<package-source-link:${nested}>`, '']];
                if (entry.isFile()) return [[file, ops.read(path.join(root, file))]];
                if (entry.isDirectory?.() && relative === '' && entry.name === 'artifacts') return [];
                if (entry.isDirectory?.() && (nested === 'internal' || nested.startsWith(`internal${path.sep}`))) {
                    const children = walk(nested); return children.length > 0 ? children : [[`<package-source-empty:${nested}>`, '']];
                }
                return [[`<package-source-invalid:${nested}>`, '']];
            });
        return Object.fromEntries(walk());
    } catch { return { '<package-source-unscannable>': '' }; }
};
const duplicateJsonKeys = (source: string): boolean => {
    const tree = ts.parseJsonText(PACKAGE_MANIFEST_FILE, source); let duplicate = false;
    const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            const names = new Set<string>();
            for (const property of node.properties) if (ts.isPropertyAssignment(property)) {
                const name = ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
                    ? property.name.text : property.name.getText(tree);
                if (names.has(name)) duplicate = true; names.add(name);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(tree); return duplicate;
};
const packageSourceErrors = (artifacts: Sources, contract: PreparedContract = LIVE_PREPARED_CONTRACT): string[] => {
    const expectedFiles = contract.inputs.map((file) => `${PACKAGE_ROOT}/${file.path}`);
    if (canonical(Object.keys(artifacts).sort()) !== canonical(expectedFiles.sort()))
        return ['package-source:inventory'];
    let manifest: unknown;
    try { manifest = JSON.parse(artifacts[PACKAGE_MANIFEST_FILE]!); } catch { return ['package-source:manifest-parse']; }
    const expectedManifest = JSON.parse(contract.manifest) as unknown;
    const errors: string[] = [];
    if (duplicateJsonKeys(artifacts[PACKAGE_MANIFEST_FILE]!) || !manifest || typeof manifest !== 'object'
        || JSON.stringify(Object.keys(manifest)) !== JSON.stringify(Object.keys(expectedManifest as object))
        || canonical(manifest) !== canonical(expectedManifest)) errors.push('package-source:manifest');
    if (parseErrors(PACKAGE_ENTRY_FILE, artifacts[PACKAGE_ENTRY_FILE]!) > 0
        || printed(PACKAGE_ENTRY_FILE, artifacts[PACKAGE_ENTRY_FILE]!) !== printed(PACKAGE_ENTRY_FILE, PREPARED_PACKAGE_ENTRY))
        errors.push('package-source:entry');
    for (const expected of contract.inputs) { const source = artifacts[`${PACKAGE_ROOT}/${expected.path}`]!;
        if (Buffer.byteLength(source) !== expected.bytes || digest(source) !== expected.sha256)
            errors.push(`package-source:${expected.path}`); }
    return errors;
};

const ownerPackageReference = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const decoded = decodedIdentity(value); if (decoded === null) return true;
    if (decoded === PACKAGE || decoded.startsWith(`${PACKAGE}/`) || decoded.startsWith(`${PACKAGE}@`)
        || decoded.startsWith(`npm:${PACKAGE}@`) || decoded.includes(`/${PACKAGE}/`)) return true;
    const local = decoded.replace(/^(?:file|link):/u, '').split(/[?#]/u, 1)[0]!;
    const resolved = path.resolve(ROOT, local); const sourceRoot = path.join(ROOT, PACKAGE_ROOT);
    const relative = path.relative(sourceRoot, resolved);
    return resolved === sourceRoot || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
        && (relative.startsWith(`internal${path.sep}`)
            || /^artifacts[/\\]mediflow-web-auth-lifecycle-owner-0\.8\.5-prepared\.\d+\.(?:tgz|provenance\.json)$/u.test(relative)));
};
const lockPackageAlias = (key: string): string | null => {
    const marker = 'node_modules/'; const index = key.lastIndexOf(marker);
    if (index < 0) return null;
    const remainder = key.slice(index + marker.length); const segments = remainder.split('/');
    return segments[0]?.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] ?? null;
};
const ownerLockAliases = (source: string): Set<string> => {
    const aliases = new Set<string>(); if (source.trim() === '') return aliases;
    let lock: unknown;
    try { lock = JSON.parse(source); } catch { aliases.add('<invalid-lock>'); return aliases; }
    const visit = (value: unknown, key = ''): void => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const record = value as Record<string, unknown>; const alias = lockPackageAlias(key);
        if (record.name === PACKAGE || ownerPackageReference(record.resolved) || ownerPackageReference(record.version))
            aliases.add(alias ?? PACKAGE);
        for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
            const dependencies = record[section];
            if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
                for (const [name, spec] of Object.entries(dependencies))
                    if (name === PACKAGE || ownerPackageReference(spec)) aliases.add(name);
            }
        }
        for (const [childKey, child] of Object.entries(record)) visit(child, childKey);
    };
    visit(lock); return aliases;
};
const ownerDependencyAliases = (packageJson: Record<string, unknown>, lock: string): Set<string> => {
    const aliases = ownerLockAliases(lock);
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        const dependencies = (packageJson[section] as Record<string, unknown> | undefined) ?? {};
        for (const [name, spec] of Object.entries(dependencies))
            if (name === PACKAGE || ownerPackageReference(spec)) aliases.add(name);
    }
    return aliases;
};

const packageBoundaryErrors = (packageJson: Record<string, unknown>, lock: string, nextConfig: string,
    ownerInNodeModules: boolean): string[] => {
    const errors: string[] = [];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        const dependencies = (packageJson[section] as Record<string, unknown> | undefined) ?? {};
        if (Object.entries(dependencies).some(([name, spec]) => name === PACKAGE || ownerPackageReference(spec)))
            errors.push(`package:${section}`);
    }
    if (lock.includes(PACKAGE) || ownerLockAliases(lock).size > 0) errors.push('package:lock');
    if (ownerInNodeModules) errors.push('package:node_modules');
    if (/serverExternalPackages\s*:[\s\S]*?@mediflow\/web-auth-lifecycle-owner/u.test(nextConfig)) errors.push('package:next-external');
    return errors;
};

type PhysicalFileSnapshot = Readonly<{ path: string; regular: boolean; symbolicLink: boolean;
    links: number; bytes: number; sha256: string }>;
type InstalledPackageSnapshot = Readonly<{ path: string; realpath: string; directory: boolean; symbolicLink: boolean;
    files: readonly PhysicalFileSnapshot[] }>;
type PhysicalPackageSnapshot = Readonly<{
    packageJson: Record<string, unknown>; lock: Record<string, unknown>; tarball: PhysicalFileSnapshot;
    tarRoster: readonly (ExpectedFile & Readonly<{ type: string; mode: string }>)[];
    provenance: PhysicalFileSnapshot & Readonly<{ value: unknown }>; artifacts: readonly PhysicalFileSnapshot[];
    installed: readonly InstalledPackageSnapshot[];
}>;
const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object'
    && !Array.isArray(value) ? value as Record<string, unknown> : null;
const preparedProvenance = () => ({
    schemaVersion: 'mediflow.web-auth-lifecycle-owner.package-provenance.v1',
    acceptedBase: 'a9a81a4fe4c3551be1b9676019579a7bcdd6a611',
    sourceCommit: '7bb687e2ba31c83854646b52bd799d807bb02348',
    package: { name: PACKAGE, version: PREPARED_PACKAGE_VERSION },
    toolchain: { node: 'v24.19.0', npm: '11.17.0' },
    pack: { command: 'npm pack --ignore-scripts --pack-destination ./artifacts', runs: 2,
        network: 'offline', scripts: 'ignored', cache: 'empty_temporary', byteIdentical: true },
    artifact: { path: PREPARED_PACKAGE_TARBALL, bytes: 347, sha256: PREPARED_PACKAGE_SHA256,
        integrity: PREPARED_PACKAGE_INTEGRITY },
    inputs: [
        { path: 'index.js', bytes: 80, sha256: PREPARED_INDEX_SHA256 },
        { path: 'package.json', bytes: 251, sha256: PREPARED_MANIFEST_SHA256 },
    ],
    roster: [
        { path: 'package/index.js', type: 'file', mode: '0644', bytes: 80, sha256: PREPARED_INDEX_SHA256 },
        { path: 'package/package.json', type: 'file', mode: '0644', bytes: 251,
            sha256: PREPARED_MANIFEST_SHA256 },
    ],
} as const);
const PREPARED_0: PreparedContract = {
    version: PREPARED_PACKAGE_VERSION, sequence: 0, manifest: PREPARED_PACKAGE_MANIFEST,
    tarball: PREPARED_PACKAGE_TARBALL, provenancePath: PREPARED_PACKAGE_PROVENANCE,
    dependency: PREPARED_PACKAGE_DEPENDENCY, tar: { path: PREPARED_PACKAGE_TARBALL, bytes: 347,
        sha256: PREPARED_PACKAGE_SHA256, integrity: PREPARED_PACKAGE_INTEGRITY }, provenance: preparedProvenance(),
    inputs: preparedProvenance().inputs, roster: preparedProvenance().roster,
    artifacts: [{ path: PREPARED_PACKAGE_TARBALL, bytes: 347, sha256: PREPARED_PACKAGE_SHA256 },
        { path: PREPARED_PACKAGE_PROVENANCE, bytes: Buffer.byteLength(`${JSON.stringify(preparedProvenance(), null, 2)}\n`),
            sha256: PREPARED_PROVENANCE_SHA256 }],
};
const PREPARED_1_MANIFEST = PREPARED_PACKAGE_MANIFEST.replace('0.8.5-prepared.0', '0.8.5-prepared.1');
const PREPARED_1_INTERNAL = "/* @Codex */\n'use strict';\nmodule.exports = Object.freeze({ state: 'synthetic_prepared_1' });\n";
const PREPARED_1_NESTED = "/* @Codex */\n'use strict';\nmodule.exports = 1;\n";
const PREPARED_1_INPUTS = [
    { path: 'index.js', bytes: 80, sha256: PREPARED_INDEX_SHA256 },
    { path: 'internal/owner.cjs', bytes: 94, sha256: '70a65a0cea7dd3ba4e29799d1f899d3df0a0d9e832499841e2de7d67ab403add' },
    { path: 'internal/support/value.cjs', bytes: 47, sha256: '9f0968a0290c6184c898f06de2c408540d4eda1ecd0e3e80ae013bb37a782be1' },
    { path: 'package.json', bytes: 251, sha256: '80ceecdb6d109dfd860769220883a6a78797e24677c09e9479e5994a5595fd81' },
] as const;
const PREPARED_1_VERSION = '0.8.5-prepared.1';
const PREPARED_1_TARBALL = `${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-${PREPARED_1_VERSION}.tgz`;
const PREPARED_1_PROVENANCE_PATH = PREPARED_1_TARBALL.replace(/\.tgz$/u, '.provenance.json');
const PREPARED_1_TAR_SHA256 = 'd24e919fb1709cdfd4a78cdb618a565e647922d63e28c15ff79b4a6e46bab1f2';
const PREPARED_1_PROVENANCE_SHA256 = 'ec24b7bd7d99b245209c15421de34bcee0db0b34136c7c5e4884ecf008f46424';
const PREPARED_1_INTEGRITY = 'sha512-LuOI8iBDJzt2D3JW4n8r1UIzCwn5dI/5vkcgEbw+l8Br4nKbSpVIeB3rDOX+7SsoeYF5OlCxGVEqmTH2UvmtrA==';
const PREDECESSOR = { version: PREPARED_PACKAGE_VERSION, tarSha256: PREPARED_PACKAGE_SHA256,
    provenanceSha256: PREPARED_PROVENANCE_SHA256 } as const;
const prepared1Provenance = () => ({
    schemaVersion: 'mediflow.web-auth-lifecycle-owner.package-provenance.v1',
    acceptedBase: 'fe514f77f437bd762ba045a726bc0e6229f826a8', predecessor: PREDECESSOR,
    package: { name: PACKAGE, version: PREPARED_1_VERSION }, toolchain: { node: 'v24.19.0', npm: '11.17.0' },
    pack: { command: 'npm pack --ignore-scripts --pack-destination ./artifacts', runs: 2,
        network: 'offline', scripts: 'ignored', cache: 'empty_temporary', byteIdentical: true },
    artifact: { path: PREPARED_1_TARBALL, bytes: 433, sha256: PREPARED_1_TAR_SHA256, integrity: PREPARED_1_INTEGRITY },
    inputs: PREPARED_1_INPUTS,
    roster: ['internal/owner.cjs', 'internal/support/value.cjs', 'index.js', 'package.json'].map((path) => {
        const file = PREPARED_1_INPUTS.find((entry) => entry.path === path)!;
        return { path: `package/${file.path}`, type: 'file' as const, mode: '0644' as const,
            bytes: file.bytes, sha256: file.sha256 };
    }),
});
const PREPARED_1: PreparedContract = {
    version: PREPARED_1_VERSION, sequence: 1, manifest: PREPARED_1_MANIFEST,
    tarball: PREPARED_1_TARBALL, provenancePath: PREPARED_1_PROVENANCE_PATH, dependency: `file:${PREPARED_1_TARBALL}`,
    tar: { path: PREPARED_1_TARBALL, bytes: 433, sha256: PREPARED_1_TAR_SHA256, integrity: PREPARED_1_INTEGRITY },
    provenance: prepared1Provenance(), predecessor: PREDECESSOR, inputs: PREPARED_1_INPUTS,
    roster: prepared1Provenance().roster, artifacts: [...PREPARED_0.artifacts,
        { path: PREPARED_1_TARBALL, bytes: 433, sha256: PREPARED_1_TAR_SHA256 },
        { path: PREPARED_1_PROVENANCE_PATH, bytes: 2554, sha256: PREPARED_1_PROVENANCE_SHA256 }],
};
const PREPARED_2_VERSION = '0.8.5-prepared.2';
const PREPARED_2_MANIFEST = PREPARED_1_MANIFEST.replace(PREPARED_1_VERSION, PREPARED_2_VERSION);
const PREPARED_2_SUCCESSOR_FENCE = `/* @Codex */
'use strict';
const { randomBytes } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { Buffer } = require('node:buffer');
const bufferIsBuffer = Buffer.isBuffer;
const bufferPrototype = Buffer.prototype;
const bufferToString = bufferPrototype.toString;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
function successorFence() {
    try {
        const bytes = randomBytes(32);
        if (isProxy(bytes) || !bufferIsBuffer(bytes) || objectGetPrototypeOf(bytes) !== bufferPrototype) return null;
        const value = reflectApply(bufferToString, bytes, ['hex']);
        if (typeof value !== 'string' || value.length !== 64) return null;
        for (let index = 0; index < value.length; index += 1) {
            const code = reflectApply(stringCharCodeAt, value, [index]);
            if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return null;
        }
        return value;
    } catch {
        return null;
    }
}
module.exports = objectFreeze({ successorFence });
`;
const PREPARED_2_INPUTS = [
    { path: 'index.js', bytes: 80, sha256: PREPARED_INDEX_SHA256 },
    { path: 'internal/owner.cjs', bytes: 94, sha256: '70a65a0cea7dd3ba4e29799d1f899d3df0a0d9e832499841e2de7d67ab403add' },
    { path: 'internal/support/successor-fence.cjs', bytes: 1172,
        sha256: '7e36178331d5f899d81d877603acb0100eef1436d1873287ad4b27ccc227e7ff' },
    { path: 'internal/support/value.cjs', bytes: 47, sha256: '9f0968a0290c6184c898f06de2c408540d4eda1ecd0e3e80ae013bb37a782be1' },
    { path: 'package.json', bytes: 251, sha256: 'cb410b7d61a160b6bb0adf352a464496c5183ae1546cdf0b9ffa58edf3b3c2c0' },
] as const;
const PREPARED_2_TARBALL = `${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-${PREPARED_2_VERSION}.tgz`;
const PREPARED_2_PROVENANCE_PATH = PREPARED_2_TARBALL.replace(/\.tgz$/u, '.provenance.json');
const PREPARED_2_TAR_SHA256 = 'a3539c0a52631172691d8088b2897b8b292dea9e755474ef4962572a5fecf869';
const PREPARED_2_INTEGRITY = 'sha512-ypTB9E26lsqnFyZRHGcjMGjIrfYrjfhiKFpcTyU1spGIapwWWgI/YDHGVw2wmX3BAyykuiA5BuyZG+yeAipDuQ==';
const PREPARED_2_PREDECESSOR = { version: PREPARED_1_VERSION, tarSha256: PREPARED_1_TAR_SHA256,
    provenanceSha256: PREPARED_1_PROVENANCE_SHA256 } as const;
const prepared2Provenance = () => ({
    schemaVersion: 'mediflow.web-auth-lifecycle-owner.package-provenance.v1',
    acceptedBase: '83983a3b8e6b4d9d15be7f5c69dcce84fdc0f5aa', predecessor: PREPARED_2_PREDECESSOR,
    package: { name: PACKAGE, version: PREPARED_2_VERSION }, toolchain: { node: 'v24.19.0', npm: '11.17.0' },
    pack: { command: 'npm pack --ignore-scripts --pack-destination ./artifacts', runs: 2,
        network: 'offline', scripts: 'ignored', cache: 'empty_temporary', byteIdentical: true },
    artifact: { path: PREPARED_2_TARBALL, bytes: 881, sha256: PREPARED_2_TAR_SHA256,
        integrity: PREPARED_2_INTEGRITY }, inputs: PREPARED_2_INPUTS,
    roster: ['internal/owner.cjs', 'internal/support/successor-fence.cjs', 'internal/support/value.cjs',
        'index.js', 'package.json'].map((path) => { const file = PREPARED_2_INPUTS.find((entry) => entry.path === path)!;
        return { path: `package/${file.path}`, type: 'file' as const, mode: '0644' as const,
            bytes: file.bytes, sha256: file.sha256 }; }),
});
const PREPARED_2: PreparedContract = {
    version: PREPARED_2_VERSION, sequence: 2, manifest: PREPARED_2_MANIFEST,
    tarball: PREPARED_2_TARBALL, provenancePath: PREPARED_2_PROVENANCE_PATH, dependency: `file:${PREPARED_2_TARBALL}`,
    tar: { path: PREPARED_2_TARBALL, bytes: 881, sha256: PREPARED_2_TAR_SHA256, integrity: PREPARED_2_INTEGRITY },
    provenance: prepared2Provenance(), predecessor: PREPARED_2_PREDECESSOR, inputs: PREPARED_2_INPUTS,
    roster: prepared2Provenance().roster, artifacts: [...PREPARED_1.artifacts,
        { path: PREPARED_2_TARBALL, bytes: 881, sha256: PREPARED_2_TAR_SHA256 },
        { path: PREPARED_2_PROVENANCE_PATH, bytes: 2948,
            sha256: 'f7899346886df74f818a3e2e05daf6b8a2b8ce225ed98f29af16173221cd8291' }],
};
const LIVE_PREPARED_CONTRACT = PREPARED_2;
const preparedContractErrors = (contract: PreparedContract): string[] => {
    const match = /^0\.8\.5-prepared\.(0|1|2)$/u.exec(contract.version);
    if (!match || Number(match[1]) !== contract.sequence) return ['physical:version-sequence'];
    if (contract.sequence === 0) return contract === PREPARED_0 && contract.predecessor === undefined ? [] : ['physical:version-reuse'];
    if (contract.sequence === 1) return contract === PREPARED_1 && canonical(contract.predecessor) === canonical(PREDECESSOR)
        ? [] : ['physical:predecessor'];
    return contract === PREPARED_2 && canonical(contract.predecessor) === canonical(PREPARED_2_PREDECESSOR)
        ? [] : ['physical:predecessor'];
};
const ownerReferenceCount = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce((total, item) => total + ownerReferenceCount(item), 0);
    const record = asRecord(value); if (!record) return ownerPackageReference(value) ? 1 : 0;
    return Object.entries(record).reduce((total, [key, item]) => total
        + (key === PACKAGE || key.endsWith(`node_modules/${PACKAGE}`) ? 1 : 0) + ownerReferenceCount(item), 0);
};
const physicalFileErrors = (value: PhysicalFileSnapshot, expected: Readonly<{ path: string; bytes: number;
    sha256: string }>): string[] => value.path === expected.path && value.regular && !value.symbolicLink
    && value.links === 1 && value.bytes === expected.bytes && value.sha256 === expected.sha256 ? [] : [expected.path];
const physicalPackageErrors = (value: PhysicalPackageSnapshot, contract: PreparedContract = LIVE_PREPARED_CONTRACT): string[] => {
    const errors = preparedContractErrors(contract); const dependencies = asRecord(value.packageJson.dependencies) ?? {};
    if (dependencies[PACKAGE] !== contract.dependency || ownerReferenceCount(value.packageJson) !== 2)
        errors.push('physical:dependency');
    const packages = asRecord(value.lock.packages); const root = asRecord(packages?.['']);
    const rootDependencies = asRecord(root?.dependencies); const installed = asRecord(packages?.[`node_modules/${PACKAGE}`]);
    const expectedInstalled = { version: contract.version, resolved: contract.dependency,
        integrity: contract.tar.integrity, engines: { node: '>=24 <25' } };
    if (value.lock.lockfileVersion !== 3 || rootDependencies?.[PACKAGE] !== contract.dependency
        || canonical(installed) !== canonical(expectedInstalled) || ownerReferenceCount(value.lock) !== 4
        || canonical([...ownerLockAliases(JSON.stringify(value.lock))]) !== canonical([PACKAGE])) errors.push('physical:lock');
    errors.push(...physicalFileErrors(value.tarball, contract.tar));
    const provenanceFile = contract.artifacts.find((file) => file.path === contract.provenancePath)!;
    errors.push(...physicalFileErrors(value.provenance, provenanceFile));
    if (canonical(value.provenance.value) !== canonical(contract.provenance)) errors.push('physical:provenance');
    if (canonical(value.tarRoster) !== canonical(contract.roster)) errors.push('physical:tar-roster');
    if (canonical(value.artifacts.map((file) => file.path).sort()) !== canonical(contract.artifacts.map((file) => file.path).sort()))
        errors.push('physical:artifact-roster');
    else for (const expected of contract.artifacts) errors.push(...physicalFileErrors(
        value.artifacts.find((file) => file.path === expected.path)!, expected));
    if (value.installed.length !== 1) errors.push('physical:copy-count');
    const copy = value.installed[0]; const marker = `${path.sep}node_modules${path.sep}`;
    if (!copy || !copy.directory || copy.symbolicLink || copy.realpath !== copy.path
        || copy.path.split(marker).length !== 2 || !copy.path.endsWith(`${marker}${PACKAGE}`)) errors.push('physical:copy');
    const expectedFiles = contract.inputs;
    if (!copy || canonical(copy.files.map((file) => file.path).sort()) !== canonical(expectedFiles.map((file) => file.path)))
        errors.push('physical:installed-roster');
    else for (const expected of expectedFiles) errors.push(...physicalFileErrors(
        copy.files.find((file) => file.path === expected.path)!, expected));
    return errors;
};
const fileSnapshot = (root: string, relative: string): PhysicalFileSnapshot => {
    const absolute = path.join(root, relative);
    try { const metadata = lstatSync(absolute); const bytes = metadata.isFile() ? readFileSync(absolute) : Buffer.alloc(0);
        return { path: relative, regular: metadata.isFile(), symbolicLink: metadata.isSymbolicLink(),
            links: metadata.nlink, bytes: metadata.size, sha256: digest(bytes) }; }
    catch { return { path: relative, regular: false, symbolicLink: false, links: 0, bytes: 0, sha256: '' }; }
};
const tarRoster = (root: string, relative: string): PhysicalPackageSnapshot['tarRoster'] => {
    try { const archive = gunzipSync(readFileSync(path.join(root, relative))); const roster: Array<ExpectedFile & { type: string; mode: string }> = [];
        for (let offset = 0; offset + 512 <= archive.length;) { const header = archive.subarray(offset, offset + 512);
            if (header.every((byte) => byte === 0)) break;
            const field = (start: number, end: number) => header.subarray(start, end).toString('utf8').replace(/\0.*$/u, '').trim();
            const name = field(0, 100); const size = Number.parseInt(field(124, 136) || '0', 8);
            const mode = Number.parseInt(field(100, 108) || '0', 8).toString(8).padStart(4, '0');
            const type = field(156, 157) || '0'; const contents = archive.subarray(offset + 512, offset + 512 + size);
            if (type !== '0' || !name || !Number.isSafeInteger(size) || contents.length !== size) return [{ path: '<invalid-tar>', type, mode, bytes: 0, sha256: '' }];
            roster.push({ path: name, type: 'file', mode, bytes: size, sha256: digest(contents) });
            offset += 512 + Math.ceil(size / 512) * 512;
        } return roster;
    } catch { return [{ path: '<invalid-tar>', type: 'invalid', mode: '', bytes: 0, sha256: '' }]; }
};
const installedSnapshot = (logicalPath: string): InstalledPackageSnapshot => {
    try { const metadata = lstatSync(logicalPath); const walk = (directory: string): PhysicalFileSnapshot[] =>
        readdirSync(path.join(logicalPath, directory), { withFileTypes: true }).flatMap((entry) => {
            const relative = path.join(directory, entry.name); const details = lstatSync(path.join(logicalPath, relative));
            return details.isDirectory() && !details.isSymbolicLink() ? walk(relative) : [fileSnapshot(logicalPath, relative)];
        }); const files = walk('');
        return { path: logicalPath, realpath: realpathSync.native(logicalPath), directory: metadata.isDirectory(),
            symbolicLink: metadata.isSymbolicLink(), files }; }
    catch { return { path: logicalPath, realpath: '', directory: false, symbolicLink: false, files: [] }; }
};
const physicalPackageSnapshot = (root: string, packageJson: Record<string, unknown>, lockSource: string,
    copies: readonly string[], contract: PreparedContract = LIVE_PREPARED_CONTRACT): PhysicalPackageSnapshot | undefined => {
    const artifactsDirectory = path.join(root, PACKAGE_ROOT, 'artifacts');
    const aliases = ownerDependencyAliases(packageJson, lockSource);
    if (!existsSync(artifactsDirectory) && aliases.size === 0 && copies.length === 0) return undefined;
    let lock: Record<string, unknown> = {}; try { lock = JSON.parse(lockSource) as Record<string, unknown>; } catch { /* invalid */ }
    const provenanceFile = fileSnapshot(root, contract.provenancePath); let provenanceValue: unknown = null;
    try { provenanceValue = JSON.parse(readFileSync(path.join(root, contract.provenancePath), 'utf8')); } catch { /* invalid */ }
    let artifacts: PhysicalFileSnapshot[] = [];
    try { artifacts = readdirSync(artifactsDirectory).map((name) => fileSnapshot(root, `${PACKAGE_ROOT}/artifacts/${name}`)); }
    catch { artifacts = [{ path: '<unscannable-artifacts>', regular: false, symbolicLink: false, links: 0, bytes: 0, sha256: '' }]; }
    return { packageJson, lock, tarball: fileSnapshot(root, contract.tarball), tarRoster: tarRoster(root, contract.tarball),
        provenance: { ...provenanceFile, value: provenanceValue }, artifacts, installed: copies.map(installedSnapshot) };
};
const preCutoverSourceState = (sources: Sources, packageArtifacts: Sources = {}, physical?: PhysicalPackageSnapshot,
    contract: PreparedContract = LIVE_PREPARED_CONTRACT):
    'BASELINE' | 'DORMANT_PREPARED' | 'PACKAGE_SOURCE_PREPARED' | 'PHYSICAL_PACKAGE_PREPARED' | 'INVALID' => {
    const adapter = sources[ADAPTER_FILE];
    if (importInventoryErrors(sources, adapter !== undefined).length > 0) return 'INVALID';
    if (adapter === undefined) return Object.keys(packageArtifacts).length === 0 ? 'BASELINE' : 'INVALID';
    if (dormantAdapterErrors(adapter).length > 0) return 'INVALID';
    if (Object.keys(packageArtifacts).length === 0) return 'DORMANT_PREPARED';
    if (sources[PACKAGE_ENTRY_FILE] !== packageArtifacts[PACKAGE_ENTRY_FILE]
        || packageSourceErrors(packageArtifacts, contract).length > 0) return 'INVALID';
    if (physical === undefined) return 'PACKAGE_SOURCE_PREPARED';
    return physicalPackageErrors(physical, contract).length === 0 ? 'PHYSICAL_PACKAGE_PREPARED' : 'INVALID';
};

const liveSources = sourceFiles(ROOT);
const livePackage = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
const liveLock = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
const liveNext = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
const livePackageSource = packageSourceArtifacts(ROOT);
const liveOwnerPackageCopies = ownerPackageCopies(ROOT);
const livePhysicalPackage = physicalPackageSnapshot(ROOT, livePackage, liveLock, liveOwnerPackageCopies);

test('accepts only the three exact closed pre-cutover repository states', () => {
    if (livePhysicalPackage === undefined)
        assert.deepEqual(packageBoundaryErrors(livePackage, liveLock, liveNext, liveOwnerPackageCopies.length > 0), []);
    else assert.deepEqual(physicalPackageErrors(livePhysicalPackage), []);
    assert.equal(preCutoverSourceState(liveSources, livePackageSource, livePhysicalPackage),
        liveSources[ADAPTER_FILE] === undefined ? 'BASELINE' : Object.keys(livePackageSource).length === 0
            ? 'DORMANT_PREPARED' : livePhysicalPackage ? 'PHYSICAL_PACKAGE_PREPARED' : 'PACKAGE_SOURCE_PREPARED');
    assert.equal(authorityRosterDigest(liveSources), AUTHORITY_ROSTER_SHA256);
    assert.deepEqual(statefulAuthorityModules(liveSources), STATEFUL_AUTHORITY_MODULES);
    assert.equal(digest(liveSources[PRE_CUTOVER_GLOBAL_OWNER]!), PRE_CUTOVER_GLOBAL_OWNER_SHA256,
        'the historical globalThis projection owner is permitted only while state=pre_cutover');
});

test('accepts all closed states and denies an early or consumed adapter', () => {
    const dormant = DORMANT_ADAPTER_SOURCE;
    assert.equal(preCutoverSourceState({}), 'BASELINE');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant }), 'DORMANT_PREPARED');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant, [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }, {
        [PACKAGE_MANIFEST_FILE]: PREPARED_PACKAGE_MANIFEST,
        [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY,
    }, undefined, PREPARED_0), 'PACKAGE_SOURCE_PREPARED');
    for (const source of ["export const owner = new Map();", "import 'server-only';export const owner=globalThis.owner;",
        "import 'server-only';import {serverSessionProjectionOwnerRegistry} from './server-session-projection-owner-production';",
        "import 'server-only';export function selectOwner(){return process.cache;}",
        "import 'server-only';export const arbitrary = 'closed' as const;export type Arbitrary=typeof arbitrary;"]) {
        assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: source }), 'INVALID', source);
    }
    const adapterTest = "import { lifecycleOwnerAdapterState } from './web-auth-lifecycle-owner-adapter.ts';";
    assert.equal(preCutoverSourceState({ [ADAPTER_TEST_FILE]: adapterTest }), 'INVALID');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant,
        [ADAPTER_TEST_FILE]: adapterTest }), 'DORMANT_PREPARED');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant, [ADAPTER_TEST_FILE]: adapterTest,
        'lib/security/production.ts': "import './web-auth-lifecycle-owner-adapter.test';" }), 'INVALID');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant, 'lib/security/production.ts':
        "import { lifecycleOwnerAdapterState } from './web-auth-lifecycle-owner-adapter';" }), 'INVALID');
});

test('recognizes only the exact physical package source scaffold', () => {
    assert.equal(PACKAGE_ENTRY_FILE, 'packages/web-auth-lifecycle-owner/index.js');
    assert.deepEqual(JSON.parse(PREPARED_PACKAGE_MANIFEST), { name: PACKAGE, version: '0.8.5-prepared.0', private: true,
        type: 'commonjs', main: './index.js', exports: './index.js', files: ['index.js', 'internal/'],
        engines: { node: '>=24 <25' } });
    assert.equal(printed(PACKAGE_ENTRY_FILE, PREPARED_PACKAGE_ENTRY),
        printed(PACKAGE_ENTRY_FILE, "'use strict';\nmodule.exports = Object.freeze(Object.create(null));"));
    const prepared: Sources = { [PACKAGE_MANIFEST_FILE]: PREPARED_PACKAGE_MANIFEST,
        [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY };
    const syntheticRoot = '/synthetic';
    const ops = {
        exists: () => true, realpath: (value: string) => value,
        readdir: () => ['package.json', 'index.js'].map((name) => ({
            name, isFile: () => true, isSymbolicLink: () => false,
        })),
        read: (value: string) => prepared[path.relative(syntheticRoot, value)]!,
    };
    assert.deepEqual(packageSourceArtifacts(syntheticRoot, ops), prepared);
    assert.deepEqual(packageSourceErrors(prepared, PREPARED_0), []);
    assert.deepEqual(importInventoryErrors({ [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }), []);
    assert.equal(authorityRosterDigest({ ...liveSources, [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }), AUTHORITY_ROSTER_SHA256);
    assert.deepEqual(statefulAuthorityModules({ ...liveSources, [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }), STATEFUL_AUTHORITY_MODULES);
    const dormant = DORMANT_ADAPTER_SOURCE;
    for (const invalid of [
        { [PACKAGE_MANIFEST_FILE]: PREPARED_PACKAGE_MANIFEST },
        { ...prepared, 'packages/web-auth-lifecycle-owner/extra.cjs': '' },
        { ...prepared, [PACKAGE_ENTRY_FILE]: "module.exports = {};" },
        { ...prepared, [PACKAGE_MANIFEST_FILE]: JSON.stringify({ ...JSON.parse(PREPARED_PACKAGE_MANIFEST), main: './index.cjs' }) },
        { ...prepared, [PACKAGE_MANIFEST_FILE]: PREPARED_PACKAGE_MANIFEST.replace(
            '"exports": "./index.js"', '"exports": "./index.js",\n  "exports": "./index.js"') },
    ] as Sources[]) assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant,
        [PACKAGE_ENTRY_FILE]: invalid[PACKAGE_ENTRY_FILE] ?? '' }, invalid, undefined, PREPARED_0), 'INVALID');
    assert.equal(preCutoverSourceState({ [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }, prepared,
        undefined, PREPARED_0), 'INVALID');
    assert.notDeepEqual(packageSourceArtifacts(syntheticRoot, { ...ops,
        realpath: (value) => value.endsWith(PACKAGE_ROOT) ? '/synthetic-linked-package' : value }), prepared);
    assert.notDeepEqual(packageSourceArtifacts(syntheticRoot, { ...ops, readdir: () => [{
        name: 'package.json', isFile: () => false, isSymbolicLink: () => true,
    }] }), prepared);
});

test('recognizes only the exact synthetic physical prepared package state', () => {
    const dependency = 'file:packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.tgz';
    const tarballSha256 = '4f03a28891ff1dbe4539e2a297334d7bbeee23dfc42c7cf4793fb38c3fde5d5a';
    const integrity = 'sha512-m0ZCMZQ8Mgothnd/Dig5o6pgpkd8YJRB24cTMcXrTJUKr4qO0GEYwcgbgprRkM0aRiLTAOCcXDMHHih3KIvM6A==';
    const indexSha256 = '7bc72383ad0639480702aadb8bad2cacf135c2c1b1cb7013a68ed5eef6d26a4f';
    const manifestSha256 = 'ee606c50ba3a13d072143aa3149afe39f1a8ceee9ce4982f9a99ceacb53b0db7';
    const installedRoot = `/synthetic/node_modules/${PACKAGE}`;
    const provenanceValue = {
        schemaVersion: 'mediflow.web-auth-lifecycle-owner.package-provenance.v1',
        acceptedBase: 'a9a81a4fe4c3551be1b9676019579a7bcdd6a611',
        sourceCommit: '7bb687e2ba31c83854646b52bd799d807bb02348',
        package: { name: PACKAGE, version: '0.8.5-prepared.0' },
        toolchain: { node: 'v24.19.0', npm: '11.17.0' },
        pack: { command: 'npm pack --ignore-scripts --pack-destination ./artifacts', runs: 2,
            network: 'offline', scripts: 'ignored', cache: 'empty_temporary', byteIdentical: true },
        artifact: { path: PREPARED_PACKAGE_TARBALL, bytes: 347, sha256: tarballSha256, integrity },
        inputs: [
            { path: 'index.js', bytes: 80, sha256: indexSha256 },
            { path: 'package.json', bytes: 251, sha256: manifestSha256 },
        ],
        roster: [
            { path: 'package/index.js', type: 'file', mode: '0644', bytes: 80, sha256: indexSha256 },
            { path: 'package/package.json', type: 'file', mode: '0644', bytes: 251, sha256: manifestSha256 },
        ],
    };
    const provenanceSource = `${JSON.stringify(provenanceValue, null, 2)}\n`;
    const physical = {
        packageJson: { dependencies: { [PACKAGE]: dependency } },
        lock: { lockfileVersion: 3, packages: {
            '': { dependencies: { [PACKAGE]: dependency } },
            [`node_modules/${PACKAGE}`]: { version: '0.8.5-prepared.0', resolved: dependency, integrity,
                engines: { node: '>=24 <25' } },
        } },
        tarball: { path: PREPARED_PACKAGE_TARBALL, regular: true, symbolicLink: false, links: 1,
            bytes: 347, sha256: tarballSha256 },
        tarRoster: provenanceValue.roster,
        provenance: { path: `${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.provenance.json`,
            regular: true, symbolicLink: false, links: 1, bytes: Buffer.byteLength(provenanceSource),
            sha256: digest(provenanceSource), value: provenanceValue },
        artifacts: [
            { path: PREPARED_PACKAGE_TARBALL, regular: true, symbolicLink: false, links: 1,
                bytes: 347, sha256: tarballSha256 },
            { path: PREPARED_PACKAGE_PROVENANCE, regular: true, symbolicLink: false, links: 1,
                bytes: Buffer.byteLength(provenanceSource), sha256: digest(provenanceSource) },
        ],
        installed: [{ path: installedRoot, realpath: installedRoot, directory: true, symbolicLink: false,
            files: [
                { path: 'index.js', regular: true, symbolicLink: false, links: 1, bytes: 80, sha256: indexSha256 },
                { path: 'package.json', regular: true, symbolicLink: false, links: 1, bytes: 251,
                    sha256: manifestSha256 },
            ] }],
    };
    const prepared: Sources = { [PACKAGE_MANIFEST_FILE]: PREPARED_PACKAGE_MANIFEST,
        [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY };
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE,
        [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }, prepared, physical, PREPARED_0), 'PHYSICAL_PACKAGE_PREPARED');
    for (const invalid of [
        { ...physical, tarball: { ...physical.tarball, sha256: '0'.repeat(64) } },
        { ...physical, packageJson: { dependencies: {} } },
        { ...physical, lock: { ...physical.lock, lockfileVersion: 2 } },
        { ...physical, provenance: { ...physical.provenance,
            value: { ...physical.provenance.value, sourceCommit: '0'.repeat(40) } } },
        { ...physical, installed: [...physical.installed, physical.installed[0]!] },
        { ...physical, installed: [{ ...physical.installed[0]!, symbolicLink: true }] },
        { ...physical, installed: [{ ...physical.installed[0]!,
            files: [{ ...physical.installed[0]!.files[0]!, links: 2 }, physical.installed[0]!.files[1]!] }] },
        { ...physical, installed: [{ ...physical.installed[0]!, path: `/synthetic/node_modules/parent/node_modules/${PACKAGE}`,
            realpath: `/synthetic/node_modules/parent/node_modules/${PACKAGE}` }] },
    ]) assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE,
        [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY }, prepared, invalid, PREPARED_0), 'INVALID');
});

test('denies hostile package and adapter loads without changing the shared inventory support', () => {
    const adapterAbsolute = path.join(ROOT, ADAPTER); const packageSourceSpecifier = `../../${PACKAGE_ENTRY_FILE}`;
    const hostile = [
        `import '${PACKAGE}';`, `import '${PACKAGE}/deep';`, `import '../../packages/web-auth-lifecycle-owner/index.js';`,
        `export * from '../../packages/web-auth-lifecycle-owner/index.js';`, `import './web-auth-lifecycle-owner-adapter';`,
        `const p='../../packages/web-auth-'+'lifecycle-owner/index.js';import(p);`,
        `const p='../../packages/web-auth-'+'lifecycle-owner/index.js';readFileSync(p);`,
        `export * from './web-auth-lifecycle-owner-adapter';`, `const p='./web-auth-'+'lifecycle-owner-adapter';import(p);`,
        `Reflect.apply(require,null,['./web-auth-lifecycle-owner-adapter']);`,
        "const p='@mediflow/web-auth-'+'lifecycle-owner/deep';import(p);",
        "const scope='@mediflow';const name='web-auth-lifecycle-owner';const p=`${scope}/${name}/deep`;import(p);",
        "const p=pick()?'./web-auth-lifecycle-owner-adapter':'./other';import(p);", 'import {',
        ...moduleImportBypassFixtures('./web-auth-lifecycle-owner-adapter', adapterAbsolute),
        ...createRequireBypassFixtures('./web-auth-lifecycle-owner-adapter'),
        ...createRequireUnresolvedFixtures('./web-auth-lifecycle-owner-adapter'),
        ...unsafeLoaderIdentityFixtures('./web-auth-lifecycle-owner-adapter'),
        ...moduleImportBypassFixtures(packageSourceSpecifier, path.join(ROOT, PACKAGE_ENTRY_FILE)),
        ...createRequireBypassFixtures(packageSourceSpecifier), ...createRequireUnresolvedFixtures(packageSourceSpecifier),
        ...unsafeLoaderIdentityFixtures(packageSourceSpecifier),
    ];
    for (const [index, source] of hostile.entries()) assert.notDeepEqual(
        importInventoryErrors({ [`lib/security/hostile-${index}.ts`]: source }), [], source);
    for (const source of ["import owner from 'owner-alias';", "require('owner-alias');", "import('owner-alias');",
        "import 'owner-alias/deep';", "const p='owner-'+'alias/deep';import(p);", "import('owner%2Dalias/deep');"])
        assert.notDeepEqual(importInventoryErrors({ 'lib/security/alias-consumer.ts': source }, false,
            ownerDependencyAliases({ dependencies: { 'owner-alias': `file:${PACKAGE_ROOT}` } }, '')), [], source);
});

test('allows only the exact owner CommonJS lint selector as non-runtime tooling metadata', () => {
    const lintConfig = liveSources[ESLINT_CONFIG_FILE]!;
    assert.equal(digest(lintConfig), OWNER_COMMONJS_LINT_CONFIG_SHA256);
    assert.deepEqual(importInventoryErrors({ [ESLINT_CONFIG_FILE]: lintConfig }), []);
    const rejected: ReadonlyArray<readonly [string, string]> = [
        ['eslint.other.config.mjs', lintConfig],
        [ESLINT_CONFIG_FILE, `${lintConfig}\n// synthetic config drift\n`],
        [ESLINT_CONFIG_FILE, `${lintConfig}\nreadFileSync(packageCommonJsConfig.files[0]);\n`],
        [ESLINT_CONFIG_FILE, `${lintConfig}\nconst duplicateOwnerLintGlob = '${OWNER_COMMONJS_LINT_GLOB}';\n`],
        [ESLINT_CONFIG_FILE, `export default [{ files: ['${PACKAGE_ROOT}/internal/owner.cjs'] }];`],
        [ESLINT_CONFIG_FILE, `import '${OWNER_COMMONJS_LINT_GLOB}';`],
        [ESLINT_CONFIG_FILE, `export * from '${OWNER_COMMONJS_LINT_GLOB}';`],
        [ESLINT_CONFIG_FILE, `require('${OWNER_COMMONJS_LINT_GLOB}');`],
        [ESLINT_CONFIG_FILE, `import('${OWNER_COMMONJS_LINT_GLOB}');`],
        [ESLINT_CONFIG_FILE, `readFileSync('${OWNER_COMMONJS_LINT_GLOB}');`],
    ];
    for (const [file, source] of rejected)
        assert.notDeepEqual(importInventoryErrors({ [file]: source }), [], `${file}: ${source}`);
});

test('denies package metadata, early externalization, new authority modules or edges, and ambient-owner drift', () => {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.notDeepEqual(packageBoundaryErrors({ [section]: { [PACKAGE]: '0.0.0-synthetic' } }, '', '', false), []);
        assert.notDeepEqual(packageBoundaryErrors({ [section]: { 'owner-alias': `file:${PACKAGE_ROOT}` } }, '', '', false), []);
    }
    assert.deepEqual(ownerDependencyAliases({ dependencies: { 'owner-alias': `file:${PACKAGE_ROOT}` } }, ''), new Set(['owner-alias']));
    for (const spec of [`npm:${PACKAGE}@0.8.5-prepared.0`, `file:./packages/../${PACKAGE_ROOT}`, `file:${PACKAGE_ROOT}/internal/owner.cjs`, 'file:packages%2Fweb-auth-lifecycle-owner',
        'file:packages%252Fweb-auth-lifecycle-owner', `file:${PREPARED_PACKAGE_TARBALL}`]) assert.ok(ownerPackageReference(spec), spec);
    for (const spec of ['@mediflow/web-auth-lifecycle-owner-helper',
        'npm:@mediflow/web-auth-lifecycle-owner-helper@0.8.5-prepared.0',
        'file:packages/web-auth-lifecycle-owner-helper', `file:${PACKAGE_ROOT}/artifacts/mediflow-web-auth-lifecycle-owner-helper-0.8.5-prepared.0.tgz`,
        ['https:', '', 'registry.invalid', '@mediflow/web-auth-lifecycle-owner-helper', '-', 'owner.tgz'].join('/')])
        assert.equal(ownerPackageReference(spec), false, spec);
    assert.deepEqual(importInventoryErrors({ 'lib/security/helper-consumer.ts': "import '@mediflow/web-auth-lifecycle-owner-helper';" }), []);
    assert.notDeepEqual(packageBoundaryErrors({}, `{"node_modules/${PACKAGE}":{}}`, '', false), []);
    assert.notDeepEqual(packageBoundaryErrors({}, JSON.stringify({ packages: {
        'node_modules/owner-alias': { resolved: `file:${PACKAGE_ROOT}` },
    } }), '', false), []);
    assert.deepEqual(ownerLockAliases(JSON.stringify({ packages: { 'node_modules/owner-alias': {
        resolved: ['https:', '', 'registry.invalid', PACKAGE, '-', `${path.basename(PACKAGE_ROOT)}.tgz`].join('/'),
    } } })), new Set(['owner-alias']));
    assert.notDeepEqual(packageBoundaryErrors({}, '', `serverExternalPackages:['${PACKAGE}']`, false), []);
    assert.notDeepEqual(packageBoundaryErrors({}, '', '', true), []);
    const nestedRoot = mkdtempSync(path.join(tmpdir(), 'mediflow-owner-boundary-'));
    try {
        const aliasRoot = path.join(nestedRoot, 'node_modules', 'owner-alias');
        mkdirSync(aliasRoot, { recursive: true });
        writeFileSync(path.join(aliasRoot, 'package.json'), JSON.stringify({ name: PACKAGE }));
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
        rmSync(aliasRoot, { recursive: true });
        const sourceRoot = path.join(nestedRoot, PACKAGE_ROOT);
        mkdirSync(sourceRoot, { recursive: true });
        writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ name: 'synthetic-source' }));
        symlinkSync(sourceRoot, aliasRoot, 'dir');
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
        rmSync(aliasRoot);
        mkdirSync(path.join(nestedRoot, 'node_modules', 'synthetic-parent', 'node_modules', PACKAGE), { recursive: true });
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
        rmSync(path.join(nestedRoot, 'node_modules', 'synthetic-parent'), { recursive: true });
        mkdirSync(path.join(nestedRoot, 'node_modules', '.pnpm', 'synthetic@0.0.0', 'node_modules', PACKAGE), { recursive: true });
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
    } finally { rmSync(nestedRoot, { recursive: true, force: true }); }
    const baseOps: ScanOps = { exists: (value) => value.endsWith('node_modules'), realpath: (value) => value,
        read: () => '{}', readdir: () => [] };
    for (const ops of [{ ...baseOps, realpath: () => { throw new Error('synthetic'); } },
        { ...baseOps, readdir: () => { throw new Error('synthetic'); } }]) {
        assert.ok(ownerPackageCopies('/synthetic', ops).includes('<unscannable>'));
    }
    for (const extension of ['js', 'mjs', 'cjs']) {
        const ownerSource = extension === 'cjs' ? 'module.exports.owner=new Map();' : 'export const owner=new Map();';
        const edgeSource = extension === 'cjs' ? "require('./server-session');" : "import { createSession } from './server-session';";
        const newAuthority = { ...liveSources, [`lib/security/synthetic-lifecycle-authority.${extension}`]: ownerSource };
        assert.notDeepEqual(statefulAuthorityModules(newAuthority), STATEFUL_AUTHORITY_MODULES);
        const newEdge = { ...liveSources, [`lib/security/synthetic-edge.${extension}`]: edgeSource };
        assert.notEqual(authorityRosterDigest(newEdge), AUTHORITY_ROSTER_SHA256);
    }
    assert.notEqual(digest(`${liveSources[PRE_CUTOVER_GLOBAL_OWNER]}\nglobalThis.syntheticOwner={};`), PRE_CUTOVER_GLOBAL_OWNER_SHA256);
});

test('enforces the monotonic prepared.1 package and recursive inert internal roster', () => {
    const source: Sources = { [PACKAGE_MANIFEST_FILE]: PREPARED_1_MANIFEST, [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY,
        [`${PACKAGE_ROOT}/internal/owner.cjs`]: PREPARED_1_INTERNAL,
        [`${PACKAGE_ROOT}/internal/support/value.cjs`]: PREPARED_1_NESTED };
    const provenanceSource = `${JSON.stringify(prepared1Provenance(), null, 2)}\n`;
    assert.equal(Buffer.byteLength(provenanceSource), 2554);
    assert.equal(digest(provenanceSource), 'ec24b7bd7d99b245209c15421de34bcee0db0b34136c7c5e4884ecf008f46424');
    const temporary = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mediflow-owner-prepared1-')));
    try {
        for (const [file, contents] of Object.entries(source)) { const absolute = path.join(temporary, file);
            mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, contents); }
        assert.deepEqual(packageSourceArtifacts(temporary), source);
        const installedRoot = path.join(temporary, 'node_modules', PACKAGE);
        for (const input of PREPARED_1.inputs) { const absolute = path.join(installedRoot, input.path);
            mkdirSync(path.dirname(absolute), { recursive: true });
            writeFileSync(absolute, source[`${PACKAGE_ROOT}/${input.path}`]!); }
        const file = (expected: ExpectedFile): PhysicalFileSnapshot => ({ ...expected, regular: true,
            symbolicLink: false, links: 1 });
        const physical: PhysicalPackageSnapshot = {
            packageJson: { dependencies: { [PACKAGE]: PREPARED_1.dependency } },
            lock: { lockfileVersion: 3, packages: { '': { dependencies: { [PACKAGE]: PREPARED_1.dependency } },
                [`node_modules/${PACKAGE}`]: { version: PREPARED_1_VERSION, resolved: PREPARED_1.dependency,
                    integrity: PREPARED_1_INTEGRITY, engines: { node: '>=24 <25' } } } },
            tarball: file(PREPARED_1.tar), tarRoster: PREPARED_1.roster,
            provenance: { ...file(PREPARED_1.artifacts.at(-1)!), value: prepared1Provenance() },
            artifacts: PREPARED_1.artifacts.map(file), installed: [installedSnapshot(installedRoot)],
        };
        const modules = Object.fromEntries(Object.entries(source).filter(([name]) => name !== PACKAGE_MANIFEST_FILE));
        assert.deepEqual({ source: packageSourceErrors(source, PREPARED_1),
            imports: importInventoryErrors({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE, ...modules }, true),
            physical: physicalPackageErrors(physical, PREPARED_1) }, { source: [], imports: [], physical: [] });
        assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE, ...modules }, source, physical,
            PREPARED_1), 'PHYSICAL_PACKAGE_PREPARED');
        for (let run = 0; run < 2; run += 1) { const result = spawnSync(process.execPath,
            ['-e', "process.stdout.write(require(process.argv[1]).state)", path.join(installedRoot, 'internal/owner.cjs')],
            { cwd: temporary, env: { NODE_ENV: 'test' }, encoding: 'utf8' });
            assert.deepEqual({ status: result.status, stdout: result.stdout }, { status: 0, stdout: 'synthetic_prepared_1' }); }
        const invalidPhysical = [
            { ...physical, packageJson: { dependencies: { [PACKAGE]: PREPARED_PACKAGE_DEPENDENCY } } },
            { ...physical, tarball: { ...physical.tarball, sha256: '0'.repeat(64) } },
            { ...physical, lock: { ...physical.lock, packages: { ...(physical.lock.packages as object),
                [`node_modules/${PACKAGE}`]: { version: PREPARED_PACKAGE_VERSION } } } },
            { ...physical, tarRoster: physical.tarRoster.slice(1) },
            { ...physical, artifacts: physical.artifacts.slice(2) },
            { ...physical, provenance: { ...physical.provenance, value: { ...prepared1Provenance(),
                acceptedBase: '0'.repeat(40) } } },
            { ...physical, provenance: { ...physical.provenance, value: { ...prepared1Provenance(),
                sourceCommit: '0'.repeat(40) } } },
            { ...physical, provenance: { ...physical.provenance, value: { ...prepared1Provenance(),
                predecessor: { ...PREDECESSOR, version: '0.8.5-prepared.2' } } } },
            { ...physical, installed: [{ ...physical.installed[0]!, files: physical.installed[0]!.files.map((entry) =>
                entry.path.includes('support') ? { ...entry, links: 2 } : entry) }] },
        ];
        for (const invalid of invalidPhysical) assert.notDeepEqual(physicalPackageErrors(invalid, PREPARED_1), []);
        assert.notDeepEqual(packageSourceErrors({ ...source, [`${PACKAGE_ROOT}/internal/extra.cjs`]: '' }, PREPARED_1), []);
        for (const invalid of [{ ...PREPARED_1, version: '0.8.5-prepared.2', sequence: 2 },
            { ...PREPARED_0, tar: { ...PREPARED_0.tar, sha256: '0'.repeat(64) } }])
            assert.notDeepEqual(preparedContractErrors(invalid), []);
        for (const consumer of ['lib/security/production.ts', 'lib/security/production.test.ts', THIS_FILE])
            assert.notDeepEqual(importInventoryErrors({ [consumer]:
                "import '../../packages/web-auth-lifecycle-owner/internal/owner.cjs';" }), [], consumer);
        const nestedFile = path.join(temporary, PACKAGE_ROOT, 'internal/support/value.cjs'); rmSync(nestedFile);
        symlinkSync(path.join(temporary, PACKAGE_ENTRY_FILE), nestedFile);
        assert.notDeepEqual(packageSourceArtifacts(temporary), source);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('materializes the prepared.2 successor fence as the sole live physical package', () => {
    assert.equal(LIVE_PREPARED_CONTRACT, PREPARED_2);
    assert.deepEqual(preparedContractErrors(PREPARED_2), []);
    assert.equal(Buffer.byteLength(PREPARED_2_SUCCESSOR_FENCE), 1172);
    assert.equal(digest(PREPARED_2_SUCCESSOR_FENCE), '7e36178331d5f899d81d877603acb0100eef1436d1873287ad4b27ccc227e7ff');
    assert.equal(PREPARED_2_SUCCESSOR_FENCE.match(/randomBytes\(32\)/gu)?.length, 1);
    assert.doesNotMatch(PREPARED_2_SUCCESSOR_FENCE, /\b(?:Map|Set|WeakMap|globalThis|process|session|authority|cell)\b/iu);
    const source: Sources = { [PACKAGE_MANIFEST_FILE]: PREPARED_2_MANIFEST, [PACKAGE_ENTRY_FILE]: PREPARED_PACKAGE_ENTRY,
        [`${PACKAGE_ROOT}/internal/owner.cjs`]: PREPARED_1_INTERNAL,
        [`${PACKAGE_ROOT}/internal/support/successor-fence.cjs`]: PREPARED_2_SUCCESSOR_FENCE,
        [`${PACKAGE_ROOT}/internal/support/value.cjs`]: PREPARED_1_NESTED };
    const temporary = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mediflow-owner-prepared2-')));
    try {
        for (const [file, contents] of Object.entries(source)) { const absolute = path.join(temporary, file);
            mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, contents); }
        assert.deepEqual(packageSourceArtifacts(temporary), source);
        const installedRoot = path.join(temporary, 'node_modules', PACKAGE);
        for (const input of PREPARED_2.inputs) { const absolute = path.join(installedRoot, input.path);
            mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, source[`${PACKAGE_ROOT}/${input.path}`]!); }
        const file = (expected: ExpectedFile): PhysicalFileSnapshot => ({ ...expected, regular: true,
            symbolicLink: false, links: 1 });
        const physical: PhysicalPackageSnapshot = {
            packageJson: { dependencies: { [PACKAGE]: PREPARED_2.dependency } },
            lock: { lockfileVersion: 3, packages: { '': { dependencies: { [PACKAGE]: PREPARED_2.dependency } },
                [`node_modules/${PACKAGE}`]: { version: PREPARED_2_VERSION, resolved: PREPARED_2.dependency,
                    integrity: PREPARED_2_INTEGRITY, engines: { node: '>=24 <25' } } } },
            tarball: file(PREPARED_2.tar), tarRoster: PREPARED_2.roster,
            provenance: { ...file(PREPARED_2.artifacts.at(-1)!), value: prepared2Provenance() },
            artifacts: PREPARED_2.artifacts.map(file), installed: [installedSnapshot(installedRoot)],
        };
        const modules = Object.fromEntries(Object.entries(source).filter(([name]) => name !== PACKAGE_MANIFEST_FILE));
        assert.deepEqual({ source: packageSourceErrors(source, PREPARED_2),
            imports: importInventoryErrors({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE, ...modules }, true),
            physical: physicalPackageErrors(physical, PREPARED_2) }, { source: [], imports: [], physical: [] });
        const mutatedFence = `${PREPARED_2_SUCCESSOR_FENCE}\nrequire('../../../../lib/security/web-auth-lifecycle-owner-adapter');`;
        assert.notDeepEqual(packageSourceErrors({ ...source,
            [`${PACKAGE_ROOT}/internal/support/successor-fence.cjs`]: mutatedFence }, PREPARED_2), []);
        assert.notDeepEqual(importInventoryErrors({
            [`${PACKAGE_ROOT}/internal/support/successor-fence.cjs`]: mutatedFence }, true), []);
        assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: DORMANT_ADAPTER_SOURCE, ...modules }, source, physical,
            PREPARED_2), 'PHYSICAL_PACKAGE_PREPARED');
        for (const invalid of [
            { ...PREPARED_2, version: '0.8.5-prepared.3', sequence: 3 },
            { ...PREPARED_2, predecessor: PREDECESSOR },
            { ...PREPARED_1, version: PREPARED_2_VERSION, sequence: 2 },
        ]) assert.notDeepEqual(preparedContractErrors(invalid), []);
        for (const invalid of [
            { ...physical, packageJson: { dependencies: { [PACKAGE]: PREPARED_1.dependency } } },
            { ...physical, provenance: { ...physical.provenance,
                value: { ...prepared2Provenance(), sourceCommit: '0'.repeat(40) } } },
            { ...physical, installed: [{ ...physical.installed[0]!, files: physical.installed[0]!.files.slice(1) }] },
        ]) assert.notDeepEqual(physicalPackageErrors(invalid, PREPARED_2), []);
        assert.equal(authorityRosterDigest({ ...liveSources,
            [`${PACKAGE_ROOT}/internal/support/successor-fence.cjs`]: PREPARED_2_SUCCESSOR_FENCE }), AUTHORITY_ROSTER_SHA256);
        assert.deepEqual(statefulAuthorityModules({ ...liveSources,
            [`${PACKAGE_ROOT}/internal/support/successor-fence.cjs`]: PREPARED_2_SUCCESSOR_FENCE }), STATEFUL_AUTHORITY_MODULES);
        for (const consumer of ['lib/security/production.ts', 'lib/security/production.test.ts', THIS_FILE])
            assert.notDeepEqual(importInventoryErrors({ [consumer]:
                "import '../../packages/web-auth-lifecycle-owner/internal/support/successor-fence.cjs';" }), [], consumer);
        const child = String.raw`
const Module = require('node:module');
const originalLoad = Module._load;
const mode = process.argv[2];
let calls = 0;
const crypto = { randomBytes(size) {
    calls += 1;
    if (size !== 32 || mode === 'error') throw new Error('synthetic');
    if (mode === 'short') return Buffer.alloc(31, 0xab);
    if (mode === 'typed') return new Uint8Array(32);
    if (mode === 'prototype') { const value = Buffer.alloc(32, 0xab); Object.setPrototypeOf(value, null); return value; }
    if (mode === 'subclass') { const value = Buffer.alloc(32, 0xab);
        Object.setPrototypeOf(value, Object.create(Buffer.prototype)); return value; }
    if (mode === 'proxy') return new Proxy(Buffer.alloc(32, 0xab), {});
    return Buffer.alloc(32, 0xab);
} };
Module._load = function(request, parent, isMain) {
    return request === 'node:crypto' ? crypto : originalLoad.call(this, request, parent, isMain);
};
if (mode === 'pre-is-proxy') {
    const util = require('node:util');
    const originalIsProxy = util.types.isProxy;
    util.types.isProxy = (value) => { originalIsProxy(value); throw new Error('synthetic post-isProxy'); };
}
const ownKeys = Reflect.ownKeys;
const isFrozen = Object.isFrozen;
const api = require(process.argv[1]);
if (mode === 'captured') {
    crypto.randomBytes = () => { throw new Error('late mutation'); };
    Buffer.isBuffer = () => false;
    Object.getPrototypeOf = () => null;
    Reflect.apply = () => { throw new Error('late mutation'); };
    require('node:util').types.isProxy = () => true;
    Buffer.prototype.toString = () => 'INVALID';
}
const result = api.successorFence();
process.stdout.write(JSON.stringify({ calls, result, keys: ownKeys(api), frozen: isFrozen(api) }));`;
        for (const [mode, expected] of [['valid', 'ab'.repeat(32)], ['captured', 'ab'.repeat(32)], ['error', null],
            ['short', null], ['typed', null], ['prototype', null], ['subclass', null], ['proxy', null],
            ['pre-is-proxy', null]] as const) {
            const result = spawnSync(process.execPath, ['-e', child,
                path.join(temporary, PACKAGE_ROOT, 'internal/support/successor-fence.cjs'), mode],
            { cwd: temporary, env: { NODE_ENV: 'test' }, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(JSON.parse(result.stdout), { calls: 1, result: expected, keys: ['successorFence'], frozen: true });
        }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});
