/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AifaDrug } from './db';
import {
    commitDrugAutocompleteQueryChange,
    createDrugAutocompleteSearch,
    fetchDrugAutocomplete,
} from './drug-autocomplete-search';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
}

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

    assert.equal(requestedUrl, '/api/drugs?q=Farmaco%20principio%20500');
    assert.equal(results.length, 30);
    assert.deepEqual(results[0], candidates[0]);
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
    assert.deepEqual(await second, [{ aic: '2', name: 'Secondo farmaco' }]);

    pending[0].resolve(jsonResponse([{ aic: '1', name: 'Primo farmaco' }]));
    assert.equal(await first, null);

    const unmounted = search.run('Terzo farmaco');
    search.abort();
    assert.equal(pending[2].signal.aborted, true);
    pending[2].resolve(jsonResponse([{ aic: '3', name: 'Terzo farmaco' }]));
    assert.equal(await unmounted, null);
});
