import crypto from 'node:crypto';
import http from 'node:http';

export const LOCAL_VOICE_LABEL = 'mediflow.local-voice.v1';
export const LOCAL_VOICE_SAMPLE_RATE = 16_000;
export const LOCAL_VOICE_MAX_REQUEST_BYTES = 1024 * 1024;
const BACKLOG_RETRY_MS = 250;
const BACKLOG_ATTEMPTS = 2_400;

/** @typedef {{ url: string, secret: string }} LocalVoiceEndpoint */
/** @typedef {'ready' | 'preparing' | 'recording' | 'paused' | 'finalizing' | 'review' | 'cancelled' | 'error'} LocalVoiceState */
/** @typedef {'model-missing' | 'model-invalid' | 'permission-denied' | 'audio-missing' | 'audio-lost' | 'engine-failed' | 'unsupported'} LocalVoiceFault */
/** @typedef {{ speaker: 'doctor' | 'patient', text: string }} LocalVoiceLine */
/** @typedef {{ start: number, end: number, original: string, replacement: string }} LocalVoiceDrugSuggestion */
/**
 * @typedef {{
 *   id: string, subject: string, mode: 'dictation' | 'visit', state: LocalVoiceState, fault: LocalVoiceFault | null,
 *   visible: 'ready' | 'recording' | 'paused' | 'stopped' | 'error', elapsedMs: number, limitReached: boolean,
 *   allowed: Array<'start' | 'pause' | 'resume' | 'stop'>, acceptedSamples: number, pendingSamples: number,
 *   live: { confirmed: string, provisional: string } | null,
 *   review: { text: string, lines: LocalVoiceLine[], drugSuggestions: LocalVoiceDrugSuggestion[] } | null,
 * }} LocalVoiceSnapshot
 */

export class LocalVoiceError extends Error {
  /** @param {string} code @param {number} [status] @param {unknown} [body] */
  constructor(code, status, body) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

/** @param {string} secret @param {string} message */
function mac(secret, message) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(message).digest('hex');
}

/** @param {string} secret @param {string} method @param {string} path @param {number} [now] @param {string} [nonce] */
export function signLocalVoiceRequest(secret, method, path, now = Date.now(), nonce = crypto.randomBytes(16).toString('hex')) {
  const timestamp = String(now);
  return { nonce, header: `${timestamp}.${nonce}.${mac(secret, `${LOCAL_VOICE_LABEL}:request:${method} ${path}:${timestamp}:${nonce}`)}` };
}

/** @param {string} secret @param {string} nonce @param {number} status */
export function localVoiceResponseProof(secret, nonce, status) {
  return mac(secret, `${LOCAL_VOICE_LABEL}:response:${nonce}:${status}`);
}

/** @param {unknown} url @param {unknown} secret @returns {LocalVoiceEndpoint | null} */
export function localVoiceEndpoint(url, secret) {
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(url)) return null;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/u.test(secret)) return null;
  return { url, secret };
}

/** @param {NodeJS.ProcessEnv} [env] */
export function localVoiceEndpointFromEnv(env = process.env) {
  return localVoiceEndpoint(env.MEDIFLOW_LOCAL_VOICE_URL, env.MEDIFLOW_LOCAL_VOICE_SECRET);
}

/**
 * Signed request to the local voice service; the reply counts only with the service proof.
 * @param {LocalVoiceEndpoint} endpoint @param {string} method @param {string} path
 * @param {Uint8Array | object | undefined} [body] @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
export function localVoiceRequest(endpoint, method, path, body, { timeoutMs = 130_000 } = {}) {
  const { port } = new URL(endpoint.url);
  const { nonce, header } = signLocalVoiceRequest(endpoint.secret, method, path);
  const payload = body === undefined ? undefined : body instanceof Uint8Array ? body : Buffer.from(JSON.stringify(body));
  if (payload && payload.byteLength > LOCAL_VOICE_MAX_REQUEST_BYTES) return Promise.reject(new LocalVoiceError('too-large'));
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: Number(port), method, path, agent: false, timeout: timeoutMs,
      headers: { 'x-mediflow-voice-auth': header, 'content-length': String(payload?.byteLength ?? 0),
        ...(payload ? { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' } : {}) } },
    response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * LOCAL_VOICE_MAX_REQUEST_BYTES) { response.destroy(); reject(new LocalVoiceError('reply-too-large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        const proof = response.headers['x-mediflow-voice-proof'];
        const expected = localVoiceResponseProof(endpoint.secret, nonce, status);
        if (typeof proof !== 'string' || proof.length !== expected.length
          || !crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(expected))) {
          reject(new LocalVoiceError('identity', status));
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status, body: text ? JSON.parse(text) : null }); }
        catch { reject(new LocalVoiceError('reply', status)); }
      });
      response.on('error', () => reject(new LocalVoiceError('unreachable')));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(new LocalVoiceError('unreachable')));
    request.end(payload);
  });
}

/** @param {{ status: number, body: any }} reply @param {number[]} ok */
function expect(reply, ok) {
  if (ok.includes(reply.status)) return reply.body;
  throw new LocalVoiceError(reply.body?.error ?? `status-${reply.status}`, reply.status, reply.body);
}

/** @param {LocalVoiceEndpoint} endpoint */
export function localVoiceClient(endpoint) {
  const call = (method, path, body) => localVoiceRequest(endpoint, method, path, body);
  const session = id => {
    if (!/^[a-f0-9]{32}$/u.test(id)) throw new LocalVoiceError('session-not-found');
    return `/v1/sessions/${id}`;
  };
  return {
    status: async () => expect(await call('GET', '/v1/status'), [200]),
    /** @param {{ mode: 'dictation' | 'visit', subject: string, vocabulary?: string[] }} options @returns {Promise<LocalVoiceSnapshot>} */
    create: async options => expect(await call('POST', '/v1/sessions', options), [201]),
    /** @returns {Promise<LocalVoiceSnapshot>} */
    get: async id => expect(await call('GET', session(id)), [200]),
    /** @param {'start' | 'pause' | 'resume' | 'stop'} command @returns {Promise<LocalVoiceSnapshot>} */
    command: async (id, command) => expect(await call('POST', `${session(id)}/commands`, { command }), [202]),
    discard: async id => { expect(await call('DELETE', session(id)), [204, 404]); },
    /** PCM s16le mono 16 kHz; on a full backlog the same bytes are retried, nothing is dropped. @param {string} id @param {Uint8Array} pcm */
    audio: async (id, pcm) => {
      for (let attempt = 0; attempt < BACKLOG_ATTEMPTS; attempt++) {
        const reply = await call('POST', `${session(id)}/audio`, pcm);
        if (reply.status !== 429) return expect(reply, [202]);
        await new Promise(resolve => setTimeout(resolve, BACKLOG_RETRY_MS));
      }
      throw new LocalVoiceError('backlog', 429);
    },
  };
}
