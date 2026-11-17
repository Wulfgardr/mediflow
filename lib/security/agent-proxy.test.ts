import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

function get(host: string, localAddress: string, port: number, path: string) {
    return new Promise<number>((accept, reject) => {
        const req = request({ host, port, path, localAddress, agent: false, rejectUnauthorized: false, headers: { 'x-forwarded-for': '127.0.0.1', 'x-mediflow-server-loopback': 'forged' } }, response => {
            response.resume(); response.once('end', () => accept(response.statusCode!));
        }); req.once('error', reject); req.end();
    });
}
test('actual TLS proxy sees a non-loopback socket, returns404 for agent routes and forwards only its permitted positive control', async () => {
    const addresses = Object.values(networkInterfaces()).flat().filter(value => value?.family === 'IPv4' && !value.internal);
    const address = process.env.MEDIFLOW_TEST_PROXY_ADDRESS ?? addresses[0]?.address;
    assert.ok(addresses.some(value => value?.address === address), 'Proxy proof address must belong to this machine');
    assert.ok(address, 'A real non-loopback local interface is required for the proxy peer proof');
    const proxyHost = process.platform === 'darwin' ? '127.0.0.1' : address;
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-proxy-'));
    const key = join(directory, 'synthetic.key'), cert = join(directory, 'synthetic.crt');
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=synthetic-agent-proxy', '-keyout', key, '-out', cert], { encoding: 'utf8' });
    assert.equal(generated.status, 0, 'Synthetic TLS generation failed');
    let forwarded = 0;
    const upstream = createServer((incoming, outgoing) => { forwarded++; assert.equal(incoming.headers['x-forwarded-for'], address); outgoing.end('synthetic-upstream'); });
    await new Promise<void>(accept => upstream.listen(0, '127.0.0.1', accept));
    const target = upstream.address(); assert.ok(target && typeof target === 'object');
    const child = spawn(process.execPath, [resolve('scripts/local-api-tls-proxy.mjs')], { env: { ...process.env,
        MEDIFLOW_DATA_DIR: directory, MEDIFLOW_TLS_CERT_PATH: cert, MEDIFLOW_TLS_KEY_PATH: key, MEDIFLOW_TLS_PORT: '0',
        MEDIFLOW_TLS_BIND_HOST: proxyHost, MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: `http://127.0.0.1:${target.port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise<void>(accept => child.once('close', () => accept()));
    let output = '';
    try {
        const port = await new Promise<number>((accept, reject) => {
            const timeout = setTimeout(() => reject(new Error('Synthetic proxy readiness timeout')), 10000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('exit', () => { clearTimeout(timeout); reject(new Error('Synthetic proxy exited before readiness')); });
            child.stdout.on('data', chunk => {
                output += chunk;
                const found = /TLS proxy listening on https:\/\/[^\s]+:(\d+)/u.exec(output);
                if (found) { clearTimeout(timeout); accept(Number(found[1])); }
            });
            child.stderr.on('data', chunk => { output += chunk; });
        });
        for (const path of ['/api/agent/v1/pairings', '/api/agent/v1/context', '/api/agent-mandates/pairings', '/api/%61gent/v1/context']) {
            assert.equal(await get(proxyHost, address, port, path), 404); assert.equal(forwarded, 0);
        }
        assert.equal(await get(proxyHost, address, port, '/api/patients'), 403); assert.equal(forwarded, 0);
        assert.equal(await get(proxyHost, address, port, '/api/auth/check'), 200); assert.equal(forwarded, 1);
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed;
        upstream.closeAllConnections(); await new Promise<void>(accept => upstream.close(() => accept())); rmSync(directory, { recursive: true, force: true });
    }
});
