/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AifaDrug } from './db';
import {
    commitDrugAutocompleteQueryChange,
    createDrugAutocompleteSearch,
    fetchDrugAutocomplete,
} from './drug-autocomplete-search';

function jsonResponse(body: unknown, catalogState = 'ready'): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'X-MediFlow-Aifa-Catalog': catalogState },
    });
}

test('production helper notifies auth failures without exposing the query or notifying on 5xx', async (t) => {
    const notified: number[] = [];
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        dispatchEvent: (event: CustomEvent<{ status: number }>) => notified.push(event.detail.status),
    } });
    t.after(() => originalWindow
        ? Object.defineProperty(globalThis, 'window', originalWindow)
        : Reflect.deleteProperty(globalThis, 'window'));

    for (const status of [401, 403, 500]) {
        await assert.rejects(
            fetchDrugAutocomplete('query-riservata', new AbortController().signal, async () => new Response(null, { status })),
            (error: unknown) => error instanceof Error && !error.message.includes('query-riservata'),
        );
    }
    assert.deepEqual(notified, [401, 403]);
});

test('production helper sends the full query, preserves payloads, and caps results at 30', async () => {
    let requestedUrl = '';
    const candidates = Array.from({ length: 35 }, (_, index): AifaDrug => ({
        aic: String(index).padStart(9, '0'),
        name: `Farmaco ${index}`,
        activePrinciple: 'Principio sintetico',
        packaging: '500 mg compresse',
        company: 'Azienda sintetica',
        price: 1234,
    }));
    const fetchImpl: typeof fetch = async (input) => {
        requestedUrl = String(input);
        return jsonResponse(candidates);
    };

    const results = await fetchDrugAutocomplete('  Farmaco principio 500  ', new AbortController().signal, fetchImpl);

    assert.equal(requestedUrl, '/api/drugs?q=Farmaco%20principio%20500&limit=30');
    assert.equal(results.items.length, 30);
    assert.deepEqual(results.items[0], candidates[0]);
    assert.equal(results.catalogState, 'ready');
});

test('production helper exposes an honest not-imported state for an empty catalog', async () => {
    const result = await fetchDrugAutocomplete(
        'Farmaco',
        new AbortController().signal,
        async () => jsonResponse([], 'not-imported'),
    );

    assert.deepEqual(result, { items: [], catalogState: 'not-imported' });
});

test('coordinator aborts the prior request and suppresses its stale response', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((resolve) => {
        pending.push({ signal: init?.signal as AbortSignal, resolve });
    });
    const search = createDrugAutocompleteSearch(fetchImpl);

    const first = search.run('Primo farmaco');
    let committedQuery = '';
    commitDrugAutocompleteQueryChange(search, (value) => { committedQuery = value; }, 'Secondo farmaco');
    assert.equal(committedQuery, 'Secondo farmaco');
    assert.equal(pending[0].signal.aborted, true);

    const second = search.run('Secondo farmaco');

    pending[1].resolve(jsonResponse([{ aic: '2', name: 'Secondo farmaco' }]));
    assert.deepEqual(await second, {
        items: [{ aic: '2', name: 'Secondo farmaco' }],
        catalogState: 'ready',
    });

    pending[0].resolve(jsonResponse([{ aic: '1', name: 'Primo farmaco' }]));
    let newerLoading = true;
    if (await first !== null) newerLoading = false;
    assert.equal(newerLoading, true);

    const selected = search.run('Secondo farmaco');
    let isLoading = true;
    commitDrugAutocompleteQueryChange(search, () => {}, 'Secondo farmaco', () => { isLoading = false; });
    assert.equal(isLoading, false);
    assert.equal(pending[2].signal.aborted, true);
    pending[2].resolve(jsonResponse([{ aic: '2', name: 'Secondo farmaco' }]));
    assert.equal(await selected, null);
});
