/* @Codex */
import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect, isIP, Socket, type AddressInfo } from 'node:net';
import { Duplex } from 'node:stream';

const HEADER_LIMIT_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_CONNECTIONS = 4;
const MAX_HEAD_BYTES = 64 * 1024;
const CONNECT_PORT = 443;
const CONNECTED_RESPONSE = 'HTTP/1.1 200 Connection Established\r\n\r\n';

const ALLOWED_HOSTS = new Set(['auth.openai.com', 'chatgpt.com']);
const ALLOWED_TARGETS: ReadonlyMap<string, AllowedHost> = new Map([
    ['auth.openai.com:443', 'auth.openai.com'],
    ['chatgpt.com:443', 'chatgpt.com'],
]);

type AllowedHost = 'auth.openai.com' | 'chatgpt.com';
type AddressFamily = 4;
type ResolvedAddress = Readonly<{ address: string; family: AddressFamily }>;
type ConnectAddress = Readonly<{ address: string; family: AddressFamily; port: typeof CONNECT_PORT }>;

type UpstreamAttempt = Readonly<{ socket: Duplex; connected: Promise<void> }>;
type LookupAddress = (hostname: AllowedHost) => Promise<readonly ResolvedAddress[]>;
type ConnectAddressFn = (target: ConnectAddress) => UpstreamAttempt;
type TestOverrides = Readonly<{ lookup?: LookupAddress; connect?: ConnectAddressFn; initiallyClosed?: boolean }>;

type ProxyHandle = Readonly<{ port: number; activate(): boolean; close(): Promise<void> }>;
type ErrorStatus = 400 | 502 | 503;

type Tunnel = {
    client: Socket;
    upstream?: Duplex;
    head: Buffer;
    connected: boolean;
    closed: boolean;
};

function cidrContains(value: number, base: number, bits: number): boolean {
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
}

function ipv4Number(address: string): number | null {
    const parts = address.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part))) return null;
    const octets = parts.map(Number);
    if (octets.some(octet => octet > 255)) return null;
    return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

const BLOCKED_IPV4_RANGES: readonly Readonly<[number, number]>[] = [
    [0x00000000, 8], // unspecified and "this" network
    [0x0a000000, 8], // RFC 1918
    [0x64400000, 10], // RFC 6598 shared address space
    [0x7f000000, 8], // loopback
    [0xa9fe0000, 16], // link-local
    [0xac100000, 12], // RFC 1918
    [0xc0000000, 24], // IETF protocol assignments
    [0xc0000200, 24], // TEST-NET-1
    [0xc0586300, 24], // 6to4 relay anycast
    [0xc0a80000, 16], // RFC 1918
    [0xc6120000, 15], // benchmarking
    [0xc6336400, 24], // TEST-NET-2
    [0xcb007100, 24], // TEST-NET-3
    [0xe0000000, 4], // multicast
    [0xf0000000, 4], // reserved and broadcast
];

function blockedIpv4(address: string): boolean {
    const value = ipv4Number(address);
    return value === null || BLOCKED_IPV4_RANGES.some(([base, bits]) => cidrContains(value, base, bits));
}

function validateResolvedAddresses(raw: readonly ResolvedAddress[]): ResolvedAddress | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const addresses: ResolvedAddress[] = [];
    for (const candidate of raw) {
        if (!candidate || candidate.family !== 4 || typeof candidate.address !== 'string') return null;
        if (isIP(candidate.address) !== candidate.family) return null;
        if (blockedIpv4(candidate.address)) return null;
        addresses.push({ address: candidate.address, family: candidate.family });
    }
    return addresses[0] ?? null;
}

function genericResponse(status: ErrorStatus): string {
    const reason = status === 400 ? 'Bad Request' : status === 502 ? 'Bad Gateway' : 'Service Unavailable';
    return `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
}

function rejectHttpRequest(response: ServerResponse): void {
    response.statusCode = 400;
    response.setHeader('Connection', 'close');
    response.setHeader('Content-Length', '0');
    response.end();
}

function writeGenericError(socket: Duplex, status: ErrorStatus): void {
    if (socket.destroyed) return;
    socket.end(genericResponse(status), () => socket.destroy());
}

function realConnect(target: ConnectAddress): UpstreamAttempt {
    const socket = netConnect({ host: target.address, port: target.port, family: target.family });
    let settled = false;
    let resolveConnected!: () => void;
    let rejectConnected!: () => void;
    const connected = new Promise<void>((resolve, reject) => {
        resolveConnected = resolve;
        rejectConnected = () => reject(new Error('upstream connection failed'));
    });
    const onConnect = () => {
        if (settled) return;
        settled = true;
        socket.off('connect', onConnect);
        socket.off('error', onError);
        resolveConnected();
    };
    const onError = () => {
        if (settled) return;
        settled = true;
        socket.off('connect', onConnect);
        socket.off('error', onError);
        rejectConnected();
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
    return { socket, connected };
}

function setSocketTimeout(socket: Duplex, milliseconds: number, callback: () => void): void {
    const candidate = socket as Duplex & { setTimeout?: (timeout: number, listener?: () => void) => Duplex };
    if (typeof candidate.setTimeout === 'function') candidate.setTimeout(milliseconds, callback);
}

async function defaultLookup(hostname: AllowedHost): Promise<readonly ResolvedAddress[]> {
    const records = await dnsLookup(hostname, { all: true, family: 4, verbatim: true });
    return records.map(record => ({ address: record.address, family: 4 }));
}

async function createProxy(overrides: TestOverrides = {}): Promise<ProxyHandle> {
    const lookup = overrides.lookup ?? defaultLookup;
    const connect = overrides.connect ?? realConnect;
    const clients = new Set<Socket>();
    const ownedClientSockets = new Set<Socket>();
    const upstreams = new Set<Duplex>();
    const tunnels = new Set<Tunnel>();
    const tunnelByClient = new Map<Socket, Tunnel>();
    let closing = false;
    let admitted = overrides.initiallyClosed !== true;
    let closePromise: Promise<void> | undefined;

    const server = createServer({ maxHeaderSize: HEADER_LIMIT_BYTES }, (request, response) => {
        request.resume();
        rejectHttpRequest(response);
    });
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = IDLE_TIMEOUT_MS;

    const removeClient = (socket: Socket) => {
        clients.delete(socket);
        ownedClientSockets.delete(socket);
    };
    const removeUpstream = (socket: Duplex) => { upstreams.delete(socket); };

    const terminateTunnel = (tunnel: Tunnel, status?: ErrorStatus): void => {
        if (tunnel.closed) return;
        tunnel.closed = true;
        tunnels.delete(tunnel);
        tunnelByClient.delete(tunnel.client);
        tunnel.head = Buffer.alloc(0);
        if (tunnel.upstream) {
            tunnel.client.unpipe(tunnel.upstream);
            tunnel.upstream.unpipe(tunnel.client);
            tunnel.upstream.destroy();
        }
        if (status !== undefined) writeGenericError(tunnel.client, status);
        else tunnel.client.destroy();
    };

    const installUpstream = (tunnel: Tunnel, upstream: Duplex): void => {
        upstreams.add(upstream);
        upstream.once('close', () => {
            removeUpstream(upstream);
            if (!tunnel.closed) terminateTunnel(tunnel, tunnel.connected ? undefined : 502);
        });
        upstream.once('error', () => {
            if (!tunnel.closed) terminateTunnel(tunnel, tunnel.connected ? undefined : 502);
        });
        upstream.once('end', () => {
            if (!tunnel.closed) terminateTunnel(tunnel, tunnel.connected ? undefined : 502);
        });
        setSocketTimeout(upstream, REQUEST_TIMEOUT_MS, () => {
            if (!tunnel.closed) terminateTunnel(tunnel, tunnel.connected ? undefined : 502);
        });
    };

    const handleConnect = async (request: IncomingMessage, client: Socket, head: Buffer): Promise<void> => {
        const target = request.method === 'CONNECT' && typeof request.url === 'string'
            ? ALLOWED_TARGETS.get(request.url)
            : undefined;
        if (!target || !ALLOWED_HOSTS.has(target)) {
            writeGenericError(client, 400);
            return;
        }
        if (head.length > MAX_HEAD_BYTES) {
            writeGenericError(client, 400);
            return;
        }
        // Preparation must not even resolve an upstream before manual admission.
        if (!admitted || closing || !clients.has(client)) {
            client.destroy();
            return;
        }

        const tunnel: Tunnel = { client, head, connected: false, closed: false };
        tunnels.add(tunnel);
        tunnelByClient.set(client, tunnel);
        client.pause();
        try {
            const resolved = validateResolvedAddresses(await lookup(target));
            if (!resolved || tunnel.closed || closing) {
                if (!tunnel.closed) terminateTunnel(tunnel, 502);
                return;
            }
            const attempt = connect({ address: resolved.address, family: resolved.family, port: CONNECT_PORT });
            if (!attempt || !(attempt.socket instanceof Duplex) || !attempt.connected || typeof attempt.connected.then !== 'function') {
                throw new Error('invalid upstream attempt');
            }
            tunnel.upstream = attempt.socket;
            installUpstream(tunnel, attempt.socket);
            await attempt.connected;
            if (tunnel.closed || closing || client.destroyed || attempt.socket.destroyed) {
                if (!tunnel.closed) terminateTunnel(tunnel);
                return;
            }

            tunnel.connected = true;
            setSocketTimeout(client, IDLE_TIMEOUT_MS, () => { if (!tunnel.closed) terminateTunnel(tunnel); });
            setSocketTimeout(attempt.socket, IDLE_TIMEOUT_MS, () => { if (!tunnel.closed) terminateTunnel(tunnel); });
            client.write(CONNECTED_RESPONSE);
            if (tunnel.head.length > 0) attempt.socket.write(tunnel.head);
            tunnel.head = Buffer.alloc(0);
            client.pipe(attempt.socket);
            attempt.socket.pipe(client);
        } catch {
            if (!tunnel.closed) terminateTunnel(tunnel, 502);
        }
    };

    server.on('connection', (client) => {
        ownedClientSockets.add(client);
        client.once('close', () => {
            const tunnel = tunnelByClient.get(client);
            removeClient(client);
            if (tunnel && !tunnel.closed) terminateTunnel(tunnel);
        });
        client.once('error', () => {
            const tunnel = tunnelByClient.get(client);
            if (tunnel && !tunnel.closed) terminateTunnel(tunnel);
        });
        if (closing) {
            client.destroy();
            return;
        }
        if (clients.size >= MAX_CONNECTIONS) {
            writeGenericError(client, 503);
            return;
        }
        clients.add(client);
        setSocketTimeout(client, REQUEST_TIMEOUT_MS, () => {
            const tunnel = tunnelByClient.get(client);
            if (tunnel) terminateTunnel(tunnel, tunnel.connected ? undefined : 502);
            else client.destroy();
        });
    });
    server.on('connect', (request, client, head) => {
        if (!(client instanceof Socket)) {
            writeGenericError(client, 400);
            return;
        }
        void handleConnect(request, client, head);
    });
    server.on('clientError', (_error, client) => { writeGenericError(client, 400); });

    const close = (): Promise<void> => {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = new Promise<void>(resolve => {
            const finish = () => resolve();
            try { server.close(finish); } catch { finish(); }
            for (const tunnel of [...tunnels]) terminateTunnel(tunnel);
            for (const client of [...ownedClientSockets]) client.destroy();
            for (const upstream of [...upstreams]) upstream.destroy();
            server.closeAllConnections?.();
        });
        return closePromise;
    };

    try {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            server.once('error', onError);
            server.listen({ host: '127.0.0.1', port: 0 }, () => {
                server.off('error', onError);
                resolve();
            });
        });
    } catch (error) {
        await close();
        throw error;
    }

    const address = server.address() as AddressInfo | null;
    if (!address || typeof address === 'string') {
        await close();
        throw new Error('proxy listener did not expose a TCP port');
    }
    return Object.freeze({ port: address.port, activate() { if (closing) return false; admitted = true; return true; }, close });
}

export async function createOpenAIConnectProxy(options: Readonly<{ initiallyClosed?: boolean }> = {}): Promise<ProxyHandle> {
    return createProxy({ initiallyClosed: options.initiallyClosed });
}

/** @internal Test-only seam: production targets remain fixed in createOpenAIConnectProxy. */
export async function createForTest(overrides: TestOverrides): Promise<ProxyHandle> {
    return createProxy(overrides);
}
