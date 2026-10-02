import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext, type Context } from 'node:vm';
import type { Page } from '@playwright/test';
import { createBrowserResponseOracle } from '../../e2e/chatgpt-browser-response.ts';
import { consumeContractResponse, CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES, createContractDiagnostic, installContractDiagnostic } from '../../e2e/chatgpt-browser-response-diagnostic.ts';

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
