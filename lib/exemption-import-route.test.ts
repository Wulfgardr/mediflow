/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { EXEMPTION_COLUMNS } from './exemption-import-contract';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-exemptions-route-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer } = await import('./db-server.ts');
const previewRoute = await import('../app/api/exemptions/import/preview/route.ts');
const commitRoute = await import('../app/api/exemptions/import/commit/route.ts');
const statusRoute = await import('../app/api/exemptions/import/status/route.ts');
const legacyWeb = await import('../app/api/exemptions/route.ts');
const legacyNative = await import('../app/api/v1/exemptions/route.ts');
const requireCurrent = createRequire(import.meta.url);
const auth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown>; requireSessionOrLocalToken: () => Promise<unknown> };
const nativeAuth = requireCurrent('./security/local-api-auth') as { requireLocalApiToken: () => Response | null };
const originalSession = auth.requireSession;
const originalLegacySession = auth.requireSessionOrLocalToken;
const originalNative = nativeAuth.requireLocalApiToken;
const session = { userId: 'synthetic-test-operator', id: 'synthetic-test-session' };
const bytes = Buffer.from([EXEMPTION_COLUMNS.join('|'), ['ZZ_ROUTE', 'Categoria inventata route', '\\N', '20240101', '\\N', 'S', 'N', '\\N'].join('|')].join('\r\n') + '\r\n');
const body = { sourceName: 'inventato-route.txt', base64: bytes.toString('base64') };
const request = (value: unknown) => new Request('http://localhost/api/exemptions/import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const db = dbServer.$client;
after(() => {
    auth.requireSession = originalSession;
    auth.requireSessionOrLocalToken = originalLegacySession;
    nativeAuth.requireLocalApiToken = originalNative;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
});
function allRowsExceptCatalog() {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('exemptions', 'exemption_import_receipts') ORDER BY name").all() as { name: string }[];
    return tables.map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
}

test('all new routes deny unauthenticated access before reading the upload; bearer alone does not grant a web session', async () => {
    // Actual session implementation denies in the absence of a trusted Next cookie context.
    const before = allRowsExceptCatalog();
    for (const post of [previewRoute.POST, commitRoute.POST]) {
        const req = request(body);
        req.headers.set('Authorization', 'Bearer synthetic-untrusted-token');
        assert.equal((await post(req)).status, 401);
        assert.equal(req.bodyUsed, false);
    }
    assert.equal((await statusRoute.GET()).status, 401);
    assert.deepEqual(allRowsExceptCatalog(), before);
});

test('authenticated preview, commit and reread use real temporary SQLite and never write clinical tables', async () => {
    auth.requireSession = async () => session;
    const before = allRowsExceptCatalog();
    const changesBefore = (db.prepare('SELECT total_changes() n').get() as { n: number }).n;
    const response = await previewRoute.POST(request(body));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const preview = await response.json();
    assert.equal(preview.valid, true);
    assert.equal((db.prepare('SELECT total_changes() n').get() as { n: number }).n, changesBefore);
    const committed = await commitRoute.POST(request({ ...body, proof: preview.proof, acceptSubset: true }));
    assert.equal(committed.status, 200);
    const result = await committed.json();
    assert.equal(result.receipt.applied, 1);
    const current = await (await statusRoute.GET()).json();
    assert.deepEqual(current.latestReceipt, result.receipt);
    assert.equal(current.revision, result.receipt.revision);
    assert.equal(current.count, 1);
    assert.deepEqual(allRowsExceptCatalog(), before);
    assert.equal((await (await commitRoute.POST(request({ ...body, proof: preview.proof, acceptSubset: true }))).json()).replayed, true);
});

test('legacy web/native array writers reject before mutation and manual single upsert stays compatible', async () => {
    auth.requireSessionOrLocalToken = async () => session;
    nativeAuth.requireLocalApiToken = () => null;
    const before = db.prepare('SELECT * FROM exemptions ORDER BY code').all();
    for (const post of [legacyWeb.POST, legacyNative.POST]) {
        const rejected = await post(request([{ code: 'ZZ_MANUAL', description: 'Inventata' }]));
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).error, 'EXEMPTION_IMPORT_PREVIEW_REQUIRED');
        assert.deepEqual(db.prepare('SELECT * FROM exemptions ORDER BY code').all(), before);
    }
    const clinicalBefore = allRowsExceptCatalog();
    for (const post of [legacyWeb.POST, legacyNative.POST]) {
        assert.equal((await post(request({ code: 'ZZ_MANUAL', description: 'Descrizione manuale inventata', isPharma: false }))).status, 200);
    }
    assert.equal((db.prepare('SELECT description FROM exemptions WHERE code = ?').get('ZZ_MANUAL') as { description: string }).description, 'Descrizione manuale inventata');
    assert.deepEqual(allRowsExceptCatalog(), clinicalBefore);
});

test('malformed preview and missing subset confirmation fail without writes; errors do not echo source content', async () => {
    auth.requireSession = async () => session;
    const before = db.prepare('SELECT * FROM exemptions ORDER BY code').all();
    const bad = await previewRoute.POST(request({ ...body, extra: 'synthetic-secret-marker' }));
    assert.equal(bad.status, 400);
    assert.doesNotMatch(await bad.text(), /synthetic-secret-marker/u);
    const preview = await (await previewRoute.POST(request(body))).json();
    assert.equal((await commitRoute.POST(request({ ...body, proof: preview.proof, acceptSubset: false }))).status, 400);
    assert.deepEqual(db.prepare('SELECT * FROM exemptions ORDER BY code').all(), before);
});
