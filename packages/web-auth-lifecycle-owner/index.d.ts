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

/* @Codex: isolated native/system compatibility surface, same physical root. */
export namespace serverSessions {
const nativeResourcePort: unique symbol;
const nativeResourceUse: unique symbol;
const nativeResourceRegistration: unique symbol;
const nativeAuthenticationGeneration: unique symbol;
type NativeSessionResourcePort = Readonly<{ readonly [nativeResourcePort]: never }>;
type NativeSessionResourceUse = Readonly<{ readonly [nativeResourceUse]: never }>;
type NativeSessionResourceRegistration = Readonly<{ readonly [nativeResourceRegistration]: never }>;
type NativeAuthenticationGeneration = Readonly<{ readonly [nativeAuthenticationGeneration]: never }>;
type NativeSessionResourceBinding = Readonly<{
    principalRef: string; authenticationGeneration: NativeAuthenticationGeneration;
    sessionId: string; username: string; role: string; clientId: string;
    clientPlatform: 'macos'; tokenHash: string; expiresAt: number;
}>;
function mintNativeSessionResourcePort(session: unknown): NativeSessionResourcePort | null;
function releaseNativeSessionResourcePort(port: unknown): boolean;
function beginNativeSessionResourceUse(port: unknown): NativeSessionResourceUse | null;
function commitNativeSessionResourceUse(use: unknown): boolean;
function abortNativeSessionResourceUse(use: unknown): boolean;
function withCurrentNativeSessionResourceBinding(use: unknown, operation: (binding: NativeSessionResourceBinding) => void): boolean;
function registerNativeSessionPrivateResource(port: unknown, dispose: WebResourceDisposer): NativeSessionResourceRegistration | null;
function unregisterNativeSessionPrivateResource(port: unknown, registration: unknown): boolean;
function revokeNativeSessionResourceAuthority(session: unknown): boolean;

const SESSION_COOKIE_NAME = "mediflow_session";
type ServerSessionDisposalReason = 'session_deleted' | 'session_expired' | 'sessions_cleared' | 'application_locked';
type ServerSessionResourceDisposer = (reason: ServerSessionDisposalReason) => void;
type ServerSessionCleanupOutcome = 'completed' | 'failed' | 'unknown';
type WebServerSessionRetirementReason = 'lock' | 'dispose' | 'expired' | 'delete' | 'clear';
type WebServerSessionRetirementCleanupOutcome = 'completed' | 'failed' | 'denied';
type WebServerSessionRetirementCleanupReceipt = Readonly<{
    outcome: WebServerSessionRetirementCleanupOutcome;
}>;
interface ServerSession {
    id: string;
    userId: string;
    username: string;
    role: string;
    authChannel: 'web' | 'native' | 'system';
    createdAt: number;
    expiresAt: number;
}
type NativeServerSessionBinding = Readonly<{
    clientId: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
    tokenHash?: string;
}>;
const nativeSystemAdminResetCapability: unique symbol;
type NativeSystemAdminResetCapability = {
    readonly [nativeSystemAdminResetCapability]: never;
};
const nativeLegacyUserRetirementCapability: unique symbol;
type NativeLegacyUserRetirementCapability = {
    readonly [nativeLegacyUserRetirementCapability]: never;
};
const nativeLoginSessionFence: unique symbol;
type NativeLoginSessionFence = {
    readonly [nativeLoginSessionFence]: never;
};
type NativeSystemSessionOperationReceipt = Readonly<{
    outcome: 'completed' | 'failed' | 'denied';
}>;
const stagedWebSessionCapsule: unique symbol;
type StagedWebServerSession = {
    readonly [stagedWebSessionCapsule]: never;
};
const preparedWebSessionCapability: unique symbol;
type PreparedWebServerSession = {
    readonly [preparedWebSessionCapability]: never;
};
const armedWebSessionPort: unique symbol;
type ArmedWebServerSessionPort = {
    readonly [armedWebSessionPort]: never;
};
const activeWebSessionResourcePort: unique symbol;
type ActiveWebSessionResourcePort = {
    readonly [activeWebSessionResourcePort]: never;
};
const activeWebSessionResourceUse: unique symbol;
type ActiveWebSessionResourceUse = {
    readonly [activeWebSessionResourceUse]: never;
};
const activeWebSessionPrivateResourceRegistration: unique symbol;
type ActiveWebSessionPrivateResourceRegistration = {
    readonly [activeWebSessionPrivateResourceRegistration]: never;
};
type ActiveWebSessionPrivateResourceDisposer = (reason: WebServerSessionRetirementReason) => unknown;
function registerServerSessionResource(sessionId: string, dispose: ServerSessionResourceDisposer): (() => void) | null;
function createSession(user: {
    id: string;
    username: string;
    role: string;
}, authChannel?: ServerSession['authChannel']): ServerSession;
/** Captures an opaque one-shot fence before native credential verification. */
function captureNativeLoginSessionFence(): NativeLoginSessionFence;
function createNativeServerSession(user: {
    id: string;
    username: string;
    role: string;
}, binding: NativeServerSessionBinding, loginFence?: NativeLoginSessionFence): ServerSession;
/** Compatibility accepts only the exact process-local native session and its admitted pair. */
function isPairedNativeServerSession(session: unknown, binding: unknown): session is ServerSession & {
    authChannel: 'native';
};
/** Stages only exact host-owned Web user data; the capsule has no observable session fields. */
function stageWebServerSession(user: unknown): StagedWebServerSession | null;
/** Consumes a staged Web capsule into one private, unpublishable Web-session reservation. */
function prepareStagedWebServerSession(capsule: unknown): PreparedWebServerSession | null;
/** Returns only the reserved ID to the holder of the exact private capability. */
function getPreparedWebServerSessionId(capability: unknown): string | null;
/** Burns one prepared capability into its final inert, non-resolvable session cell. */
function armPreparedWebServerSession(capability: unknown): ArmedWebServerSessionPort | null;
/** Returns only the exact private ID of an authentic armed cell; it grants no session authority. */
function getArmedWebServerSessionId(port: unknown): string | null;
/** Converts an authentic armed cell to its terminal, non-reactivatable tombstone. */
function tombstoneArmedWebServerSession(port: unknown): boolean;
/** Atomically splices one exact P2 CAS into its already-installed inert P3 cell. */
function activateArmedWebServerSession(port: unknown, ticket: unknown): boolean;
/** Retires one exact ACTIVE Web cell through its privately retained P2 ticket. */
function retireActiveWebServerSession(sessionId: unknown, reason: unknown): boolean;
/** Commits a prepared Web session once without exposing session authority. */
function commitPreparedWebServerSession(capability: unknown): boolean;
/** Aborts a private prepared Web-session reservation without publication. */
function abortPreparedWebServerSession(capability: unknown): boolean;
/** Compatibility wrapper for callers that do not need an external terminal turn. */
function activateStagedWebServerSession(capsule: unknown): ServerSession | null;
/** Aborts a pending Web session without ever publishing it. */
function abortStagedWebServerSession(capsule: unknown): boolean;
/** Resolves only one exact ACTIVE P3 Web cell without publishing it to the legacy session map. */
function resolveActiveWebServerSession(sessionId: unknown): ServerSession | null;
/** Mints one opaque resource identity for the exact process-local ACTIVE Web session. */
function mintActiveWebSessionResourcePort(session: unknown): ActiveWebSessionResourcePort | null;
/** Releases one exact resource identity without invoking consumer code. */
function releaseActiveWebSessionResourcePort(port: unknown): boolean;
/** Begins one opaque, process-local resource use for the exact active port. */
function beginActiveWebSessionResourceUse(port: unknown): ActiveWebSessionResourceUse | null;
/** Commits one exact use; consumers publish staged effects only after true. */
function commitActiveWebSessionResourceUse(use: unknown): boolean;
/** Aborts one exact use without invoking consumer code. */
function abortActiveWebSessionResourceUse(use: unknown): boolean;
/** Registers one opaque, one-use cleanup against an exact ACTIVE Web resource port. */
function registerActiveWebSessionPrivateResource(port: unknown, dispose: ActiveWebSessionPrivateResourceDisposer): ActiveWebSessionPrivateResourceRegistration | null;
/** Burns one exact cleanup registration without invoking consumer code. */
function unregisterActiveWebSessionPrivateResource(port: unknown, registration: unknown): boolean;
function getSession(sessionId: string | null | undefined): ServerSession | null;
function peekSession(sessionId: string | null | undefined): ServerSession | null;
function deleteSession(sessionId: string | null | undefined): void;
function invalidateServerSessionForApplicationLock(sessionId: string): Readonly<{
    sessionBeforeDeletion: ServerSession | null;
    cleanupOutcome: ServerSessionCleanupOutcome;
    authorityAbsent: boolean;
}>;
function invalidateSessionsForUser(userId: string): void;
/** Prepares the native/system half of the fixed administrative reset.
 * The capability owns only server-marked native/system authority. */
function prepareNativeSystemAdminReset(): NativeSystemAdminResetCapability | null;
/** Commits one exact prepared native/system administrative reset. */
function commitNativeSystemAdminReset(capability: unknown): NativeSystemSessionOperationReceipt;
/** Burns one exact prepared native/system reset without changing sessions. */
function abortNativeSystemAdminReset(capability: unknown): boolean;
/** Prepares native authority retirement for one user and snapshots only inert legacy-Web cleanup. */
function prepareNativeLegacyUserRetirement(userId: unknown): NativeLegacyUserRetirementCapability | null;
/** Prepares PIN retirement from exact live native authority, never from a caller userId. */
function preparePairedNativePinRetirement(session: unknown): NativeLegacyUserRetirementCapability | null;
/** Commits the exact native authority retirement and inert legacy-Web cleanup prepared for one user. */
function commitNativeLegacyUserRetirement(capability: unknown): NativeSystemSessionOperationReceipt;
/** Burns one exact prepared per-user native retirement without changing sessions. */
function abortNativeLegacyUserRetirement(capability: unknown): boolean;
function clearAllSessions(): void;
/** Retires one exact Web or legacy session for a server-owned logout/delete cause. */
function retireServerSessionForLogout(sessionId: unknown): WebServerSessionRetirementCleanupReceipt;
/** Retires one exact Web or legacy session for a server-owned lock/dispose cause. */
function retireServerSessionForApplicationLock(sessionId: unknown): WebServerSessionRetirementCleanupReceipt;
/** Retires one exact Web or legacy session only after server-owned expiry observation. */
function retireExpiredServerSession(sessionId: unknown): WebServerSessionRetirementCleanupReceipt;
/** Retires every exact P3 and legacy Web/native session owned by one canonical user.
 * The receipt is an outcome value for this invocation; no operation record is retained. */
function retireServerSessionsForUser(userId: unknown): WebServerSessionRetirementCleanupReceipt;
/** Retires only one user's P3 Web authority and its uncommitted P3 Web work. */
function retireWebP3SessionsForUser(userId: unknown): WebServerSessionRetirementCleanupReceipt;
/** Compacts one exact RETIRED Web cell into its terminal owner-private tombstone. */
function cleanupRetiredWebServerSession(sessionId: unknown, reason: unknown): WebServerSessionRetirementCleanupReceipt;
/** Retires and terminally compacts one exact ACTIVE Web session by controlled reason. */
function dispatchActiveWebServerSessionRetirement(sessionId: unknown, reason: unknown): WebServerSessionRetirementCleanupReceipt;
}
export function prepareNativeUserRetirement(capability: unknown): WebUserRetirementCapability | null;
