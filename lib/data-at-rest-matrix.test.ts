import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = pathToFileURL(path.join(ROOT, 'scripts/register-strip-types-loader.mjs')).href;
const MATRIX = path.join(ROOT, 'docs/data-at-rest-matrix.md');

type Classification = { encrypted: string[]; otherwiseProtected: string[]; plaintext: string[] };

function schemaColumns(): Map<string, string[]> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-at-rest-matrix-'));
    try {
        const dbServerUrl = pathToFileURL(path.join(ROOT, 'lib/db-server.ts')).href;
        execFileSync(process.execPath, ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval',
            `(await import(${JSON.stringify(dbServerUrl)})).openDbServer();`],
        { cwd: ROOT, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true });
        try {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            ).all() as Array<{ name: string }>;
            return new Map(tables.map(({ name }) => [name,
                (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map((column) => column.name)]));
        } finally { db.close(); }
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}

function matrixColumns(): Map<string, Classification> {
    const section = fs.readFileSync(MATRIX, 'utf8').split('\n## ').find((part) => part.startsWith('Colonne del database'));
    assert.ok(section, 'the matrix must keep its "Colonne del database" section');
    const names = (line: string | undefined) => [...(line ?? '').matchAll(/`([a-z0-9_]+)`/gu)].map((match) => match[1]);
    const tables = new Map<string, Classification>();
    for (const block of section.split('\n### ').slice(1)) {
        const [heading, ...lines] = block.split('\n');
        const table = heading.match(/^`([a-z0-9_]+)`/u)?.[1];
        assert.ok(table, `unreadable table heading: ${heading}`);
        const list = (label: string) => names(lines.find((line) => line.startsWith(`- ${label}:`))?.slice(label.length + 3));
        tables.set(table, { encrypted: list('Cifrate'), otherwiseProtected: list('Altra protezione'), plaintext: list('In chiaro') });
    }
    return tables;
}

/* The contract is a private literal of the client module, which a Node test cannot import. */
function encryptedFieldContract(): Record<string, string[]> {
    const literal = fs.readFileSync(path.join(ROOT, 'lib/db.ts'), 'utf8')
        .match(/const ENCRYPTED_FIELDS: Record<string, string\[\]> = (\{[\s\S]*?\n\});/u)?.[1];
    assert.ok(literal, 'lib/db.ts must still declare ENCRYPTED_FIELDS as one literal');
    return JSON.parse(literal.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/'/gu, '"')
        .replace(/(\w+):\s*\[/gu, '"$1": [').replace(/,(\s*[}\]])/gu, '$1')) as Record<string, string[]>;
}

const snakeCase = (field: string) => field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

test('the at-rest matrix classifies every column of the real schema exactly once', () => {
    const schema = schemaColumns(), matrix = matrixColumns();
    assert.deepEqual([...matrix.keys()].sort(), [...schema.keys()].sort(), 'every table is classified, and only real tables');
    for (const [table, columns] of schema) {
        const { encrypted, otherwiseProtected, plaintext } = matrix.get(table)!;
        assert.deepEqual([...encrypted, ...otherwiseProtected, ...plaintext].sort(), [...columns].sort(),
            `${table}: every column appears in exactly one list`);
    }
});

test('the at-rest matrix lists as encrypted exactly the columns of the client contract', () => {
    const schema = schemaColumns(), matrix = matrixColumns(), contract = encryptedFieldContract();
    for (const table of Object.keys(contract)) assert.ok(schema.has(table), `${table} of the contract is a real table`);
    for (const [table, columns] of schema) {
        // A contract field with no column is declared in the matrix prose, not as a column.
        const expected = (contract[table] ?? []).map(snakeCase).filter((column) => columns.includes(column));
        assert.deepEqual([...matrix.get(table)!.encrypted].sort(), expected.sort(), `${table}: encrypted columns follow ENCRYPTED_FIELDS`);
    }
});
