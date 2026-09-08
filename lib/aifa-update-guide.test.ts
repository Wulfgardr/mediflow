/* @Codex: invented UI ports/receipts only; these tests do not qualify the server owner or SQLite. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAifaGuideStatus, createAifaUpdateGuide, type AifaGuideState } from './aifa-update-guide.ts';
import { updateAifaCatalog } from './aifa-importer.ts';
import type { AifaCatalogClientStatus, AifaImportClientResult } from './aifa-importer.ts';
import type { AifaCatalogManifestInput } from './aifa-catalog.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function catalog(version = 'synthetic-old', count = 3): AifaImportClientResult {
    return { state: 'ready', count, rejectedRecords: 0, totalRecords: count, manifest: {
        format: 'mediflow.aifa-catalog-manifest.v1', source: 'Agenzia Italiana del Farmaco (AIFA)',
        sourceUrl: 'https://example.invalid/synthetic.csv', downloadedAt: '2026-09-01', version,
        reuseTermsUrl: 'https://www.aifa.gov.it/copyright', reuseStatus: 'source-artifact-review-required',
        sha256: (version === 'synthetic-old' ? 'a' : 'b').repeat(64), fileName: 'synthetic.csv', rowCount: count,
        importedAt: '2026-09-01T12:00:00.000Z',
    } };
}
const empty: AifaCatalogClientStatus = { count: 0, manifest: null, state: 'not-imported' };
const file = () => new File(['entirely invented CSV fixture'], 'synthetic.csv', { type: 'text/csv' });
const metadata = (): AifaCatalogManifestInput => ({ sourceUrl: 'https://example.invalid/synthetic.csv', downloadedAt: '2026-09-01', version: 'synthetic-input' });
const yes = async () => true;
function fixture() {
    let observed: AifaCatalogClientStatus = catalog();
    const events: AifaGuideState[] = [];
    const calls = { read: 0, update: 0, import: 0, clear: 0 };
    const ports = {
        read: async () => { calls.read++; return observed; },
        update: async (_signal: AbortSignal) => { calls.update++; const result = catalog('synthetic-new', 4); observed = result; return result; },
        importFile: async (_file: File, _manifest: AifaCatalogManifestInput) => { calls.import++; const result = catalog('synthetic-manual', 5); observed = result; return result; },
        clear: async () => { calls.clear++; observed = empty; },
    };
    const guide = createAifaUpdateGuide(ports, state => events.push(state));
    return { guide, ports, events, calls, last: () => events.at(-1)!, setObserved: (value: AifaCatalogClientStatus) => { observed = value; } };
}

test('constructing the guide performs nothing; mount/read has no update, import or clear', async () => {
    const f = fixture();
    assert.equal(f.events.length, 0);
    assert.deepEqual(f.calls, { read: 0, update: 0, import: 0, clear: 0 });
    await f.guide.refresh();
    assert.deepEqual(f.calls, { read: 1, update: 0, import: 0, clear: 0 });
    assert.equal(f.last().catalog?.count, 3);
    assert.ok(f.last().observedAt);
});

test('explicit update retains prior catalog until POST and fresh read finish; repeated writers are ignored', async () => {
    const f = fixture(); await f.guide.refresh();
    const pending = deferred<AifaImportClientResult>();
    f.ports.update = async () => { f.calls.update++; return pending.promise; };
    const run = f.guide.update();
    assert.equal(f.last().phase, 'updating'); assert.equal(f.last().catalog?.count, 3);
    await Promise.all([f.guide.update(), f.guide.importFile(file(), metadata(), yes), f.guide.clear(yes), f.guide.refresh()]);
    assert.deepEqual(f.calls, { read: 1, update: 1, import: 0, clear: 0 });
    f.setObserved(catalog('synthetic-new', 4)); pending.resolve(catalog('synthetic-new', 4)); await run;
    assert.equal(f.last().phase, 'idle'); assert.equal(f.last().catalog?.count, 4);
    assert.equal(f.last().notice?.tone, 'success'); assert.equal(f.calls.read, 2);
});

test('cancel propagates one abort, retains the old observation and requires explicit reconciliation', async () => {
    const f = fixture(); await f.guide.refresh(); let aborts = 0;
    f.ports.update = signal => { f.calls.update++; return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborts++; reject(signal.reason); }, { once: true });
    }); };
    const run = f.guide.update(); f.guide.cancel(); f.guide.cancel();
    assert.equal(f.last().phase, 'cancelling'); await run;
    assert.equal(aborts, 1); assert.equal(f.last().catalog?.count, 3);
    assert.equal(f.last().reconciliationRequired, true); assert.match(f.last().notice!.text, /non è confermato/u);
    await f.guide.update(); assert.equal(f.calls.update, 1, 'no retry before readback');
    await f.guide.refresh(); assert.equal(f.last().reconciliationRequired, false);
    assert.equal(f.calls.update, 1, 'readback does not retry the write');
});

test('a POST acknowledged after cancellation is not reported as rollback', async () => {
    const f = fixture(); await f.guide.refresh(); const pending = deferred<AifaImportClientResult>();
    f.ports.update = async () => pending.promise;
    const run = f.guide.update(); f.guide.cancel();
    const result = catalog('synthetic-committed', 4); f.setObserved(result); pending.resolve(result); await run;
    assert.equal(f.last().catalog?.count, 4); assert.equal(f.last().reconciliationRequired, false);
    assert.match(f.last().notice!.text, /nonostante la richiesta di annullamento/u);
});

test('server acknowledgement followed by read failure is distinct from failed import; no repeat download', async () => {
    const f = fixture(); await f.guide.refresh();
    f.ports.read = async () => { throw new Error('invented read failure'); };
    await f.guide.update();
    assert.match(f.last().notice!.text, /Importazione confermata dal server; rilettura non riuscita/u);
    assert.equal(f.last().catalog?.count, 3); assert.equal(f.last().reconciliationRequired, true);
    await f.guide.clear(yes); await f.guide.update();
    assert.equal(f.calls.clear, 0); assert.equal(f.calls.update, 1);
    await f.guide.refresh(); assert.equal(f.last().reconciliationRequired, true);
    f.ports.read = async () => catalog('synthetic-new', 4); await f.guide.refresh();
    assert.equal(f.last().catalog?.count, 4); assert.equal(f.last().reconciliationRequired, false);
    assert.equal(f.calls.update, 1);
});

test('failed update and failed status read never erase the previous catalog or manufacture success', async () => {
    const f = fixture(); await f.guide.refresh(); const previous = f.last().catalog;
    f.ports.update = async () => { throw new Error('Aggiornamento AIFA non riuscito; catalogo conservato'); };
    await f.guide.update(); assert.equal(f.last().catalog, previous); assert.equal(f.last().notice?.tone, 'error');
    f.ports.read = async () => { throw new Error('invented read error'); };
    await f.guide.refresh(); assert.equal(f.last().catalog, previous); assert.equal(f.last().reconciliationRequired, true);
});

test('late initial status cannot overwrite the newer post-update observation', async () => {
    const f = fixture(); const initial = deferred<AifaCatalogClientStatus>();
    let reads = 0; f.ports.read = async () => ++reads === 1 ? initial.promise : catalog('synthetic-new', 4);
    const mount = f.guide.refresh(); await f.guide.update();
    initial.resolve(catalog()); await mount;
    assert.equal(f.last().catalog?.count, 4); assert.equal(f.last().reading, false);
});

test('two explicit reads publish only the most recent read, even when the older one fails', async () => {
    for (const rejectOlder of [false, true]) {
        const f = fixture(); const first = deferred<AifaCatalogClientStatus>(); let reads = 0;
        f.ports.read = async () => ++reads === 1 ? first.promise : empty;
        const older = f.guide.refresh(); await f.guide.refresh();
        if (rejectOlder) first.reject(new Error('old read')); else first.resolve(catalog());
        await older; assert.equal(f.last().catalog?.state, 'not-imported'); assert.equal(f.last().notice, null);
    }
});

test('a different post-update catalog is displayed as concurrent state, not as the acknowledged acquisition', async () => {
    const f = fixture(); f.ports.read = async () => empty; await f.guide.update();
    assert.equal(f.last().catalog?.count, 0); assert.equal(f.last().notice?.tone, 'warning');
    assert.match(f.last().notice!.text, /catalogo corrente è diverso/u);
});

test('dispose aborts the download and suppresses subsequent read, publish and write', async () => {
    const f = fixture(); const pending = deferred<AifaImportClientResult>(); let signal: AbortSignal | undefined;
    f.ports.update = async value => { signal = value; return pending.promise; };
    const run = f.guide.update(); const before = f.events.length; f.guide.dispose(); f.guide.dispose();
    assert.equal(signal?.aborted, true); pending.resolve(catalog('synthetic-new')); await run;
    await f.guide.refresh(); await f.guide.update(); await f.guide.clear(yes);
    assert.equal(f.events.length, before); assert.equal(f.calls.read, 0); assert.equal(f.calls.clear, 0);
});

test('pending import confirmation holds the UI write slot and captures metadata before the dialog', async () => {
    const f = fixture(); const choice = deferred<boolean>(); const m = metadata(); let received = '';
    f.ports.importFile = async (_file, meta) => { received = meta.version; f.calls.import++; return catalog(); };
    const run = f.guide.importFile(file(), m, () => choice.promise); m.version = 'changed-after-dialog';
    await f.guide.update(); await f.guide.clear(yes); await f.guide.importFile(file(), metadata(), yes);
    assert.deepEqual(f.calls, { read: 0, update: 0, import: 0, clear: 0 });
    choice.resolve(true); await run; assert.equal(received, 'synthetic-input'); assert.equal(f.calls.import, 1);
});

test('declined import and declined clear release the slot without sending a write', async () => {
    const f = fixture(); await f.guide.importFile(file(), metadata(), async () => false); await f.guide.clear(async () => false);
    assert.equal(f.last().phase, 'idle'); assert.equal(f.last().reconciliationRequired, false);
    assert.deepEqual(f.calls, { read: 0, update: 0, import: 0, clear: 0 });
    await f.guide.update(); assert.equal(f.calls.update, 1);
});

test('unmount during confirmation prevents the deferred import from running', async () => {
    const f = fixture(); const choice = deferred<boolean>();
    const run = f.guide.importFile(file(), metadata(), () => choice.promise); f.guide.dispose(); choice.resolve(true); await run;
    assert.equal(f.calls.import, 0);
});

test('manual CSV rejected rows remain visible; the manual import contract is not silently tightened', async () => {
    const f = fixture(); const result = { ...catalog('synthetic-partial', 4), rejectedRecords: 2, totalRecords: 6 };
    f.ports.importFile = async () => result; f.setObserved(result);
    await f.guide.importFile(file(), metadata(), yes);
    assert.equal(f.last().catalog?.count, 4); assert.match(f.last().notice!.text, /2 righe scartate/u);
});

test('clear failure is recovered inline; success is reported only after reading the empty state', async () => {
    const f = fixture(); await f.guide.refresh();
    f.ports.clear = async () => { throw new Error('invented delete failure'); };
    await f.guide.clear(yes); assert.equal(f.last().phase, 'idle'); assert.equal(f.last().catalog?.count, 3);
    assert.equal(f.last().reconciliationRequired, true); await f.guide.refresh();
    f.ports.clear = async () => { f.setObserved(empty); }; await f.guide.clear(yes);
    assert.equal(f.last().catalog?.count, 0); assert.match(f.last().notice!.text, /Svuotamento confermato/u);
});

test('confirmation errors do not mark a never-sent mutation as having an unknown server result', async () => {
    const f = fixture(); await f.guide.clear(async () => { throw new Error('invented dialog failure'); });
    assert.equal(f.last().phase, 'idle'); assert.equal(f.last().reconciliationRequired, false);
    assert.equal(f.calls.clear, 0); assert.equal(f.last().notice?.tone, 'error');
});

test('invalid payloads cannot manufacture a green catalog and preserve prior observation', async () => {
    for (const invalid of [null, {}, { count: -1, manifest: null, state: 'ready' }, { ...catalog(), manifest: null },
        { ...empty, count: 8 }, { ...catalog(), rejectedRecords: 1 }, { ...catalog(), totalRecords: undefined }]) {
        const f = fixture(); await f.guide.refresh();
        f.ports.update = async () => invalid as AifaImportClientResult;
        await f.guide.update(); assert.equal(f.last().catalog?.count, 3);
        assert.equal(f.last().reconciliationRequired, true); assert.equal(f.last().notice?.tone, 'error');
    }
    assert.doesNotThrow(() => assertAifaGuideStatus({ count: 2, manifest: null, state: 'unverified' }));
});

test('real client sends a single empty POST to the fixed local route with the original signal', async t => {
    const abort = new AbortController(); const requests: Array<{ url: unknown; init: RequestInit | undefined }> = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
        requests.push({ url, init }); return Response.json(catalog());
    });
    const result = await updateAifaCatalog(abort.signal);
    assert.equal(result.count, 3); assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/drugs/update');
    assert.deepEqual(requests[0].init, { method: 'POST', signal: abort.signal });
});

test('real client preserves server errors and propagates request cancellation without retry', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'Conflitto sintetico' }, { status: 409 }); });
    await assert.rejects(updateAifaCatalog(new AbortController().signal), /Conflitto sintetico/u);
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => { calls++;
        return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
    });
    const abort = new AbortController(); const pending = updateAifaCatalog(abort.signal); abort.abort();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 2);
});
