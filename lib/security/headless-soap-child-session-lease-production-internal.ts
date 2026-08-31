/* @Codex */
import 'server-only';

import { headlessSoapActiveRoleSessionGrantProductionOwner } from './headless-soap-active-role-session-grant-production-internal';
import { createHeadlessSoapChildSessionLeaseOwner } from './headless-soap-child-session-lease';

const activeRoleLifecycle = headlessSoapActiveRoleSessionGrantProductionOwner.lifecycleController;

/** Internal process owner shared by the H2b facade and future host lifecycle controllers. */
export const headlessSoapChildSessionLeaseProductionOwner = createHeadlessSoapChildSessionLeaseOwner({
    withCurrentGrant: activeRoleLifecycle.withCurrentGrant,
    registerDependent: activeRoleLifecycle.registerDependent,
    confirmDependent: activeRoleLifecycle.confirmDependent,
    unregisterDependent: activeRoleLifecycle.unregisterDependent,
    withCurrentDependent: activeRoleLifecycle.withCurrentDependent,
});
