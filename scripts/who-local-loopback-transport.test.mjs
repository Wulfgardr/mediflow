/* @Codex */
/* Host-only transport regression tests. Synthetic pipes/peers, NEVER Docker/WHO qualification. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createExecResponseFramer, parseExecResponse, makeExecRequest, execProgramArgs,
    EXEC_HTTP_PROGRAM, EXEC_MAX_WIRE_BYTES, runDockerAsync, exchangeWhoExec, openWhoLoopback } from './who-local-loopback.mjs';
import { probePath, PROBE_MAX_BYTES, PROBE_TIMEOUT_MS } from './who-local-probe.mjs';

const requestPath = probePath('acquisition');
const body = Buffer.from(JSON.stringify({ destinationEntities: [{ id: 'http://id.who.int/icd/release/11/2026-01/mms/1000000001',
    title: 'Synthetic café – not WHO runtime evidence', theCode: 'AA00' }] }));
const lengthWire = (value = body, extra = '', status = '200 OK') => Buffer.concat([
    Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${value.length}\r\n${extra}\r\n`), value]);
const chunkWire = (value = body, sizes = [1, 4, 11]) => {
    let offset = 0;
    const parts = [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n')];
    for (const size of [...sizes, value.length]) {
        if (offset === value.length) break;
        const chunk = value.subarray(offset, offset + size); offset += chunk.length;
        parts.push(Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from('\r\n'));
    }
    return Buffer.concat([...parts, Buffer.from('0\r\n\r\n')]);
};
const target = { endpoint: 'unix:///synthetic/docker.sock', containerId: 'a'.repeat(64),
    bindingSha256: 'sha256:' + 'b'.repeat(64), startedAt: '2026-09-12T00:00:00.000Z' };
const args = ['--host', target.endpoint, ...execProgramArgs(target.containerId, EXEC_HTTP_PROGRAM)];
const header = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n';
const chunkHeader = header + 'Transfer-Encoding: chunked\r\n\r\n';

for (const [name, value] of [['content-length', lengthWire()], ['chunked', chunkWire()]]) {
    test(`framer ${name}: every two-part split, including CRLF and UTF-8 splits`, () => {
        for (let cut = 0; cut <= value.length; cut++) {
            const observer = createExecResponseFramer();
            assert.equal(observer.push(value.subarray(0, cut)), cut === value.length, `prefix ${cut}`);
            assert.equal(observer.push(value.subarray(cut)), true, `suffix ${cut}`);
        }
        assert.equal(parseExecResponse(value, requestPath).body, body.toString());
    });
    test(`framer ${name}: single-byte chunks never finish on a prefix`, () => {
        const observer = createExecResponseFramer();
        for (let i = 0; i < value.length; i++) assert.equal(observer.push(value.subarray(i, i + 1)), i === value.length - 1);
        assert.equal(observer.push(Buffer.alloc(0)), true);
    });
    test(`framer ${name}: no second response after previously complete data`, () => {
        const observer = createExecResponseFramer(); assert.equal(observer.push(value), true);
        assert.throws(() => observer.push(Buffer.from('H')), e => /^probe_response_/u.test(e.code));
        assert.throws(() => observer.push(Buffer.alloc(0)), { code: 'probe_response_invalid' });
    });
    test(`framer ${name}: each proper prefix stays incomplete`, () => {
        for (let cut = 0; cut < value.length; cut++) assert.equal(createExecResponseFramer().push(value.subarray(0, cut)), false);
    });
}

test('framer and parser accept the exact 8192-byte header boundary, including split terminator', () => {
    const start = `${header}Content-Length: 2\r\nX-Pad: `;
    const h = start + 'x'.repeat(8192 - Buffer.byteLength(start));
    const full = Buffer.from(h + '\r\n\r\n{}');
    const observer = createExecResponseFramer();
    assert.equal(observer.push(full.subarray(0, 8195)), false);
    assert.equal(observer.push(full.subarray(8195)), true);
    assert.equal(parseExecResponse(full, requestPath).body, '{}');
});
test('framer rejects a header past 8192 even with a split terminator', () => {
    const observer = createExecResponseFramer();
    assert.throws(() => observer.push(Buffer.from('x'.repeat(8196))), { code: 'probe_response_invalid' });
    assert.throws(() => createExecResponseFramer().push(Buffer.from(`${header}X-Pad: ${'x'.repeat(8192)}\r\n\r\n`)), { code: 'probe_response_invalid' });
});
test('framer accepts exactly the body-byte cap, not an announced byte beyond it', () => {
    const full = lengthWire(Buffer.from('{"x":"' + 'x'.repeat(PROBE_MAX_BYTES - 8) + '"}'));
    assert.equal(createExecResponseFramer().push(full), true);
    assert.equal(Buffer.byteLength(parseExecResponse(full, requestPath).body), PROBE_MAX_BYTES);
    assert.throws(() => createExecResponseFramer().push(Buffer.from(`${header}Content-Length: ${PROBE_MAX_BYTES + 1}\r\n\r\n`)), { code: 'probe_response_invalid' });
});
test('framer counts the terminal zero chunk in the existing 1024-chunk limit', () => {
    const accepted = Buffer.from(chunkHeader + '1\r\nx\r\n'.repeat(1023) + '0\r\n\r\n');
    assert.equal(createExecResponseFramer().push(accepted), true);
    const denied = Buffer.from(chunkHeader + '1\r\nx\r\n'.repeat(1024) + '0\r\n\r\n');
    assert.throws(() => createExecResponseFramer().push(denied), { code: 'probe_response_invalid' });
});
test('framer bounds cumulative decoded chunk bytes, not just a single chunk', () => {
    const value = Buffer.concat([Buffer.from(chunkHeader + '10000\r\n'), Buffer.alloc(PROBE_MAX_BYTES, 32), Buffer.from('\r\n1\r\nx\r\n0\r\n\r\n')]);
    assert.throws(() => createExecResponseFramer().push(value), { code: 'probe_response_invalid' });
});
test('framer rejects over-wire-limit input and never recovers from an invalid push', () => {
    for (const invalid of [Buffer.alloc(EXEC_MAX_WIRE_BYTES + 1), '{}', undefined]) {
        const observer = createExecResponseFramer();
        assert.throws(() => observer.push(invalid), { code: 'probe_response_invalid' });
        assert.throws(() => observer.push(lengthWire()), { code: 'probe_response_invalid' });
    }
});

const invalidFrames = [
    ['duplicate length', `${header}Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}`],
    ['duplicate unknown header', `${header}X-A: a\r\nx-a: b\r\nContent-Length: 2\r\n\r\n{}`],
    ['CL/TE ambiguity', `${header}Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n`],
    ['TE list', `${header}Transfer-Encoding: gzip, chunked\r\n\r\n`],
    ['obs-fold', `${header} X: folded\r\nContent-Length: 2\r\n\r\n{}`],
    ['65 header fields', 'HTTP/1.1 200 OK\r\n' + Array.from({ length: 64 }, (_, i) => `X-${i}: a\r\n`).join('') + 'Content-Length: 2\r\n\r\n{}'],
    ['bad status', 'HTTP/2 200 OK\r\nContent-Length: 2\r\n\r\n{}'],
    ['missing length', `${header}\r\n{}`],
    ['fractional length', `${header}Content-Length: 2.0\r\n\r\n{}`],
    ['negative length', `${header}Content-Length: -1\r\n\r\n`],
    ['length list', `${header}Content-Length: 2,2\r\n\r\n{}`],
    ['unsafe length integer', `${header}Content-Length: 9007199254740993\r\n\r\n`],
    ['extension', chunkHeader + '2;x=y\r\n{}\r\n0\r\n\r\n'],
    ['nine digit chunk', chunkHeader + '000000002\r\n{}\r\n0\r\n\r\n'],
    ['oversize chunk size line without CRLF', chunkHeader + '0000000000'],
    ['chunk size sign', chunkHeader + '+2\r\n{}\r\n0\r\n\r\n'],
    ['bad chunk data terminator', chunkHeader + '2\r\n{}XX0\r\n\r\n'],
    ['trailers', chunkHeader + '2\r\n{}\r\n0\r\nX-Trailer: forbidden\r\n\r\n'],
    ['second chunked response', chunkHeader + '2\r\n{}\r\n0\r\n\r\nHTTP/1.1 200 OK\r\n\r\n'],
    ['extra length byte', `${header}Content-Length: 2\r\n\r\n{}x`],
];
for (const [name, text] of invalidFrames) test(`framer rejects ${name} in one chunk and bytewise`, () => {
    const value = Buffer.from(text);
    assert.throws(() => createExecResponseFramer().push(value), e => /^probe_response_/u.test(e.code));
    const observer = createExecResponseFramer();
    assert.throws(() => { for (const byte of value) observer.push(Buffer.from([byte])); }, e => /^probe_response_/u.test(e.code));
});
test('frame completion alone never validates MIME, status, JSON, or UTF-8', () => {
    for (const value of [lengthWire(Buffer.from('[]')), lengthWire(Buffer.from('not JSON')),
        lengthWire(Buffer.from([0xc3, 0x28])), lengthWire(body, '', '401 Unauthorized'), lengthWire(body, 'Content-Encoding: gzip\r\n')]) {
        assert.equal(createExecResponseFramer().push(value), true);
        assert.throws(() => parseExecResponse(value, requestPath));
    }
});
test('zero length and real codeinfo 404 are framed without manufacturing a lookup result', () => {
    const value = lengthWire(Buffer.alloc(0), '', '404 Not Found');
    assert.equal(createExecResponseFramer().push(value), true);
    assert.deepEqual(parseExecResponse(value, '/icd/release/11/2026-01/mms/codeinfo/AA00?flexiblemode=false&convertToTerminalCodes=false'), { status: 404, body: '' });
    assert.throws(() => parseExecResponse(value, requestPath), { code: 'probe_http_status' });
});

// Real host processes with real stdio, but a SYNTHETIC executable in a private PATH.
// The scripted peer deliberately needs request bytes before responding and EOF to
// exit; no HTTP reply depends on an arbitrary delay. Gates are test-owned files.
function syntheticCli(t, { value = lengthWire(), mode = 'reply', pieceBytes = 1 } = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'who-http-transport-test-'));
    const trace = path.join(root, 'events.jsonl'), gate = path.join(root, 'release');
    const previous = process.env.PATH;
    const source = `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs');
const root = ROOT, trace = TRACE, gate = GATE, mode = MODE, width = WIDTH;
const value = Buffer.from(VALUE, 'base64'), expected = Buffer.from(INPUT, 'base64');
let request = Buffer.alloc(0), dispatched = false, sent = 0, eof = false, watcher, ticker;
const event = (name, extra = {}) => fs.appendFileSync(trace, JSON.stringify({ event: name, ...extra }) + '\n');
const finish = code => { watcher?.close(); clearInterval(ticker); process.exitCode = code; };
const watchRelease = action => {
    const check = () => { if (fs.existsSync(gate)) { watcher.close(); action(); } };
    watcher = fs.watch(root, check); check();
};
function pump() {
    if (sent >= value.length) {
        event('complete_written');
        if (mode === 'stdout-end') process.stdout.end();
        return;
    }
    const end = Math.min(value.length, sent + width), part = value.subarray(sent, end);
    sent = end;
    process.stdout.write(part, () => setImmediate(pump));
}
process.stdout.on('error', () => finish(75));
process.stdin.on('data', chunk => {
    request = Buffer.concat([request, chunk]);
    if (request.length > 4096) { finish(76); process.stdin.destroy(); return; }
    if (dispatched || !request.includes('\r\n\r\n')) return;
    dispatched = true;
    if (!request.equals(expected)) { finish(77); process.stdin.destroy(); return; }
    event('request', { argv: process.argv.slice(2), inputBytes: request.length });
    if (mode === 'held' || mode === 'never-close') watchRelease(() => finish(0));
    if (mode === 'gated-response') { watchRelease(pump); return; }
    if (mode === 'stderr-limit') { process.stderr.write('x'.repeat(4097)); return; }
    if (mode === 'empty') { process.stdout.end(); return; }
    if (mode === 'trickle') {
        process.stdout.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 65536\r\n\r\n');
        ticker = setInterval(() => process.stdout.write(' '), 10); return;
    }
    // One event-loop turn lets the old immediate EOF defect be observed. This is
    // producer scheduling in a test, not a product readiness delay or sleep.
    setImmediate(pump);
});
process.stdin.on('end', () => {
    eof = true; event('stdin_eof', { sent, expected: value.length });
    if (!sent && !['empty', 'stderr-limit', 'gated-response', 'trickle'].includes(mode)) {
        event('premature_eof'); finish(0); process.exit(0); return;
    }
    if (mode === 'held' || mode === 'never-close' || mode === 'gated-response') return;
    if (mode === 'extra-after-eof') { process.stdout.write('HTTP/1.1 200 OK\r\n\r\n'); finish(0); return; }
    if (mode === 'exit137') { finish(137); return; }
    if (mode === 'exit1') { finish(1); return; }
    if (mode === 'signal') { process.kill(process.pid, 'SIGTERM'); return; }
    finish(0);
});
`.replaceAll('ROOT', JSON.stringify(root)).replaceAll('TRACE', JSON.stringify(trace)).replaceAll('GATE', JSON.stringify(gate))
        .replaceAll('MODE', JSON.stringify(mode)).replaceAll('WIDTH', String(pieceBytes))
        .replaceAll('VALUE', JSON.stringify(value.toString('base64'))).replaceAll('INPUT', JSON.stringify(makeExecRequest(requestPath).toString('base64')));
    writeFileSync(path.join(root, 'docker'), source, { mode: 0o700 });
    process.env.PATH = `${root}${path.delimiter}${previous ?? ''}`;
    t.after(() => { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(root, { recursive: true, force: true }); });
    return { root, gate, events: () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [] };
}
async function waitFor(check, timeout = 2500) {
    const end = Date.now() + timeout;
    while (!check()) {
        if (Date.now() >= end) assert.fail('Synthetic observation did not occur within the test bound');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
const observed = (f, event) => f.events().some(row => row.event === event);
const resolved = p => p.then(value => ({ value }), error => ({ error }));

for (const [name, value, pieceBytes] of [['length single-byte', lengthWire(), 1], ['chunked single-byte', chunkWire(), 1],
    ['length coalesced', lengthWire(), 65536], ['chunked coalesced', chunkWire(), 65536]]) {
    test(`real pipes ${name}: request -> complete response -> stdin EOF -> exit0`, async t => {
        const f = syntheticCli(t, { value, pieceBytes });
        const output = await runDockerAsync(args, { input: makeExecRequest(requestPath) });
        assert.deepEqual(output, value);
        const events = f.events(), end = events.find(e => e.event === 'stdin_eof');
        assert.ok(end); assert.equal(end.sent, value.length); assert.equal(observed(f, 'premature_eof'), false);
        assert.deepEqual(events.find(e => e.event === 'request').argv, args);
        assert.equal(parseExecResponse(output, requestPath).body, body.toString());
    });
}
for (const [mode, code] of [['exit137', 'probe_timeout'], ['exit1', 'relay_transport_failed'], ['signal', 'relay_transport_failed'],
    ['extra-after-eof', 'probe_response_incomplete'], ['empty', 'probe_response_invalid'], ['stderr-limit', 'docker_output_limit']]) {
    test(`real pipes: ${mode} is never a successful buffered response`, async t => {
        syntheticCli(t, { mode, pieceBytes: 65536 });
        await assert.rejects(exchangeWhoExec(target, requestPath), error => {
            assert.equal(error.code, code); assert.doesNotMatch(JSON.stringify(error), /destinationEntities|café|HTTP\/1/u);
            if (mode === 'exit137') assert.equal(error.details.exitCode, 137);
            return true;
        });
    });
}
for (const [name, value] of [['length partial', lengthWire().subarray(0, -1)], ['chunked missing final LF', chunkWire().subarray(0, -1)]]) {
    test(`real pipes: stdout EOF releases input but never blesses ${name}`, async t => {
        const f = syntheticCli(t, { mode: 'stdout-end', value });
        await assert.rejects(exchangeWhoExec(target, requestPath), e => /^probe_response_/u.test(e.code));
        assert.equal(observed(f, 'stdin_eof'), true);
    });
}
for (const [name, value] of invalidFrames) test(`real pipes deny ${name} without waiting for a fake success`, async t => {
    syntheticCli(t, { value: Buffer.from(value), pieceBytes: 65536 });
    await assert.rejects(exchangeWhoExec(target, requestPath), e => /^probe_response_/u.test(e.code));
});
test('real pipes: frame completion does not settle before close; exit0 is still needed', async t => {
    const f = syntheticCli(t, { mode: 'held', pieceBytes: 65536 }); let settled = false;
    const promise = resolved(exchangeWhoExec(target, requestPath)).then(result => { settled = true; return result; });
    await waitFor(() => observed(f, 'stdin_eof')); await nextTurn(); assert.equal(settled, false);
    writeFileSync(f.gate, 'release'); const result = await promise;
    assert.equal(result.value?.body, body.toString());
});
test('real pipes: abort after complete output retains the slot until actual close, even exit0', async t => {
    const f = syntheticCli(t, { mode: 'held', pieceBytes: 65536 }), controller = new AbortController(); let settled = false;
    const promise = resolved(exchangeWhoExec(target, requestPath, controller.signal)).then(result => { settled = true; return result; });
    await waitFor(() => observed(f, 'stdin_eof')); controller.abort(); await nextTurn(); assert.equal(settled, false);
    writeFileSync(f.gate, 'release'); const result = await promise;
    assert.equal(result.error?.code, 'cancelled');
});
test('real pipes: abort on an incomplete frame retains the slot and discards later valid output', async t => {
    const f = syntheticCli(t, { mode: 'gated-response', pieceBytes: 65536 }), controller = new AbortController(); let settled = false;
    const promise = resolved(exchangeWhoExec(target, requestPath, controller.signal)).then(result => { settled = true; return result; });
    await waitFor(() => observed(f, 'request')); controller.abort();
    await waitFor(() => observed(f, 'stdin_eof')); assert.equal(settled, false);
    writeFileSync(f.gate, 'release'); const result = await promise;
    assert.equal(result.error?.code, 'cancelled');
});
test('real pipes: caller cancellation before dispatch spawns nothing', async t => {
    const f = syntheticCli(t), controller = new AbortController(); controller.abort();
    await assert.rejects(exchangeWhoExec(target, requestPath, controller.signal), { code: 'cancelled' }); assert.deepEqual(f.events(), []);
});
test('HTTP input and timeout/output bounds reject before spawn; there is no arbitrary stdin seam', async t => {
    const f = syntheticCli(t);
    for (const input of [undefined, '{}', Buffer.alloc(4097), Buffer.from('GET / HTTP/1.1\r\n\r\n'),
        Buffer.concat([makeExecRequest(requestPath), Buffer.from('x')]), Buffer.from(makeExecRequest(requestPath).toString().replace('Host: 127.0.0.1', 'Host: external.invalid'))]) {
        await assert.rejects(runDockerAsync(args, { input }), { code: 'relay_request_invalid' });
    }
    for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, PROBE_TIMEOUT_MS + 1]) {
        await assert.rejects(runDockerAsync(args, { input: makeExecRequest(requestPath), timeoutMs }), { code: 'probe_binding_invalid' });
    }
    for (const maxBytes of [0, -1, 1.5, NaN, Infinity, EXEC_MAX_WIRE_BYTES + 1]) {
        await assert.rejects(runDockerAsync(args, { input: makeExecRequest(requestPath), maxBytes }), { code: 'probe_binding_invalid' });
    }
    assert.deepEqual(f.events(), []);
});
for (const mode of ['never-close', 'trickle']) test(`real pipes: original absolute deadline is not extended by ${mode}`, async t => {
    syntheticCli(t, { mode, pieceBytes: 65536 }); const start = Date.now();
    await assert.rejects(runDockerAsync(args, { input: makeExecRequest(requestPath), timeoutMs: 300 }), { code: 'docker_command_timeout' });
    assert.ok(Date.now() - start >= 250 && Date.now() - start < 2000);
    await new Promise(resolve => setTimeout(resolve, 50)); // Only test-process cleanup, not product readiness.
});
test('real child close after the monotonic deadline is denied even before the timer callback runs', async t => {
    const f = syntheticCli(t, { mode: 'held', pieceBytes: 65536 }); let clock = 1000;
    t.mock.method(performance, 'now', () => clock);
    const promise = resolved(runDockerAsync(args, { input: makeExecRequest(requestPath), timeoutMs: 1000 }));
    await waitFor(() => observed(f, 'stdin_eof')); clock = 2001; writeFileSync(f.gate, 'release');
    assert.equal((await promise).error?.code, 'docker_command_timeout');
});
test('real child data after the monotonic deadline cannot trigger late success', async t => {
    const f = syntheticCli(t, { mode: 'gated-response', pieceBytes: 65536 }); let clock = 1000;
    t.mock.method(performance, 'now', () => clock);
    const promise = resolved(runDockerAsync(args, { input: makeExecRequest(requestPath), timeoutMs: 1000 }));
    await waitFor(() => observed(f, 'request')); clock = 2001; writeFileSync(f.gate, 'release');
    assert.equal((await promise).error?.code, 'docker_command_timeout');
    await new Promise(resolve => setTimeout(resolve, 50));
});

function rawGet(port) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: requestPath, agent: false }, res => {
            const chunks = []; res.on('data', c => chunks.push(c)); res.once('error', reject);
            res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        }); req.once('error', reject);
    });
}
for (const changed of [false, true]) test(`real listener plus real child: exit0 precedes mandatory ${changed ? 'changed' : 'matching'} binding readback`, async t => {
    const f = syntheticCli(t, { mode: 'held', pieceBytes: 65536 });
    let reads = 0, afterStarted = false, release;
    const recheck = new Promise(resolve => { release = resolve; });
    const access = await openWhoLoopback({ port: 0, prerequisite: async () => {},
        inspect: async () => {
            reads++;
            if (reads === 4) { afterStarted = true; await recheck; }
            return { ...target, ...(changed && reads === 4 ? { bindingSha256: 'sha256:' + 'c'.repeat(64) } : {}) };
        }, exchange: (bound, pathname, signal) => exchangeWhoExec(bound, pathname, signal) });
    t.after(() => access.close()); let settled = false;
    const request = rawGet(access.port).then(value => { settled = true; return value; });
    await waitFor(() => observed(f, 'stdin_eof')); assert.equal(reads, 3); assert.equal(settled, false);
    writeFileSync(f.gate, 'release'); await waitFor(() => afterStarted);
    assert.equal(settled, false); assert.equal(access.lastObservation, undefined);
    release(); const value = await request;
    if (changed) {
        assert.equal(value.status, 503); assert.equal(access.lastError.code, 'probe_binding_changed');
        assert.equal(access.lastObservation, undefined); assert.doesNotMatch(value.body, /destinationEntities/u);
    } else {
        assert.equal(value.status, 200); assert.equal(value.body, body.toString());
        assert.equal(access.lastObservation.responseSha256, 'sha256:' + createHash('sha256').update(body).digest('hex'));
        assert.equal(access.lastObservation.targetBindingSha256, target.bindingSha256);
    }
});

for (const [status, code] of [['302 Found', 'probe_redirect_refused'], ['503 Service Unavailable', 'probe_service_starting'], ['401 Unauthorized', 'probe_http_status']]) {
    for (const framed of [true, false]) test(`real pipes preserve ${status} diagnostics after exit0, framed=${framed}`, async t => {
        const value = framed ? lengthWire(Buffer.from('{}'), '', status) : Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\n\r\n{}`);
        syntheticCli(t, { value, pieceBytes: 65536 });
        await assert.rejects(exchangeWhoExec(target, requestPath), { code });
    });
}
