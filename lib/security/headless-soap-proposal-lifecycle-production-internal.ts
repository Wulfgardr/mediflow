/* @Codex */
import 'server-only';

import { headlessSoapChildSessionLeaseProductionOwner } from './headless-soap-child-session-lease-production-internal';
import {
    createHeadlessSoapProposalLifecycleOwner, type HeadlessSoapSelectionLifecyclePortV1,
} from './headless-soap-proposal-lifecycle';
import { readAuthenticatedWebSession } from './server-auth';
import { serverSessionProjectionOwnerProductionOwner } from './server-session-projection-owner-production-internal';

const hostDateNow = Date.now;
const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;
const objectFreeze = Object.freeze;
type CurrentSelectionSession = NonNullable<Awaited<ReturnType<typeof readAuthenticatedWebSession>>>;

const selectionLifecycle = serverSessionProjectionOwnerProductionOwner.selectionLifecycleController;
const selectionPort: HeadlessSoapSelectionLifecyclePortV1 = objectFreeze({
    withCurrentSelection(session: unknown, operation: (scope: unknown) => void): boolean {
        return selectionLifecycle.withCurrentSelection(session as CurrentSelectionSession, operation);
    },
    registerDependent: selectionLifecycle.registerDependent,
    confirmDependent: selectionLifecycle.confirmDependent,
    unregisterDependent: selectionLifecycle.unregisterDependent,
    withCurrentDependent: selectionLifecycle.withCurrentDependent,
});

function scheduleProposalExpiry(delayMs: number, operation: () => void): () => void {
    let active = true;
    const timer = hostSetTimeout(() => { if (!active) return; active = false; operation(); }, delayMs);
    return () => { if (!active) return; active = false; hostClearTimeout(timer); };
}

/** Shared process owner for the public H3 service and the private H4 lifecycle. */
export const headlessSoapProposalLifecycleProductionOwner = createHeadlessSoapProposalLifecycleOwner({
    leaseLifecycle: headlessSoapChildSessionLeaseProductionOwner.lifecycleController,
    leaseService: headlessSoapChildSessionLeaseProductionOwner.service,
    selectionLifecycle: selectionPort,
    readCurrentSelectionSession: readAuthenticatedWebSession,
    clock: hostDateNow,
    scheduler: scheduleProposalExpiry,
});
