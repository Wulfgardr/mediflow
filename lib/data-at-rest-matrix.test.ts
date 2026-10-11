import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { encryptData, generateMasterKey } from './security/security';
import { prepareFhirBundleFromRecords } from './fhir/export-precheck';

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

test('sentinels follow real SQLite, scheduled backup and FHIR artifacts after success, failure and cancellation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-at-rest-sentinel-'));
    const dataDir = path.join(directory, 'data'), temporary = path.join(directory, 'tmp');
    fs.mkdirSync(dataDir, { mode: 0o700 }); fs.mkdirSync(temporary, { mode: 0o700 });
    const clear = 'SYNTHETIC_C06_IDENTIFIER', sealed = 'SYNTHETIC_C06_ADDRESS';
    const { iv, data } = await encryptData(sealed, await generateMasterKey());
    const env = { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DATA_DIR: dataDir,
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: '', TMPDIR: temporary };
    let db: Database.Database | undefined;
    try {
        execFileSync(process.execPath, ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval',
            `(await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/db-server.ts')).href)})).openDbServer();`],
        { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
        db = new Database(path.join(dataDir, 'medical.db'));
        db.pragma('journal_mode = WAL');
        db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,address) VALUES (?,?,?,?,?)')
            .run('c06-synthetic-patient', clear, 'Synthetic', clear, `ENC:${iv}:${data}`);
        const output = path.join(directory, 'backups');
        const configure = (destinationDir: string) => {
            env.MEDIFLOW_BACKUP_DEST_DIR = destinationDir;
            db!.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
                .run('backupScheduler', JSON.stringify({ version: 1, config: { enabled: true, destinationDir } }));
        };
        const backup = () => {
            const result = execFileSync(process.execPath, ['scripts/run-scheduled-backup.mjs'],
                { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            fs.appendFileSync(path.join(directory, 'operations.log'), result, { mode: 0o600 });
            return JSON.parse(result) as { ok: boolean; artifactPath?: string };
        };
        const files = (root: string): string[] => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
            const child = path.join(root, entry.name);
            return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : [];
        });
        const inspected = new Set<string>();
        const inspect = (exported = false) => {
            const observed = files(directory);
            for (const file of observed) {
                const bytes = fs.readFileSync(file);
                const relative = path.relative(directory, file);
                inspected.add(relative);
                assert.equal(bytes.includes(Buffer.from(sealed)), exported && relative === 'export.json', relative);
                if (relative === 'operations.log' || relative.startsWith(`tmp${path.sep}`)) assert.equal(bytes.includes(Buffer.from(clear)), false, relative);
            }
            assert.ok(observed.some(file => fs.readFileSync(file).includes(Buffer.from(clear))), 'the declared clear identifier remains observable');
        };
        configure(output);
        inspect();
        assert.ok(inspected.has(path.join('data', 'medical.db-wal')), 'the live WAL is actually inspected before its possible retirement');
        const created = backup();
        assert.equal(created.ok, true); assert.ok(created.artifactPath);
        assert.ok(fs.readFileSync(created.artifactPath).includes(Buffer.from(clear)));
        inspect();

        // A real destination error must not print or persist the record contents.
        const blocked = path.join(directory, 'not-a-directory'); fs.writeFileSync(blocked, 'synthetic'); configure(blocked);
        assert.throws(backup, error => {
            const failure = error as Error & { stdout: string; stderr: string; status: number };
            assert.equal(failure.status, 1);
            assert.match(JSON.parse(failure.stdout).message, /EEXIST|ENOTDIR/u);
            fs.appendFileSync(path.join(directory, 'operations.log'), `${failure.stdout || ''}${failure.stderr || ''}`);
            return true;
        });
        inspect();

        const input = { patient: { id: 'c06-synthetic-patient', firstName: clear, lastName: 'Synthetic', taxCode: clear, address: sealed,
            diagnoses: [{ id: 'c06-diagnosis', code: 'synthetic', description: 'Synthetic', system: 'UNKNOWN', date: '2026-10-11' }] },
        entries: [], therapies: [], checkups: [], observations: [], generatedAt: '2026-10-11T00:00:00Z' };
        assert.equal(await prepareFhirBundleFromRecords(input, () => false), null);
        assert.equal(fs.existsSync(path.join(directory, 'export.json')), false);
        inspect();
        const exported = await prepareFhirBundleFromRecords(input, () => true);
        fs.writeFileSync(path.join(directory, 'export.json'), JSON.stringify(exported), { mode: 0o600 });
        inspect(true); // The explicitly requested FHIR export is clear, unlike the stored address.
    } finally {
        db?.close(); fs.rmSync(directory, { recursive: true, force: true });
    }
});
