/* @Codex */
import 'server-only';

import { headlessSoapChildSessionLeaseProductionOwner } from './headless-soap-child-session-lease-production-internal';

/** Process-local H2b lease boundary; it grants no clinical write authority. */
export const headlessSoapChildSessionLeaseService = headlessSoapChildSessionLeaseProductionOwner.service;
