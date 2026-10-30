import { randomBytes, timingSafeEqual } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';

const stateKey = Symbol.for('mediflow.loopback-ingress.v1');
const state = globalThis[stateKey] ??= { stamp: randomBytes(32).toString('hex'), installed: false, sessions: new Map() };
const ingressHeader = 'x-mediflow-server-loopback';
const proxyProofHeader = 'x-mediflow-proxy-loopback';

export function isLoopbackAddress(address) {
    if (typeof address !== 'string') return false;
    const ip = address.toLowerCase().replace(/^::ffff:/u, '');
    return ip === '::1' || isIP(ip) === 4 && ip.startsWith('127.');
}

function proxyKey() {
    const directory = process.env.MEDIFLOW_DATA_DIR || (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow') : path.join(os.homedir(), '.mediflow'));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'loopback-ingress.key');
    try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size !== 64 || process.platform !== 'win32'
            && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) throw new Error('Invalid loopback ingress key');
        const key = fs.readFileSync(fd, 'utf8');
        if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid loopback ingress key');
        return key;
    } finally { fs.closeSync(fd); }
}

function equal(left, right) {
    if (typeof left !== 'string') return false;
    const bytes = Buffer.from(left);
    const expected = Buffer.from(right);
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

/** Only the canonical TLS forwarder calls this with its socket peer. Caller headers never survive. */
export function proxyLoopbackHeaders(headers, peerAddress) {
    const forwarded = { ...headers };
    delete forwarded[ingressHeader];
    delete forwarded[proxyProofHeader];
    if (isLoopbackAddress(peerAddress)) forwarded[proxyProofHeader] = proxyKey();
    return forwarded;
}

/** Node emits this before dispatching IncomingMessage to Next; fail closed without this boundary. */
export function installLoopbackIngress() {
    if (state.installed) return;
    state.installed = true;
    channel('http.server.request.start').subscribe(({ request }) => {
        const headers = request.headers;
        const proxy = headers['x-mediflow-tls-proxy'];
        const proof = headers[proxyProofHeader];
        delete headers[ingressHeader];
        delete headers[proxyProofHeader];
        if (!isLoopbackAddress(request.socket.remoteAddress)) return;
        if (proxy !== undefined) {
            try { if (proxy !== 'local-api' || !equal(proof, proxyKey())) return; }
            catch { return; }
        } else if (proof !== undefined) return;
        headers[ingressHeader] = state.stamp;
    });
}

/** The stamp is minted at the Node socket boundary, never from Host or forwarded IP headers. */
export function hasAttestedLoopbackIngress(request) {
    return equal(request.headers.get(ingressHeader), state.stamp);
}

export function bindLocalClientSession(sessionId, expiresAt) {
    for (const [id, expiry] of state.sessions) if (expiry <= Date.now()) state.sessions.delete(id);
    state.sessions.set(sessionId, expiresAt);
}

export function isLocalClientSession(sessionId) {
    return state.sessions.has(sessionId);
}

export function localClientSessionIngressAllowed(request, sessionId) {
    return !state.sessions.has(sessionId) || hasAttestedLoopbackIngress(request);
}
