/* @Codex */
import 'server-only';

import type { createTypedProjectionBroker } from '../typed-projection-broker';
import {
    type ActiveWebSessionResourcePort,
    registerActiveWebSessionPrivateResource,
    registerServerSessionResource,
    releaseActiveWebSessionResourcePort,
    unregisterActiveWebSessionPrivateResource,
} from './server-session';

export class ServerSessionProjectionBrokerBindingError extends Error {
    constructor() {
        super('Server session projection broker binding rejected: session_unavailable');
        this.name = 'ServerSessionProjectionBrokerBindingError';
    }
}

type ProjectionBrokerControl = ReturnType<typeof createTypedProjectionBroker>['control'];
const PromiseThen = Promise.prototype.then; const ReflectApply = Reflect.apply;

function containNativePromiseRejection(value: unknown): void {
    try { ReflectApply(PromiseThen, value, [undefined, () => undefined]); } catch {}
}

/**
 * Binds an already-created broker lease to one live server session.
 * A failed binding revokes the broker immediately so no unowned handle survives.
 */
export function bindProjectionBrokerToServerSession(
    sessionId: string,
    control: ProjectionBrokerControl,
): () => void {
    const unregister = registerServerSessionResource(sessionId, () => control.revoke());
    if (unregister) return unregister;

    try {
        control.revoke();
    } catch {
        // The binding error remains fixed and does not expose cleanup details.
    }
    throw new ServerSessionProjectionBrokerBindingError();
}

/**
 * Binds a broker to one opaque ACTIVE Web-session resource identity.
 * The binding never accepts or publishes session authority.
 */
/* @Codex */
export function bindProjectionBrokerToActiveWebSessionResource(
    port: ActiveWebSessionResourcePort,
    control: ProjectionBrokerControl,
): () => void {
    const registration = registerActiveWebSessionPrivateResource(port, () => control.revoke());
    if (!registration) {
        try {
            containNativePromiseRejection(control.revoke() as unknown);
        } catch {
            // Cleanup failures remain opaque at this security boundary.
        } finally {
            releaseActiveWebSessionResourcePort(port);
        }
        throw new ServerSessionProjectionBrokerBindingError();
    }

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        unregisterActiveWebSessionPrivateResource(port, registration);
        releaseActiveWebSessionResourcePort(port);
    };
}
