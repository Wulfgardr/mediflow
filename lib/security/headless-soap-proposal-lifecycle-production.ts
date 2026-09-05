/* @Codex */
import 'server-only';

import { headlessSoapProposalLifecycleProductionOwner } from './headless-soap-proposal-lifecycle-production-internal';

/** Memory-only SOAP proposal service; it grants no clinical write authority. */
export const headlessSoapProposalLifecycleService = headlessSoapProposalLifecycleProductionOwner.service;
