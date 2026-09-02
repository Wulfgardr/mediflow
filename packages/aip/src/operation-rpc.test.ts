/* @Codex */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';

import {
    AIP_OPERATION_RPC_ENV_KEY_V1,
    AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1,
    AIP_OPERATION_RPC_MAX_IN_FLIGHT_V1,
    AIP_OPERATION_RPC_MAX_REQUESTS_V1,
    AIP_OPERATION_RPC_REQUEST_SCHEMA_V1,
    AipOperationRpcV1Error,
    createAipOperationRpcChildEnvironmentV1,
    createAipOperationRpcHostV1,
} from './operation-rpc.ts';

const request = (value: object): string => JSON.stringify({
    schemaVersion: AIP_OPERATION_RPC_REQUEST_SCHEMA_V1,
    ...value,
});

function memoryPort() {
    const sent: string[] = [];
    let listener: ((frame: unknown) => void) | undefined;
    return {
        adapter: {
            subscribe: (next: (frame: unknown) => void) => {
                listener = next;
                return () => { listener = undefined; };
            },
            publish: (frame: string) => { sent.push(frame); },
        },
        receive: (frame: unknown) => { listener?.(frame); },
        sent,
    };
}

const fakeDefinition = (execute: (input: unknown, signal: AbortSignal) => unknown, timeoutMs = 100) => ({
    operationId: 'fake.system.status.v1',
    capabilityId: 'fake.system.status.read.v1',
    serviceRef: 'FakeApplicationServicesSystemStatusV1',
    maximumStage: 'read_only' as const,
    timeoutMs,
    execute,
});

test('publishes only the host allowlisted catalog and binds calls to its named fake service', async () => {
    const observed: unknown[] = [];
    const host = createAipOperationRpcHostV1({
        operations: [fakeDefinition(async (input: unknown) => { observed.push(input); return { status: 'ready' }; })],
    });
    const port = memoryPort();
    host.attach(port.adapter);

    port.receive(request({ method: 'catalog', requestId: 'rpc_catalog_1' }));
    port.receive(request({
        method: 'call', requestId: 'rpc_call_1', operationId: 'fake.system.status.v1', input: { detail: false },
    }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(port.sent.map((frame) => JSON.parse(frame)), [{
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_catalog_1', outcome: 'completed',
        result: { operations: [{ operationId: 'fake.system.status.v1', capabilityId: 'fake.system.status.read.v1',
            serviceRef: 'FakeApplicationServicesSystemStatusV1', maximumStage: 'read_only' }] },
    }, {
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_call_1', outcome: 'completed',
        result: { operation: { operationId: 'fake.system.status.v1', capabilityId: 'fake.system.status.read.v1',
            serviceRef: 'FakeApplicationServicesSystemStatusV1', maximumStage: 'read_only' },
        value: { status: 'ready' } },
    }]);
    assert.equal((observed[0] as { detail: boolean }).detail, false);
    assert.equal(Object.getPrototypeOf(observed[0]), null);
    assert.equal(Object.isFrozen(observed[0]), true);
});

test('rejects caller-supplied authority, unknown operations and strict or oversized frames before service entry', async () => {
    let calls = 0;
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => { calls += 1; return null; })] });
    const port = memoryPort();
    host.attach(port.adapter);

    port.receive(request({ method: 'call', requestId: 'rpc_extra_1', operationId: 'fake.system.status.v1', input: {},
        capabilityId: 'caller.forged.v1' }));
    port.receive(request({ method: 'call', requestId: 'rpc_unknown_1', operationId: 'fake.unknown.v1', input: {} }));
    port.receive('{');
    port.receive('x'.repeat(AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1 + 1));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls, 0);
    assert.deepEqual(port.sent.map((frame) => JSON.parse(frame)), [{
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: null, outcome: 'denied',
        denialCode: 'frame_invalid',
    }, {
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_unknown_1', outcome: 'denied',
        denialCode: 'operation_not_allowed',
    }, {
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: null, outcome: 'denied',
        denialCode: 'frame_invalid',
    }, {
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: null, outcome: 'denied',
        denialCode: 'frame_invalid',
    }]);
});

test('cancel aborts one in-flight call and discards its late completion', async () => {
    let finish!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<unknown>((resolve) => { finish = resolve; });
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition((_input, currentSignal) => {
        signal = currentSignal;
        return pending;
    })] });
    const port = memoryPort();
    host.attach(port.adapter);

    port.receive(request({ method: 'call', requestId: 'rpc_slow_1', operationId: 'fake.system.status.v1', input: {} }));
    port.receive(request({ method: 'cancel', requestId: 'rpc_cancel_1', targetRequestId: 'rpc_slow_1' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(signal?.aborted, true);
    assert.deepEqual(port.sent.map((frame) => JSON.parse(frame)), [{
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_cancel_1', outcome: 'cancelled',
        targetRequestId: 'rpc_slow_1',
    }]);

    finish({ status: 'too_late' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(port.sent.length, 1);
});

test('timeout, opaque revoke and restart abort work and suppress every late result', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition((_input, signal) => {
        signals.push(signal);
        return new Promise((resolve) => { resolvers.push(resolve); });
    }, 10)] });
    const timeoutPort = memoryPort();
    const revokedPort = memoryPort();
    const restartedPort = memoryPort();
    host.attach(timeoutPort.adapter);
    const revokedHandle = host.attach(revokedPort.adapter);
    host.attach(restartedPort.adapter);
    timeoutPort.receive(request({ method: 'call', requestId: 'rpc_timeout_1',
        operationId: 'fake.system.status.v1', input: {} }));
    revokedPort.receive(request({ method: 'call', requestId: 'rpc_revoke_1',
        operationId: 'fake.system.status.v1', input: {} }));
    restartedPort.receive(request({ method: 'call', requestId: 'rpc_restart_1',
        operationId: 'fake.system.status.v1', input: {} }));

    assert.equal(host.revoke(Object.freeze(Object.create(null))), false);
    assert.equal(host.revoke(revokedHandle), true);
    host.restart();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(signals.every((signal) => signal.aborted), true);
    assert.equal(timeoutPort.sent.length, 0);
    assert.equal(revokedPort.sent.length, 0);
    assert.equal(restartedPort.sent.length, 0);
    resolvers.forEach((resolve) => resolve({ status: 'too_late' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timeoutPort.sent.length + revokedPort.sent.length + restartedPort.sent.length, 0);

    const afterRestart = memoryPort();
    host.attach(afterRestart.adapter);
    afterRestart.receive(request({ method: 'catalog', requestId: 'rpc_after_restart_1' }));
    assert.equal(afterRestart.sent.length, 1);
});

test('times out an active call but never publishes its later service value', async () => {
    let finish!: (value: unknown) => void;
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => new Promise((resolve) => {
        finish = resolve;
    }), 10)] });
    const port = memoryPort();
    host.attach(port.adapter);
    port.receive(request({ method: 'call', requestId: 'rpc_timeout_live_1',
        operationId: 'fake.system.status.v1', input: {} }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(JSON.parse(port.sent[0] ?? '{}'), {
        schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_timeout_live_1', outcome: 'denied',
        denialCode: 'timeout',
    });
    finish({ status: 'too_late' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(port.sent.length, 1);
});

test('post-fences a cooperative synchronous service that returns after its deadline', async () => {
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => {
        const finishAt = performance.now() + 15;
        while (performance.now() < finishAt) { /* bounded synthetic work */ }
        return { status: 'late' };
    }, 5)] });
    const port = memoryPort();
    host.attach(port.adapter);
    port.receive(request({ method: 'call', requestId: 'rpc_sync_late_1',
        operationId: 'fake.system.status.v1', input: {} }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.parse(port.sent[0] ?? '{}').denialCode, 'timeout');
});

test('post-fences response encoding before publishing a completed result', () => {
    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
    const moments = [0, 5, 10];
    Object.defineProperty(performance, 'now', { configurable: true, value: () => moments.shift() ?? 10 });
    try {
        const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => ({ status: 'ready' }), 10)] });
        const port = memoryPort();
        host.attach(port.adapter);
        port.receive(request({ method: 'call', requestId: 'rpc_encode_deadline_1',
            operationId: 'fake.system.status.v1', input: {} }));
        assert.deepEqual(JSON.parse(port.sent[0] ?? '{}'), {
            schemaVersion: 'mediflow.aip.operation.result.v1', requestId: 'rpc_encode_deadline_1', outcome: 'denied',
            denialCode: 'timeout',
        });
    } finally {
        if (originalNow) Object.defineProperty(performance, 'now', originalNow);
        else delete (performance as unknown as { now?: unknown }).now;
    }
});

test('bounds in-flight work and the replay ledger per opaque session', async () => {
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => new Promise(() => undefined), 1_000)] });
    const port = memoryPort();
    const handle = host.attach(port.adapter);
    for (let index = 0; index <= AIP_OPERATION_RPC_MAX_IN_FLIGHT_V1; index += 1) {
        port.receive(request({ method: 'call', requestId: `rpc_bound_${index}`,
            operationId: 'fake.system.status.v1', input: {} }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.parse(port.sent[0] ?? '{}').denialCode, 'in_flight_capacity_exceeded');
    host.revoke(handle);

    const ledgerPort = memoryPort();
    host.attach(ledgerPort.adapter);
    for (let index = 0; index < AIP_OPERATION_RPC_MAX_REQUESTS_V1; index += 1) {
        ledgerPort.receive(request({ method: 'catalog', requestId: `rpc_ledger_${index}` }));
    }
    ledgerPort.receive(request({ method: 'catalog', requestId: 'rpc_ledger_overflow' }));
    ledgerPort.receive(request({ method: 'catalog', requestId: 'rpc_ledger_0' }));
    assert.equal(JSON.parse(ledgerPort.sent.at(-2) ?? '{}').denialCode, 'request_capacity_exceeded');
    assert.equal(JSON.parse(ledgerPort.sent.at(-1) ?? '{}').denialCode, 'request_conflict');
});

test('catalog and service outputs fail closed on accessors, proxies, thenables and output overflow', async () => {
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { getterCalls += 1; return 'x'; } });
    const outputs = [hostile, new Proxy({}, {}), { then: () => undefined }, 'x'.repeat(AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1)];
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => outputs.shift())] });
    const port = memoryPort();
    host.attach(port.adapter);
    for (let index = 0; index < 4; index += 1) {
        port.receive(request({ method: 'call', requestId: `rpc_hostile_${index}`,
            operationId: 'fake.system.status.v1', input: {} }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getterCalls, 0);
    assert.deepEqual(port.sent.map((frame) => JSON.parse(frame).denialCode), [
        'service_failed', 'service_failed', 'service_failed', 'output_oversized',
    ]);

    let definitionGetterCalls = 0;
    const definition = Object.defineProperty({}, 'operationId', {
        get: () => { definitionGetterCalls += 1; return 'fake.system.status.v1'; },
    });
    assert.throws(() => createAipOperationRpcHostV1({ operations: [definition] }),
        (error: unknown) => error instanceof AipOperationRpcV1Error && error.code === 'catalog_invalid');
    assert.equal(definitionGetterCalls, 0);
    assert.throws(() => createAipOperationRpcHostV1(new Proxy({ operations: [] }, {})),
        (error: unknown) => error instanceof AipOperationRpcV1Error && error.code === 'input_invalid');
    const oversizedCatalog = Array.from({ length: 33 }, (_unused, index) => ({
        ...fakeDefinition(() => null), operationId: `fake.system.status_${index}.v1`,
    }));
    assert.throws(() => createAipOperationRpcHostV1({ operations: oversizedCatalog }),
        (error: unknown) => error instanceof AipOperationRpcV1Error && error.code === 'catalog_invalid');
});

test('fails closed and cleans the adapter when subscription reentry restarts the host', () => {
    let cleanupCalls = 0;
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition(() => { host.restart(); return null; })] });
    assert.throws(() => host.attach({
        subscribe: (listener: (frame: unknown) => void) => {
            listener(request({ method: 'call', requestId: 'rpc_reentry_1',
                operationId: 'fake.system.status.v1', input: {} }));
            return () => { cleanupCalls += 1; };
        },
        publish: () => undefined,
    }), (error: unknown) => error instanceof AipOperationRpcV1Error && error.code === 'port_invalid');
    assert.equal(cleanupCalls, 1);
});

test('uses a replacement environment and carries call, replay and cancel over inherited Node IPC', async (context) => {
    const environment = createAipOperationRpcChildEnvironmentV1(`aipb_${'1'.repeat(32)}`);
    assert.equal(Object.getPrototypeOf(environment), null);
    assert.deepEqual(Reflect.ownKeys(environment), ['MEDIFLOW_AIP_BOOTSTRAP_REF', AIP_OPERATION_RPC_ENV_KEY_V1]);
    assert.equal(environment[AIP_OPERATION_RPC_ENV_KEY_V1], 'inherited_child_ipc_v1');
    assert.equal('PATH' in environment, false);
    assert.equal('HOME' in environment, false);

    const childSource = `
        process.on('message', (message) => {
            if (message === 'ready') {
                process.send(JSON.stringify({ schemaVersion: '${AIP_OPERATION_RPC_REQUEST_SCHEMA_V1}', method: 'call',
                    requestId: 'rpc_child_1', operationId: 'fake.system.status.v1', input: { source: 'child' } }));
                return;
            }
            if (typeof message === 'string') {
                const result = JSON.parse(message);
                if (result.outcome === 'completed' && result.requestId === 'rpc_child_1') {
                    process.send(JSON.stringify({ schemaVersion: '${AIP_OPERATION_RPC_REQUEST_SCHEMA_V1}', method: 'call',
                        requestId: 'rpc_child_1', operationId: 'fake.system.status.v1', input: { source: 'replay' } }));
                } else if (result.denialCode === 'request_conflict') {
                    process.send(JSON.stringify({ schemaVersion: '${AIP_OPERATION_RPC_REQUEST_SCHEMA_V1}', method: 'call',
                        requestId: 'rpc_child_slow', operationId: 'fake.system.status.v1', input: { source: 'slow' } }));
                    process.send(JSON.stringify({ schemaVersion: '${AIP_OPERATION_RPC_REQUEST_SCHEMA_V1}', method: 'cancel',
                        requestId: 'rpc_child_cancel', targetRequestId: 'rpc_child_slow' }));
                } else if (result.outcome === 'cancelled') {
                    process.exit(result.targetRequestId === 'rpc_child_slow' ? 0 : 2);
                } else process.exit(2);
            }
        });
    `;
    const child: ChildProcess = spawn(process.execPath, ['-e', childSource], {
        env: environment as NodeJS.ProcessEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    context.after(() => { if (child.exitCode === null) child.kill(); });
    let observedSource: unknown;
    let slowSignal: AbortSignal | undefined;
    const host = createAipOperationRpcHostV1({ operations: [fakeDefinition((input, signal) => {
        observedSource = (input as { source: unknown }).source;
        if (observedSource === 'slow') { slowSignal = signal; return new Promise(() => undefined); }
        return { status: 'ready' };
    })] });
    host.attach({
        subscribe: (listener: (frame: unknown) => void) => {
            child.on('message', listener);
            return () => { child.off('message', listener); };
        },
        publish: (frame: string) => { child.send(frame); },
    });
    child.send('ready');
    const [exitCode] = await once(child, 'exit');
    assert.equal(exitCode, 0);
    assert.equal(observedSource, 'slow');
    assert.equal(slowSignal?.aborted, true);
});

test('keeps the portable runtime free of TCP, database, Web and native imports', async () => {
    const source = `${await readFile(new URL('./operation-rpc.ts', import.meta.url), 'utf8')}\n${
        await readFile(new URL('./authenticated-ipc.ts', import.meta.url), 'utf8')}`;
    assert.doesNotMatch(source, /from ['"]node:(?:net|http|https|tls)['"]/u);
    assert.doesNotMatch(source, /(?:better-sqlite3|lib\/db|web-auth|\.swift|AppKit|Foundation)/u);
});
