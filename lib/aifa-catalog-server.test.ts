import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from './aifa-catalog';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type CatalogModules = {
    clearAifaCatalog: typeof import('./aifa-catalog-server.ts').clearAifaCatalog;
    getAifaCatalogStatus: typeof import('./aifa-catalog-server.ts').getAifaCatalogStatus;
    replaceAifaCatalog: typeof import('./aifa-catalog-server.ts').replaceAifaCatalog;
    replaceUnverifiedDrugCatalog: typeof import('./aifa-catalog-server.ts').replaceUnverifiedDrugCatalog;
    readDrugCatalog: typeof import('./network-catalog-read.ts').readDrugCatalog;
    searchAifaCatalog: typeof import('./aifa-catalog-server.ts').searchAifaCatalog;
};

let modulesPromise: Promise<CatalogModules> | null = null;

function bootstrapDatabase(dataDir: string): void {
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
            const sql = fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            sqlite.exec(sql);
        }
    } finally {
        sqlite.close();
    }
}

async function loadCatalogModules(): Promise<CatalogModules> {
    if (!modulesPromise) {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-aifa-catalog-'));
        bootstrapDatabase(dataDir);
        process.env.MEDIFLOW_DATA_DIR = dataDir;
        modulesPromise = Promise.all([
            import('./aifa-catalog-server.ts'),
            import('./network-catalog-read.ts'),
        ]).then(([catalog, network]) => ({ ...catalog, readDrugCatalog: network.readDrugCatalog }));
    }
    return modulesPromise;
}

test('import persists the provenance manifest and enables bounded prefix search', async () => {
    const catalog = await loadCatalogModules();
    const csv = fs.readFileSync(path.join(ROOT_DIR, 'scripts/fixtures/aifa-confezioni-synthetic.csv'));
    const result = await catalog.replaceAifaCatalog(
        new File([csv], 'aifa-synthetic.csv', { type: 'text/csv' }),
        {
            sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
            downloadedAt: '2026-07-17',
            version: 'synthetic-test-v1',
        },
    );

    assert.equal(result.state, 'ready');
    assert.equal(result.count, 3);
    assert.ok(result.manifest);
    assert.equal(result.manifest.rowCount, 3);
    assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);

    const status = await catalog.getAifaCatalogStatus();
    assert.deepEqual(status.manifest, result.manifest);

    const search = await catalog.searchAifaCatalog('acido', 1);
    assert.equal(search.rows.length, 1);
    assert.equal(search.rows[0].name, 'ACIDO SINTETICO');

    const crossFieldSearch = await catalog.searchAifaCatalog('acido orale', 1);
    assert.equal(crossFieldSearch.rows.length, 1);
    assert.equal(crossFieldSearch.rows[0].aic, '000000101');

    const accentFoldedSearch = await catalog.searchAifaCatalog('citta 500', 1);
    assert.equal(accentFoldedSearch.rows.length, 1);
    assert.equal(accentFoldedSearch.rows[0].aic, '000000102');

    catalog.clearAifaCatalog();
    assert.deepEqual(await catalog.getAifaCatalogStatus(), {
        count: 0,
        manifest: null,
        state: 'not-imported',
    });
});

test('legacy replacement removes AIFA rows without changing price scale or prefix semantics', async () => {
    const catalog = await loadCatalogModules();
    const csv = fs.readFileSync(path.join(ROOT_DIR, 'scripts/fixtures/aifa-confezioni-synthetic.csv'));
    await catalog.replaceAifaCatalog(
        new File([csv], 'aifa-synthetic.csv', { type: 'text/csv' }),
        {
            sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
            downloadedAt: '2026-07-17',
            version: 'synthetic-before-legacy',
        },
    );

    catalog.replaceUnverifiedDrugCatalog([{
        aic: '000000901',
        name: 'FARMACO LEGACY',
        activePrinciple: 'Principio legacy',
        company: 'Azienda sintetica',
        packaging: '10 compresse',
        class: 'A',
        price: 250,
        atc: 'A00AA00',
        aicSearch: '000000901',
        nameSearch: 'farmaco legacy',
        activePrincipleSearch: 'principio legacy',
    }]);

    assert.deepEqual(await catalog.getAifaCatalogStatus(), {
        count: 1,
        manifest: null,
        state: 'unverified',
    });
    assert.equal((await catalog.searchAifaCatalog('acido', 10)).rows.length, 0);
    assert.equal((await catalog.searchAifaCatalog('legacy', 10)).rows.length, 0);
    assert.equal((await catalog.searchAifaCatalog('farmaco', 10)).rows.length, 1);

    const response = await catalog.readDrugCatalog(new URLSearchParams('q=farmaco&limit=10'));
    assert.deepEqual(response.body, [{
        aic: '000000901',
        name: 'FARMACO LEGACY',
        activePrinciple: 'Principio legacy',
        company: 'Azienda sintetica',
        packaging: '10 compresse',
        class: 'A',
        price: 250,
        atc: 'A00AA00',
    }]);
});

test('runtime search applies cross-field tokens before the result cap', async () => {
    const catalog = await loadCatalogModules();
    catalog.replaceUnverifiedDrugCatalog([
        ...Array.from({ length: 300 }, (_, index) => ({
            aic: `DECOY-${index}`,
            name: `ALFA ${String(index).padStart(3, '0')}`,
            packaging: 'Compresse',
            aicSearch: `decoy ${index}`,
            nameSearch: `alfa ${String(index).padStart(3, '0')}`,
            activePrincipleSearch: '',
        })),
        {
            aic: 'TARGET',
            name: 'ZETA ALFA',
            packaging: 'Beta soluzione',
            aicSearch: 'target',
            nameSearch: 'zeta alfa',
            activePrincipleSearch: '',
        },
    ]);

    const search = await catalog.searchAifaCatalog('alfa beta', 1);
    assert.deepEqual(search.rows.map((row) => row.aic), ['TARGET']);
});

/* @Codex */
test('guarded replacement detects legacy changes and rolls back actual SQLite write failures', async () => {
    const catalog = await loadCatalogModules();
    const { getAifaCatalogSnapshot } = await import('./aifa-catalog-server.ts');
    const csv = 'CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n000000101;SINTETICO UNO;A01AA01;Principio sintetico\n000000102;SINTETICO DUE;A01AA02;Principio secondo\n000000103;SINTETICO TRE;A01AA03;Principio terzo';
    const file = () => new File([csv], 'synthetic.csv');
    const manifest = { sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL, downloadedAt: '2026-09-07', version: 'synthetic-guard' };
    catalog.replaceUnverifiedDrugCatalog([{ aic: '000000999', name: 'SINTETICO' }]);
    const snapshot = getAifaCatalogSnapshot();
    catalog.replaceUnverifiedDrugCatalog([{ aic: '000000999', name: 'MODIFICATO' }]);
    await assert.rejects(catalog.replaceAifaCatalog(file(), manifest, { snapshot, assertCurrent() {} }), { status: 409 });
    const before = getAifaCatalogSnapshot();
    const sqlite = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'));
    try {
        sqlite.exec("CREATE TRIGGER synthetic_aifa_fail BEFORE INSERT ON settings WHEN NEW.key = 'aifaCatalogManifest' BEGIN SELECT RAISE(ABORT, 'synthetic manifest failure'); END");
        await assert.rejects(catalog.replaceAifaCatalog(file(), manifest, { snapshot: before, assertCurrent() {} }), /synthetic manifest failure/);
        assert.equal(getAifaCatalogSnapshot(), before);
    } finally {
        sqlite.exec('DROP TRIGGER synthetic_aifa_fail');
        sqlite.close();
    }
    let checks = 0;
    await assert.rejects(catalog.replaceAifaCatalog(file(), manifest, { snapshot: before, assertCurrent() {
        if (++checks === 2) throw new Error('synthetic session lost before commit');
    } }), /session lost/);
    assert.equal(checks, 2);
    assert.equal(getAifaCatalogSnapshot(), before);
    for (const invalid of [
        'CODICE_AIC;DENOMINAZIONE\n000000101;VALIDO\ninvalid;INVALIDO',
        'CODICE_AIC;DENOMINAZIONE\n000000101;VALIDO;extra',
        'CODICE_AIC;DENOMINAZIONE\n000000101;VA"LI"DO',
    ]) {
        await assert.rejects(catalog.replaceAifaCatalog(new File([invalid], 'invalid.csv'), manifest, { snapshot: before, assertCurrent() {} }));
        assert.equal(getAifaCatalogSnapshot(), before);
    }
    const result = await catalog.replaceAifaCatalog(file(), manifest, { snapshot: before, assertCurrent() {} });
    assert.equal(result.count, 3);
    for (const query of ['000000101', 'A01AA01', 'principio']) {
        assert.ok((await catalog.searchAifaCatalog(query, 10)).rows.length > 0, query);
    }
});

/* @Codex Uses the actual lifecycle owner and SQLite; only the HTTP cookie reader and external transport are synthetic. */
test('update route authenticates before network and cancels a stalled download on actual session retirement', async (t) => {
    await loadCatalogModules();
    const load = createRequire(import.meta.url);
    const auth = load('./security/server-auth.ts') as typeof import('./security/server-auth');
    const owner = load('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter');
    const { POST } = load('../app/api/drugs/update/route.ts') as typeof import('../app/api/drugs/update/route');
    const { getAifaCatalogSnapshot } = await import('./aifa-catalog-server.ts');
    let current: Awaited<ReturnType<typeof auth.requireSession>> = null;
    t.mock.method(auth, 'requireSession', async () => current);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected network'); });
    const request = () => new Request('http://localhost/api/drugs/update', { method: 'POST' });
    assert.equal((await POST(request())).status, 401);
    assert.equal(calls, 0);
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: 'synthetic-aifa-login-0001' });
    const issued = owner.issue(attempt, { id: 'synthetic-aifa-user', username: 'synthetic-aifa', role: 'clinician' })!;
    const resolved = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('synthetic session setup failed');
    current = resolved.projection;
    assert.equal((await POST(new Request('http://localhost/api/drugs/update?url=https://invalid.example', { method: 'POST' }))).status, 400);
    assert.equal((await POST(new Request('http://localhost/api/drugs/update', { method: 'POST', body: '{}' }))).status, 400);
    assert.equal(calls, 0);
    const validCsv = 'CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n000000401;TEST ROUTE;A01AA01;Principio route';
    t.mock.method(globalThis, 'fetch', async () => new Response(validCsv, { headers: { 'Content-Type': 'text/csv' } }));
    const success = await POST(request());
    assert.equal(success.status, 200);
    const payload = await success.json();
    const { createHash } = await import('node:crypto');
    assert.equal(payload.manifest.sha256, createHash('sha256').update(validCsv).digest('hex'));
    assert.equal(payload.manifest.sourceUrl, 'https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv');
    assert.equal(payload.count, 1);
    const committed = getAifaCatalogSnapshot();
    for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode('not a csv')]) {
        t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'Content-Type': 'text/csv' } }));
        assert.equal((await POST(request())).status, 422);
        assert.equal(getAifaCatalogSnapshot(), committed);
    }
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('synthetic network failure'); });
    assert.equal((await POST(request())).status, 422);
    assert.equal(getAifaCatalogSnapshot(), committed);
    const catalog = await loadCatalogModules();
    t.mock.method(globalThis, 'fetch', async () => {
        catalog.replaceUnverifiedDrugCatalog([{ aic: '000000999', name: 'CONCURRENT SYNTHETIC', nameSearch: 'concurrent synthetic' }]);
        return new Response(validCsv, { headers: { 'Content-Type': 'text/csv' } });
    });
    assert.equal((await POST(request())).status, 409);
    assert.equal((await catalog.searchAifaCatalog('concurrent', 1)).rows[0].aic, '000000999');
    const changed = getAifaCatalogSnapshot();
    t.mock.method(globalThis, 'fetch', async () => {
        current = null;
        return new Response(validCsv, { headers: { 'Content-Type': 'text/csv' } });
    });
    assert.equal((await POST(request())).status, 401);
    assert.equal(getAifaCatalogSnapshot(), changed);
    current = resolved.projection;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    let transportSignal: AbortSignal | null = null;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        transportSignal = init.signal!;
        began();
        return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
    });
    const before = getAifaCatalogSnapshot();
    const pending = POST(request());
    await started;
    assert.equal((await POST(request())).status, 409);
    assert.equal(owner.retire(current, 'dispose').outcome, 'completed');
    assert.equal((transportSignal as AbortSignal | null)?.aborted, true);
    assert.equal((await pending).status, 401);
    assert.equal(getAifaCatalogSnapshot(), before);
});
