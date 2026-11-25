import 'server-only';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { connect } from 'node:tls';
import { resolveDataPath } from './data-dir';

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

export async function readNetworkPairingEndpoint(displayName?: string): Promise<NetworkPairingEndpoint | null> {
    try {
        const descriptor = JSON.parse(await readFile(resolveDataPath('runtime-status.json'), 'utf8')) as Record<string, unknown>;
        const { bindHost, port, certPath } = descriptor;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
            || typeof certPath !== 'string' || typeof bindHost !== 'string') return null;

        const addresses = Object.entries(networkInterfaces()).sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([, entries]) => entries ?? [])
            .filter(address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))
            .map(address => address.address)
            .filter(address => bindHost === '0.0.0.0' || bindHost === '::' || bindHost === address);
        if (!addresses.length) return null;

        const certificate = new X509Certificate(await readFile(certPath));
        const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
        const address = addresses[0];
        const probeHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost === '::' ? '::1' : address;
        await presentsCertificate(probeHost, port, fingerprint);
        const computer = (displayName?.trim() || hostname()).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 63).trim() || 'MediFlow';
        return { origin: new URL(`https://${address}:${port}`).origin, fingerprint, computer };
    } catch {
        return null;
    }
}
