/* @Codex */
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { ICD11_WHO_BINDING, Icd11WhoServiceError } from './icd11-who-service.ts';
import type { WhoLocalTransport } from './icd11-who-local-runtime.ts';

const SEARCH_PATH = '/icd/release/11/2026-01/mms/search';
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Factory is host-internal. No endpoint or request implementation comes from a Web caller. */
export function createIcd11WhoLocalNodeTransport(requestImpl: typeof http.request = http.request): WhoLocalTransport {
    return async (query, signal) => {
        if (typeof query !== 'string' || !query || query !== query.trim().replace(/\s+/gu, ' ')
            || Buffer.byteLength(query) > ICD11_WHO_BINDING.queryMaxBytes
            || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(query)
            || !(signal instanceof AbortSignal)) throw new Icd11WhoServiceError('input_invalid');
        if (signal.aborted) throw new Icd11WhoServiceError('request_cancelled');
        const parameters = new URLSearchParams({ q: query, flatResults: 'true', highlightingEnabled: 'false',
            medicalCodingMode: 'true', includeKeywordResult: 'false' });
        return new Promise((resolve, reject) => {
            let settled = false;
            let request: http.ClientRequest | undefined;
            const chunks: Buffer[] = [];
            let bytes = 0;
            const fail = (code: 'upstream_unavailable' | 'response_invalid' | 'request_cancelled') => {
                if (settled) return;
                settled = true; chunks.length = 0; signal.removeEventListener('abort', abort);
                request?.destroy(); reject(new Icd11WhoServiceError(code));
            };
            const abort = () => fail('request_cancelled');
            try {
                request = requestImpl({
                    protocol: 'http:', hostname: '127.0.0.1', port: 8382,
                    path: `${SEARCH_PATH}?${parameters}`, method: 'GET', agent: false, signal,
                    headers: { 'API-Version': 'v2', Accept: 'application/json', 'Accept-Language': 'en' },
                }, response => {
                    // No redirect following, token request, DNS target or remote recovery branch.
                    if (response.statusCode !== 200) { response.destroy(); fail('upstream_unavailable'); return; }
                    response.on('data', (chunk: unknown) => {
                        if (settled) return;
                        if (!Buffer.isBuffer(chunk) || bytes + chunk.byteLength > ICD11_WHO_BINDING.maxResponseBytes) {
                            response.destroy(); fail('response_invalid'); return;
                        }
                        bytes += chunk.byteLength; chunks.push(chunk);
                    });
                    response.once('error', () => fail(signal.aborted ? 'request_cancelled' : 'upstream_unavailable'));
                    response.once('aborted', () => fail('upstream_unavailable'));
                    response.once('end', () => {
                        if (settled) return;
                        let body: string;
                        try { body = decoder.decode(Buffer.concat(chunks, bytes)); }
                        catch { fail('response_invalid'); return; }
                        settled = true; chunks.length = 0; signal.removeEventListener('abort', abort);
                        resolve(Object.freeze({ status: 200, body }));
                    });
                });
                request.once('error', () => fail(signal.aborted ? 'request_cancelled' : 'upstream_unavailable'));
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
                if (!settled) request.end();
            } catch { fail('upstream_unavailable'); }
        });
    };
}
