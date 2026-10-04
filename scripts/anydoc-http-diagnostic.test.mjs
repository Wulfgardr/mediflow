import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSyntheticFixture, installHttpDiagnostic } from './anydoc-http-diagnostic.cjs';

function fixture(write) {
  class Server extends EventEmitter {}
  const records = [];
  const restore = installHttpDiagnostic(Server.prototype, write ?? (value => records.push(value)));
  const request = Object.assign(new EventEmitter(), {
    method: 'POST', url: '/api/attachments/PRIVATE-ID/local-extraction',
    headers: { cookie: 'PRIVATE-COOKIE', 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': 'PRIVATE-GRANT' },
  });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, writableFinished: false });
  return { server: new Server(), request, response, records, restore };
}

test('observes server finish and close without changing request objects, handlers or return value', () => {
  const f = fixture(); let called = 0;
  f.server.on('request', (request, response) => {
    assert.strictEqual(request, f.request); assert.strictEqual(response, f.response); called++;
  });
  assert.equal(f.server.emit('request', f.request, f.response), true);
  f.response.headersSent = true; f.response.writableFinished = true;
  f.response.emit('finish'); f.response.emit('close');
  assert.equal(called, 1);
  assert.deepEqual(f.records.map(r => r.event), ['request', 'response_finish', 'response_close']);
  assert.equal(f.records[2].writableFinished, true);
  assert.doesNotMatch(JSON.stringify(f.records), /PRIVATE|attachments|cookie|grant/i);
  f.restore();
});

test('distinguishes aborted upload and premature response close from completed HTTP publication', () => {
  const f = fixture();
  f.server.emit('request', f.request, f.response);
  f.request.emit('aborted'); f.response.emit('close');
  assert.deepEqual(f.records.map(r => r.event), ['request', 'request_aborted', 'response_close']);
  assert.equal(f.records[2].writableFinished, false);
  f.restore();
});

test('release receives its own ordinal; unrelated routes and acquire remain unobserved', () => {
  const f = fixture();
  f.request.headers['x-mediflow-extraction-action'] = 'acquire';
  f.server.emit('request', f.request, f.response);
  f.request.method = 'DELETE'; f.request.url = '/api/patients/PRIVATE-ID';
  f.server.emit('request', f.request, f.response);
  assert.equal(f.records.length, 0);
  f.request.url = '/api/attachments/PRIVATE-ID/local-extraction';
  f.server.emit('request', f.request, f.response);
  assert.equal(f.records[0].action, 'release');
  assert.equal(f.records[0].request, 1);
  f.restore();
});

test('diagnostic sink failure cannot block the application handler', () => {
  const f = fixture(() => { throw new Error('PRIVATE-SINK'); }); let called = false;
  f.server.on('request', () => { called = true; });
  assert.equal(f.server.emit('request', f.request, f.response), true);
  assert.equal(called, true);
  assert.doesNotThrow(() => f.response.emit('finish'));
  f.restore();
});

test('groups source operations with local ordinals without logging routes or grant identifiers', () => {
  const f = fixture();
  f.server.emit('request', f.request, f.response);
  f.request.method = 'DELETE';
  f.server.emit('request', f.request, f.response);
  f.request.url = '/api/attachments/OTHER-PRIVATE-ID/local-extraction';
  f.request.method = 'POST';
  f.server.emit('request', f.request, f.response);
  assert.deepEqual(f.records.map(r => [r.request, r.source, r.action]),
    [[1, 1, 'project'], [2, 1, 'release'], [3, 2, 'project']]);
  assert.doesNotMatch(JSON.stringify(f.records), /PRIVATE|attachments|cookie|grant/i);
  f.restore();
});

test('bounded request observation marks omitted evidence explicitly', () => {
  const f = fixture();
  for (let index = 0; index < 140; index++) {
    const request = Object.assign(new EventEmitter(), {
      method: f.request.method, url: f.request.url, headers: f.request.headers,
    });
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: true, writableFinished: true });
    f.server.emit('request', request, response); response.emit('finish'); response.emit('close');
  }
  assert.equal(f.records.filter(r => r.event === 'request').length, 128);
  assert.equal(f.records.filter(r => r.event === 'diagnostic_limit').length, 1);
  f.restore();
});

test('preload requires an explicitly marked independent synthetic fixture with legacy copying disabled', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anydoc-diagnostic-test-'));
  const env = { MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DATA_DIR: directory,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1' };
  try {
    assert.throws(() => assertSyntheticFixture({}));
    assert.throws(() => assertSyntheticFixture(env));
    fs.writeFileSync(path.join(directory, 'SYNTHETIC_ONLY'), 'Synthetic test fixture');
    assert.doesNotThrow(() => assertSyntheticFixture(env));
    assert.throws(() => assertSyntheticFixture({ ...env, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '0' }));
    assert.throws(() => assertSyntheticFixture({ ...env, MEDIFLOW_E2E_DATA_DIR: '/different' }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
