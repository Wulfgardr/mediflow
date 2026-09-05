/* @Codex */
export type WebAuthKind = 'login' | 'setup';
export type WebAuthAttempt = Readonly<{ readonly __webAuthAttempt?: never }>;
export type WebSessionProjection = Readonly<{
    id: string;
    userId: string;
    username: string;
    role: string;
    authChannel: 'web';
    createdAt: number;
    expiresAt: number;
}>;
export type WebSessionResolution =
    | Readonly<{ status: 'active'; projection: WebSessionProjection }>
    | Readonly<{ status: 'owned_denied' }>
    | Readonly<{ status: 'absent' }>;
export type WebAuthIssue = Readonly<{ ok: true; sessionId: string; etag: string }>;
export type WebControlBootstrap = Readonly<{ controlId: string; etag: string }>;
export type WebControlTransport = Readonly<{ controlId: string; ifMatch: string; idempotencyKey: string }>;
export type WebRetirementReceipt = Readonly<{ outcome: 'completed' | 'failed' | 'denied'; etag?: string }>;
export type WebUserRetirementCapability = Readonly<{ readonly __webUserRetirementCapability?: never }>;
export type WebResourcePort = Readonly<{ readonly __webResourcePort?: never }>;
export type WebResourceUse = Readonly<{ readonly __webResourceUse?: never }>;
export type WebResourceRegistration = Readonly<{ readonly __webResourceRegistration?: never }>;
export type WebAuthenticationGeneration = Readonly<{ readonly __webAuthenticationGeneration?: never }>;
export type WebResourceBinding = Readonly<{
    principalRef: string;
    authenticationGeneration: WebAuthenticationGeneration;
}>;
export type WebResourceBindingOperation = (binding: WebResourceBinding) => void;
export type WebResourceDisposer = (reason: 'lock' | 'dispose' | 'expired' | 'delete' | 'clear') => unknown;

export declare function bootstrapControl(controlId?: unknown): WebControlBootstrap | null;
export declare function begin(kind: unknown, transport: unknown): WebAuthAttempt | null;
export declare function issue(attempt: unknown, user: unknown): WebAuthIssue | null;
export declare function abort(attempt: unknown): boolean;
export declare function resolve(sessionId: unknown, controlId: unknown): WebSessionResolution;
export declare function retire(projection: unknown, reason: unknown, transport?: unknown): WebRetirementReceipt;
export declare function retireForUser(projection: unknown): WebRetirementReceipt;
export declare function prepareUserRetirement(projection: unknown): WebUserRetirementCapability | null;
export declare function commitUserRetirement(capability: unknown): WebRetirementReceipt;
export declare function abortUserRetirement(capability: unknown): boolean;
export declare function prepareAdminReset(projection: unknown): object | null;
export declare function commitAdminReset(capability: unknown): WebRetirementReceipt;
export declare function abortAdminReset(capability: unknown): boolean;
export declare function mintResourcePort(projection: unknown): WebResourcePort | null;
export declare function releaseResourcePort(port: unknown): boolean;
export declare function beginResourceUse(port: unknown): WebResourceUse | null;
export declare function commitResourceUse(use: unknown): boolean;
export declare function abortResourceUse(use: unknown): boolean;
export declare function withCurrentResourceBinding(
    use: unknown,
    operation: WebResourceBindingOperation,
): boolean;
export declare function registerPrivateResource(
    port: unknown,
    dispose: WebResourceDisposer,
): WebResourceRegistration | null;
export declare function unregisterPrivateResource(port: unknown, registration: unknown): boolean;
