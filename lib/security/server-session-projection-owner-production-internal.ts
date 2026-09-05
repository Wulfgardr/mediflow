/* @Codex */
import 'server-only';

import { resolveCanonicalServerSessionClinicalContext } from './server-session-clinical-context-production';
import { createFullPortProjectionOwnerProcessOwner } from './server-session-projection-owner';

/** Internal singleton shared by the public registry and H3 selection lifecycle. */
export const serverSessionProjectionOwnerProductionOwner = createFullPortProjectionOwnerProcessOwner({
    resolve: resolveCanonicalServerSessionClinicalContext,
});
