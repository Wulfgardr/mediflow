/* @Codex */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { CHATGPT_SYNTHESIS_FIXTURE } from '../chatgpt-execution/synthetic-synthesis-fixture';
import { ProductError, PRODUCT_OPERATION, PRODUCT_DATA_CLASS, type ConsentRequest, type ProductDisclosure } from './product-contract';

/** Process-local grants, never serialized as bearer capabilities. */
export function createProductConsent(session: object, current: () => boolean, monotonic = () => performance.now(), wall = Date.now) {
    const digest = createHash('sha256').update(JSON.stringify(CHATGPT_SYNTHESIS_FIXTURE)).digest('hex');
    let disclosure: ProductDisclosure;
    type Binding = { session: object; context: string; qualification: string; deadline: number; expiresAt: number; digest: string };
    let bound: Binding | undefined;
    let grant: Binding | undefined;
    function reset() {
        grant = undefined; bound = undefined;
        disclosure = Object.freeze({ revision: randomUUID(), operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS,
            fixtureId: CHATGPT_SYNTHESIS_FIXTURE.fixtureId, inputSha256: digest, sources: CHATGPT_SYNTHESIS_FIXTURE.sources,
            egress: Object.freeze(['auth.openai.com:443', 'chatgpt.com:443'] as const), maximumDurationMs: 300000,
            proposalOnly: true, clinicalWrites: 0 });
    }
    reset();
    return Object.freeze({
        disclosure: () => disclosure, reset,
        /** Bind and rotate BEFORE the browser can see or accept the disclosure. */
        bind(context: string, qualification: string, remainingMs = 300_000, absoluteExpiresAt = Infinity) {
            if (!current()) throw new ProductError('session_expired');
            const wallNow = wall(), monotonicNow = monotonic();
            if (!Number.isFinite(remainingMs) || remainingMs <= 0 || absoluteExpiresAt !== Infinity
                && (!Number.isFinite(absoluteExpiresAt) || absoluteExpiresAt <= wallNow)) throw new ProductError('consent_stale');
            reset();
            const duration = Math.min(300_000, remainingMs, absoluteExpiresAt - wallNow);
            bound = { session, context, qualification, digest, deadline: monotonicNow + duration, expiresAt: wallNow + duration };
        },
        grant(request: ConsentRequest, context: string, qualification: string) {
            if (!current()) throw new ProductError('session_expired');
            if (request.operation !== PRODUCT_OPERATION || request.dataClass !== PRODUCT_DATA_CLASS || request.expectedDisclosureRevision !== disclosure.revision) throw new ProductError('consent_stale');
            if (grant || !bound || bound.context !== context || bound.qualification !== qualification
                || monotonic() >= bound.deadline || wall() >= bound.expiresAt) throw new ProductError('consent_stale');
            // A click cannot relabel old disclosure evidence or extend its life.
            grant = bound;
        },
        assert(context: string, qualification: string) {
            if (!current()) throw new ProductError('session_expired');
            if (!grant) throw new ProductError('consent_required');
            if (grant.session !== session || grant.context !== context || grant.qualification !== qualification || grant.digest !== digest
                || monotonic() >= grant.deadline || wall() >= grant.expiresAt) throw new ProductError('consent_stale');
        },
        expiresAt: () => grant ? Math.floor(grant.expiresAt) : null,
        remainingMs: () => grant ? Math.max(0, Math.min(grant.deadline - monotonic(), grant.expiresAt - wall())) : 0,
    });
}

// The DEMO above is unchanged. These records bind content, never egress admission.
import { types } from 'node:util';
import { readPreparedOrdinaryProfile, isPreparedOrdinaryProfileCurrent, closePreparedOrdinaryProfile, type PreparedOrdinaryProfile } from '../chatgpt-execution/ordinary-preparation';
import { parseOrdinaryConsentRequest, type OrdinaryContentDisclosure } from './product-contract';
export type OrdinaryProductConsent = object;
type OrdinaryRecord = {
    preparation: PreparedOrdinaryProfile; disclosure: OrdinaryContentDisclosure;
    localCurrent(): boolean; authenticate(): boolean; granted: boolean; close(): void;
};
const ordinaryConsents = new WeakMap<object, OrdinaryRecord>();
// A prepared content session belongs to one original consent/attempt only.
const claimedPreparations = new WeakSet<object>();
function ordinaryRecord(token: unknown): OrdinaryRecord {
    if (!token || typeof token !== 'object' || types.isProxy(token)) throw new ProductError('consent_stale');
    const record = ordinaryConsents.get(token);
    if (!record || !record.localCurrent()) throw new ProductError('consent_stale');
    return record;
}
/** Authenticates with the concrete owner, not a caller current()/approved boolean.
 * The dynamic import does not initialize the external owner for DEMO-only use.
 * Context revisions come from the existing host attempt; they do NOT certify the
 * clinical owner's acquisition. That owner's original lease/commit is still required. */
export async function createOrdinaryProductConsent(session: import('../security/ordinary-session-authority').OrdinarySession, preparation: PreparedOrdinaryProfile,
    binding: Readonly<{ contextRevision: string; attemptRevision: string; qualificationRevision: string; remainingMs: number }>) {
    const owner = await import('../security/ordinary-session-authority');
    // Do not inspect session fields or look up records before authentic mint.
    const port = owner.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    let ownsPreparation = false;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    let registration: ReturnType<typeof owner.registerPrivateResource>;
    const token = Object.freeze(Object.create(null));
    function close() {
        if (!active) return; active = false; clearTimeout(timer); ordinaryConsents.delete(token);
        if (ownsPreparation) void closePreparedOrdinaryProfile(preparation).catch(() => {});
        queueMicrotask(() => { if (registration) owner.unregisterPrivateResource(port, registration); owner.releaseResourcePort(port); });
    }
    try {
        const read = readPreparedOrdinaryProfile(preparation);
        if (claimedPreparations.has(preparation)) throw new ProductError('consent_stale');
        // Synchronous after authentic mint, before any possible owner callback.
        claimedPreparations.add(preparation); ownsPreparation = true;
        const { contextRevision, attemptRevision, qualificationRevision, remainingMs } = binding;
        if ([contextRevision, attemptRevision, qualificationRevision].some(value => typeof value !== 'string' || !value || value.length > 256)
            || !Number.isFinite(remainingMs) || remainingMs <= 0) throw new ProductError('consent_stale');
        const authorityExpiry = owner.readResourceExpiresAt(port, session.expiresAt);
        if (authorityExpiry === null) throw new ProductError('session_expired');
        const duration = Math.min(remainingMs, 300_000, authorityExpiry - Date.now());
        if (duration <= 0) throw new ProductError('session_expired');
        const deadline = performance.now() + duration, expiresAt = Date.now() + duration;
        const localCurrent = () => active && performance.now() < deadline && Date.now() < expiresAt && isPreparedOrdinaryProfileCurrent(preparation);
        const authenticate = () => {
            if (!localCurrent()) return false;
            const use = owner.beginResourceUse(port); if (!use) return false;
            owner.abortResourceUse(use); return localCurrent();
        };
        const disclosure: OrdinaryContentDisclosure = Object.freeze({ schema: 'mediflow.chatgpt-ordinary-disclosure.v1', revision: randomUUID(),
            operation: read.functionId, profileVersion: read.profileVersion, contextRevision, attemptRevision, qualificationRevision,
            sourceSha256: read.sourceSha256, payloadSha256: read.payloadSha256, payloadBytes: read.payloadBytes,
            egress: Object.freeze(['auth.openai.com:443', 'chatgpt.com:443'] as const), proposalOnly: true, clinicalWrites: 0 });
        const record: OrdinaryRecord = { preparation, disclosure, localCurrent, authenticate, granted: false, close };
        registration = owner.registerPrivateResource(port, close);
        if (!registration || !authenticate()) throw new ProductError('session_expired');
        ordinaryConsents.set(token, record);
        timer = setTimeout(close, duration); timer.unref?.();
        return Object.freeze({ token, disclosure: () => { ordinaryRecord(token); return disclosure; },
            grant(raw: unknown) {
                if (types.isProxy(raw)) throw new ProductError('invalid_request');
                const request = parseOrdinaryConsentRequest(raw);
                if (!authenticate() || record.granted || request.operation !== read.functionId || request.expectedDisclosureRevision !== disclosure.revision) throw new ProductError('consent_stale');
                const use = owner.beginResourceUse(port); if (!use) { close(); throw new ProductError('session_expired'); }
                try {
                    const bound = owner.withCurrentResourceBinding(use, () => { if (localCurrent()) record.granted = true; });
                    if (!bound || !record.granted || !owner.commitResourceUse(use) || !localCurrent()) { close(); throw new ProductError('consent_stale'); }
                } catch (error) {
                    close();
                    throw error instanceof ProductError ? error : new ProductError('consent_stale');
                } finally { owner.abortResourceUse(use); }
            }, close,
        });
    } catch (error) { close(); throw error instanceof ProductError ? error : new ProductError('consent_stale'); }
}
/** Outside owner critical sections only. */
export function assertOrdinaryProductConsent(token: OrdinaryProductConsent, preparation: PreparedOrdinaryProfile): void {
    const record = ordinaryRecord(token);
    if (record.preparation !== preparation || !record.granted) throw new ProductError('consent_required');
    if (!record.authenticate()) { record.close(); throw new ProductError('session_expired'); }
    const read = readPreparedOrdinaryProfile(preparation);
    if (record.disclosure.payloadSha256 !== read.payloadSha256 || record.disclosure.sourceSha256 !== read.sourceSha256
        || record.disclosure.operation !== read.functionId || record.disclosure.profileVersion !== read.profileVersion) { record.close(); throw new ProductError('consent_stale'); }
}
/** Local-only witness check, safe INSIDE the original owner's binding. */
export function ordinaryConsentIsCurrent(token: OrdinaryProductConsent, preparation: PreparedOrdinaryProfile): boolean {
    try { const record = ordinaryRecord(token); return record.preparation === preparation && record.granted; } catch { return false; }
}
export function closeOrdinaryProductConsent(token: OrdinaryProductConsent): void {
    if (token && typeof token === 'object' && !types.isProxy(token)) ordinaryConsents.get(token)?.close();
}
