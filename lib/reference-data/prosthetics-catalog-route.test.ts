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
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('prosthetics_catalog_entries', 'prosthetics_catalog_receipts', 'prosthetics_catalog_sources', 'prosthetics_catalog_documents') ORDER BY name").all() as { name: string }[];
    return tables.map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
}
function snapshot() { return { entries: db.prepare('SELECT * FROM prosthetics_catalog_entries ORDER BY id').all(), receipts: db.prepare('SELECT * FROM prosthetics_catalog_receipts ORDER BY id').all() }; }
function rehash(value: { manifest: { checksum: string }; payload: unknown }) { value.manifest.checksum = createHash('sha256').update(stableStringify(value.payload)).digest('hex'); }
after(() => { auth.requireSession = original; for (const session of sessions) retireForUser(session); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('unauthenticated requests deny every route before consuming the upload', async () => {
    const before = nonCatalog();
    for (const action of ['preview', 'commit', 'status', 'search', 'template', 'sources', 'documents'] as const) {
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
    for (const name of ['prostheticsCatalogEntries', 'prostheticsCatalogReceipts', 'prostheticsCatalogSources', 'prostheticsCatalogDocuments']) { delete exported.payload[name]; delete exported.manifest.recordCounts[name]; }
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

test('originali autenticati: nome sicuro, integrità, negazione senza sessione e roundtrip completo', async () => {
    active();
    const sourceId = service.sources().sources[0].id;
    const original = Buffer.from('%PDF-1.4\nOriginale di repertorio inventato');
    const input = { sourceId, revision: service.status().revision, name: 'listino inventato.pdf', base64: original.toString('base64'), page: '3' };
    const add = await route('documents', request(input)); assert.equal(add.status, 200);
    const doc = await add.json();
    const url = `http://localhost/api/prosthetics/catalog/documents?id=${doc.id}&sha256=${doc.sha256}`;
    const opened = await route('documents', new Request(url)); assert.equal(opened.status, 200);
    assert.deepEqual(Buffer.from(await opened.arrayBuffer()), original);
    assert.equal(opened.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(opened.headers.get('Content-Disposition')!, /^attachment;/u);
    auth.requireSession = async () => null;
    assert.equal((await route('documents', new Request(url))).status, 401);
    assert.equal((await route('documents', request(input))).status, 401);
    active();
    const artifact = await parseBackupArtifact(await (await backupRoute.GET()).json());
    const snapshotBefore = service.sources();
    assert.equal(artifact.payload.prostheticsCatalogDocuments!.length, 1);
    const output = execFileSync(process.execPath, ['scripts/run-scheduled-backup.mjs'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, MEDIFLOW_BACKUP_FORCE: '1', MEDIFLOW_BACKUP_DEST_DIR: path.join(directory, 'originals-backup') },
    });
    const scheduled = await parseBackupArtifact(JSON.parse(fs.readFileSync(JSON.parse(output).artifactPath, 'utf8')));
    assert.deepEqual(scheduled.payload.prostheticsCatalogDocuments, artifact.payload.prostheticsCatalogDocuments);
    assert.deepEqual(scheduled.payload.prostheticsCatalogSources, artifact.payload.prostheticsCatalogSources);
    const emptyArtifact = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(createEmptyDataset())));
    restoreBackupArtifact(emptyArtifact, () => true);
    assert.throws(() => service.document(doc.id), /non disponibile/u);
    restoreBackupArtifact(scheduled, () => true);
    assert.deepEqual(service.document(doc.id, doc.sha256).bytes, original); assert.deepEqual(service.sources(), snapshotBefore);
    active();
    db.prepare('UPDATE prosthetics_catalog_documents SET bytes=? WHERE id=?').run(Buffer.from('sostituito'), doc.id);
    assert.equal((await route('documents', new Request(url))).status, 409);
    db.prepare('DELETE FROM prosthetics_catalog_documents WHERE id=?').run(doc.id);
    assert.equal((await route('documents', new Request(url))).status, 404);
});

test('backup storico con sole voci e ricevute migra le fonti nel restore atomico', async () => {
    active(); const exported = await (await backupRoute.GET()).json();
    for (const name of ['prostheticsCatalogSources', 'prostheticsCatalogDocuments']) { delete exported.payload[name]; delete exported.manifest.recordCounts[name]; }
    exported.manifest.collections = exported.manifest.collections.filter((name: string) => !['prostheticsCatalogSources', 'prostheticsCatalogDocuments'].includes(name));
    for (const entry of exported.payload.prostheticsCatalogEntries) { entry.id = JSON.stringify([entry.codeSystem, entry.code, entry.scope]); delete entry.sourceId; }
    rehash(exported);
    const old = await parseBackupArtifact(exported);
    restoreBackupArtifact(old, () => true);
    assert.equal(service.status().sourceCount, 1); assert.equal(service.search('').entries[0].code, 'DEMO-001');
    active(); assert.equal((await backupRoute.GET()).status, 200);
});

test('mappatura HTTP mantiene hash dei bytes e metadati nel backup e respinge opzioni cambiate', async () => {
    active();
    const content = Buffer.from('Descrizione;Codice;Codifica;Versione;Fonte;Ambito;Da;A\nInventato;MAPPATO;Codifica inventata;v1;Fonte mappata;Locale;;\n');
    const options = { mapping: { delimiter: ';', columns: { codice_sistema: 2, codice: 1, descrizione: 0, versione: 3, fonte: 4, ambito: 5, data_inizio: 6, data_fine: 7 } },
        sourceDetails: { authority: 'Ente inventato', date: '2026-10-15', notes: 'Solo fixture' } };
    const mappedBody = { sourceName: 'inventato-mappato.csv', base64: content.toString('base64'), options };
    const preview = await route('preview', request(mappedBody)); assert.equal(preview.status, 200);
    const p = await preview.json(); assert.equal(p.valid, true); assert.equal(p.manifest.sha256, createHash('sha256').update(content).digest('hex'));
    const changed = structuredClone(options); changed.sourceDetails.notes = 'Cambiate';
    assert.equal((await route('commit', request({ ...mappedBody, options: changed, proof: p.proof, acceptSubset: true }))).status, 409);
    assert.equal((await route('commit', request({ ...mappedBody, proof: p.proof, acceptSubset: true }))).status, 200);
    const exported = await parseBackupArtifact(await (await backupRoute.GET()).json());
    const mappedSource = exported.payload.prostheticsCatalogSources!.find(source => source.name === 'Fonte mappata');
    assert.equal(mappedSource?.notes, 'Solo fixture'); assert.equal(mappedSource?.date, '2026-10-15');
});


test('regressione: export, parsing e restore negano snapshot con originali mancanti o discordanti prima della mutazione', async () => {
    active();
    const sourceId = service.sources().sources[0].id;
    const doc = service.addDocument({ sourceId, revision: service.status().revision, name: 'riferimento.pdf', base64: Buffer.from('originale per snapshot').toString('base64'), page: null }, () => {});
    const entry = service.search('', sourceId).entries[0];
    const selected = service.snapshot({ entryId: entry.id, revision: service.status().revision });
    const exported = await (await backupRoute.GET()).json();
    exported.payload.patients = [{ id: 'synthetic-patient' }]; exported.manifest.recordCounts.patients = 1;
    exported.payload.prostheticPrescriptions = [{ id: 'synthetic-prescription', patientId: 'synthetic-patient', catalogSnapshot: selected }];
    exported.manifest.recordCounts.prostheticPrescriptions = 1; rehash(exported);
    const before = snapshot();
    for (const field of ['missing','sourceId','sha256','size'] as const) {
        const broken = structuredClone(exported);
        const ref = broken.payload.prostheticPrescriptions[0].catalogSnapshot.documents.find((item: { id: string }) => item.id === doc.id);
        if (field === 'missing') broken.payload.prostheticsCatalogDocuments = broken.payload.prostheticsCatalogDocuments.filter((item: { id: string }) => item.id !== doc.id);
        else if (field === 'sourceId') { ref.sourceId = 'altra-fonte'; broken.payload.prostheticPrescriptions[0].catalogSnapshot.source.id = 'altra-fonte'; }
        else ref[field] = field === 'size' ? ref.size + 1 : 'f'.repeat(64);
        broken.manifest.recordCounts.prostheticsCatalogDocuments = broken.payload.prostheticsCatalogDocuments.length; rehash(broken);
        await assert.rejects(serializeBackupArtifact(broken.payload), /Prosthetics/u);
        await assert.rejects(parseBackupArtifact(broken), /Prosthetics/u);
        let fenceCalled = false;
        assert.throws(() => restoreBackupArtifact(broken, () => { fenceCalled = true; return true; }), /PROSTHETICS/u);
        assert.equal(fenceCalled, false); assert.deepEqual(snapshot(), before);
    }
});


test('regressione trasporto: la clonazione del proxy Next conserva originali da 8 e 25 MiB', async () => {
    const { Readable } = await import('node:stream');
    const { getCloneableBody } = await import('next/dist/server/body-streams.js');
    const nextConfig = requireCurrent('../../next.config.ts').default as import('next').NextConfig;
    active();
    if (!service.status().count) { const p = service.preview(bytes, body.sourceName, 'synthetic'); service.commit({ bytes, sourceName: body.sourceName, proof: p.proof!, acceptSubset: true }, 'synthetic', () => {}); }
    for (const size of [8, 25]) {
        const bytes = Buffer.alloc(size * 1024 * 1024, size);
        const encoded = Buffer.from(JSON.stringify({ sourceId: service.sources().sources[0].id, revision: service.status().revision, name: `originale-${size}.bin`, base64: bytes.toString('base64'), page: null }));
        const incoming = Readable.from((function* () { for (let i = 0; i < encoded.length; i += 65536) yield encoded.subarray(i, i + 65536); })());
        const cloned = getCloneableBody(incoming as import('node:http').IncomingMessage, nextConfig.experimental?.proxyClientMaxBodySize as number | undefined);
        const chunks: Buffer[] = [];
        for await (const chunk of cloned.cloneBodyStream()) chunks.push(Buffer.from(chunk));
        assert.equal(Buffer.concat(chunks).length, encoded.length);
        await cloned.finalize();
        const req = new Request('http://localhost/api/prosthetics/catalog/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
        const response = await route('documents', req); assert.equal(response.status, 200, await response.clone().text());
        const doc = await response.json(); assert.deepEqual(service.document(doc.id).bytes, bytes);
    }
});
