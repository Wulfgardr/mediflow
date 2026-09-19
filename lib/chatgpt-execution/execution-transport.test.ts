/* @Codex */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { once } from 'node:events';
import type { ExecutionCode, ExecutionMethod } from './execution-contract';

// No application import may run before the absolute synthetic directory exists.
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createStdioExecutionTransport, reportExecutionDiagnostic } = await import('./execution-transport.ts');
const { ExecutionError } = await import('./execution-contract.ts');

// A standalone Node fake using only stdlib; no shell, clinical data, credential or network.
const fakeServer = String.raw`
import readline from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
setInterval(() => {}, 1000);
readline.createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (!Object.hasOwn(request, 'id')) return;
    const mode = request.params?.mode;
    if (mode === 'server-request') return send({ id: 999, method: request.params.method, params: { synthetic: true } });
    if (mode === 'deltas') {
        send({ method: 'item/reasoning/textDelta', params: { delta: 'PRIVATE_REASONING_SENTINEL' } });
        send({ method: 'item/reasoning/summaryTextDelta', params: { delta: 'PRIVATE_REASONING_SENTINEL' } });
        send({ method: 'item/agentMessage/delta', params: { delta: 'partial output' } });
        send({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'plus' } });
        return send({ id: request.id, result: { ok: true } });
    }
    if (mode === 'oversized') return process.stdout.write('x'.repeat(512) + (request.params.newline ? '\n' : ''));
    if (mode === 'hang') return;
    if (mode === 'malformed-error') return send({ id: request.id, error: 'PRIVATE_PROVIDER_SENTINEL' });
    if (mode === 'diagnostic') return send({ id: request.id, error: { code: -32603, message: 'PRIVATE_PROVIDER_SENTINEL https://auth.openai.com/private?token=PRIVATE_PROVIDER_SENTINEL 503 TLS certificate network device experimental permission denied' } });
    if (mode === 'error') {
        process.stderr.write('PRIVATE_PROVIDER_SENTINEL\n');
        return send({ id: request.id, error: { code: -32000, message: 'PRIVATE_PROVIDER_SENTINEL', data: { token: 'PRIVATE_PROVIDER_SENTINEL' } } });
    }
    if (mode === 'malformed') return process.stdout.write('PRIVATE_PROVIDER_SENTINEL invalid-json\n');
    if (mode === 'ignore-term') process.on('SIGTERM', () => {});
    if (mode === 'exit') return process.exit(7);
    send({ id: request.id, result: { ok: true } });
});
`;
const codeIs = (code: ExecutionCode) => (error: unknown) => error instanceof ExecutionError && error.code === code && error.message === code && !JSON.stringify(error).includes('PRIVATE_');
type TransportOptions = NonNullable<Parameters<typeof createStdioExecutionTransport>[1]>;
function fixture(t: TestContext, options: TransportOptions = {}) {
    const directory = mkdtempSync(join(dataDir!, 'transport-fake-'));
    const child = spawn(process.execPath, ['--input-type=module', '-e', fakeServer], {
        cwd: directory, env: { HOME: directory, CODEX_HOME: directory, MEDIFLOW_DATA_DIR: directory, NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let cleanupCount = 0;
    const transport = createStdioExecutionTransport(child, { requestTimeoutMs: 1500, killGraceMs: 100,
        // This controlled fake server never forks; its exit is the entire fake group.
        waitForOwnedGroupExit: async () => child.exitCode !== null || child.signalCode !== null, ...options,
        onClosed: async () => {
            assert.ok(child.exitCode !== null || child.signalCode !== null, 'Cleanup requires exit evidence');
            cleanupCount++;
            await options.onClosed?.();
        },
    });
    const failures: ExecutionCode[] = [];
    const notifications: { method: string; params: unknown }[] = [];
    transport.subscribe((method, params) => notifications.push({ method, params }), code => failures.push(code));
    t.after(async () => {
        await transport.close();
        if (child.exitCode === null && child.signalCode === null) {
            const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
        }
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        rmSync(directory, { recursive: true, force: true });
    });
    return { child, transport, failures, notifications, cleanupCount: () => cleanupCount };
}

for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/call', 'account/chatgptAuthTokens/refresh']) test(`server request ${method} is denied and closes the process`, async t => {
    const { child, transport, failures, notifications, cleanupCount } = fixture(t);
    await assert.rejects(transport.request('account/read', { mode: 'server-request', method }), codeIs('tool_use_denied'));
    assert.equal(await transport.close(), true);
    assert.deepEqual(failures, ['tool_use_denied']); assert.deepEqual(notifications, []);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.equal(cleanupCount(), 1);
});

test('reasoning and partial output deltas are not forwarded', async t => {
    const { transport, notifications } = fixture(t);
    assert.deepEqual(await transport.request('account/read', { mode: 'deltas' }), { ok: true });
    assert.deepEqual(notifications, [{ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'plus' } }]);
    assert.ok(!JSON.stringify(notifications).includes('PRIVATE_REASONING_SENTINEL'));
});

for (const newline of [true, false]) test(`oversized ${newline ? 'complete' : 'partial'} frame fails closed`, async t => {
    const { transport, failures } = fixture(t, { maxFrameBytes: 128 });
    await assert.rejects(transport.request('account/read', { mode: 'oversized', newline }), codeIs('protocol_error'));
    assert.equal(await transport.close(), true); assert.deepEqual(failures, ['protocol_error']);
});

test('request timeout rejects pending work and terminates without retry', async t => {
    const { transport, failures, cleanupCount } = fixture(t, { requestTimeoutMs: 300 });
    await assert.rejects(transport.request('account/read', { mode: 'hang' }), codeIs('timeout'));
    assert.equal(await transport.close(), true); assert.deepEqual(failures, ['timeout']); assert.equal(cleanupCount(), 1);
    await assert.rejects(transport.request('account/read'), codeIs('process_exited'));
});

test('close is idempotent and rejects pending requests before cleanup', async t => {
    const { transport, cleanupCount } = fixture(t);
    await transport.request('initialize');
    const pending = transport.request('account/read', { mode: 'hang' });
    const rejected = assert.rejects(pending, codeIs('process_exited'));
    const first = transport.close(); const second = transport.close(); assert.equal(first, second);
    assert.equal(await first, true); await rejected; assert.equal(cleanupCount(), 1);
});

test('SIGTERM escalation uses the injected terminator and cleanup follows SIGKILL exit', async t => {
    const signals: NodeJS.Signals[] = [];
    const state = fixture(t, { terminate: signal => { signals.push(signal); state.child.kill(signal); } });
    await state.transport.request('initialize', { mode: 'ignore-term' });
    assert.equal(await state.transport.close(), true);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(state.child.signalCode, 'SIGKILL'); assert.equal(state.cleanupCount(), 1);
});

test('no observed exit returns false and cannot claim cleanup', async t => {
    const signals: NodeJS.Signals[] = [];
    let closingCount = 0;
    const state = fixture(t, { killGraceMs: 30, onClosing: () => { closingCount++; }, terminate: signal => { signals.push(signal); } });
    await state.transport.request('initialize');
    assert.equal(await state.transport.close(), false);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.equal(state.cleanupCount(), 0);
    assert.equal(closingCount, 1, 'Network revocation must not depend on process exit');
});

test('malformed error rejects the original pending caller without hanging', async t => {
    const { transport } = fixture(t);
    await assert.rejects(transport.request('account/read', { mode: 'malformed-error' }), codeIs('protocol_error'));
    assert.equal(await transport.close(), true);
});

test('diagnostics retain fixed categories only and cannot alter RPC failure', async t => {
    const events: unknown[] = [];
    const { transport } = fixture(t, { diagnostic: event => { events.push(event); throw new Error('PRIVATE_PROVIDER_SENTINEL'); } });
    await assert.rejects(transport.request('account/login/start', { mode: 'diagnostic' }), codeIs('upstream_error'));
    assert.deepEqual(events, [{ event: 'rpc_error', errorCode: 'upstream_error', method: 'account/login/start', rpcCode: -32603, httpStatus: 503, tls: true, network: true, device: true, experimental: true, permission: true }]);
    assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
});

test('failed cleanup returns false despite process exit', async t => {
    const state = fixture(t, { onClosed: async () => { throw new Error('PRIVATE_PROVIDER_SENTINEL'); } });
    await state.transport.request('initialize');
    assert.equal(await state.transport.close(), false);
    assert.equal(state.cleanupCount(), 1);
});

test('provider error and stderr never leak raw details', async t => {
    const { transport, notifications, failures } = fixture(t);
    await assert.rejects(transport.request('account/read', { mode: 'error' }), codeIs('upstream_error'));
    assert.deepEqual(notifications, []); assert.deepEqual(failures, []);
});

test('invalid JSON never leaks frame contents', async t => {
    const { transport, failures } = fixture(t);
    await assert.rejects(transport.request('account/read', { mode: 'malformed' }), codeIs('protocol_error'));
    assert.equal(await transport.close(), true); assert.deepEqual(failures, ['protocol_error']);
});

test('spontaneous child exit rejects pending requests and runs cleanup', async t => {
    const state = fixture(t);
    await assert.rejects(state.transport.request('account/read', { mode: 'exit' }), codeIs('process_exited'));
    assert.equal(await state.transport.close(), true); assert.equal(state.child.exitCode, 7); assert.equal(state.cleanupCount(), 1);
});

test('unallowlisted method is rejected locally', async t => {
    const { transport } = fixture(t);
    await assert.rejects(transport.request('turn/steer' as ExecutionMethod), codeIs('invalid_request'));
    assert.deepEqual(await transport.request('initialize'), { ok: true });
});

/* @Codex: in-memory ChildProcess double; these cases spawn/probe no OS processes. */
function groupFixture(options: TransportOptions = {}, leaderAlreadyExited = false) {
    const emitter = new EventEmitter();
    const rawChild = Object.assign(emitter, { pid: 4242, exitCode: leaderAlreadyExited ? 0 : null as number | null,
        signalCode: null as NodeJS.Signals | null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill(signal: NodeJS.Signals) { this.signalCode = signal; emitter.emit('exit', null, signal); return true; },
    });
    const child = rawChild as unknown as ChildProcessWithoutNullStreams;
    const signals: NodeJS.Signals[] = [];
    let cleanup = 0;
    let networkRevoked = false;
    const transport = createStdioExecutionTransport(child, { killGraceMs: 5, groupDrainMs: 20, ...options,
        onClosing() { networkRevoked = true; options.onClosing?.(); },
        terminate(signal) { signals.push(signal); child.kill(signal); },
        async onClosed() { cleanup++; await options.onClosed?.(); },
    });
    return { child, transport, signals, exitLeader() { rawChild.exitCode = 0; emitter.emit('exit', 0, null); }, cleanup: () => cleanup, networkRevoked: () => networkRevoked };
}

test('owned-group: exited leader still requires group evidence before cleanup', async () => {
    let resolveGroup!: (value: boolean) => void;
    const group = new Promise<boolean>(resolve => { resolveGroup = resolve; });
    const f = groupFixture({ waitForOwnedGroupExit: () => group }, true);
    const closed = f.transport.close();
    assert.equal(f.networkRevoked(), true); assert.equal(f.cleanup(), 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.cleanup(), 0); assert.deepEqual(f.signals, []);
    resolveGroup(true);
    assert.equal(await closed, true); assert.equal(f.cleanup(), 1);
});

test('owned-group: leader termination never substitutes for group drain', async () => {
    const f = groupFixture({ waitForOwnedGroupExit: async () => false });
    assert.equal(await f.transport.close(), false);
    assert.equal(f.networkRevoked(), true); assert.deepEqual(f.signals, ['SIGTERM']);
    assert.equal(f.cleanup(), 0);
});

for (const mode of ['missing', 'false', 'throw', 'hang', 'late'] as const) test(`owned-group: ${mode} evidence cannot confirm cleanup`, async () => {
    let resolveLate: ((result: boolean) => void) | undefined;
    const waitForOwnedGroupExit = mode === 'missing' ? undefined : mode === 'false' ? async () => false
        : mode === 'throw' ? async () => { throw new Error('private detail'); }
            : () => new Promise<boolean>(resolve => { resolveLate = resolve; });
    const f = groupFixture({ waitForOwnedGroupExit }, true);
    const started = performance.now();
    assert.equal(await f.transport.close(), false);
    assert.ok(performance.now() - started < 500);
    if (mode === 'late') { resolveLate!(true); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(f.networkRevoked(), true); assert.equal(f.cleanup(), 0); assert.deepEqual(f.signals, []);
    assert.equal(await f.transport.close(), false);
});

test('owned-group: spontaneous leader exit still drains before cleanup', async () => {
    let observed = 0;
    const f = groupFixture({ waitForOwnedGroupExit: async () => { observed++; return true; } });
    f.exitLeader();
    assert.equal(await f.transport.close(), true);
    assert.equal(observed, 1); assert.equal(f.cleanup(), 1); assert.deepEqual(f.signals, []);
});

/* @Codex: receipt observations are evidence of this owned transport only. */
test('drain observation distinguishes pending group evidence from leader exit', async () => {
    let resolveGroup!: (value: boolean) => void;
    const group = new Promise<boolean>(resolve => { resolveGroup = resolve; });
    const f = groupFixture({ waitForOwnedGroupExit: () => group });
    assert.deepEqual(f.transport.drainObservation?.(), { closing: false, leaderExited: false, ownedGroupCeased: null });
    const closed = f.transport.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.transport.drainObservation?.(), { closing: true, leaderExited: true, ownedGroupCeased: null });
    assert.equal(f.cleanup(), 0);
    resolveGroup(true); assert.equal(await closed, true);
    assert.deepEqual(f.transport.drainObservation?.(), { closing: true, leaderExited: true, ownedGroupCeased: true });
});
test('drain observation cannot upgrade a timed-out group to confirmed from late evidence', async () => {
    let resolveGroup!: (value: boolean) => void;
    const f = groupFixture({ waitForOwnedGroupExit: () => new Promise(resolve => { resolveGroup = resolve; }) }, true);
    assert.equal(await f.transport.close(), false);
    assert.deepEqual(f.transport.drainObservation?.(), { closing: true, leaderExited: true, ownedGroupCeased: false });
    resolveGroup(true); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.transport.drainObservation?.(), { closing: true, leaderExited: true, ownedGroupCeased: false });
    assert.equal(f.cleanup(), 0);
});

/* @Codex — same privacy sentinels as the stdio fixtures above. */
test('diagnostic projection drops raw fields, numeric channels and accessors', () => {
    const events: unknown[] = []; let accessed = 0;
    const observe = (event: import('./execution-transport').ExecutionDiagnostic) => { events.push(event); };
    const input = { event: 'rpc_error', method: 'turn/start', errorCode: 'upstream_error', rpcCode: 123456789,
        httpStatus: 123456789, tls: 'PRIVATE_PROVIDER_SENTINEL', network: true, device: false, experimental: false, permission: false,
        message: 'PRIVATE_PROVIDER_SENTINEL', url: 'PRIVATE_PROVIDER_SENTINEL_URL',
        headers: { authorization: 'PRIVATE_PROVIDER_SENTINEL' }, prompt: 'PRIVATE_PROVIDER_SENTINEL', output: 'PRIVATE_PROVIDER_SENTINEL',
        reasoning: 'PRIVATE_REASONING_SENTINEL' };
    Object.defineProperty(input, 'tls', { enumerable: true, get() { accessed++; throw new Error('PRIVATE_PROVIDER_SENTINEL'); } });
    reportExecutionDiagnostic(observe, input as unknown as import('./execution-transport').ExecutionDiagnostic);
    assert.equal(accessed, 0);
    assert.deepEqual(events, [{ event: 'rpc_error', method: 'turn/start', errorCode: 'upstream_error', rpcCode: null,
        httpStatus: null, tls: false, network: true, device: false, experimental: false, permission: false }]);
    assert.ok(Object.isFrozen(events[0])); assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|https:|authorization|reasoning/u);
    const base = events[0] as import('./execution-transport').ExecutionDiagnostic;
    for (const field of ['method', 'event', 'errorCode'] as const) {
        reportExecutionDiagnostic(observe, { ...base, [field]: 'PRIVATE_PROVIDER_SENTINEL' });
    }
    assert.equal(events.length, 1);
    reportExecutionDiagnostic(observe, { ...base, rpcCode: -32042 as -32000, httpStatus: 599 });
    assert.deepEqual(events[1], { ...base, rpcCode: -32000, httpStatus: 599 });
});

test('transport failure stays distinct and observer rejection does not affect drain', async t => {
    const events: unknown[] = [];
    const state = fixture(t, { diagnostic: async event => { events.push(event); throw new Error('PRIVATE_REASONING_SENTINEL'); } });
    await assert.rejects(state.transport.request('account/read', { mode: 'malformed' }), codeIs('protocol_error'));
    assert.equal(await state.transport.close(), true); assert.equal(state.cleanupCount(), 1);
    assert.deepEqual(state.failures, ['protocol_error']);
    assert.deepEqual(events, [{ event: 'transport_failure', method: 'account/read', errorCode: 'protocol_error', rpcCode: null,
        httpStatus: null, tls: false, network: false, device: false, experimental: false, permission: false }]);
});
