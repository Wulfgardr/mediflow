import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePayload, payloadFor, payloadHash, channelFor, fixtureFor, type Channel } from './contract';

test('both application channels have exact bounded canonical text and structured representations', () => {
    for (const channel of ['mcp_tool_result', 'model_context'] as const) {
        for (const fixture of ['demo-a', 'demo-b'] as const) {
            const payload = payloadFor(channel, fixture), bytes = encodePayload(channel, payload);
            assert.deepEqual(JSON.parse(bytes), payload);
            assert.match(payloadHash(bytes), /^[a-f0-9]{64}$/u);
            assert.ok(Object.isFrozen(payload) && Object.isFrozen(payload.content) && Object.isFrozen(payload.content[0]));
            assert.ok(Object.isFrozen(payload.structuredContent) && Object.isFrozen(payload.structuredContent.items)
                && Object.isFrozen(payload.structuredContent.items[0]));
            assert.ok(Buffer.byteLength(bytes) <= 32768);
            assert.doesNotMatch(bytes, /owner|lease|consent|authorization|patientId|rehydrat|MF_PII/u);
        }
    }
});

const forbidden = ['_meta', 'isError', 'error', 'progress', 'attachments', 'resources', 'tokenMap', 'patientId'];
for (const key of forbidden) test(`rejects unsupported ${key} at every payload object level`, () => {
    for (const location of ['outer', 'projection', 'item', 'text']) {
        const value = structuredClone(payloadFor('mcp_tool_result', 'demo-a'));
        const target = location === 'outer' ? value : location === 'projection' ? value.structuredContent
            : location === 'item' ? value.structuredContent.items[0] : value.content[0];
        Object.defineProperty(target, key, { value: 'invented forbidden bytes', enumerable: false });
        assert.throws(() => encodePayload('mcp_tool_result', value), /synthetic_payload_invalid/u);
    }
});

test('rejects altered text, structured values, arrays and forged case/schema', () => {
    const mutations = [
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.content[0], { text: 'invented unrelated text' }),
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.content[0], { type: 'image', data: 'synthetic' }),
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.structuredContent, { synthetic: false }),
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.structuredContent, { caseRef: 'real-patient' }),
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.structuredContent, { snapshotRevision: 9 }),
        (p: ReturnType<typeof payloadFor>) => Object.assign(p.structuredContent.items[0], { dueAt: null }),
        (p: ReturnType<typeof payloadFor>) => Object.defineProperty(p.content, 'length', { value: 2 }),
        (p: ReturnType<typeof payloadFor>) => Object.defineProperty(p.structuredContent.items, 'length', { value: 0 }),
    ];
    for (const mutate of mutations) {
        const value = structuredClone(payloadFor('model_context', 'demo-b'));
        mutate(value);
        assert.throws(() => encodePayload('model_context', value), /synthetic_payload_invalid/u);
    }
});

test('accessors, proxies, prototype changes and symbols deny without executing their code', () => {
    let calls = 0;
    const value = structuredClone(payloadFor('model_context', 'demo-a'));
    Object.defineProperty(value.structuredContent.items[0], 'kind', { get() { calls++; throw Error('invented secret'); } });
    assert.throws(() => encodePayload('model_context', value), /synthetic_payload_invalid/u);
    const proxy = new Proxy({}, { ownKeys() { calls++; return []; }, get() { calls++; return null; } });
    assert.throws(() => encodePayload('model_context', proxy), /synthetic_payload_invalid/u);
    const changed = structuredClone(payloadFor('model_context', 'demo-a'));
    Object.setPrototypeOf(changed, null);
    assert.throws(() => encodePayload('model_context', changed), /synthetic_payload_invalid/u);
    const symbol = structuredClone(payloadFor('model_context', 'demo-a'));
    Object.defineProperty(symbol, Symbol('hidden'), { value: 'forbidden' });
    assert.throws(() => encodePayload('model_context', symbol), /synthetic_payload_invalid/u);
    assert.equal(calls, 0);
});

test('only fixed fixtures and explicitly contracted channels can prepare a payload', () => {
    for (const value of ['attachment', 'progress', 'error', 'resource', {}, null, true]) {
        assert.throws(() => channelFor(value), /synthetic_payload_invalid/u);
        assert.throws(() => fixtureFor(value), /synthetic_payload_invalid/u);
    }
    assert.throws(() => payloadFor('progress' as Channel, 'demo-a'), /synthetic_payload_invalid/u);
});
