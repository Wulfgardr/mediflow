import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import diagnostic from './anydoc-http-diagnostic.cjs';

const ID = 'ad1-0123456789abcdef0123456789abcdef-1-1';
const { assertSyntheticFixture, installHttpDiagnostic, openDiagnosticFile, exportDiagnosticFile } = diagnostic;

function syntheticDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anydoc-artifact-test-'));
  fs.writeFileSync(path.join(directory, 'SYNTHETIC_ONLY'), 'Synthetic test fixture');
  return { directory, env: { MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DATA_DIR: directory,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1' } };
}

function fixture(write) {
  class Server extends EventEmitter {}
  const records = [];
  const restore = installHttpDiagnostic(Server.prototype, write ?? (value => records.push(value)));
  const request = Object.assign(new EventEmitter(), {
    method: 'POST', url: '/api/attachments/PRIVATE-ID/local-extraction',
    headers: { 'x-mediflow-anydoc-diagnostic': ID, cookie: 'PRIVATE-COOKIE', 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': 'PRIVATE-GRANT' },
  });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, writableFinished: false });
  return { server: new Server(), request, response, raw: records,
    get records() { return records.filter(record => ['request', 'request_aborted', 'response_finish', 'response_close'].includes(record.event)); }, restore };
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

test('release preserves its own diagnostic identity; unrelated routes and acquire remain unobserved', () => {
  const f = fixture();
  f.request.headers['x-mediflow-extraction-action'] = 'acquire';
  f.server.emit('request', f.request, f.response);
  f.request.method = 'DELETE'; f.request.url = '/api/patients/PRIVATE-ID';
  f.server.emit('request', f.request, f.response);
  assert.equal(f.records.length, 0);
  f.request.url = '/api/attachments/PRIVATE-ID/local-extraction';
  f.server.emit('request', f.request, f.response);
  assert.equal(f.records[0].action, 'release');
  assert.equal(f.records[0].id, ID);
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

test('same-source requests keep distinct diagnostic identities without route or grant identifiers', () => {
  const f = fixture();
  f.server.emit('request', f.request, f.response);
  f.request.method = 'DELETE';
  f.request.headers['x-mediflow-anydoc-diagnostic'] = ID.replace('-1-1', '-1-2');
  f.server.emit('request', f.request, f.response);
  f.request.method = 'POST';
  f.request.headers['x-mediflow-anydoc-diagnostic'] = ID.replace('-1-1', '-2-3');
  f.server.emit('request', f.request, f.response);
  assert.deepEqual(f.records.map(r => [r.id, r.action]),
    [[ID, 'project'], [ID.replace('-1-1', '-1-2'), 'release'], [ID.replace('-1-1', '-2-3'), 'project']]);
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
  f.restore();
  assert.equal(f.raw.at(-1).limited, 12);
  assert.equal(f.raw.at(-1).requests, 140);
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

test('dedicated file projects allowed primitive fields and rejects free text in allowed fields', () => {
  const { directory, env } = syntheticDirectory();
  const excluded = 'SYNTHETIC_EXCLUDED_CONTENT_CREDENTIAL';
  let sink;
  try {
    sink = openDiagnosticFile(env);
    const record = { event: 'request', seq: 1, id: ID, action: 'project', at: 123,
      status: 200, headersSent: false, writableFinished: false };
    sink.write({ ...record, payload: excluded, message: excluded, url: `/private?token=${excluded}`,
      headers: { authorization: excluded }, toJSON: () => ({ payload: excluded }) });
    sink.write({ event: 'collector_start', seq: 2, at: 124, message: excluded, payload: excluded });
    for (const key of Object.keys(record)) sink.write({ ...record, [key]: excluded });
    sink.write({ ...record, id: 'not-a-diagnostic-id' });
    sink.write({ ...record, seq: 0 });
    sink.write({ ...record, at: Number.NaN });
    sink.write({ ...record, status: Number.POSITIVE_INFINITY });
    sink.close(); sink = null;
    const text = fs.readFileSync(path.join(directory, 'anydoc-http-diagnostic.jsonl'), 'utf8');
    assert.deepEqual(text.trim().split('\n').map(line => JSON.parse(line)),
      [record, { event: 'collector_start', seq: 2, at: 124 }]);
    assert.equal(text.includes(excluded), false);
    assert.doesNotMatch(text, /"(?:payload|message|url|headers|authorization|toJSON)":/);
  } finally { sink?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('dedicated file requires the synthetic guard and never appends to or overwrites an existing path', () => {
  const { directory, env } = syntheticDirectory();
  try {
    assert.throws(() => openDiagnosticFile({ ...env, E2E_DISABLE_LEGACY_COPY: '0' }));
    const target = path.join(directory, 'anydoc-http-diagnostic.jsonl');
    assert.equal(fs.existsSync(target), false);
    fs.writeFileSync(target, 'SYNTHETIC_PREVIOUS_RECEIPT');
    assert.throws(() => openDiagnosticFile(env), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'SYNTHETIC_PREVIOUS_RECEIPT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('real preload and exporter write only metadata to the exact uploaded file, excluding raw stdout stderr and request sentinels', () => {
  const { directory, env } = syntheticDirectory();
  try {
    const workflow = fs.readFileSync(new URL('../.github/workflows/e2e.yml', import.meta.url), 'utf8');
    const upload = workflow.match(/- name: Upload Playwright report[\s\S]*?path: \|\n((?: {12}.+\n)+)/);
    assert.ok(upload, 'The existing report upload must expose its explicit path list.');
    const paths = upload[1].trim().split('\n').map(line => line.trim());
    assert.deepEqual(paths, ['playwright-report', 'test-results']);
    const artifactStep = workflow.match(/- name: Upload AnyDoc diagnostic metadata[\s\S]*$/)?.[0];
    assert.ok(artifactStep);
    assert.match(artifactStep, /if: always\(\) && steps\.anydoc_diagnostic_export\.outcome == 'success'/);
    const artifactPath = artifactStep.match(/\n {10}path: (.+)/)?.[1];
    assert.equal(artifactPath, '${{ runner.temp }}/anydoc-http-diagnostic.jsonl');
    assert.match(workflow, /id: anydoc_diagnostic_export\n {8}if: always\(\)\n {8}run: node scripts\/anydoc-http-diagnostic\.cjs --export "\$\{RUNNER_TEMP\}\/anydoc-http-diagnostic\.jsonl"/);
    assert.match(workflow, /run: node --test scripts\/anydoc-http-diagnostic\.test\.mjs/);
    const sentinels = ['SYNTHETIC_EXCLUDED_STDOUT', 'SYNTHETIC_EXCLUDED_STDERR', 'SYNTHETIC_EXCLUDED_BODY',
      'SYNTHETIC_EXCLUDED_ID', 'SYNTHETIC_EXCLUDED_QUERY', 'SYNTHETIC_EXCLUDED_HEADER'];
    const script = `
      const { EventEmitter } = require('node:events');
      const http = require('node:http');
      const [out, err, body, id, query, header] = ${JSON.stringify(sentinels)};
      process.stdout.write(out + '\\nANYDOC_HTTP_DIAGNOSTIC ' + JSON.stringify({ payload: body }) + '\\n');
      process.stderr.write(err + '\\n');
      const server = new http.Server();
      server.on('request', (req, res) => {
        process.stdout.write(req.body + '\\n' + req.url + '\\n' + req.headers.authorization + '\\n');
        res.headersSent = true; res.writableFinished = true;
        res.emit('finish'); res.emit('close');
      });
      for (const [method, suffix] of [['POST', ''], ['DELETE', ''], ['POST', '?token=' + query]]) {
        const req = Object.assign(new EventEmitter(), { method,
          url: '/api/attachments/' + id + '/local-extraction' + suffix, body,
          headers: { authorization: header, cookie: header, 'x-mediflow-extraction-grant': header,
            'x-mediflow-extraction-action': 'project',
            'x-mediflow-anydoc-diagnostic': 'ad1-0123456789abcdef0123456789abcdef-1-' + (method === 'DELETE' ? '2' : '1') } });
        const res = Object.assign(new EventEmitter(), { statusCode: method === 'DELETE' ? 204 : 200,
          headersSent: false, writableFinished: false });
        server.emit('request', req, res);
      }
    `;
    const childEnv = { ...process.env, ...env, MEDIFLOW_ANYDOC_HTTP_DIAGNOSTIC: '1' };
    delete childEnv.NODE_OPTIONS;
    const preload = fileURLToPath(new URL('./anydoc-http-diagnostic.cjs', import.meta.url));
    const child = spawnSync(process.execPath, ['--require', preload,
      '-e', script], { env: childEnv, encoding: 'utf8', timeout: 10_000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0);
    for (const sentinel of sentinels) assert.equal((child.stdout + child.stderr).includes(sentinel), true);
    const uploadDirectory = path.join(directory, 'upload'); fs.mkdirSync(uploadDirectory);
    const uploadedFile = artifactPath.replace('${{ runner.temp }}', uploadDirectory);
    const exported = spawnSync(process.execPath, [preload, '--export', uploadedFile],
      { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000 });
    assert.ifError(exported.error); assert.equal(exported.status, 0);
    const text = fs.readFileSync(uploadedFile, 'utf8');
    for (const sentinel of sentinels) assert.equal(text.includes(sentinel), false);
    const records = text.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 9);
    assert.equal(records[0].event, 'collector_start');
    assert.equal(records.at(-2).event, 'collector_end');
    assert.deepEqual(records.at(-1), { event: 'collection_status', complete: true, retained: 8 });
    const lifecycle = records.slice(1, -2);
    assert.deepEqual(lifecycle.map(record => record.event), ['request', 'response_finish', 'response_close',
      'request', 'response_finish', 'response_close']);
    assert.deepEqual(lifecycle.map(record => record.action), ['project', 'project', 'project', 'release', 'release', 'release']);
    for (const record of lifecycle) {
      assert.deepEqual(Object.keys(record).sort(), ['action', 'at', 'event', 'headersSent', 'id', 'seq', 'status', 'writableFinished'].sort());
      for (const key of ['at', 'seq', 'status']) assert.equal(Number.isSafeInteger(record[key]), true);
      assert.equal(typeof record.headersSent, 'boolean'); assert.equal(typeof record.writableFinished, 'boolean');
    }
    assert.doesNotMatch(text, /SYNTHETIC_|payload|authorization|cookie|grant|token|attachments/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('export refuses preexisting unapproved source bytes and returns failure without producing an upload', () => {
  const { directory, env } = syntheticDirectory();
  const excluded = 'SYNTHETIC_EXCLUDED_PREEXISTING_PAYLOAD_CREDENTIAL';
  try {
    const source = path.join(directory, 'anydoc-http-diagnostic.jsonl');
    const destination = path.join(directory, 'upload.jsonl');
    const record = { event: 'request', seq: 1, id: ID, action: 'project', at: 123,
      status: 200, headersSent: false, writableFinished: false };
    for (const text of [excluded, JSON.stringify({ ...record, payload: excluded }), JSON.stringify({ ...record, event: excluded }),
      JSON.stringify(null), excluded.repeat(4000), `${JSON.stringify(record)}\n`.repeat(515)]) {
      fs.writeFileSync(source, text);
      assert.throws(() => openDiagnosticFile(env), { code: 'EEXIST' });
      const exported = spawnSync(process.execPath,
        [fileURLToPath(new URL('./anydoc-http-diagnostic.cjs', import.meta.url)), '--export', destination],
        { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000 });
      assert.ifError(exported.error); assert.equal(exported.status, 1);
      assert.equal(exported.stderr, 'ANYDOC_HTTP_DIAGNOSTIC_EXPORT_FAILED\n');
      assert.equal(exported.stdout, '');
      assert.equal(fs.existsSync(destination), false);
      assert.equal(fs.readFileSync(source, 'utf8'), text);
    }
    fs.writeFileSync(source, `${JSON.stringify(record)}\n`);
    fs.writeFileSync(destination, excluded);
    assert.throws(() => exportDiagnosticFile(env, destination), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(destination, 'utf8'), excluded);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('export retains valid partial evidence but reports missing, duplicate or unsealed records as incomplete', () => {
  const { directory, env } = syntheticDirectory();
  try {
    const sink = openDiagnosticFile(env);
    const f = fixture(record => sink.write(record));
    f.server.emit('request', f.request, f.response);
    f.response.headersSent = true; f.response.writableFinished = true;
    f.response.emit('finish'); f.response.emit('close');
    f.restore(); sink.close();
    const source = path.join(directory, 'anydoc-http-diagnostic.jsonl');
    const complete = fs.readFileSync(source, 'utf8').trim().split('\n');
    assert.equal(complete.length, 5);
    const variants = [complete, ...complete.map((_, index) => complete.filter((_, i) => index !== i)),
      [complete[0], ...complete], []];
    for (const [index, lines] of variants.entries()) {
      fs.writeFileSync(source, lines.length ? lines.join('\n') + '\n' : '');
      const destination = path.join(directory, `export-${index}.jsonl`);
      exportDiagnosticFile(env, destination);
      const exported = fs.readFileSync(destination, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(exported.at(-1).event, 'collection_status');
      assert.equal(exported.at(-1).complete, index === 0);
      assert.equal(exported.at(-1).retained, lines.length);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('invalid diagnostic header text is counted without being logged or changing the handler', () => {
  const f = fixture();
  f.request.headers['x-mediflow-anydoc-diagnostic'] = 'SYNTHETIC_EXCLUDED_DIAGNOSTIC_HEADER';
  let called = 0;
  f.server.on('request', () => { called++; });
  assert.equal(f.server.emit('request', f.request, f.response), true);
  f.restore();
  assert.equal(called, 1);
  assert.equal(f.raw.at(-1).invalid, 1);
  assert.doesNotMatch(JSON.stringify(f.raw), /SYNTHETIC_EXCLUDED|PRIVATE/u);
});
