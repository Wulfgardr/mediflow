#!/usr/bin/env node
/* @Codex */
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ANYDOC_VERSION = '0.2.4';
export const ANYDOC_WORKER_PATH = 'scripts/anydoc-local-extraction-worker.mjs';
export const ANYDOC_NATIVE_SUBPATH = '@firecrawl/anydoc/index.js';
const RETIRED_PDF_INSPECTOR = '@firecrawl/pdf-inspector';
const RETIRED_PDF_PATHS = ['scripts/pdf-inspector-worker.mjs', 'lib/pdf-inspector-router.ts'];

const EXPECTED_INTEGRITY = Object.freeze({
    '@firecrawl/anydoc': 'sha512-rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==',
    '@firecrawl/anydoc-darwin-arm64': 'sha512-1Eg0rPGVMN052E7Y2+zswANS0KLaWhXvYb9CPgO8HEtclzu3hKAIJ00lIu5PF+DXafZ10ZS4fmrcP+9Ifct9qw==',
    '@firecrawl/anydoc-darwin-x64': 'sha512-fTM8y6COu+jBqWRJ0Je0OqaDDt7YxJ8LU4ISoypO5eOBNXI3+l6tK1ZRwUclYWXGBr/6JaUWEgdyJVFfd/fpJg==',
    '@firecrawl/anydoc-linux-arm64-gnu': 'sha512-gRrrjluTfQCjOO6wBefEP1QumYlUcGWKP7secVIO+ly8U/+DDQ70bOHW2lOGu19hA/23j7bc7bb3oLPAaBY82A==',
    '@firecrawl/anydoc-linux-arm64-musl': 'sha512-fpzby6xqD709GmYUpnrWh7/2Csa6lwGrZrYPNGyn4KMEuJ1ibsNv6I3kdZAotMUKZ8nlNdPp32v964eBpsijcw==',
    '@firecrawl/anydoc-linux-x64-gnu': 'sha512-yfvx+iGo2CvZH0TB9MeyNjkrd5/psNFEuxkl2Jah/VNFesPRASqjjCkDRY7tKw7fPij1u/UyFVxI6bsu6Iow9Q==',
    '@firecrawl/anydoc-linux-x64-musl': 'sha512-9OWpM84c5SA/2wjfFxgfhupxziapus+7DERWmcOvkVxNp2H5Qj/9Y74c9leP2i03SjmBDl9tYWMVd3k/S3rY6w==',
    '@firecrawl/anydoc-win32-x64-msvc': 'sha512-E7d14hy5kZNsMNnHiutU6r9yr53LrKXSsMSFtl0QhU/1KWuvRnjhQEuMiuW4YbsMcPlEaK10WtBVF86g9OMW6A==',
});
const NATIVE_PACKAGES = Object.freeze(Object.keys(EXPECTED_INTEGRITY).filter((name) => name !== '@firecrawl/anydoc'));
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SCAN_ROOTS = ['app', 'components', 'lib', 'scripts'];
const SELF_FILES = new Set(['scripts/check-anydoc-local-only.mjs', 'scripts/check-anydoc-local-only.test.mjs']);

function retiredPdfIdentity(value) {
    return typeof value === 'string' && (value.includes(RETIRED_PDF_INSPECTOR)
        || /(?:^|[/:])pdf-inspector(?:[-/@]|$)/iu.test(value));
}

function dependencyEntries(manifest) {
    return ['dependencies', 'devDependencies', 'optionalDependencies']
        .flatMap((field) => Object.entries(manifest?.[field] ?? {}));
}

function lockPackageName(key) {
    const tail = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const parts = tail.split('/');
    return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function retiredLockIdentity(key, value) {
    return [key, value?.name, value?.version, value?.resolved].some(retiredPdfIdentity);
}

function retiredAliasReference(value, aliases) {
    return [...aliases].some((alias) => value === alias || value.startsWith(`${alias}/`));
}

function retiredPdfAliases(packageJson, packageLock) {
    const aliases = new Set(dependencyEntries(packageJson)
        .filter(([name, value]) => retiredPdfIdentity(name) || retiredPdfIdentity(value))
        .map(([name]) => name));
    for (const [name, value] of dependencyEntries(packageLock?.packages?.[''])) {
        if (retiredPdfIdentity(name) || retiredPdfIdentity(value)) aliases.add(name);
    }
    for (const [key, value] of Object.entries(packageLock?.packages ?? {})) {
        if (retiredLockIdentity(key, value)) {
            const name = lockPackageName(key);
            if (name) aliases.add(name);
        }
    }
    return aliases;
}

function sameMembers(left, right) {
    return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateAnyDocSupplyChain(packageJson, packageLock) {
    const issues = [];
    if (dependencyEntries(packageJson).some(([name, value]) => retiredPdfIdentity(name) || retiredPdfIdentity(value))) {
        issues.push('retired PDF inspector dependency is forbidden');
    }
    if (packageJson?.dependencies?.['@firecrawl/anydoc'] !== ANYDOC_VERSION) issues.push('package dependency must pin @firecrawl/anydoc 0.2.4 exactly');
    const packages = packageLock?.packages;
    if (!packages || typeof packages !== 'object') return [...issues, 'package-lock packages map is missing'];
    if (dependencyEntries(packages['']).some(([name, value]) => retiredPdfIdentity(name) || retiredPdfIdentity(value))
        || Object.entries(packages).some(([key, value]) => retiredLockIdentity(key, value))) {
        issues.push('retired PDF inspector package-lock entry is forbidden');
    }
    if (packages['']?.dependencies?.['@firecrawl/anydoc'] !== ANYDOC_VERSION) issues.push('package-lock root dependency drift');
    const root = packages['node_modules/@firecrawl/anydoc'];
    if (root?.engines?.node !== '>= 20') issues.push('AnyDoc Node engine drift');
    if (root?.hasInstallScript !== undefined) issues.push('AnyDoc install script is forbidden');
    if (!sameMembers(Object.keys(root?.optionalDependencies ?? {}), NATIVE_PACKAGES)) issues.push('AnyDoc native package set drift');
    if (Object.values(root?.optionalDependencies ?? {}).some((version) => version !== ANYDOC_VERSION)) issues.push('AnyDoc native dependency version drift');
    const lockedNativePackages = Object.keys(packages)
        .filter((key) => key.startsWith('node_modules/@firecrawl/anydoc-'))
        .map((key) => key.slice('node_modules/'.length));
    if (!sameMembers(lockedNativePackages, NATIVE_PACKAGES)) issues.push('AnyDoc locked native package set drift');
    for (const [name, integrity] of Object.entries(EXPECTED_INTEGRITY)) {
        const entry = packages[`node_modules/${name}`];
        if (entry?.version !== ANYDOC_VERSION) issues.push(`${name} version drift`);
        if (entry?.integrity !== integrity) issues.push(`${name} integrity drift`);
        if (entry?.hasInstallScript !== undefined) issues.push(`${name} install script is forbidden`);
        if (name !== '@firecrawl/anydoc' && entry?.optional !== true) issues.push(`${name} must remain optional`);
    }
    return issues;
}

function parseSource(source, worker) {
    return ts.createSourceFile(worker ? 'anydoc-worker.mjs' : 'anydoc-guard-input.tsx', source, ts.ScriptTarget.Latest, true, worker ? ts.ScriptKind.JS : ts.ScriptKind.TSX);
}

function isLexicalScope(node) {
    return ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseBlock(node)
        || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node);
}

function declarationIndex(sourceFile) {
    const index = new Map();
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
            let scope = node.parent;
            while (scope && !isLexicalScope(scope)) scope = scope.parent;
            if (scope) {
                const byName = index.get(scope) ?? new Map();
                const declarations = byName.get(node.name.text) ?? [];
                declarations.push(node);
                byName.set(node.name.text, declarations);
                index.set(scope, byName);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return index;
}

function resolveConst(identifier, index) {
    for (let scope = identifier.parent; scope; scope = scope.parent) {
        const declarations = index.get(scope)?.get(identifier.text) ?? [];
        const visible = declarations.filter((declaration) => declaration.pos < identifier.pos).at(-1);
        if (visible) return visible;
    }
    return undefined;
}

function constantValue(node, index, seen = new Set()) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return constantValue(node.expression, index, seen);
    if (ts.isArrayLiteralExpression(node)) {
        const values = node.elements.map((element) => constantValue(element, index, seen));
        return values.every((value) => typeof value === 'string') ? values : undefined;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = constantValue(node.left, index, seen);
        const right = constantValue(node.right, index, seen);
        return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
    }
    if (ts.isTemplateExpression(node)) {
        let value = node.head.text;
        for (const span of node.templateSpans) {
            const expression = constantValue(span.expression, index, seen);
            if (typeof expression !== 'string') return undefined;
            value += expression + span.literal.text;
        }
        return value;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
        const values = constantValue(node.expression.expression, index, seen);
        const separator = node.arguments.length === 0 ? ',' : constantValue(node.arguments[0], index, seen);
        return Array.isArray(values) && typeof separator === 'string' ? values.join(separator) : undefined;
    }
    if (ts.isIdentifier(node)) {
        const declaration = resolveConst(node, index);
        if (!declaration || seen.has(declaration)) return undefined;
        return constantValue(declaration.initializer, index, new Set([...seen, declaration]));
    }
    return undefined;
}

function constantString(node, index) {
    const value = constantValue(node, index);
    return typeof value === 'string' ? value : undefined;
}

function propertyName(node, index) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return constantString(node.expression, index);
    return constantString(node, index);
}

const ALLOWED_PROCESS_PROPERTIES = new Set(['stdin', 'stdout', 'exitCode']);
const FORBIDDEN_WORKER_ROOTS = new Set([
    'Object', 'Reflect', 'Proxy', 'globalThis', 'global', 'window', 'self', 'console',
    'fetch', 'WebSocket', 'XMLHttpRequest', 'require', 'createRequire', 'module', 'exports',
    'eval', 'Function', 'JSON', 'Deno', 'Bun', 'navigator', 'env',
    'FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL', 'NAPI_RS_NATIVE_LIBRARY_PATH',
]);
const FORBIDDEN_PROPERTIES = new Set(['constructor', '__proto__', 'prototype', 'getBuiltinModule', 'binding', 'mainModule', 'env']);
const FORBIDDEN_CONSTANTS = new Set([...FORBIDDEN_WORKER_ROOTS, 'http', 'https', 'net', 'tls', 'node:http', 'node:https', 'node:net', 'node:tls']);

function hasValueImportBinding(node) {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return false;
    if (clause.name) return true;
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
    return Boolean(clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.some((element) => !element.isTypeOnly));
}

function analyzeSource(source, worker, retiredAliases = new Set()) {
    const sourceFile = parseSource(source, worker);
    const declarations = declarationIndex(sourceFile);
    const issues = new Set();
    let nativeImports = 0;
    let staticImports = 0;
    if (worker && sourceFile.parseDiagnostics.length > 0) issues.add('worker source has syntax errors');

    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            staticImports += 1;
            const specifier = node.moduleSpecifier.text;
            if (specifier === ANYDOC_NATIVE_SUBPATH && hasValueImportBinding(node)) nativeImports += 1;
            else if (specifier.startsWith('@firecrawl/anydoc')) issues.add('package root or CLI import is forbidden');
            if (worker && (!hasValueImportBinding(node) || node.attributes || node.assertClause)) issues.add('worker import must have a value binding and no attributes');
        }
        if (worker && (ts.isExportDeclaration(node) || ts.isExportAssignment(node))) issues.add('worker exports are forbidden');
        if (worker && ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) issues.add('worker export modifier is forbidden');
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            const specifier = constantString(node.moduleSpecifier, declarations);
            if (specifier?.startsWith('@firecrawl/anydoc')) issues.add('AnyDoc re-export is forbidden');
        }
        if (ts.isCallExpression(node)) {
            const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (worker && dynamicImport) issues.add('dynamic import is forbidden');
            if (worker && requireCall) issues.add('require is forbidden');
            if (dynamicImport || requireCall) {
                const specifier = constantString(node.arguments[0], declarations);
                if (specifier?.startsWith('@firecrawl/anydoc')) issues.add('computed AnyDoc package loading is forbidden');
            }
        }
        if (worker && ts.isIdentifier(node) && FORBIDDEN_WORKER_ROOTS.has(node.text)) issues.add(`${node.text} is forbidden`);
        if (worker && ts.isIdentifier(node) && node.text === 'process') {
            const allowed = ts.isPropertyAccessExpression(node.parent)
                && node.parent.expression === node
                && ALLOWED_PROCESS_PROPERTIES.has(node.parent.name.text);
            if (!allowed) issues.add('process root access is forbidden');
        }
        if (worker && (ts.isElementAccessExpression(node) || ts.isComputedPropertyName(node))) issues.add('computed property access is forbidden');
        if (worker && ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) issues.add(`${node.name.text} property is forbidden`);
        if (worker && ts.isPropertyAccessExpression(node) && node.name.text === 'ocr') issues.add('ocr property access and assignment are forbidden');
        if (worker && ts.isMetaProperty(node)) issues.add('import.meta is forbidden');
        if (worker && ts.isPropertyAssignment(node)) {
            const name = propertyName(node.name, declarations);
            if (name === 'ocr') issues.add('ocr option is forbidden');
        }
        if (worker && ts.isShorthandPropertyAssignment(node)) {
            if (node.name.text === 'ocr') issues.add('ocr shorthand is forbidden');
        }
        if (worker && ts.isVariableDeclaration(node)
            && (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name))) {
            issues.add('destructuring bindings are forbidden in the worker');
        }
        if (worker && ts.isParameter(node)) {
            if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
                issues.add('destructuring parameters are forbidden in the worker');
            }
            if (ts.isIdentifier(node.name) && node.name.text === 'ocr') issues.add('ocr parameters are forbidden in the worker');
        }
        if (worker && ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && (ts.isObjectLiteralExpression(node.left) || ts.isArrayLiteralExpression(node.left))) {
            issues.add('destructuring assignments are forbidden in the worker');
        }
        if (worker && ts.isSpreadAssignment(node)) issues.add('property spread is forbidden in the worker');
        if (worker && (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isMethodDeclaration(node))) {
            issues.add('accessor and method declarations are forbidden in the worker');
        }
        if (worker && ts.isPropertyDeclaration(node) && propertyName(node.name, declarations) === 'ocr') {
            issues.add('ocr class property is forbidden');
        }
        const constant = constantString(node, declarations);
        const parent = node.parent;
        let moduleReference = false;
        if (parent) {
            moduleReference = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
                ? parent.moduleSpecifier === node
                : ts.isCallExpression(parent) && parent.arguments[0] === node
                    && (parent.expression.kind === ts.SyntaxKind.ImportKeyword
                        || (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'));
        }
        const isAcceptedImport = worker
            && ts.isStringLiteral(node)
            && ts.isImportDeclaration(node.parent)
            && node.parent.moduleSpecifier === node
            && node.text === ANYDOC_NATIVE_SUBPATH;
        if (!isAcceptedImport && constant?.startsWith('@firecrawl/anydoc')) issues.add('AnyDoc package reference is forbidden outside the exact static import');
        if (constant?.startsWith(RETIRED_PDF_INSPECTOR)) issues.add('retired PDF inspector source reference is forbidden');
        if (moduleReference && constant && retiredAliasReference(constant, retiredAliases)) issues.add('retired PDF inspector alias import is forbidden');
        if (worker && constant && FORBIDDEN_CONSTANTS.has(constant)) issues.add(`${constant} constant is forbidden`);
        if (worker && constant && /^(?:https?|wss?):/u.test(constant)) issues.add('network URL is forbidden');
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (worker && (nativeImports !== 1 || staticImports !== 1)) issues.add(`worker must have exactly one static import declaration from ${ANYDOC_NATIVE_SUBPATH}`);
    return [...issues];
}

export function validateAnyDocWorkerSource(source) {
    return analyzeSource(source, true);
}

export function validateAnyDocNonWorkerSource(source, retiredAliases) {
    return analyzeSource(source, false, new Set(retiredAliases));
}

async function sourceFiles(root) {
    const files = [];
    async function walk(directory) {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
        }
    }
    for (const directory of SCAN_ROOTS) await walk(path.join(root, directory));
    return files;
}

export async function runAnyDocLocalOnlyGuard(root) {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    const issues = validateAnyDocSupplyChain(packageJson, packageLock);
    const retiredAliases = retiredPdfAliases(packageJson, packageLock);
    const configSource = await readFile(path.join(root, 'next.config.ts'), 'utf8');
    issues.push(...validateAnyDocNonWorkerSource(configSource, retiredAliases).map((issue) => `next.config.ts: ${issue}`));
    for (const relative of RETIRED_PDF_PATHS) {
        try {
            await lstat(path.join(root, relative));
            issues.push(`${relative}: retired PDF inspector path is forbidden`);
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
    }
    let workerSeen = false;
    for (const absolute of await sourceFiles(root)) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (SELF_FILES.has(relative)) continue;
        const source = await readFile(absolute, 'utf8');
        if (relative === ANYDOC_WORKER_PATH) {
            workerSeen = true;
            issues.push(...validateAnyDocWorkerSource(source).map((issue) => `${relative}: ${issue}`));
        } else {
            issues.push(...validateAnyDocNonWorkerSource(source, retiredAliases).map((issue) => `${relative}: ${issue}`));
        }
    }
    if (issues.length > 0) throw new Error(`AnyDoc local-only guard failed:\n- ${issues.join('\n- ')}`);
    return { workerSeen, checkedPackages: Object.keys(EXPECTED_INTEGRITY).length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const result = await runAnyDocLocalOnlyGuard(process.cwd());
    console.log(`AnyDoc local-only guard: PASS (${result.checkedPackages} packages; worker ${result.workerSeen ? 'checked' : 'not present'})`);
}
