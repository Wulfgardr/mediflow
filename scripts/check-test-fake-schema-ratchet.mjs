#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATCHET_PATH = path.join(ROOT_DIR, 'scripts', 'check-test-fake-schema-ratchet.json');
const TEST_ROOTS = ['app', 'components', 'lib', 'packages', 'scripts'];
const TEST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'artifacts', 'target']);

export const FAKE_SCHEMA_GUIDANCE =
    'Hand-written CREATE TABLE for production tables in tests drifts from lib/schema.ts. '
    + 'Bootstrap a real SQLite database with initializeSqliteSchema(sqlite) from lib/sqlite-schema.ts instead. '
    + 'Only historical-schema migration or repair tests belong in scripts/check-test-fake-schema-ratchet.json.';

export function extractProductionTables(root) {
    const schemaPath = path.join(root, 'lib', 'schema.ts');
    const source = fs.readFileSync(schemaPath, 'utf8');
    const ast = ts.createSourceFile(schemaPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const tables = new Set();
    function visit(node) {
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'sqliteTable'
            && node.arguments[0]
            && ts.isStringLiteral(node.arguments[0])
        ) {
            tables.add(node.arguments[0].text.toLowerCase());
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return tables;
}

export function countProductionCreateTables(source, productionTables) {
    const ident = '(?:["\'`\\[](?:[A-Za-z_][A-Za-z0-9_]*)["\'`\\]]|([A-Za-z_][A-Za-z0-9_]*))';
    const target = '(?:["\'`\\[](?<quoted>[A-Za-z_][A-Za-z0-9_]*)["\'`\\]]|(?<bare>[A-Za-z_][A-Za-z0-9_]*))';
    const regex = new RegExp(
        `\\bCREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${ident}\\s*\\.\\s*)?${target}`,
        'giu',
    );
    let count = 0;
    for (const match of source.matchAll(regex)) {
        const tableName = (match.groups?.quoted || match.groups?.bare || '').toLowerCase();
        if (productionTables.has(tableName)) count += 1;
    }
    return count;
}

function collectTestFiles(root) {
    const files = [];
    function walk(relativeDir) {
        const absoluteDir = path.join(root, relativeDir);
        if (!fs.existsSync(absoluteDir)) return;
        for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const relativePath = path.posix.join(relativeDir, entry.name);
            if (entry.isDirectory()) {
                walk(relativePath);
                continue;
            }
            if (!TEST_EXTENSIONS.has(path.extname(entry.name))) continue;
            if (!/\.(?:test|spec)\./u.test(entry.name)) continue;
            if (relativePath === 'scripts/check-test-fake-schema-ratchet.test.mjs') continue;
            files.push(relativePath);
        }
    }
    for (const dir of TEST_ROOTS) walk(dir);
    return files.sort();
}

export function scanTestFakeSchemas(root, productionTables = extractProductionTables(root)) {
    const counts = {};
    for (const file of collectTestFiles(root)) {
        const count = countProductionCreateTables(fs.readFileSync(path.join(root, file), 'utf8'), productionTables);
        if (count > 0) counts[file] = count;
    }
    return counts;
}

export function compareFakeSchemaRatchet(counts, ratchet) {
    const problems = [];
    for (const [file, allowed] of Object.entries(ratchet)) {
        const found = counts[file] ?? 0;
        if (found > allowed) {
            problems.push(`${file}: ${found} production CREATE TABLE statements (ratchet allows ${allowed}). ${FAKE_SCHEMA_GUIDANCE}`);
        } else if (found < allowed) {
            problems.push(
                `${file}: ${found} production CREATE TABLE statements (ratchet lists ${allowed}). `
                + `Lower or remove ${file} in scripts/check-test-fake-schema-ratchet.json so the ratchet only shrinks.`,
            );
        }
    }
    for (const [file, found] of Object.entries(counts)) {
        if (!(file in ratchet) && found > 0) {
            problems.push(`${file}: ${found} new production CREATE TABLE statement(s) outside the ratchet. ${FAKE_SCHEMA_GUIDANCE}`);
        }
    }
    return problems;
}

function main(argv) {
    const productionTables = extractProductionTables(ROOT_DIR);
    const counts = scanTestFakeSchemas(ROOT_DIR, productionTables);
    if (argv.includes('--write-baseline')) {
        fs.writeFileSync(RATCHET_PATH, `${JSON.stringify(counts, null, 2)}\n`);
        console.log(`Wrote baseline: ${Object.values(counts).reduce((a, b) => a + b, 0)} statements in ${Object.keys(counts).length} files.`);
        return;
    }
    const ratchet = JSON.parse(fs.readFileSync(RATCHET_PATH, 'utf8'));
    const problems = compareFakeSchemaRatchet(counts, ratchet);
    if (problems.length > 0) {
        process.stderr.write(`${problems.join('\n')}\n`);
        process.exit(1);
    }
    const total = Object.values(ratchet).reduce((a, b) => a + b, 0);
    console.log(`Test fake-schema ratchet: ${total} legacy production CREATE TABLE statements across ${Object.keys(ratchet).length} files, none added.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
