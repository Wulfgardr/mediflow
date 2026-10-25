import 'server-only';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { serverSessions, type WebResourceDisposer, type NativeSessionResourcePort, type NativeSessionResourceUse,
    type NativeSessionResourceRegistration, type NativeSessionResourceBinding, type NativeAuthenticationGeneration } from './web-auth-lifecycle-owner-adapter';
import { withCurrentNativeInferenceEnvironment } from './native-inference-environment';

declare const nativeInferencePort: unique symbol;
declare const nativeInferenceUse: unique symbol;
export type NativeInferencePort = Readonly<{ readonly [nativeInferencePort]: never }>;
export type NativeInferenceUse = Readonly<{ readonly [nativeInferenceUse]: never }>;
export type NativeInferenceRegistration = NativeSessionResourceRegistration;
export type NativeInferenceBinding = NativeSessionResourceBinding;
export type NativeInferenceGeneration = NativeAuthenticationGeneration;
type PortRecord = { session: unknown; raw: NativeSessionResourcePort; active: boolean };
type UseRecord = { port: PortRecord; raw: NativeSessionResourceUse; active: boolean; binding: boolean; poisoned: boolean };
type AuthorityRecord = { session: unknown; binding: NativeInferenceBinding };
const authorities = new Map<string, AuthorityRecord>();
const authorityReference = (id: string) => createHash('sha256').update(id).digest('hex');
const ports = new WeakMap<object, PortRecord>();
const uses = new WeakMap<object, UseRecord>();
const opaque = <T>(): T => Object.freeze(Object.create(null)) as T;
const object = (value: unknown): value is object => typeof value === 'object' && value !== null && !types.isProxy(value);
const lookupPort = (value: unknown) => object(value) ? ports.get(value) : undefined;
const lookupUse = (value: unknown) => object(value) ? uses.get(value) : undefined;
const revoke = (port: PortRecord) => { port.active = false; serverSessions.revokeNativeSessionResourceAuthority(port.session); };

function bindRaw(port: PortRecord, raw: NativeSessionResourceUse,
    operation: (binding: NativeInferenceBinding) => void): boolean {
    if (!port.active) return false;
    let environment = false;
    const current = serverSessions.withCurrentNativeSessionResourceBinding(raw, binding => {
        environment = withCurrentNativeInferenceEnvironment(binding, () => operation(binding));
    });
    if (!current || !environment) { revoke(port); return false; }
    return true;
}

/** Only a genuine native lifecycle emission can reach the fixed role/pair/capability intersection. */
export function mintResourcePort(session: unknown): NativeInferencePort | null {
    const raw = serverSessions.mintNativeSessionResourcePort(session);
    if (!raw) return null;
    const record: PortRecord = { session, raw, active: true };
    const use = serverSessions.beginNativeSessionResourceUse(raw);
    try {
        let binding: NativeInferenceBinding | undefined;
        if (!use || !bindRaw(record, use, value => { binding = value; }) || !binding) return null;
        const reference = authorityReference(binding.sessionId);
        if (!authorities.has(reference)) {
            if (authorities.size >= 4096) { record.active = false; return null; }
            authorities.set(reference, { session, binding });
        }
        const port = opaque<NativeInferencePort>(); ports.set(port, record); return port;
    } finally {
        if (use) serverSessions.abortNativeSessionResourceUse(use);
        if (!record.active || !use) serverSessions.releaseNativeSessionResourcePort(raw);
    }
}
export function beginResourceUse(port: unknown): NativeInferenceUse | null {
    const record = lookupPort(port);
    if (!record?.active) return null;
    const raw = serverSessions.beginNativeSessionResourceUse(record.raw);
    if (!raw || !bindRaw(record, raw, () => undefined)) {
        if (raw) serverSessions.abortNativeSessionResourceUse(raw);
        return null;
    }
    const use = opaque<NativeInferenceUse>(); uses.set(use, { port: record, raw, active: true, binding: false, poisoned: false }); return use;
}
export function withCurrentResourceBinding(use: unknown, operation: (binding: NativeInferenceBinding) => void): boolean {
    const record = lookupUse(use);
    if (record?.binding) { record.poisoned = true; return false; }
    if (!record?.active) return false;
    if (typeof operation !== 'function' || types.isProxy(operation)
        || Object.getPrototypeOf(operation) !== Object.getPrototypeOf(function () {})) {
        abortResourceUse(use); return false;
    }
    record.binding = true;
    try {
        return bindRaw(record.port, record.raw, binding => {
            if (operation(binding) !== undefined || record.poisoned) throw new Error('native_binding_must_be_synchronous_void');
        });
    } finally { record.binding = false; }
}
export function commitResourceUse(use: unknown): boolean {
    const record = lookupUse(use);
    if (record?.binding) { record.poisoned = true; return false; }
    if (!record?.active) return false;
    const current = !record.poisoned && bindRaw(record.port, record.raw, () => undefined);
    record.active = false;
    if (!current) { serverSessions.abortNativeSessionResourceUse(record.raw); return false; }
    return serverSessions.commitNativeSessionResourceUse(record.raw);
}
export function abortResourceUse(use: unknown): boolean {
    const record = lookupUse(use);
    if (record?.binding) { record.poisoned = true; return false; }
    if (!record?.active) return false;
    record.active = false; return serverSessions.abortNativeSessionResourceUse(record.raw);
}
export function releaseResourcePort(port: unknown): boolean {
    const record = lookupPort(port);
    if (!record?.active) return false;
    record.active = false; return serverSessions.releaseNativeSessionResourcePort(record.raw);
}
export function registerPrivateResource(port: unknown, dispose: WebResourceDisposer): NativeInferenceRegistration | null {
    const record = lookupPort(port);
    if (!record?.active) return null;
    const use = beginResourceUse(port);
    if (!use) return null;
    try {
        const registration = serverSessions.registerNativeSessionPrivateResource(record.raw, dispose);
        if (!registration || !commitResourceUse(use)) {
            if (registration) serverSessions.unregisterNativeSessionPrivateResource(record.raw, registration);
            return null;
        }
        return registration;
    } finally { abortResourceUse(use); }
}
export function unregisterPrivateResource(port: unknown, registration: unknown): boolean {
    const record = lookupPort(port);
    return Boolean(record && serverSessions.unregisterNativeSessionPrivateResource(record.raw, registration));
}

/** Attests only irreversible native-cell retirement, never runtime cleanup or a transfer of authority. */
export function verifyPreviousAuthorityRetirement(use: NativeInferenceUse, previousAuthorityRef: string) {
    if (!/^[a-f0-9]{64}$/u.test(previousAuthorityRef)) return null;
    const previous = authorities.get(previousAuthorityRef);
    if (!previous) return null;
    let receipt: Readonly<{ schema: string; previousAuthorityRef: string; currentAuthorityRef: string;
        authorityRetired: true; physicalCleanup: 'not_attested' }> | null = null;
    const current = withCurrentResourceBinding(use, binding => {
        const old = previous.binding;
        if (binding.sessionId === old.sessionId || binding.principalRef !== old.principalRef
            || binding.username !== old.username || binding.role !== old.role || binding.clientId !== old.clientId
            || binding.clientPlatform !== old.clientPlatform || binding.tokenHash !== old.tokenHash) return;
        const active = serverSessions.mintNativeSessionResourcePort(previous.session);
        if (active) { serverSessions.releaseNativeSessionResourcePort(active); return; }
        receipt = Object.freeze({ schema: 'mediflow.native-authority-retirement.v1', previousAuthorityRef,
            currentAuthorityRef: authorityReference(binding.sessionId), authorityRetired: true, physicalCleanup: 'not_attested' });
    });
    return current ? receipt : null;
}
