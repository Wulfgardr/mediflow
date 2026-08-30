/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

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
const ADAPTER = 'lib/security/web-auth-lifecycle-owner-adapter';
const ADAPTER_FILE = `${ADAPTER}.ts`;
const ADAPTER_TEST = `${ADAPTER}.test`;
const ADAPTER_TEST_FILE = `${ADAPTER_TEST}.ts`;
const THIS_FILE = 'lib/security/web-auth-lifecycle-owner-boundary.test.ts';
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
const STATEFUL_AUTHORITY_MODULES = new Set([
    'active-review-binding', 'audit', 'in-process-preview-job-control', 'module-import-inventory.test-support', 'pin-change',
    'server-session-projection-owner-production', 'server-session', 'session-physician-review-authority',
    'smart-import-browser-orchestrator', 'smart-import-context-proposal-browser-adapter',
    'smart-import-projection-attachment-browser-normalizer', 'smart-import-selection-browser-adapter',
    'web-auth-control-owner', 'web-auth-session-issuer',
].map((name) => `lib/security/${name}.ts`));
type Sources = Readonly<Record<string, string>>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
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
    readdir(value: string): ReadonlyArray<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }> }>;
const SCAN_OPS: ScanOps = { exists: existsSync, realpath: realpathSync.native,
    readdir: (value) => readdirSync(value, { withFileTypes: true }) };
const ownerPackageCopies = (root: string, ops = SCAN_OPS) => {
    const pending = [path.join(root, 'node_modules')]; const seen = new Set<string>(); const found: string[] = [];
    while (pending.length > 0) {
        const directory = pending.pop()!; if (!ops.exists(directory)) continue;
        let real: string; try { real = ops.realpath(directory); } catch { return [...found, '<unscannable>']; }
        if (seen.has(real)) continue; seen.add(real); if (seen.size > 4_096) return [...found, '<scan-limit>'];
        const owner = path.join(directory, PACKAGE); if (ops.exists(owner)) found.push(owner);
        try { for (const entry of ops.readdir(directory)) {
            const candidate = path.join(directory, entry.name); const packages = entry.name.startsWith('@') && entry.isDirectory()
                ? ops.readdir(candidate).filter((item) => item.isDirectory() || item.isSymbolicLink()).map((item) => path.join(candidate, item.name))
                : entry.isDirectory() || entry.isSymbolicLink() ? [candidate] : [];
            for (const packageRoot of packages) pending.push(entry.name === '.pnpm' ? packageRoot : path.join(packageRoot, 'node_modules'));
        } } catch { return [...found, '<unscannable>']; }
    }
    return found;
};
const importInventoryErrors = (sources: Sources, allowAdapterTestUse = false): string[] => {
    const errors: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
        if (file === THIS_FILE) continue;
        const unresolvedLoaderIsKnown = PRE_CUTOVER_UNRESOLVED_LOADERS.get(file) === digest(source);
        const packageTarget = path.join(path.dirname(file), PACKAGE);
        const packageUses = inventoryModuleImports({ file, source, target: packageTarget, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const packageRelevant = packageUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown)
            || source.includes('web-auth-lifecycle-owner'));
        if (packageRelevant.length > 0) errors.push(`${file}:package-load`);
        const packageAst = ast(file, source); let deepPackage = false; const constants = new Map<string, ts.Expression>();
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
                const value = staticString(node); if (value === PACKAGE || value?.startsWith(`${PACKAGE}/`)) deepPackage = true;
            }
            ts.forEachChild(node, visitPackage);
        };
        visitPackage(packageAst); if (deepPackage) errors.push(`${file}:package-literal`);
        const adapterUses = inventoryModuleImports({ file, source, target: ADAPTER, repositoryRoot: ROOT,
            allowUnresolvedExpressions: allowedGenericLoaderExpressions });
        const allowedTestUse = allowAdapterTestUse && file === ADAPTER_TEST_FILE && adapterUses.every((use) =>
            (use.form === 'named' && !use.typeOnly) || (use.form === 'import-type' && use.typeOnly));
        const adapterRelevant = adapterUses.filter((use) => IMPORT_FORMS.has(use.form) || use.form === 'module-path'
            || (UNRESOLVED_LOADER_FORMS.has(use.form) && !unresolvedLoaderIsKnown)
            || source.includes('web-auth-lifecycle-owner-adapter'));
        if (adapterRelevant.length > 0 && !allowedTestUse) errors.push(`${file}:adapter-load`);
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

const packageBoundaryErrors = (packageJson: Record<string, unknown>, lock: string, nextConfig: string,
    ownerInNodeModules: boolean): string[] => {
    const errors: string[] = [];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (PACKAGE in ((packageJson[section] as Record<string, unknown> | undefined) ?? {})) errors.push(`package:${section}`);
    }
    if (lock.includes(PACKAGE)) errors.push('package:lock');
    if (ownerInNodeModules) errors.push('package:node_modules');
    if (/serverExternalPackages\s*:[\s\S]*?@mediflow\/web-auth-lifecycle-owner/u.test(nextConfig)) errors.push('package:next-external');
    return errors;
};
const preCutoverSourceState = (sources: Sources): 'BASELINE' | 'DORMANT_PREPARED' | 'INVALID' => {
    const adapter = sources[ADAPTER_FILE];
    if (importInventoryErrors(sources, adapter !== undefined).length > 0) return 'INVALID';
    if (adapter === undefined) return 'BASELINE';
    return dormantAdapterErrors(adapter).length === 0 ? 'DORMANT_PREPARED' : 'INVALID';
};

const liveSources = sourceFiles(ROOT);
const livePackage = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
const liveLock = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
const liveNext = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');

test('accepts only the exact BASELINE or DORMANT_PREPARED pre-cutover repository state', () => {
    assert.deepEqual(packageBoundaryErrors(livePackage, liveLock, liveNext,
        ownerPackageCopies(ROOT).length > 0), []);
    assert.equal(preCutoverSourceState(liveSources), liveSources[ADAPTER_FILE] === undefined ? 'BASELINE' : 'DORMANT_PREPARED');
    assert.equal(authorityRosterDigest(liveSources), AUTHORITY_ROSTER_SHA256);
    assert.deepEqual(statefulAuthorityModules(liveSources), STATEFUL_AUTHORITY_MODULES);
    assert.equal(digest(liveSources[PRE_CUTOVER_GLOBAL_OWNER]!), PRE_CUTOVER_GLOBAL_OWNER_SHA256,
        'the historical globalThis projection owner is permitted only while state=pre_cutover');
});

test('accepts both closed states and denies an early or consumed adapter', () => {
    const dormant = DORMANT_ADAPTER_SOURCE;
    assert.equal(preCutoverSourceState({}), 'BASELINE');
    assert.equal(preCutoverSourceState({ [ADAPTER_FILE]: dormant }), 'DORMANT_PREPARED');
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

test('denies hostile package and adapter loads without changing the shared inventory support', () => {
    const adapterAbsolute = path.join(ROOT, ADAPTER); const hostile = [
        `import '${PACKAGE}';`, `import '${PACKAGE}/deep';`, `import './web-auth-lifecycle-owner-adapter';`,
        `export * from './web-auth-lifecycle-owner-adapter';`, `const p='./web-auth-'+'lifecycle-owner-adapter';import(p);`,
        `Reflect.apply(require,null,['./web-auth-lifecycle-owner-adapter']);`,
        "const p='@mediflow/web-auth-'+'lifecycle-owner/deep';import(p);",
        "const scope='@mediflow';const name='web-auth-lifecycle-owner';const p=`${scope}/${name}/deep`;import(p);",
        "const p=pick()?'./web-auth-lifecycle-owner-adapter':'./other';import(p);", 'import {',
        ...moduleImportBypassFixtures('./web-auth-lifecycle-owner-adapter', adapterAbsolute),
        ...createRequireBypassFixtures('./web-auth-lifecycle-owner-adapter'),
        ...createRequireUnresolvedFixtures('./web-auth-lifecycle-owner-adapter'),
        ...unsafeLoaderIdentityFixtures('./web-auth-lifecycle-owner-adapter'),
    ];
    for (const [index, source] of hostile.entries()) assert.notDeepEqual(
        importInventoryErrors({ [`lib/security/hostile-${index}.ts`]: source }), [], source);
});

test('denies package metadata, early externalization, new authority modules or edges, and ambient-owner drift', () => {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.notDeepEqual(packageBoundaryErrors({ [section]: { [PACKAGE]: '0.0.0-synthetic' } }, '', '', false), []);
    }
    assert.notDeepEqual(packageBoundaryErrors({}, `{"node_modules/${PACKAGE}":{}}`, '', false), []);
    assert.notDeepEqual(packageBoundaryErrors({}, '', `serverExternalPackages:['${PACKAGE}']`, false), []);
    assert.notDeepEqual(packageBoundaryErrors({}, '', '', true), []);
    const nestedRoot = mkdtempSync(path.join(tmpdir(), 'mediflow-owner-boundary-'));
    try {
        mkdirSync(path.join(nestedRoot, 'node_modules', 'synthetic-parent', 'node_modules', PACKAGE), { recursive: true });
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
        rmSync(path.join(nestedRoot, 'node_modules', 'synthetic-parent'), { recursive: true });
        mkdirSync(path.join(nestedRoot, 'node_modules', '.pnpm', 'synthetic@0.0.0', 'node_modules', PACKAGE), { recursive: true });
        assert.notDeepEqual(ownerPackageCopies(nestedRoot), []);
    } finally { rmSync(nestedRoot, { recursive: true, force: true }); }
    const baseOps: ScanOps = { exists: (value) => value.endsWith('node_modules'), realpath: (value) => value, readdir: () => [] };
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
