/* @Codex */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { CHATGPT_SYNTHESIS_FIXTURE } from '../chatgpt-execution/synthetic-synthesis-fixture';
import { ProductError, PRODUCT_OPERATION, PRODUCT_DATA_CLASS, type ConsentRequest, type ProductDisclosure } from './product-contract';

/** Process-local grants, never serialized as bearer capabilities. */
export function createProductConsent(session: object, current: () => boolean, monotonic = () => performance.now(), wall = Date.now) {
    const digest = createHash('sha256').update(JSON.stringify(CHATGPT_SYNTHESIS_FIXTURE)).digest('hex');
    let disclosure: ProductDisclosure;
    let grant: { session: object; context: string; qualification: string; deadline: number; expiresAt: number; digest: string } | undefined;
    function reset() {
        grant = undefined;
        disclosure = Object.freeze({ revision: randomUUID(), operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS,
            fixtureId: CHATGPT_SYNTHESIS_FIXTURE.fixtureId, inputSha256: digest, sources: CHATGPT_SYNTHESIS_FIXTURE.sources,
            egress: Object.freeze(['auth.openai.com:443', 'chatgpt.com:443'] as const), maximumDurationMs: 300000,
            proposalOnly: true, clinicalWrites: 0 });
    }
    reset();
    return Object.freeze({
        disclosure: () => disclosure, reset,
        grant(request: ConsentRequest, context: string, qualification: string) {
            if (!current()) throw new ProductError('session_expired');
            if (request.operation !== PRODUCT_OPERATION || request.dataClass !== PRODUCT_DATA_CLASS || request.expectedDisclosureRevision !== disclosure.revision) throw new ProductError('consent_stale');
            if (grant) throw new ProductError('consent_stale');
            grant = { session, context, qualification, digest, deadline: monotonic() + 300_000, expiresAt: wall() + 300_000 };
        },
        assert(context: string, qualification: string) {
            if (!current()) throw new ProductError('session_expired');
            if (!grant) throw new ProductError('consent_required');
            if (grant.session !== session || grant.context !== context || grant.qualification !== qualification || grant.digest !== digest
                || monotonic() >= grant.deadline || wall() >= grant.expiresAt) throw new ProductError('consent_stale');
        },
        expiresAt: () => grant?.expiresAt ?? null,
        remainingMs: () => grant ? Math.max(0, Math.min(grant.deadline - monotonic(), grant.expiresAt - wall())) : 0,
    });
}
