/* @Codex */
import { types } from 'node:util';

import {
  createAipAuthenticatedIpcHostV1,
} from '../../packages/aip/src/authenticated-ipc.ts';
import {
  createAipAuthenticatedOperationRpcChildEnvironmentV1,
  createAipOperationRpcHostV1,
} from '../../packages/aip/src/operation-rpc.ts';
import { createAipOwnerBrokerV1 } from '../../packages/aip/src/owner-broker.ts';
import {
  PATIENT_OPEN_LOOPS_READ_APPLICATION_SERVICE_V1,
  PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
} from '../../packages/aip/src/patient-open-loops.ts';
import {
  AIP_TERMINOLOGY_SEARCH_CONTRACT_V1,
  createLocalAipTerminologySearchServiceV1,
} from '../../packages/aip/src/terminology-search.ts';
import {
  BOOTSTRAP, CHILD_KEYS, CONTEXT_KEYS, DIGEST, REF, SOURCE_KEYS, TOKEN,
  AuthenticatedAgentLauncherV1Error, exact, hostId, integer, record,
  type AuthenticatedAgentLauncherV1ErrorCode, type Child, type Context, type OperationState,
} from './authenticated-agent-launcher-contract.ts';
import { createAuthenticatedSessionScopeRegistryV1 } from './authenticated-session-scope-registry.ts';

const BOOTSTRAP_TIMEOUT_MS = 1_500;
const SESSION_OPERATION = 'mediflow.system.agent_session.v1';

export { AuthenticatedAgentLauncherV1Error } from './authenticated-agent-launcher-contract.ts';
export type { AuthenticatedAgentLauncherV1ErrorCode } from './authenticated-agent-launcher-contract.ts';

export function createAuthenticatedAgentLauncherV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SOURCE_KEYS);
  if (!sources || SOURCE_KEYS.some((key) => typeof sources[key] !== 'function' || types.isProxy(sources[key]))) {
    throw new AuthenticatedAgentLauncherV1Error('input_invalid');
  }
  const nowSource = sources.now as () => unknown;
  const nextRefSource = sources.nextRef as (kind: string) => unknown;
  const hashRefSource = sources.hashRef as (value: string) => unknown;
  const writeAudit = sources.writeAudit as (value: unknown) => unknown;
  const readHostContext = sources.readHostContext as () => unknown;
  const spawnChild = sources.spawnChild as (environment: Readonly<Record<string, string>>) => unknown;
  const createOpenLoopsRead = sources.createOpenLoopsRead as (value: unknown) => unknown;
  const issued = new Set<string>();
  let lastNow = -1;
  let started = false;

  const now = (): number => {
    let value: unknown;
    try { value = nowSource(); } catch { throw new AuthenticatedAgentLauncherV1Error('context_unavailable'); }
    if (!integer(value) || value < lastNow || types.isPromise(value)) {
      throw new AuthenticatedAgentLauncherV1Error('context_unavailable');
    }
    lastNow = value;
    return value;
  };
  const nextRef = (kind: string): string => {
    let value: unknown;
    try { value = nextRefSource(kind); } catch { throw new AuthenticatedAgentLauncherV1Error('operation_unavailable'); }
    const valid = kind === 'bootstrap' ? typeof value === 'string' && BOOTSTRAP.test(value)
      : typeof value === 'string' && REF.test(value);
    if (!valid || issued.has(value as string)) throw new AuthenticatedAgentLauncherV1Error('operation_unavailable');
    issued.add(value as string);
    return value as string;
  };
  const hashRef = (value: string): string => {
    let digest: unknown;
    try { digest = hashRefSource(value); } catch { throw new AuthenticatedAgentLauncherV1Error('operation_unavailable'); }
    if (typeof digest !== 'string' || !DIGEST.test(digest) || types.isPromise(digest)) {
      throw new AuthenticatedAgentLauncherV1Error('operation_unavailable');
    }
    return digest;
  };
  const context = (): Context => {
    let raw: unknown;
    try { raw = readHostContext(); } catch { throw new AuthenticatedAgentLauncherV1Error('context_unavailable'); }
    const value = exact(raw, CONTEXT_KEYS);
    const timestamp = now();
    if (!value || value.status !== 'available' || !REF.test(value.userRef as string)
      || !REF.test(value.parentRef as string) || !TOKEN.test(value.purposeCode as string)
      || !hostId(value.patientId) || !hostId(value.ambulatoryId) || !integer(value.generation, 1)
      || !integer(value.revocationGeneration) || !integer(value.selectionEpoch)
      || !integer(value.restartGeneration, 1) || !integer(value.parentGeneration, 1)
      || !integer(value.policyGeneration, 1) || !integer(value.bootstrapExpiresAt, timestamp + 1)
      || !integer(value.expiresAt, (value.bootstrapExpiresAt as number) + 1)) {
      throw new AuthenticatedAgentLauncherV1Error('context_unavailable');
    }
    return record(value as Context);
  };
  const selection = () => {
    const value = context();
    return record({ status: 'available' as const, patientId: value.patientId, ambulatoryId: value.ambulatoryId,
      generation: value.generation, revocationGeneration: value.revocationGeneration,
      selectionEpoch: value.selectionEpoch, restartGeneration: value.restartGeneration, expiresAt: value.expiresAt });
  };
  const broker = createAipOwnerBrokerV1({ now, nextRef: () => nextRef('broker'), hashRef, writeAudit });
  const registry = createAuthenticatedSessionScopeRegistryV1(record({
    now, nextNonce: () => nextRef('nonce'), hashRef, readHostSelection: selection,
  }));
  const peers = new WeakMap<object, Readonly<Record<string, unknown>>>();
  const authHost = createAipAuthenticatedIpcHostV1({
    broker, now, nextBootstrapRef: () => nextRef('bootstrap'), hashRef, writeAudit,
    authenticateTrustedPortPeer: async (connection: object) => {
      const peer = peers.get(connection);
      if (!peer) throw new AuthenticatedAgentLauncherV1Error('authentication_failed');
      return peer;
    },
  });

  const launch = (): Promise<Readonly<{ schemaVersion: 'mediflow.headless.authenticated-launch.v1';
    status: 'authenticated'; close: () => boolean; restart: () => boolean }>> => {
    if (started) return Promise.reject(new AuthenticatedAgentLauncherV1Error('already_started'));
    started = true;
    let launchContext: Context;
    try { launchContext = context(); } catch (error) { return Promise.reject(error); }
    const processRef = nextRef('process'), peerRef = nextRef('peer'), runtimeRef = nextRef('runtime');
    const sessionTicket = registry.capture();
    const activation = registry.activation(sessionTicket);
    const bootstrapRef = authHost.stageLaunch(record({ expectedProcessRef: processRef,
      expectedUserRef: launchContext.userRef, bootstrapExpiresAt: launchContext.bootstrapExpiresAt,
      parentRef: launchContext.parentRef, purposeCode: launchContext.purposeCode, operation: SESSION_OPERATION,
      capabilityId: SESSION_OPERATION, scopeDigest: activation.scopeDigest, maxStage: 'proposal_only' as const,
      budget: 1, expiresAt: launchContext.expiresAt, generation: activation.generation,
      revocationGeneration: activation.revocationGeneration, selectionEpoch: activation.selectionEpoch,
      parentGeneration: launchContext.parentGeneration, policyGeneration: launchContext.policyGeneration,
      venue: 'local_intelligent_host' as const, egressAllowed: false }));
    let childValue: unknown;
    try { childValue = spawnChild(createAipAuthenticatedOperationRpcChildEnvironmentV1(bootstrapRef)); }
    catch { return Promise.reject(new AuthenticatedAgentLauncherV1Error('child_unavailable')); }
    const childSource = exact(childValue, CHILD_KEYS);
    if (!childSource || !childSource.connection || typeof childSource.connection !== 'object'
      || types.isProxy(childSource.connection) || CHILD_KEYS.slice(1).some((key) =>
        typeof childSource[key] !== 'function' || types.isProxy(childSource[key]))) {
      return Promise.reject(new AuthenticatedAgentLauncherV1Error('child_unavailable'));
    }
    const child = childSource as unknown as Child;
    peers.set(child.connection, record({ transport: 'inherited_child_ipc' as const,
      permission: 'spawn_bound_private_channel' as const, peerRef, runtimeRef, processRef,
      userRef: launchContext.userRef }));
    let active = true, authenticated = false, bootstrapping = false;
    let rpcHost: ReturnType<typeof createAipOperationRpcHostV1> | null = null;
    let rpcHandle: object | null = null, authScopeSession: object | null = null;
    const operationStates: OperationState[] = [];
    const cancellers = new Set<() => void>();
    let unsubscribeMessages: (() => void) | null = null, unsubscribeClose: (() => void) | null = null;
    let resolveReady!: (value: Readonly<{ schemaVersion: 'mediflow.headless.authenticated-launch.v1';
      status: 'authenticated'; close: () => boolean; restart: () => boolean }>) => void;
    let rejectReady!: (error: Error) => void;
    let settled = false;
    const ready = new Promise<Readonly<{ schemaVersion: 'mediflow.headless.authenticated-launch.v1';
      status: 'authenticated'; close: () => boolean; restart: () => boolean }>>((resolve, reject) => {
        resolveReady = resolve; rejectReady = reject;
      });
    const settleError = (code: AuthenticatedAgentLauncherV1ErrorCode): void => {
      if (settled) return; settled = true; rejectReady(new AuthenticatedAgentLauncherV1Error(code));
    };
    const cleanup = (restart: boolean): boolean => {
      if (!active) return false;
      active = false; clearTimeout(timer);
      for (const cancel of cancellers) { try { cancel(); } catch { /* terminal */ } }
      cancellers.clear();
      if (rpcHost && rpcHandle) { try { restart ? rpcHost.restart() : rpcHost.revoke(rpcHandle); } catch { /* terminal */ } }
      for (const state of operationStates) {
        try { registry.revoke(state.scopeSession); } catch { /* terminal */ }
        if (!restart) { try { broker.revokeOwner(state.owner); } catch { /* terminal */ } }
      }
      if (authScopeSession) { try { registry.revoke(authScopeSession); } catch { /* terminal */ } }
      try { restart ? registry.restart() : authHost.close(child.connection); } catch { /* terminal */ }
      if (restart) { try { authHost.restart(); } catch { /* terminal */ } }
      try { unsubscribeMessages?.(); } catch { /* terminal */ }
      try { unsubscribeClose?.(); } catch { /* terminal */ }
      try { child.terminate(); } catch { /* terminal */ }
      if (!authenticated) settleError(restart ? 'authentication_failed' : 'child_unavailable');
      return true;
    };
    const session = record({ schemaVersion: 'mediflow.headless.authenticated-launch.v1' as const,
      status: 'authenticated' as const, close: () => cleanup(false), restart: () => cleanup(true) });
    const current = (state: OperationState) => {
      const value = context();
      if (value.userRef !== state.context.userRef || value.parentRef !== state.context.parentRef
        || value.purposeCode !== state.context.purposeCode) {
        throw new AuthenticatedAgentLauncherV1Error('context_unavailable');
      }
      return record({ peerRef: state.peerRef, runtimeRef: state.runtimeRef, generation: value.generation,
        revocationGeneration: value.revocationGeneration, selectionEpoch: value.selectionEpoch,
        parentGeneration: value.parentGeneration, policyGeneration: value.policyGeneration });
    };
    const createOperation = (operationId: string, maximumStage: 'read_only' | 'proposal_only'): OperationState => {
      const ticket = registry.capture();
      const scope = registry.activation(ticket);
      const owner = broker.issueOwner(record({ peerRef, runtimeRef, parentRef: launchContext.parentRef,
        purposeCode: launchContext.purposeCode, operation: operationId, capabilityId: operationId,
        scopeDigest: scope.scopeDigest, maxStage: maximumStage, budget: 256, expiresAt: launchContext.expiresAt,
        generation: scope.generation, revocationGeneration: scope.revocationGeneration,
        selectionEpoch: scope.selectionEpoch, parentGeneration: launchContext.parentGeneration,
        policyGeneration: launchContext.policyGeneration, venue: 'local_intelligent_host' as const,
        egressAllowed: false }));
      const scopeSession = registry.bindOwner(ticket, owner);
      const state = record({ operationId, capabilityId: operationId, maximumStage, owner, scopeSession,
        peerRef, runtimeRef, context: launchContext });
      operationStates.push(state);
      return state;
    };
    const authorize = async (state: OperationState) => broker.authorize(broker.issueLease(state.owner),
      current(state), record({ operation: state.operationId, capabilityId: state.capabilityId }));
    const withAbort = async <T>(signal: AbortSignal, cancel: () => void, action: () => Promise<T>): Promise<T> => {
      if (signal.aborted) throw new AuthenticatedAgentLauncherV1Error('operation_unavailable');
      const onAbort = () => cancel();
      cancellers.add(cancel); signal.addEventListener('abort', onAbort, { once: true });
      try { return await action(); }
      finally { signal.removeEventListener('abort', onAbort); cancellers.delete(cancel); }
    };
    const prepareRpc = (): void => {
      const terminologyState = createOperation(AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.operationId, 'read_only');
      const openLoopsState = createOperation(PATIENT_OPEN_LOOPS_READ_OPERATION_V1, 'read_only');
      rpcHost = createAipOperationRpcHostV1({ operations: [{
        operationId: terminologyState.operationId, capabilityId: terminologyState.capabilityId,
        serviceRef: AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.applicationServiceRef, maximumStage: 'read_only', timeoutMs: 500,
        execute: async (input: unknown, signal: AbortSignal) => {
          const permit = await authorize(terminologyState);
          const service = createLocalAipTerminologySearchServiceV1({ now,
            nextReceiptRef: () => nextRef('terminology_receipt'), current: () => current(terminologyState),
            beginPermit: broker.beginPermit, finalizePermit: broker.finalizePermit,
            denyPermit: broker.denyPermit, writeAudit });
          return withAbort(signal, service.cancel, async () => {
            try { return await service.execute(permit, input); } finally { service.dispose(); }
          });
        },
      }, {
        operationId: openLoopsState.operationId, capabilityId: openLoopsState.capabilityId,
        serviceRef: PATIENT_OPEN_LOOPS_READ_APPLICATION_SERVICE_V1, maximumStage: 'read_only', timeoutMs: 1_000,
        execute: async (input: unknown, signal: AbortSignal) => {
          const permit = await authorize(openLoopsState);
          const candidate = createOpenLoopsRead(record({ now, current: () => current(openLoopsState),
            beginPermit: (value: unknown, currentValue: unknown, claim: unknown) => {
              const execution = broker.beginPermit(value, currentValue, claim);
              if (!registry.bindExecution(openLoopsState.scopeSession, openLoopsState.owner, execution)) {
                broker.denyPermit(execution); throw new AuthenticatedAgentLauncherV1Error('operation_unavailable');
              }
              return execution;
            }, bindPermit: broker.bindPermit, finalizeBoundPermit: broker.finalizeBoundPermit,
            denyPermit: broker.denyPermit, resolveHostScope: registry.resolveExecution, writeAudit }));
          const outer = exact(candidate, ['service']);
          const service = outer?.service as { read?: unknown; cancel?: unknown; dispose?: unknown } | undefined;
          if (!service || typeof service.read !== 'function' || typeof service.cancel !== 'function'
            || typeof service.dispose !== 'function') throw new AuthenticatedAgentLauncherV1Error('operation_unavailable');
          return withAbort(signal, service.cancel as () => void, async () => {
            try { return await (service.read as (permit: unknown, request: unknown) => Promise<unknown>)(permit, input); }
            finally { (service.dispose as () => void)(); }
          });
        },
      }] });
      rpcHandle = rpcHost.attach({ subscribe: child.subscribe, publish: child.publish });
    };
    const onBootstrap = (frame: unknown): void => {
      if (!active || authenticated || bootstrapping) { cleanup(false); return; }
      bootstrapping = true;
      void (async () => {
        try {
          if (typeof frame !== 'string') throw new Error('invalid');
          const response = await authHost.handleBootstrap(child.connection, new TextEncoder().encode(frame));
          const owner = authHost.claimAuthenticatedOwner(child.connection);
          authScopeSession = registry.bindOwner(sessionTicket, owner);
          unsubscribeMessages?.(); unsubscribeMessages = null;
          prepareRpc();
          const published = child.publish(new TextDecoder().decode(response));
          if (published !== undefined || !active) throw new Error('publish_failed');
          authenticated = true; settled = true; clearTimeout(timer); resolveReady(session);
        } catch { settleError('authentication_failed'); cleanup(false); }
      })();
    };
    const timer = setTimeout(() => { settleError('authentication_failed'); cleanup(false); }, BOOTSTRAP_TIMEOUT_MS);
    try {
      const unsubscribe = child.subscribe(onBootstrap);
      const closeUnsubscribe = child.onClose(() => cleanup(false));
      if (typeof unsubscribe !== 'function' || types.isProxy(unsubscribe)
        || typeof closeUnsubscribe !== 'function' || types.isProxy(closeUnsubscribe)) throw new Error('port');
      unsubscribeMessages = unsubscribe as () => void; unsubscribeClose = closeUnsubscribe as () => void;
    } catch { settleError('child_unavailable'); cleanup(false); }
    return ready;
  };
  return record({ launch });
}
