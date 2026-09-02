/* @Codex */
import { z } from 'zod';
import {
  AIP_BOOTSTRAP_ENV_KEY_V1, AIP_BOOTSTRAP_REQUEST_SCHEMA_V1, AIP_BOOTSTRAP_RESULT_SCHEMA_V1,
  AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1, AIP_OPERATION_RPC_ENV_KEY_V1,
} from '../../aip/src/child-ipc-contract.ts';
import {
  HEADLESS_STATUS, OPEN_LOOPS_OPERATION_ID, OPERATION_DESCRIPTORS, RPC_REQUEST_SCHEMA, RPC_RESULT_SCHEMA,
  TERMINOLOGY_OPERATION_ID, openLoopsOutputSchema, publicCatalog, rpcOperationSchema,
  selectBoundOperations, terminologyArgumentsSchema, terminologyOutputSchema,
  type OperationDescriptor,
} from './contracts.ts';

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_REQUESTS = 256;
const REQUEST_TIMEOUT_MS = 1_000;
const requestIdSchema = z.string().regex(/^rpc_[a-z0-9][a-z0-9_-]{0,63}$/u);
const baseResultSchema = z.object({
  schemaVersion: z.literal(RPC_RESULT_SCHEMA), requestId: requestIdSchema,
  outcome: z.enum(['completed', 'denied', 'cancelled']),
}).passthrough();
type Pending = { resolve: (value: unknown) => void; reject: (error: OperationClientError) => void;
  timer: ReturnType<typeof setTimeout>; abort?: () => void };

export type OperationClientErrorCode = 'host_unbound' | 'protocol_invalid' | 'operation_denied' | 'cancelled';
export class OperationClientError extends Error {
  constructor(public readonly code: OperationClientErrorCode, public readonly denialCode?: string) {
    super(`MediFlow operation unavailable: ${code}`); this.name = 'OperationClientError';
  }
}

export function createOperationClient() {
  const channel = process;
  const bootstrapRef = channel.env[AIP_BOOTSTRAP_ENV_KEY_V1];
  const rpcMode = channel.env[AIP_OPERATION_RPC_ENV_KEY_V1];
  if (typeof channel.send !== 'function' || channel.connected !== true
      || (rpcMode !== 'inherited_child_ipc_v1' && rpcMode !== AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1)
      || typeof bootstrapRef !== 'string' || !/^aipb_[0-9a-f]{32}$/u.test(bootstrapRef)) {
    throw new OperationClientError('host_unbound');
  }
  const pending = new Map<string, Pending>();
  let sequence = 0;
  let closed = false;
  let authenticated = rpcMode === 'inherited_child_ipc_v1';
  let resolveBootstrap = (): void => undefined;
  let rejectBootstrap: (error: OperationClientError) => void = () => undefined;
  const bootstrapReady = authenticated ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    resolveBootstrap = resolve; rejectBootstrap = reject;
  });
  void bootstrapReady.catch(() => undefined);
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  const failPending = (error: OperationClientError) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.abort?.(); entry.reject(error); }
    pending.clear();
  };
  const onDisconnect = () => {
    if (closed) return;
    const error = new OperationClientError('host_unbound');
    closed = true; channel.off('message', onMessage); failPending(error); rejectBootstrap(error);
  };
  const terminal = (error: OperationClientError) => {
    if (closed) return;
    closed = true; channel.off('message', onMessage); channel.off('disconnect', onDisconnect); failPending(error);
    rejectBootstrap(error);
    if (bootstrapTimer) { clearTimeout(bootstrapTimer); bootstrapTimer = null; }
    if (channel.connected && typeof channel.disconnect === 'function') channel.disconnect();
  };
  const invalid = (): never => {
    const error = new OperationClientError('protocol_invalid'); terminal(error); throw error;
  };
  const onMessage = (frame: unknown) => {
    if (typeof frame !== 'string' || Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) {
      terminal(new OperationClientError('protocol_invalid')); return;
    }
    let decoded: unknown;
    try { decoded = JSON.parse(frame); } catch { terminal(new OperationClientError('protocol_invalid')); return; }
    if (!authenticated) {
      const connected = z.object({ schemaVersion: z.literal(AIP_BOOTSTRAP_RESULT_SCHEMA_V1),
        outcome: z.literal('connected') }).strict().safeParse(decoded);
      if (!connected.success) { terminal(new OperationClientError('protocol_invalid')); return; }
      authenticated = true;
      if (bootstrapTimer) { clearTimeout(bootstrapTimer); bootstrapTimer = null; }
      resolveBootstrap();
      return;
    }
    const parsed = baseResultSchema.safeParse(decoded);
    if (!parsed.success) { terminal(new OperationClientError('protocol_invalid')); return; }
    const entry = pending.get(parsed.data.requestId);
    if (!entry) return;
    pending.delete(parsed.data.requestId); clearTimeout(entry.timer); entry.abort?.(); entry.resolve(decoded);
  };
  channel.on('message', onMessage); channel.once('disconnect', onDisconnect);

  const nextId = (label: string) => {
    sequence += 1;
    if (sequence > MAX_REQUESTS) return invalid();
    return `rpc_mcp_${label}_${sequence}`;
  };
  const publish = (frame: object) => {
    if (closed || typeof channel.send !== 'function' || channel.connected !== true) {
      throw new OperationClientError('host_unbound');
    }
    const encoded = JSON.stringify(frame);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FRAME_BYTES) throw new OperationClientError('protocol_invalid');
    try { channel.send(encoded); } catch { throw new OperationClientError('host_unbound'); }
  };
  const exchangeBound = (frame: Record<string, unknown>, label: string, signal?: AbortSignal,
    cancelOnTimeout = false): Promise<unknown> => {
    const requestId = nextId(label);
    if (signal?.aborted) return Promise.reject(new OperationClientError('cancelled'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(requestId)) return;
        abort?.();
        if (cancelOnTimeout) {
          try { publish({ schemaVersion: RPC_REQUEST_SCHEMA, method: 'cancel',
            requestId: nextId('cancel'), targetRequestId: requestId }); } catch { /* channel is already terminal */ }
          reject(new OperationClientError('operation_denied', 'timeout'));
        } else reject(new OperationClientError('protocol_invalid'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref();
      const abort = signal ? () => signal.removeEventListener('abort', onAbort) : undefined;
      const onAbort = () => {
        if (!pending.delete(requestId)) return;
        clearTimeout(timer); abort?.();
        try { publish({ schemaVersion: RPC_REQUEST_SCHEMA, method: 'cancel',
          requestId: nextId('cancel'), targetRequestId: requestId }); } catch { /* already terminal */ }
        reject(new OperationClientError('cancelled'));
      };
      pending.set(requestId, { resolve, reject, timer, abort });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { publish({ schemaVersion: RPC_REQUEST_SCHEMA, ...frame, requestId }); }
      catch (error) { pending.delete(requestId); clearTimeout(timer); abort?.(); reject(error as OperationClientError); }
    });
  };
  const exchange = (frame: Record<string, unknown>, label: string, signal?: AbortSignal,
    cancelOnTimeout = false): Promise<unknown> => bootstrapReady.then(() =>
      exchangeBound(frame, label, signal, cancelOnTimeout));
  const parseCompleted = (value: unknown, expected: OperationDescriptor): unknown => {
    const completed = z.object({
      schemaVersion: z.literal(RPC_RESULT_SCHEMA), requestId: requestIdSchema, outcome: z.literal('completed'),
      result: z.object({ operation: rpcOperationSchema, value: z.unknown() }).strict(),
    }).strict().safeParse(value);
    if (!completed.success) {
      const denied = z.object({ schemaVersion: z.literal(RPC_RESULT_SCHEMA), requestId: requestIdSchema,
        outcome: z.literal('denied'), denialCode: z.string().max(64) }).strict().safeParse(value);
      if (denied.success) throw new OperationClientError('operation_denied', denied.data.denialCode);
      return invalid();
    }
    const actual = completed.data.result.operation;
    if (actual.operationId !== expected.operationId || actual.capabilityId !== expected.capabilityId
        || actual.serviceRef !== expected.serviceRef || actual.maximumStage !== expected.maximumStage) {
      return invalid();
    }
    return completed.data.result.value;
  };
  const catalog = async (signal?: AbortSignal) => {
    const value = await exchange({ method: 'catalog' }, 'catalog', signal);
    const completed = z.object({ schemaVersion: z.literal(RPC_RESULT_SCHEMA), requestId: requestIdSchema,
      outcome: z.literal('completed'), result: z.object({ operations: z.array(rpcOperationSchema).max(32) }).strict(),
    }).strict().safeParse(value);
    if (!completed.success) return invalid();
    return selectBoundOperations(completed.data.result.operations);
  };
  const run = async (descriptor: OperationDescriptor, input: object, signal?: AbortSignal) =>
    parseCompleted(await exchange({ method: 'call', operationId: descriptor.operationId, input },
      'call', signal, true), descriptor);

  if (!authenticated) {
    bootstrapTimer = setTimeout(() => terminal(new OperationClientError('host_unbound')), REQUEST_TIMEOUT_MS);
    bootstrapTimer.unref();
    try {
      publish({ schemaVersion: AIP_BOOTSTRAP_REQUEST_SCHEMA_V1, operation: 'bootstrap', bootstrapRef });
    } catch { terminal(new OperationClientError('host_unbound')); }
  }

  return Object.freeze({
    catalog,
    status: async (signal?: AbortSignal) => { await catalog(signal); return HEADLESS_STATUS; },
    publicCatalog: async (signal?: AbortSignal) => publicCatalog(await catalog(signal)),
    searchTerminology: async (argumentsValue: unknown, signal?: AbortSignal) => {
      const args = terminologyArgumentsSchema.parse(argumentsValue);
      const descriptor = OPERATION_DESCRIPTORS.find((item) => item.operationId === TERMINOLOGY_OPERATION_ID)!;
      const output = terminologyOutputSchema.safeParse(await run(descriptor, {
        schemaVersion: descriptor.inputSchema, operationId: descriptor.operationId,
        system: args.system, query: args.query.trim().replace(/\s+/gu, ' '), limit: args.limit,
      }, signal));
      if (!output.success || output.data.items.length > args.limit || output.data.receipt.system !== args.system) {
        return invalid();
      }
      return output.data;
    },
    readOpenLoops: async (signal?: AbortSignal) => {
      const descriptor = OPERATION_DESCRIPTORS.find((item) => item.operationId === OPEN_LOOPS_OPERATION_ID)!;
      const output = openLoopsOutputSchema.safeParse(await run(descriptor,
        { schemaVersion: descriptor.inputSchema, operationId: descriptor.operationId }, signal));
      return output.success ? output.data : invalid();
    },
    close: () => {
      terminal(new OperationClientError('host_unbound'));
    },
  });
}
