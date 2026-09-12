/* @Codex: PROPOSED, host-only bounded HTTP. No URL, credentials, image tools or global agent. */
import http from 'node:http';
import { checkCancelled } from './who-local-platform.mjs';

export const PROBE_TIMEOUT_MS = 5000;
export const PROBE_MAX_BYTES = 65536;
export const PROBE_TERMS = Object.freeze({ acquisition: 'cholera', offline_restart: 'measles', restored: 'rubella', original_recovered: 'tetanus' });
const entityUri = /^http:\/\/id\.who\.int\/icd\/release\/11\/2026-01\/mms\/[1-9][0-9]{0,19}(?:\/(?:other|unspecified))?$/u;
// @Codex: qualification-only contract: exact observed separator, no trimming or URL normalization.
// The code remains at most 32 characters; at most 16 nonempty components fit that contract.
export const PROBE_MAX_ID_COMPONENTS = 16;
export const PROBE_MAX_ID_LENGTH = 1536;
function validEntityId(value) {
    if (typeof value !== 'string' || value.length > PROBE_MAX_ID_LENGTH) return false;
    const components = value.split(' & ');
    return components.length <= PROBE_MAX_ID_COMPONENTS && components.every(component => entityUri.test(component));
}
export function probeError(code, details = {}) {
    return Object.assign(new Error(code), { code, details: { code, ...details } });
}
export function probePath(kind) {
    if (!Object.hasOwn(PROBE_TERMS, kind)) throw probeError('probe_invalid');
    const query = new URLSearchParams({ q: PROBE_TERMS[kind], flatResults: 'true', highlightingEnabled: 'false',
        medicalCodingMode: 'true', includeKeywordResult: 'false' });
    return `/icd/release/11/2026-01/mms/search?${query}`;
}
export function validateProbeBody(raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > PROBE_MAX_BYTES) throw probeError('probe_response_invalid');
    let body;
    try { body = JSON.parse(raw); } catch { throw probeError('probe_response_invalid'); }
    if (!body || !Array.isArray(body.destinationEntities) || !body.destinationEntities.length
        || body.destinationEntities.some(e => !e || typeof e.title !== 'string' || !e.title.trim() || e.title.length > 4096
            || typeof e.theCode !== 'string' || !/^[A-Z0-9][A-Z0-9.&/-]{0,31}$/u.test(e.theCode)
            || !validEntityId(e.id))) throw probeError('probe_response_invalid');
    return body.destinationEntities.length;
}
/** Private seam: callers may replace this function in tests, never via CLI/environment/Web input. */
export function readWhoProbe(port, kind, signal) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(probeError('probe_endpoint_invalid'));
    let requestPath;
    try { requestPath = probePath(kind); checkCancelled(signal); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
        // Node 24 may proxy its global agent from environment. This private agent never does.
        const agent = new http.Agent({ keepAlive: false, maxSockets: 1, proxyEnv: {} });
        let request, response, timer, settled = false, size = 0;
        const chunks = [];
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            chunks.length = 0; response?.destroy(); request?.destroy(); agent.destroy();
            if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(probeError('cancelled'));
        const fail = (code, details) => finish(probeError(code, details));
        // Absolute deadline, not an inactivity timeout: trickling bytes never extends it.
        timer = setTimeout(() => fail('probe_timeout', { timeoutMs: PROBE_TIMEOUT_MS }), PROBE_TIMEOUT_MS);
        try {
            request = http.request({ protocol: 'http:', hostname: '127.0.0.1', family: 4, port,
                method: 'GET', path: requestPath, agent, maxHeaderSize: 8192,
                headers: { 'API-Version': 'v2', Accept: 'application/json', 'Accept-Language': 'en',
                    'Accept-Encoding': 'identity', Connection: 'close' } }, incoming => {
                response = incoming;
                if (settled) { incoming.destroy(); return; }
                const status = incoming.statusCode;
                if (status >= 300 && status < 400) { fail('probe_redirect_refused', { status }); return; }
                if (status === 503) { fail('probe_service_starting', { status }); return; }
                if (status !== 200) { fail('probe_http_status', { status }); return; }
                const type = incoming.headers['content-type'];
                const length = incoming.headers['content-length'];
                if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(type)
                    || (incoming.headers['content-encoding'] !== undefined && incoming.headers['content-encoding'] !== 'identity')
                    || (length !== undefined && (!/^[0-9]+$/u.test(length) || Number(length) > PROBE_MAX_BYTES))) {
                    fail('probe_response_invalid'); return;
                }
                incoming.on('data', chunk => {
                    if (settled) return;
                    if (!Buffer.isBuffer(chunk) || size + chunk.length > PROBE_MAX_BYTES) { fail('probe_response_invalid'); return; }
                    size += chunk.length; chunks.push(chunk);
                });
                incoming.once('aborted', () => fail('probe_response_incomplete'));
                incoming.once('error', () => fail(signal?.aborted ? 'cancelled' : 'probe_response_incomplete'));
                incoming.once('end', () => {
                    if (settled) return;
                    if (!incoming.complete) { fail('probe_response_incomplete'); return; }
                    try {
                        const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
                        validateProbeBody(raw); finish(null, raw);
                    } catch { fail('probe_response_invalid'); }
                });
            });
            request.once('error', error => {
                if (signal?.aborted) { abort(); return; }
                if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') fail('probe_connect_pending', { systemCode: error.code });
                else if (error.code === 'ETIMEDOUT') fail('probe_timeout', { systemCode: error.code });
                else fail('probe_transport_failed', { systemCode: /^[A-Z0-9_]{1,48}$/u.test(error.code ?? '') ? error.code : 'UNKNOWN' });
            });
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            if (!settled) request.end();
        } catch { fail('probe_transport_failed'); }
    });
}
