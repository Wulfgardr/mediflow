/* @Codex — one named governed boundary, no free callback or boolean grant. */
import 'server-only';
import { appendChatGptEgressAudit } from '../ai-egress-audit';
import { assertOrdinaryProductConsent, type OrdinaryProductConsent } from '../chatgpt-product/product-consent';
import { readPreparedOrdinaryProfile, type PreparedOrdinaryProfile } from './ordinary-preparation';
import { readOrdinaryGovernance } from './ordinary-governance';
import { ExecutionError } from './execution-contract';
export async function assertOrdinaryEgress(preparation: PreparedOrdinaryProfile, consent: OrdinaryProductConsent): Promise<void> {
    assertOrdinaryProductConsent(consent, preparation);
    const before = readPreparedOrdinaryProfile(preparation);
    try {
        await readOrdinaryGovernance(before.functionId, before);
        assertOrdinaryProductConsent(consent, preparation);
        const after = readPreparedOrdinaryProfile(preparation);
        if (after !== before || after.payload !== before.payload || after.payloadSha256 !== before.payloadSha256) throw new Error('payload_changed');
        // An append failure is a denial. This is an authorization-to-attempt
        // record, not a fabricated claim of successful transmission.
        appendChatGptEgressAudit({ payload: after.payload, lane: after.functionId, entityCounts: after.entityCounts, status: 'allowed' });
    } catch {
        appendChatGptEgressAudit({ payload: before.payload, lane: before.functionId, entityCounts: before.entityCounts, status: 'closed_pending_redaction_lane' });
        throw new ExecutionError('unqualified_boundary');
    }
}
