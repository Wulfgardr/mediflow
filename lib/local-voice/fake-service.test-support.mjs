import crypto from 'node:crypto';
import http from 'node:http';
import { localVoiceResponseProof, signLocalVoiceRequest } from './client.mjs';

const ALLOWED = { ready: ['start'], preparing: ['stop'], recording: ['pause', 'stop'], paused: ['resume', 'stop'] };
const VISIBLE = { ready: 'ready', preparing: 'ready', recording: 'recording', paused: 'paused', finalizing: 'stopped', review: 'stopped', cancelled: 'stopped', error: 'error' };

/**
 * Synthetic stand-in for mediflow-voice (ADR 0204): same signatures and proofs, scripted transcript.
 * @param {{ secret: string, port?: number, model?: 'ready' | 'missing' | 'incomplete', lines?: Array<{ speaker: 'doctor' | 'patient', text: string }>, drugSuggestions?: Array<{ original: string, replacement: string }> }} options
 */
export async function startFakeLocalVoice({ secret, port = 0, model = 'ready', lines = [], drugSuggestions = [] }) {
    const state = { model, lines, drugSuggestions, session: null, blocks: [], requests: [], subjectOverride: null, stopFailures: 0 };
    const snapshot = () => {
        const session = state.session;
        const samples = state.blocks.reduce((total, block) => total + block.length / 2, 0);
        const text = session.mode === 'visit'
            ? state.lines.map((line) => `${line.speaker === 'doctor' ? 'Medico' : 'Paziente'}: ${line.text}`).join('\n')
            : state.lines.map((line) => line.text).join(' ');
        const shown = state.lines.slice(0, Math.min(state.lines.length, state.blocks.length)).map((line) => line.text).join(' ');
        return {
            id: session.id, subject: state.subjectOverride ?? session.subject, mode: session.mode, state: session.state, fault: session.fault,
            visible: VISIBLE[session.state], elapsedMs: Math.round(samples / 16), limitReached: false, allowed: ALLOWED[session.state] ?? [],
            acceptedSamples: samples, pendingSamples: 0,
            live: ['recording', 'paused', 'preparing'].includes(session.state) ? { confirmed: shown, provisional: '' } : null,
            review: session.state === 'review' ? {
                text,
                lines: state.lines.map((line, index) => ({ ...line, startMs: index * 1000, endMs: index * 1000 + 900 })),
                drugSuggestions: state.drugSuggestions.flatMap((item) => {
                    const start = text.indexOf(item.original);
                    return start < 0 ? [] : [{ start, end: start + item.original.length, original: item.original, replacement: item.replacement }];
                }),
            } : null,
        };
    };
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
            const [stamp, nonce] = String(request.headers['x-mediflow-voice-auth'] ?? '').split('.');
            const path = request.url ?? '';
            const reply = (status, body) => {
                response.writeHead(status, { 'content-type': 'application/json', 'x-mediflow-voice-proof': localVoiceResponseProof(secret, nonce ?? '', status) });
                response.end(body === undefined ? '' : JSON.stringify(body));
            };
            const expected = signLocalVoiceRequest(secret, request.method ?? '', path, Number(stamp), nonce).header;
            if (request.headers['x-mediflow-voice-auth'] !== expected || request.headers.origin) { response.writeHead(401); response.end(); return; }
            const body = Buffer.concat(chunks);
            state.requests.push({ method: request.method, path, bytes: body.length });
            if (request.method === 'GET' && path === '/v1/status') {
                return reply(200, { service: 'mediflow-voice', model: state.model, session: state.session ? { id: state.session.id, subject: state.subjectOverride ?? state.session.subject, mode: state.session.mode, state: state.session.state } : null });
            }
            if (request.method === 'POST' && path === '/v1/sessions') {
                if (state.model !== 'ready') return reply(503, { error: 'model-missing' });
                if (state.session && !['cancelled'].includes(state.session.state)) return reply(409, { error: 'session-active' });
                const input = JSON.parse(body.toString('utf8'));
                state.blocks = [];
                state.session = { id: crypto.randomBytes(16).toString('hex'), subject: input.subject, mode: input.mode, vocabulary: input.vocabulary, state: 'ready', fault: null };
                return reply(201, snapshot());
            }
            const match = /^\/v1\/sessions\/([a-f0-9]{32})(\/commands|\/audio)?$/u.exec(path);
            if (!match || !state.session || state.session.id !== match[1]) return reply(404, { error: 'session-not-found' });
            const session = state.session;
            if (request.method === 'GET' && !match[2]) return reply(200, snapshot());
            if (request.method === 'DELETE' && !match[2]) { state.session = null; state.blocks = []; return reply(204); }
            if (request.method === 'POST' && match[2] === '/audio') {
                if (session.state === 'paused') return reply(409, { error: 'paused' });
                if (!['preparing', 'recording'].includes(session.state)) return reply(409, { error: 'not-recording' });
                state.blocks.push(new Uint8Array(body));
                session.state = 'recording';
                return reply(202, { acceptedSamples: body.length / 2, pendingSamples: 0 });
            }
            if (request.method === 'POST' && match[2] === '/commands') {
                const { command } = JSON.parse(body.toString('utf8'));
                if (!(ALLOWED[session.state] ?? []).includes(command)) return reply(409, { error: 'not-allowed' });
                if (command === 'stop' && state.stopFailures > 0) { state.stopFailures -= 1; return reply(409, { error: 'audio-pending' }); }
                session.state = command === 'start' ? 'preparing' : command === 'pause' ? 'paused' : command === 'resume' ? 'recording' : 'review';
                return reply(202, snapshot());
            }
            return reply(404, { error: 'not-found' });
        });
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    return {
        url: `http://127.0.0.1:${address.port}`,
        state,
        samples() {
            const all = Buffer.concat(state.blocks.map((block) => Buffer.from(block)));
            return new Int16Array(all.buffer, all.byteOffset, all.byteLength / 2);
        },
        close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
    };
}
