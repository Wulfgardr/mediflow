/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import { PROSTHETICS_COLUMNS, PROSTHETICS_MAX_BYTES, PROSTHETICS_TEMPLATE, prostheticsSelection } from './prosthetics-catalog-contract';
import { parseProstheticsCsv } from './prosthetics-catalog-parser';
import { ensureProstheticsCatalogSchema, PROSTHETICS_CATALOG_SQL } from './prosthetics-catalog-schema';
import { createProstheticsCatalog } from './prosthetics-catalog-service';
import { assertProstheticsCatalogBackup } from './prosthetics-catalog-backup';

const name = 'repertorio-inventato.csv';
const row = (code = 'DEMO-001', description = 'Ausilio inventato') => ['Codifica inventata', code, description, 'versione-test-1', 'Fonte inventata', 'Solo test', '2024-02-29', ''];
function csv(rows = [row()]) { return Buffer.from(`${PROSTHETICS_COLUMNS.join(',')}\r\n${rows.map(cells => cells.map(cell => /[,"\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(',')).join('\r\n')}\r\n`); }
const current = () => {};
function fixture() { const db = new Database(':memory:'); ensureProstheticsCatalogSchema(db); return { db, service: createProstheticsCatalog(db) }; }
function importFile(service: ReturnType<typeof createProstheticsCatalog>, bytes = csv()) { const preview = service.preview(bytes, name, 'synthetic'); assert.ok(preview.proof); return service.commit({ bytes, sourceName: name, proof: preview.proof, acceptSubset: true }, 'synthetic', current); }
function snapshot(db: Database.Database) { return { entries: db.prepare('SELECT * FROM prosthetics_catalog_entries ORDER BY id').all(), receipts: db.prepare('SELECT * FROM prosthetics_catalog_receipts ORDER BY id').all() }; }
function backupRows(db: Database.Database) {
    return { entries: createProstheticsCatalog(db).search('').entries,
        receipts: db.prepare('SELECT id, operation_key AS operationKey, receipt_json AS receiptJson FROM prosthetics_catalog_receipts ORDER BY id').all() };
}

test('template, literal namespace, quoted commas/quotes, BOM, LF, provenance hash and optional dates', () => {
    assert.equal(parseProstheticsCsv(Buffer.from(PROSTHETICS_TEMPLATE), name).valid, true);
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv([row('ABC / 1', 'Ausilio, detto "inventato"')])]);
    const result = parseProstheticsCsv(bytes, name);
    assert.equal(result.valid, true); assert.equal(result.rows[0].code, 'ABC / 1');
    assert.equal(result.rows[0].description, 'Ausilio, detto "inventato"');
    assert.equal(result.manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(parseProstheticsCsv(Buffer.from(bytes.toString().replaceAll('\r\n', '\n')), name).valid, true);
    assert.equal(result.rows[0].endDate, null);
});

test('exact schema: header, encoding, quoting, controls, unknown columns and cell bounds fail closed', () => {
    const text = csv().toString();
    for (const bad of [Buffer.from([0xff]), Buffer.from(text.replace('codice_sistema', 'iso')), Buffer.from(text.replaceAll(',', ';')),
        Buffer.from(text.replace('descrizione,', 'descrizione,extra,')), Buffer.from(text.replace('Ausilio inventato', '"unfinished')),
        Buffer.from(text.replace('Ausilio inventato', '"closed"x')), Buffer.from(text.replace('Ausilio inventato', 'not"quoted')),
        csv([row('DEMO', 'line\nbreak')]), csv([row('DEMO', 'text\u0000')]), csv([row(' DEMO')]),
        csv([row('X'.repeat(201))]), csv([row('DEMO', 'X'.repeat(2001))]), Buffer.from(text + '\n')]) {
        assert.equal(parseProstheticsCsv(bad, name).valid, false);
    }
    assert.equal(parseProstheticsCsv(csv(), '../file.csv').valid, false);
    assert.equal(parseProstheticsCsv(Buffer.alloc(PROSTHETICS_MAX_BYTES + 1), name).valid, false);
    assert.equal(parseProstheticsCsv(Buffer.from(PROSTHETICS_COLUMNS.join(',')), name).valid, false);
    const tooMany = Buffer.from(PROSTHETICS_COLUMNS.join(',') + '\n' + 'x,x,x,x,x,x,,\n'.repeat(20_001));
    assert.equal(parseProstheticsCsv(tooMany, name).valid, false);
});

test('calendar dates and uniform metadata are validated without inferring clinical meaning', () => {
    for (const date of ['2023-02-29', '2024-02-30', '0099-01-01', '20240101', '2024-13-01']) {
        const r = row(); r[6] = date; assert.equal(parseProstheticsCsv(csv([r]), name).valid, false);
    }
    const reversed = row(); reversed[7] = '2024-01-01'; assert.equal(parseProstheticsCsv(csv([reversed]), name).valid, false);
    for (const col of [0, 3, 4, 5]) { const r = row('DEMO-002'); r[col] += ' diversa'; assert.equal(parseProstheticsCsv(csv([row(), r]), name).valid, false); }
    const dates = row(); dates[6] = ''; assert.equal(parseProstheticsCsv(csv([dates]), name).valid, true);
});

test('all duplicate rows count as invalid, diagnostics retain physical row and are bounded', () => {
    const result = parseProstheticsCsv(csv([row(), row(), row('DEMO-002')]), name);
    assert.equal(result.valid, false); assert.deepEqual(result.manifest.counts, { total: 3, valid: 1, invalid: 2, duplicates: 2, errors: 2 });
    assert.deepEqual(result.diagnostics.map(d => d.row), [2, 3]);
    const many = parseProstheticsCsv(csv(Array.from({ length: 400 }, () => row())), name);
    assert.equal(many.diagnostics.length, 200); assert.equal(many.diagnosticsTruncated, true); assert.equal(many.manifest.counts.duplicates, 400);
});

test('preview writes nothing; atomic merge and unchanged counts preserve absent codes and row provenance', () => {
    const { db, service } = fixture();
    try {
        const before = snapshot(db), preview = service.preview(csv(), name, 'synthetic');
        assert.deepEqual(snapshot(db), before); assert.deepEqual(preview.changes, { inserted: 1, updated: 0, unchanged: 0 });
        importFile(service); const first = service.status(); assert.equal(first.count, 1);
        const bytes = csv([row('DEMO-002'), row('DEMO-001', 'Descrizione aggiornata inventata')]);
        assert.deepEqual(service.preview(bytes, name, 'synthetic').changes, { inserted: 1, updated: 1, unchanged: 0 });
        importFile(service, bytes); assert.equal(service.status().count, 2);
        assert.deepEqual(service.preview(csv([row('DEMO-002')]), name, 'synthetic').changes, { inserted: 0, updated: 0, unchanged: 1 });
        importFile(service, csv([row('DEMO-002')])); assert.equal(service.status().count, 2);
        const backup = backupRows(db); assertProstheticsCatalogBackup(backup.entries, backup.receipts);
    } finally { db.close(); }
});

test('explicit acceptance, actor/proof binding, CAS and replay keep failed requests from mutating', () => {
    const { db, service } = fixture();
    try {
        const bytes = csv(), p = service.preview(bytes, name, 'synthetic');
        const input = { bytes, sourceName: name, proof: p.proof!, acceptSubset: true };
        assert.throws(() => service.commit({ ...input, acceptSubset: false }, 'synthetic', current), /Conferma/u);
        assert.throws(() => service.commit(input, 'other-synthetic', current), /Anteprima/u);
        assert.throws(() => service.commit({ ...input, bytes: csv([row('changed')]) }, 'synthetic', current), /Anteprima/u);
        assert.throws(() => service.commit({ ...input, proof: 'not-a-proof' }, 'synthetic', current), /Anteprima/u);
        const result = service.commit(input, 'synthetic', current), after = snapshot(db);
        assert.deepEqual(service.commit(input, 'synthetic', current), { receipt: result.receipt, replayed: true });
        assert.deepEqual(snapshot(db), after);
        const stale = service.preview(csv([row('stale')]), name, 'synthetic');
        importFile(service, csv([row('another')])); const changed = snapshot(db);
        assert.throws(() => service.commit({ bytes: csv([row('stale')]), sourceName: name, proof: stale.proof!, acceptSubset: true }, 'synthetic', current), /cambiato/u);
        assert.deepEqual(snapshot(db), changed);
    } finally { db.close(); }
});

test('middle-row failure and final authority revocation roll back rows and receipt together', () => {
    const { db, service } = fixture();
    try {
        importFile(service); const before = snapshot(db), bytes = csv([row('first'), row('second')]);
        const p = service.preview(bytes, name, 'synthetic'), input = { bytes, sourceName: name, proof: p.proof!, acceptSubset: true };
        db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON prosthetics_catalog_entries WHEN NEW.code = 'second' BEGIN SELECT RAISE(ABORT, 'synthetic middle failure'); END;");
        assert.throws(() => service.commit(input, 'synthetic', current), /synthetic middle failure/u); assert.deepEqual(snapshot(db), before);
        db.exec('DROP TRIGGER synthetic_failure');
        let calls = 0;
        assert.throws(() => service.commit(input, 'synthetic', () => { if (++calls === 3) throw new Error('synthetic revoked'); }), /synthetic revoked/u);
        assert.deepEqual(snapshot(db), before); assert.equal(service.commit(input, 'synthetic', current).replayed, false);
    } finally { db.close(); }
});

test('reload from SQLite preserves catalog/revision/receipt; schema SQL is aligned and rejects unknown shape', () => {
    assert.ok(process.env.MEDIFLOW_DATA_DIR);
    const file = path.join(process.env.MEDIFLOW_DATA_DIR!, 'prosthetics-reload-synthetic.sqlite');
    let db = new Database(file);
    try {
        ensureProstheticsCatalogSchema(db); const service = createProstheticsCatalog(db); importFile(service);
        const status = service.status(); db.close(); db = new Database(file); ensureProstheticsCatalogSchema(db);
        assert.deepEqual(createProstheticsCatalog(db).status(), status);
        assert.equal(fs.readFileSync('drizzle/0034_prosthetics_catalog.sql', 'utf8').trim(), `/* @Codex */\n${PROSTHETICS_CATALOG_SQL}\n`.trim());
        db.exec('ALTER TABLE prosthetics_catalog_entries ADD COLUMN unsupported TEXT');
        assert.throws(() => ensureProstheticsCatalogSchema(db), /SCHEMA_UNSUPPORTED/u);
    } finally { db.close(); fs.rmSync(file, { force: true }); }
});

test('backup rejects missing/altered provenance, invalid dates, duplicate identities and operation key drift', () => {
    const { db, service } = fixture();
    try {
        importFile(service); const data = backupRows(db);
        assert.throws(() => assertProstheticsCatalogBackup(data.entries, []), /BACKUP_INVALID/u);
        for (const mutate of [
            (v: typeof data) => { v.entries[0].startDate = '2024-02-30'; },
            (v: typeof data) => { v.entries[0].sourceSha256 = '0'.repeat(64); },
            (v: typeof data) => { v.entries[0].code = 'changed'; },
            (v: typeof data) => { v.entries.push(v.entries[0]); },
            (v: typeof data) => { const r = v.receipts[0] as { receiptJson: string }; const j = JSON.parse(r.receiptJson); j.manifest.metadata.source = 'Changed invented source'; r.receiptJson = JSON.stringify(j); },
        ]) { const value = structuredClone(data); mutate(value); assert.throws(() => assertProstheticsCatalogBackup(value.entries, value.receipts), /BACKUP_INVALID/u); }
    } finally { db.close(); }
});

test('search is bounded and literal; selection retains namespace and only explicitly allowed view data', () => {
    const { db, service } = fixture();
    try {
        importFile(service, csv(Array.from({ length: 60 }, (_, i) => row(`DEMO-${i}`))));
        assert.equal(service.search('').entries.length, 50); assert.equal(service.search('').truncated, true);
        assert.equal(service.search('%').entries.length, 0); assert.throws(() => service.search('x'.repeat(201)), /200/u);
        const entry = service.search('DEMO-1').entries[0], selected = prostheticsSelection(entry);
        assert.deepEqual(Object.keys(selected).sort(), ['code', 'codeSystem', 'description', 'source', 'version']);
        assert.equal(Object.hasOwn(selected, 'isoCode'), false); assert.equal(Object.hasOwn(selected, 'operationKey'), false);
    } finally { db.close(); }
});
