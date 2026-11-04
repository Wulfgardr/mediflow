import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { installLoopbackIngress, hasAttestedLoopbackIngress, hasRejectedIngressHost, isLoopbackAddress, isLoopbackHostHeader, proxyLoopbackHeaders } from '../lib/security/loopback-ingress.mjs';

installLoopbackIngress();
test('socket boundary replaces forged attestations and distinguishes proxy LAN from loopback for every host alias', async t => {
    const server = http.createServer((req, res) => {
        const request = new Request(`http://${req.headers.host}${req.url}`, { headers: req.headers });
        res.end(JSON.stringify(hasAttestedLoopbackIngress(request)));
    });
    server.listen(0, '::'); await once(server, 'listening');
    t.after(() => server.close());
    const port = server.address().port;
    const call = (hostname, headers) => new Promise((resolve, reject) => {
        http.get({hostname, port, headers}, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(JSON.parse(body))); }).on('error', reject);
    });
    for (const host of ['127.0.0.1', '[::1]', 'localhost', 'mediflow.local']) {
        const forged = { host, 'x-mediflow-server-loopback': 'a'.repeat(64), 'x-mediflow-proxy-loopback': 'a'.repeat(64) };
        assert.equal(await call('127.0.0.1', forged), false);
        assert.equal(await call('127.0.0.1', { ...proxyLoopbackHeaders(forged, '192.0.2.5'), 'x-mediflow-tls-proxy': 'local-api' }), false);
        assert.equal(await call('::1', { ...proxyLoopbackHeaders(forged, '::1'), 'x-mediflow-tls-proxy': 'local-api' }), true);
        // A direct loopback request under a foreign Host is a rebound page of another site: never attested.
        assert.equal(await call('127.0.0.1', {host}), host !== 'mediflow.local');
    }
});
test('DNS rebinding: a direct loopback request with a foreign Host is marked rejected, a forwarded LAN request is not', async t => {
    const server = http.createServer((req, res) => {
        const request = new Request(`http://127.0.0.1${req.url}`, { headers: req.headers });
        res.end(JSON.stringify([hasAttestedLoopbackIngress(request), hasRejectedIngressHost(request)]));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => server.close());
    const port = server.address().port;
    const call = headers => new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, headers }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(JSON.parse(body))); }).on('error', reject);
    });
    const rebound = `attacker.example:${port}`;
    assert.deepEqual(await call({ host: rebound }), [false, true]);
    assert.deepEqual(await call({ host: `localhost.attacker.example:${port}` }), [false, true]);
    assert.deepEqual(await call({ host: `127.0.0.1.attacker.example:${port}` }), [false, true]);
    // Claiming the TLS proxy without its key does not lift the check, nor does a forged rejection marker survive.
    assert.deepEqual(await call({ host: rebound, 'x-mediflow-tls-proxy': 'local-api' }), [false, true]);
    assert.deepEqual(await call({ host: rebound, 'x-mediflow-tls-proxy': 'local-api', 'x-mediflow-proxy-forwarded': 'a'.repeat(64) }), [false, true]);
    assert.deepEqual(await call({ host: `127.0.0.1:${port}`, 'x-mediflow-ingress-host-rejected': 'a'.repeat(64) }), [true, false]);
    // The canonical forwarder carries a paired device's own Host: not a rebinding.
    assert.deepEqual(await call({ ...proxyLoopbackHeaders({ host: 'mediflow.local:3443' }, '192.0.2.5'), 'x-mediflow-tls-proxy': 'local-api' }), [false, false]);
    assert.deepEqual(await call({ ...proxyLoopbackHeaders({ host: 'mediflow.local:3443' }, '127.0.0.1'), 'x-mediflow-tls-proxy': 'local-api' }), [true, false]);
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `app.localhost:${port}`]) {
        assert.deepEqual(await call({ host }), [true, false], host);
    }
});
test('loopback Host classification accepts loopback names and declared aliases only', () => {
    for (const host of ['localhost', 'LOCALHOST:3000', '127.0.0.1', '127.8.2.1:3000', '[::1]:3000', 'mediflow.localhost:3000', undefined]) {
        assert.equal(isLoopbackHostHeader(host, ''), true, String(host));
    }
    for (const host of ['', 'attacker.example', 'localhost.attacker.example', '127.0.0.1.nip.io', '[::2]:3000', 'localhost:3000@attacker.example', 'local host', '127.0.0.1:3000/x', 'mediflow.local']) {
        assert.equal(isLoopbackHostHeader(host, ''), false, host);
    }
    assert.equal(isLoopbackHostHeader('mediflow.local:3000', 'studio.lan, mediflow.local'), true);
    assert.equal(isLoopbackHostHeader('other.local:3000', 'studio.lan, mediflow.local'), false);
});
test('loopback peer classification accepts literal loopback and mapped IPv4, never host names', () => {
    for (const ip of ['::1', '127.0.0.1', '127.8.2.1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(ip), true);
    for (const ip of ['localhost', 'mediflow.local', '192.0.2.1', '::ffff:192.0.2.1', '127.attacker', undefined]) assert.equal(isLoopbackAddress(ip), false);
});
