/* @Codex */
import 'server-only';

import { resolveCanonicalServerSessionClinicalContext } from './server-session-clinical-context-production';
import { createFullPortProjectionOwnerFactory } from './server-session-projection-owner';

export const serverSessionProjectionOwnerRegistry = createFullPortProjectionOwnerFactory({
    resolve: resolveCanonicalServerSessionClinicalContext,
});
