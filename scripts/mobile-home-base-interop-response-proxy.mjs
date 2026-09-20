#!/usr/bin/env node
/* @Codex */
// Candidate fixture tool, never imported by the app or the ordinary TLS proxy.
// Owner invocation (no implicit target, descriptor, client or credentials):
// node scripts/mobile-home-base-interop-response-proxy.mjs \
//   --descriptor /private/host.json --cert /private/cert.pem --key /private/key.pem \
//   --target http://127.0.0.1:PORT [--barrier-directory /private/mediflow-interop-RUN \
//   --run-id RUN --client ios|ipados --hold-timeout-ms 5000]
// With barrier options omitted, forwarding is unchanged. A runner creates
// the 0700 run directory; this tool never creates/reuses it or changes host state.
// Protocol: interop-lock-barrier.schema.json, SHA256
// eec0b647688b084d1e35b7ff13af06b503a756301876ac22ac5aac8c18cafac1.
// Private filesystem events are trusted test orchestration, not authentication.
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateDescriptor } from './mobile-home-base-interop.mjs';

const METHOD = 'POST';
const LOGOUT_PATH = '/api/auth/native/logout';
const ID = /^[A-Za-z0-9._-]{1,100}$/u;
const EVENTS = ['populated-ready', 'logout-armed', 'logout-held', 'client-clear-verified',
    'logout-released', 'same-process-relogin-verified', 'test-finished', 'logout-aborted'];
const OWNER_EVENTS = ['logout-armed', 'logout-held', 'logout-released', 'logout-aborted'];
const REASONS = ['client-disconnected', 'hold-deadline', 'upstream-status', 'upstream-error',
    'test-finished-before-clear', 'binding-mismatch'];
const FIELDS = new Set(['schemaVersion', 'runId', 'fixtureId', 'event', 'method', 'path', 'requestID',
    'httpStatus', 'upstreamHttpStatus', 'serverLogoutCompleted', 'responseForwarded',
    'heldUntilClientClearVerified', 'clientDisconnectedBeforeRelease', 'reason']);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

function regularBytes(filename, { privateFile = true, limit = 16_384 } = {}) {
    let fd;
    try {
        requireValue(path.isAbsolute(filename) && fs.realpathSync(filename) === path.resolve(filename), 'path');
        const before = fs.lstatSync(filename);
        requireValue(before.isFile() && before.nlink === 1, 'file');
        fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(fd);
        requireValue(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.nlink === 1
            && stat.size > 0 && stat.size <= limit && (!process.getuid || stat.uid === process.getuid())
            && (privateFile ? (stat.mode & 0o777) === 0o600 : (stat.mode & 0o022) === 0), 'metadata');
        const bytes = Buffer.alloc(stat.size + 1);
        const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
        requireValue(count === stat.size, 'size');
        return bytes.subarray(0, count);
    } catch { throw new Error('A bounded, owned, canonical regular file with safe permissions is required.'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
}

function parseJSON(bytes) {
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('Invalid private fixture JSON.'); }
}

function directoryIdentity(directory) {
    requireValue(path.isAbsolute(directory) && fs.realpathSync(directory) === path.resolve(directory), 'Invalid barrier directory path.');
    const stat = fs.lstatSync(directory);
    requireValue(stat.isDirectory() && (stat.mode & 0o777) === 0o700
        && (!process.getuid || stat.uid === process.getuid()), 'An owned 0700 barrier directory is required.');
    return `${stat.dev}:${stat.ino}`;
}

function createChannel(directory, runId, fixtureId) {
    requireValue(ID.test(runId) && path.basename(directory) === `mediflow-interop-${runId}`, 'Invalid run directory binding.');
    const identity = directoryIdentity(directory);
    const openedAt = Date.now();
    const filename = (event) => path.join(directory, `${event}.json`);
    const present = (event) => {
        try { fs.lstatSync(filename(event)); return true; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    requireValue(EVENTS.filter((event) => event !== 'populated-ready').every((event) => !present(event)), 'Stale barrier directory.');
    // Atomic exclusive ownership, retained after close/crash to prevent reuse.
    // This empty private directory is not a protocol event or a success receipt.
    fs.mkdirSync(path.join(directory, '.response-proxy-owner'), { mode: 0o700 });
    const seen = new Map();
    const assertCurrent = () => requireValue(directoryIdentity(directory) === identity, 'Barrier directory changed.');
    const read = (event) => {
        assertCurrent();
        if (!present(event)) {
            requireValue(!seen.has(event), 'Barrier event removed.');
            return null;
        }
        const bytes = regularBytes(filename(event), { limit: 8_192 });
        const text = bytes.toString('utf8');
        requireValue(!seen.has(event) || seen.get(event) === text, 'Barrier event changed.');
        if (event === 'populated-ready' && !seen.has(event)) {
            const modifiedAt = fs.lstatSync(filename(event)).mtimeMs;
            requireValue(modifiedAt >= openedAt - 30_000 && modifiedAt <= Date.now() + 1_000, 'Stale populated-ready.');
        }
        const value = parseJSON(bytes);
        requireValue(value && !Array.isArray(value) && Object.keys(value).every((key) => FIELDS.has(key))
            && value.schemaVersion === 1 && value.runId === runId && value.fixtureId === fixtureId
            && value.event === event && value.method === METHOD && value.path === LOGOUT_PATH, 'Invalid barrier binding.');
        requireValue(value.requestID === undefined || (typeof value.requestID === 'string' && ID.test(value.requestID)), 'Invalid request binding.');
        for (const key of ['httpStatus', 'upstreamHttpStatus']) requireValue(value[key] === undefined || value[key] === 204, 'Invalid response status.');
        for (const key of ['serverLogoutCompleted', 'responseForwarded', 'heldUntilClientClearVerified', 'clientDisconnectedBeforeRelease']) {
            requireValue(value[key] === undefined || typeof value[key] === 'boolean', 'Invalid barrier field.');
        }
        requireValue(value.reason === undefined || REASONS.includes(value.reason), 'Invalid abort reason.');
        if (['logout-held', 'client-clear-verified', 'logout-released', 'same-process-relogin-verified'].includes(event)) {
            requireValue(typeof value.requestID === 'string', 'Missing request binding.');
        }
        seen.set(event, text);
        return value;
    };
    const publish = (event, fields = {}) => {
        assertCurrent();
        requireValue(!present(event), 'Barrier receipt already exists.');
        const value = { schemaVersion: 1, runId, fixtureId, event, method: METHOD, path: LOGOUT_PATH, ...fields };
        const text = `${JSON.stringify(value)}\n`;
        const temporary = path.join(directory, `.proxy-${randomUUID()}.tmp`);
        let fd;
        try {
            fd = fs.openSync(temporary, 'wx', 0o600);
            fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
            assertCurrent();
            requireValue(!present(event), 'Barrier receipt already exists.');
            // The private directory has one exclusive owner for these filenames.
            fs.renameSync(temporary, filename(event));
            seen.set(event, text);
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    };
    const verifyOwnerFiles = () => {
        for (const event of OWNER_EVENTS) {
            requireValue(!present(event) || seen.has(event), 'Unexpected owner event.');
            if (seen.has(event)) read(event);
        }
    };
    return { read, publish, verifyOwnerFiles };
}

function createBarrier(config, fixtureId, client, notifyAbort) {
    const channel = createChannel(config.barrierDirectory, config.runId, fixtureId);
    const timeout = config.holdTimeoutMs ?? 5_000;
    requireValue(Number.isInteger(timeout) && timeout >= 25 && timeout <= 10_000, 'Invalid bounded hold deadline.');
    const startedAt = performance.now();
    let state = 'waiting';
    let active;
    let ticker;
    let timer;
    let clearVerified = false;
    const abort = (reason) => {
        if (state === 'aborted') return;
        state = 'aborted'; clearInterval(ticker); clearTimeout(timer);
        try { channel.publish('logout-aborted', { ...(active ? { requestID: active.requestID } : {}), reason }); }
        catch { /* An unsafe/changed directory cannot receive a trustworthy receipt. */ }
        active?.upstream?.destroy(); active?.response.destroy();
        notifyAbort(reason);
    };
    const poll = () => {
        if (state === 'aborted') return;
        try {
            channel.verifyOwnerFiles();
            const populated = channel.read('populated-ready');
            const clear = channel.read('client-clear-verified');
            const relogin = channel.read('same-process-relogin-verified');
            const finished = channel.read('test-finished');
            if (clear) requireValue(['held', 'releasing', 'released'].includes(state)
                && clear.requestID === active?.requestID, 'Unexpected clear binding/order.');
            if (relogin) requireValue(state === 'released' && relogin.requestID === active?.requestID, 'Unexpected relogin binding/order.');
            for (const event of [populated, finished]) {
                if (event?.requestID !== undefined) requireValue(event.requestID === active?.requestID, 'Unexpected request binding.');
            }
            if (finished && !clearVerified) return abort('test-finished-before-clear');
            if (state === 'waiting' && populated) { channel.publish('logout-armed'); state = 'armed'; }
            if (['waiting', 'armed'].includes(state) && performance.now() - startedAt >= 30_000) return abort('hold-deadline');
            if (active && state !== 'released' && performance.now() >= active.deadline) return abort('hold-deadline');
            if (state === 'held' && clear) {
                requireValue(!active.response.destroyed && !active.disconnected, 'Disconnected response.');
                clearVerified = true; state = 'releasing';
                active.response.once('finish', () => {
                    if (state !== 'releasing') return;
                    if (active.disconnected || active.response.destroyed || !active.response.writableFinished) return abort('client-disconnected');
                    if (performance.now() >= active.deadline) return abort('hold-deadline');
                    try {
                        channel.verifyOwnerFiles();
                        requireValue(channel.read('client-clear-verified')?.requestID === active.requestID, 'Clear binding changed.');
                        channel.publish('logout-released', { requestID: active.requestID, httpStatus: 204, upstreamHttpStatus: 204,
                            serverLogoutCompleted: true, responseForwarded: true, heldUntilClientClearVerified: true,
                            clientDisconnectedBeforeRelease: false });
                        // Node finish means handed to the OS, not received/processed by the app.
                        state = 'released'; clearTimeout(timer);
                    } catch { abort('binding-mismatch'); }
                });
                active.response.writeHead(204, active.headers);
                active.response.end();
            }
            if (finished && state === 'released') clearInterval(ticker);
        } catch { abort('binding-mismatch'); }
    };
    return {
        start() {
            ticker = setInterval(poll, 10); ticker.unref(); poll();
        },
        select(req, response) {
            poll();
            if (state !== 'armed' || req.method !== METHOD || req.url !== LOGOUT_PATH
                || req.headers['x-mediflow-paired-client-id'] !== client.id
                || req.headers['x-mediflow-paired-client-token'] !== client.token) return null;
            state = 'upstream';
            active = { response, requestID: randomUUID(), deadline: performance.now() + timeout, disconnected: false };
            timer = setTimeout(() => abort('hold-deadline'), timeout); timer.unref();
            response.once('close', () => {
                if (['released', 'aborted'].includes(state)) return;
                active.disconnected = true; abort('client-disconnected');
            });
            response.once('error', () => abort('client-disconnected'));
            return {
                attach(request) { active.upstream = request; },
                failed() { abort('upstream-error'); },
                accept(upstream) {
                    if (state !== 'upstream') { upstream.destroy(); return; }
                    if (upstream.statusCode !== 204) { upstream.destroy(); abort('upstream-status'); return; }
                    upstream.once('error', () => abort('upstream-error'));
                    upstream.once('end', () => {
                        if (state !== 'upstream') return;
                        if (!upstream.complete) return abort('upstream-error');
                        active.headers = upstream.headers;
                        try {
                            channel.publish('logout-held', { requestID: active.requestID, upstreamHttpStatus: 204,
                                serverLogoutCompleted: true, responseForwarded: false });
                            state = 'held'; poll();
                        } catch { abort('binding-mismatch'); }
                    });
                    upstream.resume();
                },
            };
        },
        close() {
            if (!['released', 'aborted'].includes(state)) abort('upstream-error');
            clearInterval(ticker); clearTimeout(timer);
        },
    };
}

export function createResponseProxy(config) {
    requireValue(config && Object.keys(config).every((key) => ['descriptorPath', 'certPath', 'keyPath', 'target',
        'barrierDirectory', 'runId', 'client', 'holdTimeoutMs'].includes(key)), 'Invalid fixture proxy configuration.');
    const descriptor = validateDescriptor(parseJSON(regularBytes(config.descriptorPath)));
    const origin = new URL(descriptor.host.httpsURL);
    const bindHost = origin.hostname.replace(/^\[|\]$/gu, '');
    const target = new URL(config.target);
    requireValue(target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname)
        && target.port && target.port !== '0' && !target.username && !target.password
        && target.pathname === '/' && !target.search && !target.hash, 'An explicit loopback HTTP origin is required.');
    const cert = regularBytes(config.certPath, { privateFile: false, limit: 65_536 });
    const declaredCert = regularBytes(descriptor.host.publicCertificatePath, { privateFile: false, limit: 65_536 });
    const certificate = new X509Certificate(cert);
    const declared = new X509Certificate(declaredCert);
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    requireValue(hash(certificate.raw) === descriptor.host.tlsPinSHA256 && hash(declared.raw) === descriptor.host.tlsPinSHA256
        && certificate.checkIP(bindHost), 'Certificate pin/SAN does not match the synthetic descriptor.');
    const key = regularBytes(config.keyPath, { limit: 65_536 });
    const wantsHold = ['barrierDirectory', 'runId', 'client', 'holdTimeoutMs'].some((key) => config[key] !== undefined);
    requireValue(!wantsHold || (typeof config.barrierDirectory === 'string' && typeof config.runId === 'string'
        && ['ios', 'ipados'].includes(config.client)), 'A complete explicit barrier binding is required.');
    let barrier;
    // Dedicated direct agent: environment/global proxy settings cannot reroute
    // the explicitly loopback upstream. No authority headers are introduced.
    const forwardAgent = new http.Agent({ keepAlive: true });
    const handler = (req, res) => {
        const held = barrier?.select(req, res);
        if (req.headers.expect?.toLowerCase() === '100-continue' && !held) res.writeContinue();
        // Same authority/forwarding contract as local-api-tls-proxy.mjs.
        const port = server.address().port;
        const headers = { ...req.headers, 'x-forwarded-proto': 'https',
            'x-forwarded-host': req.headers.host || `${bindHost}:${port}`, 'x-forwarded-port': String(port),
            'x-mediflow-tls-proxy': 'local-api' };
        if (req.socket.remoteAddress) headers['x-forwarded-for'] = req.socket.remoteAddress;
        const request = http.request({ hostname: target.hostname.replace(/^\[|\]$/gu, ''), port: target.port,
            path: req.url, method: req.method, headers, agent: forwardAgent }, (upstream) => {
            if (held) held.accept(upstream);
            else {
                upstream.on('error', () => res.destroy());
                res.writeHead(upstream.statusCode || 500, upstream.headers); upstream.pipe(res);
            }
        });
        held?.attach(request);
        request.on('error', () => {
            if (held) held.failed();
            else if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end('Bad Gateway'); }
        });
        req.on('aborted', () => request.destroy());
        res.on('close', () => { if (!res.writableFinished) request.destroy(); });
        req.pipe(request);
    };
    const server = https.createServer({ cert, key }, handler);
    server.on('checkContinue', handler); // No automatic 100 response on the selected hold.
    if (wantsHold) barrier = createBarrier(config, descriptor.fixtureId, descriptor.clients[config.client],
        (reason) => server.emit('barrier-aborted', reason));
    server.once('listening', () => barrier?.start());
    return {
        server,
        async listen() {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(Number(origin.port || 443), bindHost, () => { server.off('error', reject); resolve(); });
            });
            const actual = new URL(origin); actual.port = String(server.address().port);
            return actual.origin;
        },
        async close() {
            barrier?.close(); server.closeAllConnections(); forwardAgent.destroy();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

async function main() {
    const { values } = parseArgs({ strict: true, options: Object.fromEntries([
        'descriptor', 'cert', 'key', 'target', 'barrier-directory', 'run-id', 'client', 'hold-timeout-ms',
    ].map((name) => [name, { type: 'string' }])) });
    const proxy = createResponseProxy({ descriptorPath: values.descriptor, certPath: values.cert, keyPath: values.key,
        target: values.target, ...(values['barrier-directory'] !== undefined || values['run-id'] !== undefined || values.client !== undefined
            || values['hold-timeout-ms'] !== undefined ? { barrierDirectory: values['barrier-directory'], runId: values['run-id'],
                client: values.client, ...(values['hold-timeout-ms'] !== undefined ? { holdTimeoutMs: Number(values['hold-timeout-ms']) } : {}) } : {}) });
    proxy.server.on('barrier-aborted', (reason) => console.error(`Synthetic logout barrier invalidated: ${reason}.`));
    process.once('SIGINT', () => { void proxy.close(); });
    process.once('SIGTERM', () => { void proxy.close(); });
    await proxy.listen();
    console.log('Synthetic TLS response proxy listening; no runtime authority changed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch(() => { console.error('Synthetic response proxy configuration/start failed.'); process.exitCode = 1; });
}
