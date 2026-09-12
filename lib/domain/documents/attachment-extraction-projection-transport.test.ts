/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalAttachmentExtractionRequest, readAttachmentExtractionProjectionBytes, hasEmptyAttachmentExtractionBody } from './attachment-extraction-projection-transport.ts';
import { ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES as MAX } from './attachment-extraction-projection-protocol.ts';
const url = 'http://127.0.0.1:3000/api/attachments/synthetic/local-extraction';
const live = () => ({ signal: new AbortController().signal, current: () => true });
const request = (body: BodyInit | null, headers: Record<string, string> = {}, signal?: AbortSignal) => new Request(url, {
    method: 'POST', body, headers: { origin: new URL(url).origin, 'content-type': 'application/octet-stream', ...headers }, signal,
    ...({ duplex: 'half' } as RequestInit),
});

test('projection channel admits only same-origin loopback, never forwarded origins or encoded bodies', () => {
    assert.equal(isLocalAttachmentExtractionRequest(request(null)), true);
    const foreign = new URL(url); foreign.hostname = 'foreign.invalid';
    const remote = new URL(url); remote.hostname = 'remote.invalid';
    for (const headers of [{ origin: foreign.origin }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'content-encoding': 'gzip' }] as Record<string, string>[])
        assert.equal(isLocalAttachmentExtractionRequest(request(null, headers)), false);
    assert.equal(isLocalAttachmentExtractionRequest(new Request(remote, { headers: { origin: remote.origin } })), false);
    assert.equal(isLocalAttachmentExtractionRequest(new Request(url)), false);
});

test('Next internal localhost origin is bound to the actual loopback Host, without forwarded-header trust', () => {
    const internal = 'http://localhost:3000/api/attachments/synthetic/local-extraction';
    const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
    assert.equal(isLocalAttachmentExtractionRequest(new Request(internal, { headers })), true);
    for (const extra of [
        { origin: 'http://localhost:3000' }, { host: 'remote.invalid:3000' },
        { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' },
        { host: '127.0.0.1:3000/path' }, { host: 'user@127.0.0.1:3000' },
        { origin: 'http://localhost:3000', 'x-forwarded-host': 'localhost:3000' },
    ] as Record<string, string>[]) assert.equal(isLocalAttachmentExtractionRequest(new Request(internal, { headers: { ...headers, ...extra } })), false);
});

test('empty handshake accepts both null body and Next-style empty stream, but not nonempty or declared data', async () => {
    assert.equal(await hasEmptyAttachmentExtractionBody(request(null)), true);
    assert.equal(await hasEmptyAttachmentExtractionBody(request(new ReadableStream({ start(c) { c.close(); } }))), true);
    assert.equal(await hasEmptyAttachmentExtractionBody(request(new Uint8Array([1]))), false);
    assert.equal(await hasEmptyAttachmentExtractionBody(request(null, { 'content-length': '1' })), false);
});

test('copies an exact binary projection without parsing caller metadata', async () => {
    const value = await readAttachmentExtractionProjectionBytes(request(new Uint8Array([1, 2, 3]), { 'content-length': '3' }), live());
    assert.deepEqual(value, new Uint8Array([1, 2, 3])); value?.fill(0);
});

test('rejects empty, JSON, malformed, oversize, and mismatched lengths', async () => {
    const invalid = [request(null), request('[]', { 'content-type': 'application/json' }),
        request(new Uint8Array([1]), { 'content-length': '0' }), request(new Uint8Array([1]), { 'content-length': '01' }),
        request(new Uint8Array([1]), { 'content-length': 'NaN' }), request(new Uint8Array([1]), { 'content-length': '2' }),
        request(new Uint8Array([1, 2]), { 'content-length': '1' }), request(new Uint8Array([1]), { 'content-length': String(MAX + 1) })];
    for (const input of invalid) assert.equal(await readAttachmentExtractionProjectionBytes(input, live()), null);
});

test('limits chunked bodies independently of Content-Length and cancels the unread tail', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX + 1)); }, cancel() { cancelled = true; } });
    assert.equal(await readAttachmentExtractionProjectionBytes(request(stream), live()), null);
    assert.equal(cancelled, true);
});

test('currentness is checked before and after each body await, without consuming a stale projection', async () => {
    let current = true; let checks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { current = false; c.enqueue(new Uint8Array([9])); c.close(); } });
    const value = await readAttachmentExtractionProjectionBytes(request(stream), { signal: live().signal, current() { checks += 1; return current; } });
    assert.equal(value, null); assert.ok(checks >= 2);
});

for (const owner of ['request', 'lease'] as const) test(`cancels a held body on ${owner} retirement and returns no bytes`, async () => {
    const held = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } });
    const controller = new AbortController();
    const input = request(held, {}, owner === 'request' ? controller.signal : undefined);
    const use = { signal: owner === 'lease' ? controller.signal : live().signal, current: () => true };
    const pending = readAttachmentExtractionProjectionBytes(input, use);
    await new Promise<void>((resolve) => setImmediate(resolve)); controller.abort();
    assert.equal(await pending, null);
});

test('already revoked source does not begin reading plaintext', async () => {
    const controller = new AbortController(); controller.abort();
    assert.equal(await readAttachmentExtractionProjectionBytes(request(new Uint8Array([1])), { signal: controller.signal, current: () => true }), null);
});
