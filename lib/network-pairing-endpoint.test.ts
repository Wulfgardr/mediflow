import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { after, before, mock, test } from 'node:test';

const directory = mkdtempSync(join(os.tmpdir(), 'mediflow-pairing-endpoint-'));
let server: tls.Server;

const iface = (address: string, mac: string): os.NetworkInterfaceInfo => ({
    address, netmask: '255.255.255.0', family: 'IPv4', mac, internal: false, cidr: `${address}/24`,
});

before(async () => {
    process.env.MEDIFLOW_DATA_DIR = directory;
    const certPath = join(directory, 'local-api.crt'), keyPath = join(directory, 'local-api.key');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=MediFlow',
        '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    server = tls.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    writeFileSync(join(directory, 'runtime-status.json'), JSON.stringify({ bindHost: '0.0.0.0', port, certPath }));
});

after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
});

test('a virtual-machine bridge listed before Wi-Fi does not become the address in the QR', async () => {
    mock.method(os, 'networkInterfaces', () => ({
        lo0: [{ ...iface('127.0.0.1', '00:00:00:00:00:00'), internal: true }],
        bridge100: [iface('10.211.55.2', '3e:a6:f6:00:00:64')],
        bridge101: [iface('10.37.129.2', '3e:a6:f6:00:00:65')],
        en0: [iface('172.20.10.3', '7c:00:00:00:00:01')],
    }));
    syncBuiltinESMExports();
    const { readNetworkPairingEndpoint } = await import('./network-pairing-endpoint.ts');
    const endpoint = await readNetworkPairingEndpoint('Mac di prova');
    assert.ok(endpoint);
    assert.equal(new URL(endpoint.origin).hostname, '172.20.10.3');
});
