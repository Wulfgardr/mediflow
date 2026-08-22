/* @Codex */
import 'server-only';

import { resolveCanonicalServerSessionClinicalContext } from './server-session-clinical-context-production';
import { createServerSessionProjectionOwnerRegistry } from './server-session-projection-owner';

declare global {
    // eslint-disable-next-line no-var
    var __mediflowServerSessionProjectionOwnerRegistry: ReturnType<typeof createServerSessionProjectionOwnerRegistry> | undefined;
}

export const serverSessionProjectionOwnerRegistry = globalThis.__mediflowServerSessionProjectionOwnerRegistry
    ?? createServerSessionProjectionOwnerRegistry({ resolve: resolveCanonicalServerSessionClinicalContext });
globalThis.__mediflowServerSessionProjectionOwnerRegistry = serverSessionProjectionOwnerRegistry;
