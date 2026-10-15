import { syntheticExemptionRequest } from '../scripts/fixtures/exemption-import-session';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { NodeNextRequest } from 'next/dist/server/base-http/node.js';
import { NextRequestAdapter } from 'next/dist/server/web/spec-extension/adapters/next-request.js';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from './aifa-catalog';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type CatalogModules = {
    getAifaCatalogSnapshot: typeof import('./aifa-catalog-server.ts').getAifaCatalogSnapshot;
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
test('update route guards streamed bodies and cancels on actual session retirement', { timeout: 10_000 }, async (t) => {
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
    const request = () => syntheticExemptionRequest('http://localhost/api/drugs/update', { method: 'POST' });
    assert.equal((await POST(request())).status, 401);
    assert.equal(calls, 0);
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: 'synthetic-aifa-login-0001' });
    const principal = { id: 'synthetic-aifa-user', username: 'synthetic-aifa', role: 'clinician' };
    const issued = owner.issue(attempt, principal)!;
    const resolved = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('synthetic session setup failed');
    current = resolved.projection;
    bindSyntheticArchiveSessions(current.id);
    assert.equal((await POST(syntheticExemptionRequest('http://localhost/api/drugs/update?url=https://invalid.example', { method: 'POST' }))).status, 400);
    assert.equal((await POST(syntheticExemptionRequest('http://localhost/api/drugs/update', { method: 'POST', body: '{}' }))).status, 400);
    assert.equal(calls, 0);
    /* @Codex Body guards run before transport and leave the catalog intact. */
    const bodySnapshot = getAifaCatalogSnapshot();
    const streamed = (body: ReadableStream<Uint8Array>, signal?: AbortSignal) => syntheticExemptionRequest('http://localhost/api/drugs/update', {
        method: 'POST', body, signal, duplex: 'half',
    } as RequestInit);
    for (const bytes of [new Uint8Array([0]), new TextEncoder().encode(' '), new TextEncoder().encode('{}')]) {
        let cancelled = false;
        const response = await POST(streamed(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(0)); controller.enqueue(bytes); },
            cancel() { cancelled = true; return new Promise<void>(() => {}); },
        })));
        assert.equal(response.status, 400);
        assert.equal(cancelled, true, 'nonempty stream cancellation must not block response');
    }
    let emptyReads = 0;
    let floodCancelled = false;
    assert.equal((await POST(streamed(new ReadableStream({
        pull(controller) { emptyReads++; controller.enqueue(new Uint8Array(0)); },
        cancel() { floodCancelled = true; },
    })))).status, 400);
    assert.ok(emptyReads <= 33, 'empty chunk processing must be bounded');
    assert.equal(floodCancelled, true);
    for (const alreadyAborted of [false, true]) {
        const abort = new AbortController();
        let cancelled = false;
        let started!: () => void;
        const reading = new Promise<void>((resolve) => { started = resolve; });
        const body = new ReadableStream<Uint8Array>({
            pull() { started(); },
            cancel() { cancelled = true; return new Promise<void>(() => {}); },
        });
        if (alreadyAborted) abort.abort();
        const pending = POST(streamed(body, abort.signal));
        await reading;
        abort.abort();
        assert.equal((await pending).status, 499);
        if (!alreadyAborted) assert.equal(cancelled, true);
    }
    let stalledCancelled = false;
    assert.equal((await POST(streamed(new ReadableStream({
        cancel() { stalledCancelled = true; return Promise.reject(new Error('synthetic cancellation failure')); },
    })))).status, 400, 'stalled body must time out before transport');
    assert.equal(stalledCancelled, true);
    const failedBody = await POST(streamed(new ReadableStream({
        start(controller) { controller.error(new Error('synthetic body read failure')); },
    })));
    assert.equal(failedBody.status, 422);
    /* @Codex Unexpected errors never expose raw exception text through the domain-error branch. */
    assert.deepEqual(await failedBody.json(), { error: 'Aggiornamento AIFA non riuscito; catalogo conservato' });
    assert.equal(calls, 0);
    assert.equal(getAifaCatalogSnapshot(), bodySnapshot);
    const { dbServer: testDb } = await import('./db-server.ts');
    const { settings: testSettings } = await import('./schema.ts');
    assert.equal((await POST(request())).status, 403, 'network is disabled until explicitly allowed');
    assert.equal(calls, 0);
    (await loadCatalogModules()).clearAifaCatalog();
    testDb.insert(testSettings).values({ key: 'aifaNetworkAccess', value: 'enabled' }).onConflictDoUpdate({ target: testSettings.key, set: { value: 'enabled' } }).run();
    const validCsv = 'CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n000000401;TEST ROUTE;A01AA01;Principio route';
    t.mock.method(globalThis, 'fetch', async () => new Response(validCsv, { headers: { 'Content-Type': 'text/csv', etag: '"route-version"', 'Last-Modified': 'Wed, 14 Oct 2026 23:02:27 GMT' } }));
    /* @Codex Regression: a zero-byte POST can still expose a ReadableStream. */
    for (const emptyChunks of [0, 1]) {
        const streamedEmpty = streamed(new ReadableStream({ start(controller) {
            if (emptyChunks) controller.enqueue(new Uint8Array(0));
            controller.close();
        } }));
        assert.notEqual(streamedEmpty.body, null);
        assert.equal((await POST(streamedEmpty)).status, 200, 'streamed empty POST must succeed');
    }
    const success = await POST(request());
    assert.equal(success.status, 200);
    const payload = await success.json();
    const { createHash } = await import('node:crypto');
    assert.equal(payload.manifest.sha256, createHash('sha256').update(validCsv).digest('hex'));
    assert.equal(payload.manifest.sourceUrl, 'https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv');
    assert.equal(payload.count, 1);
    const committed = getAifaCatalogSnapshot();
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        assert.equal((init.headers as Record<string, string>)['If-None-Match'], '"route-version"');
        return new Response(null, { status: 304 });
    });
    const notModified = await POST(request());
    assert.equal(notModified.status, 200); assert.equal((await notModified.json()).notModified, true);
    assert.equal(getAifaCatalogSnapshot(), committed);
    const { listAuditEvents } = await import('./security/audit');
    const noChangeAudit = (await listAuditEvents({ eventType: 'reference_data.aifa.updated', actorRef: current!.userId }))
        .find(event => event.redactedMetadata?.flags?.includes('not-modified'));
    assert.ok(noChangeAudit);
    assert.equal(noChangeAudit.redactedMetadata?.aifaCatalog?.before?.sha256, payload.manifest.sha256);
    assert.equal(noChangeAudit.redactedMetadata?.aifaCatalog?.after?.sha256, payload.manifest.sha256);
    testDb.insert(testSettings).values({ key: 'aifaNetworkAccess', value: 'enabled' }).onConflictDoUpdate({ target: testSettings.key, set: { value: 'enabled' } }).run();
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
        const concurrent = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'));
        try {
            concurrent.prepare('UPDATE drugs SET name = ?, name_search = ?').run('CONCURRENT SYNTHETIC', 'concurrent synthetic');
        } finally { concurrent.close(); }
        return new Response(validCsv, { headers: { 'Content-Type': 'text/csv' } });
    });
    assert.equal((await POST(request())).status, 409);
    assert.equal((await catalog.searchAifaCatalog('concurrent', 1)).rows[0].name, 'CONCURRENT SYNTHETIC');
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

    /* @Codex Session retirement must also interrupt body validation before network. */
    const nextControl = owner.bootstrapControl()!;
    const nextAttempt = owner.begin('login', { controlId: nextControl.controlId, ifMatch: nextControl.etag, idempotencyKey: 'synthetic-aifa-login-0002' });
    const nextIssued = owner.issue(nextAttempt, principal)!;
    const nextResolved = owner.resolve(nextIssued.sessionId, nextControl.controlId);
    if (nextResolved.status !== 'active') throw new Error('synthetic session setup failed');
    current = nextResolved.projection;
    bindSyntheticArchiveSessions(current.id);
    let bodyStarted!: () => void;
    const bodyReading = new Promise<void>((resolve) => { bodyStarted = resolve; });
    let bodyCancelled = false;
    t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected network'); });
    const bodyPending = POST(streamed(new ReadableStream({
        pull() { bodyStarted(); },
        cancel() { bodyCancelled = true; },
    }, { highWaterMark: 0 })));
    await bodyReading;
    assert.equal(owner.retire(current, 'dispose').outcome, 'completed');
    assert.equal((await bodyPending).status, 401);
    assert.equal(bodyCancelled, true);
    assert.equal(calls, 0);
    assert.equal(getAifaCatalogSnapshot(), before);
});

test('AIFA source debounce persists across calls, respects egress denial and recomputes status after replacement', async t => {
    const catalog = await loadCatalogModules();
    const { checkAifaSource, getAifaSourceStatus } = await import('./aifa-catalog-source-server');
    const { AIFA_REMOTE_SETTING_KEY, AIFA_NETWORK_SETTING_KEY, AIFA_SOURCE_CHECK_INTERVAL_MS } = await import('./aifa-catalog-source');
    const { dbServer } = await import('./db-server');
    const { settings } = await import('./schema');
    const { eq } = await import('drizzle-orm');
    const { AIFA_DOWNLOAD_URL } = await import('./aifa-catalog-download');
    const set = (key: string, value: string) => dbServer.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    const previousNetwork = process.env.MEDIFLOW_NETWORK_DISABLED;
    delete process.env.MEDIFLOW_NETWORK_DISABLED;
    catalog.clearAifaCatalog();
    dbServer.delete(settings).where(eq(settings.key, AIFA_REMOTE_SETTING_KEY)).run();
    set(AIFA_NETWORK_SETTING_KEY, 'disabled');
    let calls = 0;
    const transport = (async (_url, init) => {
        calls++; assert.equal(init?.method, 'HEAD');
        return new Response(null, { headers: { etag: '"source-new"', 'last-modified': 'Wed, 14 Oct 2026 23:02:27 GMT', 'content-length': '80' } });
    }) as typeof fetch;
    try {
        t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T10:00:00Z') });
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).remote.reason, 'network_disabled');
        assert.equal(calls, 0);
        set(AIFA_NETWORK_SETTING_KEY, 'enabled');
        process.env.MEDIFLOW_NETWORK_DISABLED = '1';
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).networkAllowed, false);
        assert.equal(calls, 0); delete process.env.MEDIFLOW_NETWORK_DISABLED;
        const first = await checkAifaSource(new AbortController().signal, () => undefined, transport);
        assert.equal(first.remote.outcome, 'available'); assert.equal(calls, 1);
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).remote.checkedAt, first.remote.checkedAt);
        assert.equal(calls, 1);
        const { acquireAifaCatalogOperation } = await import('./aifa-catalog-lock');
        const release = acquireAifaCatalogOperation();
        try { assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).remote.reason, 'busy'); }
        finally { release(); }
        const csv = 'CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n000000801;SINTETICO;A01AA01;Sintetico';
        await catalog.replaceAifaCatalog(new File([csv], 'synthetic.csv'), { sourceUrl: AIFA_DOWNLOAD_URL,
            downloadedAt: '2026-10-15', version: 'synthetic-http', etag: '"source-new"', lastModified: first.remote.lastModified });
        assert.equal((await getAifaSourceStatus()).remote.outcome, 'unchanged');
        t.mock.timers.setTime(Date.now() + AIFA_SOURCE_CHECK_INTERVAL_MS - 1);
        await checkAifaSource(new AbortController().signal, () => undefined, transport); assert.equal(calls, 1);
        t.mock.timers.setTime(Date.now() + 1);
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).remote.outcome, 'unchanged');
        assert.equal(calls, 2);
        t.mock.timers.setTime(Date.now() + AIFA_SOURCE_CHECK_INTERVAL_MS);
        const failed = (async () => { calls++; throw new Error('synthetic HEAD failure'); }) as typeof fetch;
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, failed)).remote.outcome, 'unavailable');
        assert.equal((await checkAifaSource(new AbortController().signal, () => undefined, transport)).remote.outcome, 'unavailable');
        assert.equal(calls, 3, 'failures are persistently debounced too');
    } finally {
        if (previousNetwork === undefined) delete process.env.MEDIFLOW_NETWORK_DISABLED;
        else process.env.MEDIFLOW_NETWORK_DISABLED = previousNetwork;
        dbServer.delete(settings).where(eq(settings.key, AIFA_REMOTE_SETTING_KEY)).run();
        catalog.clearAifaCatalog();
    }
});

test('reduction below 90% requires confirmation bound to both catalog and file; audit failure rolls back replacement', async () => {
    const catalog = await loadCatalogModules();
    const { getAifaCatalogSnapshot } = await import('./aifa-catalog-server');
    const { AifaReductionError } = await import('./aifa-catalog-lock');
    const { listAuditEvents } = await import('./security/audit');
    const makeFile = (count: number, suffix = '') => new File(['CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n' + Array.from({ length: count }, (_, index) =>
        `${String(index + 1).padStart(9, '0')};SINTETICO ${index}${suffix};A01AA01;Principio inventato`).join('\n')], 'synthetic.csv');
    const manifest = { sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL, downloadedAt: '2026-10-15', version: 'synthetic-reduction' };
    catalog.clearAifaCatalog();
    await catalog.replaceAifaCatalog(makeFile(10), manifest);
    await catalog.replaceAifaCatalog(makeFile(9), manifest);
    const snapshot = getAifaCatalogSnapshot();
    const before = await catalog.getAifaCatalogStatus();
    let confirmation = '';
    await assert.rejects(catalog.replaceAifaCatalog(makeFile(8), manifest), (error: unknown) => {
        assert.ok(error instanceof AifaReductionError); assert.equal(error.previousCount, 9); assert.equal(error.nextCount, 8);
        confirmation = error.confirmation; return true;
    });
    assert.equal(getAifaCatalogSnapshot(), snapshot);
    await assert.rejects(catalog.replaceAifaCatalog(makeFile(8, ' diverso'), manifest, undefined, { confirmedReduction: confirmation }), AifaReductionError);
    const result = await catalog.replaceAifaCatalog(makeFile(8), manifest, undefined, { confirmedReduction: confirmation });
    assert.ok(result.manifest);
    const event = (await listAuditEvents({ eventType: 'reference_data.aifa.updated' })).find(event => event.redactedMetadata?.aifaCatalog?.after?.sha256 === result.manifest?.sha256 && event.redactedMetadata?.aifaCatalog?.forcedReduction)!;
    assert.equal(event.actorType, 'system');
    assert.equal(event.redactedMetadata?.aifaCatalog?.before?.sha256, before.manifest?.sha256);
    assert.equal(event.redactedMetadata?.aifaCatalog?.after?.sha256, result.manifest.sha256);
    assert.equal(event.redactedMetadata?.aifaCatalog?.forcedReduction, true);
    const committed = getAifaCatalogSnapshot();
    const sqlite = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'));
    try {
        sqlite.exec("CREATE TRIGGER synthetic_aifa_audit_fail BEFORE INSERT ON audit_events WHEN NEW.event_type = 'reference_data.aifa.updated' BEGIN SELECT RAISE(IGNORE); END");
        await assert.rejects(catalog.replaceAifaCatalog(makeFile(8, ' audit'), manifest), /Required audit insert/);
        assert.equal(getAifaCatalogSnapshot(), committed);
    } finally { sqlite.exec('DROP TRIGGER synthetic_aifa_audit_fail'); sqlite.close(); catalog.clearAifaCatalog(); }
});

test('HEAD route accepts zero-byte Next.js POST streams, authenticates, rejects input and retires with its session', async t => {
    const catalog = await loadCatalogModules();
    const load = createRequire(import.meta.url);
    const auth = load('./security/server-auth.ts') as typeof import('./security/server-auth');
    const owner = load('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter');
    const route = load('../app/api/drugs/source/route.ts') as typeof import('../app/api/drugs/source/route');
    const { dbServer } = await import('./db-server');
    const { settings } = await import('./schema');
    const { eq } = await import('drizzle-orm');
    const setNetwork = (value: string) => dbServer.insert(settings).values({ key: 'aifaNetworkAccess', value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    const resetRemote = () => dbServer.delete(settings).where(eq(settings.key, 'aifaCatalogRemoteState')).run();
    let current: Awaited<ReturnType<typeof auth.requireSession>> = null;
    t.mock.method(auth, 'requireSession', async () => current);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        calls++; assert.equal(init.method, 'HEAD');
        return new Response(null, { headers: { etag: '"head-route"', 'Last-Modified': 'Wed, 14 Oct 2026 23:02:27 GMT' } });
    });
    const request = () => {
        const incoming = new IncomingMessage(new Socket());
        incoming.method = 'POST';
        incoming.url = 'http://localhost/api/drugs/source';
        incoming.headers = { ...Object.fromEntries(syntheticExemptionRequest(incoming.url, { method: 'POST' }).headers), 'content-length': '0' };
        incoming.push(null);
        const adapted = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
        assert.ok(adapted.body, 'Next.js supplies a stream even for a zero-byte POST');
        return adapted;
    };
    assert.equal((await route.POST(request())).status, 401); assert.equal((await route.GET()).status, 401); assert.equal(calls, 0);
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: 'synthetic-aifa-head-login' });
    const issued = owner.issue(attempt, { id: 'synthetic-head-user', username: 'synthetic-aifa', role: 'clinician' })!;
    const resolved = owner.resolve(issued.sessionId, control.controlId);
    if (resolved.status !== 'active') throw new Error('synthetic session setup failed');
    current = resolved.projection; bindSyntheticArchiveSessions(current.id);
    const before = catalog.getAifaCatalogSnapshot();
    try {
        resetRemote(); setNetwork('disabled');
        const disabled = await route.POST(request());
        assert.equal(disabled.status, 200);
        assert.equal((await disabled.json()).networkAllowed, false); assert.equal(calls, 0);
        assert.equal((await route.POST(syntheticExemptionRequest('http://localhost/api/drugs/source?url=invalid', { method: 'POST' }))).status, 400);
        assert.equal((await route.POST(syntheticExemptionRequest('http://localhost/api/drugs/source', { method: 'POST', body: '{}' }))).status, 400);
        setNetwork('enabled');
        assert.equal((await route.POST(request())).status, 200); assert.equal(calls, 1);
        await route.POST(request()); assert.equal(calls, 1);
        assert.equal((await route.GET()).status, 200); assert.equal(calls, 1);
        resetRemote();
        t.mock.method(globalThis, 'fetch', async () => {
            calls++; owner.retire(current!, 'dispose'); current = null;
            return new Response(null, { headers: { etag: '"head-revoked"' } });
        });
        assert.equal((await route.POST(request())).status, 503);
        assert.equal(catalog.getAifaCatalogSnapshot(), before);
        assert.equal((await route.GET()).status, 401);
    } finally { if (current) owner.retire(current, 'dispose'); resetRemote(); }
});

test('confirmation rejects a different file or catalog even when reduction is no longer below 90%', async t => {
    const catalog = await loadCatalogModules();
    const { AifaReductionError, AifaUpdateError } = await import('./aifa-catalog-lock');
    const makeFile = (count: number) => new File(['CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n' + Array.from({ length: count }, (_, index) =>
        `${String(index + 1).padStart(9, '0')};SINTETICO ${index};A01AA01;Principio inventato`).join('\n')], 'synthetic.csv');
    const manifest = { sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL, downloadedAt: '2026-10-15', version: 'synthetic-confirmation' };
    for (const scenario of ['different file', 'changed catalog']) await t.test(scenario, async () => {
        catalog.clearAifaCatalog();
        await catalog.replaceAifaCatalog(makeFile(100), manifest);
        let confirmation = '';
        await assert.rejects(catalog.replaceAifaCatalog(makeFile(80), manifest), (error: unknown) => {
            assert.ok(error instanceof AifaReductionError);
            confirmation = error.confirmation;
            return true;
        });
        if (scenario === 'changed catalog') {
            catalog.clearAifaCatalog();
            await catalog.replaceAifaCatalog(makeFile(80), manifest);
        }
        const before = catalog.getAifaCatalogSnapshot();
        try {
            await assert.rejects(catalog.replaceAifaCatalog(makeFile(scenario === 'different file' ? 95 : 80), manifest,
                undefined, { confirmedReduction: confirmation }), (error: unknown) => error instanceof AifaUpdateError && error.status === 409);
            assert.equal(catalog.getAifaCatalogSnapshot(), before);
        } finally { catalog.clearAifaCatalog(); }
    });
});

test('manual import excludes legacy replacement and clearing through services and v1 routes', async t => {
    const catalog = await loadCatalogModules();
    const { AifaUpdateError } = await import('./aifa-catalog-lock');
    const load = createRequire(import.meta.url);
    const route = load('../app/api/v1/drugs/route.ts') as typeof import('../app/api/v1/drugs/route');
    const { getOrCreateLocalApiToken } = await import('./security/local-api-token');
    const token = getOrCreateLocalApiToken();
    const legacy = [{ aic: '000000999', name: 'LEGACY SINTETICO' }];
    const request = (method: string) => new Request('http://localhost/api/v1/drugs', {
        method, headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(legacy) } : {}),
    });
    const csv = 'CODICE_AIC;DENOMINAZIONE;CODICE_ATC;PA_ASSOCIATI\n000000101;SINTETICO;A01AA01;Inventato';
    for (const writer of ['replace', 'clear', 'POST', 'DELETE']) await t.test(writer, async () => {
        catalog.clearAifaCatalog();
        catalog.replaceUnverifiedDrugCatalog(legacy);
        const before = catalog.getAifaCatalogSnapshot();
        const file = new File([csv], 'synthetic.csv');
        const bytes = await file.arrayBuffer();
        let resume!: (value: ArrayBuffer) => void;
        t.mock.method(file, 'arrayBuffer', () => new Promise<ArrayBuffer>(resolve => { resume = resolve; }));
        const pending = catalog.replaceAifaCatalog(file, { sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
            downloadedAt: '2026-10-15', version: 'synthetic-lock' });
        const conflict = (error: unknown) => error instanceof AifaUpdateError && error.status === 409;
        try {
            if (writer === 'replace') assert.throws(() => catalog.replaceUnverifiedDrugCatalog(legacy), conflict);
            else if (writer === 'clear') assert.throws(() => catalog.clearAifaCatalog(), conflict);
            else {
                const response = await route[writer as 'POST' | 'DELETE'](request(writer));
                assert.equal(response.status, 409);
                assert.deepEqual(await response.json(), { error: 'Operazione AIFA già in corso' });
            }
            assert.equal(catalog.getAifaCatalogSnapshot(), before);
        } finally { resume(bytes); await pending; }
        assert.equal((await catalog.searchAifaCatalog('sintetico', 10)).rows[0].aic, '000000101');
        assert.equal((await route.POST(request('POST'))).status, 200);
        assert.equal((await route.DELETE(request('DELETE'))).status, 200);
    });
});
