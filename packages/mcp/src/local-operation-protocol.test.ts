import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalOperationProtocol } from './local-operation-server.ts';

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-census', version: '1' },
} };
function fixture() {
    let closes = 0, requests = 0;
    const protocol = createLocalOperationProtocol({
        async request() { requests++; return { schema: 'mediflow.local-operation.v1', status: 'unavailable' }; },
        close() { closes++; },
    });
    return { send: (frame: unknown) => protocol.receive(JSON.stringify(frame)),
        get closes() { return closes; }, get requests() { return requests; } };
}

test('WUL-835: una notifica JSON-RPC valida non produce risposta dopo initialize', async () => {
    const f = fixture();
    assert.equal(JSON.parse((await f.send(initialize))!).id, 1);
    const response = await f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } });
    assert.equal(f.requests, 0);
    assert.equal(response, null, 'JSON-RPC 2.0 §4.1 vieta risposte alle notifiche, anche non supportate');
});

test('WUL-835: una notifica non autorizza richieste e non produce risposta prima di initialize', async () => {
    const f = fixture();
    const response = await f.send({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
    assert.equal(f.requests, 0);
    assert.equal(response, null);
});

test('WUL-835 controllo: initialized tace, ping risponde, nessuna chiamata applicativa', async () => {
    const f = fixture();
    await f.send(initialize);
    assert.equal(await f.send({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.deepEqual(JSON.parse((await f.send({ jsonrpc: '2.0', id: 2, method: 'ping' }))!), { jsonrpc: '2.0', id: 2, result: {} });
    assert.equal(f.requests, 0);
});

test('WUL-835 controllo: il limite documentato di 64 frame chiude esplicitamente il protocollo', async () => {
    const f = fixture();
    await f.send(initialize);
    for (let id = 2; id <= 64; id++) assert.equal(JSON.parse((await f.send({ jsonrpc: '2.0', id, method: 'ping' }))!).id, id);
    const response = JSON.parse((await f.send({ jsonrpc: '2.0', id: 65, method: 'ping' }))!);
    assert.equal(response.error.code, -32602);
    assert.equal(f.closes, 1);
    assert.equal(await f.send({ jsonrpc: '2.0', id: 66, method: 'ping' }), null);
    assert.equal(f.requests, 0);
});

for (const initialized of [false, true]) {
    test(`notifiche senza effetti applicativi (initialized=${initialized})`, async () => {
        const f = fixture();
        if (initialized) await f.send(initialize);
        for (const notification of [
            { method: 'initialize', params: initialize.params },
            { method: 'ping' },
            { method: 'tools/list' },
            { method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: { action: 'open' } } },
            { method: 'unknown', params: { arbitrary: true } },
            { method: 'notifications/initialized', params: { arbitrary: true } },
        ]) {
            assert.equal(await f.send({ jsonrpc: '2.0', ...notification }), null);
            assert.equal(f.requests, 0);
        }
        assert.equal(f.closes, 0);
        if (!initialized) assert.ok(JSON.parse((await f.send(initialize))!).result);
    });
}
