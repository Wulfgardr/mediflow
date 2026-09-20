/* @Codex: actual update route, writer, SQLite and lifecycle owner; entirely invented data.
 * Only the request cookie boundary and external AIFA transport are synthetic.
 * Status readback uses the actual catalog service: /api/drugs GET is NOT exercised here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createAifaUpdateGuide, type AifaGuideState } from './aifa-update-guide';
import type { AifaImportClientResult } from './aifa-importer';

const requireCurrent = createRequire(import.meta.url);

test('actual route + guide: abort preserves the catalog, explicit retry succeeds, read failure never repeats POST', { timeout: 15_000 }, async t => {
    assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim(), 'dedicated synthetic directory is required before DB imports');
    const parent = process.env.MEDIFLOW_DATA_DIR!;
    const directory = fs.mkdtempSync(path.join(parent, 'aifa-guide-route-'));
    process.env.MEDIFLOW_DATA_DIR = directory;
    // Precreate the isolated database: db-server must not consider a legacy database in cwd.
    new Database(path.join(directory, 'medical.db')).close();
    const { dbServer } = await import('./db-server.ts');
    const catalog = await import('./aifa-catalog-server.ts');
    const auth = requireCurrent('./security/server-auth.ts') as typeof import('./security/server-auth');
    const owner = requireCurrent('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter');
    const { syntheticExemptionSession } = await import('../scripts/fixtures/exemption-import-session.ts');
    const { POST } = requireCurrent('../app/api/drugs/update/route.ts') as typeof import('../app/api/drugs/update/route');
    const session = syntheticExemptionSession();
    let current: Awaited<ReturnType<typeof auth.requireSession>> = session;
    const guideStates: AifaGuideState[] = [];
    let guide: ReturnType<typeof createAifaUpdateGuide> | undefined;
    try {
        t.mock.method(auth, 'requireSession', async () => current);
        const oldCsv = 'CODICE_AIC;DENOMINAZIONE\n000000601;CONFEZIONE PRECEDENTE INVENTATA';
        const nextCsv = 'CODICE_AIC;DENOMINAZIONE\n000000602;CONFEZIONE NUOVA INVENTATA';
        await catalog.replaceAifaCatalog(new File([oldCsv], 'synthetic-old.csv'), {
            sourceUrl: 'https://www.aifa.gov.it/open-data', downloadedAt: '2026-09-01', version: 'synthetic-old',
        });
        const before = catalog.getAifaCatalogSnapshot();
        const priorStatus = await catalog.getAifaCatalogStatus();
        let mode: 'pending' | 'invalid' | 'success' | 'retire' = 'pending';
        let began!: () => void;
        const started = new Promise<void>(resolve => { began = resolve; });
        let transportSignal: AbortSignal | null = null;
        let transportCalls = 0;
        let posts = 0;
        let readFailure = false;
        t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
            assert.equal(input, 'https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv');
            assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
            transportCalls++;
            if (mode === 'pending') {
                transportSignal = init.signal!;
                began();
                return new Promise<Response>((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
                });
            }
            if (mode === 'retire') {
                assert.equal(owner.retire(session, 'dispose').outcome, 'completed');
                current = null;
            }
            return new Response(mode === 'invalid' ? 'not a CSV' : nextCsv, { headers: { 'Content-Type': 'text/csv' } });
        });
        guide = createAifaUpdateGuide({
            read: async () => { if (readFailure) throw new Error('synthetic readback failure'); return catalog.getAifaCatalogStatus(); },
            update: async signal => {
                posts++;
                const response = await POST(new Request('http://localhost/api/drugs/update', { method: 'POST', signal }));
                const body = await response.json();
                if (!response.ok) throw new Error(body.error);
                return body as AifaImportClientResult;
            },
            importFile: async () => { throw new Error('manual import is not part of this route test'); },
            clear: async () => { throw new Error('clear is not part of this route test'); },
        }, state => guideStates.push(state));
        const last = () => guideStates.at(-1)!;
        await guide.refresh(); assert.equal(posts, 0); assert.equal(transportCalls, 0);
        const pending = guide.update(); await started;
        assert.equal(catalog.getAifaCatalogSnapshot(), before);
        guide.cancel(); await pending;
        assert.equal((transportSignal as AbortSignal | null)?.aborted, true);
        assert.equal(catalog.getAifaCatalogSnapshot(), before);
        assert.deepEqual(last().catalog, priorStatus); assert.equal(last().reconciliationRequired, true);
        assert.match(last().notice!.text, /non è confermato/u);
        await guide.update(); assert.equal(posts, 1, 'a cancellation does not authorize a blind retry');
        await guide.refresh(); assert.equal(posts, 1);
        mode = 'invalid'; await guide.update();
        assert.equal(catalog.getAifaCatalogSnapshot(), before); assert.equal(last().notice?.tone, 'error');
        await guide.refresh(); mode = 'success'; await guide.update();
        assert.equal(posts, 3); assert.equal(transportCalls, 3);
        assert.equal(last().notice?.tone, 'success'); assert.equal(last().reconciliationRequired, false);
        assert.equal(last().catalog?.manifest?.sha256, createHash('sha256').update(nextCsv).digest('hex'));
        assert.equal((await catalog.searchAifaCatalog('CONFEZIONE NUOVA', 10)).rows[0].aic, '000000602');
        const observation = last().catalog;
        readFailure = true; await guide.update();
        assert.equal(posts, 4); assert.equal(last().catalog, observation);
        assert.match(last().notice!.text, /Importazione confermata dal server; rilettura non riuscita/u);
        await guide.update(); assert.equal(posts, 4);
        readFailure = false; await guide.refresh(); assert.equal(posts, 4);
        const committed = catalog.getAifaCatalogSnapshot();
        mode = 'retire'; await guide.update();
        assert.equal(catalog.getAifaCatalogSnapshot(), committed);
        assert.equal(last().reconciliationRequired, true); assert.equal(last().notice?.tone, 'error');
        assert.equal(posts, 5); assert.equal(transportCalls, 5);
    } finally {
        guide?.dispose();
        owner.retire(session, 'dispose');
        dbServer.$client.close();
        fs.rmSync(directory, { recursive: true, force: true });
        process.env.MEDIFLOW_DATA_DIR = parent;
    }
});
