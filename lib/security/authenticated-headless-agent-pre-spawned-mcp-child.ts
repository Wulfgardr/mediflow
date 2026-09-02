/* @Codex */
import { types } from 'node:util';

import {
  AIP_BOOTSTRAP_BIND_MAX_FRAME_BYTES_V1, AIP_BOOTSTRAP_BIND_SCHEMA_V1, AIP_BOOTSTRAP_ENV_KEY_V1,
  AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1, AIP_OPERATION_RPC_ENV_KEY_V1,
} from '../../packages/aip/src/child-ipc-contract.ts';
import { AuthenticatedAgentLauncherV1Error } from '../headless/authenticated-agent-launcher.ts';
import { BOOTSTRAP, CHILD_KEYS, exact, record, type Child } from
  '../headless/authenticated-agent-launcher-contract.ts';

const nativePromiseThen = Promise.prototype.then;

function unavailable(): never {
  throw new AuthenticatedAgentLauncherV1Error('child_unavailable');
}

function discardPromise(value: unknown): boolean {
  if (types.isProxy(value) || !types.isPromise(value)) return false;
  try { void Reflect.apply(nativePromiseThen, value, [undefined, () => undefined]); }
  catch { /* the port is denied below */ }
  return true;
}

function synchronousFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function' && !types.isProxy(value) && !types.isAsyncFunction(value)
    && !types.isGeneratorFunction(value);
}

function validatedChildPort(value: unknown): Child {
  if (discardPromise(value)) unavailable();
  const candidate = exact(value, CHILD_KEYS);
  if (!candidate || !candidate.connection || typeof candidate.connection !== 'object'
    || types.isProxy(candidate.connection) || discardPromise(candidate.connection)
    || CHILD_KEYS.slice(1).some((key) => !synchronousFunction(candidate[key]))) unavailable();
  return candidate as unknown as Child;
}

export type LateBoundMcpChildPortV1 = Readonly<{
  connection: object;
  subscribe: (listener: (frame: unknown) => void) => () => void;
  publish: (frame: string) => void;
  onClose: (listener: () => void) => () => void;
  terminate: () => void;
}>;

export function createLateBoundMcpChildPortV1(
  childPortValue: unknown, environmentValue: unknown,
): LateBoundMcpChildPortV1 {
  const child = validatedChildPort(childPortValue);
  if (discardPromise(environmentValue)) unavailable();
  const environment = exact(environmentValue, [AIP_BOOTSTRAP_ENV_KEY_V1, AIP_OPERATION_RPC_ENV_KEY_V1]);
  if (!environment || !Object.isFrozen(environmentValue) || Object.getPrototypeOf(environmentValue) !== null
    || typeof environment[AIP_BOOTSTRAP_ENV_KEY_V1] !== 'string'
    || !BOOTSTRAP.test(environment[AIP_BOOTSTRAP_ENV_KEY_V1] as string)
    || environment[AIP_OPERATION_RPC_ENV_KEY_V1] !== AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1) unavailable();
  const bindFrame = JSON.stringify({ schemaVersion: AIP_BOOTSTRAP_BIND_SCHEMA_V1, operation: 'bind',
    bootstrapRef: environment[AIP_BOOTSTRAP_ENV_KEY_V1] });
  if (Buffer.byteLength(bindFrame, 'utf8') > AIP_BOOTSTRAP_BIND_MAX_FRAME_BYTES_V1) unavailable();
  let bindPublished = false, terminated = false;
  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    let result: unknown;
    try { result = child.terminate(); } catch { return unavailable(); }
    if (discardPromise(result) || result !== undefined) unavailable();
  };
  const checkedUnsubscribe = (value: unknown): (() => void) => {
    if (discardPromise(value) || !synchronousFunction(value)) {
      try { terminate(); } catch { /* original denial remains */ }
      unavailable();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      let result: unknown;
      try { result = value(); } catch {
        try { terminate(); } catch { /* original denial remains */ }
        return unavailable();
      }
      if (discardPromise(result) || result !== undefined) {
        try { terminate(); } catch { /* original denial remains */ }
        unavailable();
      }
    };
  };
  const publish = (frame: string): void => {
    if (terminated) unavailable();
    let result: unknown;
    try { result = typeof frame === 'string' ? child.publish(frame) : null; }
    catch {
      try { terminate(); } catch { /* original denial remains */ }
      return unavailable();
    }
    if (discardPromise(result) || result !== undefined) {
      try { terminate(); } catch { /* original denial remains */ }
      unavailable();
    }
  };
  return record({
    connection: child.connection,
    subscribe: (listener: (frame: unknown) => void) => {
      if (!synchronousFunction(listener)) unavailable();
      let subscription: unknown;
      try { subscription = child.subscribe(listener); }
      catch {
        try { terminate(); } catch { /* original denial remains */ }
        return unavailable();
      }
      const unsubscribe = checkedUnsubscribe(subscription);
      if (!bindPublished) {
        bindPublished = true;
        try { publish(bindFrame); }
        catch {
          try { unsubscribe(); } catch { /* terminal */ }
          try { terminate(); } catch { /* terminal */ }
          unavailable();
        }
      }
      return unsubscribe;
    },
    publish,
    onClose: (listener: () => void) => {
      if (!synchronousFunction(listener)) unavailable();
      let subscription: unknown;
      try { subscription = child.onClose(listener); }
      catch {
        try { terminate(); } catch { /* original denial remains */ }
        return unavailable();
      }
      return checkedUnsubscribe(subscription);
    },
    terminate,
  });
}
