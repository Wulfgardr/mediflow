#!/usr/bin/env node
/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['app', 'components', 'lib', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SELF = new Set(['scripts/check-attachment-currentness-writers.mjs', 'scripts/check-attachment-currentness-writers.test.mjs']);

// Exact source-shape ledger. A record is valid only while path, AST fingerprint, and
// occurrence count all match. `finding` records keep the production gate red.
const record = (path, kind, fingerprint, count, disposition = 'current', code) => ({ path, kind, fingerprint, count, disposition, code });
export const CONTRACT = [
    record('app/api/attachments/[id]/route.ts', 'orm-delete', '46227366b7b8c814', 1),
    record('app/patients/[id]/entries/new/page.tsx', 'facade-add', 'a31458e0ddb9239b', 1, 'delegated'),
    record('components/document-upload.tsx', 'facade-add', 'bb17b19c4e9ee44b', 1, 'delegated'),
    record('components/document-upload.tsx', 'facade-delete', 'ea20bffd502bf35b', 1, 'delegated'),
    record('lib/attachment-currentness-host.ts', 'raw-update', '9c1cca84075cc579', 1),
    record('lib/attachment-currentness-host.ts', 'raw-update', 'f7b9893a376ee118', 1),
    record('lib/attachment-web-create.ts', 'orm-insert', '58b77ec84cbf40a6', 1),
    record('lib/backup-restore-executor.ts', 'restore-clear-binding', '94a040e199bf2242', 1),
    record('lib/backup-restore-executor.ts', 'restore-delete', 'bcb60d05c6552e6d', 1),
    record('lib/backup-restore-executor.ts', 'restore-insert-binding', 'd047e211add695dc', 1),
    record('lib/backup-restore-executor.ts', 'restore-insert', 'e9d1fc20c04fbedd', 1),
    record('lib/backup-restore-executor.ts', 'restore-table-binding', '58e16648da2bfbac', 1),
    record('lib/db-server.ts', 'raw-insert-into', 'ad4d3f978bf6eeb3', 1, 'migration'),
    record('lib/network-attachment-write.ts', 'orm-insert', '616925ed8587e1e5', 1),
    record('lib/patient-cascade.ts', 'purge-delete', '1544def1d89b8873', 1),
    record('lib/patient-cascade.ts', 'purge-delete', '4dd20c8a366b6640', 1),
    record('lib/patient-cascade.ts', 'purge-table-binding', 'dbe094bf7fa0c482', 1),
    record('lib/seeder.ts', 'facade-add', '57e674ca12a06a80', 1, 'delegated'),
    record('lib/seeder.ts', 'facade-clear', 'b673d24443e4a92d', 1, 'delegated'),
    record('scripts/document-evidence-backfill-currentness-cas.ts', 'raw-update', 'cc1a0df941d5c333', 1),
    record('scripts/seed-performance-baseline.mjs', 'raw-insert-into', '0cefbe788a72c137', 1),
];

function collect(dir) {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) return collect(child);
        if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name)) || /\.(?:test|spec)\./u.test(entry.name) || SELF.has(child)) return [];
        return [child];
    });
}
function parse(file, source) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}
function text(node, sourceFile) { return node.getText(sourceFile).replace(/\s+/gu, ' ').trim(); }
function anchor(node) {
    let current = node;
    while (current.parent && !ts.isSourceFile(current.parent) && !ts.isBlock(current.parent)
        && !ts.isExpressionStatement(current.parent) && !ts.isVariableDeclaration(current.parent)
        && !ts.isReturnStatement(current.parent)) current = current.parent;
    return current.parent && (ts.isExpressionStatement(current.parent) || ts.isVariableDeclaration(current.parent) || ts.isReturnStatement(current.parent)) ? current.parent : current;
}
function fingerprint(node, sourceFile) { return createHash('sha256').update(text(anchor(node), sourceFile)).digest('hex').slice(0, 16); }
function constant(node, declarations, seen = new Set()) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return constant(node.expression, declarations, seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = constant(node.left, declarations, seen);
        const right = constant(node.right, declarations, seen);
        return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
    }
    if (ts.isIdentifier(node)) {
        const declaration = declarations.get(node.text);
        if (!declaration || seen.has(declaration)) return undefined;
        return constant(declaration.initializer, declarations, new Set([...seen, declaration]));
    }
    return undefined;
}
function property(node, declarations) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return constant(node.argumentExpression, declarations);
    return undefined;
}
function resolvesAttachment(node, declarations, seen = new Set()) {
    if (!node) return false;
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && property(node, declarations) === 'attachments') return true;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return resolvesAttachment(node.expression, declarations, seen);
    if (ts.isIdentifier(node)) {
        if (node.text === 'attachments') return true;
        const declaration = declarations.get(node.text);
        if (!declaration || seen.has(declaration)) return false;
        return resolvesAttachment(declaration.initializer, declarations, new Set([...seen, declaration]));
    }
    return false;
}
function sqlText(node, declarations) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `${constant(span.expression, declarations) ?? ' ? '} ${span.literal.text}`).join('');
    if (ts.isTaggedTemplateExpression(node)) return sqlText(node.template, declarations);
    return constant(node, declarations);
}

export function analyzeSource(file, source) {
    const sourceFile = parse(file, source);
    if (sourceFile.parseDiagnostics.length) return [{ path: file, kind: 'parse-error', fingerprint: createHash('sha256').update(source).digest('hex').slice(0, 16) }];
    const declarations = new Map();
    const found = [];
    const visitDeclarations = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node);
        ts.forEachChild(node, visitDeclarations);
    };
    visitDeclarations(sourceFile);
    const add = (kind, node) => found.push({ path: file, kind, fingerprint: fingerprint(node, sourceFile) });
    if (file === 'lib/backup-restore-executor.ts') {
        for (const [name, kind] of [['CLEAR_ORDER', 'restore-clear-binding'], ['INSERT_ORDER', 'restore-insert-binding'], ['TABLE_LOOKUP', 'restore-table-binding']]) {
            const declaration = declarations.get(name);
            if (declaration) add(kind, declaration);
        }
    }
    if (file === 'lib/patient-cascade.ts' && declarations.get('PATIENT_CHILD_TABLES')) add('purge-table-binding', declarations.get('PATIENT_CHILD_TABLES'));
    const visit = (node) => {
        if (ts.isTaggedTemplateExpression(node)) {
            const sql = sqlText(node, declarations);
            const match = sql?.match(/\b(insert\s+into|update|delete\s+from)\s+["'`]?attachments\b/iu);
            if (match) add(`raw-${match[1].toLowerCase().replace(/\s+/gu, '-')}`, node);
        }
        if (ts.isCallExpression(node)) {
            const firstArgument = node.arguments[0];
            const raw = firstArgument && ts.isTaggedTemplateExpression(firstArgument) ? undefined : sqlText(firstArgument, declarations);
            const rawMatch = raw?.match(/\b(insert\s+into|update|delete\s+from)\s+["'`]?attachments\b/iu);
            if (rawMatch) add(`raw-${rawMatch[1].toLowerCase().replace(/\s+/gu, '-')}`, node);
            const method = property(node.expression, declarations);
            const receiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression) ? node.expression.expression : undefined;
            if (['add', 'put', 'update', 'delete', 'clear', 'bulkAdd', 'bulkPut'].includes(method ?? '') && resolvesAttachment(receiver, declarations)) add(`facade-${method}`, node);
            if (['insert', 'update', 'delete'].includes(method ?? '')) {
                const argument = node.arguments[0];
                if (resolvesAttachment(argument, declarations)) add(`orm-${method}`, node);
                else {
                    const shape = argument ? text(argument, sourceFile) : '';
                    if (file === 'lib/backup-restore-executor.ts' && (shape === 'table' || shape.startsWith('TABLE_LOOKUP['))) add(`restore-${method}`, node);
                    if (file === 'lib/patient-cascade.ts' && shape === 'child.table') add(`purge-${method}`, node);
                }
            }
            if (ts.isElementAccessExpression(node.expression) && method === undefined && resolvesAttachment(receiver, declarations)) add('dynamic-method', node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

function group(records) {
    const grouped = new Map();
    for (const record of records) {
        const key = `${record.path}\0${record.kind}\0${record.fingerprint}`;
        grouped.set(key, { ...record, count: (grouped.get(key)?.count ?? 0) + 1 });
    }
    return [...grouped.values()].sort((a, b) => `${a.path}:${a.kind}:${a.fingerprint}`.localeCompare(`${b.path}:${b.kind}:${b.fingerprint}`));
}

export function compareInventory(actual, contract = CONTRACT) {
    const findings = [];
    const expected = new Map();
    for (const record of contract) {
        const key = `${record.path}\0${record.kind}\0${record.fingerprint}`;
        if (expected.has(key)) findings.push({ code: 'DUPLICATE_CONTRACT', path: record.path, kind: record.kind });
        expected.set(key, record);
    }
    const observed = new Map(actual.map((record) => [`${record.path}\0${record.kind}\0${record.fingerprint}`, record]));
    for (const [key, record] of expected) {
        const seen = observed.get(key);
        if (!seen) findings.push({ code: 'MISSING_OR_DRIFTED_WRITER', path: record.path, kind: record.kind, fingerprint: record.fingerprint });
        else if (seen.count !== record.count) findings.push({ code: 'WRITER_COUNT_DRIFT', path: record.path, kind: record.kind, expected: record.count, actual: seen.count });
        else if (record.disposition === 'finding') findings.push({ code: record.code, path: record.path, kind: record.kind, fingerprint: record.fingerprint, count: record.count });
    }
    for (const [key, record] of observed) if (!expected.has(key)) findings.push({ code: 'UNDECLARED_WRITER', ...record });
    return findings;
}

export function inventory() {
    const records = ROOTS.flatMap((dir) => collect(dir).flatMap((file) => analyzeSource(file, fs.readFileSync(path.join(ROOT, file), 'utf8'))));
    return group(records);
}

function hasProof(file, pattern, callOnly = false) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const sourceFile = parse(file, source);
    let matched = false;
    const visit = (node) => {
        if (callOnly && ts.isCallExpression(node)) {
            const expression = node.expression;
            const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
            if (pattern.test(name)) matched = true;
        } else if (!callOnly && ((ts.isIdentifier(node) && pattern.test(node.text)) || (ts.isStringLiteralLike(node) && pattern.test(node.text)))) matched = true;
        if (!matched) ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return matched;
}

export function policyFindings() {
    const checks = [
        ['BACKUP_LEGACY_CURRENTNESS_GAP', 'lib/backup-artifact.ts', /BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED/u, false],
        ['RESTORE_PREFLIGHT_CURRENTNESS_GAP', 'lib/backup-restore-preflight.ts', /BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED/u, false],
        ['PURGE_LOCATOR_REVOCATION_GAP', 'lib/patient-cascade.ts', /revoke\w*Attachment\w*Locator/iu, true],
        ['RESTORE_LOCATOR_REVOCATION_GAP', 'lib/backup-restore-executor.ts', /revoke\w*Attachment\w*Locator/iu, true],
    ];
    return checks.filter(([, file, proof, callOnly]) => !hasProof(file, proof, callOnly)).map(([code, file]) => ({ code, path: file }));
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    const actual = inventory();
    if (process.argv.includes('--inventory')) process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    else {
        const findings = [...compareInventory(actual), ...policyFindings()];
        const classified = actual.map((item) => ({ ...item, disposition: CONTRACT.find((entry) => entry.path === item.path && entry.kind === item.kind && entry.fingerprint === item.fingerprint)?.disposition ?? 'undeclared' }));
        process.stdout.write(`${JSON.stringify({ status: findings.length ? 'fail' : 'pass', inventory: classified, findings }, null, 2)}\n`);
        if (findings.length) process.exitCode = 1;
    }
}
