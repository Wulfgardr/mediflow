import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import * as auth from '../security/server-auth';
import { GET } from '../../app/api/ai/models/route';

// I-1: con Ollama assente, bloccato, malformato o al limite d'uso la lettura dei
// modelli resta una risposta onesta e limitata nel tempo, mai un errore interno.
type Mode = 'hang' | 'malformed' | 'quota';
let mode: Mode = 'hang';
const held = new Set<http.ServerResponse>();
const provider = http.createServer((_request, response) => {
    if (mode === 'hang') { held.add(response); return; }
    if (mode === 'malformed') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"models": [ {"name": "sintetico'); return; }
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'usage limit reached' }));
});
let providerOrigin = '';
let absentOrigin = '';
before(async () => {
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    providerOrigin = new URL(`http://127.0.0.1:${(provider.address() as AddressInfo).port}`).origin;
    // A listener closed before use gives a loopback port where nothing answers.
    const closed = http.createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    absentOrigin = new URL(`http://127.0.0.1:${(closed.address() as AddressInfo).port}`).origin;
    await new Promise<void>(resolve => closed.close(() => resolve()));
});
after(async () => {
    for (const response of held) response.destroy();
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
});

async function readModels(target: string): Promise<{ status: number; body: Record<string, unknown>; ms: number }> {
    mock.method(auth, 'requireSessionOrLocalToken', async () => ({ userId: 'synthetic-inventory', role: 'user' }));
    const started = performance.now();
    const response = await GET(new NextRequest(new URL('/api/ai/models', 'http://127.0.0.1:3000'), { headers: { 'x-target-url': target } }));
    mock.restoreAll();
    return { status: response.status, body: await response.json() as Record<string, unknown>, ms: performance.now() - started };
}

test('nessun processo in ascolto: provider non pronto, non errore interno', async () => {
    const result = await readModels(absentOrigin);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'provider_unready');
});

test('provider che risponde con un corpo non JSON: provider non pronto', async () => {
    mode = 'malformed';
    const result = await readModels(providerOrigin);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'provider_unready');
});

test('provider al limite d\'uso: lo stato del provider resta visibile', async () => {
    mode = 'quota';
    const result = await readModels(providerOrigin);
    assert.equal(result.status, 429);
});

test('provider che accetta e non risponde: la lettura termina prima dell\'attesa del browser', { timeout: 20_000 }, async () => {
    mode = 'hang';
    const result = await readModels(providerOrigin);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'provider_unready');
    // The settings page stops waiting after 15 s: the server must answer first.
    assert.ok(result.ms < 15_000, `risposta dopo ${Math.round(result.ms)} ms`);
});
