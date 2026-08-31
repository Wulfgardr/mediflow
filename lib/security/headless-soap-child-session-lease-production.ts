/* @Codex */
import 'server-only';

import { headlessSoapActiveRoleSessionGrantProductionOwner } from './headless-soap-active-role-session-grant-production-internal';
import { createHeadlessSoapChildSessionLeaseService } from './headless-soap-child-session-lease';

const lifecycle = headlessSoapActiveRoleSessionGrantProductionOwner.lifecycleController;

/** Process-local H2b lease boundary; it grants no clinical write authority. */
export const headlessSoapChildSessionLeaseService = createHeadlessSoapChildSessionLeaseService({
    withCurrentGrant: lifecycle.withCurrentGrant,
    registerDependent: lifecycle.registerDependent,
    confirmDependent: lifecycle.confirmDependent,
    unregisterDependent: lifecycle.unregisterDependent,
    withCurrentDependent: lifecycle.withCurrentDependent,
});
