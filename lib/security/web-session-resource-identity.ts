/* @Codex */
import 'server-only';
import * as owner from './web-auth-lifecycle-owner-adapter';

// Authenticate the projection before inspecting any caller-visible fields.
// The returned port belongs to the caller; generation is the owner's opaque
// active-cell identity, not a session ID or a projection object reference.
export function acquireWebSessionResourceIdentity(projection: owner.WebSessionProjection) {
    const port = owner.mintResourcePort(projection);
    if (!port) return null;
    let retained = false;
    const use = owner.beginResourceUse(port);
    try {
        if (!use) return null;
        let generation: owner.WebAuthenticationGeneration | undefined;
        const bound = owner.withCurrentResourceBinding(use, binding => {
            generation = binding.authenticationGeneration;
        });
        if (!bound || !generation) return null;
        retained = true;
        return { port, generation };
    } finally {
        if (use) owner.abortResourceUse(use);
        if (!retained) owner.releaseResourcePort(port);
    }
}
