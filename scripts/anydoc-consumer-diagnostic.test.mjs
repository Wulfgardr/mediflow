import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Evaluate only the test helper in a separate realm; no application/DB imports.
const source = fs.readFileSync(new URL('./anydoc-consumer-diagnostic.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const chunk = { done: false, value: new Uint8Array([83, 69, 67, 82, 69, 84]) };
  const readPromise = Promise.resolve(chunk);
  const cancelPromise = Promise.resolve();
  let reads = 0, cancels = 0, releases = 0;
  const reader = {
    read() { reads++; return readPromise; },
    cancel() { cancels++; return cancelPromise; },
    releaseLock() { releases++; },
  };
  const body = { getReader() { return reader; } };
  const response = { status: 200, body };
  const fetchPromise = Promise.resolve(response);
  let called;
  const nativeFetch = function(...args) { called = { receiver: this, args }; return fetchPromise; };
  const listeners = new Map();
  const context = vm.createContext({ exports: {}, URL, Request, Headers, Uint8Array,
    location: { href: 'http://127.0.0.1:3000/synthetic' }, fetch: nativeFetch,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  });
  vm.runInContext(compiled, context);
  context.exports.installAnyDocConsumerDiagnostic('/api/attachments/SYN/local-extraction');
  const api = context.__mfAnyDocDiagnostic;
  api.arm(1);
  return { context, api, body, reader, readPromise, cancelPromise, response, fetchPromise, nativeFetch,
    counts: () => ({ reads, cancels, releases }), called: () => called };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function streamFixture({ delayedResponse = false } = {}) {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const response = new Response(stream);
  let resolveResponse;
  const responsePromise = delayedResponse ? new Promise(resolve => { resolveResponse = resolve; }) : Promise.resolve(response);
  const context = vm.createContext({ exports: {}, URL, Request, Headers, Uint8Array,
    location: { href: 'http://synthetic.invalid/' }, fetch: () => responsePromise,
    addEventListener() {}, removeEventListener() {},
  });
  vm.runInContext(compiled, context);
  context.exports.installAnyDocConsumerDiagnostic('/api/attachments/SYN/local-extraction');
  const api = context.__mfAnyDocDiagnostic;
  api.arm(1);
  const fetch = signal => context.fetch('/api/attachments/SYN/local-extraction', {
    method: 'POST', headers: { 'x-mediflow-extraction-action': 'project' }, ...(signal ? { signal } : {}),
  });
  return { api, controller, stream, response, fetch, resolveResponse,
    eventNames: () => Array.from(api.snapshot().events, event => event.event) };
}

test('diagnostic preserves fetch, Response, reader and native Promise identities without reading extra bytes', async () => {
  const f = fixture();
  const signal = new AbortController();
  const input = '/api/attachments/SYN/local-extraction';
  const init = { method: 'POST', signal: signal.signal, headers: { 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': 'PRIVATE-GRANT' } };
  const receiver = {};
  const returned = Reflect.apply(f.context.fetch, receiver, [input, init]);
  assert.strictEqual(returned, f.fetchPromise);
  assert.strictEqual(f.called().receiver, receiver);
  assert.strictEqual(f.called().args[0], input); assert.strictEqual(f.called().args[1], init);
  assert.strictEqual(await returned, f.response);
  const reader = f.body.getReader();
  assert.strictEqual(reader, f.reader);
  assert.strictEqual(reader.read(), f.readPromise);
  await tick();
  signal.abort();
  assert.strictEqual(reader.cancel('PRIVATE-REASON'), f.cancelPromise);
  reader.releaseLock();
  assert.deepEqual(f.counts(), { reads: 1, cancels: 1, releases: 1 });
  const snapshot = f.api.snapshot();
  assert.deepEqual(Array.from(snapshot.events, event => event.event), [
    'armed', 'fetch_start', 'fetch_response', 'reader_acquired', 'read_start', 'read_chunk',
    'signal_abort', 'reader_cancel', 'reader_release',
  ]);
  assert.equal(snapshot.events.find(event => event.event === 'read_chunk').value, 6);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|PRIVATE|127\.0\.0\.1|attachments|SYN/);
  f.api.dispose();
  assert.strictEqual(f.context.fetch, f.nativeFetch);
});

test('diagnostic ignores other requests and bounds repeated observation metadata', async () => {
  const f = fixture();
  const originalGetReader = f.body.getReader;
  assert.strictEqual(f.context.fetch('/unselected', { method: 'POST' }), f.fetchPromise);
  await tick();
  assert.strictEqual(f.body.getReader, originalGetReader);
  assert.equal(f.api.snapshot().events.length, 1);
  for (let i = 0; i < 300; i++) f.api.arm(1);
  const snapshot = f.api.snapshot();
  assert.equal(snapshot.events.length, 128);
  assert.equal(snapshot.dropped, 173);
  f.api.dispose();
});

test('natural stream close records done after chunks without cancel or abort', async () => {
  const f = streamFixture();
  const reader = (await f.fetch()).body.getReader();
  f.controller.enqueue(new Uint8Array([1, 2, 3]));
  assert.equal((await reader.read()).done, false);
  const end = reader.read();
  f.controller.close();
  assert.equal((await end).done, true);
  reader.releaseLock();
  assert.deepEqual(f.eventNames(), ['armed', 'fetch_start', 'fetch_response', 'reader_acquired',
    'read_start', 'read_chunk', 'read_start', 'read_done', 'reader_release']);
  f.api.dispose();
});

test('abort and reader cancellation can produce done=true without natural EOF', async () => {
  const f = streamFixture();
  const controller = new AbortController();
  const reader = (await f.fetch(controller.signal)).body.getReader();
  const pending = reader.read();
  controller.signal.addEventListener('abort', () => { void reader.cancel('PRIVATE-REASON'); }, { once: true });
  controller.abort('PRIVATE-ABORT');
  assert.equal((await pending).done, true);
  reader.releaseLock();
  assert.deepEqual(f.eventNames(), ['armed', 'fetch_start', 'fetch_response', 'reader_acquired',
    'read_start', 'signal_abort', 'reader_cancel', 'read_done', 'reader_release']);
  assert.doesNotMatch(JSON.stringify(f.api.snapshot()), /PRIVATE|synthetic|attachments|SYN/);
  f.api.dispose();
});

test('stream rejection precedes cleanup cancellation and is not reported as done', async () => {
  const f = streamFixture();
  const reader = (await f.fetch()).body.getReader();
  const pending = reader.read();
  const failure = new TypeError('PRIVATE-TRANSPORT-DETAIL');
  f.controller.error(failure);
  await assert.rejects(pending, error => error === failure);
  // Match boundedResponseText cleanup after an unsuccessful read.
  await reader.cancel().catch(() => {});
  reader.releaseLock();
  assert.deepEqual(f.eventNames(), ['armed', 'fetch_start', 'fetch_response', 'reader_acquired',
    'read_start', 'read_rejected', 'reader_cancel', 'reader_release']);
  assert.doesNotMatch(JSON.stringify(f.api.snapshot()), /PRIVATE|TRANSPORT-DETAIL/);
  f.api.dispose();
});

test('dispose before response fulfillment prevents late stream instrumentation', async () => {
  const f = streamFixture({ delayedResponse: true });
  const getReader = f.stream.getReader;
  const pending = f.fetch();
  f.api.dispose();
  f.resolveResponse(f.response);
  assert.strictEqual(await pending, f.response);
  assert.strictEqual(f.stream.getReader, getReader);
  assert.deepEqual(f.eventNames(), ['armed', 'fetch_start']);
  f.controller.close();
});

test('dispose leaves existing stream wrappers inert without retaining objects for restoration', async () => {
  const f = streamFixture();
  const response = await f.fetch();
  f.api.dispose();
  const reader = response.body.getReader();
  assert.equal(Object.hasOwn(reader, 'read'), false);
  f.controller.close();
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
  assert.deepEqual(f.eventNames(), ['armed', 'fetch_start', 'fetch_response']);
});
