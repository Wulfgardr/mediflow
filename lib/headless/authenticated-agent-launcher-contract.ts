/* @Codex */
import { types } from 'node:util';

export const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'writeAudit', 'commitTerminalAudit', 'readHostContext',
  'spawnChild', 'createOpenLoopsRead', 'previewCheckupStatus'] as const;
export const CONTEXT_KEYS = ['status', 'userRef', 'parentRef', 'purposeCode', 'patientId', 'ambulatoryId',
  'generation', 'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'parentGeneration',
  'policyGeneration', 'expiresAt', 'bootstrapExpiresAt'] as const;
export const CHILD_KEYS = ['connection', 'subscribe', 'publish', 'onClose', 'terminate'] as const;
export const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
export const TOKEN = /^[a-z][a-z0-9._-]{0,127}$/u;
export const DIGEST = /^sha256:[0-9a-f]{64}$/u;
export const BOOTSTRAP = /^aipb_[0-9a-f]{32}$/u;
export const HOST_ID_MAX_BYTES = 256;

export type AuthenticatedAgentLauncherV1ErrorCode = 'input_invalid' | 'context_unavailable'
  | 'child_unavailable' | 'authentication_failed' | 'operation_unavailable' | 'already_started';

export class AuthenticatedAgentLauncherV1Error extends Error {
  constructor(public readonly code: AuthenticatedAgentLauncherV1ErrorCode) {
    super(`Authenticated agent launcher rejected: ${code}`);
    this.name = 'AuthenticatedAgentLauncherV1Error';
  }
}

export type Context = Readonly<{
  status: 'available'; userRef: string; parentRef: string; purposeCode: string;
  patientId: string; ambulatoryId: string; generation: number; revocationGeneration: number;
  selectionEpoch: number; restartGeneration: number; parentGeneration: number; policyGeneration: number;
  expiresAt: number; bootstrapExpiresAt: number;
}>;
export type Child = Readonly<{
  connection: object; subscribe: (listener: (frame: unknown) => void) => unknown;
  publish: (frame: string) => unknown; onClose: (listener: () => void) => unknown; terminate: () => unknown;
}>;
export type OperationState = Readonly<{ operationId: string; capabilityId: string;
  maximumStage: 'read_only' | 'proposal_only'; owner: object; scopeSession: object;
  peerRef: string; runtimeRef: string; scopeDigest: string; context: Context }>;

export function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || types.isPromise(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}

export function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
export function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
export function hostId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && Buffer.byteLength(value, 'utf8') <= HOST_ID_MAX_BYTES;
}
