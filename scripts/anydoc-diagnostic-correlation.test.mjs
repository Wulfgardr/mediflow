import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import diagnostic from './anydoc-http-diagnostic.cjs';

const id = 'ad1-0123456789abcdef0123456789abcdef-1-1';
test('server lifecycle carries the exact ephemeral request identity', () => {
  class Server extends EventEmitter {}
  const records = [];
  const stop = diagnostic.installHttpDiagnostic(Server.prototype, record => records.push(record));
  try {
    const request = Object.assign(new EventEmitter(), { method: 'POST',
      url: '/api/attachments/SYNTHETIC_EXCLUDED_ID/local-extraction', headers: {
        'x-mediflow-extraction-action': 'project', 'x-mediflow-anydoc-diagnostic': id,
      } });
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, writableFinished: false });
    new Server().emit('request', request, response);
    response.headersSent = true; response.writableFinished = true;
    response.emit('finish'); response.emit('close');
    assert.deepEqual(records.filter(record => record.event === 'request' || record.event.startsWith('response_')).map(record => record.id), [id, id, id]);
  } finally { stop(); }
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import contract from './anydoc-diagnostic-contract.cjs';
import { observeAnyDocProjectResponse } from '../e2e/anydoc-project-response.ts';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../e2e/anydoc-consumer-diagnostic.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const target = '/api/attachments/SYNTHETIC_EXCLUDED_SOURCE/local-extraction';

// Exercise the real consumer/browser/server collectors together with ordinary
// in-memory Request/Response fixtures, not a browser or native protocol probe.
async function fixture({ sinkFailure = false, enabled = true, marker = true, delayBrowser = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anydoc-correlation-'));
  if (marker) fs.writeFileSync(path.join(directory, 'SYNTHETIC_ONLY'), 'Synthetic fixture');
  const env = { MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DATA_DIR: directory,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
    ...(enabled ? { MEDIFLOW_ANYDOC_HTTP_DIAGNOSTIC: '1' } : {}) };
  class Server extends EventEmitter {}
  const server = new Server();
  const records = [], calls = [];
  const stop = diagnostic.installHttpDiagnostic(Server.prototype, record => {
    if (sinkFailure && record.event === 'response_finish') throw new Error('SYNTHETIC_EXCLUDED_SINK');
    records.push(record);
  });
  let context, attachment, api;
  class Page extends EventEmitter {
    url() { return 'http://synthetic.invalid/'; }
    mainFrame() { return this; }
    async evaluate(fn, arg) {
      context.argument = arg;
      return vm.runInContext(`(${fn.toString()})(argument)`, context);
    }
  }
  const page = new Page();
  const nativeFetch = function(input, init) {
    const headers = Object.fromEntries(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const browserRequest = { url: () => new URL(input instanceof Request ? input.url : input, page.url()).href,
      method: () => method, headers: () => headers };
    const request = Object.assign(new EventEmitter(), { url: new URL(browserRequest.url()).pathname, method, headers });
    const response = Object.assign(new EventEmitter(), { statusCode: method === 'DELETE' ? 204 : 200,
      headersSent: false, writableFinished: false });
    const result = new Response(method === 'DELETE' ? null : 'SYNTHETIC_EXCLUDED_BODY', { status: response.statusCode });
    const promise = Promise.resolve(result);
    calls.push({ input, init, browserRequest, request, response, promise });
    if (!delayBrowser) page.emit('request', browserRequest);
    server.emit('request', request, response);
    response.headersSent = true; response.writableFinished = true;
    response.emit('finish'); response.emit('close');
    return promise;
  };
  context = vm.createContext({ exports: {}, require, process: { env }, Buffer, URL, Request, Headers, Uint8Array,
    location: { href: page.url() }, fetch: nativeFetch, addEventListener() {}, removeEventListener() {} });
  vm.runInContext(compiled, context);
  try { api = await context.exports.createAnyDocConsumerDiagnostic(page, 'SYNTHETIC_EXCLUDED_SOURCE'); }
  catch (error) { stop(); fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  return { api, context, page, records, calls, stop, env,
    async send(method = 'POST', terminal = 'requestfinished') {
      const init = { method, body: method === 'POST' ? new Uint8Array([1, 2, 3]) : undefined,
        headers: { 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': 'SYNTHETIC_EXCLUDED_GRANT',
          [contract.HEADER]: 'SYNTHETIC_EXCLUDED_RESERVED_HEADER' }, keepalive: method === 'DELETE',
        cache: 'no-store', credentials: 'same-origin', signal: new AbortController().signal };
      const promise = context.fetch(target, init);
      const call = calls.at(-1);
      assert.equal(promise, call.promise, 'native fetch Promise is unchanged');
      assert.equal(call.input, target);
      for (const key of ['body', 'signal', 'method', 'keepalive', 'cache', 'credentials']) assert.equal(call.init[key], init[key]);
      if (enabled) {
        assert.notEqual(call.init, init);
        assert.equal(init.headers[contract.HEADER], 'SYNTHETIC_EXCLUDED_RESERVED_HEADER');
        const copied = new Headers(call.init.headers);
        assert.ok(contract.parseId(copied.get(contract.HEADER)));
        for (const [key, value] of Object.entries(init.headers)) if (key !== contract.HEADER) assert.equal(copied.get(key), value);
      } else assert.equal(call.init, init);
      const response = await promise;
      if (method === 'POST') {
        const reader = response.body.getReader();
        while (!(await reader.read()).done) { /* Consume only the original body. */ }
        reader.releaseLock();
      }
      if (!delayBrowser) page.emit(terminal, call.browserRequest);
      await tick();
      return call;
    },
    async finish() {
      await api.attachAndDispose({ async attach(_name, { body }) { attachment = JSON.parse(body.toString()); } });
      stop();
      fs.rmSync(directory, { recursive: true, force: true });
      return { attachment, records, joined: contract.auditJoin(attachment, records) };
    },
  };
}

async function completeFixture(options) {
  const f = await fixture(options);
  for (const attempt of [1, 2]) {
    await f.api.arm(attempt);
    await f.send('POST', attempt === 1 ? 'requestfinished' : 'requestfailed');
    await f.send('DELETE', 'requestfailed');
  }
  return f.finish();
}

test('one-to-one join keeps attempts distinct and does not turn a negative terminal into HTTP success', async () => {
  const { attachment, records, joined } = await completeFixture();
  assert.equal(joined.complete, true);
  assert.equal(new Set(joined.requests.map(r => r.id)).size, 4);
  assert.deepEqual(joined.requests.map(r => [r.attempt, r.action, r.browserTerminal, r.serverFinished]), [
    [1, 'project', 'requestfinished', true], [1, 'release', 'release_requestfailed', true],
    [2, 'project', 'requestfailed', true], [2, 'release', 'release_requestfailed', true],
  ]);
  assert.doesNotMatch(JSON.stringify({ attachment, records, joined }), /SYNTHETIC_EXCLUDED|synthetic\.invalid|attachments|"(?:cookie|grant|headers|url)"/i);
  // Equal or unrelated timestamps must not affect join/completeness.
  for (const r of records) r.at = 100;
  for (const r of attachment.browser.events) r.at = 0;
  assert.deepEqual(contract.auditJoin(attachment, records), joined);
});

test('a delayed browser callback after arm(2) retains the captured attempt1 owner', async () => {
  const f = await fixture({ delayBrowser: true });
  await f.api.arm(1);
  const call = await f.send();
  await f.api.arm(2);
  f.page.emit('request', call.browserRequest);
  f.page.emit('requestfailed', call.browserRequest);
  const { attachment, joined } = await f.finish();
  assert.equal(joined.complete, true);
  assert.ok(attachment.browser.events.every(record => record.attempt === 1));
});

test('separate collections of the same URL have independent ephemeral scopes', async () => {
  const first = await completeFixture();
  const second = await completeFixture();
  assert.notEqual(first.attachment.scope, second.attachment.scope);
  assert.equal(contract.auditJoin(first.attachment, second.records).complete, false);
  assert.equal(contract.auditJoin(second.attachment, first.records).complete, false);
});

test('missing or duplicate records and missing seals are incomplete in each collector', async () => {
  const baseline = await completeFixture();
  for (const channel of ['consumer', 'browser']) {
    const length = baseline.attachment[channel].events.length;
    for (const index of [0, Math.floor(length / 2), length - 1]) {
      const changed = structuredClone(baseline.attachment);
      changed[channel].events.splice(index, 1);
      assert.equal(contract.auditJoin(changed, baseline.records).complete, false, `${channel} missing ${index}`);
    }
    const changed = structuredClone(baseline.attachment);
    changed[channel].events.splice(1, 0, changed[channel].events[0]);
    assert.equal(contract.auditJoin(changed, baseline.records).complete, false, `${channel} duplicate`);
    changed[channel] = { ...baseline.attachment[channel], sealed: false };
    assert.equal(contract.auditJoin(changed, baseline.records).complete, false, `${channel} unsealed`);
  }
  for (let index = 0; index < baseline.records.length; index++) {
    const records = structuredClone(baseline.records); records.splice(index, 1);
    assert.equal(contract.auditJoin(baseline.attachment, records).complete, false, `server missing ${index}`);
  }
  const duplicate = [...baseline.records]; duplicate.splice(1, 0, duplicate[0]);
  assert.equal(contract.auditJoin(baseline.attachment, duplicate).complete, false);
});

test('wrong IDs, owner changes and duplicate request identities never form an exact join', async () => {
  const { attachment, records } = await completeFixture();
  for (const mutate of [
    a => { a.browser.events[0].id = 'ad1-ffffffffffffffffffffffffffffffff-1-1'; },
    a => { a.browser.events[0].attempt = 2; },
    a => { delete a.consumer.events.find(record => record.event === 'read_chunk').id; },
    a => { for (const e of a.browser.events) if (e.id === a.browser.events[2].id) e.id = a.browser.events[0].id; },
  ]) {
    const copy = structuredClone(attachment); mutate(copy);
    assert.equal(contract.auditJoin(copy, records).complete, false);
  }
});

test('bounded client collectors report their loss and cannot form a complete join', async () => {
  const f = await fixture();
  await f.api.arm(1);
  const call = await f.send();
  for (let index = 0; index < 140; index++) {
    f.context.__mfAnyDocDiagnostic.arm(1);
    f.page.emit('requestfailed', call.browserRequest);
  }
  const { attachment, joined } = await f.finish();
  assert.equal(attachment.consumer.events.length, 128);
  assert.equal(attachment.browser.events.length, 128);
  assert.ok(attachment.consumer.dropped > 0 && attachment.browser.dropped > 0);
  assert.equal(joined.complete, false);
});

test('a sink exception is counted and cannot block application delivery or masquerade as a complete collection', async () => {
  const { records, joined } = await completeFixture({ sinkFailure: true });
  assert.equal(records.at(-1).dropped, 4);
  assert.equal(records.at(-1).pending, 0);
  assert.equal(joined.collection.server, false);
  assert.equal(joined.complete, false);
});

test('synthetic marker is mandatory when enabled; disabled collection does not change init or headers', async () => {
  await assert.rejects(fixture({ marker: false }), /ENOENT|REQUIRES_SYNTHETIC_FIXTURE/u);
  const f = await fixture({ enabled: false });
  await f.api.arm(1); await f.send();
  const { attachment, joined } = await f.finish();
  assert.equal(attachment.scope, null);
  assert.equal(joined.complete, false);
});

test('pending server lifecycle and rejected sink writes are explicitly incomplete', () => {
  class Server extends EventEmitter {}
  const records = [];
  const stop = diagnostic.installHttpDiagnostic(Server.prototype, record => {
    if (record.event === 'request') return false;
    records.push(record);
  });
  const req = Object.assign(new EventEmitter(), { method: 'DELETE', url: target, headers: { [contract.HEADER]: id } });
  const res = Object.assign(new EventEmitter(), { statusCode: 204, headersSent: false, writableFinished: false });
  new Server().emit('request', req, res); stop();
  assert.equal(records.at(-1).pending, 1);
  assert.equal(records.at(-1).dropped, 1);
  assert.equal(contract.serverComplete(records), false);
});

test('the unchanged negative-terminal rule reports only a validated diagnostic ID', async () => {
  for (const diagnosticId of [id, 'SYNTHETIC_EXCLUDED_PRIVATE_TOKEN']) {
    const session = new EventEmitter();
    session.send = async method => method === 'Network.streamResourceContent' ? { bufferedData: '' } : {};
    session.detach = async () => {};
    const page = Object.assign(new EventEmitter(), { url: () => 'http://synthetic.invalid/', context: () => ({ newCDPSession: async () => session }) });
    const observed = await observeAnyDocProjectResponse(page, 'SYNTHETIC_EXCLUDED_SOURCE');
    session.emit('Network.requestWillBeSent', { requestId: 'fake-original-request', request: {
      method: 'POST', url: new URL(target, page.url()).href,
      headers: { 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': 'SYNTHETIC_EXCLUDED_GRANT',
        [contract.HEADER]: diagnosticId },
    } });
    await tick();
    session.emit('Network.responseReceived', { requestId: 'fake-original-request', response: { url: new URL(target, page.url()).href, status: 200 } });
    session.emit('Network.dataReceived', { requestId: 'fake-original-request', dataLength: 2, data: Buffer.from('{}').toString('base64') });
    session.emit('Network.loadingFailed', { requestId: 'fake-original-request', canceled: true, errorText: 'net::ERR_ABORTED', type: 'Fetch' });
    await assert.rejects(observed.json({}), error => {
      assert.match(error.message, /status=200 received=2 streamed=2 prefix=0 finished=false canceled=true error=net::ERR_ABORTED/u);
      assert.equal(error.message.includes(`diagnosticId=${id}`), diagnosticId === id);
      assert.doesNotMatch(error.message, /SYNTHETIC_EXCLUDED/u);
      return true;
    });
    await observed.dispose();
  }
});
