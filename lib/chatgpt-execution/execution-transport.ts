/* @Codex */
import 'server-only';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { EXECUTION_METHODS, ExecutionError, type ExecutionCode, type ExecutionMethod, type ExecutionTransport } from './execution-contract';

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExecutionError('protocol_error');
    return value as Record<string, unknown>;
}
type ExecutionNotification = (method: string, params: unknown) => void;

export type ExecutionDiagnostic = Readonly<{ method: ExecutionMethod; rpcCode: number | null; httpStatus: number | null;
    tls: boolean; network: boolean; device: boolean; experimental: boolean; permission: boolean }>;
type Options = { requestTimeoutMs?: number; killGraceMs?: number; maxFrameBytes?: number; onClosing?: () => void; onClosed?: () => Promise<void>;
    waitForOwnedGroupExit?: (timeoutMs: number) => Promise<boolean>; groupDrainMs?: number;
    terminate?: (signal: NodeJS.Signals) => void; diagnostic?: (event: ExecutionDiagnostic) => void };
export function createStdioExecutionTransport(child: ChildProcessWithoutNullStreams, options: Options = {}): ExecutionTransport {
    const pending = new Map<number, { method: ExecutionMethod; resolve(value: unknown): void; reject(error: ExecutionError): void; timer: ReturnType<typeof setTimeout> }>();
    const listeners = new Set<{ notification: ExecutionNotification; failure: (notice: ExecutionCode) => void }>();
    const decoder = new StringDecoder('utf8');
    const maxBytes = options.maxFrameBytes ?? 1_048_576;
    let buffer = '';
    let nextId = 1;
    let closed = false;
    let ownedGroupCeased: boolean | null = null;
    let exited = child.exitCode !== null || child.signalCode !== null;
    let closePromise: Promise<boolean> | null = null;
    let resolveExit: () => void = () => undefined;
    const terminate = options.terminate ?? ((signal: NodeJS.Signals) => { child.kill(signal); });
    const exit = new Promise<void>((resolve) => { resolveExit = resolve; if (exited) resolve(); });
    function rejectPending(code: Exclude<ExecutionCode, null>) {
        for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new ExecutionError(code)); }
        pending.clear();
    }
    function fail(code: Exclude<ExecutionCode, null>) {
        if (closed) return;
        rejectPending(code);
        for (const listener of listeners) listener.failure(code);
        void close();
    }
    function send(value: unknown) {
        if (closed) throw new ExecutionError('process_exited');
        child.stdin.write(`${JSON.stringify(value)}\n`, (error) => { if (error) fail('process_exited'); });
    }
    function frame(line: string) {
        if (Buffer.byteLength(line) > maxBytes) throw new ExecutionError('protocol_error');
        const message = record(JSON.parse(line));
        if (typeof message.method === 'string') {
            // Host never services tool, approval, attestation or externally-managed-token requests.
            if ('id' in message) throw new ExecutionError('tool_use_denied');
            if (['account/login/completed', 'account/updated', 'account/rateLimits/updated', 'thread/started', 'turn/started', 'turn/completed', 'item/started', 'item/completed', 'error'].includes(message.method)) {
                for (const listener of listeners) listener.notification(message.method, message.params);
            }
            return;
        }
        if (!Number.isSafeInteger(message.id)) throw new ExecutionError('protocol_error');
        const request = pending.get(message.id as number);
        if (!request || ('result' in message) === ('error' in message)) throw new ExecutionError('protocol_error');
        // Validate before removing the pending request so malformed error frames
        // still reject their original caller during fail-closed shutdown.
        const error = 'error' in message ? record(message.error) : undefined;
        pending.delete(message.id as number); clearTimeout(request.timer);
        if (error) {
            // Diagnostics contain fixed categories only, never upstream prose,
            // credentials, URLs, account identifiers or source contents.
            const prose = typeof error.message === 'string' ? error.message.slice(0, 4096) : '';
            const status = prose.match(/\b(4\d\d|5\d\d)\b/u);
            try { options.diagnostic?.({ method: request.method, rpcCode: Number.isSafeInteger(error.code) ? error.code as number : null,
                httpStatus: status ? Number(status[1]) : null, tls: /tls|certificate|trust/iu.test(prose),
                network: /network|connect|proxy|tunnel|sending request/iu.test(prose), device: /device/iu.test(prose),
                experimental: /experimental/iu.test(prose), permission: /permission|not permitted|access denied/iu.test(prose) }); } catch { /* Diagnostic consumers cannot alter RPC failure. */ }
            request.reject(new ExecutionError('upstream_error'));
        } else request.resolve(message.result);
    }
    child.stdout.on('data', (chunk: Buffer) => {
        if (closed) return;
        try {
            buffer += decoder.write(chunk);
            let index: number;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
                frame(line);
                if (closed) return;
            }
            if (Buffer.byteLength(buffer) > maxBytes) fail('protocol_error');
        } catch (error) { fail(error instanceof ExecutionError ? error.code : 'protocol_error'); }
    });
    child.stdout.on('end', () => { if (!closed) fail('process_exited'); });
    child.stdout.on('error', () => fail('process_exited'));
    child.stdin.on('error', () => fail('process_exited'));
    // Drain without logging, retaining, or exposing stderr (it may contain auth details).
    child.stderr.resume();
    child.stderr.on('error', () => fail('process_exited'));
    child.once('error', () => {
        // Spawn failure has no PID. Other process errors are not exit evidence.
        if (!child.pid) { exited = true; resolveExit(); }
        fail('process_exited');
    });
    child.once('exit', () => { exited = true; resolveExit(); if (!closed) fail('process_exited'); });
    async function waitExit(ms: number): Promise<boolean> {
        if (exited) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
        if (timer) clearTimeout(timer);
        return exited;
    }
    async function waitOwnedGroup(): Promise<boolean> {
        if (!options.waitForOwnedGroupExit) return false;
        const ms = options.groupDrainMs ?? 500;
        if (!Number.isFinite(ms) || ms < 1 || ms > 1000) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = performance.now() + ms;
        try {
            return await Promise.race([
                Promise.resolve().then(() => options.waitForOwnedGroupExit!(ms)).then(result => result === true && performance.now() < deadline),
                new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); }),
            ]);
        } catch { return false; }
        finally { clearTimeout(timer); }
    }
    function close(): Promise<boolean> {
        if (closePromise) return closePromise;
        closed = true; rejectPending('process_exited'); listeners.clear(); buffer = '';
        closePromise = (async () => {
            let closingSucceeded = true;
            try { options.onClosing?.(); } catch { closingSucceeded = false; }
            child.stdin.destroy();
            if (!exited) terminate('SIGTERM');
            if (!await waitExit(options.killGraceMs ?? 500)) {
                terminate('SIGKILL');
                if (!await waitExit(options.killGraceMs ?? 500)) return false;
            }
            child.stdout.destroy(); child.stderr.destroy();
            ownedGroupCeased = await waitOwnedGroup();
            if (!ownedGroupCeased) return false;
            try { await options.onClosed?.(); return closingSucceeded; } catch { return false; }
        })();
        return closePromise;
    }
    return Object.freeze({
        request(method: ExecutionMethod, params?: unknown): Promise<unknown> {
            if (!(EXECUTION_METHODS as readonly string[]).includes(method)) return Promise.reject(new ExecutionError('invalid_request'));
            if (closed) return Promise.reject(new ExecutionError('process_exited'));
            if (pending.size >= 2) return Promise.reject(new ExecutionError('busy'));
            return new Promise((resolve, reject) => {
                const id = nextId++;
                const timer = setTimeout(() => fail('timeout'), options.requestTimeoutMs ?? 15_000);
                pending.set(id, { method, resolve, reject, timer });
                try { send(params === undefined ? { id, method } : { id, method, params }); }
                catch { fail('process_exited'); }
            });
        },
        initialized() { send({ method: 'initialized' }); },
        subscribe(notification: ExecutionNotification, failure: (notice: ExecutionCode) => void) {
            const listener = { notification, failure }; listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        close,
        drainObservation: () => Object.freeze({ closing: closed, leaderExited: exited, ownedGroupCeased }),
    });
}
