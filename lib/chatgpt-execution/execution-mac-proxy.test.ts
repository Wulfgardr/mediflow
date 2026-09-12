/* @Codex — isolated loopback only. No DNS or upstream socket is real in this test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
const { createForTest } = await import('./execution-egress-proxy.ts');
async function connectAttempt(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1'); let text = '';
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('synthetic socket timeout')); }, 1500);
        socket.once('connect', () => socket.write('CONNECT auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com:443\r\n\r\n'));
        socket.on('data', b => { text += b.toString(); socket.destroy(); });
        socket.on('error', reject);
        socket.once('close', () => { clearTimeout(timer); resolve(text); });
    });
}
test('closed preparation gate rejects before DNS, activation preserves existing CONNECT policy, close is permanent', async () => {
    let lookups = 0, connections = 0;
    const proxy = await createForTest({ initiallyClosed: true,
        lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; },
        connect: () => { connections++; return { socket: new PassThrough(), connected: Promise.resolve() }; } });
    try {
        assert.equal(await connectAttempt(proxy.port), ''); assert.equal(lookups, 0); assert.equal(connections, 0);
        assert.equal(proxy.activate(), true);
        assert.match(await connectAttempt(proxy.port), /^HTTP\/1.1 200 Connection Established/);
        assert.equal(lookups, 1); assert.equal(connections, 1);
    } finally { await proxy.close(); }
    assert.equal(proxy.activate(), false); await proxy.close();
});
