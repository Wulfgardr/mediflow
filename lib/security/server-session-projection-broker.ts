/* @Codex */
import 'server-only';

import type { createTypedProjectionBroker } from '../typed-projection-broker';
import { registerServerSessionResource } from './server-session';

export class ServerSessionProjectionBrokerBindingError extends Error {
    constructor() {
        super('Server session projection broker binding rejected: session_unavailable');
        this.name = 'ServerSessionProjectionBrokerBindingError';
    }
}

type ProjectionBrokerControl = ReturnType<typeof createTypedProjectionBroker>['control'];

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
