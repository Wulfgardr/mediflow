/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createStdioAccountTransport } from '../../lib/chatgpt-account/account-transport';
import type { AccountMethod } from '../../lib/chatgpt-account/account-protocol';

function fixture(options: { requestTimeoutMs?: number; killGraceMs?: number; maxFrameBytes?: number } = {}, stubborn = false) {
    const process = new EventEmitter() as ChildProcessWithoutNullStreams;
    const sent: Record<string, unknown>[] = [];
    const stdout = new PassThrough(); const stderr = new PassThrough();
    const stdin = new Writable({ write(chunk, _encoding, callback) { sent.push(JSON.parse(chunk.toString())); callback(); } });
    Object.assign(process, { stdin, stdout, stderr, exitCode: null, signalCode: null });
    const signals: string[] = [];
    process.kill = (signal) => {
        signals.push(String(signal));
        if (!stubborn || signal === 'SIGKILL') {
            Object.assign(process, { signalCode: signal }); process.emit('exit', null, signal);
        }
        return true;
    };
    let removed = 0;
    const transport = createStdioAccountTransport(process, { ...options, onClosed: async () => { removed++; } });
    return { process, sent, stdout, stderr, transport, signals, removed: () => removed,
        emit(value: unknown) { stdout.write(`${JSON.stringify(value)}\n`); } };
}
test('JSONL request IDs correlate split response frames and initialized is a notification', async () => {
    const f = fixture();
    const pending = f.transport.request('initialize', { clientInfo: { name: 'synthetic' } });
    assert.equal(f.sent[0].method, 'initialize'); assert.equal(f.sent[0].id, 1);
    f.stdout.write('{"id":1,"result":'); f.stdout.write('{"userAgent":"synthetic"}}\n');
    assert.deepEqual(await pending, { userAgent: 'synthetic' });
    f.transport.initialized(); assert.deepEqual(f.sent[1], { method: 'initialized' });
    assert.equal(await f.transport.close(), true); assert.equal(f.removed(), 1);
});
test('transport rejects non-account RPC before writing; no arbitrary browser command surface', async () => {
    const f = fixture();
    await assert.rejects(f.transport.request('unsupported/synthetic' as AccountMethod, {}), /invalid_state/);
    assert.equal(f.sent.length, 0); await f.transport.close();
});
test('timeout rejects pending calls, terminates process and invokes cleanup once', async () => {
    const f = fixture({ requestTimeoutMs: 10, killGraceMs: 10 });
    let error = ''; f.transport.subscribe(() => undefined, (notice) => { error = String(notice); });
    await assert.rejects(f.transport.request('account/read', {}), /timeout/);
    assert.equal(await f.transport.close(), true);
    assert.equal(error, 'timeout'); assert.deepEqual(f.signals, ['SIGTERM']); assert.equal(f.removed(), 1);
    await assert.rejects(f.transport.request('account/read', {}), /process_exited/);
});
test('TERM-resistant child receives bounded KILL; close is idempotent', async () => {
    const f = fixture({ killGraceMs: 5 }, true);
    const closing = f.transport.close(); assert.equal(f.transport.close(), closing);
    assert.equal(await closing, true); assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']); assert.equal(f.removed(), 1);
});
test('unconfirmed process exit does not delete its directory or claim successful cleanup', async () => {
    const f = fixture({ killGraceMs: 5 });
    f.process.kill = () => true;
    assert.equal(await f.transport.close(), false); assert.equal(f.removed(), 0);
});
test('malformed, oversized, unknown response, and unsolicited server request fail closed', async () => {
    for (const message of ['not-json\n', 'x'.repeat(130), '{"id":999,"result":{}}\n', '{"method":"synthetic/server-request","id":1,"params":{}}\n', '{"id":1,"result":{},"error":{}}\n']) {
        const f = fixture({ maxFrameBytes: 128 });
        const pending = f.transport.request('account/read', {});
        f.stdout.write(message);
        await assert.rejects(pending, /protocol_error/); assert.equal(await f.transport.close(), true);
    }
});
test('unexpected process exit and spawn failure reject pending requests without raw error leakage', async () => {
    for (const event of ['exit', 'error']) {
        const f = fixture(); const pending = f.transport.request('account/read', {});
        if (event === 'exit') f.process.emit('exit', 1, null);
        else f.process.emit('error', new Error('synthetic-private-detail'));
        await assert.rejects(pending, (error: Error) => error.message === 'process_exited');
        await f.transport.close(); assert.equal(f.removed(), 1);
    }
});
test('only account notifications are forwarded; stderr never enters a response', async () => {
    const f = fixture(); const notifications: string[] = [];
    f.transport.subscribe((method) => notifications.push(method), () => undefined);
    f.stderr.write('synthetic-private-detail');
    f.emit({ method: 'unrelated/event', params: {} }); f.emit({ method: 'account/login/completed', params: { success: true } });
    assert.deepEqual(notifications, ['account/login/completed']); await f.transport.close();
});
test('an error from a process with a PID is not proof of exit or directory cleanup', async () => {
    const f = fixture({ killGraceMs: 5 });
    Object.assign(f.process, { pid: 123 });
    f.process.kill = () => true;
    const pending = f.transport.request('account/read', {});
    f.process.emit('error', new Error('synthetic-signal-failure'));
    await assert.rejects(pending, /process_exited/);
    assert.equal(await f.transport.close(), false); assert.equal(f.removed(), 0);
});
