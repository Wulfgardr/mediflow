/* @Codex */
/* PROPOSED transport tests: real host loopback sockets and SYNTHETIC JSON, never WHO/Docker evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWhoProbe, validateProbeBody, probePath, PROBE_TERMS, PROBE_TIMEOUT_MS, PROBE_MAX_BYTES } from './who-local-probe.mjs';
import { dockerFailure } from './who-local-setup.mjs';
import { validateOfflineRoutes, failureCause } from './who-local-qualification.mjs';

const body = JSON.stringify({ destinationEntities: [{ id: 'http://id.who.int/icd/release/11/2026-01/mms/1000000001',
    title: 'Synthetic fixture, NOT WHO runtime evidence', theCode: 'AA00' }] });
async function server(t, handler) {
    const sockets = new Set();
    const instance = http.createServer(handler);
    instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    instance.listen({ host: '127.0.0.1', port: 0, exclusive: true }); await once(instance, 'listening');
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => instance.close(resolve)); });
    return { port: instance.address().port, instance, sockets };
}
const json = (res, value = body) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(value); };

test('four bounded fixed requests have distinct terms, no auth, and the explicit WHO language/version headers', async t => {
    const observed = [];
    const s = await server(t, (req, res) => { observed.push({ path: req.url, headers: req.headers, method: req.method }); json(res); });
    for (const kind of Object.keys(PROBE_TERMS)) assert.equal(await readWhoProbe(s.port, kind), body);
    assert.equal(observed.length, 4); assert.equal(new Set(observed.map(r => r.path)).size, 4);
    for (let i = 0; i < observed.length; i++) {
        const r = observed[i]; assert.equal(r.method, 'GET'); assert.equal(r.path, probePath(Object.keys(PROBE_TERMS)[i]));
        assert.equal(r.headers.host, `127.0.0.1:${s.port}`); assert.equal(r.headers['api-version'], 'v2');
        assert.equal(r.headers['accept-language'], 'en'); assert.equal(r.headers['accept-encoding'], 'identity');
        assert.equal(r.headers.authorization, undefined); assert.equal(r.headers.cookie, undefined);
        assert.equal(r.headers['proxy-authorization'], undefined);
    }
});
test('arbitrary URLs, noninteger/invalid ports and unknown query kinds are rejected before a request', async () => {
    for (const port of ['http://example.invalid', '8382', 0, -1, 65536, NaN, Infinity, 1.1, null]) {
        await assert.rejects(readWhoProbe(port, 'acquisition'), { code: 'probe_endpoint_invalid' });
    }
    for (const kind of ['http://example.invalid', 'acquisition&url=example.invalid', '__proto__', 'constructor', '', undefined]) {
        await assert.rejects(readWhoProbe(8382, kind), { code: 'probe_invalid' });
    }
});
test('WHO response schema rejects foreign URLs, wrong release, empty result/code/title, invalid JSON and oversized bodies', () => {
    assert.equal(validateProbeBody(body), 1);
    for (const value of [null, '', '<html>not WHO</html>', '{}', '{', JSON.stringify({ destinationEntities: [] }), ' '.repeat(PROBE_MAX_BYTES + 1)]) {
        assert.throws(() => validateProbeBody(value), { code: 'probe_response_invalid' });
    }
    for (const [key, value] of [['id', 'https://example.invalid/icd/1'], ['id', 'http://127.0.0.1/icd/1'],
        ['id', 'http://id.who.int/icd/release/11/2025-01/mms/1'], ['id', 'http://id.who.int/icd/release/11/2026-01/mms/1?url=bad'],
        ['title', '  '], ['title', 'a'.repeat(4097)], ['theCode', ''], ['theCode', '../payload?'], ['theCode', null]]) {
        const valueBody = JSON.parse(body); valueBody.destinationEntities[0][key] = value;
        assert.throws(() => validateProbeBody(JSON.stringify(valueBody)), { code: 'probe_response_invalid' });
    }
});
test('redirects never contact a second endpoint, even when its body would be valid', async t => {
    let reached = 0;
    const destination = await server(t, (_req, res) => { reached++; json(res); });
    const origin = await server(t, (_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${destination.port}/redirect` }); res.end(); });
    await assert.rejects(readWhoProbe(origin.port, 'acquisition'), { code: 'probe_redirect_refused' });
    assert.equal(reached, 0);
});
test('the private agent ignores proxy environment and a poisoned global agent without mutating either', async t => {
    let proxyRequests = 0, ownRequests = 0, globalRequests = 0;
    const proxy = await server(t, (_req, res) => { proxyRequests++; json(res); });
    const own = await server(t, (_req, res) => { ownRequests++; json(res); });
    const keys = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'];
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]])); const global = http.globalAgent;
    t.after(() => { http.globalAgent = global; for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
    for (const key of keys) process.env[key] = key.toLowerCase() === 'no_proxy' ? '' : key === 'NODE_USE_ENV_PROXY' ? '1' : `http://127.0.0.1:${proxy.port}`;
    const poison = new http.Agent(); poison.addRequest = () => { globalRequests++; throw new Error('global agent used'); };
    http.globalAgent = poison;
    assert.equal(await readWhoProbe(own.port, 'acquisition'), body);
    assert.equal(ownRequests, 1); assert.equal(proxyRequests, 0); assert.equal(globalRequests, 0); assert.equal(http.globalAgent, poison);
});
for (const status of [301, 307, 401, 404, 429, 500, 503]) {
    test(`HTTP ${status} is classified without interpreting an error page as a result`, async t => {
        const s = await server(t, (_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); });
        await assert.rejects(readWhoProbe(s.port, 'acquisition'), e => {
            assert.equal(e.code, status < 400 ? 'probe_redirect_refused' : status === 503 ? 'probe_service_starting' : 'probe_http_status');
            assert.equal(e.details.status, status); return true;
        });
    });
}
for (const scenario of ['html', 'gzip', 'announced-size', 'stream-size', 'invalid-utf8', 'invalid-json']) {
    test(`bounded response rejects ${scenario}`, async t => {
        const s = await server(t, (_req, res) => {
            if (scenario === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(body); }
            else if (scenario === 'gzip') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }); res.end(body); }
            else if (scenario === 'announced-size') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(PROBE_MAX_BYTES + 1) }); res.flushHeaders(); }
            else if (scenario === 'stream-size') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write(' '.repeat(PROBE_MAX_BYTES)); res.end('x'); }
            else if (scenario === 'invalid-utf8') json(res, Buffer.from([0xc3, 0x28]));
            else json(res, '{}');
        });
        await assert.rejects(readWhoProbe(s.port, 'acquisition'), { code: 'probe_response_invalid' });
    });
}
test('a partial response is terminal, never accepted from buffered valid JSON', async t => {
    const s = await server(t, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body) + 10) });
        res.write(body); setImmediate(() => res.destroy());
    });
    await assert.rejects(readWhoProbe(s.port, 'acquisition'), { code: 'probe_response_incomplete' });
});
test('absolute five-second deadline is not extended by trickling bytes and closes the socket', async t => {
    let ticker, closed;
    const closedPromise = new Promise(resolve => { closed = resolve; });
    const s = await server(t, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.write(' ');
        ticker = setInterval(() => res.write(' '), 100);
        res.on('close', () => { clearInterval(ticker); closed(); });
    });
    t.after(() => clearInterval(ticker));
    const start = performance.now();
    await assert.rejects(readWhoProbe(s.port, 'offline_restart'), e => e.code === 'probe_timeout' && e.details.timeoutMs === PROBE_TIMEOUT_MS);
    assert.ok(performance.now() - start >= PROBE_TIMEOUT_MS - 100);
    await closedPromise;
});
test('abort before request makes no connection; abort while pending destroys the in-flight socket', async t => {
    let arrivals = 0;
    const s = await server(t, (_req, res) => { arrivals++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.write(' '); });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readWhoProbe(s.port, 'restored', controller.signal), { code: 'cancelled' }); assert.equal(arrivals, 0);
    const next = new AbortController(); const requestEvent = once(s.instance, 'request');
    const promise = readWhoProbe(s.port, 'restored', next.signal); await requestEvent;
    const socket = [...s.sockets][0]; const closed = new Promise(resolve => socket.once('close', resolve)); next.abort();
    await assert.rejects(promise, { code: 'cancelled' }); await closed; assert.equal(arrivals, 1);
});
test('refused local connection has a narrow startup code, not an executable error', async t => {
    const s = await server(t, (_req, res) => json(res)); const port = s.port;
    await new Promise(resolve => s.instance.close(resolve));
    await assert.rejects(readWhoProbe(port, 'acquisition'), { code: 'probe_connect_pending' });
});
test('Docker terminal prerequisites retain only bounded executable/exit/system fields, no stdout/stderr', () => {
    for (const [result, expected] of [[{ status: 127 }, 'docker_executable_missing'], [{ status: 126 }, 'docker_executable_denied'],
        [{ status: null, error: { code: 'ENOENT' } }, 'docker_cli_missing'], [{ status: null, error: { code: 'ETIMEDOUT' } }, 'docker_command_timeout'],
        [{ status: 1 }, 'docker_unavailable']]) {
        const e = dockerFailure({ ...result, stdout: 'secret', stderr: 'secret' }, ['--context', 'synthetic', 'exec', 'a'.repeat(64), 'curl']);
        assert.equal(e.code, expected); assert.equal(e.details.executable, 'curl');
        assert.doesNotMatch(JSON.stringify(failureCause(e)), /secret/u);
        if (result.status !== null) assert.equal(e.details.exitCode, result.status);
    }
});
test('IPv4 and IPv6 route proof rejects default and non-default routed egress; Linux unreachable defaults are not usable routes', () => {
    const connected = 'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 000012AC 00000000 0001 0 0 0 0000FFFF\n';
    const z = '0'.repeat(32);
    const v6reject = `${z} 00 ${z} 00 ${z} ffffffff 00000001 00000000 00200200 lo\n`;
    assert.equal(validateOfflineRoutes(connected, v6reject).noRoutedEgress, true);
    for (const route of [connected.replace('000012AC', '00000000').replace('0000FFFF', '00000000'),
        connected.replace('00000000 0001', '010012AC 0003')]) assert.throws(() => validateOfflineRoutes(route, ''), { code: 'external_route_present' });
    assert.throws(() => validateOfflineRoutes(connected, `${z} 00 ${z} 00 ${z} 00000000 00000000 00000000 00000001 eth0\n`), { code: 'external_route_present' });
    assert.throws(() => validateOfflineRoutes(connected, 'not a route'), { code: 'route_evidence_invalid' });
    assert.throws(() => validateOfflineRoutes('', ''), { code: 'external_route_present' });
});

// @Codex: observed public WHO postcoordination shape, still a synthetic transport peer.
test('probe accepts both exact observed URI separators and rejects malformed combinations', async t => {
    const first = 'http://id.who.int/icd/release/11/2026-01/mms/257068234';
    const second = 'http://id.who.int/icd/release/11/2026-01/mms/194483911';
    const third = 'http://id.who.int/icd/release/11/2026-01/mms/194483912';
    const make = (id, theCode = '1A00&XN8P1') => JSON.stringify({ destinationEntities: [{ id, title: 'Synthetic combination', theCode }] });
    const combined = make(`${first}/other / ${second}/unspecified`);
    assert.equal(validateProbeBody(combined), 1);
    const peer = await server(t, (_req, res) => json(res, combined));
    assert.equal(await readWhoProbe(peer.port, 'acquisition'), combined);
    assert.equal(validateProbeBody(make(first, '1A00')), 1);
    assert.equal(validateProbeBody(make(`${first}/other & ${second}/unspecified`)), 1);
    assert.equal(validateProbeBody(make(`${first} & ${second} / ${third}`)), 1);
    assert.equal(validateProbeBody(make(Array(16).fill(first).join(' & ').replace(' & ', ' / '), Array(16).fill('A').join('&'))), 1);
    for (const invalid of [
        `${first} & https://example.invalid/mms/1`, `${first} & ${second.replace('2026-01', '2025-01')}`,
        `${first} & ${second.replace('http:', 'https:')}`, `${first} & ${second}?x=1`,
        `${first} & `, ` & ${second}`, `${first} / `, ` / ${second}`, `${first} &  & ${second}`,
        `${first}&${second}`, `${first}/${second}`, `${first}  & ${second}`, `${first} &  ${second}`,
        `${first}  / ${second}`, `${first} /  ${second}`, ` ${first} & ${second}`, `${first} / ${second} `,
        `${first} | ${second}`, `${first} + ${second}`, `${first},${second}`,
        Array(17).fill(first).join(' / '), 'x'.repeat(1537),
    ]) assert.throws(() => validateProbeBody(make(invalid)), { code: 'probe_response_invalid' });
    assert.throws(() => validateProbeBody(make(`${first} & ${second}`, 'A'.repeat(33))), { code: 'probe_response_invalid' });
});

// Follow-up3: new host-loopback bridge tests. No Docker/WHO installation is performed.
const bridgeModule = await import('./who-local-loopback.mjs');
const { openWhoLoopback, validateLoopbackPath, parseExecResponse, makeExecRequest, execProgramArgs,
    EXEC_HTTP_PROGRAM, EXEC_PREREQUISITE_PROGRAM, EXEC_NC_HELP_PROGRAM, EXEC_DEADLINE_PROGRAM, EXEC_PREREQUISITE, EXEC_TRANSPORT,
    checkWhoExecTools, runDockerAsync, exchangeWhoExec, classifyExecFailure } = bridgeModule;
const { sha256 } = await import('./who-local-qualification.mjs');
const bridgeTarget = () => ({ endpoint: 'unix:///synthetic/docker.sock', containerId: 'a'.repeat(64),
    bindingSha256: sha256('synthetic target'), startedAt: '2026-09-08T00:00:01.000Z',
    isolation: { networkId: 'c'.repeat(64), internal: true, ipv6: false, noDefaultRoute: true, noRoutedEgress: true } });
const wire = (value = body, status = '200 OK', extra = '') => Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(value)}\r\n${extra}\r\n${value}`);
async function rawGet(port, requestPath, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port, path: requestPath, method: 'GET', agent: false, ...options }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk)); response.once('error', reject);
            response.once('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        request.once('error', reject); request.end();
    });
}
async function bridge(t, overrides = {}) {
    const observations = { inspect: 0, prerequisite: 0, exchange: 0 };
    const access = await openWhoLoopback({ port: 0,
        inspect: async () => { observations.inspect++; return bridgeTarget(); },
        prerequisite: async () => { observations.prerequisite++; },
        exchange: async () => { observations.exchange++; return { status: 200, body }; }, ...overrides });
    t.after(() => access.close());
    return { access, observations };
}
const codePath = '/icd/release/11/2026-01/mms/codeinfo/AA00%26XA001?flexiblemode=false&convertToTerminalCodes=false';
const entityPath = '/icd/release/11/2026-01/mms/1000000001';
test('Mac bridge accepts only the frozen backend search, codeinfo and numeric entity paths', () => {
    for (const kind of Object.keys(PROBE_TERMS)) assert.equal(validateLoopbackPath(probePath(kind)), 'search');
    assert.equal(validateLoopbackPath(codePath), 'codeinfo');
    assert.equal(validateLoopbackPath(entityPath), 'entity');
    assert.equal(validateLoopbackPath(`${entityPath}/other`), 'entity');
    assert.equal(validateLoopbackPath(`${entityPath}/unspecified`), 'entity');
    for (const bad of ['https://example.invalid', '//example.invalid/', '/health', '/icd/release/11/2025-01/mms/search',
        probePath('acquisition') + '&q=second', probePath('acquisition').replace(`q=${PROBE_TERMS.acquisition}`, `q=+${PROBE_TERMS.acquisition}`),
        probePath('acquisition').replace('medicalCodingMode=true', 'medicalCodingMode=false'),
        codePath.replace('AA00%26XA001', 'AA00%2526XA001'), codePath.replace('AA00%26XA001', 'N%2FA'),
        codePath.replace('AA00%26XA001', 'A'.repeat(33)), codePath.replace('AA00%26XA001', 'AA00%26'),
        `${entityPath}?url=example.invalid`, `${entityPath}/../1000000002`, `${entityPath}#fragment`,
        entityPath.replace('/1000000001', '/0'), entityPath + '\r\nX: y']) {
        assert.throws(() => validateLoopbackPath(bad), { code: 'relay_request_invalid' }, bad);
    }
});
test('F4 regression R1: BusyBox short-option timeout argv is fixed and contains no GNU prerequisite', () => {
    const args = execProgramArgs('a'.repeat(64), EXEC_HTTP_PROGRAM);
    assert.deepEqual(args.slice(0, 4), ['exec', '--interactive', '--user', '65534:65534']);
    assert.deepEqual(args.slice(7), ['/bin/busybox', 'timeout', '-s', 'KILL', '4', '/bin/busybox', 'nc', '-n', '-w', '5', '127.0.0.1', '80']);
    assert.equal(args.some(a => /--signal|--kill-after|GNU/u.test(a)), false);
    for (const kind of Object.keys(PROBE_TERMS)) {
        const bytes = makeExecRequest(probePath(kind));
        assert.match(bytes.toString('ascii'), /^GET \/icd\/release\/11\/2026-01\/mms\/search\?/u);
        assert.match(bytes.toString('ascii'), /Accept-Encoding: identity\r\nConnection: close\r\n\r\n$/u);
        assert.equal(args.some(a => a.includes(PROBE_TERMS[kind])), false);
    }
    assert.throws(() => execProgramArgs('container-name', EXEC_HTTP_PROGRAM), { code: 'probe_binding_invalid' });
    assert.throws(() => execProgramArgs('a'.repeat(64), 'other program'), { code: 'probe_binding_invalid' });
});
test('Mac response parser supports exact length and bounded chunked, but denies ambiguous unframed EOF', () => {
    const requestPath = probePath('acquisition');
    assert.deepEqual(parseExecResponse(wire(), requestPath), { status: 200, body });
    const half = Math.floor(Buffer.byteLength(body) / 2), bytes = Buffer.from(body);
    const chunks = [bytes.subarray(0, half), bytes.subarray(half)].map(b => Buffer.concat([Buffer.from(`${b.length.toString(16)}\r\n`), b, Buffer.from('\r\n')]));
    const response = Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n'), ...chunks, Buffer.from('0\r\n\r\n')]);
    assert.equal(parseExecResponse(response, requestPath).body, body);
    assert.throws(() => parseExecResponse(Buffer.from(`HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`), requestPath), { code: 'probe_response_incomplete' });
    assert.deepEqual(parseExecResponse(wire('NOT FOUND', '404 Not Found'), codePath), { status: 404, body: '' });
    assert.throws(() => parseExecResponse(wire('NOT FOUND', '404 Not Found'), entityPath), { code: 'probe_http_status' });
});
for (const [name, value, code] of [
    ['redirect', wire('', '302 Found', 'Location: https://example.invalid\r\n'), 'probe_redirect_refused'],
    ['service still starting', wire('{}', '503 Unavailable'), 'probe_service_starting'],
    ['unexpected status', wire('{}', '401 Unauthorized'), 'probe_http_status'],
    ['invalid JSON', wire('NOT_JSON'), 'probe_response_invalid'],
    ['root array', wire('[]'), 'probe_response_invalid'],
    ['content encoding', wire(body, '200 OK', 'Content-Encoding: gzip\r\n'), 'probe_response_invalid'],
    ['duplicate length', wire(body, '200 OK', `Content-Length: ${Buffer.byteLength(body)}\r\n`), 'probe_response_invalid'],
    ['conflicting framing', wire(body, '200 OK', 'Transfer-Encoding: chunked\r\n'), 'probe_response_invalid'],
    ['missing length bytes', wire().subarray(0, -1), 'probe_response_incomplete'],
    ['extra response bytes', Buffer.concat([wire(), Buffer.from('HTTP/1.1 200 OK\r\n\r\n')]), 'probe_response_incomplete'],
    ['non-JSON MIME', Buffer.from(wire().toString().replace('application/json', 'text/html')), 'probe_response_invalid'],
    ['oversize body', wire(JSON.stringify({ synthetic: 'x'.repeat(PROBE_MAX_BYTES) })), 'probe_response_invalid'],
    ['invalid UTF-8', Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n'), Buffer.from([0xc3, 0x28])]), 'probe_response_invalid'],
    ['chunk extension', Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2;x=y\r\n{}\r\n0\r\n\r\n'), 'probe_response_invalid'],
]) test(`Mac response parser rejects ${name} without converting it to readiness`, () => {
    assert.throws(() => parseExecResponse(value, probePath('acquisition')), { code });
});
test('Mac real listener binds localhost and records independent before/after authorization and exact bytes', async t => {
    const { access, observations } = await bridge(t);
    assert.equal(await readWhoProbe(access.port, 'acquisition'), body);
    assert.equal(observations.inspect, 4); assert.equal(observations.prerequisite, 1); assert.equal(observations.exchange, 1);
    assert.equal(access.lastObservation.transport, EXEC_TRANSPORT);
    assert.equal(access.lastObservation.endpoint, `http://127.0.0.1:${access.port}`);
    assert.equal(access.lastObservation.responseSha256, sha256(body));
    assert.equal(access.lastObservation.requestPathSha256, sha256(probePath('acquisition')));
    await access.close(); await access.closed;
    await assert.rejects(rawGet(access.port, probePath('acquisition')), { code: 'ECONNREFUSED' });
});
for (const [name, options] of [
    ['remote Host', { headers: { host: 'example.invalid' } }],
    ['Origin', { headers: { origin: 'http://127.0.0.1:3000' } }],
    ['Cookie', { headers: { cookie: 'synthetic=1' } }],
    ['Authorization', { headers: { authorization: 'synthetic' } }],
    ['proxy authorization', { headers: { 'proxy-authorization': 'synthetic' } }],
    ['POST', { method: 'POST' }],
]) test(`Mac listener refuses ${name} before exchange`, async t => {
    const { access, observations } = await bridge(t);
    const response = await rawGet(access.port, probePath('acquisition'), options);
    assert.equal(response.status, 400); assert.equal(observations.exchange, 0);
    assert.equal(observations.inspect, 2); assert.equal(access.lastObservation, undefined);
});
test('Mac listener refuses acquisition by an already occupied port and never contacts the foreign listener', async t => {
    let foreignRequests = 0;
    const foreign = await server(t, (_req, res) => { foreignRequests++; json(res); });
    await assert.rejects(bridge(t, { port: foreign.port }), { code: 'port_in_use' });
    assert.equal(foreignRequests, 0);
});
test('Mac missing executable prerequisite denies before listener ownership or query', async () => {
    let exchanged = false;
    await assert.rejects(openWhoLoopback({ port: 0, inspect: async () => bridgeTarget(),
        prerequisite: async () => { throw Object.assign(new Error('synthetic missing tool'), { code: 'docker_executable_missing' }); },
        exchange: async () => { exchanged = true; } }), { code: 'docker_executable_missing' });
    assert.equal(exchanged, false);
});
test('Mac response is withheld if identity changes during exchange; no successful observation is created', async t => {
    let changed = false;
    const { access } = await bridge(t, {
        inspect: async () => ({ ...bridgeTarget(), ...(changed ? { bindingSha256: sha256('changed target') } : {}) }),
        exchange: async () => { changed = true; return { status: 200, body }; } });
    const response = await rawGet(access.port, probePath('acquisition'));
    assert.equal(response.status, 503); assert.doesNotMatch(response.body, /destinationEntities/u);
    assert.equal(access.lastError.code, 'probe_binding_changed'); assert.equal(access.lastObservation, undefined);
});
test('Mac backend codeinfo 404 remains a real not-found and entity response stays independently bounded', async t => {
    const { access } = await bridge(t, { exchange: async (_target, requestPath) => parseExecResponse(
        requestPath === codePath ? wire('', '404 Not Found') : wire('{"title":{"@language":"en","@value":"Synthetic"}}'), requestPath) });
    assert.deepEqual(await rawGet(access.port, codePath), { status: 404, body: '' });
    assert.equal((await rawGet(access.port, entityPath)).status, 200);
});
test('Mac host deadline cancels the exchange and does not emit successful data after timeout', async t => {
    let cancelled = false;
    const { access } = await bridge(t, { exchange: async (_target, _requestPath, signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { cancelled = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true });
    }) });
    const started = Date.now();
    const response = await rawGet(access.port, probePath('acquisition'));
    assert.equal(response.status, 503); assert.equal(cancelled, true); assert.equal(access.lastObservation, undefined);
    assert.equal(access.lastError.code, 'probe_timeout'); assert.ok(Date.now() - started < PROBE_TIMEOUT_MS + 2000);
});
test('Mac root cancellation closes only the owned listener and aborts in-flight work', async t => {
    const controller = new AbortController(); let entered, cancelled = false;
    const started = new Promise(resolve => { entered = resolve; });
    const { access } = await bridge(t, { signal: controller.signal,
        exchange: async (_target, _path, signal) => new Promise((_, reject) => {
            entered(); signal.addEventListener('abort', () => { cancelled = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true });
        }) });
    const response = rawGet(access.port, probePath('acquisition')).catch(error => error.code);
    await started; controller.abort(); await access.closed;
    assert.equal(cancelled, true); assert.equal(access.lastObservation, undefined);
    assert.equal(await response, 'ECONNRESET');
    await assert.rejects(rawGet(access.port, probePath('acquisition')), { code: 'ECONNREFUSED' });
});
test('Mac bridge limits concurrent exchanges and refuses a fifth request without spawning additional work', async t => {
    const waits = [], controller = new AbortController();
    const { access } = await bridge(t, { signal: controller.signal,
        exchange: async (_target, _path, signal) => new Promise((_, reject) => {
            waits.push(true); signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true });
        }) });
    const pending = Array.from({ length: 4 }, () => rawGet(access.port, probePath('acquisition')).catch(error => error.code));
    for (let n = 0; n < 100 && waits.length < 4; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(waits.length, 4);
    assert.equal((await rawGet(access.port, probePath('acquisition'))).status, 503);
    assert.equal(waits.length, 4); controller.abort(); await Promise.all(pending);
});

// F4 synthetic process tests. The fake CLI below is not Docker or image evidence.
test('F4 regression R2: the fixed HTTP command never requires Bash, a shell or /dev/tcp', () => {
    const args = execProgramArgs('a'.repeat(64), EXEC_HTTP_PROGRAM);
    assert.equal(args.filter(a => a === '/bin/busybox').length, 2);
    assert.deepEqual(args.slice(-7), ['/bin/busybox', 'nc', '-n', '-w', '5', '127.0.0.1', '80']);
    for (const arg of args) assert.doesNotMatch(arg, /bash|\/dev\/tcp|--signal|--kill-after/u);
    assert.equal(args.includes('-c'), false); assert.equal(args.includes('-e'), false); assert.equal(args.includes('-l'), false);
    assert.equal(args.includes('BASH_ENV=/dev/null'), false);
    for (const invalid of ['__proto__', 'constructor', 'arbitrary-command', '/bin/busybox', 'busybox-http-v2; cat']) {
        assert.throws(() => execProgramArgs('a'.repeat(64), invalid), { code: 'probe_binding_invalid' });
    }
    const data = makeExecRequest(probePath('acquisition'));
    assert.ok(data.toString('ascii').endsWith('Connection: close\r\n\r\n'));
    assert.equal(args.includes(data.toString()), false);
});

for (const [name, exit, signal, stderr, selector, size, expected] of [
    ['GNU timeout transcript', 1, null, "timeout: unrecognized option '--signal=TERM'\nUsage: timeout [-s SIG]", EXEC_HTTP_PROGRAM, 0, 'relay_timeout_unsupported'],
    ['missing BusyBox', 127, null, 'synthetic private error', EXEC_HTTP_PROGRAM, 0, 'docker_executable_missing'],
    ['denied BusyBox', 126, null, '', EXEC_HTTP_PROGRAM, 0, 'docker_executable_denied'],
    ['small nc option', 1, null, "nc: invalid option -- 'n'\nUsage: nc [-iN]", EXEC_HTTP_PROGRAM, 0, 'relay_nc_unsupported'],
    ['missing nc applet', 127, null, 'nc: applet not found', EXEC_HTTP_PROGRAM, 0, 'relay_nc_unsupported'],
    ['missing timeout applet', 127, null, 'timeout: applet not found', EXEC_HTTP_PROGRAM, 0, 'relay_timeout_unsupported'],
    ['missing cat applet', 127, null, 'cat: applet not found', EXEC_PREREQUISITE_PROGRAM, 0, 'relay_prerequisite_failed'],
    ['inner KILL status', 137, null, '', EXEC_HTTP_PROGRAM, 100, 'probe_timeout'],
    ['signal KILL', null, 'SIGKILL', '', EXEC_HTTP_PROGRAM, 100, 'probe_timeout'],
    ['silent refused connect', 1, null, '', EXEC_HTTP_PROGRAM, 0, 'probe_connect_pending'],
    ['reported refused connect', 1, null, 'nc: Connection refused', EXEC_HTTP_PROGRAM, 0, 'probe_connect_pending'],
    ['partial response then exit1', 1, null, '', EXEC_HTTP_PROGRAM, 10, 'relay_transport_failed'],
    ['generic failure', 1, null, 'synthetic private query error', EXEC_HTTP_PROGRAM, 0, 'relay_transport_failed'],
    ['missing deadline observation', 1, null, '', EXEC_DEADLINE_PROGRAM, 0, 'relay_deadline_unverified'],
    ['help not supported', 1, null, '', EXEC_NC_HELP_PROGRAM, 0, 'relay_nc_unsupported'],
]) test(`F4 diagnostic ${name} is classified and private`, () => {
    const error = classifyExecFailure(exit, signal, stderr, selector, size);
    assert.equal(error.code, expected);
    assert.doesNotMatch(JSON.stringify(error), /synthetic private|unrecognized|Connection refused|Usage:/u);
    if (exit !== null) assert.equal(error.details.exitCode, exit);
});

const f4Target = { endpoint: 'unix:///synthetic/docker.sock', containerId: 'a'.repeat(64) };
const marker = `${EXEC_PREREQUISITE}\n`;
const helpMarker = `${EXEC_PREREQUISITE}:nc-help\n`;
const deadlineMarker = `${EXEC_PREREQUISITE}:deadline\n`;
const helpText = "BusyBox v1.37.0 (synthetic help, not executable evidence)\nUsage: nc [OPTIONS] HOST PORT - connect\n\t-n\tDon't do DNS resolution\n\t-w SEC\tTimeout for connects and final net reads\n";
test('F4 capability sequence is EOF echo, nc shape, held-open deadline, never HTTP', async () => {
    const calls = [], observed = [marker, helpMarker, deadlineMarker];
    await checkWhoExecTools(f4Target, undefined, async (args, opts) => {
        const index = calls.length; calls.push(args);
        const selector = [EXEC_PREREQUISITE_PROGRAM, EXEC_NC_HELP_PROGRAM, EXEC_DEADLINE_PROGRAM][index];
        assert.deepEqual(args, ['--host', f4Target.endpoint, ...execProgramArgs(f4Target.containerId, selector)]);
        assert.equal(opts.maxBytes, 4096);
        assert.equal(opts.input?.toString(), index === 1 ? undefined : marker);
        return Buffer.from(observed[index]);
    });
    assert.equal(calls.length, 3);
});
for (const index of [0, 1, 2]) test(`F4 false capability observation ${index} stops the sequence`, async () => {
    let calls = 0;
    await assert.rejects(checkWhoExecTools(f4Target, undefined, async () => {
        const current = calls++;
        return Buffer.from(current === index ? 'unverified' : [marker, helpMarker, deadlineMarker][current]);
    }), { code: ['relay_prerequisite_failed', 'relay_nc_unsupported', 'relay_deadline_unverified'][index] });
    assert.equal(calls, index + 1);
});
test('F4 cancellation between capabilities never starts the next process', async () => {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(checkWhoExecTools(f4Target, controller.signal, async () => {
        calls++; controller.abort(); return Buffer.from(marker);
    }), { code: 'cancelled' });
    assert.equal(calls, 1);
});
test('F4 prerequisite is bracketed by currentness checks before listener ownership', async () => {
    let count = 0, exchanged = false;
    await assert.rejects(openWhoLoopback({ port: 0,
        inspect: async () => ({ ...bridgeTarget(), bindingSha256: sha256(String(count++)) }),
        prerequisite: async () => {}, exchange: async () => { exchanged = true; } }), { code: 'probe_binding_changed' });
    assert.equal(count, 2); assert.equal(exchanged, false);
});

// Temporary executable with real stdio/process lifetime, explicitly NOT a Docker adapter proof.
function fakeCli(t, mode) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'who-f4-synthetic-cli-'));
    const capture = path.join(root, 'capture.json'), eof = path.join(root, 'eof');
    const filename = path.join(root, 'docker'), previous = process.env.PATH;
    const js = `#!${process.execPath}\n` + `
import { writeFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)}, data = [], argv = process.argv.slice(2);
const record = () => writeFileSync(${JSON.stringify(capture)}, JSON.stringify({argv, stdin: Buffer.concat(data).toString('utf8')}));
const marker = ${JSON.stringify(marker)}, help = ${JSON.stringify(helpText)}, response = ${JSON.stringify(wire(body).toString())};
process.stdin.on('data', c => {
    data.push(c); record();
    if (mode === 'early-deadline') { process.stdout.write(marker); process.exit(137); }
    if (mode === 'valid-deadline' && !globalThis.timer) {
        process.stdout.write(marker); globalThis.timer = setTimeout(() => process.exit(137), 1000);
    }
    // HTTP replies to the completed request, not stdin EOF. Model the real stream
    // ordering; the old EOF-dependent fake incorrectly made immediate end() pass.
    if (!globalThis.replied && Buffer.concat(data).includes('\\r\\n\\r\\n')) {
        globalThis.replied = true;
        if (mode === 'valid') process.stdout.write(response);
        else if (mode === 'body-exit1') { process.stdout.write(response); process.exitCode = 1; }
        else if (mode === 'partial') process.stdout.end(response.slice(0, -1));
        else if (mode === 'oversize') { process.stdout.write('x'.repeat(180000)); setTimeout(() => process.exit(137), 400); }
        else if (mode === 'stderr-limit') process.stderr.write('x'.repeat(5000));
        else if (mode === 'delay') { process.stdout.write(response); setTimeout(() => process.exit(137), 400); }
        else if (mode === 'host-deadline') { process.stdout.write(response); setInterval(() => {}, 1000); }
        else if (mode === 'missing') { process.exitCode = 127; process.stdin.destroy(); }
    }
});
process.stdin.on('end', () => {
    record(); writeFileSync(${JSON.stringify(eof)}, 'EOF');
    if (mode === 'echo') process.stdout.write(Buffer.concat(data));
    else if (mode === 'help') process.stderr.write(help);
    else if (mode === 'bad-help') process.stderr.write('BusyBox v1.37.0\\nUsage: nc [-iN]\\n');
});
`;
    // The .mjs suffix is unnecessary because Node24 detects import syntax. No shell executes the script.
    writeFileSync(filename, js, { mode: 0o700 }); chmodSync(filename, 0o700);
    process.env.PATH = `${root}${path.delimiter}${previous ?? ''}`;
    t.after(() => { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(root, { recursive: true, force: true }); });
    return { capture, eof };
}
async function waitUntil(check, timeout = 2000) {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start >= timeout) throw new Error('bounded synthetic observation missing');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
const f4Args = selector => ['--host', f4Target.endpoint, ...execProgramArgs(f4Target.containerId, selector)];
test('HTTP real child replies before stdin EOF, then closes and returns the exact frame', async t => {
    const f = fakeCli(t, 'valid');
    assert.equal((await exchangeWhoExec(f4Target, probePath('acquisition'))).body, body);
    const capture = JSON.parse(readFileSync(f.capture, 'utf8'));
    assert.deepEqual(capture.argv, f4Args(EXEC_HTTP_PROGRAM));
    assert.equal(capture.stdin, makeExecRequest(probePath('acquisition')).toString());
    assert.ok(existsSync(f.eof));
});
test('F4 real child echo observes stdin EOF before successful prerequisite', async t => {
    const f = fakeCli(t, 'echo');
    assert.equal((await runDockerAsync(f4Args(EXEC_PREREQUISITE_PROGRAM), { input: Buffer.from(marker) })).toString(), marker);
    assert.ok(existsSync(f.eof));
});
test('F4 nc help shape is a capability observation, not a network observation', async t => {
    fakeCli(t, 'help');
    assert.equal((await runDockerAsync(f4Args(EXEC_NC_HELP_PROGRAM))).toString(), helpMarker);
});
test('F4 incompatible small nc help is refused despite matching version', async t => {
    fakeCli(t, 'bad-help');
    await assert.rejects(runDockerAsync(f4Args(EXEC_NC_HELP_PROGRAM)), { code: 'relay_nc_unsupported' });
});
test('F4 held-open deadline cannot pass from an early exit137 marker', async t => {
    const f = fakeCli(t, 'early-deadline');
    await assert.rejects(runDockerAsync(f4Args(EXEC_DEADLINE_PROGRAM), { input: Buffer.from(marker) }), { code: 'relay_deadline_unverified' });
    assert.equal(existsSync(f.eof), false);
});
test('F4 held-open deadline observer requires marker, timing and exit137; stdin stays open', async t => {
    const f = fakeCli(t, 'valid-deadline');
    assert.equal((await runDockerAsync(f4Args(EXEC_DEADLINE_PROGRAM), { input: Buffer.from(marker) })).toString(), deadlineMarker);
    assert.equal(existsSync(f.eof), false); // Synthetic process exit only; no inner Docker claim.
});
for (const [mode, expected] of [['body-exit1', 'relay_transport_failed'], ['partial', 'probe_response_incomplete'],
    ['missing', 'docker_executable_missing'], ['delay', 'probe_timeout'], ['oversize', 'probe_response_invalid'], ['stderr-limit', 'docker_output_limit']]) {
    test(`F4 buffered output is never a result after ${mode}`, async t => {
        fakeCli(t, mode);
        await assert.rejects(exchangeWhoExec(f4Target, probePath('acquisition')), e => {
            assert.equal(e.code, expected); assert.doesNotMatch(JSON.stringify(e), /destinationEntities|Synthetic fixture/u); return true;
        });
    });
}
test('F4 abort discards even a complete body and retains the process slot until the bounded child exits', async t => {
    const f = fakeCli(t, 'delay'), controller = new AbortController(); let settled = false;
    const result = exchangeWhoExec(f4Target, probePath('acquisition'), controller.signal)
        .then(() => { settled = true; throw new Error('unexpected result'); }, error => { settled = true; return error; });
    await waitUntil(() => existsSync(f.eof)); controller.abort();
    await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(settled, false);
    assert.equal((await result).code, 'cancelled');
});
test('F4 host deadline remains failure even with a complete buffered response', async t => {
    fakeCli(t, 'host-deadline');
    const start = Date.now();
    await assert.rejects(runDockerAsync(f4Args(EXEC_HTTP_PROGRAM), { input: makeExecRequest(probePath('acquisition')), timeoutMs: 300 }), { code: 'docker_command_timeout' });
    assert.ok(Date.now() - start < 1800); // Test shortens HOST timer only, never inner argv.
});
test('F4 listener close waits for cancelling tracked exchange, never reports stale readiness', async t => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const { access } = await bridge(t, { exchange: async (_target, _path, signal) => new Promise((_, reject) => {
        entered(); signal.addEventListener('abort', () => { release = () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true });
    }) });
    const request = rawGet(access.port, probePath('acquisition')).catch(error => error.code);
    await started; let closed = false;
    const done = access.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(closed, false); assert.equal(access.lastObservation, undefined);
    release(); await done; assert.equal(await request, 'ECONNRESET');
});

// Genuine HOST BusyBox executable diagnostics, explicitly not the pinned image.
test('F4 host BusyBox short-option hard deadline kills held-open cat; no GNU/Bash dependency', async t => {
    if (process.platform !== 'linux' || !existsSync('/bin/busybox')) { t.skip('Host BusyBox unavailable; not image qualification'); return; }
    const output = [], start = Date.now(); let first;
    const child = spawn('/bin/busybox', ['timeout', '-s', 'KILL', '1', '/bin/busybox', 'cat'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), 3500); t.after(() => { clearTimeout(timer); child.kill('SIGKILL'); });
    child.stdin.on('error', () => {}); child.stdout.on('data', chunk => { first ??= Date.now(); output.push(chunk); });
    child.stderr.on('data', chunk => assert.equal(chunk.length, 0));
    const result = once(child, 'close'); child.stdin.write(marker); // held OPEN: EOF must not terminate this cat
    const [code, signal] = await result; clearTimeout(timer);
    assert.equal(code, null); assert.equal(signal, 'SIGKILL'); assert.equal(Buffer.concat(output).toString(), marker);
    assert.ok(first !== undefined && Date.now() - first >= 750); assert.ok(Date.now() - start < 2500);
});
test('F4 host TCP/EOF qualification is not substituted when the host nc lacks required -n/-w semantics', t => {
    if (process.platform !== 'linux' || !existsSync('/bin/busybox')) { t.skip('Host BusyBox absent'); return; }
    const result = spawnSync('/bin/busybox', ['nc', '--help'], { encoding: 'utf8', timeout: 2000, maxBuffer: 8192 });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (!/\n\s*-n\s+Don't do DNS resolution/u.test(text)) {
        t.skip('Host small nc is not the image nc; exact pinned-image TCP/EOF/deadline tests remain parent-owned'); return;
    }
    t.skip('Host nc help cannot qualify the pinned Mac image; run the opt-in parent test');
});

/* Parent-only executable acceptance. Default is SKIP: no Docker discovery/call.
 * No WHO service/data. Uses only a locally present exact image and its BusyBox.
 * Peers are unique, owned, network=none, no mounts, non-root, no published ports.
 * This proves transport behavior ONLY, not real WHO/restore/PID1 lifecycle. */
test('parent Mac pinned-image HTTP frame-driven EOF, hard deadline and detached internal process acceptance', {
    skip: process.env.MEDIFLOW_WHO_BUSYBOX_MAC_ACCEPTANCE !== 'I_ACCEPT_TEMPORARY_NO_NETWORK_TRANSPORT_TESTS',
    timeout: 240_000,
}, async t => {
    assert.equal(process.platform, 'darwin', 'This gate must run on the real Mac, not Linux');
    assert.equal(process.arch, 'arm64'); assert.match(process.versions.node, /^24\./u);
    const context = process.env.MEDIFLOW_WHO_BUSYBOX_CONTEXT;
    assert.match(context ?? '', /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u, 'Supply the explicitly chosen local Docker context');
    const { dockerEnvironment } = await import('./who-local-platform.mjs');
    const { randomUUID } = await import('node:crypto');
    const image = 'whoicd/icd-api@sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e';
    const contextValue = await runDockerAsync(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], { maxBytes: 4096 });
    const endpoint = JSON.parse(contextValue.toString());
    assert.match(endpoint, /^unix:\/\/\/[^\r\n\0?#]+$/u, 'A local Unix socket is mandatory; no TCP/SSH/env fallback');
    const cmd = (args, options) => runDockerAsync(['--host', endpoint, ...args], { maxBytes: 32_768, ...options });
    const jsonCmd = async args => JSON.parse((await cmd(args)).toString());
    const engineArgs = ['info', '--format', '{"id":{{json .ID}},"os":{{json .OSType}},"arch":{{json .Architecture}}}'];
    const engine = await jsonCmd(engineArgs);
    assert.equal(engine.os, 'linux'); assert.ok(['aarch64', 'arm64'].includes(engine.arch));
    assert.ok(typeof engine.id === 'string' && engine.id.length >= 8);
    const imageData = await jsonCmd(['image', 'inspect', image, '--format', '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"digests":{{json .RepoDigests}}}']);
    assert.equal(imageData.os, 'linux'); assert.equal(imageData.arch, 'arm64');
    assert.ok(imageData.digests.includes(image)); assert.match(imageData.id, /^sha256:[a-f0-9]{64}$/u);
    // Never pull/install. If the exact local image is absent, the test fails here.
    for (const scenario of ['reply-before-EOF-peer-closes', 'reply-before-EOF-peer-held-open', 'non-closing', 'partial-trickle', 'detach-CLI']) {
        await t.test(scenario, async st => {
            const owner = randomUUID(), name = `mediflow-f4-transport-${owner}`;
            const peerArgs = ['nc', '-n', '-l', '-s', '127.0.0.1', '-p', '80'];
            let cid, holder, holderClosed, peer, peerClosed, interval, epoch;
            const stdout = [], stderr = []; let peerBytes = 0;
            const inspectArgs = () => ['container', 'inspect', cid, '--format', '{"id":{{json .Id}},"imageId":{{json .Image}},"image":{{json .Config.Image}},"owner":{{json (index .Config.Labels "org.mediflow.f4.transport-test")}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"network":{{json .HostConfig.NetworkMode}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"capadd":{{json .HostConfig.CapAdd}},"security":{{json .HostConfig.SecurityOpt}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},"running":{{json .State.Running}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}}}'];
            const guard = async (checkEpoch = true) => {
                assert.deepEqual(await jsonCmd(engineArgs), engine);
                const value = await jsonCmd(inspectArgs());
                assert.equal(value.id, cid); assert.equal(value.owner, owner);
                assert.equal(value.imageId, imageData.id); assert.equal(value.image, image);
                assert.equal(value.user, '65534:65534'); assert.equal(value.network, 'none');
                assert.equal(value.readonly, true); assert.equal(value.privileged, false);
                assert.deepEqual(value.entrypoint, ['/bin/busybox']); assert.deepEqual(value.cmd, ['cat']);
                assert.deepEqual(value.mounts, []); assert.deepEqual(value.caps, ['ALL']);
                assert.ok(value.capadd === null || value.capadd.length === 0);
                assert.ok(value.security.includes('no-new-privileges'));
                assert.ok(value.ports === null || Object.keys(value.ports).length === 0);
                if (checkEpoch && epoch) assert.deepEqual({ pid: value.pid, started: value.started, running: value.running }, epoch);
                return value;
            };
            const execCat = filename => cmd(['exec', '--user', '65534:65534', cid, '/bin/busybox', 'cat', filename]);
            const top = async () => (await cmd(['container', 'top', cid, '-eo', 'pid,ppid,stat,args'])).toString().trim().split('\n').slice(1)
                .map(line => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line)).filter(Boolean)
                .map(match => ({ pid: match[1], ppid: match[2], stat: match[3], args: match[4] }));
            const poll = async (fn, milliseconds = 3500) => {
                const end = Date.now() + milliseconds;
                do { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } while (Date.now() < end);
                assert.fail('Pinned-image bounded transport observation missing; no qualification');
            };
            try {
                cid = (await cmd(['container', 'create', '--pull=never', '--name', name,
                    '--label', `org.mediflow.f4.transport-test=${owner}`, '--network', 'none', '--read-only',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
                    '--pids-limit', '32', '--memory', '64m', '--restart', 'no', '--interactive',
                    '--env', 'LC_ALL=C', '--entrypoint', '/bin/busybox', image, 'cat'])).toString().trim();
                assert.match(cid, /^[a-f0-9]{64}$/u); await guard(false);
                // cat PID1 keeps the namespace alive while the one-shot nc server exits.
                // No shell, WHO executable, dataset or additional image is involved.
                holder = spawn('docker', ['--host', endpoint, 'container', 'start', '--attach', '--interactive', cid],
                    { env: dockerEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
                holder.stdin.on('error', () => {}); holder.stdout.resume(); holder.stderr.resume();
                holderClosed = new Promise(resolve => { holder.once('error', () => resolve('spawn-error')); holder.once('close', (code, signal) => resolve({ code, signal })); });
                await poll(async () => (await guard(false)).running);
                const before = await guard(false); epoch = { pid: before.pid, started: before.started, running: true };
                peer = spawn('docker', ['--host', endpoint, 'exec', '--interactive', '--user', '65534:65534',
                    '--env', 'LC_ALL=C', cid, '/bin/busybox', ...peerArgs],
                    { env: dockerEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
                peer.stdin.on('error', () => {});
                peer.stdout.on('data', chunk => { peerBytes += chunk.length; if (peerBytes <= 8192) stdout.push(chunk); else peer.stdout.destroy(); });
                peer.stderr.on('data', chunk => { if (stderr.reduce((n, c) => n + c.length, 0) < 4096) stderr.push(chunk); });
                peerClosed = new Promise(resolve => { peer.once('error', () => resolve('spawn-error')); peer.once('close', (code, signal) => resolve({ code, signal })); });
                await poll(async () => /0100007F:0050\s+00000000:0000\s+0A\b/u.test((await execCat('/proc/net/tcp')).toString()));
                const target = { endpoint, containerId: cid };
                // Actual capability observations; guard again after the one-second timeout.
                await checkWhoExecTools(target); await guard();
                const baseline = new Set((await top()).map(row => row.pid));
                let client, result, detached = false;
                const started = Date.now();
                if (scenario === 'detach-CLI') {
                    client = spawn('docker', ['--host', endpoint, ...execProgramArgs(cid, EXEC_HTTP_PROGRAM)],
                        { env: dockerEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
                    client.stdin.on('error', () => {}); client.stdout.resume(); client.stderr.resume();
                    client.once('error', () => {}); client.stdin.write(makeExecRequest(probePath('acquisition'))); // HTTP input stays open.
                } else result = exchangeWhoExec(target, probePath('acquisition')).then(value => ({ value }), error => ({ error }));
                try {
                    await poll(async () => peerBytes >= makeExecRequest(probePath('acquisition')).length);
                    assert.ok(peerBytes <= 8192); assert.equal(Buffer.concat(stdout).toString(), makeExecRequest(probePath('acquisition')).toString());
                    // Before the first response byte the HTTP client must NOT send FIN.
                    // The old reply-after-EOF scenario assumed the behavior contradicted
                    // by the parent WHO wire. Cat EOF remains independently mandatory.
                    await poll(async () => /0100007F:0050\s+[0-9A-F]+:[0-9A-F]+\s+01\b/u.test((await execCat('/proc/net/tcp')).toString()));
                    const active = (await top()).filter(row => !baseline.has(row.pid) && !row.stat.startsWith('Z'));
                    assert.equal(active.length, 2, 'Exactly one request nc and its independent watchdog, no request descendants');
                    assert.ok(active.some(row => /\/bin\/busybox timeout -s KILL 4 \/bin\/busybox nc\b/u.test(row.args)), 'Observe the inner watchdog, not just the CLI');
                    assert.ok(active.some(row => /\/bin\/busybox nc -n -w 5 127\.0\.0\.1 80$/u.test(row.args)), 'Exact internal client must be observed alive before deadline/detach');
                    // The real BusyBox keeps reading until peer EOF; a complete frame alone
                    // must remain a timeout if the peer ignores Connection: close.
                    if (scenario === 'reply-before-EOF-peer-closes') peer.stdin.end(wire(body));
                    else if (scenario === 'reply-before-EOF-peer-held-open') peer.stdin.write(wire(body));
                    else if (scenario === 'partial-trickle') {
                        peer.stdin.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{');
                        interval = setInterval(() => peer.stdin.write(' '), 200); // Never a complete response; activity must not extend deadline.
                    } else if (scenario === 'detach-CLI') {
                        const closing = once(client, 'close'); client.kill('SIGKILL'); await closing; detached = true;
                    }
                    if (scenario !== 'detach-CLI') {
                        const observed = await result;
                        if (scenario === 'reply-before-EOF-peer-closes') assert.equal(observed.value?.body, body);
                        else { assert.equal(observed.error?.code, 'probe_timeout'); assert.ok(Date.now() - started < 5500); }
                    } else assert.equal(detached, true); // This alone is deliberately insufficient.
                    clearInterval(interval);
                    // Observe recorded inner processes independently, AFTER CLI exit.
                    // Deadline is measured from initial dispatch, never reset here.
                    await poll(async () => {
                        const current = await top();
                        return active.every(proc => !current.some(row => row.pid === proc.pid && !row.stat.startsWith('Z')));
                    }, Math.max(0, started + 5500 - Date.now()));
                    assert.ok(Date.now() - started < 5500, 'Internal request remained alive beyond the bounded deadline');
                    const remaining = await top();
                    assert.ok(!remaining.some(row => !baseline.has(row.pid) && !row.stat.startsWith('Z')));
                    const zombies = remaining.filter(row => !baseline.has(row.pid) && row.stat.startsWith('Z')).length;
                    st.diagnostic(`Exited unreaped processes in synthetic cat-PID1 peer: ${zombies}; real WHO PID1 reaping remains a separate gate.`);
                    await guard(); // cat PID1 must retain the same epoch after request/server exit.
                    assert.equal(stderr.reduce((n, c) => n + c.length, 0), 0, 'Peer stderr must be empty (contents not logged)');
                } finally { clearInterval(interval); if (client && client.exitCode === null && client.signalCode === null) client.kill('SIGKILL'); }
            } finally {
                clearInterval(interval);
                if (cid && /^[a-f0-9]{64}$/u.test(cid)) {
                    // Destructive cleanup targets only this newly created ID, after exact ownership/engine/image checks.
                    // If a guard fails, STOP here and retain that ID for parent investigation; never touch another container.
                    const owned = await guard(false);
                    if (owned.running) {
                        const stopped = (await cmd(['container', 'stop', '--timeout', '30', cid], { timeoutMs: 35000 })).toString().trim();
                        assert.equal(stopped, cid); assert.equal((await guard(false)).running, false);
                    }
                    assert.equal((await cmd(['container', 'rm', cid])).toString().trim(), cid);
                }
                peer?.stdin.destroy(); if (peer && peer.exitCode === null && peer.signalCode === null) peer.kill('SIGTERM');
                if (peerClosed) await peerClosed;
                holder?.stdin.destroy(); if (holder && holder.exitCode === null && holder.signalCode === null) holder.kill('SIGTERM');
                if (holderClosed) await holderClosed;
            }
        });
    }
});
