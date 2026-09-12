/* @Codex — exactly the unresolved ADR0033/0077 boundary, not a new grant API. */
import 'server-only';
import { isEgressGateOpen } from '../ai-egress-gate';
import { appendChatGptEgressAudit } from '../ai-egress-audit';
import { assertOrdinaryProductConsent, type OrdinaryProductConsent } from '../chatgpt-product/product-consent';
import { readPreparedOrdinaryProfile, type PreparedOrdinaryProfile } from './ordinary-preparation';
import { ExecutionError } from './execution-contract';

/** There is no positive admission issuer in the supplied sources. Even a future
 * global boolean cannot stand in for payload-bound opt-in/governance/retention.
 * A real evaluator must replace this missing boundary, not be injected by a caller.
 * The hash-only record describes a denial, NEVER transmission. */
export function assertOrdinaryEgress(preparation: PreparedOrdinaryProfile, consent: OrdinaryProductConsent): void {
    assertOrdinaryProductConsent(consent, preparation);
    const read = readPreparedOrdinaryProfile(preparation);
    const laneOpen = isEgressGateOpen();
    appendChatGptEgressAudit({ payload: read.payload, lane: read.functionId,
        entityCounts: read.entityCounts, status: 'closed_pending_redaction_lane' });
    if (!laneOpen) throw new ExecutionError('unqualified_boundary');
    // No governed, payload-bound positive result exists in this frozen context.
    throw new ExecutionError('unqualified_boundary');
}
