/* @Codex */
import 'server-only';

import * as legacy from './web-auth-lifecycle-owner-legacy';

export const lifecycleOwnerAdapterState = 'legacy_bridge_pre_cutover' as const;
export type LifecycleOwnerAdapterState = typeof lifecycleOwnerAdapterState;

export type WebAuthAttempt = legacy.WebAuthAttempt;
export type WebAuthIssue = legacy.WebAuthIssue;
export type WebSessionProjection = legacy.WebSessionProjection;
export type WebSessionResolution = legacy.LegacyWebSessionResolution;
export type WebResourcePort = legacy.WebResourcePort;
export type WebResourceUse = legacy.WebResourceUse;
export type WebResourceRegistration = legacy.WebResourceRegistration;
export type WebResourceDisposer = legacy.WebResourceDisposer;
export type WebRetirementReceipt = legacy.WebRetirementReceipt;
export type WebRetirementReason = legacy.WebRetirementReason;

/** The historical resolver cannot observe tombstoned P3 ownership without a new owner API. */
export const lifecycleOwnerAdapterResolutionGap = 'legacy resolver cannot distinguish an absent locator from a non-active P3 cell';
/** The historical owner has no prepare/commit/abort capability for administrative reset. */
export const lifecycleOwnerAdapterAdminResetGap = 'legacy owner exposes clearAllSessions only; admin reset prepare/commit/abort is denied';

export function begin(kind: unknown): WebAuthAttempt | null {
    return legacy.begin(kind);
}

export function issue(attempt: unknown, user: unknown): WebAuthIssue | null {
    return legacy.issue(attempt, user);
}

export function abort(attempt: unknown): boolean {
    return legacy.abort(attempt);
}

export function resolve(sessionId: unknown): WebSessionResolution {
    return legacy.resolve(sessionId);
}

export function retire(projection: unknown, reason: unknown): WebRetirementReceipt | null {
    return legacy.retire(projection, reason);
}

export function retireForUser(projection: unknown): WebRetirementReceipt | null {
    return legacy.retireForUser(projection);
}

/** Administrative reset is not expressible through the historical Web APIs. */
export function prepareAdminReset(projection: unknown): null {
    void projection;
    return null;
}

export function commitAdminReset(capability: unknown): false {
    void capability;
    return false;
}

export function abortAdminReset(capability: unknown): false {
    void capability;
    return false;
}

export function mintResourcePort(projection: unknown): WebResourcePort | null {
    return legacy.mintResourcePort(projection);
}

export function releaseResourcePort(port: unknown): boolean {
    return legacy.releaseResourcePort(port);
}

export function beginResourceUse(port: unknown): WebResourceUse | null {
    return legacy.beginResourceUse(port);
}

export function commitResourceUse(use: unknown): boolean {
    return legacy.commitResourceUse(use);
}

export function abortResourceUse(use: unknown): boolean {
    return legacy.abortResourceUse(use);
}

export function registerPrivateResource(
    port: unknown,
    dispose: WebResourceDisposer,
): WebResourceRegistration | null {
    return legacy.registerPrivateResource(port, dispose);
}

export function unregisterPrivateResource(port: unknown, registration: unknown): boolean {
    return legacy.unregisterPrivateResource(port, registration);
}
