import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { createContext, runInContext, type Context } from 'node:vm';
import type { Page } from '@playwright/test';
import { createBrowserResponseOracle } from '../../e2e/chatgpt-browser-response.ts';
import { consumeContractResponse, CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES, createContractDiagnostic, installContractDiagnostic, productDiagnosticInitScript } from '../../e2e/chatgpt-browser-response-diagnostic.ts';
import { createProductWireDiagnostic, productDiagnosticHeaders } from '../../e2e/chatgpt-product-response-diagnostic.ts';

const base = 'http://127.0.0.1:4000', url = base + '/api/settings/ai/chatgpt/synthesis/login/complete';
const expected = { error: 'login_pending', clinicalAdmission: 'held' };
const bytes = new TextEncoder().encode(JSON.stringify(expected));
class SyntheticPage extends EventEmitter {
    context: Context;
    frame = { url: () => base };
    fetches = 0;
    request = { url: () => url, method: () => 'POST', frame: () => this.frame, isNavigationRequest: () => false,
        redirectedFrom: () => null, failure: () => this.failed ? { errorText: 'net::ERR_ABORTED' } : null };
    failed = false;
    constructor() {
        super();
        const response = new Response(bytes, { status: 409, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.byteLength) } });
        Object.defineProperty(response, 'url', { value: url }); Object.defineProperty(response, 'type', { value: 'basic' });
        this.context = createContext({ URL, Request, Uint8Array, AbortController, performance, location: { href: base },
            fetch: () => { this.fetches++; this.emit('request', this.request); this.emit('response', { request: () => this.request, status: () => 409, url: () => url, fromServiceWorker: () => false, headers: () => Object.fromEntries(response.headers.entries()) }); return Promise.resolve(response); } });
    }
    mainFrame() { return this.frame; }
    async addInitScript(fn: (...args: never[]) => unknown, arg?: unknown) { return this.evaluate(fn, arg); }
    async evaluate(fn: (...args: never[]) => unknown, arg?: unknown) {
        this.context.arg = arg;
        return await runInContext(`(${fn.toString()})(arg)`, this.context);
    }
    asPage() { return this as unknown as Page; }
}
function ownedDirectory(t: { after(callback: () => void): void }) {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'contract-diagnostic-')));
    t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
async function fixture(directory: string, fails: boolean, mode = 'pending-409') {
    const page = new SyntheticPage(), diagnostic = createContractDiagnostic(mode, join(directory, 'artifact'));
    await page.addInitScript(installContractDiagnostic); diagnostic.attach(page.asPage(), url);
    const oracle = await createBrowserResponseOracle(page.asPage(), base);
    await diagnostic.calibrate(page.asPage());
    const ticket = await oracle.arm('login/complete');
    const consumer = page.evaluate(consumeContractResponse as (...args: never[]) => unknown, { mode, path: new URL(url).pathname });
    // Explicit synthetic browser-terminal fault, after the sole WebStream reader
    // settled. This unit fixture does not diagnose Chromium or launch a browser.
    void consumer.then(() => { page.failed = fails; page.emit(fails ? 'requestfailed' : 'requestfinished', page.request); });
    let originalError: unknown;
    const read = diagnostic.observe(ticket.json().catch(error => { originalError = error; throw error; }));
    const work = diagnostic.run(page.asPage(), () => consumer, async () => {
        const value = await read; assert.deepEqual(value, expected); assert.equal(await consumer, 'consumed'); await oracle.check(); return value;
    });
    return { page, diagnostic, oracle, work, originalError: () => originalError };
}

test('failed matching request keeps observed bytes/EOF/cleanup, persists later server close, and rethrows the original oracle error', async t => {
    const directory = ownedDirectory(t), f = await fixture(directory, true);
    await assert.rejects(f.work, error => { assert.equal(error, f.originalError()); assert.match(String(error), /ORACLE_NETWORK_FAILED: net::ERR_ABORTED/u); return true; });
    f.diagnostic.record('server.finish', { writableFinished: true }); f.diagnostic.record('server.close', { writableFinished: true });
    const file = f.diagnostic.persist(); assert.ok(file);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.renderer.byteCount, 52); assert.deepEqual(saved.renderer.bytes, Array.from(bytes));
    assert.ok(saved.renderer.events.some((event: { kind: string; detail: { done?: boolean } }) => event.kind === 'read' && event.detail.done));
    assert.ok(saved.renderer.events.some((event: { kind: string }) => event.kind === 'cancel.resolved'));
    assert.ok(!saved.renderer.events.some((event: { kind: string }) => event.kind === 'signal.abort'));
    assert.ok(saved.node.events.some((event: { kind: string }) => event.kind === 'requestfailed'));
    assert.equal(saved.node.events.at(-1).kind, 'server.close'); assert.equal(f.page.fetches, 1);
    assert.ok(saved.calibration.offsetLower <= saved.calibration.offsetUpper);
    assert.ok(Buffer.byteLength(readFileSync(file)) <= CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES);
    f.oracle.dispose(); assert.equal(f.page.eventNames().length, 0);
});
test('success still requires unchanged oracle EOF and requestfinished, returns the same JSON, and writes no artifact', async t => {
    const directory = ownedDirectory(t), f = await fixture(directory, false);
    assert.deepEqual(await f.work, expected); assert.equal(f.page.fetches, 1);
    assert.equal(f.diagnostic.persist(), null); assert.equal(existsSync(join(directory, 'artifact')), false);
    f.oracle.dispose(); assert.equal(f.page.eventNames().length, 0);
});
test('Node cleanup hooks persist server/page close after saving renderer evidence', async t => {
    const directory = ownedDirectory(t);
    let file: string | null = null;
    await t.test('synthetic owned lifecycle', async child => {
        const f = await fixture(directory, true);
        child.after(() => { f.diagnostic.record('server.close', { writableFinished: true }); });
        child.after(() => { f.page.emit('close'); });
        child.after(() => f.oracle.dispose());
        child.after(() => { file = f.diagnostic.persist(); });
        await assert.rejects(f.work, /ORACLE_NETWORK_FAILED/u);
    });
    assert.ok(file);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.renderer.byteCount, 52);
    assert.deepEqual(saved.node.events.slice(-2).map((event: { kind: string }) => event.kind), ['server.close', 'page.close']);
});
for (const [mode, reason, event] of [['cancel-before-eof', /ORACLE_CANCEL_BEFORE_EOF/u, 'cancel'], ['abort', /ORACLE_SIGNAL_ABORTED/u, 'signal.abort']] as const) {
    test(`original ${mode} still rejects despite matching requestfinished and retains its consumer trace`, async t => {
        const directory = ownedDirectory(t), f = await fixture(directory, false, mode);
        await assert.rejects(f.work, reason);
        const file = f.diagnostic.persist(); assert.ok(file);
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        assert.ok(saved.renderer.events.some((item: { kind: string }) => item.kind === event));
        assert.ok(saved.node.events.some((item: { kind: string }) => item.kind === 'requestfinished'));
        assert.equal(f.page.fetches, 1); f.oracle.dispose();
    });
}
test('unavailable clock calibration cannot introduce a failure into successful work', async t => {
    const d = createContractDiagnostic('clock-unavailable', join(ownedDirectory(t), 'artifact'));
    const page = { evaluate: async () => { throw new Error('synthetic clock unavailable'); } } as unknown as Page;
    await d.calibrate(page);
    assert.equal(await d.run(page, () => undefined, async () => 'unchanged-success'), 'unchanged-success');
    assert.equal(d.persist(), null);
});
test('an expected oracle rejection retains a receipt without turning the rejection into success', async t => {
    const directory = ownedDirectory(t), page = new SyntheticPage(), d = createContractDiagnostic('abort', join(directory, 'artifact'));
    await page.addInitScript(installContractDiagnostic);
    const primary = new Error('ORACLE_SIGNAL_ABORTED');
    await d.run(page.asPage(), () => undefined, async () => { await assert.rejects(d.observe(Promise.reject(primary)), error => error === primary); });
    const file = d.persist(); assert.ok(file); const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.oracleFailure.message, primary.message); assert.equal(saved.testFailure, null);
});
test('renderer events and bytes plus persisted envelope stay bounded under oversized synthetic observations', async t => {
    const directory = ownedDirectory(t), page = new SyntheticPage(), d = createContractDiagnostic('oversize', join(directory, 'artifact'));
    await page.addInitScript(installContractDiagnostic);
    await page.evaluate(() => {
        const capture = (globalThis as typeof globalThis & { __mfContractDiagnostic: { read(part: { done: boolean; value: Uint8Array }, aborted: boolean): void } }).__mfContractDiagnostic;
        for (let index = 0; index < 80; index++) capture.read({ done: false, value: new Uint8Array(256).fill(index) }, false);
    });
    for (let index = 0; index < 80; index++) d.record('synthetic', { detail: 'x'.repeat(950) });
    const primary = new Error('ORACLE_BODY_LIMIT_OR_TYPE');
    await assert.rejects(d.run(page.asPage(), () => undefined, () => d.observe(Promise.reject(primary))), error => error === primary);
    const file = d.persist(); assert.ok(file); const raw = readFileSync(file), saved = JSON.parse(raw.toString());
    assert.ok(raw.byteLength <= CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES);
    assert.equal(saved.renderer.bytes.length, 256); assert.equal(saved.renderer.byteCount, 80 * 256);
    assert.ok(saved.renderer.events.length <= 64); assert.ok(saved.node.events.length <= 64);
    assert.ok(saved.renderer.dropped > 0); assert.ok(saved.node.dropped > 0);
});
test('unavailable renderer capture and rejected artifact destination cannot mask the original error', async t => {
    const directory = ownedDirectory(t), alias = join(directory, 'alias'); symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const d = createContractDiagnostic('unavailable', join(alias, 'artifact')), primary = new Error('ORACLE_PAGE_CLOSED');
    const page = { evaluate: async () => { throw new Error('synthetic closed page'); } } as unknown as Page;
    await assert.rejects(d.run(page, () => undefined, () => d.observe(Promise.reject(primary))), error => error === primary);
    assert.equal(d.persist(), null); assert.equal(existsSync(join(directory, 'artifact')), false);
});

class ProductPage extends SyntheticPage {
    nativePromise: Promise<Response>;
    nativeResponse: Response;
    nativeReader?: ReadableStreamDefaultReader<Uint8Array>;
    nativeRead?: Promise<ReadableStreamReadResult<Uint8Array>>;
    nativeCancel?: Promise<void>;
    controllerSource: string;
    blockedRead: Promise<void>;
    constructor(operation: 'consent' | 'login/complete', open = false) {
        super();
        const selectedUrl = base + '/api/settings/ai/chatgpt/synthesis/' + operation;
        this.request.url = () => selectedUrl;
        const body = open ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); } }) : bytes;
        this.nativeResponse = new Response(body, { status: operation === 'consent' ? 200 : 409,
            headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength),
                'X-Secret': 'PRIVATE_HEADER_SENTINEL', Connection: 'PRIVATE_CONNECTION_SENTINEL' } });
        Object.defineProperty(this.nativeResponse, 'url', { value: selectedUrl }); Object.defineProperty(this.nativeResponse, 'type', { value: 'basic' });
        const stream = this.nativeResponse.body!, getReader = stream.getReader as () => ReadableStreamDefaultReader<Uint8Array>;
        let blocked!: () => void, reads = 0;
        this.blockedRead = new Promise<void>(resolve => { blocked = resolve; });
        // Independently retain native identities to detect replacement, extra reads or readers.
        stream.getReader = (() => {
            assert.equal(this.nativeReader, undefined);
            const reader = getReader.call(stream); this.nativeReader = reader;
            const read = reader.read, cancel = reader.cancel;
            reader.read = () => { const result = read.call(reader); this.nativeRead = result; if (open && ++reads === 2) blocked(); return result; };
            reader.cancel = reason => { const result = cancel.call(reader, reason); this.nativeCancel = result; return result; };
            return reader;
        }) as typeof stream.getReader;
        this.nativePromise = Promise.resolve(this.nativeResponse);
        class OwnedAbortController extends AbortController { abort(reason?: unknown) { super.abort(reason); } }
        this.context = createContext({ URL, Request, Uint8Array, AbortController: OwnedAbortController, performance, Error,
            setTimeout, clearTimeout, TextDecoder, location: { href: base, origin: base }, PRODUCT_NAMESPACE: '/api/settings/ai/chatgpt/synthesis/',
            fetch: (_input: unknown, init?: RequestInit) => {
                assert.equal(init?.method, 'POST'); this.fetches++;
                this.emit('request', this.request);
                this.emit('response', { request: () => this.request, status: () => this.nativeResponse.status, url: () => selectedUrl,
                    fromServiceWorker: () => false, headers: () => Object.fromEntries(this.nativeResponse.headers.entries()) });
                return this.nativePromise;
            } });
        // Execute the unchanged real controller/readResponse; only module syntax is removed for the VM.
        const source = readFileSync(new URL('./product-browser.ts', import.meta.url), 'utf8')
            .replace(/^import[\s\S]*?;\n/gmu, '').replace('export function createProductBrowser', 'function createProductBrowser');
        this.controllerSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export \{\};\s*$/gmu, '');
        runInContext(this.controllerSource, this.context);
    }
    async disposeObservation() {
        await this.evaluate(() => (globalThis as typeof globalThis & { __mfProductDiagnostic: { dispose(): void } }).__mfProductDiagnostic.dispose());
    }
}

for (const operation of ['consent', 'login/complete'] as const) test(`product failure identifies ${operation} across browser/gateway/real reader without body or secret fields`, async t => {
    const directory = ownedDirectory(t), page = new ProductPage(operation);
    const d = createContractDiagnostic('product-login-pending-1280', join(directory, 'artifact'));
    const wire = createProductWireDiagnostic(d.record);
    assert.equal(wire.select(operation, 'POST'), undefined); wire.activate();
    const trace = wire.select(operation, 'POST'); assert.ok(trace);
    assert.equal(wire.select(operation, 'POST'), undefined); assert.equal(wire.select('status', 'GET'), undefined);
    if (operation === 'consent') runInContext(productDiagnosticInitScript().content, page.context);
    for (const op of ['consent', 'login/complete'] as const) d.attach(page.asPage(), base + '/api/settings/ai/chatgpt/synthesis/' + op, op);
    const oracle = await createBrowserResponseOracle(page.asPage(), base);
    if (operation === 'login/complete') runInContext(productDiagnosticInitScript().content, page.context);
    await d.calibrate(page.asPage());
    const ticket = await oracle.arm(operation);
    trace('server.request'); trace('server.response', { status: page.nativeResponse.status, bodyBytes: bytes.byteLength,
        headers: productDiagnosticHeaders(name => page.nativeResponse.headers.get(name)) });
    const actualConsumer = page.evaluate(async (arg: { operation: string }) => {
        if (arg.operation === 'consent') {
            const controller = new AbortController();
            const response = await fetch('/api/settings/ai/chatgpt/synthesis/consent', { method: 'POST', signal: controller.signal });
            return await (globalThis as typeof globalThis & { readResponse(response: Response, signal: AbortSignal): Promise<unknown> }).readResponse(response, controller.signal);
        }
        const client = (globalThis as typeof globalThis & { createProductBrowser(): { setActive(active: boolean): void; run(operation: string): Promise<void> } }).createProductBrowser();
        client.setActive(true); await client.run('login/complete');
    }, { operation });
    void actualConsumer.then(() => { page.failed = true; page.emit('requestfailed', page.request); });
    const primary: unknown[] = [];
    await assert.rejects(d.run(page.asPage(), () => actualConsumer, () => d.observe(ticket.json()).catch(error => { primary.push(error); throw error; })), error => error === primary[0]);
    trace('server.finish', { writableFinished: true }); trace('server.close', { writableFinished: true }); page.emit('close');
    const file = d.persist(); assert.ok(file); const raw = readFileSync(file, 'utf8'), saved = JSON.parse(raw);
    assert.equal(saved.oracleFailure.message, 'ORACLE_NETWORK_FAILED: net::ERR_ABORTED');
    assert.ok(saved.node.events.some((e: { kind: string; detail: { request?: string } }) => e.kind === 'requestfailed' && e.detail.request === `${operation}:1`));
    assert.ok(saved.node.events.some((e: { kind: string; detail: { request?: string } }) => e.kind === 'server.close' && e.detail.request === `${operation}:1`));
    assert.ok(saved.renderer.events.some((e: { kind: string; detail: { done?: boolean } }) => e.kind === 'read.result' && e.detail.done));
    assert.ok(saved.renderer.events.some((e: { kind: string; detail: { eof?: boolean } }) => e.kind === 'cancel.call' && e.detail.eof));
    assert.deepEqual(saved.renderer.bytes, []); assert.doesNotMatch(raw, /PRIVATE_|login_pending|X-Secret/iu);
    assert.equal(page.fetches, 1); assert.ok(Buffer.byteLength(raw) <= CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES);
    assert.equal(saved.node.dropped, 0); assert.equal(saved.renderer.dropped, 0);
    await page.disposeObservation(); oracle.dispose(); assert.equal(page.eventNames().length, 0);
});

test('real product controller deactivation before EOF stays rejected and records abort before cancel/done', async t => {
    const page = new ProductPage('login/complete', true), d = createContractDiagnostic('product-abort', join(ownedDirectory(t), 'artifact'));
    runInContext(productDiagnosticInitScript().content, page.context);
    d.attach(page.asPage(), url, 'login/complete'); const oracle = await createBrowserResponseOracle(page.asPage(), base);
    const ticket = await oracle.arm('login/complete');
    const consumer = page.evaluate(async () => {
        const host = globalThis as typeof globalThis & { client: { setActive(active: boolean): void; run(operation: string): Promise<void> }; createProductBrowser(): typeof host.client };
        host.client = host.createProductBrowser(); host.client.setActive(true); await host.client.run('login/complete');
    });
    await page.blockedRead;
    await page.evaluate(() => (globalThis as typeof globalThis & { client: { setActive(active: boolean): void } }).client.setActive(false));
    await consumer; page.emit('requestfinished', page.request);
    await assert.rejects(d.run(page.asPage(), () => consumer, () => d.observe(ticket.json())), /ORACLE_SIGNAL_ABORTED/u);
    const file = d.persist(); assert.ok(file); const saved = JSON.parse(readFileSync(file, 'utf8'));
    const kinds = saved.renderer.events.map((e: { kind: string }) => e.kind);
    assert.ok(kinds.indexOf('controller.abort') < kinds.indexOf('signal.abort'));
    assert.ok(kinds.indexOf('signal.abort') < kinds.indexOf('cancel.call'));
    assert.ok(saved.renderer.events.some((e: { kind: string; detail: { eof?: boolean } }) => e.kind === 'cancel.call' && !e.detail.eof));
    assert.equal(page.fetches, 1); await page.disposeObservation(); oracle.dispose(); assert.equal(page.eventNames().length, 0);
});

test('product observation preserves native fetch/response/reader/read/cancel identities and restores owned abort hook', async () => {
    const page = new ProductPage('login/complete');
    const abort = runInContext('AbortController.prototype.abort', page.context);
    runInContext(productDiagnosticInitScript().content, page.context);
    const promise = runInContext("fetch('/api/settings/ai/chatgpt/synthesis/login/complete', {method:'POST'})", page.context);
    assert.strictEqual(promise, page.nativePromise);
    const response = await promise; assert.strictEqual(response, page.nativeResponse);
    const reader = response.body!.getReader(); assert.strictEqual(reader, page.nativeReader);
    const read = reader.read(); assert.strictEqual(read, page.nativeRead); await read;
    const eof = reader.read(); assert.strictEqual(eof, page.nativeRead); assert.equal((await eof).done, true);
    const cancel = reader.cancel(); assert.strictEqual(cancel, page.nativeCancel); await cancel;
    await page.disposeObservation(); assert.strictEqual(runInContext('AbortController.prototype.abort', page.context), abort);
    assert.equal(page.fetches, 1);
});

test('product failure fields redact arbitrary messages; both event rings and persisted file retain existing limits', async t => {
    const page = new ProductPage('login/complete'), d = createContractDiagnostic('product-budget', join(ownedDirectory(t), 'artifact'));
    runInContext(productDiagnosticInitScript().content, page.context);
    await page.evaluate(() => {
        const capture = (globalThis as typeof globalThis & { __mfContractDiagnostic: { record(kind: string, detail: unknown): void } }).__mfContractDiagnostic;
        for (let i = 0; i < 80; i++) capture.record('read.result', { request: 'login/complete:1', done: false, length: 1 });
    });
    for (let i = 0; i < 80; i++) d.record('server.response', { request: 'login/complete:1', headerBudget: 'x'.repeat(950) });
    const primary = new Error('PRIVATE_ERROR_SENTINEL');
    await assert.rejects(d.run(page.asPage(), () => undefined, () => d.observe(Promise.reject(primary))), error => error === primary);
    const file = d.persist(); assert.ok(file); const raw = readFileSync(file), saved = JSON.parse(raw.toString());
    assert.ok(raw.byteLength <= CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES); assert.ok(saved.node.events.length <= 64); assert.ok(saved.renderer.events.length <= 64);
    assert.ok(saved.node.dropped > 0); assert.ok(saved.renderer.dropped > 0); assert.deepEqual(saved.renderer.bytes, []);
    assert.doesNotMatch(raw.toString(), /PRIVATE_ERROR_SENTINEL/u); await page.disposeObservation(); assert.equal(page.eventNames().length, 0);
});

test('successful real product consumption still needs EOF and requestfinished and leaves no receipt or page listeners', async t => {
    const page = new ProductPage('login/complete'), directory = ownedDirectory(t), d = createContractDiagnostic('product-success', join(directory, 'artifact'));
    runInContext(productDiagnosticInitScript().content, page.context); d.attach(page.asPage(), url, 'login/complete');
    const oracle = await createBrowserResponseOracle(page.asPage(), base), ticket = await oracle.arm('login/complete');
    const consumer = page.evaluate(async () => {
        const client = (globalThis as typeof globalThis & { createProductBrowser(): { setActive(active: boolean): void; run(operation: string): Promise<void> } }).createProductBrowser();
        client.setActive(true); await client.run('login/complete');
    });
    void consumer.then(() => page.emit('requestfinished', page.request));
    const result = await d.run(page.asPage(), () => consumer, () => ticket.json());
    assert.deepEqual(result, expected); await consumer; await oracle.check(); assert.equal(d.persist(), null);
    assert.equal(existsSync(join(directory, 'artifact')), false); assert.equal(page.fetches, 1);
    await page.disposeObservation(); oracle.dispose(); assert.equal(page.eventNames().length, 0);
});
