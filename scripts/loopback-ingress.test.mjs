import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { installLoopbackIngress, hasAttestedLoopbackIngress, isLoopbackAddress, proxyLoopbackHeaders } from '../lib/security/loopback-ingress.mjs';

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
        assert.equal(await call('127.0.0.1', {host}), true);
    }
});
test('loopback peer classification accepts literal loopback and mapped IPv4, never host names', () => {
    for (const ip of ['::1', '127.0.0.1', '127.8.2.1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(ip), true);
    for (const ip of ['localhost', 'mediflow.local', '192.0.2.1', '::ffff:192.0.2.1', '127.attacker', undefined]) assert.equal(isLoopbackAddress(ip), false);
});
