/* @Codex: sequencing-only tests. Test callbacks are not a database or host qualification. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentUploadQueue, readDocumentDataUrl } from './document-upload-queue.ts';

const source = (name: string) => ({ name });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('empty batches do no work; successful reads and acknowledged writes remain sequential', async () => {
    const calls: string[] = [];
    const queue = createDocumentUploadQueue({
        async read(file: { name: string }) { calls.push(`read:${file.name}`); return file.name; },
        async persist(file, data) { assert.equal(data, file.name); calls.push(`write:${file.name}`); },
    });
    assert.equal(queue.start([]), null);
    assert.deepEqual(await queue.start([source('synthetic-a'), source('synthetic-b')]), {
        saved: 2, unconfirmed: [], notStarted: 0, interrupted: false,
    });
    assert.deepEqual(calls, ['read:synthetic-a', 'write:synthetic-a', 'read:synthetic-b', 'write:synthetic-b']);
});

test('reentry is rejected synchronously, including before a React rerender could disable the input', async () => {
    const read = deferred<string>();
    let writes = 0;
    const queue = createDocumentUploadQueue({ read: () => read.promise, async persist() { writes += 1; } });
    const first = queue.start([source('synthetic-a')]);
    assert.notEqual(first, null);
    assert.equal(queue.start([source('synthetic-b')]), null);
    read.resolve('data:synthetic');
    await first;
    assert.equal(writes, 1);
    assert.equal((await queue.start([source('synthetic-c')]))?.saved, 1);
    assert.equal(writes, 2);
});

test('cancel during a read prevents persistence even when the read ignores AbortSignal and resolves late', async () => {
    const read = deferred<string>();
    let signal: AbortSignal | undefined;
    let writes = 0;
    const queue = createDocumentUploadQueue({
        read: (_file, currentSignal) => { signal = currentSignal; return read.promise; },
        async persist() { writes += 1; },
    });
    const task = queue.start([source('synthetic-a'), source('synthetic-b')]);
    queue.cancel();
    assert.equal(signal?.aborted, true);
    assert.equal(queue.start([source('synthetic-c')]), null);
    read.resolve('late synthetic data');
    assert.deepEqual(await task, { saved: 0, unconfirmed: [], notStarted: 2, interrupted: true });
    assert.equal(writes, 0);
});

test('an aborted read rejection is not presented as a failed or confirmed write', async () => {
    const read = deferred<string>();
    const queue = createDocumentUploadQueue({ read: () => read.promise, async persist() { assert.fail('write after abort'); } });
    const task = queue.start([source('synthetic-a')]);
    queue.cancel(); read.reject(new DOMException('Cancelled', 'AbortError'));
    assert.deepEqual(await task, { saved: 0, unconfirmed: [], notStarted: 1, interrupted: true });
});

test('cancel cannot roll back an already submitted write; busy lasts until its acknowledgement', async () => {
    const entered = deferred<void>(); const write = deferred<void>();
    const reads: string[] = [];
    const queue = createDocumentUploadQueue({
        async read(file: { name: string }) { reads.push(file.name); return 'synthetic'; },
        persist: () => { entered.resolve(); return write.promise; },
    });
    const task = queue.start([source('synthetic-a'), source('synthetic-b')]);
    await entered.promise; queue.cancel();
    assert.equal(queue.start([source('synthetic-c')]), null);
    write.resolve();
    assert.deepEqual(await task, { saved: 1, unconfirmed: [], notStarted: 1, interrupted: true });
    assert.deepEqual(reads, ['synthetic-a']);
});

test('a lost write response after cancel stays unconfirmed and is never automatically replayed', async () => {
    const entered = deferred<void>(); const write = deferred<void>();
    let writes = 0;
    const queue = createDocumentUploadQueue({
        async read() { return 'synthetic'; },
        persist: () => { writes += 1; entered.resolve(); return write.promise; },
    });
    const task = queue.start([source('synthetic-a'), source('synthetic-b')]);
    await entered.promise; queue.cancel(); write.reject(new Error('synthetic transport failure'));
    assert.deepEqual(await task, { saved: 0, unconfirmed: ['synthetic-a'], notStarted: 1, interrupted: true });
    assert.equal(writes, 1);
});

test('partial batch retains acknowledgements and each unconfirmed filename without automatic retries', async () => {
    const writes: string[] = [];
    const queue = createDocumentUploadQueue({
        async read(file: { name: string }) {
            if (file.name === 'synthetic-read-error') throw new Error('synthetic read error');
            return 'synthetic';
        },
        async persist(file) {
            writes.push(file.name);
            if (file.name === 'synthetic-write-error') throw new Error('synthetic lost response');
        },
    });
    const result = await queue.start(['synthetic-ok', 'synthetic-read-error', 'synthetic-write-error', 'synthetic-ok-2'].map(source));
    assert.deepEqual(result, { saved: 2, unconfirmed: ['synthetic-read-error', 'synthetic-write-error'], notStarted: 0, interrupted: false });
    assert.deepEqual(writes, ['synthetic-ok', 'synthetic-write-error', 'synthetic-ok-2']);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result?.unconfirmed), true);
});

test('batch membership is captured once; later caller mutations cannot append a write', async () => {
    const read = deferred<string>(); const files = [source('synthetic-a')];
    const writes: string[] = [];
    const queue = createDocumentUploadQueue({ read: () => read.promise, async persist(file) { writes.push(file.name); } });
    const task = queue.start(files);
    files.push(source('synthetic-b')); read.resolve('synthetic');
    await task;
    assert.deepEqual(writes, ['synthetic-a']);
});

test('queue reuse after StrictMode-style cleanup does not permanently disable subsequent explicit uploads', async () => {
    let writes = 0;
    const queue = createDocumentUploadQueue({ async read() { return 'synthetic'; }, async persist() { writes += 1; } });
    queue.cancel(); queue.cancel();
    assert.equal((await queue.start([source('synthetic-a')]))?.saved, 1);
    queue.cancel();
    assert.equal((await queue.start([source('synthetic-b')]))?.saved, 1);
    assert.equal(writes, 2);
});

test('pre-aborted FileReader request never constructs or reads a file', async () => {
    const controller = new AbortController(); controller.abort();
    // Node deliberately has no FileReader: this must reject before touching it.
    await assert.rejects(readDocumentDataUrl(new File(['synthetic'], 'synthetic.txt'), controller.signal), { name: 'AbortError' });
});
