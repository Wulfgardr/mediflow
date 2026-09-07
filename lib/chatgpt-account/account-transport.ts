/* @Codex */
import 'server-only';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { AccountNotice } from './account-contract';
import { ACCOUNT_METHODS, AccountError, record, type AccountMethod, type AccountNotification, type AccountTransport } from './account-protocol';

type Options = { requestTimeoutMs?: number; killGraceMs?: number; maxFrameBytes?: number; onClosed?: () => Promise<void> };
export function createStdioAccountTransport(child: ChildProcessWithoutNullStreams, options: Options = {}): AccountTransport {
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: AccountError): void; timer: ReturnType<typeof setTimeout> }>();
    const listeners = new Set<{ notification: AccountNotification; failure: (notice: AccountNotice) => void }>();
    const decoder = new StringDecoder('utf8');
    const maxBytes = options.maxFrameBytes ?? 1_048_576;
    let buffer = '';
    let nextId = 1;
    let closed = false;
    let exited = child.exitCode !== null || child.signalCode !== null;
    let closePromise: Promise<boolean> | null = null;
    let resolveExit: () => void = () => undefined;
    const exit = new Promise<void>((resolve) => { resolveExit = resolve; if (exited) resolve(); });
    function rejectPending(code: Exclude<AccountNotice, null>) {
        for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new AccountError(code)); }
        pending.clear();
    }
    function fail(code: Exclude<AccountNotice, null>) {
        if (closed) return;
        rejectPending(code);
        for (const listener of listeners) listener.failure(code);
        void close();
    }
    function send(value: unknown) {
        if (closed) throw new AccountError('process_exited');
        child.stdin.write(`${JSON.stringify(value)}\n`, (error) => { if (error) fail('process_exited'); });
    }
    function frame(line: string) {
        if (Buffer.byteLength(line) > maxBytes) throw new AccountError('protocol_error');
        const message = record(JSON.parse(line));
        if (typeof message.method === 'string') {
            // No server request (including auth token refresh, approvals, tools) is supported.
            if ('id' in message) throw new AccountError('protocol_error');
            if (message.method === 'account/login/completed' || message.method === 'account/updated' || message.method === 'account/rateLimits/updated') {
                for (const listener of listeners) listener.notification(message.method, message.params);
            }
            return;
        }
        if (!Number.isSafeInteger(message.id)) throw new AccountError('protocol_error');
        const request = pending.get(message.id as number);
        if (!request || ('result' in message) === ('error' in message)) throw new AccountError('protocol_error');
        pending.delete(message.id as number); clearTimeout(request.timer);
        if ('error' in message) request.reject(new AccountError('protocol_error'));
        else request.resolve(message.result);
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
        } catch { fail('protocol_error'); }
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
    function close(): Promise<boolean> {
        if (closePromise) return closePromise;
        closed = true; rejectPending('process_exited'); listeners.clear(); buffer = '';
        closePromise = (async () => {
            child.stdin.destroy();
            if (!exited) child.kill('SIGTERM');
            if (!await waitExit(options.killGraceMs ?? 500)) {
                child.kill('SIGKILL');
                if (!await waitExit(options.killGraceMs ?? 500)) return false;
            }
            child.stdout.destroy(); child.stderr.destroy();
            try { await options.onClosed?.(); return true; } catch { return false; }
        })();
        return closePromise;
    }
    return Object.freeze({
        request(method: AccountMethod, params: unknown): Promise<unknown> {
            if (!(ACCOUNT_METHODS as readonly string[]).includes(method)) return Promise.reject(new AccountError('invalid_state'));
            if (closed) return Promise.reject(new AccountError('process_exited'));
            if (pending.size >= 2) return Promise.reject(new AccountError('busy'));
            return new Promise((resolve, reject) => {
                const id = nextId++;
                const timer = setTimeout(() => fail('timeout'), options.requestTimeoutMs ?? 15_000);
                pending.set(id, { resolve, reject, timer });
                try { send(params === undefined ? { id, method } : { id, method, params }); }
                catch { fail('process_exited'); }
            });
        },
        initialized() { send({ method: 'initialized' }); },
        subscribe(notification: AccountNotification, failure: (notice: AccountNotice) => void) {
            const listener = { notification, failure }; listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        close,
    });
}
