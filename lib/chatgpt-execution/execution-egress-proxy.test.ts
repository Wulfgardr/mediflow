/* @Codex */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { after, test } from 'node:test';
import { createConnection, type Socket } from 'node:net';
import { Duplex } from 'node:stream';

// Set the synthetic directory before importing any application module (ADR 0130).
const inheritedDataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(inheritedDataDir && isAbsolute(inheritedDataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
// @Codex: this file owns an empty directory, even when the suite bootstraps its DB.
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-proxy-test-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
after(() => {
    rmSync(dataDir, { recursive: true, force: true });
    process.env.MEDIFLOW_DATA_DIR = inheritedDataDir;
});

// @Codex: literal delayed import is analyzable and follows data-directory setup.
const { createForTest, createOpenAIConnectProxy } = await import('./execution-egress-proxy.ts');
type ConnectTarget = { address: string; family: 4; port: 443 };
type ResolvedTarget = { address: string; family: 4 };
type Lookup = (hostname: 'auth.openai.com' | 'chatgpt.com') => Promise<readonly ResolvedTarget[]>;

class FakeUpstream extends Duplex {
    readonly writes: Buffer[] = [];

    constructor() {
        super({ read() {} });
    }

    override _read() {}

    override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.writes.push(Buffer.from(chunk));
        callback();
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    void promise.catch(() => {});
    return { promise, resolve, reject };
}

function tick(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

async function eventually(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await tick();
    }
    assert.fail('condition was not reached');
}

async function openClient(port: number): Promise<Socket> {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        socket.once('error', onError);
        socket.once('connect', () => {
            socket.off('error', onError);
            resolve();
        });
    });
    return socket;
}

async function waitForClose(socket: Socket): Promise<void> {
    if (!socket.destroyed) await new Promise<void>(resolve => socket.once('close', () => resolve()));
}

async function readHeaders(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        let response = '';
        const onError = (error: Error) => reject(error);
        socket.on('error', onError);
        socket.on('data', (chunk: Buffer) => {
            response += chunk.toString('latin1');
            if (response.includes('\r\n\r\n')) {
                socket.off('error', onError);
                resolve(response);
            }
        });
    });
}

async function requestStatus(port: number, request: string): Promise<string> {
    const socket = await openClient(port);
    const response = readHeaders(socket);
    socket.write(request);
    const result = await response;
    socket.destroy();
    await waitForClose(socket);
    return result;
}

function publicLookup(): Lookup {
    return async () => [{ address: '8.8.8.8', family: 4 }];
}

function validConnect(socket: FakeUpstream, connected: Promise<void>) {
    return (_target: ConnectTarget) => ({ socket, connected });
}

test('rejects ordinary HTTP, non-exact authorities, credentials, queries, fragments and IP literals', async () => {
    let lookupCalls = 0;
    const proxy = await createForTest({
        lookup: async () => { lookupCalls += 1; throw new Error('lookup must not be reached'); },
        connect: () => { throw new Error('connect must not be reached'); },
    });
    const requests = [
        'GET http://auth.openai.com:443/ HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT https://auth.openai.com:443/ HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT user@auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT auth.openai.com:443?x=1 HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT auth.openai.com:443#fragment HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com\r\n\r\n',
        'CONNECT auth.openai.com:80 HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n',
        'CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n',
        'CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]\r\n\r\n',
        'CONNECT AUTH.OPENAI.COM:443 HTTP/1.1\r\nHost: AUTH.OPENAI.COM\r\n\r\n',
    ];
    try {
        for (const request of requests) assert.match(await requestStatus(proxy.port, request), /^HTTP\/1\.1 400 /u);
        assert.equal(lookupCalls, 0);
    } finally {
        await proxy.close();
    }
});

test('bounds request headers at 8 KiB and returns a generic response', async () => {
    let connectCalls = 0;
    const proxy = await createForTest({
        lookup: publicLookup(),
        connect: () => { connectCalls += 1; throw new Error('connect must not be reached'); },
    });
    try {
        const oversized = `CONNECT auth.openai.com:443 HTTP/1.1\r\nX-Fill: ${'x'.repeat(9000)}\r\n\r\n`;
        assert.match(await requestStatus(proxy.port, oversized), /^HTTP\/1\.1 400 /u);
        assert.equal(connectCalls, 0);
    } finally {
        await proxy.close();
    }
});

test('rejects private, local and reserved IPv4 DNS answers before numeric connect', async () => {
    const cases: readonly { address: string; family: number; port: 443 }[] = [
        { address: '127.0.0.1', family: 4, port: 443 },
        { address: '10.0.0.1', family: 4, port: 443 },
        { address: '169.254.1.1', family: 4, port: 443 },
        { address: '0.0.0.0', family: 4, port: 443 },
        { address: '198.51.100.10', family: 4, port: 443 },
        { address: '8.8.8.8', family: 6, port: 443 },
    ];
    for (const answer of cases) {
        let connectCalls = 0;
        const proxy = await createForTest({
            lookup: async () => [answer],
            connect: () => { connectCalls += 1; throw new Error('private answer must not connect'); },
        });
        try {
            const response = await requestStatus(proxy.port, 'CONNECT auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n');
            assert.match(response, /^HTTP\/1\.1 502 /u);
            assert.equal(response.includes('private answer'), false);
            assert.equal(connectCalls, 0);
        } finally {
            await proxy.close();
        }
    }
});

test('production factory exposes a loopback port and closes before any login or DNS work', async () => {
    const proxy = await createOpenAIConnectProxy();
    assert.equal(proxy.port > 0, true);
    await proxy.close();
    await proxy.close();
});

test('uses one validated numeric IPv4 address and forwards pipelined head only after CONNECT succeeds', async () => {
    const upstream = new FakeUpstream();
    const connected = deferred<void>();
    let target: ConnectTarget | undefined;
    const proxy = await createForTest({
        lookup: publicLookup(),
        connect: (current: ConnectTarget) => {
            target = current;
            return { socket: upstream, connected: connected.promise };
        },
    });
    const client = await openClient(proxy.port);
    const response = readHeaders(client);
    client.write('CONNECT auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com\r\nProxy-Authorization: Bearer secret\r\nAuthorization: Bearer secret\r\n\r\nTLS-HEAD');
    try {
        await tick();
        assert.equal(upstream.writes.length, 0);
        connected.resolve();
        assert.match(await response, /^HTTP\/1\.1 200 /u);
        await eventually(() => upstream.writes.length > 0);
        assert.equal(Buffer.concat(upstream.writes).toString(), 'TLS-HEAD');
        assert.equal(Buffer.concat(upstream.writes).toString().includes('secret'), false);
    } finally {
        client.destroy();
        await proxy.close();
    }
    assert.deepEqual(target, { address: '8.8.8.8', family: 4, port: 443 });
});

test('caps concurrent client connections at four', async () => {
    const attempts: { socket: FakeUpstream; connected: ReturnType<typeof deferred<void>> }[] = [];
    const proxy = await createForTest({
        lookup: publicLookup(),
        connect: () => {
            const socket = new FakeUpstream();
            const connected = deferred<void>();
            attempts.push({ socket, connected });
            return { socket, connected: connected.promise };
        },
    });
    const clients = await Promise.all(Array.from({ length: 4 }, () => openClient(proxy.port)));
    try {
        for (const client of clients) client.write('CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: chatgpt.com\r\n\r\n');
        await eventually(() => attempts.length === 4);
        const fifth = await openClient(proxy.port);
        try {
            assert.match(await readHeaders(fifth), /^HTTP\/1\.1 503 /u);
        } finally {
            fifth.destroy();
            await waitForClose(fifth);
        }
        assert.equal(attempts.length, 4);
    } finally {
        for (const attempt of attempts) attempt.connected.resolve();
        for (const client of clients) client.destroy();
        await proxy.close();
    }
});

test('upstream failure returns no details and destroys both sides', async () => {
    const upstream = new FakeUpstream();
    const connected = deferred<void>();
    const proxy = await createForTest({ lookup: publicLookup(), connect: validConnect(upstream, connected.promise) });
    const client = await openClient(proxy.port);
    const response = readHeaders(client);
    client.write('CONNECT auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com\r\n\r\n');
    try {
        connected.reject(new Error('private upstream detail must not escape'));
        const result = await response;
        assert.match(result, /^HTTP\/1\.1 502 /u);
        assert.equal(result.includes('private upstream detail'), false);
        await waitForClose(client);
        assert.equal(upstream.destroyed, true);
    } finally {
        client.destroy();
        await proxy.close();
    }
});

test('shutdown is idempotent and destroys owned client and upstream sockets', async () => {
    const upstream = new FakeUpstream();
    const proxy = await createForTest({ lookup: publicLookup(), connect: validConnect(upstream, Promise.resolve()) });
    const client = await openClient(proxy.port);
    const response = readHeaders(client);
    client.write('CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: chatgpt.com\r\n\r\n');
    assert.match(await response, /^HTTP\/1\.1 200 /u);
    const firstClose = proxy.close();
    const secondClose = proxy.close();
    assert.strictEqual(firstClose, secondClose);
    await firstClose;
    await waitForClose(client);
    assert.equal(upstream.destroyed, true);
    await assert.rejects(openClient(proxy.port));
});
