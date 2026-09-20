/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { EXEMPTION_COLUMNS, EXEMPTION_MAX_BYTES } from './exemption-import-contract';
import { ensureExemptionImportSchema } from './exemption-catalog-schema';
import { parseExemptionImport } from './exemption-import-parser';
import { commitExemptionImport, ExemptionImportError, previewExemptionImport, readExemptionImportStatus } from './exemption-catalog-import';
import { readExemptionImportRequest } from './exemption-import-http';

const sourceName = 'catalogo-interamente-inventato.txt';
const actor = 'synthetic-operator';
const row = (code = 'ZZ_SYN_1', description = 'Categoria inventata per test') => [code, description, '\\N', '20240229', '\\N', 'S', 'N', '\\N'];
function fixture(rows = [row()], header: readonly string[] = EXEMPTION_COLUMNS, trailing = true) {
    return Buffer.from([header, ...rows].map((cells) => cells.join('|') + (trailing ? '|' : '')).join('\r\n') + '\r\n');
}
function database(filename = ':memory:') {
    const db = new Database(filename);
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE exemptions (code TEXT PRIMARY KEY NOT NULL, description TEXT NOT NULL, type TEXT,
        source TEXT, start_date INTEGER, end_date INTEGER, is_pharma INTEGER, is_specialist INTEGER,
        is_national INTEGER, updated_at INTEGER DEFAULT (unixepoch()));
        CREATE TABLE synthetic_assignments (id TEXT PRIMARY KEY, code TEXT REFERENCES exemptions(code), opaque TEXT);
        INSERT INTO exemptions(code, description) VALUES ('ZZ_OLD', 'Codice inventato pregresso');
        INSERT INTO synthetic_assignments VALUES ('reference-test', 'ZZ_OLD', 'invented-opaque-assignment');`);
    ensureExemptionImportSchema(db);
    return db;
}
function commit(db: Database.Database, bytes: Buffer, proof = previewExemptionImport(db, bytes, sourceName, actor).proof!) {
    return commitExemptionImport(db, { bytes, sourceName, proof, acceptSubset: true }, actor);
}
function snapshot(db: Database.Database) {
    return {
        catalog: db.prepare('SELECT * FROM exemptions ORDER BY code').all(),
        receipts: db.prepare('SELECT * FROM exemption_import_receipts').all(),
        assignments: db.prepare('SELECT * FROM synthetic_assignments').all(),
    };
}

test('strict UTF-8/BOM, CRLF, headers, width, flags, dates and null are explicit', () => {
    const valid = fixture();
    assert.equal(parseExemptionImport(valid, sourceName).valid, true);
    assert.equal(parseExemptionImport(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]), sourceName).valid, true);
    assert.equal(parseExemptionImport(fixture([row()], EXEMPTION_COLUMNS, false), sourceName).valid, true);
    const parsed = parseExemptionImport(valid, sourceName);
    assert.equal(parsed.rows[0].type, null);
    assert.equal(parsed.rows[0].isNational, null);
    assert.equal(parsed.rows[0].isPharma, true);
    assert.equal(parsed.rows[0].isSpecialist, false);
    assert.equal(parsed.rows[0].startDate, Date.UTC(2024, 1, 29) / 1000);
    assert.equal(parsed.manifest.sourceSha256, createHash('sha256').update(valid).digest('hex'));
    const invalid = [
        Buffer.concat([valid, Buffer.from([0xc3, 0x28])]),
        Buffer.from(valid.toString().replaceAll('\r\n', '\n')),
        Buffer.from(valid.toString().replace('CD_ESENZIONE', 'cd_esenzione')),
        fixture([row()], [...EXEMPTION_COLUMNS, 'UNKNOWN']),
        fixture([row()], [...EXEMPTION_COLUMNS.slice(0, -1), 'CD_ESENZIONE']),
        fixture([row().slice(0, -1)]),
        fixture([[...row(), 'extra']]),
        Buffer.from(valid.toString() + '\r\n'),
        Buffer.from(valid.toString().replace('ZZ_SYN_1', 'zz_syn_1')),
        Buffer.from(valid.toString().replace('Categoria inventata per test', '\\N')),
        Buffer.from(valid.toString().replace('Categoria inventata per test', ' test ')),
        Buffer.from(valid.toString().replace('Categoria inventata per test', 'test\u0000')),
        Buffer.from(valid.toString().replace('Categoria inventata per test', 'x'.repeat(2001))),
    ];
    for (const bytes of invalid) assert.equal(parseExemptionImport(bytes, sourceName).valid, false);
    for (const flag of ['Y', 'TRUE', '1', 's', '', ' S']) {
        const cells = row(); cells[5] = flag;
        assert.equal(parseExemptionImport(fixture([cells]), sourceName).valid, false, `flag ${flag}`);
    }
    for (const date of ['20230229', '20240230', '20241301', '20240001', '20240100', '00000101', '00990101', '2024-02-29', '']) {
        const cells = row(); cells[3] = date;
        assert.equal(parseExemptionImport(fixture([cells]), sourceName).valid, false, `date ${date}`);
    }
    const reversed = row(); reversed[4] = '20240101';
    assert.equal(parseExemptionImport(fixture([reversed]), sourceName).valid, false);
    assert.equal(parseExemptionImport(valid, '../source.txt').valid, false);
    assert.equal(parseExemptionImport(Buffer.alloc(EXEMPTION_MAX_BYTES + 1), sourceName).valid, false);
    assert.equal(parseExemptionImport(fixture(Array.from({ length: 20_001 }, () => row())), sourceName).valid, false);
});

test('excluded columns are disclosed as opaque, duplicates block every import, all rows are checked', () => {
    const parsed = parseExemptionImport(fixture([[...row(), 'VALORE_OPACO', '\\N']], [...EXEMPTION_COLUMNS, 'FL_LIMITE_GENERE', 'DT_UPDATE']), sourceName);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.manifest.excludedColumns, [{ name: 'DT_UPDATE', nonNullValues: 0 }, { name: 'FL_LIMITE_GENERE', nonNullValues: 1 }]);
    assert.equal(parseExemptionImport(fixture([row(), row()]), sourceName).manifest.duplicateRows, 1);
    assert.equal(parseExemptionImport(fixture([row(), row('ZZ_SYN_1', 'Diversa inventata')]), sourceName).valid, false);
    const invalid = parseExemptionImport(fixture(Array.from({ length: 150 }, (_, i) => { const r = row(`ZZ_${i}`); r[5] = 'Y'; return r; })), sourceName);
    assert.equal(invalid.manifest.errorCount, 150);
    assert.equal(invalid.manifest.rowCount, 150);
    assert.equal(invalid.diagnostics.length, 100);
});

test('preview is read-only, merge preserves absent codes/references and receipt rereads after reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-exemptions-synthetic-'));
    const filename = path.join(dir, 'catalog.sqlite');
    const db = database(filename);
    try {
        const before = snapshot(db);
        const bytes = fixture([row(), row('ZZ_OLD', 'Descrizione inventata aggiornata')]);
        const preview = previewExemptionImport(db, bytes, sourceName, actor);
        assert.equal(preview.valid, true);
        assert.deepEqual(snapshot(db), before);
        const invalid = previewExemptionImport(db, fixture([row(), row()]), sourceName, actor);
        assert.equal(invalid.proof, null);
        assert.deepEqual(snapshot(db), before);
        const { receipt } = commit(db, bytes, preview.proof!);
        assert.equal(receipt.applied, 2);
        assert.equal(receipt.inserted, 1);
        assert.equal(receipt.updated, 1);
        assert.equal(readExemptionImportStatus(db).revision, receipt.revision);
        assert.deepEqual(snapshot(db).assignments, before.assignments);
        assert.deepEqual(db.pragma('foreign_key_check'), []);
        db.close();
        const reopened = new Database(filename);
        try { assert.deepEqual(readExemptionImportStatus(reopened).latestReceipt, receipt); }
        finally { reopened.close(); }
    } finally { if (db.open) db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('idempotent retries return original receipt even after a later manual edit without rewriting', () => {
    const db = database();
    try {
        const bytes = fixture();
        const preview = previewExemptionImport(db, bytes, sourceName, actor);
        const first = commit(db, bytes, preview.proof!);
        assert.equal(first.replayed, false);
        assert.equal((db.prepare('SELECT count(*) count FROM exemptions').get() as { count: number }).count, 2);
        const before = snapshot(db);
        const retry = commit(db, bytes, preview.proof!);
        assert.equal(retry.replayed, true);
        assert.deepEqual(retry.receipt, first.receipt);
        assert.deepEqual(snapshot(db), before);
        db.prepare('UPDATE exemptions SET description = ? WHERE code = ?').run('Modifica manuale inventata', 'ZZ_SYN_1');
        const manual = snapshot(db);
        assert.equal(commit(db, bytes, preview.proof!).replayed, true);
        assert.deepEqual(snapshot(db), manual);
        assert.notEqual(readExemptionImportStatus(db).revision, first.receipt.revision);
    } finally { db.close(); }
});

test('concurrent previews, manual writes and deletes invalidate revision before any import writes', () => {
    const db = database();
    try {
        const a = fixture([row('ZZ_A')]), b = fixture([row('ZZ_B')]);
        const pa = previewExemptionImport(db, a, sourceName, actor), pb = previewExemptionImport(db, b, sourceName, actor);
        commit(db, a, pa.proof!);
        let before = snapshot(db);
        assert.throws(() => commit(db, b, pb.proof!), (e) => e instanceof ExemptionImportError && e.code === 'CATALOG_REVISION_CONFLICT');
        assert.deepEqual(snapshot(db), before);
        const fresh = previewExemptionImport(db, b, sourceName, actor);
        db.prepare('UPDATE exemptions SET description = ? WHERE code = ?').run('Manuale inventato', 'ZZ_A');
        before = snapshot(db);
        assert.throws(() => commit(db, b, fresh.proof!), /repertorio è cambiato/u);
        assert.deepEqual(snapshot(db), before);
        const again = previewExemptionImport(db, b, sourceName, actor);
        db.prepare('DELETE FROM exemptions WHERE code = ?').run('ZZ_A');
        before = snapshot(db);
        assert.throws(() => commit(db, b, again.proof!), /repertorio è cambiato/u);
        assert.deepEqual(snapshot(db), before);
    } finally { db.close(); }
});

test('failure midway and receipt failure both roll back the entire catalog transaction', () => {
    for (const target of ['row', 'receipt']) {
        const db = database();
        try {
            db.exec(target === 'row'
                ? `CREATE TRIGGER fail_test BEFORE INSERT ON exemptions WHEN NEW.code = 'ZZ_FAIL' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`
                : `CREATE TRIGGER fail_test BEFORE INSERT ON exemption_import_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;`);
            const before = snapshot(db);
            assert.throws(() => commit(db, fixture([row('ZZ_OLD', 'Inventata nuova'), row('ZZ_OK'), row('ZZ_FAIL')])));
            assert.deepEqual(snapshot(db), before);
            assert.deepEqual(db.pragma('foreign_key_check'), []);
        } finally { db.close(); }
    }
});

test('commit binds source bytes, source name, operator and explicit subset consent', () => {
    const db = database();
    try {
        const bytes = fixture();
        const p = previewExemptionImport(db, bytes, sourceName, actor);
        const input = { bytes, sourceName, proof: p.proof!, acceptSubset: true };
        const before = snapshot(db);
        for (const changed of [
            { ...input, bytes: fixture([row('ZZ_OTHER')]) },
            { ...input, sourceName: 'altro-sintetico.txt' },
            { ...input, proof: input.proof.slice(0, -10) },
            { ...input, acceptSubset: false },
            { ...input, bytes: fixture([row(), row()]) },
        ]) assert.throws(() => commitExemptionImport(db, changed, actor));
        assert.throws(() => commitExemptionImport(db, input, 'different-synthetic-operator'));
        assert.deepEqual(snapshot(db), before);
    } finally { db.close(); }
});

test('HTTP reader bounds actual streamed bytes and rejects malformed encoding/envelopes', async () => {
    const body = { sourceName, base64: fixture().toString('base64') };
    const req = (value: unknown) => new Request('http://localhost/api/exemptions/import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.deepEqual((await readExemptionImportRequest(req(body), false)).bytes, fixture());
    for (const invalid of [{ ...body, base64: '!!!!' }, { ...body, extra: 1 }, [], null, { ...body, base64: 'Zh==' }]) {
        await assert.rejects(readExemptionImportRequest(req(invalid), false));
    }
    await assert.rejects(readExemptionImportRequest(req({ ...body, base64: 'a'.repeat(3_000_000) }), false), (e) => e instanceof ExemptionImportError && e.status === 413);
    await assert.rejects(readExemptionImportRequest(new Request('http://localhost', { method: 'POST', body: 'plain' }), false));
});

test('receipt schema migration and guard agree and reject unsupported existing shapes', () => {
    const db = new Database(':memory:');
    try {
        db.exec(fs.readFileSync(path.join(process.cwd(), 'drizzle/0033_exemption_import_receipts.sql'), 'utf8'));
        ensureExemptionImportSchema(db);
        ensureExemptionImportSchema(db);
        db.exec('ALTER TABLE exemption_import_receipts ADD COLUMN unknown TEXT');
        assert.throws(() => ensureExemptionImportSchema(db), /SCHEMA_UNSUPPORTED/u);
    } finally { db.close(); }
});

test('expired preview and missing unique-key schema fail closed', (t) => {
    const db = database();
    try {
        const bytes = fixture();
        const preview = previewExemptionImport(db, bytes, sourceName, actor);
        const before = snapshot(db);
        const future = Date.now() + 31 * 60_000;
        t.mock.method(Date, 'now', () => future);
        assert.throws(() => commit(db, bytes, preview.proof!), /Anteprima scaduta/u);
        assert.deepEqual(snapshot(db), before);
    } finally { db.close(); }
    const unsupported = new Database(':memory:');
    try {
        unsupported.exec('CREATE TABLE exemption_import_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, operation_key TEXT NOT NULL, receipt_json TEXT NOT NULL)');
        assert.throws(() => ensureExemptionImportSchema(unsupported), /SCHEMA_UNSUPPORTED/u);
    } finally { unsupported.close(); }
});
