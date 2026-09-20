/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test, { after } from 'node:test';
import { syntheticExemptionSession } from '../../scripts/fixtures/exemption-import-session';
import { retireForUser } from '../security/web-auth-lifecycle-owner-adapter';
import { PROSTHETICS_TEMPLATE } from './prosthetics-catalog-contract';
import { createProstheticsCatalog } from './prosthetics-catalog-service';
import { createEmptyDataset, parseBackupArtifact, serializeBackupArtifact, stableStringify } from '../backup-artifact';

assert.ok(process.env.MEDIFLOW_DATA_DIR, 'launcher must set synthetic directory before imports');
const directory = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'prosthetics-route-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer } = await import('../db-server.ts');
const { restoreBackupArtifact } = await import('../backup-restore-executor.ts');
const { prostheticsCatalogRequest: route } = await import('./prosthetics-catalog-http.ts');
const backupRoute = await import('../../app/api/system/backup-restore/route.ts');
const requireCurrent = createRequire(import.meta.url);
const auth = requireCurrent('../security/server-auth') as { requireSession: () => Promise<unknown> };
const original = auth.requireSession;
const sessions: ReturnType<typeof syntheticExemptionSession>[] = [];
function active() { const session = syntheticExemptionSession(); sessions.push(session); auth.requireSession = async () => session; return session; }
const db = dbServer.$client;
const service = createProstheticsCatalog(db);
const bytes = Buffer.from(PROSTHETICS_TEMPLATE.replace('Dimostrazione,,', 'Dimostrazione,2024-02-29,2027-12-31'));
const body = { sourceName: 'inventato-route.csv', base64: bytes.toString('base64') };
const request = (value: unknown, extra: RequestInit = {}) => new Request('http://localhost/api/prosthetics/catalog/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...extra });
function nonCatalog() {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('prosthetics_catalog_entries', 'prosthetics_catalog_receipts') ORDER BY name").all() as { name: string }[];
    return tables.map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
}
function snapshot() { return { entries: db.prepare('SELECT * FROM prosthetics_catalog_entries ORDER BY id').all(), receipts: db.prepare('SELECT * FROM prosthetics_catalog_receipts ORDER BY id').all() }; }
function rehash(value: { manifest: { checksum: string }; payload: unknown }) { value.manifest.checksum = createHash('sha256').update(stableStringify(value.payload)).digest('hex'); }
after(() => { auth.requireSession = original; for (const session of sessions) retireForUser(session); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('unauthenticated requests deny every route before consuming the upload', async () => {
    const before = nonCatalog();
    for (const action of ['preview', 'commit', 'status', 'search', 'template'] as const) {
        const req = request(body); req.headers.set('Authorization', 'Bearer synthetic-not-a-web-session');
        const response = await route(action, req);
        assert.equal(response.status, 401); assert.equal(req.bodyUsed, false);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.deepEqual(nonCatalog(), before);
});

test('preview, commit, status, template and lookup use real SQLite without changing clinical tables', async () => {
    active(); const before = nonCatalog(), initial = snapshot();
    const preview = await route('preview', request(body)); assert.equal(preview.status, 200);
    const p = await preview.json(); assert.equal(p.valid, true); assert.deepEqual(snapshot(), initial);
    const commit = await route('commit', request({ ...body, proof: p.proof, acceptSubset: true })); assert.equal(commit.status, 200);
    const result = await commit.json(), status = await (await route('status')).json();
    assert.equal(status.latestReceipt.operationKey, result.receipt.operationKey); assert.equal(status.count, 1);
    const lookup = await route('search', new Request('http://localhost/api/prosthetics/catalog/search?q=DEMO'));
    assert.equal((await lookup.json()).entries[0].codeSystem, 'Codifica dimostrativa');
    const template = await route('template'); assert.equal(await template.text(), PROSTHETICS_TEMPLATE);
    assert.equal(template.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(nonCatalog(), before);
});

test('bounded request rejects extra fields, invalid base64, wrong content type and declared excessive size', async () => {
    active(); const before = snapshot();
    for (const value of [{ ...body, url: 'not-supported' }, { ...body, base64: '%%%bad' }, { ...body, base64: 'YQ' }]) assert.equal((await route('preview', request(value))).status, 400);
    assert.equal((await route('preview', request(body, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
    assert.equal((await route('preview', request(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': '9999999' } }))).status, 413);
    assert.equal((await route('search', new Request('http://localhost/api/prosthetics/catalog/search?q=x&q=y'))).status, 400);
    assert.equal((await route('search', new Request('http://localhost/api/prosthetics/catalog/search?q=' + 'x'.repeat(201)))).status, 400);
    assert.deepEqual(snapshot(), before);
});

test('owner retirement while reading cancels preview/commit, publishes no proof and mutates nothing', async () => {
    for (const action of ['preview', 'commit'] as const) {
        const session = active(); const p = service.preview(bytes, body.sourceName, session.userId);
        const value = { ...body, ...(action === 'commit' ? { proof: p.proof, acceptSubset: true } : {}) };
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); }, cancel() { cancelled = true; } });
        const req = new Request('http://localhost/api/prosthetics/catalog/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
        const before = snapshot(), running = route(action, req);
        await new Promise(resolve => setTimeout(resolve, 10)); retireForUser(session);
        const result = await running; assert.equal(result.status, 401); assert.equal(cancelled, true);
        assert.equal(result.headers.get('Cache-Control'), 'no-store');
        assert.doesNotMatch(await result.text(), /proof|sha256/u); assert.deepEqual(snapshot(), before);
    }
});

test('stale owner and aborted request cannot publish status or perform a commit', async () => {
    const session = active(); retireForUser(session);
    const req = request(body); assert.equal((await route('preview', req)).status, 401); assert.equal(req.bodyUsed, false);
    active(); const abort = new AbortController(); abort.abort();
    const before = snapshot(); assert.equal((await route('status', new Request('http://localhost/api/prosthetics/catalog/status', { signal: abort.signal }))).status, 400);
    assert.deepEqual(snapshot(), before);
});

test('canonical web backup, scheduled CLI and restore preserve repertory bytes, dates, revisions and provenance', async () => {
    active(); const before = snapshot(), current = service.status();
    const response = await backupRoute.GET(); assert.equal(response.status, 200);
    const exported = await parseBackupArtifact(await response.json());
    assert.equal(exported.payload.prostheticsCatalogEntries!.length, 1);
    const root = process.env.MEDIFLOW_DATA_DIR!;
    const output = execFileSync(process.execPath, ['scripts/run-scheduled-backup.mjs'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(root, 'backups-synthetic') },
    });
    const scheduled = await parseBackupArtifact(JSON.parse(fs.readFileSync(JSON.parse(output).artifactPath, 'utf8')));
    assert.deepEqual(scheduled.payload.prostheticsCatalogEntries, exported.payload.prostheticsCatalogEntries);
    assert.deepEqual(scheduled.payload.prostheticsCatalogReceipts, exported.payload.prostheticsCatalogReceipts);
    const empty = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(createEmptyDataset())));
    restoreBackupArtifact(empty, () => true); assert.equal(service.status().count, 0);
    restoreBackupArtifact(scheduled, () => true);
    assert.deepEqual(snapshot(), before); assert.deepEqual(service.status(), current); assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('legacy backup without both repertory collections verifies original checksum then clears both', async () => {
    active(); const exported = await (await backupRoute.GET()).json();
    for (const name of ['prostheticsCatalogEntries', 'prostheticsCatalogReceipts']) { delete exported.payload[name]; delete exported.manifest.recordCounts[name]; }
    exported.manifest.collections = exported.manifest.collections.filter((name: string) => !name.startsWith('prostheticsCatalog'));
    await assert.rejects(parseBackupArtifact(exported), /checksum/u);
    rehash(exported); const parsed = await parseBackupArtifact(exported);
    assert.deepEqual(parsed.payload.prostheticsCatalogEntries, []); assert.deepEqual(parsed.payload.prostheticsCatalogReceipts, []);
    restoreBackupArtifact(parsed, () => true); assert.equal(service.status().count, 0); assert.equal(service.status().latestReceipt, null);
});

test('restore rejects partial collections and unsupported provenance before any mutation', async () => {
    const session = active(), p = service.preview(bytes, body.sourceName, session.userId);
    service.commit({ bytes, sourceName: body.sourceName, proof: p.proof!, acceptSubset: true }, session.userId, () => {});
    const exported = await (await backupRoute.GET()).json(), before = snapshot();
    const partial = structuredClone(exported); delete partial.payload.prostheticsCatalogReceipts; rehash(partial);
    await assert.rejects(parseBackupArtifact(partial));
    const changed = structuredClone(exported); changed.payload.prostheticsCatalogEntries[0].sourceSha256 = '0'.repeat(64); rehash(changed);
    await assert.rejects(parseBackupArtifact(changed), /Prosthetics/u);
    assert.throws(() => restoreBackupArtifact(changed, () => true), /BACKUP_INVALID/u);
    assert.deepEqual(snapshot(), before);
});
