/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AIP_BOOTSTRAP_BIND_MAX_FRAME_BYTES_V1,
  AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
} from '../../packages/aip/src/child-ipc-contract.ts';
import { createAipAuthenticatedOperationRpcChildEnvironmentV1 } from '../../packages/aip/src/operation-rpc.ts';
import { createLateBoundMcpChildPortV1 } from './authenticated-headless-agent-pre-spawned-mcp-child.ts';

function record<Value extends object>(value: Value): Readonly<Value> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<Value>;
}

function fixture() {
  const listeners = new Set<(frame: unknown) => void>();
  const closeListeners = new Set<() => void>();
  const published: string[] = [];
  let terminated = 0;
  const port = record({
    connection: record({}),
    subscribe(listener: (frame: unknown) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(frame: string) {
      published.push(frame);
      for (const listener of listeners) listener('synthetic-bootstrap-request');
    },
    onClose(listener: () => void) {
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
    terminate() { terminated += 1; },
  });
  return { port, listeners, closeListeners, published, terminated: () => terminated };
}

test('late-bound MCP port subscribes before one canonical bind publication', () => {
  const state = fixture();
  const bootstrapRef = `aipb_${'a'.repeat(32)}`;
  const environment = createAipAuthenticatedOperationRpcChildEnvironmentV1(bootstrapRef);
  const port = createLateBoundMcpChildPortV1(state.port, environment);
  const received: unknown[] = [];

  const unsubscribeBootstrap = port.subscribe((frame) => { received.push(frame); });

  assert.deepEqual(received, ['synthetic-bootstrap-request']);
  assert.equal(state.published.length, 1);
  assert.ok(Buffer.byteLength(state.published[0]!, 'utf8') <= AIP_BOOTSTRAP_BIND_MAX_FRAME_BYTES_V1);
  assert.deepEqual(JSON.parse(state.published[0]!), {
    schemaVersion: 'mediflow.aip.bootstrap.bind.v1', operation: 'bind', bootstrapRef,
  });

  const unsubscribeRpc = port.subscribe(() => undefined);
  assert.equal(state.published.length, 1);
  assert.equal(state.listeners.size, 2);
  unsubscribeBootstrap();
  unsubscribeRpc();
  assert.equal(state.listeners.size, 0);
});

test('late-bound MCP port preserves connection and synchronous lifecycle', () => {
  const state = fixture();
  const environment = createAipAuthenticatedOperationRpcChildEnvironmentV1(`aipb_${'b'.repeat(32)}`);
  const port = createLateBoundMcpChildPortV1(state.port, environment);
  const close = () => undefined;

  const unsubscribe = port.onClose(close);
  assert.equal(port.connection, state.port.connection);
  assert.equal(state.closeListeners.has(close), true);
  unsubscribe();
  port.terminate();
  assert.equal(state.closeListeners.size, 0);
  assert.equal(state.terminated(), 1);
});

test('late-bound MCP port rejects non-canonical environments and ports', () => {
  const state = fixture();
  const bootstrapRef = `aipb_${'c'.repeat(32)}`;
  const valid = createAipAuthenticatedOperationRpcChildEnvironmentV1(bootstrapRef);
  const mutable = { ...valid };
  const wrongMode = record({
    MEDIFLOW_AIP_BOOTSTRAP_REF: bootstrapRef,
    MEDIFLOW_AIP_OPERATION_RPC: AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
  });
  const promisedPort = Promise.resolve(state.port);
  const accessorPort = Object.freeze(Object.defineProperty({ ...state.port }, 'publish', {
    enumerable: true, get: () => state.port.publish,
  }));

  assert.throws(() => createLateBoundMcpChildPortV1(state.port, mutable), /child_unavailable/u);
  assert.throws(() => createLateBoundMcpChildPortV1(state.port, wrongMode), /child_unavailable/u);
  assert.throws(() => createLateBoundMcpChildPortV1(promisedPort, valid), /child_unavailable/u);
  assert.throws(() => createLateBoundMcpChildPortV1(accessorPort, valid), /child_unavailable/u);
});

test('late-bound MCP port terminates when the bind publication is not synchronous void', () => {
  const state = fixture();
  const environment = createAipAuthenticatedOperationRpcChildEnvironmentV1(`aipb_${'d'.repeat(32)}`);
  const badPort = record({ ...state.port, publish: () => Promise.resolve() });
  const port = createLateBoundMcpChildPortV1(badPort, environment);

  assert.throws(() => port.subscribe(() => undefined), /child_unavailable/u);
  assert.equal(state.listeners.size, 0);
  assert.equal(state.terminated(), 1);
});

test('late-bound MCP port observes every rejected lifecycle Promise before denial', async () => {
  const environment = createAipAuthenticatedOperationRpcChildEnvironmentV1(`aipb_${'e'.repeat(32)}`);
  const cases = [
    { method: 'subscribe', invoke: (port: ReturnType<typeof createLateBoundMcpChildPortV1>) =>
      port.subscribe(() => undefined) },
    { method: 'publish', invoke: (port: ReturnType<typeof createLateBoundMcpChildPortV1>) =>
      port.subscribe(() => undefined) },
    { method: 'onClose', invoke: (port: ReturnType<typeof createLateBoundMcpChildPortV1>) =>
      port.onClose(() => undefined) },
    { method: 'unsubscribe', invoke: (port: ReturnType<typeof createLateBoundMcpChildPortV1>) => {
      const unsubscribe = port.subscribe(() => undefined); unsubscribe();
    } },
    { method: 'terminate', invoke: (port: ReturnType<typeof createLateBoundMcpChildPortV1>) => port.terminate() },
  ] as const;
  for (const candidate of cases) {
    const state = fixture();
    const rejected = () => Promise.reject(new Error(`synthetic rejected ${candidate.method}`));
    const overrides = candidate.method === 'unsubscribe'
      ? { subscribe: () => () => rejected() }
      : { [candidate.method]: rejected };
    const child = record({ ...state.port, ...overrides });
    const port = createLateBoundMcpChildPortV1(child, environment);
    assert.throws(() => candidate.invoke(port), /child_unavailable/u, candidate.method);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
});
