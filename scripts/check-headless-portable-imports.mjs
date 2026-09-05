#!/usr/bin/env node
/* @Codex */
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const DIRECTORY_SURFACES = [
    { relative: 'packages/aip/src', required: true },
    { relative: 'packages/mini/src', required: true },
    { relative: 'packages/mcp/src', required: false },
];
const FILE_SURFACES = [{ relative: 'scripts/intelligent-host-mcp-stdio.mjs', required: true }];
const FORBIDDEN_EXTERNAL = new Set([
    'better-sqlite3', 'drizzle-orm', 'server-only', 'next/headers', 'next/server',
    'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram',
    'http', 'https', 'net', 'tls', 'dgram', 'node:module', 'module',
    'ffi-napi', 'onnxruntime-node', 'node-gyp-build',
]);
const NATIVE_SEGMENT = /(?:^|[-_/@.])(xpc|swift|vision|metal|mlx|cuda|cudnn)(?:$|[-_/@.])/iu;
const ALLOWED_PURE_LIB_MODULES = new Set([
    'lib/terminology', 'lib/terminology.ts',
    'lib/headless/application-operation-registry', 'lib/headless/application-operation-registry.ts',
]);

function sourceFile(source, file) {
    const extension = path.extname(file).toLowerCase();
    const kind = extension === '.tsx' ? ts.ScriptKind.TSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function line(source, position) {
    return source.getLineAndCharacterOfPosition(position).line + 1;
}

function boundaryImport(specifier, file) {
    const normalized = specifier.replaceAll('\\', '/');
    if (normalized.startsWith('@/lib/')) {
        return !ALLOWED_PURE_LIB_MODULES.has(normalized.slice(2));
    }
    if (normalized.startsWith('@/app/') || normalized.startsWith('@/native/')) return true;
    if (!normalized.startsWith('.')) return false;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.replaceAll('\\', '/')), normalized));
    if (ALLOWED_PURE_LIB_MODULES.has(resolved)) return false;
    return resolved === 'lib' || resolved.startsWith('lib/') || resolved === 'app' || resolved.startsWith('app/')
        || resolved === 'native' || resolved.startsWith('native/');
}

function forbiddenSpecifier(specifier, file) {
    const normalized = specifier.trim().toLowerCase();
    if (boundaryImport(specifier, file)) return 'database or Web boundary import is forbidden';
    if (FORBIDDEN_EXTERNAL.has(normalized)
        || normalized.startsWith('better-sqlite3/') || normalized.startsWith('drizzle-orm/')
        || normalized.startsWith('next/headers/') || normalized.startsWith('next/server/')) {
        return 'database, Web or network runtime import is forbidden';
    }
    if (NATIVE_SEGMENT.test(normalized) || /(?:^|\/)native(?:\/|$)/u.test(normalized)) {
        return 'mandatory native adapter import is forbidden';
    }
    return null;
}

function calledName(node) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && node.argumentExpression
        && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    return null;
}

export function validateHeadlessPortableSource(sourceText, file = 'packages/aip/src/input.ts') {
    const parsed = sourceFile(sourceText, file);
    const issues = parsed.parseDiagnostics.map((diagnostic) => `${file}:${line(parsed, diagnostic.start ?? 0)}: syntax error`);
    const inspectSpecifier = (node, specifier) => {
        const reason = forbiddenSpecifier(specifier, file);
        if (reason) issues.push(`${file}:${line(parsed, node.getStart(parsed))}: ${reason}: ${specifier}`);
    };
    const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            if (ts.isStringLiteralLike(node.moduleSpecifier)) inspectSpecifier(node, node.moduleSpecifier.text);
            else issues.push(`${file}:${line(parsed, node.getStart(parsed))}: computed module specifier is forbidden`);
        }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression;
            if (expression && ts.isStringLiteralLike(expression)) inspectSpecifier(node, expression.text);
            else issues.push(`${file}:${line(parsed, node.getStart(parsed))}: computed module specifier is forbidden`);
        }
        if (ts.isCallExpression(node)) {
            const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (dynamicImport || requireCall) {
                const argument = node.arguments[0];
                if (argument && ts.isStringLiteralLike(argument)) inspectSpecifier(node, argument.text);
                else issues.push(`${file}:${line(parsed, node.getStart(parsed))}: computed module loading is forbidden`);
            }
            const name = calledName(node.expression);
            if (name && ['eval', 'Function', 'createRequire', 'getBuiltinModule'].includes(name)) {
                issues.push(`${file}:${line(parsed, node.getStart(parsed))}: executable module indirection is forbidden: ${name}`);
            }
            if (name && ['fetch', 'sendBeacon'].includes(name)) {
                issues.push(`${file}:${line(parsed, node.getStart(parsed))}: network runtime call is forbidden: ${name}`);
            }
        }
        if (ts.isNewExpression(node)) {
            const name = calledName(node.expression);
            if (name && ['Function', 'WebSocket', 'EventSource', 'XMLHttpRequest'].includes(name)) {
                issues.push(`${file}:${line(parsed, node.getStart(parsed))}: network or executable runtime constructor is forbidden: ${name}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    return [...new Set(issues)];
}

async function collectDirectory(root, relative, issues) {
    const directory = path.join(root, relative);
    const files = [];
    async function walk(current) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const absolute = path.join(current, entry.name);
            const relativeFile = path.relative(root, absolute).split(path.sep).join('/');
            if (entry.isSymbolicLink()) { issues.push(`${relativeFile}: symlink is forbidden`); continue; }
            if (entry.isDirectory()) { await walk(absolute); continue; }
            if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(relativeFile);
        }
    }
    await walk(directory);
    return files;
}

export async function runHeadlessPortableImportGuard(root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
    const issues = [];
    const files = [];
    let surfaces = 0;
    for (const surface of DIRECTORY_SURFACES) {
        const absolute = path.join(root, surface.relative);
        let stats;
        try { stats = await lstat(absolute); } catch {
            if (surface.required) issues.push(`${surface.relative}: required surface is missing`);
            continue;
        }
        surfaces += 1;
        if (stats.isSymbolicLink()) { issues.push(`${surface.relative}: symlink is forbidden`); continue; }
        if (!stats.isDirectory()) { issues.push(`${surface.relative}: surface must be a directory`); continue; }
        files.push(...await collectDirectory(root, surface.relative, issues));
    }
    for (const surface of FILE_SURFACES) {
        const absolute = path.join(root, surface.relative);
        let stats;
        try { stats = await lstat(absolute); } catch {
            if (surface.required) issues.push(`${surface.relative}: required surface is missing`);
            continue;
        }
        surfaces += 1;
        if (stats.isSymbolicLink()) issues.push(`${surface.relative}: symlink is forbidden`);
        else if (!stats.isFile()) issues.push(`${surface.relative}: surface must be a file`);
        else files.push(surface.relative);
    }
    for (const file of files.sort()) {
        const source = await readFile(path.join(root, file), 'utf8');
        issues.push(...validateHeadlessPortableSource(source, file));
    }
    if (issues.length > 0) throw new Error(`Headless portable import guard failed:\n${issues.join('\n')}`);
    return { files: files.length, surfaces };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = await runHeadlessPortableImportGuard();
        process.stdout.write(`Headless portable import guard passed: ${result.files} file(s), ${result.surfaces} surface(s).\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'Headless portable import guard failed'}\n`);
        process.exitCode = 1;
    }
}
