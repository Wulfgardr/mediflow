import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDossierPorts } from './document-dossier-ports';

/* Synthetic catalog shaped like app/api/exemptions: the plain list stops at the
 * first 100 codes in order, only `all=1` returns the whole catalog. */
test('the dossier reads the whole exemption catalog, beyond the first 100 codes', async () => {
    const catalog = [...Array.from({ length: 100 }, (_, n) => `0${String(n + 1).padStart(3, '0')}`), '031'];
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        if (!url.startsWith('/api/exemptions')) return new Response('not found', { status: 404 });
        const rows = (url === '/api/exemptions?all=1' ? catalog : catalog.slice(0, 100)).map((code) => ({ code, description: `Esenzione ${code}` }));
        return Response.json(rows);
    }) as typeof fetch;
    try {
        const codes = await createDossierPorts().exemptionCodes(new AbortController().signal);
        assert.ok(codes.has('031'), `codici letti: ${codes.size}, richieste: ${requested.join(' ')}`);
        assert.equal(codes.size, 101);
    } finally {
        globalThis.fetch = original;
    }
});
