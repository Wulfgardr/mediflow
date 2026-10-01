void import.meta.url; // ESM for process-local test substitution before seam import.
/* Positive sinks are TEST DOUBLES. No runtime flag or injected policy option. */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { mockOrdinaryModule } from '../../chatgpt-execution/ordinary-module.test-support.ts';
import { encodePayload, payloadHash, TTL_MS, type Payload, type Channel } from './contract.ts';

let evaluatedBytes: string[] = [], wait: Promise<void> | undefined;
let result: 'allow' | 'wrong-hash' | 'throw' = 'allow';
mockOrdinaryModule(import.meta.url, './evaluator', { namedExports: {
    async evaluatePayload(bytes: string) {
        evaluatedBytes.push(bytes);
        await wait;
        if (result === 'throw') throw new Error('INVENTED_PRIVATE_ERROR');
        return Object.freeze({ status: 'allowed', payloadSha256: result === 'wrong-hash' ? '0'.repeat(64) : payloadHash(bytes) });
    },
} });
const { createSyntheticDisclosureSession } = await import('./seam.ts');
afterEach(() => { evaluatedBytes = []; wait = undefined; result = 'allow'; mock.restoreAll(); });
function owned(sink: (channel: Channel, payload: Payload) => Promise<void>, channel: Channel = 'model_context') {
    const session = createSyntheticDisclosureSession(sink);
    session.select('demo-a');
    const token = session.prepare(channel), disclosure = session.disclosure(token);
    assert.ok(session.confirm(token, disclosure.payloadSha256));
    return { session, token, disclosure };
}

for (const channel of ['mcp_tool_result', 'model_context'] as const) test(`exact immutable ${channel} bytes reach the synthetic sink once`, async () => {
    let calls = 0;
    const { session, token, disclosure } = owned(async (actualChannel, payload) => {
        calls++;
        assert.equal(actualChannel, channel);
        assert.equal(encodePayload(channel, payload), evaluatedBytes[0]);
        assert.equal(payloadHash(evaluatedBytes[0]), disclosure.payloadSha256);
        assert.deepEqual(JSON.parse(evaluatedBytes[0]), payload);
        assert.throws(() => Object.assign(payload.content[0], { text: 'mutation' }), TypeError);
        assert.throws(() => Object.assign(payload.structuredContent.items[0], { revision: 900 }), TypeError);
        assert.equal(await session.dispatch(token), 'already_used'); // Grant consumed before sink entry.
    }, channel);
    assert.equal(await session.dispatch(token), 'dispatched');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(session.confirm(token, disclosure.payloadSha256), false);
    assert.equal(calls, 1);
});

for (const action of ['cancel', 'reselect', 'revoke', 'expire', 'rollback'] as const) test(`${action} during evaluation prevents dispatch`, async () => {
    let release!: () => void, calls = 0;
    wait = new Promise<void>(resolve => { release = resolve; });
    const { session, token, disclosure } = owned(async () => { calls++; });
    const pending = session.dispatch(token);
    assert.equal(await session.dispatch(token), 'busy');
    if (action === 'cancel') session.cancel(token);
    if (action === 'reselect') session.select('demo-b');
    if (action === 'revoke') session.revoke();
    if (action === 'expire') mock.method(Date, 'now', () => disclosure.expiresAt);
    if (action === 'rollback') mock.method(Date, 'now', () => disclosure.expiresAt - TTL_MS - 1);
    release();
    assert.equal(await pending, 'stale');
    assert.equal(calls, 0);
    assert.equal(await session.dispatch(token), 'already_used');
});

test('reselection never rescopes old consent; a fresh selected payload needs fresh confirmation', async () => {
    const seen: string[] = [];
    const { session, token } = owned(async (_channel, payload) => { seen.push(payload.structuredContent.caseRef); });
    session.select('demo-b');
    assert.equal(await session.dispatch(token), 'stale');
    const fresh = session.prepare('model_context');
    assert.equal(await session.dispatch(fresh), 'consent_required');
    assert.ok(session.confirm(fresh, session.disclosure(fresh).payloadSha256));
    assert.equal(await session.dispatch(fresh), 'dispatched');
    assert.deepEqual(seen, ['demo-b']);
});

test('expiry at the final synchronous boundary denies after payload validation', async () => {
    let calls = 0, checks = 0;
    const { session, token, disclosure } = owned(async () => { calls++; });
    mock.method(Date, 'now', () => ++checks >= 3 ? disclosure.expiresAt : disclosure.expiresAt - TTL_MS);
    assert.equal(await session.dispatch(token), 'stale');
    assert.equal(calls, 0);
});

for (const observed of ['expiry', 'rollback'] as const) test(`observed ${observed} before evaluation cannot revive after clock recovery`, async () => {
    let calls = 0;
    const { session, token, disclosure } = owned(async () => { calls++; });
    const createdAt = disclosure.expiresAt - TTL_MS;
    let wall = observed === 'expiry' ? disclosure.expiresAt : createdAt - 1;
    mock.method(Date, 'now', () => wall);
    assert.equal(await session.dispatch(token), 'stale');
    assert.equal(evaluatedBytes.length, 0);
    wall = createdAt + 1;
    assert.equal(session.confirm(token, disclosure.payloadSha256), false);
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(calls, 0);
});

test('concurrent dispatch observing expiry terminally invalidates pending evaluation despite clock recovery', async () => {
    let release!: () => void, calls = 0;
    wait = new Promise<void>(resolve => { release = resolve; });
    const { session, token, disclosure } = owned(async () => { calls++; });
    const pending = session.dispatch(token);
    let wall = disclosure.expiresAt;
    mock.method(Date, 'now', () => wall);
    assert.equal(await session.dispatch(token), 'stale');
    wall = disclosure.expiresAt - TTL_MS + 1;
    release();
    assert.equal(await pending, 'stale');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(calls, 0);
});

test('after observed expiry only a freshly prepared and explicitly confirmed attempt can dispatch', async () => {
    let calls = 0;
    const { session, token, disclosure } = owned(async () => { calls++; });
    let wall = disclosure.expiresAt;
    mock.method(Date, 'now', () => wall);
    assert.equal(await session.dispatch(token), 'stale');
    wall = disclosure.expiresAt - TTL_MS + 1;
    const fresh = session.prepare('model_context');
    assert.equal(await session.dispatch(fresh), 'consent_required');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(calls, 0);
    assert.ok(session.confirm(fresh, session.disclosure(fresh).payloadSha256));
    assert.equal(await session.dispatch(fresh), 'dispatched');
    assert.equal(calls, 1);
});

for (const failure of ['wrong-hash', 'throw'] as const) test(`evaluator ${failure} fails closed with bounded diagnostics`, async () => {
    result = failure;
    let calls = 0;
    const { session, token } = owned(async () => { calls++; });
    assert.equal(await session.dispatch(token), failure === 'throw' ? 'evaluation_failed' : 'denied');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(calls, 0);
});

for (const synchronous of [false, true]) test(`sink ${synchronous ? 'synchronous throw' : 'rejection'} consumes grant without retry`, async () => {
    let calls = 0;
    const sink = () => { calls++; if (synchronous) throw new Error('INVENTED_PRIVATE_SINK_BYTES');
        return Promise.reject(new Error('INVENTED_PRIVATE_SINK_BYTES')); };
    const { session, token, disclosure } = owned(sink);
    assert.equal(await session.dispatch(token), 'sink_failed');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(session.confirm(token, disclosure.payloadSha256), false);
    assert.equal(calls, 1);
});

test('revocation after sink entry cannot recall already dispatched bytes', async () => {
    let calls = 0;
    const { session, token } = owned(async () => { calls++; session.revoke(); });
    assert.equal(await session.dispatch(token), 'dispatched');
    assert.equal(await session.dispatch(token), 'already_used');
    assert.equal(calls, 1);
});
