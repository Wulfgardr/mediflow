/* Deterministic Node observer failures only; real browser conformance
 * separately checks the native response reader and the acceptance gates. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { type TestContext } from 'node:test';
import type { Page, Request, Response } from '@playwright/test';
import { createBrowserResponseOracle } from '../../e2e/chatgpt-browser-response.ts';

const base = 'http://127.0.0.1:3219';
const namespace = '/api/settings/ai/chatgpt/synthesis/';
type Operation = 'consent' | 'login/complete';
type Context = Readonly<{ operation: Operation; requestSelected: boolean; responseStatus: number | null;
    networkTerminal: 'pending' | 'finished' | 'failed' }>;

async function fixture(t: TestContext) {
    const frame = {};
    const page = Object.assign(new EventEmitter(), {
        mainFrame: () => frame,
        addInitScript: async () => {},
        // Do not simulate the renderer capture or response body.
        evaluate: (_fn: unknown, arg: unknown) => typeof arg === 'string'
            ? new Promise<never>(() => {}) : Promise.resolve(undefined),
    });
    const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    t.after(() => { oracle.dispose(); assert.deepEqual(page.eventNames(), []); });
    const request = (operation: Operation, method = 'POST') => ({
        url: () => base + namespace + operation,
        method: () => method,
        frame: () => frame,
        isNavigationRequest: () => false,
        redirectedFrom: () => null,
        failure: () => ({ errorText: 'net::ERR_ABORTED' }),
    }) as unknown as Request;
    const response = (selected: Request, status: number) => ({
        request: () => selected, status: () => status,
        fromServiceWorker: () => false, url: () => selected.url(),
    }) as unknown as Response;
    return { page, frame, oracle, request, response };
}

async function rejection(work: Promise<unknown>): Promise<Error> {
    try { await work; } catch (error) { assert.ok(error instanceof Error); return error; }
    assert.fail('Expected the observer failure to reject');
}

function assertContext(error: Error, expected: Context, code: string) {
    assert.ok(error.message.startsWith(code));
    const context = (error as Error & { oracleContext?: Context }).oracleContext;
    assert.deepEqual(context, expected);
    assert.ok(Object.isFrozen(context));
    assert.deepEqual(Object.keys(context), ['operation', 'requestSelected', 'responseStatus', 'networkTerminal']);
    const descriptor = Object.getOwnPropertyDescriptor(error, 'oracleContext');
    assert.equal(descriptor?.enumerable, true);
    assert.equal(descriptor?.writable, false);
    assert.equal(descriptor?.configurable, false);
    assert.ok(error.message.endsWith(` [operation=${expected.operation}; responseStatus=${expected.responseStatus ?? 'not-observed'}; requestSelected=${expected.requestSelected}; networkTerminal=${expected.networkTerminal}]`));
    assert.equal(error.message.includes(base), false);
}

test('consent failure before response keeps one immutable error for response and json', async t => {
    const f = await fixture(t);
    const ticket = await f.oracle.arm('consent');
    const selected = f.request('consent');
    f.page.emit('request', selected);
    f.page.emit('requestfailed', selected);
    // Later observations must not rewrite the provenance of the first failure.
    f.page.emit('response', f.response(selected, 200));
    f.page.emit('requestfinished', selected);
    const error = await rejection(ticket.response);
    assert.strictEqual(await rejection(ticket.json()), error);
    assertContext(error, { operation: 'consent', requestSelected: true, responseStatus: null, networkTerminal: 'failed' }, 'ORACLE_NETWORK_FAILED: net::ERR_ABORTED');
});

test('login failure after observed 409 preserves the response and rejects json with its own provenance', async t => {
    const f = await fixture(t);
    const ticket = await f.oracle.arm('login/complete');
    const selected = f.request('login/complete'), received = f.response(selected, 409);
    f.page.emit('request', selected); f.page.emit('response', received);
    assert.strictEqual(await ticket.response, received);
    f.page.emit('requestfailed', selected);
    f.page.emit('framenavigated', f.frame);
    const error = await rejection(ticket.json());
    assertContext(error, { operation: 'login/complete', requestSelected: true, responseStatus: 409, networkTerminal: 'failed' }, 'ORACLE_NETWORK_FAILED: net::ERR_ABORTED');
});

test('foreign requests and frames cannot invent selected request, status or terminal evidence', async t => {
    const f = await fixture(t);
    const ticket = await f.oracle.arm('consent');
    for (const foreign of [f.request('login/complete'), f.request('consent', 'GET')]) {
        f.page.emit('request', foreign); f.page.emit('response', f.response(foreign, 409));
        f.page.emit('requestfinished', foreign); f.page.emit('requestfailed', foreign);
    }
    f.page.emit('framenavigated', {});
    f.page.emit('framenavigated', f.frame);
    const error = await rejection(ticket.response);
    assert.strictEqual(await rejection(ticket.json()), error);
    assertContext(error, { operation: 'consent', requestSelected: false, responseStatus: null, networkTerminal: 'pending' }, 'ORACLE_DOCUMENT_CHANGED');
});

test('document change after the matching request finishes records only the observed network terminal', async t => {
    const f = await fixture(t);
    const ticket = await f.oracle.arm('consent');
    const selected = f.request('consent'), received = f.response(selected, 200);
    f.page.emit('request', selected); f.page.emit('response', received);
    assert.strictEqual(await ticket.response, received);
    const foreign = f.request('login/complete');
    f.page.emit('requestfailed', foreign);
    f.page.emit('requestfinished', selected);
    f.page.emit('framenavigated', f.frame);
    const error = await rejection(ticket.json());
    assertContext(error, { operation: 'consent', requestSelected: true, responseStatus: 200, networkTerminal: 'finished' }, 'ORACLE_DOCUMENT_CHANGED');
});
