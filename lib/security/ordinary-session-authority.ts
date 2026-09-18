/* @Codex */
import 'server-only';
import * as web from './web-auth-lifecycle-owner-adapter';
import * as native from './native-inference-lifecycle';

// These unions share lifetime operations, not issuance, registry or channel identity.
export type ServerSession = web.ServerSession;
export type OrdinarySession = web.WebSessionProjection | (web.ServerSession & { authChannel: 'native' });
export type ResourcePort = web.WebResourcePort | native.NativeInferencePort;
export type ResourceUse = web.WebResourceUse | native.NativeInferenceUse;
export type ResourceRegistration = web.WebResourceRegistration | native.NativeInferenceRegistration;
export type AuthenticationGeneration = web.WebAuthenticationGeneration | native.NativeInferenceGeneration;
export type ResourceBinding = web.WebResourceBinding | native.NativeInferenceBinding;
export type ResourceDisposer = web.WebResourceDisposer;
export function mintResourcePort(session: unknown): ResourcePort | null {
    // Both issuers authenticate opaque identity before inspecting caller-visible fields.
    return web.mintResourcePort(session) ?? native.mintResourcePort(session);
}
export const beginResourceUse = (port: unknown): ResourceUse | null => web.beginResourceUse(port) ?? native.beginResourceUse(port);
export const abortResourceUse = (use: unknown): boolean => web.abortResourceUse(use) || native.abortResourceUse(use);
export const commitResourceUse = (use: unknown): boolean => web.commitResourceUse(use) || native.commitResourceUse(use);
export const releaseResourcePort = (port: unknown): boolean => web.releaseResourcePort(port) || native.releaseResourcePort(port);
export function withCurrentResourceBinding(use: unknown, operation: (binding: ResourceBinding) => void): boolean {
    return web.withCurrentResourceBinding(use, operation) || native.withCurrentResourceBinding(use, operation);
}
export const registerPrivateResource = (port: unknown, dispose: ResourceDisposer): ResourceRegistration | null =>
    web.registerPrivateResource(port, dispose) ?? native.registerPrivateResource(port, dispose);
export const unregisterPrivateResource = (port: unknown, registration: unknown): boolean =>
    web.unregisterPrivateResource(port, registration) || native.unregisterPrivateResource(port, registration);
export function acquireOrdinarySessionResourceIdentity(session: unknown) {
    const port = mintResourcePort(session);
    if (!port) return null;
    const use = beginResourceUse(port); let retained = false;
    try {
        if (!use) return null;
        let generation: AuthenticationGeneration | undefined;
        if (!withCurrentResourceBinding(use, binding => { generation = binding.authenticationGeneration; }) || !generation) return null;
        retained = true; return { port, generation };
    } finally { if (use) abortResourceUse(use); if (!retained) releaseResourcePort(port); }
}

/** Read authority lifetime, not the sliding native cookie/session lookup TTL. */
export function readResourceExpiresAt(port: ResourcePort, sessionExpiresAt: number): number | null {
    if (!Number.isFinite(sessionExpiresAt)) return null;
    const use = beginResourceUse(port); if (!use) return null;
    let expiresAt: number | null = null;
    try {
        const current = withCurrentResourceBinding(use, binding => {
            expiresAt = 'expiresAt' in binding ? Math.min(sessionExpiresAt, binding.expiresAt) : sessionExpiresAt;
        });
        return current && expiresAt !== null && commitResourceUse(use) ? expiresAt : null;
    } finally { abortResourceUse(use); }
}
