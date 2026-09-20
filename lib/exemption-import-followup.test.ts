/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { EXEMPTION_COLUMNS } from './exemption-import-contract';
import { createEmptyDataset, parseBackupArtifact, serializeBackupArtifact, stableStringify } from './backup-artifact';
import { assertExemptionImportReceiptRows } from './exemption-import-receipt';
import { commitExemptionImport, previewExemptionImport, readExemptionImportStatus, ExemptionImportError } from './exemption-catalog-import';
import { readExemptionImportRequest } from './exemption-import-http';
import { syntheticExemptionSession } from '../scripts/fixtures/exemption-import-session';
import { retireForUser } from './security/web-auth-lifecycle-owner-adapter';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-exemptions-followup-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer } = await import('./db-server.ts');
const { restoreBackupArtifact } = await import('./backup-restore-executor.ts');
const backupRoute = await import('../app/api/system/backup-restore/route.ts');
const previewRoute = await import('../app/api/exemptions/import/preview/route.ts');
const commitRoute = await import('../app/api/exemptions/import/commit/route.ts');
const { serializeBackupArtifact: scheduledSerialize } = await import('../scripts/run-scheduled-backup.mjs');
const requireCurrent = createRequire(import.meta.url);
const auth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const original = auth.requireSession;
const db = dbServer.$client;
const syntheticSessions: ReturnType<typeof syntheticExemptionSession>[] = [];
function activeSession() { const session = syntheticExemptionSession(); syntheticSessions.push(session); auth.requireSession = async () => session; return session; }
after(() => { auth.requireSession = original; for (const session of syntheticSessions) retireForUser(session); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function source(code: string) {
    return { sourceName: 'inventato-raccordo.txt', bytes: Buffer.from([EXEMPTION_COLUMNS.join('|'), [code, 'Descrizione inventata raccordo', '\\N', '\\N', '\\N', 'S', 'N', '\\N'].join('|')].join('\r\n') + '\r\n') };
}
function importOne(code: string) {
    const value = source(code);
    const preview = previewExemptionImport(db, value.bytes, value.sourceName, 'synthetic-backup');
    return commitExemptionImport(db, { ...value, proof: preview.proof!, acceptSubset: true }, 'synthetic-backup');
}
function receiptRows() {
    return db.prepare('SELECT id, operation_key AS operationKey, receipt_json AS receiptJson FROM exemption_import_receipts ORDER BY id').all();
}
function snapshot() {
    return { catalog: db.prepare('SELECT * FROM exemptions ORDER BY code').all(), receipts: receiptRows() };
}
function rehash(artifact: { manifest: { checksum: string }; payload: unknown }) {
    artifact.manifest.checksum = createHash('sha256').update(stableStringify(artifact.payload)).digest('hex');
}

test('web and scheduled JSON receipt export round-trip preserves ids, bytes, revision and source provenance', async () => {
    activeSession();
    importOne('ZZ_BACKUP_A'); importOne('ZZ_BACKUP_B');
    const before = snapshot(), status = readExemptionImportStatus(db);
    const exported = await backupRoute.GET();
    assert.equal(exported.status, 200);
    const parsed = await parseBackupArtifact(await exported.json());
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.payload.exemptionImportReceipts, before.receipts);
    const scheduled = await parseBackupArtifact(JSON.parse(await scheduledSerialize(parsed.payload)));
    assert.deepEqual(scheduled.payload.exemptionImportReceipts, before.receipts);
    const empty = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(createEmptyDataset())));
    restoreBackupArtifact(empty, () => true);
    assert.deepEqual(receiptRows(), []);
    restoreBackupArtifact(parsed, () => true);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(readExemptionImportStatus(db), status);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('historical v1 backup without receipt collection validates original checksum and clears old receipts', async () => {
    activeSession();
    const historical = await (await backupRoute.GET()).json();
    delete historical.payload.exemptionImportReceipts;
    delete historical.manifest.recordCounts.exemptionImportReceipts;
    historical.manifest.collections = historical.manifest.collections.filter((c: string) => c !== 'exemptionImportReceipts');
    await assert.rejects(parseBackupArtifact(historical), /checksum/u);
    rehash(historical);
    const parsed = await parseBackupArtifact(historical);
    assert.deepEqual(parsed.payload.exemptionImportReceipts, []);
    const previousCatalog = snapshot().catalog;
    assert.ok(receiptRows().length > 0);
    restoreBackupArtifact(parsed, () => true);
    assert.deepEqual(snapshot().catalog, previousCatalog);
    assert.deepEqual(receiptRows(), []);
    assert.equal(readExemptionImportStatus(db).latestReceipt, null);
});

test('unsupported receipt schema, inconsistent counters and duplicate keys reject before restore mutation', async () => {
    activeSession(); importOne('ZZ_VALIDATION');
    const exported = await (await backupRoute.GET()).json();
    const before = snapshot();
    for (const change of [
        (r: Record<string, unknown>) => { (r.manifest as Record<string, unknown>).schemaVersion = 2; },
        (r: Record<string, unknown>) => { r.applied = 99; },
        (r: Record<string, unknown>) => { r.operationKey = '0'.repeat(64); },
        (r: Record<string, unknown>) => { r.committedAt = '2026-02-30T12:00:00.000Z'; },
    ]) {
        const value = structuredClone(exported);
        const receipt = JSON.parse(value.payload.exemptionImportReceipts[0].receiptJson);
        change(receipt); value.payload.exemptionImportReceipts[0].receiptJson = JSON.stringify(receipt);
        rehash(value);
        await assert.rejects(parseBackupArtifact(value), /receipts are invalid/u);
        assert.throws(() => restoreBackupArtifact(value, () => true), /RECEIPT_INVALID/u);
        await assert.rejects(scheduledSerialize(value.payload), /RECEIPT_INVALID/u);
        assert.deepEqual(snapshot(), before);
    }
    const rows = receiptRows();
    assert.throws(() => assertExemptionImportReceiptRows([...rows, rows[0]]), /RECEIPT_INVALID/u);
});

function pendingRequest(value: unknown, signal?: AbortSignal) {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { cancelled = true; } });
    const request = new Request('http://localhost/api/exemptions/import/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, signal, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    return { request, cancelled: () => cancelled, finish() { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } };
}

test('canonical JSON reader cancels an ordinary unfinished upload on deadline and request abort', async () => {
    const delayed = pendingRequest({});
    const started = performance.now();
    await assert.rejects(readExemptionImportRequest(delayed.request, false, undefined, 20), (e) => e instanceof ExemptionImportError && e.status === 408);
    assert.ok(performance.now() - started < 2000);
    assert.equal(delayed.cancelled(), true);
    const abort = new AbortController(), request = pendingRequest({}, abort.signal);
    const reading = readExemptionImportRequest(request.request, false);
    abort.abort();
    await assert.rejects(reading, (e) => e instanceof ExemptionImportError && e.code === 'IMPORT_BODY_ABORTED');
    assert.equal(request.cancelled(), true);
});

test('retiring the real web owner during body await cancels preview/commit and leaves catalog unchanged', async () => {
    for (const [post, committing] of [[previewRoute.POST, false], [commitRoute.POST, true]] as const) {
        const session = activeSession(), value = source('ZZ_LATE');
        const preview = previewExemptionImport(db, value.bytes, value.sourceName, session.userId);
        const body = { sourceName: value.sourceName, base64: value.bytes.toString('base64'), ...(committing ? { proof: preview.proof, acceptSubset: true } : {}) };
        const delayed = pendingRequest(body);
        const before = snapshot();
        const running = post(delayed.request);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(retireForUser(session).outcome, 'completed');
        const response = await running;
        assert.equal(response.status, 401);
        assert.equal(delayed.cancelled(), true);
        assert.deepEqual(snapshot(), before);
        assert.doesNotMatch(await response.text(), /proof|sourceSha256/u);
    }
});

test('completed body after a session retirement cannot publish a preview even if auth returned an old projection', async () => {
    const session = activeSession(), value = source('ZZ_STALE');
    retireForUser(session);
    // Ordinary stale request: admission fixture still returns the old projection; owner must deny it.
    const request = new Request('http://localhost/api/exemptions/import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceName: value.sourceName, base64: value.bytes.toString('base64') }) });
    const before = snapshot();
    const response = await previewRoute.POST(request);
    assert.equal(response.status, 401);
    assert.equal(request.bodyUsed, false);
    assert.deepEqual(snapshot(), before);
});

test('writer rechecks authority under the transaction and rolls back if its final currentness check denies', () => {
    const value = source('ZZ_FENCE'), preview = previewExemptionImport(db, value.bytes, value.sourceName, 'synthetic-backup');
    const before = snapshot();
    let checks = 0;
    assert.throws(() => commitExemptionImport(db, { ...value, proof: preview.proof!, acceptSubset: true }, 'synthetic-backup', () => {
        checks++;
        if (checks === 2) throw new ExemptionImportError('EXEMPTION_IMPORT_AUTHORITY_REVOKED', 'Sessione non più attiva.', 401);
    }), /Sessione non più attiva/u);
    assert.equal(checks, 2);
    assert.deepEqual(snapshot(), before);
});


test('scheduled export from a historical SQLite without the receipt table produces an explicit empty collection', async () => {
    const historic = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-exemptions-historical-synthetic-'));
    try {
        const legacy = new Database(path.join(historic, 'medical.db'));
        legacy.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE exemptions (code TEXT PRIMARY KEY, description TEXT); INSERT INTO exemptions VALUES ('ZZ_HISTORIC', 'Esenzione inventata storica');");
        assert.equal(legacy.prepare("SELECT 1 FROM sqlite_master WHERE name = 'exemption_import_receipts'").get(), undefined);
        legacy.close();
        const output = execFileSync(process.execPath, ['scripts/run-scheduled-backup.mjs'], {
            cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
            env: { ...process.env, MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_DATA_DIR: historic, MEDIFLOW_BACKUP_DEST_DIR: path.join(historic, 'backups') },
        });
        const run = JSON.parse(output);
        const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(run.artifactPath, 'utf8')));
        assert.deepEqual(artifact.payload.exemptionImportReceipts, []);
        assert.equal(artifact.payload.exemptions[0].code, 'ZZ_HISTORIC');
    } finally { fs.rmSync(historic, { recursive: true, force: true }); }
});
