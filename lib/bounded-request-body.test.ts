/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBoundedJsonBody, utf8ByteLength, parseStrictJson } from './bounded-request-body';
import {
    readNativeNetworkJson, JsonBodyTooLargeError, jsonBodyTooLargeResponse,
    NATIVE_BOOTSTRAP_JSON_MAX_BYTES, NETWORK_JSON_MAX_BYTES, networkAttachmentJsonMaxBytes,
} from './native-network-json-body';

const encoder = new TextEncoder();
function fixture(chunks: Uint8Array[], headers: Record<string, string> = {}, cancellation: 'ok' | 'reject' | 'pending' = 'ok') {
    let reads = 0, cancels = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            const chunk = chunks[reads++];
            if (chunk) controller.enqueue(chunk); else controller.close();
        },
        cancel() {
            cancels++;
            if (cancellation === 'reject') return Promise.reject(new Error('synthetic cancellation failure'));
            if (cancellation === 'pending') return new Promise<void>(() => {});
        },
    }, { highWaterMark: 0 });
    const request = new Request('http://127.0.0.1', { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit);
    return { request, stream, counts: () => ({ reads, cancels }) };
}

for (const semantics of ['strict', 'request-json'] as const) {
    test(`${semantics}: exact UTF-8 budget and split code points round trip`, async () => {
        const text = JSON.stringify({ note: 'è 🩺', sealed: 'ENC:aQ==:ZGF0YQ==' });
        const bytes = encoder.encode(text);
        assert.ok(bytes.length > text.length);
        const f = fixture(Array.from(bytes, b => Uint8Array.of(b)));
        assert.deepEqual(await readBoundedJsonBody(f.request, bytes.length, semantics), {
            ok: true, value: JSON.parse(text), byteLength: bytes.length,
        });
        assert.equal(f.stream.locked, false);
        assert.equal(f.counts().cancels, 0);
        const oversized = fixture([bytes]);
        assert.deepEqual(await readBoundedJsonBody(oversized.request, bytes.length - 1, semantics), { ok: false, status: 413 });
    });
}

for (const headers of [{}, { 'content-length': '0' }, { 'content-length': '2' }, { 'transfer-encoding': 'chunked' }, { 'content-length': '999x' }] as Record<string, string>[]) {
    test(`actual bytes bound accumulation despite ${JSON.stringify(headers)}`, async () => {
        const f = fixture([encoder.encode('{"a":'), encoder.encode('123}'), encoder.encode('ignored')], headers);
        assert.deepEqual(await readBoundedJsonBody(f.request, 8), { ok: false, status: 413 });
        assert.deepEqual(f.counts(), { reads: 2, cancels: 1 });
        assert.equal(f.stream.locked, false);
    });
}

for (const declared of ['9', '0009', '9'.repeat(320)]) {
    test(`valid oversized length rejects before pulling (${declared.length} digits)`, async () => {
        const f = fixture([encoder.encode('{}')], { 'content-length': declared });
        assert.deepEqual(await readBoundedJsonBody(f.request, 8), { ok: false, status: 413 });
        assert.deepEqual(f.counts(), { reads: 0, cancels: 1 });
    });
}

for (const cancellation of ['ok', 'reject', 'pending'] as const) {
    test(`overflow remains 413 when cancellation is ${cancellation}`, async () => {
        for (const headers of [{}, { 'content-length': '9' }] as Record<string, string>[]) {
            const f = fixture([encoder.encode('{"a":123}')], headers, cancellation);
            assert.deepEqual(await readBoundedJsonBody(f.request, 8), { ok: false, status: 413 });
            assert.equal(f.stream.locked, false);
            assert.equal(f.counts().cancels, 1);
        }
    });
}

test('missing, empty, malformed and failed streams preserve parse failure', async () => {
    for (const text of ['', '{', '{"x":}', 'undefined']) {
        const f = fixture([encoder.encode(text)]);
        assert.deepEqual(await readBoundedJsonBody(f.request, 32), { ok: false, status: 400 });
    }
    assert.deepEqual(await readBoundedJsonBody(new Request('http://127.0.0.1'), 32), { ok: false, status: 400 });
    const failed = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error('synthetic stream failure')); } }, { highWaterMark: 0 });
    const request = { headers: new Headers(), body: failed } as Request;
    assert.deepEqual(await readBoundedJsonBody(request, 32), { ok: false, status: 400 });
    assert.equal(failed.locked, false);
    const nonBytes = new ReadableStream({ start(c) { c.enqueue('not bytes'); } });
    assert.deepEqual(await readBoundedJsonBody({ headers: new Headers(), body: nonBytes } as Request, 32), { ok: false, status: 400 });
    assert.equal(nonBytes.locked, false);
});

test('Request.json semantics are opt-in; existing strict duplicate/UTF-8 rejection stays', async () => {
    const samples = [
        encoder.encode('{"x":1,"x":2}'),
        Uint8Array.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    ];
    for (const bytes of samples) {
        assert.deepEqual(await readBoundedJsonBody(fixture([bytes]).request, 64), { ok: false, status: 400 });
        const expected = await fixture([bytes]).request.json();
        assert.deepEqual(await readNativeNetworkJson(fixture([bytes]).request, 64), expected);
    }
    for (const text of ['null', '123', '[]', '"text"', '\uFEFF{"x":1}', '{"nested":{"a":2}}']) {
        const bytes = encoder.encode(text);
        assert.deepEqual(await readNativeNetworkJson(fixture([bytes]).request, 64), await fixture([bytes]).request.json());
    }
});

test('empty chunks do not change byte accounting and JSON errors do not become 413', async () => {
    assert.deepEqual(await readNativeNetworkJson(fixture([new Uint8Array(), encoder.encode('{}'), new Uint8Array()]).request, 2), {});
    await assert.rejects(readNativeNetworkJson(fixture([encoder.encode('{')]).request, 4), SyntaxError);
    await assert.rejects(readNativeNetworkJson(fixture([encoder.encode('{}')]).request, 1), JsonBodyTooLargeError);
    assert.equal(jsonBodyTooLargeResponse(new SyntaxError()), null);
    const response = jsonBodyTooLargeResponse(new JsonBodyTooLargeError())!;
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' });
});

test('invalid configured budgets fail before observing the request', async () => {
    const request = { get headers(): Headers { return assert.fail('must validate configuration first'); } } as unknown as Request;
    for (const cap of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(readBoundedJsonBody(request, cap), RangeError);
    }
});

test('clinical content and existing transcript allowance fit without truncation', async () => {
    assert.equal(NATIVE_BOOTSTRAP_JSON_MAX_BYTES, 65_536);
    assert.equal(NETWORK_JSON_MAX_BYTES, 4_194_304);
    // Ordinary synthetic text, well below the production cap; no large-body reproduction.
    const body = { transcript: 'è'.repeat(12_000), notes: 'Nota sintetica 🩺', version: 2, data: 'ENC:aQ==:ZGF0YQ==' };
    const escaped = JSON.stringify(body).replace(/è/g, '\\u00e8');
    assert.ok(utf8ByteLength(escaped) < NETWORK_JSON_MAX_BYTES);
    assert.deepEqual(await readNativeNetworkJson(fixture([encoder.encode(escaped)]).request), body);
});

test('attachment budget reuses configured ciphertext allowance for canonical JSON', () => {
    const previous = process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
    try {
        delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
        assert.equal(networkAttachmentJsonMaxBytes(), 30_408_704);
        process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '32';
        assert.equal(networkAttachmentJsonMaxBytes(), 32 + NETWORK_JSON_MAX_BYTES);
        const sealed = 'ENC:aQ==:ZGF0YQ==';
        assert.ok(encoder.encode(JSON.stringify({ data: sealed })).length < networkAttachmentJsonMaxBytes());
        process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = String(Number.MAX_SAFE_INTEGER);
        assert.throws(networkAttachmentJsonMaxBytes, RangeError);
    } finally {
        if (previous === undefined) delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
        else process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = previous;
    }
});

// @Codex: the synchronous export preserves the canonical body parser semantics.
test('canonical synchronous strict parser validates keys at each object level', () => {
    assert.deepEqual(parseStrictJson('{"a":1,"nested":{"a":2}}'), { a: 1, nested: { a: 2 } });
    assert.throws(() => parseStrictJson('{"a":1,"a":2}'), SyntaxError);
    assert.throws(() => parseStrictJson('{"nested":{"a":1,"\\u0061":2}}'), SyntaxError);
    assert.throws(() => parseStrictJson('{"a":}'), SyntaxError);
});
