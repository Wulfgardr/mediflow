/* @Codex */
import assert from 'node:assert/strict';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createResponseProxy } from './mobile-home-base-interop-response-proxy.mjs';

const logoutPath = '/api/auth/native/logout';

async function waitFor(read, timeout = 2_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = read();
        if (value) return value;
        await delay(10);
    }
    assert.fail('Synthetic fixture event did not arrive.');
}

async function fixture(t, { hold = true, upstream: handle, holdTimeoutMs = 800 } = {}) {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mediflow-response-proxy-unit-'));
    fs.chmodSync(directory, 0o700);
    const certPath = path.join(directory, 'cert.pem');
    const keyPath = path.join(directory, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=synthetic-unit', '-addext', 'subjectAltName=IP:127.0.0.1',
        '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    fs.chmodSync(keyPath, 0o600);
    fs.chmodSync(certPath, 0o600);
    const calls = [];
    const upstream = http.createServer((req, res) => {
        const parts = [];
        req.on('data', (part) => parts.push(part));
        req.on('end', () => {
            calls.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(parts).toString() });
            if (handle) handle(req, res);
            else { res.writeHead(204, { 'Set-Cookie': ['fixture=retired; Secure; HttpOnly'], 'x-synthetic': 'unchanged' }); res.end(); }
        });
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const runId = randomUUID();
    const barrierDirectory = path.join(directory, `mediflow-interop-${runId}`);
    fs.mkdirSync(barrierDirectory, { mode: 0o700 });
    const descriptor = {
        schemaVersion: 1, synthetic: true, fixtureId: 'response-proxy-unit',
        host: { os: 'macos', sourceCommit: 'a'.repeat(40), httpsURL: 'https://127.0.0.1:0',
            publicCertificatePath: certPath,
            tlsPinSHA256: createHash('sha256').update(new X509Certificate(fs.readFileSync(certPath)).raw).digest('hex') },
        operator: { username: 'synthetic-operator', pin: 'unit-pin-never-logged', ambulatoryId: 'unit-ambulatory' },
        patient: { id: 'unit-patient', firstName: 'Synthetic', lastName: 'Fixture' },
        clients: { ios: { id: 'unit-ios', token: 'unit-token-never-logged-ios' },
            ipados: { id: 'unit-ipados', token: 'unit-token-never-logged-ipados' } },
    };
    const descriptorPath = path.join(directory, 'descriptor.json');
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), { mode: 0o600 });
    const config = { descriptorPath, certPath, keyPath, target: `http://127.0.0.1:${upstream.address().port}`,
        ...(hold ? { barrierDirectory, runId, client: 'ios', holdTimeoutMs } : {}) };
    let proxy;
    t.after(async () => {
        if (proxy) await proxy.close();
        upstream.closeAllConnections();
        await new Promise((resolve) => upstream.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const read = (event) => {
        const file = path.join(barrierDirectory, `${event}.json`);
        return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const write = (event, fields = {}) => {
        const value = { schemaVersion: 1, runId, fixtureId: descriptor.fixtureId, event, method: 'POST', path: logoutPath, ...fields };
        const temporary = path.join(barrierDirectory, `.runner-${randomUUID()}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
        fs.renameSync(temporary, path.join(barrierDirectory, `${event}.json`));
    };
    const start = async () => { proxy = createResponseProxy(config); return proxy.listen(); };
    const request = (origin, { method = 'POST', route = logoutPath, client = 'ios', body, headers = {} } = {}) => {
        let received = false;
        const selected = descriptor.clients[client];
        const req = https.request(new URL(route, origin), { method, ca: fs.readFileSync(certPath), agent: false,
            headers: { 'x-mediflow-paired-client-id': selected.id, 'x-mediflow-paired-client-token': selected.token,
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } });
        const result = new Promise((resolve) => {
            req.on('response', (res) => {
                received = true;
                const parts = [];
                res.on('data', (part) => parts.push(part));
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() }));
                res.on('error', () => resolve({ failed: true }));
            });
            req.on('error', () => resolve({ failed: true }));
        });
        req.end(body);
        return { req, result, received: () => received };
    };
    return { directory, descriptor, descriptorPath, config, calls, read, write, start, request, barrierDirectory,
        proxy: () => proxy };
}

test('TLS pass-through keeps path, body, cookies and the existing proxy authority headers', async (t) => {
    const f = await fixture(t, { hold: false, upstream: (_req, res) => {
        res.writeHead(201, { 'Set-Cookie': ['first=synthetic; Secure', 'second=synthetic; HttpOnly'], 'x-synthetic': 'kept' });
        res.end('synthetic-response');
    } });
    const origin = await f.start();
    const response = await f.request(origin, { route: '/ordinary?value=1', method: 'PUT', body: 'synthetic-body',
        headers: { Cookie: 'unit-session=private', Authorization: 'unit-authorization', 'x-forwarded-proto': 'wrong' } }).result;
    assert.equal(response.status, 201);
    assert.equal(response.body, 'synthetic-response');
    assert.deepEqual(response.headers['set-cookie'], ['first=synthetic; Secure', 'second=synthetic; HttpOnly']);
    const { headers, ...call } = f.calls[0];
    assert.deepEqual(call, { method: 'PUT', path: '/ordinary?value=1', body: 'synthetic-body' });
    assert.equal(headers.cookie, 'unit-session=private');
    assert.equal(headers.authorization, 'unit-authorization');
    assert.equal(headers.host, new URL(origin).host);
    assert.equal(headers['x-forwarded-host'], headers.host);
    assert.equal(headers['x-forwarded-port'], new URL(origin).port);
    assert.equal(headers['x-forwarded-proto'], 'https');
    assert.equal(headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(headers['x-mediflow-tls-proxy'], 'local-api');
    assert.equal(headers['x-mediflow-paired-client-token'], f.descriptor.clients.ios.token);
    assert.deepEqual(fs.readdirSync(f.barrierDirectory), []);
});

test('only the exact armed method/path/client is selected, including while another response is held', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    // Matching traffic before populated-ready must not be delayed or consumed.
    assert.equal((await f.request(origin).result).status, 204);
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    for (const options of [{ client: 'ipados' }, { method: 'GET' }, { route: `${logoutPath}?query=1` },
        { route: '/api/auth/logout' }, { headers: { 'x-mediflow-paired-client-token': 'different-unit-token' } }]) {
        assert.equal((await f.request(origin, options).result).status, 204);
        assert.equal(f.read('logout-held'), false);
    }
    const pending = f.request(origin);
    const held = await waitFor(() => f.read('logout-held'));
    assert.equal((await f.request(origin, { route: '/ordinary-read', method: 'GET' }).result).status, 204);
    assert.equal(pending.received(), false);
    f.write('client-clear-verified', { requestID: held.requestID });
    assert.equal((await pending.result).status, 204);
    await waitFor(() => f.read('logout-released'));
});

for (const [name, fields] of [
    ['run', { runId: 'different-run' }], ['fixture', { fixtureId: 'different-fixture' }],
    ['request', { requestID: 'different-request' }], ['method', { method: 'GET' }],
    ['path', { path: '/api/auth/logout' }], ['schema', { schemaVersion: 2 }],
    ['unknown field', { unexpected: true }], ['wrong type', { responseForwarded: 'false' }],
]) {
    test(`invalid clear ${name} binding aborts without forwarding or a release receipt`, async (t) => {
        const f = await fixture(t);
        const origin = await f.start();
        f.write('populated-ready');
        await waitFor(() => f.read('logout-armed'));
        const pending = f.request(origin);
        const held = await waitFor(() => f.read('logout-held'));
        f.write('client-clear-verified', { requestID: held.requestID, ...fields });
        assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'binding-mismatch');
        assert.deepEqual(await pending.result, { failed: true });
        assert.equal(pending.received(), false);
        assert.equal(f.read('logout-released'), false);
    });
}

test('premature downstream disconnect invalidates the held proof, even if clear arrives later', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    const held = await waitFor(() => f.read('logout-held'));
    pending.req.destroy();
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'client-disconnected');
    f.write('client-clear-verified', { requestID: held.requestID });
    await delay(30);
    assert.equal(f.read('logout-released'), false);
    assert.deepEqual(await pending.result, { failed: true });
});

test('disconnect during downstream completion never publishes released merely because end was called', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.proxy().server.on('request', (_req, res) => res.once('prefinish', () => res.destroy()));
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    const held = await waitFor(() => f.read('logout-held'));
    f.write('client-clear-verified', { requestID: held.requestID });
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'client-disconnected');
    assert.equal(f.read('logout-released'), false);
    await pending.result;
});

test('hold deadline aborts a received204 without treating timeout as release', async (t) => {
    const f = await fixture(t, { holdTimeoutMs: 90 });
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    await waitFor(() => f.read('logout-held'));
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'hold-deadline');
    assert.deepEqual(await pending.result, { failed: true });
    assert.equal(pending.received(), false);
    assert.equal(f.read('logout-released'), false);
});

test('deadline also bounds the matching upstream request, before a204 can be held', async (t) => {
    const f = await fixture(t, { holdTimeoutMs: 70, upstream: () => {} });
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'hold-deadline');
    assert.deepEqual(await pending.result, { failed: true });
    assert.equal(f.read('logout-held'), false);
    assert.equal(f.read('logout-released'), false);
});

test('test-finished before clear aborts and cannot be revived by a late clear', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    const held = await waitFor(() => f.read('logout-held'));
    f.write('test-finished');
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'test-finished-before-clear');
    f.write('client-clear-verified', { requestID: held.requestID });
    assert.deepEqual(await pending.result, { failed: true });
    assert.equal(f.read('logout-released'), false);
});

for (const [name, reason, upstream] of [
    ['non204', 'upstream-status', (_req, res) => { res.writeHead(503); res.end('synthetic-failure'); }],
    ['disconnect', 'upstream-error', (_req, res) => res.destroy()],
]) {
    test(`matching upstream ${name} cannot create a held or successful release receipt`, async (t) => {
        const f = await fixture(t, { upstream });
        const origin = await f.start();
        f.write('populated-ready');
        await waitFor(() => f.read('logout-armed'));
        const pending = f.request(origin);
        assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, reason);
        assert.deepEqual(await pending.result, { failed: true });
        assert.equal(f.read('logout-held'), false);
        assert.equal(f.read('logout-released'), false);
    });
}

test('a forged clear before the real upstream204 is invalid, never a shortcut to forwarding', async (t) => {
    const f = await fixture(t, { upstream: () => {} });
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    await waitFor(() => f.calls.length === 1);
    f.write('client-clear-verified', { requestID: 'not-issued-by-proxy' });
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'binding-mismatch');
    assert.equal(f.read('logout-held'), false);
    assert.equal(f.read('logout-released'), false);
    assert.deepEqual(await pending.result, { failed: true });
});

test('Expect100 cannot leak an informational response before the selected real204 is released', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin, { headers: { Expect: '100-continue' } });
    let information = 0;
    pending.req.on('information', () => { information += 1; });
    const held = await waitFor(() => f.read('logout-held'));
    assert.equal(information, 0);
    assert.equal(pending.received(), false);
    f.write('client-clear-verified', { requestID: held.requestID });
    assert.equal((await pending.result).status, 204);
    await waitFor(() => f.read('logout-released'));
});

test('rejects private-file, certificate, target and directory misbindings before listening', async (t) => {
    const f = await fixture(t);
    const descriptorBytes = fs.readFileSync(f.descriptorPath);
    for (const mutation of [
        (v) => { v.synthetic = false; }, (v) => { v.host.tlsPinSHA256 = 'b'.repeat(64); },
        (v) => { v.host.httpsURL = 'https://127.0.0.2:0'; }, (v) => { v.host.httpsURL = 'https://example.org'; },
    ]) {
        const descriptor = structuredClone(f.descriptor); mutation(descriptor);
        fs.writeFileSync(f.descriptorPath, JSON.stringify(descriptor));
        assert.throws(() => createResponseProxy(f.config));
    }
    fs.writeFileSync(f.descriptorPath, descriptorBytes);
    for (const target of ['http://example.org:3000', 'https://127.0.0.1:3000', 'http://127.0.0.1:3000/path',
        'http://127.0.0.1:3000?query=1', 'http://unit:unit@127.0.0.1:3000']) {
        assert.throws(() => createResponseProxy({ ...f.config, target }));
    }
    fs.chmodSync(f.descriptorPath, 0o644);
    assert.throws(() => createResponseProxy(f.config));
    fs.chmodSync(f.descriptorPath, 0o600);
    const linked = path.join(f.directory, 'linked.json');
    fs.symlinkSync(f.descriptorPath, linked);
    assert.throws(() => createResponseProxy({ ...f.config, descriptorPath: linked }));
    fs.chmodSync(f.barrierDirectory, 0o755);
    assert.throws(() => createResponseProxy(f.config));
    fs.chmodSync(f.barrierDirectory, 0o700);
    assert.throws(() => createResponseProxy({ ...f.config, runId: 'wrong-run' }));
    f.write('logout-released', { requestID: 'stale-request' });
    assert.throws(() => createResponseProxy(f.config), /Stale/u);
});

test('a run directory is exclusively claimed and cannot be reused after close', async (t) => {
    const f = await fixture(t);
    await f.start();
    assert.throws(() => createResponseProxy(f.config));
    await f.proxy().close();
    assert.throws(() => createResponseProxy(f.config));
});

test('an unbound proxy never arms a populated runner before its TLS listener is active', async (t) => {
    const f = await fixture(t);
    f.write('populated-ready');
    const proxy = createResponseProxy(f.config);
    t.after(() => proxy.close());
    await delay(35);
    assert.equal(f.read('logout-armed'), false);
    await proxy.listen();
    await waitFor(() => f.read('logout-armed'));
});

test('stale populated-ready cannot arm a new owner even if there are no later receipts', async (t) => {
    const f = await fixture(t);
    f.write('populated-ready');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(f.barrierDirectory, 'populated-ready.json'), old, old);
    await f.start();
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'binding-mismatch');
    assert.equal(f.read('logout-armed'), false);
});

for (const unsafe of ['shared', 'symlinked', 'malformed', 'changed']) {
    test(`${unsafe} barrier events abort without echoing their contents`, async (t) => {
        const f = await fixture(t);
        const origin = await f.start();
        f.write('populated-ready');
        await waitFor(() => f.read('logout-armed'));
        const pending = f.request(origin);
        const held = await waitFor(() => f.read('logout-held'));
        f.write('client-clear-verified', { requestID: held.requestID });
        const clearPath = path.join(f.barrierDirectory, 'client-clear-verified.json');
        if (unsafe === 'shared') fs.chmodSync(clearPath, 0o644);
        if (unsafe === 'symlinked') {
            const target = path.join(f.directory, 'linked-clear.json');
            fs.renameSync(clearPath, target); fs.symlinkSync(target, clearPath);
        }
        if (unsafe === 'malformed') fs.writeFileSync(clearPath, '{invalid-json');
        if (unsafe === 'changed') f.write('populated-ready', { unexpected: true });
        assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'binding-mismatch');
        assert.deepEqual(await pending.result, { failed: true });
        assert.equal(f.read('logout-released'), false);
    });
}

test('an invalid populated-ready envelope never arms, and leaves unrelated requests working', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.write('populated-ready', { runId: 'not-this-run' });
    assert.equal((await waitFor(() => f.read('logout-aborted'))).reason, 'binding-mismatch');
    assert.equal(f.read('logout-armed'), false);
    assert.equal((await f.request(origin).result).status, 204);
    assert.equal(f.read('logout-held'), false);
});

test('fresh populated-ready may precede proxy startup but cannot be replayed by another owner', async (t) => {
    const f = await fixture(t);
    f.write('populated-ready');
    const origin = await f.start();
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    const held = await waitFor(() => f.read('logout-held'));
    f.write('client-clear-verified', { requestID: held.requestID });
    assert.equal((await pending.result).status, 204);
    await waitFor(() => f.read('logout-released'));
    assert.throws(() => createResponseProxy(f.config));
});

test('directory replacement invalidates proof without writing through a symlink', async (t) => {
    const f = await fixture(t);
    const origin = await f.start();
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    await waitFor(() => f.read('logout-held'));
    const invalidated = new Promise((resolve) => f.proxy().server.once('barrier-aborted', resolve));
    fs.renameSync(f.barrierDirectory, `${f.barrierDirectory}-original`);
    const replacement = path.join(f.directory, 'replacement');
    fs.mkdirSync(replacement, { mode: 0o700 }); fs.symlinkSync(replacement, f.barrierDirectory);
    assert.equal(await invalidated, 'binding-mismatch');
    assert.deepEqual(await pending.result, { failed: true });
    assert.deepEqual(fs.readdirSync(replacement), []);
    assert.equal(fs.existsSync(path.join(`${f.barrierDirectory}-original`, 'logout-released.json')), false);
});

test('one-shot hold waits for genuine upstream204, bound client clear, then downstream finish', async (t) => {
    let completeUpstream;
    const f = await fixture(t, { upstream: (_req, res) => { completeUpstream = () => {
        res.writeHead(204, { 'Set-Cookie': ['fixture=retired; Secure'], 'x-synthetic': 'original' }); res.end();
    }; } });
    const origin = await f.start();
    assert.equal(f.read('logout-armed'), false);
    f.write('populated-ready');
    await waitFor(() => f.read('logout-armed'));
    const pending = f.request(origin);
    await waitFor(() => completeUpstream);
    assert.equal(f.read('logout-held'), false);
    assert.equal(pending.received(), false);
    completeUpstream();
    const held = await waitFor(() => f.read('logout-held'));
    assert.equal(held.upstreamHttpStatus, 204);
    assert.equal(held.serverLogoutCompleted, true);
    assert.equal(held.responseForwarded, false);
    assert.equal(pending.received(), false);
    assert.equal(f.read('logout-released'), false);
    f.write('client-clear-verified', { requestID: held.requestID });
    const response = await pending.result;
    assert.equal(response.status, 204);
    assert.deepEqual(response.headers['set-cookie'], ['fixture=retired; Secure']);
    assert.equal(response.headers['x-synthetic'], 'original');
    assert.deepEqual(await waitFor(() => f.read('logout-released')), {
        schemaVersion: 1, runId: f.config.runId, fixtureId: f.descriptor.fixtureId, event: 'logout-released',
        method: 'POST', path: logoutPath, requestID: held.requestID, httpStatus: 204, upstreamHttpStatus: 204,
        serverLogoutCompleted: true, responseForwarded: true, heldUntilClientClearVerified: true,
        clientDisconnectedBeforeRelease: false,
    });
    const again = f.request(origin);
    await waitFor(() => f.calls.length === 2);
    completeUpstream();
    assert.equal((await again.result).status, 204);
    assert.equal(f.read('logout-held').requestID, held.requestID);
    f.write('same-process-relogin-verified', { requestID: held.requestID });
    f.write('test-finished');
    await delay(35);
    assert.equal(f.read('logout-aborted'), false);
    for (const name of fs.readdirSync(f.barrierDirectory).filter((name) => name.endsWith('.json'))) {
        const file = path.join(f.barrierDirectory, name);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        const raw = fs.readFileSync(file, 'utf8');
        for (const secret of ['unit-session', 'unit-token', 'unit-pin', 'unit-operator', 'Set-Cookie']) assert.equal(raw.includes(secret), false);
    }
});
