/* @Codex */
import 'server-only';

import { types } from 'node:util';

import type { PortableSupervisorWebCaptureV1 } from
  '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
import type { PortableSupervisorWebCaptureOwnerV1 } from './portable-supervisor-context-owner.ts';

const CAPTURE = ['schemaVersion', 'userRef', 'parentRef', 'patientId', 'ambulatoryId', 'selectionEpoch',
  'expectedPatientVersion', 'expiresAt'] as const;
const HASH = /^[a-z]+\.[0-9a-f]{64}$/u, HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
declare const bindingIdentity: unique symbol;
export type PortableSupervisorCheckupWebSessionBindingV1 = Readonly<{ readonly [bindingIdentity]?: never }>;
type BindingRecord = { active: boolean; binding: PortableSupervisorCheckupWebSessionBindingV1;
  dispose: () => void };
type Phase = 'idle' | 'active' | 'terminal';

function callback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function' && !types.isProxy(value) && !types.isAsyncFunction(value)
    && !types.isGeneratorFunction(value);
}
function observedNow(source: () => unknown): number | null {
  let value: unknown;
  try { value = source(); } catch { return null; }
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}
function capture(value: unknown, now: number): PortableSupervisorWebCaptureV1 | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || types.isPromise(value) || !Object.isFrozen(value)) return null;
    const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if ((prototype !== null && prototype !== Object.prototype) || keys.length !== CAPTURE.length
      || keys.some((key) => typeof key !== 'string' || !CAPTURE.includes(key as typeof CAPTURE[number]))) return null;
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 'mediflow.portable-supervisor.web-capture.v1'
      || typeof item.userRef !== 'string' || !HASH.test(item.userRef)
      || typeof item.parentRef !== 'string' || !HASH.test(item.parentRef)
      || typeof item.patientId !== 'string' || !HOST_ID.test(item.patientId)
      || typeof item.ambulatoryId !== 'string' || !HOST_ID.test(item.ambulatoryId)
      || !Number.isSafeInteger(item.selectionEpoch) || (item.selectionEpoch as number) < 1
      || !Number.isSafeInteger(item.expectedPatientVersion) || (item.expectedPatientVersion as number) < 1
      || !Number.isSafeInteger(item.expiresAt) || (item.expiresAt as number) <= now) return null;
    return value as PortableSupervisorWebCaptureV1;
  } catch { return null; }
}
function same(left: PortableSupervisorWebCaptureV1, right: PortableSupervisorWebCaptureV1): boolean {
  return CAPTURE.every((key) => left[key] === right[key]);
}

/** One operation-specific dependent port over the already-active H1a owner. */
export function createPortableSupervisorCheckupWebSessionPortV1(sources: Readonly<{ now(): unknown }>) {
  let phase: Phase = 'idle', owner: PortableSupervisorWebCaptureOwnerV1 | null = null;
  let attached: BindingRecord | null = null, operationActive = false, operationPoisoned = false;
  const detach = (record: BindingRecord, notify: boolean): void => {
    if (!record.active) return;
    record.active = false; if (attached === record) attached = null;
    if (notify) { try { record.dispose(); } catch { /* dependent is already terminal */ } }
  };
  const terminal = (): boolean => {
    if (phase === 'terminal') return false;
    phase = 'terminal'; owner = null;
    if (attached) detach(attached, true);
    return true;
  };
  const controller = Object.freeze({
    activate(value: PortableSupervisorWebCaptureOwnerV1): boolean {
      if (phase !== 'idle' || !value || typeof value !== 'object' || types.isProxy(value)
        || typeof value.readCapture !== 'function') return false;
      const now = observedNow(sources.now);
      if (now === null) { terminal(); return false; }
      let current: unknown;
      try { current = value.readCapture(); } catch { terminal(); return false; }
      if (!capture(current, now)) { terminal(); return false; }
      owner = value; phase = 'active'; return true;
    },
    terminate: terminal,
  });
  const port = Object.freeze({
    attach(disposeValue: () => void): PortableSupervisorCheckupWebSessionBindingV1 | null {
      if (phase !== 'active' || attached || !callback(disposeValue)) return null;
      const binding = Object.freeze(Object.create(null)) as PortableSupervisorCheckupWebSessionBindingV1;
      attached = { active: true, binding, dispose: disposeValue as () => void }; return binding;
    },
    withCurrent(binding: unknown, operation: (capture: PortableSupervisorWebCaptureV1) => void): boolean {
      const record = binding && typeof binding === 'object' ? attached : null;
      if (operationActive) { operationPoisoned = true; return false; }
      if (phase !== 'active' || !owner || !record?.active || record.binding !== binding
        || !callback(operation)) return false;
      const beforeNow = observedNow(sources.now); let beforeValue: unknown;
      try { beforeValue = beforeNow === null ? null : owner.readCapture(); } catch { beforeValue = null; }
      const before = beforeNow === null ? null : capture(beforeValue, beforeNow);
      if (!before) { terminal(); return false; }
      operationPoisoned = false; operationActive = true; let result: unknown;
      try { result = Reflect.apply(operation, undefined, [before]); }
      catch { detach(record, true); return false; }
      finally { operationActive = false; }
      if (operationPoisoned || result !== undefined || types.isPromise(result) || phase !== 'active' || owner === null
        || attached !== record || !record.active) { detach(record, true); return false; }
      const afterNow = observedNow(sources.now); let afterValue: unknown;
      try { afterValue = afterNow === null ? null : owner.readCapture(); } catch { afterValue = null; }
      const after = afterNow === null ? null : capture(afterValue, afterNow);
      if (!after || !same(before, after)) { terminal(); return false; }
      return true;
    },
    detach(binding: unknown): boolean {
      const record = binding && typeof binding === 'object' ? attached : null;
      if (!record?.active || record.binding !== binding) return false;
      detach(record, false); return true;
    },
  });
  return Object.freeze({ controller, port });
}
