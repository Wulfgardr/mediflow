/* @Codex — real Next/React card + real HTTP/root/owner/binding in an isolated
 * fixture. Only protocol transport/platform are fake. NOT live qualification.
 * Node 24 + installed locked Next/React/Playwright + local Chromium required.
 * No dependency/browser installation is attempted. External requests are denied.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse, type ClientRequest } from 'node:http';
import { Transform, type Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page, Response as BrowserResponse } from '@playwright/test';
import type { ProductOperation } from '../lib/chatgpt-product/product-contract';
import { createResponseLifetimeProbe, type ResponseLifetimeProbe } from './chatgpt-response-lifetime-probe.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'Absolute run-owned synthetic directory required');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Node 24 required; never skip or replace runtime');
// Use an ESM-local resolver; the frozen loader must not classify this spec as CJS.
const packageRequire = createRequire(join(root, 'package.json'));
const { createProductFixture, deferred, tick } = await import('../lib/chatgpt-product/product-production.test.ts');
const { PRODUCT_NAMESPACE, PRODUCT_MUTATIONS } = await import('../lib/chatgpt-product/product-contract.ts');
async function freePort() {
    const server = createTcpServer(); await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); assert.ok(address && typeof address === 'object');
    await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); return address.port;
}
async function stop(child: ChildProcess) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((done, fail) => {
        const killTimer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
        const deadline = setTimeout(() => finish(new Error('UI_CHILD_EXIT_UNCONFIRMED')), 10000);
        const exit = () => finish();
        function finish(error?: Error) {
            clearTimeout(killTimer); clearTimeout(deadline); child.removeListener('exit', exit);
            if (error) fail(error); else done();
        }
        child.once('exit', exit); child.kill('SIGTERM');
    });
}
async function closeBrowser(browser: Browser) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([browser.close(), new Promise<never>((_, fail) => {
            deadline = setTimeout(() => fail(new Error('UI_BROWSER_EXIT_UNCONFIRMED')), 10000);
        })]);
    } finally { clearTimeout(deadline); }
}

type StepFailure = { phase: string; error: unknown };
function throwStepFailures(failures: readonly StepFailure[]) {
    if (failures.length === 1) throw failures[0].error;
    if (failures.length > 1) {
        // Retain the actual errors/stacks, including a falsy thrown value. Include
        // both phases in the message even when a reporter omits AggregateError.errors.
        const details = failures.map(({ phase, error }) => `${phase}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        throw new AggregateError(failures.map(failure => failure.error), details.join('\n\n'), { cause: failures[0].error });
    }
}
async function withCleanup(work: () => Promise<void>, cleanup: () => Promise<void>, label: string) {
    const failures: StepFailure[] = [];
    try { await work(); } catch (error) { failures.push({ phase: `${label}/work`, error }); }
    try { await cleanup(); } catch (error) { failures.push({ phase: `${label}/cleanup`, error }); }
    throwStepFailures(failures);
}

// This is a reverse proxy owned by this test, not an auth/header emulator.
// The browser origin is the gateway; the only upstream is the fixed Next child.
const WIRE_BODY_LIMIT = 1024, WIRE_REPLY_LIMIT = 1024 * 1024;
const NEXT_REPLY_LIMIT = 32 * 1024 * 1024, WIRE_REQUEST_LIMIT = 64, WIRE_SOCKET_LIMIT = 128;
const WIRE_LIFETIME_MS = 125000, WIRE_CLOSE_MS = 10000;
type ProductFixture = ReturnType<typeof createProductFixture>;
async function within<T>(pending: Promise<T>, milliseconds: number, code: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([pending, new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(code)), milliseconds);
    })]); } finally { clearTimeout(timer); }
}
function receivedHeaders(input: IncomingMessage): Headers {
    const headers = new Headers();
    // rawHeaders is the actual IncomingMessage boundary. In particular, an absent
    // Origin/Fetch Metadata header stays absent; neither is inferred from a URL.
    for (let i = 0; i < input.rawHeaders.length; i += 2) headers.append(input.rawHeaders[i], input.rawHeaders[i + 1]);
    return headers;
}
function sameReceivedHeaders(observed: Headers, forwarded: Headers) {
    assert.equal(Array.from(forwarded).length, Array.from(observed).length);
    assert.ok(Array.from(observed).every(([name, value]) => forwarded.get(name) === value),
        'IncomingMessage metadata changed at the real handler boundary');
}
function byteLimit(maximum: number) {
    let size = 0;
    return new Transform({ transform(chunk: Buffer, _encoding, done) {
        size += chunk.byteLength;
        if (size > maximum) done(new Error('WIRE_BYTE_LIMIT')); else done(null, chunk);
    } });
}
async function requestBody(input: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
    return new Promise<Buffer>((done, fail) => {
        const chunks: Buffer[] = []; let size = 0, settled = false;
        const timer = setTimeout(() => finish(new Error('WIRE_BODY_DEADLINE')), 1000);
        const aborted = () => finish(new Error('WIRE_BODY_ABORTED'));
        const error = () => finish(new Error('WIRE_BODY_ERROR'));
        const end = () => finish();
        const data = (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > WIRE_BODY_LIMIT) finish(new Error('WIRE_BODY_LIMIT')); else chunks.push(chunk);
        };
        function finish(reason?: Error) {
            if (settled) return; settled = true;
            clearTimeout(timer); input.off('data', data); input.off('end', end); input.off('error', error);
            signal.removeEventListener('abort', aborted);
            if (reason) { input.pause(); fail(reason); } else done(Buffer.concat(chunks, size));
        }
        input.on('data', data); input.once('end', end); input.once('error', error);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
    });
}
async function replyBytes(response: Response): Promise<Buffer> {
    const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
    const chunks: Buffer[] = []; let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read(); if (done) return Buffer.concat(chunks, size);
            size += value.byteLength; assert.ok(size <= WIRE_REPLY_LIMIT, 'WIRE_REPLY_LIMIT'); chunks.push(Buffer.from(value));
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
}
async function startWireGateway(nextPort: number, f: ProductFixture, failures: string[], probe: ResponseLifetimeProbe,
    observe: (operation: ProductOperation, url: string, response: Response, body: Buffer, headers: Headers) => void) {
    assert.ok(Number.isInteger(nextPort) && nextPort > 0 && nextPort <= 65535);
    const sockets = new Set<Duplex>(), socketClosures = new Set<Promise<void>>();
    const upstreams = new Set<ClientRequest>(), controllers = new Set<AbortController>(), tasks = new Set<Promise<void>>();
    const operations = new Set<string>(['status', ...PRODUCT_MUTATIONS]);
    let base = '', closing = false, closed: Promise<void> | undefined, forwarded = 0, aborted = 0, bodyReads = 0;
    const failure = (code: string) => { if (!closing && failures.length < 128) failures.push(code); };
    function own(socket: Duplex) {
        if (sockets.has(socket)) return;
        sockets.add(socket);
        // Connection reset is handled by the owning request/pipeline. Always keep
        // an error listener until close, including teardown of idle/upgraded peers.
        const socketError = () => {};
        socket.on('error', socketError);
        const stopped = new Promise<void>(done => socket.once('close', () => {
            sockets.delete(socket); socket.off('error', socketError); done();
        }));
        socketClosures.add(stopped); void stopped.then(() => socketClosures.delete(stopped));
        if (closing || sockets.size > WIRE_SOCKET_LIMIT) { failure('WIRE_SOCKET_LIMIT'); socket.destroy(); }
    }
    function target(input: IncomingMessage): URL | null {
        const path = input.url ?? '', hosts = input.rawHeaders.filter((_, index) => index % 2 === 0 && input.rawHeaders[index].toLowerCase() === 'host');
        if (!base || !input.method || input.socket.remoteAddress !== '127.0.0.1' || hosts.length !== 1 || input.headers.host !== new URL(base).host
            || path.length > 2048 || !path.startsWith('/') || path.startsWith('//') || /[\s\\#]/u.test(path)) return null;
        const url = new URL(path, base);
        return url.origin === base && url.pathname + url.search === path ? url : null;
    }
    async function proxy(input: IncomingMessage, output: ServerResponse, signal: AbortSignal) {
        // No redirect following, environment proxy, DNS, URL-selected upstream,
        // generic API tunnel or Host rewrite. Only the owned Next port is used.
        const upstream = httpRequest({ hostname: '127.0.0.1', port: nextPort, path: input.url,
            method: input.method, headers: input.rawHeaders, agent: false, signal });
        upstreams.add(upstream); upstream.once('close', () => upstreams.delete(upstream)); upstream.once('socket', own);
        const response = await new Promise<IncomingMessage>((done, fail) => {
            upstream.once('response', done); upstream.once('error', fail); upstream.end();
        });
        assert.ok(response.statusCode, 'NEXT_RESPONSE_STATUS_MISSING');
        output.writeHead(response.statusCode, response.rawHeaders);
        await pipeline(response, byteLimit(NEXT_REPLY_LIMIT), output, { signal });
    }
    async function handle(input: IncomingMessage, output: ServerResponse) {
        const url = target(input);
        if (closing || !url || controllers.size >= WIRE_REQUEST_LIMIT) { output.writeHead(400); output.end(); return; }
        const abort = new AbortController(); controllers.add(abort);
        let wire: number | undefined;
        const disconnect = () => { if (!abort.signal.aborted) {
            if (wire !== undefined) probe.wireEvent('abort', wire, output.writableFinished);
            aborted++; abort.abort();
        } };
        const responseClosed = () => { if (!output.writableFinished) disconnect(); };
        const deadline = setTimeout(() => { failure('WIRE_REQUEST_DEADLINE'); disconnect(); output.destroy(); }, WIRE_LIFETIME_MS);
        input.once('aborted', disconnect); input.on('error', disconnect); output.on('error', disconnect);
        // A normal IncomingMessage close after a complete body is NOT an abort.
        // Keep stream error listeners through destruction; retire them on close.
        input.once('close', () => input.off('error', disconnect));
        output.once('close', () => output.off('error', disconnect)); output.once('close', responseClosed);
        try {
            if (url.pathname.startsWith(PRODUCT_NAMESPACE)) {
                const operation = url.pathname.slice(PRODUCT_NAMESPACE.length);
                if (!operations.has(operation)) { failure('WIRE_UNKNOWN_PRODUCT_ROUTE'); output.writeHead(404); output.end(); return; }
                const observed = receivedHeaders(input);
                wire = probe.wireRequest(operation, input.method!, observed, base);
                const wireId = wire;
                output.once('close', () => probe.wireEvent('close', wireId, output.writableFinished));
                let body: Buffer | undefined;
                if (input.method !== 'GET' && input.method !== 'HEAD') { bodyReads++; body = await requestBody(input, abort.signal); }
                const request = new Request(url.href, { method: input.method, headers: observed, signal: abort.signal,
                    ...(body === undefined ? {} : { body: new Uint8Array(body) }) });
                sameReceivedHeaders(observed, request.headers); forwarded++; f.paths.push(url.pathname);
                // Same root, resolver, owner, consent and binding as before. Never
                // call f.call/f.request/f.browser: those unit helpers add headers.
                const response = await f.root.handle(request, operation as ProductOperation);
                const bytes = await replyBytes(response); f.responses.push(response.status);
                probe.wireReply(wireId, response, bytes);
                observe(operation as ProductOperation, url.href, response, bytes, observed);
                if (abort.signal.aborted) return;
                // Preserve the genuine root status, headers and bytes (incl. 403/409).
                await new Promise<void>((done, fail) => {
                    const finish = () => { probe.wireEvent('finish', wireId, output.writableFinished); output.off('close', close); done(); };
                    const close = () => { output.off('finish', finish); fail(new Error('WIRE_RESPONSE_CLOSED')); };
                    output.once('finish', finish); output.once('close', close);
                    output.writeHead(response.status, Object.fromEntries(response.headers)); output.end(bytes);
                });
            } else if ((input.method === 'GET' || input.method === 'HEAD')
                && (url.pathname === '/' || url.pathname.startsWith('/_next/static/'))
                && !input.headers['transfer-encoding'] && (!input.headers['content-length'] || input.headers['content-length'] === '0')) {
                await proxy(input, output, abort.signal);
            } else { failure('WIRE_ROUTE_DENIED'); output.writeHead(404); output.end(); }
        } catch {
            if (wire !== undefined) probe.wireEvent('error', wire, output.writableFinished);
            if (!abort.signal.aborted) failure('WIRE_REQUEST_FAILED');
            disconnect(); output.destroy(); input.destroy();
        } finally {
            clearTimeout(deadline); input.off('aborted', disconnect); output.off('close', responseClosed);
            controllers.delete(abort);
        }
    }
    const server = createHttpServer({ maxHeaderSize: 16384, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (input, output) => {
        const task = handle(input, output).catch(() => { failure('WIRE_DISPATCH_FAILED'); input.destroy(); output.destroy(); });
        tasks.add(task); void task.finally(() => tasks.delete(task));
    });
    server.maxHeadersCount = 128; server.maxConnections = WIRE_SOCKET_LIMIT;
    server.on('connection', own);
    const serverError = () => failure('WIRE_SERVER_ERROR'); server.on('error', serverError);
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('connect', (_input, socket) => { failure('WIRE_CONNECT_DENIED'); socket.destroy(); });
    server.on('upgrade', (input, socket, head) => {
        const url = target(input);
        if (closing || !url || input.method !== 'GET' || url.pathname !== '/_next/hmr'
            || input.headers.upgrade?.toLowerCase() !== 'websocket' || head.byteLength > 16384) {
            failure('WIRE_UPGRADE_DENIED'); socket.destroy(); return;
        }
        // The pinned Next 16.3.4 client uses /_next/hmr?id=... . Match only
        // that pathname; input.url keeps the real query on the fixed upstream.
        // Next dev HMR is the sole upgrade. Both peers and byte-limited streams
        // belong to this gateway; even an idle upgrade is destroyed on close.
        probe.hmrUpgrade();
        own(socket);
        const peer = connectTcp({ host: '127.0.0.1', port: nextPort }); own(peer);
        const outgoing = byteLimit(NEXT_REPLY_LIMIT), incoming = byteLimit(NEXT_REPLY_LIMIT);
        const expire = setTimeout(() => { failure('WIRE_UPGRADE_CONNECT_DEADLINE'); peer.destroy(); socket.destroy(); }, 5000);
        const dispose = () => { clearTimeout(expire); peer.destroy(); socket.destroy(); outgoing.destroy(); incoming.destroy(); };
        peer.once('close', dispose); socket.once('close', dispose);
        outgoing.once('error', () => { failure('WIRE_UPGRADE_LIMIT'); dispose(); }); incoming.once('error', () => { failure('WIRE_UPGRADE_LIMIT'); dispose(); });
        peer.once('error', () => { failure('WIRE_UPGRADE_FAILED'); dispose(); });
        peer.setTimeout(WIRE_LIFETIME_MS, dispose);
        peer.once('connect', () => {
            clearTimeout(expire);
            const lines = [`${input.method} ${input.url} HTTP/${input.httpVersion}`];
            for (let i = 0; i < input.rawHeaders.length; i += 2) lines.push(`${input.rawHeaders[i]}: ${input.rawHeaders[i + 1]}`);
            peer.write(lines.join('\r\n') + '\r\n\r\n'); if (head.byteLength) peer.write(head);
            socket.pipe(outgoing).pipe(peer); peer.pipe(incoming).pipe(socket);
        });
    });
    try {
        await new Promise<void>((done, fail) => {
            const error = (reason: Error) => { server.off('listening', listening); fail(reason); };
            const listening = () => { server.off('error', error); done(); };
            server.once('error', error); server.once('listening', listening); server.listen(0, '127.0.0.1');
        });
        const address = server.address(); assert.ok(address && typeof address === 'object');
        base = `http://127.0.0.1:${address.port}`; assert.notEqual(address.port, nextPort);
    } catch (error) {
        if (server.listening) await new Promise<void>(done => server.close(() => done()));
        server.removeAllListeners(); throw error;
    }
    function close(): Promise<void> {
        if (closed) return closed;
        closing = true;
        closed = (async () => {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                const stopped = new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
                for (const abort of controllers) abort.abort();
                for (const upstream of upstreams) upstream.destroy();
                const pendingSockets = [...socketClosures]; for (const socket of sockets) socket.destroy();
                server.closeAllConnections();
                await Promise.race([Promise.all([stopped, ...tasks, ...pendingSockets]), new Promise<never>((_, fail) => {
                    timeout = setTimeout(() => fail(new Error('WIRE_CLOSE_UNCONFIRMED')), WIRE_CLOSE_MS);
                })]);
                await tick();
                assert.equal(server.listening, false); assert.equal(sockets.size, 0); assert.equal(upstreams.size, 0);
                assert.equal(controllers.size, 0); assert.equal(tasks.size, 0); assert.equal(socketClosures.size, 0);
                server.removeAllListeners(); assert.equal(server.eventNames().length, 0);
            } finally { clearTimeout(timeout); }
        })();
        return closed;
    }
    return { base, close, stats: () => ({ forwarded, aborted, bodyReads, active: controllers.size, sockets: sockets.size }) };
}
type WireGateway = Awaited<ReturnType<typeof startWireGateway>>;

test('real synthetic product UI/HTTP acceptance, no automatic inference or clinical writes', { timeout: 180000 }, async t => {
    // Resolve first. Missing dependencies/browser fail rather than mocking React.
    const { chromium, expect } = packageRequire('@playwright/test') as typeof import('@playwright/test');
    const next = packageRequire.resolve('next/dist/bin/next');
    // Exercise reporting without a browser/provider fake: no failure, either
    // phase alone, and both failures. These assertions run only in the Node24 suite.
    for (const workFails of [false, true]) for (const cleanupFails of [false, true]) {
        const original = new Error('synthetic scenario failure'), teardown = new Error('synthetic cleanup failure');
        const order: string[] = [];
        const pending = withCleanup(async () => { order.push('work'); if (workFails) throw original; },
            async () => { order.push('cleanup'); if (cleanupFails) throw teardown; }, 'cleanup-regression');
        if (!workFails && !cleanupFails) await pending;
        else await assert.rejects(pending, (error: unknown) => {
            if (workFails && cleanupFails) {
                assert.ok(error instanceof AggregateError);
                assert.strictEqual(error.errors[0], original); assert.strictEqual(error.errors[1], teardown);
                assert.equal(error.errors.length, 2); assert.strictEqual(error.cause, original);
                assert.ok(error.message.includes('cleanup-regression/work:'));
                assert.ok(error.message.includes('cleanup-regression/cleanup:'));
                assert.ok(error.message.includes(original.stack!)); assert.ok(error.message.includes(teardown.stack!));
            } else assert.strictEqual(error, workFails ? original : teardown);
            return true;
        });
        assert.deepEqual(order, ['work', 'cleanup']);
    }
    await mkdir(dataDir!, { recursive: true }); const fixture = await mkdtemp(join(dataDir!, 'synthesis-ui-'));
    const resources: { child?: ChildProcess; browser?: Browser; gateways: Set<WireGateway> } = { gateways: new Set() };
    const logs: string[] = [];
    t.after(async () => {
        const outcomes = await Promise.allSettled([
            ...Array.from(resources.gateways, gateway => gateway.close()),
            resources.browser ? closeBrowser(resources.browser) : Promise.resolve(),
            resources.child ? stop(resources.child) : Promise.resolve(),
        ]);
        // Never remove a run directory while an owned process might still use it.
        throwStepFailures(outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
            ? [{ phase: `fixture/resource-${index}`, error: outcome.reason }] : []));
        await rm(fixture, { recursive: true, force: true });
    });
    await mkdir(join(fixture, 'app'), { recursive: true }); await mkdir(join(fixture, 'home'));
    await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true }));
    // Card takes UI active state; the Panel wrapper is not mounted here. The
    // unused hook throws if accidentally invoked. It is NOT an auth grant; all
    // product requests still use real server owner 0.8.7 in createProductFixture.
    const hook = join(fixture, 'unused-security-hook.ts');
    await writeFile(hook, `export function useSecurity(): never { throw new Error('This fixture mounts the real Card, not its outer Panel'); }`);
    await writeFile(join(fixture, 'next.config.mjs'), `export default { experimental: {externalDir:true}, devIndicators:false, webpack(config) { config.resolve.alias['@/components/security-provider$']=${JSON.stringify(hook)}; config.resolve.alias['@']=${JSON.stringify(root)}; return config; } };`);
    await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true,
        esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', resolveJsonModule: true, skipLibCheck: true, baseUrl: root, paths: { '@/*': [resolve(root, '*')] } } }));
    await writeFile(join(fixture, 'app/layout.tsx'), `import type {ReactNode} from 'react'; export const metadata={title:'MediFlow synthetic product fixture'}; export default function Layout({children}:{children:ReactNode}) { return <html lang="it"><head><link rel="icon" href="data:,"/></head><body>{children}</body></html>; }`);
    await writeFile(join(fixture, 'app/page.tsx'), `'use client'; import {useState} from 'react'; import {ChatGptSynthesisCard} from '@/components/settings/chatgpt-synthesis-panel';
export default function Page(){const [active,setActive]=useState(true);return <main><button onClick={()=>setActive(value=>!value)}>{active?'Blocca fixture':'Sblocca fixture'}</button><ChatGptSynthesisCard active={active}/></main>;}`);
    const port = await freePort(), nextBase = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [next, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: fixture, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: join(fixture, 'home'), USERPROFILE: join(fixture, 'home'), NODE_ENV: 'development', CI: '1', NEXT_TELEMETRY_DISABLED: '1', MEDIFLOW_DATA_DIR: fixture } });
    resources.child = child;
    let logBytes = 0, logOverflow = false;
    const capture = (value: Buffer) => {
        if (logOverflow) return;
        logBytes += value.byteLength;
        if (logBytes > 65536) { logOverflow = true; return; }
        logs.push(value.toString());
    };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    let spawnError: Error | undefined; child.once('error', error => { spawnError = error; });
    const deadline = Date.now() + 90000;
    for (;;) {
        if (spawnError) throw spawnError;
        assert.equal(logOverflow, false, 'UI_FIXTURE_LOG_LIMIT');
        assert.equal(child.exitCode, null, logs.join(''));
        try { if ((await fetch(nextBase, { redirect: 'error', signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* local test server startup only */ }
        assert.ok(Date.now() < deadline, `Isolated fixture startup failed: ${logs.join('')}`);
        await new Promise(done => setTimeout(done, 250));
    }
    const browser = await chromium.launch({ headless: true }); resources.browser = browser;
    const responseProbes = new WeakMap<BrowserResponse, ResponseLifetimeProbe>();
    const consentProbes = new WeakMap<Promise<BrowserResponse>, ResponseLifetimeProbe>();
    const pageProbes = new WeakMap<Page, ResponseLifetimeProbe>();
    async function observedJson(response: BrowserResponse) {
        const probe = responseProbes.get(response); assert.ok(probe, 'RESPONSE_PROBE_OWNER_MISSING');
        return probe.json(response);
    }
    async function scenario(name: string, run: (page: Page, f: ReturnType<typeof createProductFixture>) => Promise<void>, width = 1280, held = false) {
        const f = createProductFixture(); if (held) f.setQualification({ platform: 'test-unqualified', state: 'unqualified', revision: 'not-admitted', missing: ['fixture-held-test'] });
        const failures: string[] = [], expectedRootDenials = new Set<string>();
        const probe = createResponseLifetimeProbe(); probe.phase('scenario-start');
        let gateway: WireGateway;
        try { gateway = await startWireGateway(port, f, failures, probe, (operation, url, response, body, observedHeaders) => {
            if (operation === 'consent' && response.ok) {
                assert.ok(observedHeaders.get('sec-fetch-site') === 'same-origin', 'Accepted consent lacks received browser same-origin metadata');
                assert.ok(observedHeaders.get('origin') === gateway.base, 'Accepted consent lacks the exact received browser origin');
                assert.ok(observedHeaders.get('content-type') === 'application/json', 'Accepted consent lacks the browser JSON content type');
                assert.equal(f.created(), 0, 'Consent alone must not create an execution process');
            }
            if (response.status === 409 && operation === 'login/complete' && name.startsWith('login-pending-')) {
                assert.deepEqual(JSON.parse(body.toString('utf8')), { error: 'login_pending', clinicalAdmission: 'held' });
                expectedRootDenials.add(`${url}|${response.status}`);
            } else if (response.status === 401 && name === 'owner-lock' && ['cancel', 'status'].includes(operation)) {
                expectedRootDenials.add(`${url}|${response.status}`);
            }
        }); } catch (error) { probe.dispose(); f.dispose(); throw error; }
        resources.gateways.add(gateway);
        const base = gateway.base;
        let context: BrowserContext | undefined, tearingDown = false;
        try { await withCleanup(async () => {
            // No invented Fetch Metadata even in the negative probes. A Node HTTP
            // client sends neither Origin nor Sec-Fetch-Site: the ORIGINAL root
            // must return its genuine 403, with no owner/process/protocol work.
            const denial = await new Promise<{ status: number | undefined; body: Buffer }>((done, fail) => {
                const input = httpRequest(new URL(PRODUCT_NAMESPACE + 'consent', base), { method: 'POST', agent: false,
                    headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000) }, response => {
                    const chunks: Buffer[] = []; let bytes = 0;
                    response.on('data', (chunk: Buffer) => {
                        bytes += chunk.byteLength;
                        if (bytes > WIRE_REPLY_LIMIT) response.destroy(new Error('PROBE_REPLY_LIMIT')); else chunks.push(chunk);
                    });
                    response.once('end', () => done({ status: response.statusCode, body: Buffer.concat(chunks) }));
                    response.once('error', fail);
                });
                input.once('error', fail); input.end('{}');
            });
            assert.equal(denial.status, 403, 'Absent wire metadata must NOT be manufactured into an accepted mutation');
            assert.deepEqual(JSON.parse(denial.body.toString('utf8')), { error: 'forbidden', clinicalAdmission: 'held' });
            assert.equal(f.created(), 0); assert.equal(f.transport.calls.length, 0);
            const beforeAbort = gateway.stats(), partial = connectTcp({ host: '127.0.0.1', port: Number(new URL(base).port) });
            const partialClosed = new Promise<void>(done => partial.once('close', () => done()));
            partial.on('error', () => {});
            await withCleanup(async () => {
                await within(new Promise<void>((done, fail) => { partial.once('connect', done); partial.once('error', fail); }), 5000, 'PARTIAL_PROBE_CONNECT_DEADLINE');
                // Two-byte declared body, only one sent; no auth/Origin/Fetch
                // Metadata header. This checks a real IncomingMessage disconnect.
                partial.write(`POST ${PRODUCT_NAMESPACE}consent HTTP/1.1\r\nHost: ${new URL(base).host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{`);
                await expect.poll(() => gateway.stats().bodyReads, { timeout: 750, intervals: [10, 25, 50] }).toBe(beforeAbort.bodyReads + 1);
                partial.destroy(); await within(partialClosed, WIRE_CLOSE_MS, 'PARTIAL_PROBE_CLOSE_UNCONFIRMED');
                await expect.poll(() => gateway.stats().active).toBe(0);
                assert.ok(gateway.stats().aborted > beforeAbort.aborted, 'Wire disconnect did not abort its owned request');
                assert.equal(gateway.stats().forwarded, beforeAbort.forwarded, 'Partial body must never reach the real root');
                assert.equal(f.created(), 0); assert.equal(f.transport.calls.length, 0);
            }, async () => { partial.destroy(); await within(partialClosed, WIRE_CLOSE_MS, 'PARTIAL_PROBE_CLOSE_UNCONFIRMED'); partial.removeAllListeners(); }, `${name}/partial-probe`);
            context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
            await probe.arm(context);
            // This is only an egress deny-list. No local API interception/fulfill,
            // header override, fetch replacement or Playwright metadata projection.
            // Unmatched same-origin requests really cross the loopback HTTP wire.
            await context.route(url => url.origin !== base, async route => {
                if (!tearingDown) failures.push('unexpected-external-request'); await route.abort();
            });
            await context.routeWebSocket('**/*', route => {
                const url = new URL(route.url());
                // Same exact pinned pathname as the gateway, not a wildcard or legacy fallback.
                if (url.origin === base.replace('http:', 'ws:') && url.pathname === '/_next/hmr') route.connectToServer();
                else { if (!tearingDown) failures.push('unexpected-websocket'); route.close(); }
            });
            const page = await context.newPage();
            pageProbes.set(page, probe); probe.attach(page, base, response => responseProbes.set(response, probe));
            page.on('pageerror', error => { if (!tearingDown) failures.push(error.message); });
            page.on('console', message => {
                if (message.type() !== 'error' || tearingDown) return;
                // Only denials actually returned by the real root in these negative scenarios.
                const location = message.location();
                if ([409, 401].some(status => message.text().includes(String(status))
                    && expectedRootDenials.has(`${location.url}|${status}`))) return;
                failures.push('browser-console-error');
            });
            await page.goto(base);
            assert.equal(page.url(), new URL('/', base).href);
            await expect(page).toHaveTitle('MediFlow synthetic product fixture');
            await expect(page.getByTestId('chatgpt-synthesis-panel')).toBeVisible();
            await expect(page.getByTestId('synthesis-state')).toContainText(held ? 'Prova sospesa' : 'In attesa del tuo consenso');
            assert.equal(f.created(), 0); assert.equal(f.transport.calls.length, 0);
            probe.phase('ui-ready');
            await run(page, f); assert.deepEqual(failures, []);
            probe.phase('scenario-work-succeeded');
            if (process.env.MEDIFLOW_UI_EVIDENCE_DIR) {
                await mkdir(process.env.MEDIFLOW_UI_EVIDENCE_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.MEDIFLOW_UI_EVIDENCE_DIR, `${name}.png`), fullPage: true });
            }
        }, async () => {
            probe.phase('scenario-cleanup-start');
            tearingDown = true;
            // Add a genuinely idle owned connection: server.close alone would not
            // prove that peers (including upgrades/partial requests) were drained.
            const idle = connectTcp({ host: '127.0.0.1', port: Number(new URL(base).port) });
            const idleClosed = new Promise<void>(done => idle.once('close', () => done()));
            idle.resume();
            idle.on('error', () => {});
            await withCleanup(async () => {
                await within(new Promise<void>((done, fail) => { idle.once('connect', done); idle.once('error', fail); }), 5000, 'IDLE_PROBE_CONNECT_DEADLINE');
                await tick(); assert.ok(gateway.stats().sockets > 0);
            }, async () => {
                // Attempt both closes even if one throws synchronously. Collect all
                // rejections without skipping idle-peer proof, disposal or wire checks.
                const outcomes = await Promise.allSettled([
                    Promise.resolve().then(() => { probe.phase('context-close-start'); return context ? within(context.close(), WIRE_CLOSE_MS, 'UI_CONTEXT_EXIT_UNCONFIRMED') : undefined; }),
                    Promise.resolve().then(() => { probe.phase('gateway-close-start'); return gateway.close(); }),
                ]);
                const cleanupFailures: StepFailure[] = outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
                    ? [{ phase: `${name}/${index === 0 ? 'context-close' : 'gateway-close'}`, error: outcome.reason }] : []);
                try {
                    await withCleanup(async () => {
                        // Observe remote closure BEFORE the client's last-resort destroy.
                        await within(idleClosed, WIRE_CLOSE_MS, 'IDLE_PEER_CLOSE_UNCONFIRMED');
                        assert.equal(idle.destroyed, true); idle.removeAllListeners();
                    }, async () => { idle.destroy(); f.dispose(); }, `${name}/idle-peer`);
                } catch (error) { cleanupFailures.push({ phase: `${name}/idle-peer`, error }); }
                // An unconfirmed gateway remains owned by the outer cleanup hook.
                if (outcomes[1].status === 'fulfilled') resources.gateways.delete(gateway);
                try {
                    assert.equal(gateway.stats().active, 0); assert.equal(gateway.stats().sockets, 0);
                    assert.strictEqual(gateway.close(), gateway.close(), 'Gateway close must be idempotent');
                } catch (error) { cleanupFailures.push({ phase: `${name}/gateway-drain`, error }); }
                try { assert.deepEqual(failures, []); }
                catch (error) { cleanupFailures.push({ phase: `${name}/wire-observations`, error }); }
                throwStepFailures(cleanupFailures);
            }, `${name}/idle-probe`);
        }, `${name}/scenario`);
            probe.phase('scenario-succeeded');
        } catch (error) {
            probe.phase('scenario-failed');
            // Emit only technical metadata, AFTER bounded cleanup; keep the exact
            // original error (including AggregateError/cause) as the test failure.
            t.diagnostic(JSON.stringify({ scenario: name, ...probe.snapshot() }));
            throw error;
        } finally { probe.dispose(); }
    }
    function consentResponse(page: Page) {
        const url = new URL(PRODUCT_NAMESPACE + 'consent', page.url()).href;
        const probe = pageProbes.get(page); assert.ok(probe, 'CONSENT_PROBE_OWNER_MISSING');
        const pending = page.waitForResponse(response => response.url() === url && response.request().method() === 'POST');
        consentProbes.set(pending, probe); probe.phase('consent-wait-armed');
        return pending;
    }
    async function assertConsentResponse(pending: Promise<BrowserResponse>) {
        const response = await pending;
        assert.equal(response.status(), 200, 'Consent HTTP response must succeed BEFORE waiting for the login button');
        assert.equal(response.request().method(), 'POST');
        assert.equal(response.headers()['cache-control'], 'no-store');
        consentProbes.get(pending)?.phase('consent-http-asserted');
        const result = await observedJson(response);
        assert.equal(result.snapshot?.state, 'consented'); assert.equal(result.snapshot?.clinicalAdmission, 'held');
    }
    async function consentAndLogin(page: Page, f: ReturnType<typeof createProductFixture>) {
        const consent = consentResponse(page);
        await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Autorizza prova DEMO' }).click();
        await assertConsentResponse(consent);
        await expect(page.getByTestId('synthesis-state')).toContainText('Consenso acquisito'); assert.equal(f.created(), 0);
        await page.getByRole('button', { name: 'Avvia accesso per la prova' }).click();
        await expect(page.getByTestId('execution-login')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Apri accesso ufficiale OpenAI' })).toHaveAttribute('href', /^https:\/\/auth\.openai\.com\//);
        // Do not open the URL. This event comes from the explicit protocol fake.
        f.transport.login(); await page.getByRole('button', { name: 'Verifica accesso' }).click();
        await expect(page.getByTestId('synthesis-state')).toContainText('Accesso alla prova verificato');
        await page.getByRole('button', { name: 'Leggi modelli disponibili' }).click();
        await expect(page.getByRole('combobox')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Genera sintesi DEMO' })).toBeDisabled();
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
        await page.getByRole('combobox').selectOption({ index: 2 });
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
    }
    for (const width of [1280, 390]) await t.test(`409 pending challenge survives local polls at ${width}px`, () => scenario(`login-pending-${width}`, async (page, f) => {
        const consent = consentResponse(page);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Autorizza prova DEMO' }).click();
        await assertConsentResponse(consent);
        await page.getByRole('button', { name: 'Avvia accesso per la prova' }).click();
        const challenge = page.getByTestId('execution-login');
        await expect(challenge).toBeVisible();
        const link = page.getByRole('link', { name: 'Apri accesso ufficiale OpenAI' });
        const originalUrl = await link.getAttribute('href'), originalCode = await challenge.locator('strong').textContent();
        const pending = page.waitForResponse(response => response.url().endsWith(PRODUCT_NAMESPACE + 'login/complete'));
        await page.getByRole('button', { name: 'Verifica accesso' }).click();
        assert.equal((await pending).status(), 409);
        assert.equal((await pending).request().method(), 'POST');
        assert.deepEqual(await observedJson(await pending), { error: 'login_pending', clinicalAdmission: 'held' });
        for (let index = 0; index < 3; index++) {
            const poll = page.waitForResponse(response => response.url().endsWith(PRODUCT_NAMESPACE + 'status'));
            await page.getByRole('button', { name: 'Rileggi stato locale' }).click(); await poll;
            await expect(challenge).toBeVisible(); await expect(link).toHaveAttribute('href', originalUrl!);
            await expect(challenge.locator('strong')).toHaveText(originalCode!);
            await expect(page.getByTestId('chatgpt-synthesis-panel').getByRole('alert')).toContainText('Completa prima l’accesso ufficiale');
            await expect(page.getByTestId('synthesis-state')).toContainText('In attesa dell’accesso OpenAI');
        }
        // Also observe the Card's existing 2s local polling, not a mocked timer.
        await page.waitForResponse(response => response.url().endsWith(PRODUCT_NAMESPACE + 'status'));
        await expect(link).toHaveAttribute('href', originalUrl!);
        await expect(page.getByTestId('chatgpt-synthesis-panel').getByRole('alert')).toContainText('Completa prima l’accesso ufficiale');
        assert.equal(f.created(), 1);
        assert.equal(f.transport.calls.filter(call => call.method === 'account/login/start').length, 1);
        assert.equal(f.transport.calls.filter(call => call.method === 'model/list' || call.method === 'turn/start').length, 0);
        // Matching fake protocol notice; account/config/binding below are real code.
        f.transport.login(); await page.getByRole('button', { name: 'Verifica accesso' }).click();
        await expect(page.getByTestId('synthesis-state')).toContainText('Accesso alla prova verificato');
        await expect(challenge).toHaveCount(0); await expect(page.getByTestId('chatgpt-synthesis-panel').getByRole('alert')).toHaveCount(0);
        assert.equal(f.transport.calls.filter(call => call.method === 'model/list' || call.method === 'turn/start').length, 0);
    }, width));
    for (const width of [1280, 390]) await t.test(`consent/login/picker/manual synthesis/source receipt/logout at ${width}px`, () => scenario(`chain-${width}`, async (page, f) => {
        await consentAndLogin(page, f); await page.getByRole('button', { name: 'Genera sintesi DEMO' }).click();
        const result = page.getByTestId('synthesis-result'); await expect(result).toBeVisible();
        await expect(result).toContainText('S1'); await expect(result).toContainText('xhigh'); await expect(result).toContainText('Scritture cliniche: 0');
        await page.getByTestId('synthesis-receipt').locator('summary').click();
        await expect(page.getByTestId('synthesis-receipt')).toContainText('Non attestati');
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
        await page.getByRole('button', { name: 'Scollega e ritira consenso' }).click();
        await expect(result).toHaveCount(0); await expect(page.getByTestId('synthesis-state')).toContainText('Prova annullata');
        assert.equal(await page.locator('textarea, input:not([type="checkbox"])').count(), 0);
        assert.equal(await page.evaluate(() => localStorage.length), 0);
    }, width));
    await t.test('cancel a pending turn; late fake notifications never resurrect result', () => scenario('cancel', async (page, f) => {
        await consentAndLogin(page, f); f.transport.autoFinish = false; const reached = deferred<void>();
        f.transport.override = method => { if (method === 'turn/start') reached.resolve(); };
        await page.getByRole('button', { name: 'Genera sintesi DEMO' }).click(); await reached.promise;
        await page.getByRole('button', { name: 'Annulla operazione' }).click(); await expect(page.getByTestId('synthesis-state')).toContainText('Prova annullata');
        f.transport.finish(); await tick(); await expect(page.getByTestId('synthesis-result')).toHaveCount(0);
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
    }));
    await t.test('cancel official-login lifecycle without a catalog or turn', () => scenario('login-cancel', async (page, f) => {
        const consent = consentResponse(page);
        await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Autorizza prova DEMO' }).click();
        await assertConsentResponse(consent);
        await page.getByRole('button', { name: 'Avvia accesso per la prova' }).click(); await expect(page.getByTestId('execution-login')).toBeVisible();
        await page.getByRole('button', { name: 'Annulla accesso' }).click(); await expect(page.getByTestId('execution-login')).toHaveCount(0);
        assert.ok(f.transport.calls.some(x => x.method === 'account/login/cancel')); assert.equal(f.transport.calls.filter(x => x.method === 'model/list').length, 0);
    }));
    await t.test('actual owner retirement and UI lock erase metadata during login', () => scenario('owner-lock', async (page, f) => {
        const consent = consentResponse(page);
        await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Autorizza prova DEMO' }).click();
        await assertConsentResponse(consent);
        await page.getByRole('button', { name: 'Avvia accesso per la prova' }).click(); await expect(page.getByTestId('execution-login')).toBeVisible();
        f.retire(); await page.getByRole('button', { name: 'Blocca fixture' }).click(); f.transport.login();
        await expect(page.getByTestId('execution-login')).toHaveCount(0); await expect(page.getByTestId('synthesis-result')).toHaveCount(0);
        await expect(page.getByTestId('chatgpt-synthesis-panel')).toContainText('Sblocca la sessione'); assert.equal(f.transport.closed, true);
    }));
    await t.test('unqualified platform stays recognizable; consent cannot start a process', () => scenario('held', async (page, f) => {
        await expect(page.getByText('Verifiche della postazione incomplete. La prova resta bloccata finché la configurazione non è verificata.', { exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Autorizza prova DEMO' })).toHaveCount(0); assert.equal(f.created(), 0);
    }, 1280, true));
});
