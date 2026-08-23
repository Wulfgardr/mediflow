/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { createDurableCurrentReviewLocator, type DurableCurrentReviewIdentity } from '../ai-providers/fabric/durable-current-review-locator';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { registerServerSessionResource, type ServerSession } from './server-session';
import { type ServerSessionProjectionOwner } from './server-session-projection-owner';
import { sessionPhysicianReviewAuthority, type SessionPhysicianReviewAuthorityV1 } from './session-physician-review-authority';

const SCHEMA_VERSION = 'mediflow.active-review-binding.v1' as const;
const AUTHORITY_SCHEMA_VERSION = 'mediflow.session-physician-review-authority.v1' as const;

type Owner = Pick<ServerSessionProjectionOwner, 'snapshotReviewContextEpoch' | 'snapshotSelectionEpoch' | 'withLeaseCriticalSection'>;
type Context = Readonly<{ owner: Owner; session: ServerSession }>;
type BindingRecord = {
    active: boolean;
    authority: SessionPhysicianReviewAuthorityV1;
    binding: ActiveReviewBindingV1;
    patientId: string;
    reviewContextEpoch: number;
    reviewId: string;
    reviewRevision: number;
    session: ServerSession;
    selectionEpoch: number;
    unregister: (() => void) | null;
};

export type ActiveReviewBindingV1 = Readonly<{
    schemaVersion: typeof SCHEMA_VERSION;
}>;

export type ActiveReviewBindingErrorCode = 'authority_unavailable' | 'binding_stale' | 'binding_unavailable' | 'context_unavailable' | 'input_invalid' | 'review_unavailable' | 'session_unavailable';

export class ActiveReviewBindingError extends Error {
    constructor(readonly code: ActiveReviewBindingErrorCode) {
        super(`Active review binding rejected: ${code}`);
        this.name = 'ActiveReviewBindingError';
    }
}

export type ActiveReviewBindingSources = Readonly<{
    acquireContext(): Promise<Context | null>;
    deriveAuthority(): Promise<SessionPhysicianReviewAuthorityV1>;
    locateCurrentReview(patientId: string): DurableCurrentReviewIdentity;
    recheckAuthority(candidate: unknown): Promise<SessionPhysicianReviewAuthorityV1>;
    registerSessionResource: typeof registerServerSessionResource;
}>;

function fail(code: ActiveReviewBindingErrorCode): never {
    throw new ActiveReviewBindingError(code);
}

function exactSources(value: unknown): ActiveReviewBindingSources {
    const keys = ['acquireContext', 'deriveAuthority', 'locateCurrentReview', 'recheckAuthority', 'registerSessionResource'] as const;
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
            || Reflect.ownKeys(value).length !== keys.length) return fail('input_invalid');
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') return fail('input_invalid');
            result[key] = descriptor.value;
        }
        return Object.freeze(result) as ActiveReviewBindingSources;
    } catch (error) {
        if (error instanceof ActiveReviewBindingError) throw error;
        return fail('input_invalid');
    }
}

function context(value: unknown): Context {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
            || Reflect.ownKeys(value).length !== 2) return fail('context_unavailable');
        const session = Object.getOwnPropertyDescriptor(value, 'session')?.value;
        const owner = Object.getOwnPropertyDescriptor(value, 'owner')?.value;
        const ownerDescriptors = owner && typeof owner === 'object' && !types.isProxy(owner) ? Object.getOwnPropertyDescriptors(owner) : null;
        if (!session || typeof session !== 'object' || types.isProxy(session) || !ownerDescriptors
            || !['withLeaseCriticalSection', 'snapshotSelectionEpoch', 'snapshotReviewContextEpoch'].every((key) => 'value' in (ownerDescriptors[key] ?? {}) && typeof ownerDescriptors[key]?.value === 'function')) return fail('context_unavailable');
        return Object.freeze({ owner: owner as Owner, session: session as ServerSession });
    } catch (error) {
        if (error instanceof ActiveReviewBindingError) throw error;
        return fail('context_unavailable');
    }
}

function authority(value: unknown, session: ServerSession): SessionPhysicianReviewAuthorityV1 {
    const keys = ['schemaVersion', 'actorRef', 'attestationVersion', 'authenticated', 'unlocked', 'expiresAt', 'sessionGeneration', 'revocationGeneration'] as const;
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail('authority_unavailable');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).length !== keys.length || !keys.every((key) => 'value' in (descriptors[key] ?? {}))) return fail('authority_unavailable');
        const candidate = descriptors as Record<(typeof keys)[number], PropertyDescriptor>;
        if (candidate.schemaVersion.value !== AUTHORITY_SCHEMA_VERSION || candidate.actorRef.value !== session.userId
            || candidate.attestationVersion.value !== 1 || candidate.authenticated.value !== true || candidate.unlocked.value !== true
            || !Number.isFinite(candidate.expiresAt.value) || (candidate.expiresAt.value as number) <= Date.now()
            || typeof candidate.sessionGeneration.value !== 'string' || candidate.sessionGeneration.value.length === 0
            || typeof candidate.revocationGeneration.value !== 'string' || candidate.revocationGeneration.value.length === 0) return fail('authority_unavailable');
        return value as SessionPhysicianReviewAuthorityV1;
    } catch (error) {
        if (error instanceof ActiveReviewBindingError) throw error;
        return fail('authority_unavailable');
    }
}

function review(value: unknown): DurableCurrentReviewIdentity {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
            || Reflect.ownKeys(value).length !== 2) return fail('review_unavailable');
        const reviewId = Object.getOwnPropertyDescriptor(value, 'reviewId');
        const reviewRevision = Object.getOwnPropertyDescriptor(value, 'reviewRevision');
        if (!reviewId || !('value' in reviewId) || !reviewRevision || !('value' in reviewRevision)
            || typeof reviewId.value !== 'string' || !/^review_[0-9a-f]{32}$/u.test(reviewId.value)
            || !Number.isSafeInteger(reviewRevision.value) || (reviewRevision.value as number) < 1) return fail('review_unavailable');
        return Object.freeze({ reviewId: reviewId.value, reviewRevision: reviewRevision.value as number });
    } catch (error) {
        if (error instanceof ActiveReviewBindingError) throw error;
        return fail('review_unavailable');
    }
}

function opaqueBinding(): ActiveReviewBindingV1 {
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        // The enumerable guard makes JSON and structured cloning lose the capability rather than its host ownership.
        toJSON: () => undefined,
    });
}

/** Composes one current durable review under the authoritative session lease; no caller input is accepted. */
export function createActiveReviewBindingService(sourceValue: unknown) {
    const sources = exactSources(sourceValue);
    const records = new WeakMap<object, BindingRecord>();
    const bindings = new WeakMap<object, BindingRecord>();

    const discard = (record: BindingRecord): void => {
        record.active = false;
        records.delete(record.session);
        bindings.delete(record.binding);
        record.unregister?.();
        record.unregister = null;
    };

    const service = {
        async resolve(): Promise<ActiveReviewBindingV1> {
            let acquired: Context | null;
            try { acquired = await sources.acquireContext(); } catch { return fail('context_unavailable'); }
            if (!acquired) return fail('session_unavailable');
            const current = context(acquired);

            let derived: SessionPhysicianReviewAuthorityV1;
            let rechecked: SessionPhysicianReviewAuthorityV1;
            try {
                derived = await sources.deriveAuthority();
                rechecked = await sources.recheckAuthority(derived);
            } catch (error) {
                throw error;
            }
            const verifiedAuthority = authority(rechecked, current.session);

            return current.owner.withLeaseCriticalSection(current.session, (selection) => {
                const selectionEpoch = current.owner.snapshotSelectionEpoch(current.session);
                const reviewContextEpoch = current.owner.snapshotReviewContextEpoch(current.session);
                const identity = review(sources.locateCurrentReview(selection.patientId));
                const existing = records.get(current.session);
                if (existing?.active && existing.authority === verifiedAuthority && existing.patientId === selection.patientId
                    && existing.selectionEpoch === selectionEpoch && existing.reviewContextEpoch === reviewContextEpoch
                    && existing.reviewId === identity.reviewId && existing.reviewRevision === identity.reviewRevision) {
                    return existing.binding;
                }

                const record: BindingRecord = {
                    active: true, authority: verifiedAuthority, binding: opaqueBinding(), patientId: selection.patientId,
                    reviewContextEpoch, reviewId: identity.reviewId, reviewRevision: identity.reviewRevision, session: current.session, selectionEpoch, unregister: null,
                };
                let unregister: (() => void) | null;
                try { unregister = sources.registerSessionResource(current.session.id, () => discard(record)); }
                catch { return fail('session_unavailable'); }
                if (!unregister) return fail('session_unavailable');
                record.unregister = unregister;
                if (existing) discard(existing);
                records.set(current.session, record);
                bindings.set(record.binding, record);
                return record.binding;
            });
        },
        async revalidate(candidate: unknown): Promise<ActiveReviewBindingV1> {
            if (!candidate || typeof candidate !== 'object' || types.isProxy(candidate)) return fail('binding_unavailable');
            const record = bindings.get(candidate);
            if (!record?.active) return fail('binding_unavailable');
            const current = await service.resolve();
            if (current !== candidate) return fail('binding_stale');
            return current;
        },
    };
    return Object.freeze(service);
}

const durableCurrentReviewLocator = createDurableCurrentReviewLocator();

export const activeReviewBinding = createActiveReviewBindingService({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    deriveAuthority: () => sessionPhysicianReviewAuthority.derive(),
    recheckAuthority: (candidate: unknown) => sessionPhysicianReviewAuthority.recheck(candidate),
    locateCurrentReview: (patientId: string) => durableCurrentReviewLocator.locate(patientId),
    registerSessionResource: registerServerSessionResource,
});
