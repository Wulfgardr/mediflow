import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installaAmbienteOperatore } from './ambiente.ts';
import { avviaSeServe } from './avvio.ts';

async function serverDiProva(risposta: (url: string, headers: IncomingHttpHeaders) => { status?: number; headers?: Record<string, string | string[]>; body?: string }) {
    const visti: Array<{ url: string; method: string; headers: IncomingHttpHeaders }> = [];
    const server = createServer((request, response) => {
        visti.push({ url: request.url ?? '', method: request.method ?? '', headers: request.headers });
        const esito = risposta(request.url ?? '', request.headers);
        response.writeHead(esito.status ?? 200, esito.headers ?? {});
        response.end(esito.body ?? '{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${port}`, visti, chiudi: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test('l’operatore lavora solo sul loopback e non chiama indirizzi fuori da MediFlow', async () => {
    const originale = globalThis.fetch;
    try {
        assert.throws(() => installaAmbienteOperatore({ origin: 'http://192.168.1.10:3000', storageFile: null }), /solo sul loopback/u);
        installaAmbienteOperatore({ origin: 'http://127.0.0.1:9', storageFile: null });
        await assert.rejects(globalThis.fetch('http://example.invalid/api/patients'), /fuori da MediFlow/u);
    } finally { globalThis.fetch = originale; }
});

test('le richieste portano cookie, intestazioni same-origin e identificativo dell’operatore; i cookie HttpOnly restano fuori da document.cookie', async () => {
    const originale = globalThis.fetch;
    const server = await serverDiProva(url => url === '/api/auth/login'
        ? { headers: { 'set-cookie': ['mediflow_session=abc; Path=/; HttpOnly', 'ambulatory_id=sede-1; Path=/'] } }
        : url === '/api/auth/logout' ? { headers: { 'set-cookie': 'mediflow_session=; Path=/; Max-Age=0' } } : {});
    try {
        const ambiente = installaAmbienteOperatore({ origin: server.origin, storageFile: null });
        await fetch('/api/auth/login', { method: 'POST', body: '{}' });
        await fetch('/api/patients');
        const documento = (globalThis as unknown as { document: { cookie: string } }).document;
        assert.equal(documento.cookie, 'ambulatory_id=sede-1');
        await fetch('/api/auth/logout', { method: 'POST', body: '{}' });
        await fetch('/api/patients');
        const [login, lettura, , dopo] = server.visti;
        assert.equal(login.headers.origin, server.origin);
        assert.equal(login.headers['sec-fetch-site'], 'same-origin');
        assert.equal(lettura.headers.origin, undefined);
        assert.equal(lettura.headers.cookie, 'mediflow_session=abc; ambulatory_id=sede-1');
        assert.equal(dopo.headers.cookie, 'ambulatory_id=sede-1');
        assert.deepEqual(server.visti.map(visto => visto.headers['x-request-id']), [1, 2, 3, 4].map(n => `${ambiente.richiestaPrefisso}-${n}`));
        assert.match(ambiente.richiestaPrefisso, /^mfop-[0-9a-f]{8}$/u);
    } finally { globalThis.fetch = originale; await server.chiudi(); }
});

test('avvia non tocca un MediFlow già attivo e avvia senza launcher quello spento', async () => {
    const attivo = await serverDiProva(() => ({ body: JSON.stringify({ revision: 'rev-attiva' }) }));
    const cartella = mkdtempSync(path.join(tmpdir(), 'mediflow-operatore-avvio-'));
    try {
        const installazione = path.join(cartella, 'installazione');
        mkdirSync(path.join(installazione, 'scripts'), { recursive: true });
        writeFileSync(path.join(installazione, 'scripts', 'mediflow.mjs'), `
            import { createServer } from 'node:http';
            const args = process.argv.slice(2).join(' ');
            if (args !== '--scelta web --senza-browser') process.exit(9);
            const server = createServer((request, response) => { response.end(JSON.stringify({ revision: 'rev-avviata' })); });
            server.listen(Number(process.env.PORT), '127.0.0.1');
            setTimeout(() => server.close(), 15000).unref?.();
            setTimeout(() => process.exit(0), 15000);
        `);
        const gia = await avviaSeServe({ origin: attivo.origin, installazione, cartellaStato: path.join(cartella, 'stato'), attesaMs: 5_000 });
        assert.deepEqual(gia, { avviato: false, revisione: 'rev-attiva' });

        const libero = await serverDiProva(() => ({}));
        await libero.chiudi();
        const avviato = await avviaSeServe({ origin: libero.origin, installazione, cartellaStato: path.join(cartella, 'stato'), attesaMs: 12_000 });
        assert.deepEqual(avviato, { avviato: true, revisione: 'rev-avviata' });
    } finally {
        await attivo.chiudi();
        rmSync(cartella, { recursive: true, force: true });
    }
});
