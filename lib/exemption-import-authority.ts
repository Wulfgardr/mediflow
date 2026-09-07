/* @Codex */
import 'server-only';
import type { ServerSession } from './security/server-auth';
import {
    abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort,
    registerPrivateResource, releaseResourcePort, unregisterPrivateResource,
} from './security/web-auth-lifecycle-owner-adapter';
import { ExemptionImportError } from './exemption-catalog-import';

/** A request-local resource of the authenticated web generation, never a client token. */
export function acquireExemptionImportAuthority(session: ServerSession) {
    const denied = () => new ExemptionImportError('EXEMPTION_IMPORT_AUTHORITY_REVOKED', 'Sessione non più attiva.', 401);
    const port = mintResourcePort(session);
    if (!port || session.authChannel !== 'web') { if (port) releaseResourcePort(port); throw denied(); }
    const controller = new AbortController();
    const registration = registerPrivateResource(port, () => controller.abort());
    if (!registration) { releaseResourcePort(port); throw denied(); }
    let disposed = false;
    return {
        signal: controller.signal,
        assertCurrent() {
            if (disposed || controller.signal.aborted) throw denied();
            const use = beginResourceUse(port);
            if (!use) throw denied();
            if (!commitResourceUse(use)) { abortResourceUse(use); throw denied(); }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            unregisterPrivateResource(port, registration);
            releaseResourcePort(port);
            controller.abort();
        },
    };
}
