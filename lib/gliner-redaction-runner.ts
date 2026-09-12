/* @Codex */
import 'server-only';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { RedactionEntityType } from './redaction-contracts';

export const GLINER_REDACTION_REVISION = 'c153999da5f4c509df4322b0c6a1baf3d2c284d7';
export type NeuralRedactionSpan = Readonly<{ type: RedactionEntityType; start: number; end: number; text: string; confidence: number }>;
const LABELS: Readonly<Record<string, RedactionEntityType>> = Object.freeze({ person: 'person', full_name: 'person', date_of_birth: 'date', sensitive_date: 'date', document_date: 'date', email: 'email', phone_number: 'phone', address: 'address', street_address: 'address', city: 'address', state_or_region: 'address', postal_code: 'address', tax_id: 'tax_id', government_id: 'identifier', national_id_number: 'identifier', sensitive_account_id: 'identifier' });
const failure = () => new Error('local_redaction_unavailable');

/** Decode exact Python code-point spans into the canonical UTF-16 contract. */
export function decodeGlinerEntities(text: string, input: unknown): readonly NeuralRedactionSpan[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure();
    const offsets = [0];
    for (const point of text) offsets.push(offsets[offsets.length - 1] + point.length);
    const spans: NeuralRedactionSpan[] = [];
    for (const [label, entries] of Object.entries(input)) {
        if (!Object.hasOwn(LABELS, label) || !Array.isArray(entries)) throw failure();
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw failure();
            const { start, end, confidence, text: value } = entry;
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= offsets.length
                || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
                || typeof value !== 'string' || text.slice(offsets[start], offsets[end]) !== value || spans.length >= 512) throw failure();
            spans.push(Object.freeze({ type: LABELS[label], start: offsets[start], end: offsets[end], text: value, confidence }));
        }
    }
    return Object.freeze(spans);
}

/** Host-only local installation paths. This runner never grants remote admission. */
export function createGlinerRedactionRunner(config: Readonly<{ pythonExecutable: string; workerPath: string; modelDirectory: string }>) {
    const { pythonExecutable, workerPath, modelDirectory } = config;
    for (const value of [pythonExecutable, workerPath, modelDirectory]) if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw failure();
    if (process.platform !== 'darwin') throw failure();
    let child: ChildProcessWithoutNullStreams | undefined;
    let closed = false;
    let ready = false;
    let busy = false;
    let sequence = 0;
    let buffer = Buffer.alloc(0);
    let pending: { resolve(value: unknown): void; reject(reason: Error): void } | undefined;
    let exit: Promise<void> = Promise.resolve();
    let closing: Promise<void> | undefined;

    function close(): Promise<void> {
        if (closing) return closing;
        closed = true;
        pending?.reject(failure()); pending = undefined;
        buffer = Buffer.alloc(0);
        const processToClose = child;
        processToClose?.stdin.destroy();
        processToClose?.kill('SIGTERM');
        closing = (async () => {
            const kill = setTimeout(() => processToClose?.kill('SIGKILL'), 500);
            try { await exit; } finally { clearTimeout(kill); child = undefined; }
        })();
        return closing;
    }
    function receive(value: unknown) {
        if (!pending) { void close(); return; }
        const waiter = pending; pending = undefined;
        waiter.resolve(value);
    }
    async function exchange(start: () => void, signal?: AbortSignal): Promise<unknown> {
        if (closed || signal?.aborted) throw failure();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancel = () => { void close(); };
        try {
            return await new Promise((resolve, reject) => {
                pending = { resolve, reject };
                timer = setTimeout(cancel, 120_000);
                signal?.addEventListener('abort', cancel, { once: true });
                start();
            });
        } catch { await close(); throw failure(); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    function startWorker() {
        const spawned = spawn('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', pythonExecutable, '-I', '-B', workerPath, modelDirectory], {
            env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        child = spawned;
        exit = new Promise(resolve => spawned.once('close', () => { resolve(); void close(); }));
        spawned.on('error', () => { void close(); });
        spawned.stdin.on('error', () => { void close(); });
        spawned.stderr.resume(); // Never retain diagnostics containing source content.
        spawned.stdout.on('data', (chunk: Buffer) => {
            if (closed) return;
            if (buffer.length + chunk.length > 262_144) { void close(); return; }
            buffer = Buffer.concat([buffer, chunk]);
            const newline = buffer.indexOf(10);
            if (newline < 0) return;
            const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
            if (buffer.length !== 0) { void close(); return; }
            try { receive(JSON.parse(line.toString('utf8'))); } catch { void close(); }
        });
    }
    return Object.freeze({
        async extract(text: string, signal?: AbortSignal): Promise<readonly NeuralRedactionSpan[]> {
            if (closed || busy || typeof text !== 'string' || !text || text.length > 12_000 || !text.isWellFormed()) throw failure();
            busy = true;
            try {
                if (!ready) {
                    const greeting = await exchange(startWorker, signal) as Record<string, unknown>;
                    if (!greeting || Object.keys(greeting).length !== 1 || greeting.ready !== GLINER_REDACTION_REVISION) throw failure();
                    ready = true;
                }
                const id = ++sequence;
                const result = await exchange(() => child!.stdin.write(JSON.stringify({ id, text }) + '\n'), signal) as Record<string, unknown>;
                if (closed || !result || Object.keys(result).length !== 2 || result.id !== id || !Object.hasOwn(result, 'entities')) throw failure();
                return decodeGlinerEntities(text, result.entities);
            } catch { await close(); throw failure(); }
            finally { busy = false; }
        },
        close,
    });
}
