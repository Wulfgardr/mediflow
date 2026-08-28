#!/usr/bin/env node
/* @Codex */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ANYDOC_VERSION = '0.2.4';
export const ANYDOC_WORKER_PATH = 'scripts/anydoc-local-extraction-worker.mjs';
export const ANYDOC_NATIVE_SUBPATH = '@firecrawl/anydoc/index.js';

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

function sameMembers(left, right) {
    return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateAnyDocSupplyChain(packageJson, packageLock) {
    const issues = [];
    if (packageJson?.dependencies?.['@firecrawl/anydoc'] !== ANYDOC_VERSION) issues.push('package dependency must pin @firecrawl/anydoc 0.2.4 exactly');
    const packages = packageLock?.packages;
    if (!packages || typeof packages !== 'object') return [...issues, 'package-lock packages map is missing'];
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

function constantBindings(sourceFile) {
    const bindings = new Map();
    const visit = (node) => {
        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.initializer
            && (node.parent.flags & ts.NodeFlags.Const) !== 0
        ) bindings.set(node.name.text, bindings.has(node.name.text) ? undefined : node.initializer);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return bindings;
}

function constantString(node, bindings, seen = new Set()) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return constantString(node.expression, bindings, seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = constantString(node.left, bindings, seen);
        const right = constantString(node.right, bindings, seen);
        return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isTemplateExpression(node)) {
        let value = node.head.text;
        for (const span of node.templateSpans) {
            const expression = constantString(span.expression, bindings, seen);
            if (expression === undefined) return undefined;
            value += expression + span.literal.text;
        }
        return value;
    }
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
        const initializer = bindings.get(node.text);
        if (!initializer) return undefined;
        return constantString(initializer, bindings, new Set([...seen, node.text]));
    }
    return undefined;
}

function propertyName(node, bindings) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return constantString(node.expression, bindings);
    return constantString(node, bindings);
}

const NETWORK_MODULES = new Set(['http', 'https', 'net', 'tls', 'node:http', 'node:https', 'node:net', 'node:tls']);
const FORBIDDEN_IDENTIFIERS = new Set([
    'fetch', 'WebSocket', 'XMLHttpRequest', 'require', 'eval', 'Function', 'env',
    'FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL', 'NAPI_RS_NATIVE_LIBRARY_PATH',
]);
const FORBIDDEN_CONSTANTS = new Set([...FORBIDDEN_IDENTIFIERS, 'http', 'https', 'net', 'tls']);

function analyzeSource(source, worker) {
    const sourceFile = parseSource(source, worker);
    const bindings = constantBindings(sourceFile);
    const issues = new Set();
    let nativeImports = 0;
    let staticImports = 0;
    if (worker && sourceFile.parseDiagnostics.length > 0) issues.add('worker source has syntax errors');

    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            staticImports += 1;
            const specifier = node.moduleSpecifier.text;
            const namedImports = node.importClause?.namedBindings;
            const hasTypeSyntax = node.importClause?.isTypeOnly === true
                || (namedImports && ts.isNamedImports(namedImports) && namedImports.elements.some((element) => element.isTypeOnly));
            if (worker && hasTypeSyntax) issues.add('type-only import syntax is forbidden in the worker');
            if (specifier === ANYDOC_NATIVE_SUBPATH) nativeImports += 1;
            else if (specifier.startsWith('@firecrawl/anydoc')) issues.add('package root or CLI import is forbidden');
            if (worker && NETWORK_MODULES.has(specifier)) issues.add('network module import is forbidden');
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            const specifier = constantString(node.moduleSpecifier, bindings);
            if (specifier?.startsWith('@firecrawl/anydoc')) issues.add('AnyDoc re-export is forbidden');
        }
        if (ts.isCallExpression(node)) {
            const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (worker && dynamicImport) issues.add('dynamic import is forbidden');
            if (worker && requireCall) issues.add('require is forbidden');
            if (dynamicImport || requireCall) {
                const specifier = constantString(node.arguments[0], bindings);
                if (specifier?.startsWith('@firecrawl/anydoc')) issues.add('computed AnyDoc package loading is forbidden');
            }
        }
        if (worker && ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) issues.add(`${node.text} is forbidden`);
        if (worker && (ts.isElementAccessExpression(node) || ts.isComputedPropertyName(node))) issues.add('computed property access is forbidden');
        if (worker && ts.isPropertyAssignment(node)) {
            const name = propertyName(node.name, bindings);
            const value = constantString(node.initializer, bindings);
            if (name === 'ocr' && value === 'hosted') issues.add('hosted OCR option is forbidden');
        }
        const constant = constantString(node, bindings);
        const isAcceptedImport = worker
            && ts.isStringLiteral(node)
            && ts.isImportDeclaration(node.parent)
            && node.parent.moduleSpecifier === node
            && node.text === ANYDOC_NATIVE_SUBPATH;
        if (!isAcceptedImport && constant?.startsWith('@firecrawl/anydoc')) issues.add('AnyDoc package reference is forbidden outside the exact static import');
        if (worker && constant && NETWORK_MODULES.has(constant)) issues.add('network module reference is forbidden');
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

export function validateAnyDocNonWorkerSource(source) {
    return analyzeSource(source, false);
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
    let workerSeen = false;
    for (const absolute of await sourceFiles(root)) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (SELF_FILES.has(relative)) continue;
        const source = await readFile(absolute, 'utf8');
        if (relative === ANYDOC_WORKER_PATH) {
            workerSeen = true;
            issues.push(...validateAnyDocWorkerSource(source).map((issue) => `${relative}: ${issue}`));
        } else {
            issues.push(...validateAnyDocNonWorkerSource(source).map((issue) => `${relative}: ${issue}`));
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
