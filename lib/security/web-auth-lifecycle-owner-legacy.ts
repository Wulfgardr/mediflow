/* @Codex */
import { types } from 'node:util';

import {
    abort as abortHistoricalWebAuth,
    begin as beginHistoricalWebAuth,
    issue as issueHistoricalWebAuth,
    type WebAuthSessionAttempt as HistoricalWebAuthAttempt,
    type WebAuthSessionIssue as HistoricalWebAuthIssue,
} from './web-auth-session-issuer';
import {
    abortActiveWebSessionResourceUse,
    beginActiveWebSessionResourceUse,
    commitActiveWebSessionResourceUse,
    dispatchActiveWebServerSessionRetirement,
    mintActiveWebSessionResourcePort,
    peekSession,
    registerActiveWebSessionPrivateResource,
    releaseActiveWebSessionResourcePort,
    resolveActiveWebServerSession,
    retireWebP3SessionsForUser,
    unregisterActiveWebSessionPrivateResource,
    type ActiveWebSessionPrivateResourceDisposer,
    type ActiveWebSessionPrivateResourceRegistration,
    type ActiveWebSessionResourcePort,
    type ActiveWebSessionResourceUse,
    type WebServerSessionRetirementCleanupReceipt,
    type WebServerSessionRetirementReason,
} from './server-session';

const isProxy = types.isProxy;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectPrototype = Object.prototype;

export type WebAuthAttempt = HistoricalWebAuthAttempt;
export type WebAuthIssue = HistoricalWebAuthIssue;
export type WebSessionProjection = NonNullable<ReturnType<typeof resolveActiveWebServerSession>>;
export type WebResourcePort = ActiveWebSessionResourcePort;
export type WebResourceUse = ActiveWebSessionResourceUse;
export type WebResourceRegistration = ActiveWebSessionPrivateResourceRegistration;
export type WebResourceDisposer = ActiveWebSessionPrivateResourceDisposer;
export type WebRetirementReceipt = WebServerSessionRetirementCleanupReceipt;
export type WebRetirementReason = WebServerSessionRetirementReason;

export type LegacyWebSessionResolution = Readonly<
    | { readonly state: 'active'; readonly projection: WebSessionProjection }
    | { readonly state: 'owned_denied' }
    | { readonly state: 'absent' }
>;

function frozen<Value extends object>(value: Value): Readonly<Value> {
    return Object.freeze(value);
}

function projectionId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    try {
        if (isProxy(value) || getPrototypeOf(value) !== objectPrototype) return null;
        const descriptor = getOwnPropertyDescriptor(value, 'id');
        if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.length === 0) return null;
        return descriptor.value;
    } catch {
        return null;
    }
}

function activeProjection(value: unknown): WebSessionProjection | null {
    const id = projectionId(value);
    if (!id) return null;
    try {
        const current = resolveActiveWebServerSession(id);
        return current === value ? current : null;
    } catch {
        return null;
    }
}

/** Stateless aggregation point for the pre-cutover Web owner. */
/* @Codex */
export function begin(kind: unknown): WebAuthAttempt | null {
    return abortSafe(() => beginHistoricalWebAuth(kind), null);
}

/** Consumes one historical Web auth attempt; the attempt remains owner-held. */
/* @Codex */
export function issue(attempt: unknown, user: unknown): WebAuthIssue | null {
    return abortSafe(() => issueHistoricalWebAuth(attempt, user), null);
}

/** Burns one historical Web auth attempt. */
/* @Codex */
export function abort(attempt: unknown): boolean {
    return abortSafe(() => abortHistoricalWebAuth(attempt), false);
}

/**
 * Resolve the historical Web surface without exposing its internal cell.
 * A legacy Web map entry is owned-and-denied; native/system entries are absent.
 */
/* @Codex */
export function resolve(sessionId: unknown): LegacyWebSessionResolution {
    const active = abortSafe(() => resolveActiveWebServerSession(sessionId), null);
    if (active) return frozen({ state: 'active' as const, projection: active });
    if (typeof sessionId !== 'string' || sessionId.length === 0) return frozen({ state: 'absent' as const });
    const visible = abortSafe(() => peekSession(sessionId), null);
    return visible?.authChannel === 'web'
        ? frozen({ state: 'owned_denied' as const })
        : frozen({ state: 'absent' as const });
}

/** Retires one exact active projection, never a data-only session ID. */
/* @Codex */
export function retire(projection: unknown, reason: unknown): WebRetirementReceipt | null {
    const current = activeProjection(projection);
    if (!current) return null;
    return abortSafe(() => dispatchActiveWebServerSessionRetirement(current.id, reason), null);
}

/** Retires all current P3 Web sessions for the owner of one exact projection. */
/* @Codex */
export function retireForUser(projection: unknown): WebRetirementReceipt | null {
    const current = activeProjection(projection);
    if (!current) return null;
    return abortSafe(() => retireWebP3SessionsForUser(current.userId), null);
}

export function mintResourcePort(projection: unknown): WebResourcePort | null {
    return abortSafe(() => mintActiveWebSessionResourcePort(projection), null);
}

export function releaseResourcePort(port: unknown): boolean {
    return abortSafe(() => releaseActiveWebSessionResourcePort(port), false);
}

export function beginResourceUse(port: unknown): WebResourceUse | null {
    return abortSafe(() => beginActiveWebSessionResourceUse(port), null);
}

export function commitResourceUse(use: unknown): boolean {
    return abortSafe(() => commitActiveWebSessionResourceUse(use), false);
}

export function abortResourceUse(use: unknown): boolean {
    return abortSafe(() => abortActiveWebSessionResourceUse(use), false);
}

export function registerPrivateResource(
    port: unknown,
    dispose: WebResourceDisposer,
): WebResourceRegistration | null {
    return abortSafe(() => registerActiveWebSessionPrivateResource(port, dispose), null);
}

export function unregisterPrivateResource(port: unknown, registration: unknown): boolean {
    return abortSafe(() => unregisterActiveWebSessionPrivateResource(port, registration), false);
}

function abortSafe<Value>(operation: () => Value, fallback: Value): Value {
    try {
        return operation();
    } catch {
        return fallback;
    }
}
