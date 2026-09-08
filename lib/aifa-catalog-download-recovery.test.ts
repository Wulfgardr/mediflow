/* @Codex */
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { AIFA_DOWNLOAD_TIMEOUT_MS, withAifaDownload } from './aifa-catalog-download.ts';

// Only in-memory streams and invented CSV bytes. No AIFA network or catalog writes.
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const response = () => new Response('synthetic,catalog\n', { headers: { 'Content-Type': 'text/csv' } });
const transport = (get: () => Response | Promise<Response>) => (async () => get()) as typeof fetch;
const pendingMarker = Symbol('pending');
function observed<T>(promise: Promise<T>) {
    return promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
}
async function settled<T>(promise: Promise<T>): Promise<T | symbol> {
    return Promise.race([promise, nextTurn().then(() => pendingMarker as typeof pendingMarker)]);
}
async function retry() {
    assert.equal(await withAifaDownload(new AbortController().signal, async () => 'retried', transport(response)), 'retried');
}

test('rejected response preserves its error and releases single-flight without awaiting source cleanup', async () => {
    const cleanup = deferred<void>();
    const cancelling = deferred<void>();
    const stream = new ReadableStream<Uint8Array>({
        cancel() { cancelling.resolve(); return cleanup.promise; },
    });
    const outcome = observed(withAifaDownload(new AbortController().signal,
        async () => assert.fail('invalid response must not reach import'),
        transport(() => new Response(stream, { headers: { 'Content-Type': 'text/html' } }))));
    try {
        await cancelling.promise;
        const result = await settled(outcome);
        assert.ok(typeof result !== 'symbol', 'producer cleanup must not retain the update lock');
        assert.equal(result.error?.status, 422);
        await retry(); // Must succeed while the *previous* cancel promise is still pending.
        assert.equal(stream.locked, false);
    } finally { cleanup.resolve(); await outcome; }
});

test('request cancellation interrupts a pending body read even when source cleanup remains pending', async () => {
    const cleanup = deferred<void>();
    const reading = deferred<void>();
    let cancelled = false;
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) { source = controller; },
        pull() { reading.resolve(); },
        cancel() { cancelled = true; return cleanup.promise; },
    });
    const controller = new AbortController();
    const reason = new Error('synthetic request cancelled');
    const outcome = observed(withAifaDownload(controller.signal,
        async () => assert.fail('interrupted bytes must not reach import'),
        transport(() => new Response(stream, { headers: { 'Content-Type': 'text/csv' } }))));
    try {
        await reading.promise;
        await nextTurn();
        controller.abort(reason);
        const result = await settled(outcome);
        assert.ok(typeof result !== 'symbol', 'abort must settle a stalled read');
        assert.equal(result.error, reason);
        assert.equal(cancelled, true);
        assert.equal(stream.locked, false);
        await retry();
    } finally {
        if (!cancelled) source.close();
        cleanup.resolve();
        await outcome;
    }
});

test('production deadline bounds an unresponsive transport and discards its late response', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const responseLater = deferred<Response>();
    const started = deferred<void>();
    let requests = 0, consumed = 0, cancelled = 0;
    const cleanup = deferred<void>();
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; return cleanup.promise; } });
    const outcome = observed(withAifaDownload(new AbortController().signal, async () => { consumed++; },
        transport(() => { requests++; started.resolve(); return responseLater.promise; })));
    try {
        await started.promise;
        t.mock.timers.tick(AIFA_DOWNLOAD_TIMEOUT_MS - 1);
        assert.equal(await settled(outcome), pendingMarker, 'deadline must not be shortened');
        t.mock.timers.tick(1);
        const result = await settled(outcome);
        assert.ok(typeof result !== 'symbol', 'deadline must not depend on transport cooperation');
        assert.equal(result.error?.status, 504);
        assert.equal(requests, 1);
        await retry();
        responseLater.resolve(new Response(stream, { headers: { 'Content-Type': 'text/csv' } }));
        await nextTurn();
        assert.equal(consumed, 0);
        assert.equal(cancelled, 1);
        assert.equal(stream.locked, false);
        await retry();
    } finally {
        // A closed response also releases the baseline downloader after the observation fails.
        responseLater.resolve(response());
        cleanup.resolve();
        await outcome;
    }
});

test('single-flight remains held until the guarded consumer finishes after cancellation', async () => {
    const started = deferred<void>(), finish = deferred<void>();
    const controller = new AbortController();
    const reason = new Error('synthetic revoked during validation');
    const outcome = observed(withAifaDownload(controller.signal, async (_file, _acquisition, _signal, assertDeadline) => {
        started.resolve(); await finish.promise; assertDeadline();
    }, transport(response)));
    try {
        await started.promise; controller.abort(reason);
        await assert.rejects(withAifaDownload(new AbortController().signal,
            async () => assert.fail('second import'), transport(() => assert.fail('second download'))), { status: 409 });
        assert.equal(await settled(outcome), pendingMarker, 'do not detach a potentially writing consumer');
        finish.resolve();
        assert.equal((await outcome).error, reason);
        await retry();
    } finally { finish.resolve(); await outcome; }
});

test('cleanup rejection does not replace the validation error or prevent the next update', async () => {
    const stream = new ReadableStream<Uint8Array>({ cancel() { return Promise.reject(new Error('synthetic cleanup failure')); } });
    await assert.rejects(withAifaDownload(new AbortController().signal, async () => assert.fail('import'),
        transport(() => new Response(stream, { headers: { 'Content-Type': 'text/html' } }))), { status: 422 });
    await nextTurn();
    await retry();
});

test('production deadline also interrupts a stalled body without shortening the configured bound', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const reading = deferred<void>(), cleanup = deferred<void>();
    let source!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) { source = controller; },
        pull() { reading.resolve(); },
        cancel() { cancelled = true; return cleanup.promise; },
    });
    const outcome = observed(withAifaDownload(new AbortController().signal,
        async () => assert.fail('timed-out body must not reach import'),
        transport(() => new Response(stream, { headers: { 'Content-Type': 'text/csv' } }))));
    try {
        await reading.promise; await nextTurn();
        t.mock.timers.tick(AIFA_DOWNLOAD_TIMEOUT_MS - 1);
        assert.equal(await settled(outcome), pendingMarker);
        t.mock.timers.tick(1);
        const result = await settled(outcome);
        assert.ok(typeof result !== 'symbol', 'deadline must interrupt an incomplete body');
        assert.equal(result.error?.status, 504);
        assert.equal(cancelled, true);
        await retry();
    } finally { if (!cancelled) source.close(); cleanup.resolve(); await outcome; }
});
