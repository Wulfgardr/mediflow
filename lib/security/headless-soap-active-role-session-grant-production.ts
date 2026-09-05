/* @Codex */
import 'server-only';

import { headlessSoapActiveRoleSessionGrantProductionOwner } from './headless-soap-active-role-session-grant-production-internal';

/** Process-local prerequisite only; it grants no downstream authority. */
export const headlessSoapActiveRoleSessionGrantService = headlessSoapActiveRoleSessionGrantProductionOwner.service;
