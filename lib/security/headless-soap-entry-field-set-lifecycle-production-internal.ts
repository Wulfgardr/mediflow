/* @Codex */
import 'server-only';

import { createHeadlessSoapEntryFieldSetLifecycleOwner } from './headless-soap-entry-field-set-lifecycle';
import { headlessSoapProposalLifecycleProductionOwner } from './headless-soap-proposal-lifecycle-production-internal';

const hostDateNow = Date.now;

/** Shared process owner for the public H4 host service and the private H5 lifecycle. */
export const headlessSoapEntryFieldSetLifecycleProductionOwner = createHeadlessSoapEntryFieldSetLifecycleOwner({
    proposalLifecycle: headlessSoapProposalLifecycleProductionOwner.lifecycleController,
    proposalService: headlessSoapProposalLifecycleProductionOwner.service,
    clock: hostDateNow,
});
