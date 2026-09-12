/* PROPOSED Mac host-only WHO bridge. F3 topology; F4 BusyBox compatibility. No Web import. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { checkCancelled, dockerEnvironment } from './who-local-platform.mjs';
import { PROBE_MAX_BYTES, PROBE_TIMEOUT_MS, probeError } from './who-local-probe.mjs';

export const MAC_ACCESS_TOPOLOGY = 'mac-host-exec-loopback-v1';
export const MAC_QUALIFICATION_SCHEMA = 'mediflow.who-owned-qualification.v4';
export const EXEC_TRANSPORT = 'node-http-docker-exec-busybox-v2';
export const EXEC_PREREQUISITE = 'mediflow-who-exec-busybox-v2';
export const EXEC_MAX_WIRE_BYTES = PROBE_MAX_BYTES * 2 + 8192;
export const EXEC_INNER_TIMEOUT_SECONDS = 4;
// These are private operation selectors, NOT shell programs or executable arguments.
export const EXEC_HTTP_PROGRAM = 'busybox-http-v2';
export const EXEC_PREREQUISITE_PROGRAM = 'busybox-stdin-eof-v2';
export const EXEC_NC_HELP_PROGRAM = 'busybox-nc-help-v2';
export const EXEC_DEADLINE_PROGRAM = 'busybox-stdin-deadline-v2';
const NC_MARKER = `${EXEC_PREREQUISITE}:nc-help\n`;
const DEADLINE_MARKER = `${EXEC_PREREQUISITE}:deadline\n`;
const ECHO_MARKER = `${EXEC_PREREQUISITE}\n`;
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const prefix = '/icd/release/11/2026-01/mms/';
const fail = (code, details) => { throw probeError(code, details); };
// All executable paths, applets, flags, deadlines and the TCP destination are fixed.
// No shell, nc -e/-l, GNU flag or input-derived argv. The one request process has
// its own hard deadline; killing a host Docker CLI is NOT proof of inner closure.
const programs = Object.freeze({
    [EXEC_HTTP_PROGRAM]: Object.freeze(['4', '/bin/busybox', 'nc', '-n', '-w', '5', '127.0.0.1', '80']),
    [EXEC_PREREQUISITE_PROGRAM]: Object.freeze(['4', '/bin/busybox', 'cat']),
    [EXEC_NC_HELP_PROGRAM]: Object.freeze(['4', '/bin/busybox', 'nc', '--help']),
    [EXEC_DEADLINE_PROGRAM]: Object.freeze(['1', '/bin/busybox', 'cat']),
});
export function execProgramArgs(id, program) {
    if (!/^[a-f0-9]{64}$/u.test(id) || !Object.hasOwn(programs, program)) fail('probe_binding_invalid');
    return ['exec', '--interactive', '--user', '65534:65534', '--env', 'LC_ALL=C', id,
        '/bin/busybox', 'timeout', '-s', 'KILL', ...programs[program]];
}
function identifyProgram(args) {
    const start = args.indexOf('exec');
    if (start < 0 || !/^[a-f0-9]{64}$/u.test(args[start + 6] ?? '')) return undefined;
    return Object.keys(programs).find(program => {
        const expected = execProgramArgs(args[start + 6], program);
        return expected.length === args.length - start && expected.every((arg, i) => arg === args[start + i]);
    });
}
function validNcHelp(value) {
    // Same applet family as the parent receipt, not BusyBox's incompatible small nc.
    return /^BusyBox v1\.37\.0\b/u.test(value)
        && /Usage: nc \[OPTIONS\] HOST PORT/u.test(value)
        && /\n\s*-n\s+Don't do DNS resolution/u.test(value)
        && /\n\s*-w SEC\s+Timeout for connects and final net reads/u.test(value);
}

/** Async bounded CLI. Only internal callers construct args; no executable/env override. */
export function runDockerAsync(args, { input, signal, timeoutMs = PROBE_TIMEOUT_MS, maxBytes = EXEC_MAX_WIRE_BYTES } = {}) {
    try { checkCancelled(signal); } catch (error) { return Promise.reject(error); }
    const program = identifyProgram(args);
    return new Promise((resolve, reject) => {
        let child, timer, killer, failure, firstOutputAt, closed = false, finished = false, bytes = 0, stderrBytes = 0;
        const out = [], err = [];
        const terminateCli = () => {
            child?.stdin?.destroy();
            if (child && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                killer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 250);
                killer.unref();
            }
        };
        const done = (error, value) => {
            if (finished) return;
            finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            out.length = 0; err.length = 0;
            if (error) { if (!closed) terminateCli(); reject(error); } else resolve(value);
        };
        const rejectOperation = error => {
            if (finished || failure) return;
            failure = error; out.length = 0; err.length = 0;
            // Do not free an EXEC operation slot just because the caller disconnected.
            // Keep draining (without retaining) until inner exit or the original deadline.
            if (program && child && !closed) child.stdin.end();
            else done(error);
        };
        const abort = () => rejectOperation(probeError('cancelled'));
        timer = setTimeout(() => done(failure ?? probeError('docker_command_timeout', { timeoutMs })), timeoutMs);
        try {
            child = spawn('docker', args, { env: dockerEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
            child.once('error', error => done(probeError(error.code === 'ENOENT' ? 'docker_cli_missing'
                : error.code === 'EACCES' ? 'docker_executable_denied' : 'docker_unavailable', { executable: 'docker' })));
            child.stdin.on('error', () => {}); // Exit status, never raw stderr, is authoritative.
            child.stdout.on('data', chunk => {
                if (finished || failure) return;
                firstOutputAt ??= performance.now();
                bytes += chunk.length;
                if (bytes > maxBytes) rejectOperation(probeError('probe_response_invalid'));
                else out.push(chunk);
            });
            child.stderr.on('data', chunk => {
                if (finished || failure) return;
                stderrBytes += chunk.length;
                if (stderrBytes > 4096) rejectOperation(probeError('docker_output_limit'));
                else err.push(chunk);
            });
            child.once('close', (code, childSignal) => {
                closed = true; clearTimeout(killer);
                if (finished) return;
                if (failure || signal?.aborted) { done(failure ?? probeError('cancelled')); return; }
                const stdout = Buffer.concat(out, bytes), stderr = Buffer.concat(err).toString('utf8');
                if (program === EXEC_DEADLINE_PROGRAM) {
                    const elapsed = performance.now() - (firstOutputAt ?? Infinity);
                    // The held-open cat must echo AND be killed by the one-second inner
                    // deadline. A host timeout, EOF/exit0, TERM, help or missing tool fails.
                    if ((code === 137 || (code === null && childSignal === 'SIGKILL'))
                        && stdout.equals(Buffer.from(ECHO_MARKER)) && stderrBytes === 0
                        && elapsed >= 750 && elapsed <= 2500) done(null, Buffer.from(DEADLINE_MARKER));
                    else if (code !== 0 && code !== 137 && childSignal !== 'SIGKILL')
                        done(classifyExecFailure(code, childSignal, stderr, program, bytes));
                    else done(probeError('relay_deadline_unverified', { executable: 'busybox_timeout',
                        ...(Number.isInteger(code) ? { exitCode: code } : {}) }));
                } else if (code !== 0) done(classifyExecFailure(code, childSignal, stderr, program, bytes));
                else if (program === EXEC_NC_HELP_PROGRAM) {
                    if (validNcHelp(stdout.toString('utf8') + stderr)) done(null, Buffer.from(NC_MARKER));
                    else done(probeError('relay_nc_unsupported', { executable: 'busybox_nc' }));
                } else done(null, stdout);
            });
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            else if (program === EXEC_DEADLINE_PROGRAM) child.stdin.write(input); // Deliberately no EOF.
            else child.stdin.end(input);
        } catch { done(probeError('docker_unavailable')); }
    });
}

/** Minimized executable diagnostics; no raw stdout, query or stderr escapes. */
export function classifyExecFailure(code, childSignal, stderr, program, stdoutBytes) {
    const isExec = Boolean(program);
    let reason = code === 127 ? 'docker_executable_missing' : code === 126 ? 'docker_executable_denied'
        : code === 124 || code === 137 || childSignal === 'SIGKILL' ? 'probe_timeout' : isExec ? 'relay_transport_failed' : 'docker_unavailable';
    let executable = isExec ? 'busybox_timeout_nc' : 'docker';
    if (isExec) {
        if (/timeout:.*(?:unrecognized|invalid|illegal) option|Usage: timeout/u.test(stderr)) {
            reason = 'relay_timeout_unsupported'; executable = 'busybox_timeout';
        } else if (/nc:.*(?:unrecognized|invalid|illegal) option|nc: applet not found|Usage: nc/u.test(stderr)) {
            reason = 'relay_nc_unsupported'; executable = 'busybox_nc';
        } else if (/timeout: applet not found/u.test(stderr)) {
            reason = 'relay_timeout_unsupported'; executable = 'busybox_timeout';
        } else if (/cat: applet not found/u.test(stderr)) {
            reason = 'relay_prerequisite_failed'; executable = 'busybox_cat';
        } else if (program === EXEC_HTTP_PROGRAM && code === 1 && stdoutBytes === 0
            && (stderr === '' || /Connection refused/u.test(stderr))) {
            // This nc applet can suppress connect-refused diagnostics without -v.
            // Empty exit1 is only retryable unavailability, never a successful probe.
            reason = 'probe_connect_pending'; executable = 'busybox_nc';
        } else if (code === 127 || code === 126) executable = 'busybox';
        else if (program === EXEC_DEADLINE_PROGRAM) { reason = 'relay_deadline_unverified'; executable = 'busybox_timeout'; }
        else if (program === EXEC_NC_HELP_PROGRAM) { reason = 'relay_nc_unsupported'; executable = 'busybox_nc'; }
    }
    return probeError(reason, { ...(Number.isInteger(code) ? { exitCode: code } : {}),
        ...(/^[A-Z0-9_]{1,48}$/u.test(childSignal ?? '') ? { systemCode: childSignal } : {}), executable });
}

/** Capability observations only. No TCP, WHO, restore or detached-process qualification. */
export async function checkWhoExecTools(target, signal, run = runDockerAsync) {
    for (const [program, expected, code, executable] of [
        [EXEC_PREREQUISITE_PROGRAM, ECHO_MARKER, 'relay_prerequisite_failed', 'busybox_cat'],
        [EXEC_NC_HELP_PROGRAM, NC_MARKER, 'relay_nc_unsupported', 'busybox_nc'],
        [EXEC_DEADLINE_PROGRAM, DEADLINE_MARKER, 'relay_deadline_unverified', 'busybox_timeout'],
    ]) {
        checkCancelled(signal);
        const raw = await run(['--host', target.endpoint, ...execProgramArgs(target.containerId, program)],
            { input: program === EXEC_NC_HELP_PROGRAM ? undefined : Buffer.from(ECHO_MARKER), signal, maxBytes: 4096 });
        if (!Buffer.isBuffer(raw) || !raw.equals(Buffer.from(expected))) fail(code, { executable });
    }
    checkCancelled(signal);
}

/** Only the shared backend's three existing, canonical GET forms. No URL normalization. */
export function validateLoopbackPath(value) {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith(prefix) || /[\r\n\0#\\]/u.test(value)) fail('relay_request_invalid');
    if (value.startsWith(`${prefix}search?`)) {
        const parameters = new URLSearchParams(value.slice(`${prefix}search?`.length));
        const query = parameters.get('q');
        if (typeof query !== 'string' || !query || query !== query.trim().replace(/\s+/gu, ' ') || Buffer.byteLength(query) > 160
            || /[\u0000-\u001f\u007f<>\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(query)) fail('relay_request_invalid');
        const expected = new URLSearchParams({ q: query, flatResults: 'true', highlightingEnabled: 'false',
            medicalCodingMode: 'true', includeKeywordResult: 'false' });
        if (value !== `${prefix}search?${expected}`) fail('relay_request_invalid');
        return 'search';
    }
    const codeMatch = /^codeinfo\/([^?]+)\?flexiblemode=false&convertToTerminalCodes=false$/u.exec(value.slice(prefix.length));
    if (codeMatch) {
        let code;
        try { code = decodeURIComponent(codeMatch[1]); } catch { fail('relay_request_invalid'); }
        if (code.length > 32 || code === 'N/A' || !/^[A-Z0-9][A-Z0-9.-]*(?:[&/][A-Z0-9][A-Z0-9.-]*)*$/u.test(code)
            || codeMatch[1] !== encodeURIComponent(code)) fail('relay_request_invalid');
        return 'codeinfo';
    }
    if (/^[1-9][0-9]{0,19}(?:\/(?:other|unspecified))?$/u.test(value.slice(prefix.length))) return 'entity';
    fail('relay_request_invalid');
}
export function makeExecRequest(requestPath) {
    validateLoopbackPath(requestPath);
    return Buffer.from(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nAPI-Version: v2\r\nAccept: application/json\r\nAccept-Language: en\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`, 'ascii');
}

/** Strict bounded response framing; no successful body is released before EOF/exit0/readback. */
export function parseExecResponse(wire, requestPath) {
    const operation = validateLoopbackPath(requestPath);
    if (!Buffer.isBuffer(wire) || wire.length > EXEC_MAX_WIRE_BYTES) fail('probe_response_invalid');
    const split = wire.indexOf('\r\n\r\n');
    if (split < 0 || split > 8192) fail('probe_response_invalid');
    const header = wire.subarray(0, split).toString('latin1').split('\r\n');
    const statusLine = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e]{0,128})?$/u.exec(header.shift());
    if (!statusLine) fail('probe_response_invalid');
    const status = Number(statusLine[1]), headers = Object.create(null);
    if (header.length > 64) fail('probe_response_invalid');
    for (const line of header) {
        const field = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([\x20-\x7e\t]*)$/u.exec(line);
        if (!field || Object.hasOwn(headers, field[1].toLowerCase())) fail('probe_response_invalid');
        headers[field[1].toLowerCase()] = field[2].trim();
    }
    if (status >= 300 && status < 400) fail('probe_redirect_refused', { status });
    if (status === 503) fail('probe_service_starting', { status });
    if (status !== 200 && !(status === 404 && operation === 'codeinfo')) fail('probe_http_status', { status });
    if (headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity') fail('probe_response_invalid');
    const raw = wire.subarray(split + 4);
    let body;
    if (headers['transfer-encoding'] !== undefined) {
        if (headers['transfer-encoding'].toLowerCase() !== 'chunked' || headers['content-length'] !== undefined) fail('probe_response_invalid');
        let offset = 0, size = 0, count = 0;
        const chunks = [];
        for (;;) {
            const end = raw.indexOf('\r\n', offset);
            if (end < 0 || end - offset > 8 || ++count > 1024) fail('probe_response_invalid');
            const text = raw.subarray(offset, end).toString('latin1');
            if (!/^[0-9a-fA-F]{1,8}$/u.test(text)) fail('probe_response_invalid');
            const length = Number.parseInt(text, 16); offset = end + 2;
            if (size + length > PROBE_MAX_BYTES || offset + length + 2 > raw.length) fail('probe_response_invalid');
            if (raw[offset + length] !== 13 || raw[offset + length + 1] !== 10) fail('probe_response_invalid');
            if (length === 0) {
                if (offset + 2 !== raw.length) fail('probe_response_invalid'); // No trailers or second response.
                break;
            }
            size += length; chunks.push(raw.subarray(offset, offset + length)); offset += length + 2;
        }
        body = Buffer.concat(chunks, size);
    } else {
        const length = headers['content-length'];
        if (length === undefined || !/^[0-9]+$/u.test(length) || Number(length) !== raw.length) fail('probe_response_incomplete');
        body = raw;
    }
    if (body.length > PROBE_MAX_BYTES) fail('probe_response_invalid');
    if (status === 404) return { status, body: '' }; // A real codeinfo 404, never a fabricated lookup result.
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(headers['content-type'] ?? '')) fail('probe_response_invalid');
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        const json = JSON.parse(text);
        if (!json || typeof json !== 'object' || Array.isArray(json)) fail('probe_response_invalid');
        return { status, body: text };
    } catch { fail('probe_response_invalid'); }
}
export async function exchangeWhoExec(target, requestPath, signal, run = runDockerAsync) {
    const wire = await run(['--host', target.endpoint, ...execProgramArgs(target.containerId, EXEC_HTTP_PROGRAM)],
        { input: makeExecRequest(requestPath), signal, maxBytes: EXEC_MAX_WIRE_BYTES });
    return parseExecResponse(wire, requestPath);
}

/** Generic host-only listener. The owner supplies mandatory before/after authorization. */
export async function openWhoLoopback({ inspect, exchange, prerequisite, port, signal }) {
    checkCancelled(signal);
    if (typeof inspect !== 'function' || typeof exchange !== 'function' || typeof prerequisite !== 'function'
        || !Number.isInteger(port) || port < 0 || port > 65535) fail('probe_binding_invalid');
    const scope = new AbortController();
    const initialDeadline = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const initialSignal = AbortSignal.any([scope.signal, initialDeadline, ...(signal ? [signal] : [])]);
    const initial = await inspect(initialSignal);
    await prerequisite(initial, initialSignal);
    const prerequisiteReadback = await inspect(initialSignal);
    if (prerequisiteReadback.bindingSha256 !== initial.bindingSha256) fail('probe_binding_changed');
    checkCancelled(initialSignal);
    const instanceId = randomUUID(), sockets = new Set(), operations = new Set(), completions = new Set();
    let lastObservation, lastError, closing, actualPort;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: PROBE_TIMEOUT_MS,
        headersTimeout: PROBE_TIMEOUT_MS, keepAliveTimeout: 1 }, async (req, res) => {
        const controller = new AbortController();
        const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS);
        const requestSignal = AbortSignal.any([controller.signal, deadline, scope.signal, ...(signal ? [signal] : [])]);
        const disconnect = () => { if (!res.writableFinished) controller.abort(); };
        const reply = (status, body) => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
                'Cache-Control': 'no-store', Connection: 'close', 'X-Content-Type-Options': 'nosniff' }); res.end(body);
        };
        req.once('aborted', disconnect); res.once('close', disconnect);
        let complete, completion;
        try {
            if (closing || operations.size >= 4) fail('relay_busy');
            operations.add(controller);
            completion = new Promise(resolve => { complete = resolve; }); completions.add(completion);
            if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${actualPort}`
                || ['origin', 'cookie', 'authorization', 'proxy-authorization', 'expect', 'transfer-encoding'].some(h => req.headers[h] !== undefined)
                || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) fail('relay_request_invalid');
            const operation = validateLoopbackPath(req.url);
            const before = await inspect(requestSignal);
            if (before.bindingSha256 !== initial.bindingSha256) fail('probe_binding_changed');
            let response, exchangeError;
            try { response = await exchange(before, req.url, requestSignal); } catch (error) { exchangeError = error; }
            checkCancelled(requestSignal);
            const after = await inspect(requestSignal);
            if (after.bindingSha256 !== before.bindingSha256) fail('probe_binding_changed');
            if (exchangeError) throw exchangeError;
            checkCancelled(requestSignal);
            if (!response || typeof response.body !== 'string' || Buffer.byteLength(response.body) > PROBE_MAX_BYTES
                || (response.status !== 200 && !(operation === 'codeinfo' && response.status === 404))) fail('probe_response_invalid');
            lastObservation = { instanceId, transport: EXEC_TRANSPORT, targetBindingSha256: after.bindingSha256,
                responseSha256: hash(response.body), requestPathSha256: hash(req.url), port: actualPort,
                endpoint: `http://127.0.0.1:${actualPort}`, startedAt: after.startedAt,
                bindingSha256: hash(JSON.stringify({ instanceId, port: actualPort, target: after.bindingSha256 })),
                ...(after.isolation ? { isolation: after.isolation } : {}) };
            lastError = undefined;
            reply(response.status, response.body);
        } catch (error) {
            lastError = deadline.aborted && !signal?.aborted && !controller.signal.aborted && !scope.signal.aborted
                ? probeError('probe_timeout', { timeoutMs: PROBE_TIMEOUT_MS }) : error;
            reply(error.code === 'relay_request_invalid' ? 400 : 503, '{"error":"who_local_unavailable"}');
        } finally {
            operations.delete(controller); req.removeListener('aborted', disconnect); res.removeListener('close', disconnect);
            completions.delete(completion); complete?.();
        }
    });
    server.maxConnections = 8; server.maxRequestsPerSocket = 1;
    server.on('connection', socket => {
        sockets.add(socket);
        // A hard socket lifetime also bounds clients that never finish their headers.
        const timer = setTimeout(() => socket.destroy(), PROBE_TIMEOUT_MS + 100);
        timer.unref(); socket.once('close', () => { clearTimeout(timer); sockets.delete(socket); });
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('connect', (_req, socket) => socket.destroy()); server.on('upgrade', (_req, socket) => socket.destroy());
    const close = () => {
        if (closing) return closing;
        closing = new Promise(resolve => {
            scope.abort(); signal?.removeEventListener('abort', abort);
            for (const operation of operations) operation.abort();
            for (const socket of sockets) socket.destroy();
            server.close(() => { void Promise.allSettled([...completions]).then(() => { resolveClosed(); resolve(); }); });
        });
        return closing;
    };
    const abort = () => { void close(); };
    try {
        await new Promise((resolve, reject) => {
            const error = () => reject(probeError('port_in_use'));
            server.once('error', error);
            server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { server.removeListener('error', error); resolve(); });
        });
        const address = server.address();
        if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || (port && address.port !== port)) fail('probe_binding_invalid');
        actualPort = address.port;
        server.on('error', () => { lastError = probeError('relay_listener_failed'); void close(); });
        signal?.addEventListener('abort', abort, { once: true });
        checkCancelled(signal);
        return Object.freeze({ instanceId, port: actualPort, closed, close,
            get lastObservation() { return lastObservation; }, get lastError() { return lastError; } });
    } catch (error) { await close(); throw error; }
}
