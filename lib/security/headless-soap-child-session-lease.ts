/* @Codex */
import 'server-only';
import type { HeadlessSoapActiveRoleDependentRegistrationV1, HeadlessSoapActiveRoleSessionGrantV1 } from './headless-soap-active-role-session-grant';

const TTL_MS = 5 * 60 * 1_000, defaultClock = Date.now, numberIsSafeInteger = Number.isSafeInteger, maxSafeInteger = Number.MAX_SAFE_INTEGER;
const objectCreate = Object.create, objectFreeze = Object.freeze, reflectApply = Reflect.apply;
const WeakMapConstructor = WeakMap, weakMapDelete = WeakMap.prototype.delete, weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set;
declare const leaseIdentity: unique symbol;
export type HeadlessSoapChildSessionLeaseV1 = Readonly<{ readonly [leaseIdentity]?: never }>;
export type HeadlessSoapChildSessionLeaseErrorCode = 'active_role_unavailable' | 'child_unavailable' | 'lease_unavailable' | 'lease_expired' | 'proposal_budget_exhausted' | 'lifecycle_unavailable';
export class HeadlessSoapChildSessionLeaseError extends Error {
    constructor(readonly code: HeadlessSoapChildSessionLeaseErrorCode) { super(`Headless SOAP child session lease rejected: ${code}`); this.name = 'HeadlessSoapChildSessionLeaseError'; }
}
export type HeadlessSoapChildSessionLeaseSources = Readonly<{
    withCurrentGrant(operation: (grant: HeadlessSoapActiveRoleSessionGrantV1) => void): Promise<boolean>;
    registerDependent(grant: unknown, dispose: () => void): HeadlessSoapActiveRoleDependentRegistrationV1 | null;
    confirmDependent(grant: unknown, registration: unknown): boolean;
    unregisterDependent(grant: unknown, registration: unknown): boolean;
    withCurrentDependent(grant: unknown, registration: unknown, operation: () => void): Promise<boolean>;
    clock?: () => number;
}>;
type ParentRecord = { grant: HeadlessSoapActiveRoleSessionGrantV1; registration: HeadlessSoapActiveRoleDependentRegistrationV1 | null; active: boolean; contractVersion: 1; generation: 1; revocationGeneration: 0 | 1; children: ChildRecord | null };
type ChildRecord = { parent: ParentRecord; leaseRecord: LeaseRecord; active: boolean; contractVersion: 1; generation: 1; revocationGeneration: 0 | 1; budget: 0 | 1; expiresAt: number; lastObservedAt: number; next: ChildRecord | null };
type LeaseRecord = { lease: HeadlessSoapChildSessionLeaseV1; child: ChildRecord; active: boolean; contractVersion: 1; generation: 1; revocationGeneration: 0 | 1 };
type TimeOutcome = Readonly<{ status: 'current'; observedAt: number }> | Readonly<{ status: 'child_unavailable' | 'lease_expired' | 'lifecycle_unavailable' }>;
type UseOutcome = TimeOutcome | Readonly<{ status: 'proposal_budget_exhausted' }>;
function fail(code: HeadlessSoapChildSessionLeaseErrorCode): never { throw new HeadlessSoapChildSessionLeaseError(code); }
function weakGet<T>(registry: WeakMap<object, T>, key: object): T | undefined { return reflectApply(weakMapGet, registry, [key]) as T | undefined; }
function weakSet<T>(registry: WeakMap<object, T>, key: object, value: T): void { reflectApply(weakMapSet, registry, [key, value]); }
function weakDelete<T>(registry: WeakMap<object, T>, key: object): void { reflectApply(weakMapDelete, registry, [key]); }

/** Owns process-local parent, child and lease state; it contains no clinical content. */
export function createHeadlessSoapChildSessionLeaseService(sources: HeadlessSoapChildSessionLeaseSources) {
    const parents = new WeakMapConstructor<object, ParentRecord>(), leases = new WeakMapConstructor<object, LeaseRecord>(), clock = sources.clock ?? defaultClock;
    const unlinkChild = (child: ChildRecord): void => { const parent = child.parent;
        if (parent.children === child) parent.children = child.next;
        else { let previous = parent.children; while (previous && previous.next !== child) previous = previous.next; if (previous) previous.next = child.next; }
        child.next = null; };
    const terminalizeChild = (child: ChildRecord): void => { if (!child.active) return; child.active = false; child.revocationGeneration = 1;
        child.leaseRecord.active = false; child.leaseRecord.revocationGeneration = 1; weakDelete(leases, child.leaseRecord.lease); unlinkChild(child); };
    const drainParent = (parent: ParentRecord): void => { if (!parent.active) return; parent.active = false; parent.revocationGeneration = 1;
        weakDelete(parents, parent.grant); let child = parent.children; parent.children = null;
        while (child) { const next = child.next; child.next = null; if (child.active) { child.active = false; child.revocationGeneration = 1;
                child.leaseRecord.active = false; child.leaseRecord.revocationGeneration = 1; weakDelete(leases, child.leaseRecord.lease); } child = next; } };
    const detachParent = (parent: ParentRecord): void => { const registration = parent.registration; parent.registration = null;
        if (registration) { try { sources.unregisterDependent(parent.grant, registration); } catch { /* local state still drains */ } } drainParent(parent); };
    const readClock = (): number | null => { let value: unknown; try { value = clock(); } catch { return null; }
        return numberIsSafeInteger(value) && (value as number) >= 0 ? value as number : null; };
    const observe = (child: ChildRecord): TimeOutcome => { const observedAt = readClock();
        if (observedAt === null) { terminalizeChild(child); return { status: 'lifecycle_unavailable' }; }
        if (observedAt < child.lastObservedAt) { terminalizeChild(child); return { status: 'child_unavailable' }; }
        if (observedAt >= child.expiresAt) { terminalizeChild(child); return { status: 'lease_expired' }; }
        return { status: 'current', observedAt }; };
    const open = async (): Promise<HeadlessSoapChildSessionLeaseV1> => { let published: HeadlessSoapChildSessionLeaseV1 | null = null, touched: ParentRecord | null = null, entered = false, attached = false;
        try { attached = await sources.withCurrentGrant((grant) => { entered = true; const observedAt = readClock();
                if (observedAt === null || observedAt > maxSafeInteger - TTL_MS) throw new Error('child_lifecycle_unavailable'); const expiresAt = observedAt + TTL_MS;
                let parent = weakGet(parents, grant); if (!parent) { const created: ParentRecord = { grant, registration: null, active: true, contractVersion: 1, generation: 1, revocationGeneration: 0, children: null }; touched = created;
                    const registration = sources.registerDependent(grant, () => { drainParent(created); }); if (!registration) throw new Error('child_attach_unavailable');
                    created.registration = registration; weakSet(parents, grant, created); parent = created; }
                touched = parent; const registration = parent.registration;
                if (!parent.active || !registration || !sources.confirmDependent(grant, registration)) throw new Error('child_parent_unavailable');
                const lease = objectFreeze(objectCreate(null)) as HeadlessSoapChildSessionLeaseV1;
                const leaseRecord = { lease, child: null as unknown as ChildRecord, active: true, contractVersion: 1, generation: 1, revocationGeneration: 0 } satisfies LeaseRecord;
                const child: ChildRecord = { parent, leaseRecord, active: true, contractVersion: 1, generation: 1, revocationGeneration: 0, budget: 1, expiresAt, lastObservedAt: observedAt, next: parent.children };
                leaseRecord.child = child; parent.children = child; weakSet(leases, lease, leaseRecord);
                if (!parent.active || !sources.confirmDependent(grant, registration) || weakGet(leases, lease) !== leaseRecord) throw new Error('child_publication_unavailable'); published = lease;
            });
        } catch { if (entered) { if (touched) detachParent(touched); return fail('lifecycle_unavailable'); } return fail('active_role_unavailable'); }
        if (!attached || !published) { if (touched) detachParent(touched); return fail('lifecycle_unavailable'); } return published; };
    const runLeaseOperation = async (candidate: unknown, consumeBudget: boolean): Promise<HeadlessSoapChildSessionLeaseV1> => {
        const record = typeof candidate === 'object' && candidate !== null ? weakGet(leases, candidate) : undefined;
        if (!record || !record.active || !record.child.active) return fail('lease_unavailable'); const child = record.child, parent = child.parent, before = observe(child);
        if (before.status !== 'current') return fail(before.status); child.lastObservedAt = before.observedAt;
        let outcome: UseOutcome = { status: 'child_unavailable' }, current = false;
        try { current = await sources.withCurrentDependent(parent.grant, parent.registration, () => { if (!record.active || !child.active || !parent.active) { outcome = { status: 'child_unavailable' }; return; }
                outcome = observe(child); if (outcome.status === 'current') {
                    if (!record.active || !child.active || !parent.active) { outcome = { status: 'child_unavailable' }; return; }
                    child.lastObservedAt = outcome.observedAt;
                    if (consumeBudget) { if (child.budget === 0) outcome = { status: 'proposal_budget_exhausted' }; else child.budget = 0; } } });
        } catch { detachParent(parent); return fail('active_role_unavailable'); }
        if (!current) { if (!child.active || !record.active) return fail('child_unavailable'); detachParent(parent); return fail('lifecycle_unavailable'); }
        const finalOutcome = outcome as UseOutcome; if (finalOutcome.status !== 'current') return fail(finalOutcome.status); return record.lease; };
    return objectFreeze({
        open,
        recheck(candidate: unknown): Promise<HeadlessSoapChildSessionLeaseV1> { return runLeaseOperation(candidate, false); },
        consumeProposalBudget(candidate: unknown): Promise<HeadlessSoapChildSessionLeaseV1> { return runLeaseOperation(candidate, true); },
        terminate(candidate: unknown): boolean { const record = typeof candidate === 'object' && candidate !== null ? weakGet(leases, candidate) : undefined;
            if (!record || !record.active || !record.child.active) return false; terminalizeChild(record.child); return true; },
    });
}
