/* @Codex */
import 'server-only';

import * as owner from '@mediflow/web-auth-lifecycle-owner';

export const lifecycleOwnerAdapterState = 'external_owner_active' as const;
export type LifecycleOwnerAdapterState = typeof lifecycleOwnerAdapterState;

export type WebAuthAttempt = owner.WebAuthAttempt;
export type WebAuthIssue = owner.WebAuthIssue;
export type WebControlBootstrap = owner.WebControlBootstrap;
export type WebControlTransport = owner.WebControlTransport;
export type WebSessionProjection = owner.WebSessionProjection;
export type WebSessionResolution = owner.WebSessionResolution;
export type WebResourcePort = owner.WebResourcePort;
export type WebResourceUse = owner.WebResourceUse;
export type WebResourceRegistration = owner.WebResourceRegistration;
export type WebResourceDisposer = owner.WebResourceDisposer;
export type WebAuthenticationGeneration = Readonly<{ readonly __webAuthenticationGeneration?: never }>;
export type WebResourceBinding = Readonly<{
    principalRef: string;
    authenticationGeneration: WebAuthenticationGeneration;
}>;
export type WebResourceBindingOperation = (binding: WebResourceBinding) => void;
export type WebRetirementReceipt = owner.WebRetirementReceipt;
export type WebUserRetirementCapability = owner.WebUserRetirementCapability;
export type WebRetirementReason = 'lock' | 'dispose' | 'expired' | 'delete' | 'clear';

export function bootstrapControl(controlId?: unknown): WebControlBootstrap | null {
    return owner.bootstrapControl(controlId);
}

export function begin(kind: unknown, transport: unknown): WebAuthAttempt | null {
    return owner.begin(kind, transport);
}

export function issue(attempt: unknown, user: unknown): WebAuthIssue | null {
    return owner.issue(attempt, user);
}

export function abort(attempt: unknown): boolean {
    return owner.abort(attempt);
}

export function resolve(sessionId: unknown, controlId: unknown): WebSessionResolution {
    return owner.resolve(sessionId, controlId);
}

export function retire(
    projection: unknown,
    reason: unknown,
    transport?: unknown,
): WebRetirementReceipt {
    return owner.retire(projection, reason, transport);
}

export function retireForUser(projection: unknown): WebRetirementReceipt {
    return owner.retireForUser(projection);
}

export function prepareUserRetirement(projection: unknown): WebUserRetirementCapability | null {
    return owner.prepareUserRetirement(projection);
}

export function commitUserRetirement(capability: unknown): WebRetirementReceipt {
    return owner.commitUserRetirement(capability);
}

export function abortUserRetirement(capability: unknown): boolean {
    return owner.abortUserRetirement(capability);
}

export function prepareAdminReset(projection: unknown): object | null {
    return owner.prepareAdminReset(projection);
}

export function commitAdminReset(capability: unknown): WebRetirementReceipt {
    return owner.commitAdminReset(capability);
}

export function abortAdminReset(capability: unknown): boolean {
    return owner.abortAdminReset(capability);
}

export function mintResourcePort(projection: unknown): WebResourcePort | null {
    return owner.mintResourcePort(projection);
}

export function releaseResourcePort(port: unknown): boolean {
    return owner.releaseResourcePort(port);
}

export function beginResourceUse(port: unknown): WebResourceUse | null {
    return owner.beginResourceUse(port);
}

export function commitResourceUse(use: unknown): boolean {
    return owner.commitResourceUse(use);
}

export function abortResourceUse(use: unknown): boolean {
    return owner.abortResourceUse(use);
}

export function withCurrentResourceBinding(
    use: unknown,
    operation: WebResourceBindingOperation,
): boolean {
    return (owner as typeof owner & {
        withCurrentResourceBinding(
            candidate: unknown,
            callback: WebResourceBindingOperation,
        ): boolean;
    }).withCurrentResourceBinding(use, operation);
}

export function registerPrivateResource(
    port: unknown,
    dispose: WebResourceDisposer,
): WebResourceRegistration | null {
    return owner.registerPrivateResource(port, dispose);
}

export function unregisterPrivateResource(port: unknown, registration: unknown): boolean {
    return owner.unregisterPrivateResource(port, registration);
}
