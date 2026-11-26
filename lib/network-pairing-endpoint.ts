import 'server-only';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { connect } from 'node:tls';
import { createSocket } from 'node:dgram';
import { resolveDataPath } from './data-dir';
import { choosePairingAddress } from './network-pairing-address';

export type NetworkPairingEndpoint = { origin: string; fingerprint: string; computer: string };

function presentsCertificate(host: string, port: number, fingerprint: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect({ host, port, rejectUnauthorized: false });
        socket.setTimeout(1000, () => socket.destroy(new Error('TLS endpoint timed out')));
        socket.once('error', reject);
        socket.once('secureConnect', () => {
            const presented = socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase();
            socket.destroy();
            if (presented === fingerprint) resolve(host);
            else reject(new Error('TLS endpoint certificate mismatch'));
        });
    });
}

function readDefaultRouteAddress(): Promise<string | undefined> {
    return new Promise(resolve => {
        const socket = createSocket('udp4');
        const finish = (address?: string) => {
            socket.removeAllListeners();
            socket.close();
            resolve(address);
        };
        socket.once('error', () => finish());
        socket.connect(9, '192.0.2.1', () => finish(socket.address().address));
    });
}

export async function readNetworkPairingEndpoint(displayName?: string): Promise<NetworkPairingEndpoint | null> {
    try {
        const descriptor = JSON.parse(await readFile(resolveDataPath('runtime-status.json'), 'utf8')) as Record<string, unknown>;
        const { bindHost, port, certPath } = descriptor;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
            || typeof certPath !== 'string' || typeof bindHost !== 'string') return null;

        const address = choosePairingAddress(networkInterfaces(), bindHost, await readDefaultRouteAddress());
        if (!address) return null;

        const certificate = new X509Certificate(await readFile(certPath));
        const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
        const probeHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost === '::' ? '::1' : address;
        await presentsCertificate(probeHost, port, fingerprint);
        const computer = (displayName?.trim() || hostname()).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 63).trim() || 'MediFlow';
        return { origin: new URL(`https://${address}:${port}`).origin, fingerprint, computer };
    } catch {
        return null;
    }
}
