/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { ActiveReviewBindingError, createActiveReviewBindingService } from './active-review-binding.ts';
import { clearAllSessions, createSession, deleteSession, registerServerSessionResource as registerSessionResource } from './server-session.ts';
import { createServerSessionProjectionOwnerRegistry } from './server-session-projection-owner.ts';
const USER = Object.freeze({ id: 'synthetic-active-review-user', username: ['synthetic', 'active', 'review', 'user'].join('-'), role: 'user' });
const SCHEMA_VERSION = 'mediflow.active-review-binding.v1';
afterEach(() => clearAllSessions());
function review(suffix = 'a', revision = 1) { return Object.freeze({ reviewId: `review_${suffix.repeat(32)}`, reviewRevision: revision }); }
function authority(sessionId: string, actorRef: string = USER.id) {
    return Object.freeze({ schemaVersion: 'mediflow.session-physician-review-authority.v1' as const, actorRef, attestationVersion: 1 as const,
        authenticated: true as const, unlocked: true as const, expiresAt: Date.now() + 60_000, sessionGeneration: `session_${sessionId}`, revocationGeneration: 'revocation_synthetic' });
}
function fixture() {
    const session = createSession(USER, 'web'); const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze(pair) }); const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.active-review', ambulatoryId: 'ambulatory.synthetic.active-review' });
    const state = { currentAuthority: authority(session.id), currentReview: review(), locatorError: null as Error | null, locatorCalls: 0, recheckCalls: 0, registrations: 0, session: session as typeof session | null };
    const service = createActiveReviewBindingService({
        acquireContext: async () => state.session ? Object.freeze({ session: state.session, owner }) : null,
        deriveAuthority: async () => state.currentAuthority,
        recheckAuthority: async (candidate: unknown) => { state.recheckCalls += 1; if (candidate !== state.currentAuthority) throw new ActiveReviewBindingError('authority_unavailable'); return state.currentAuthority; },
        locateCurrentReview: (patientId: string) => { state.locatorCalls += 1; if (state.locatorError) throw state.locatorError; assert.equal(typeof patientId, 'string'); return state.currentReview; },
        registerSessionResource: (...args: Parameters<typeof registerSessionResource>) => { state.registrations += 1; return registerSessionResource(...args); },
    });
    return { owner, service, session, state };
}
async function denied(value: Promise<unknown>, code: string) { await assert.rejects(value, (error) => error instanceof Error && 'code' in error && error.code === code); }
test('creates a frozen, opaque, host-memory binding and deduplicates the exact same session context', async () => {
    const current = fixture(); const first = await current.service.resolve(); const second = await current.service.resolve();
    assert.equal(first, second); assert.equal(Object.isFrozen(first), true); assert.deepEqual(Object.keys(first).sort(), ['schemaVersion', 'toJSON']); assert.equal(first.schemaVersion, SCHEMA_VERSION);
    assert.equal(JSON.stringify(first), undefined); assert.throws(() => structuredClone(first), DOMException); assert.equal(current.state.locatorCalls, 2); assert.equal(current.state.recheckCalls, 2);
});
test('fails closed for exact-one locator denials before publishing a binding', async () => {
    for (const code of ['current_missing', 'current_ambiguous', 'terminal', 'corrupt'] as const) {
        const current = fixture(); current.state.locatorError = Object.assign(new Error('synthetic locator denial'), { code }); await denied(current.service.resolve(), code);
    }
});
test('replaces the binding after canonical patient/review context, epoch, or revision drift', async () => {
    const current = fixture(); const first = await current.service.resolve(); current.state.currentReview = review('b', 2); const revised = await current.service.resolve(); assert.notEqual(revised, first);
    current.owner.issueSelection({ expectedEpoch: 1, patientId: 'patient.synthetic.active-review-next', ambulatoryId: 'ambulatory.synthetic.active-review' }); current.state.currentReview = review('c'); assert.notEqual(await current.service.resolve(), revised);
});
test('makes same-session tabs share one winner and fails closed for lifecycle or P3 authority drift', async () => {
    const current = fixture(); assert.equal(await current.service.resolve(), await current.service.resolve()); current.session.expiresAt = Date.now(); await assert.rejects(current.service.resolve());
    const deleted = fixture(); await deleted.service.resolve(); deleteSession(deleted.session.id); await assert.rejects(deleted.service.resolve());
    const restarted = fixture(); const beforeRestart = await restarted.service.resolve(); const afterRestart = await createActiveReviewBindingService({ acquireContext: async () => Object.freeze({ session: restarted.session, owner: restarted.owner }), deriveAuthority: async () => restarted.state.currentAuthority, recheckAuthority: async () => restarted.state.currentAuthority, locateCurrentReview: () => restarted.state.currentReview, registerSessionResource }).resolve(); assert.notEqual(afterRestart, beforeRestart);
    const principal = fixture(); principal.state.currentAuthority = authority(principal.session.id, 'synthetic-different-principal'); await denied(principal.service.resolve(), 'authority_unavailable'); assert.equal(principal.state.locatorCalls, 0);
    const locked = fixture(); const service = createActiveReviewBindingService({ acquireContext: async () => Object.freeze({ session: locked.session, owner: locked.owner }), deriveAuthority: async () => locked.state.currentAuthority,
        recheckAuthority: async () => { throw Object.assign(new Error('synthetic lock'), { code: 'account_locked' }); }, locateCurrentReview: () => { throw new Error('must not locate'); }, registerSessionResource }); await denied(service.resolve(), 'account_locked');
});
test('never revalidates an issued binding after review, revision, selection, lease, session, or authority drift', async () => {
    const observed = fixture(); const stale = await observed.service.resolve(); const registrations = observed.state.registrations; observed.state.currentReview = review('b'); await assert.rejects(observed.service.revalidate(stale)); assert.equal(observed.state.registrations, registrations); const replacement = await observed.service.resolve(); assert.notEqual(replacement, stale); assert.equal(observed.state.registrations, registrations + 1); assert.deepEqual(await Promise.all([observed.service.revalidate(replacement), observed.service.revalidate(replacement)]), [replacement, replacement]);
    const reentrant = fixture(); const reentrantService = createActiveReviewBindingService({ acquireContext: async () => Object.freeze({ session: reentrant.session, owner: reentrant.owner }), deriveAuthority: async () => reentrant.state.currentAuthority, recheckAuthority: async () => reentrant.state.currentAuthority, locateCurrentReview: () => { assert.throws(() => reentrant.owner.withLeaseCriticalSection(reentrant.session, () => 'synthetic'), /selection_busy/u); return reentrant.state.currentReview; }, registerSessionResource }); const reentrantBinding = await reentrantService.resolve(); assert.equal(await reentrantService.revalidate(reentrantBinding), reentrantBinding);
    const invalidated = async (mutate: (current: ReturnType<typeof fixture>) => void) => { const current = fixture(); const binding = await current.service.resolve(); mutate(current); await assert.rejects(current.service.revalidate(binding)); };
    await invalidated((current) => { current.state.currentReview = review('b'); }); await invalidated((current) => { current.state.currentReview = review('a', 2); });
    await invalidated((current) => { current.owner.issueSelection({ expectedEpoch: 1, patientId: 'patient.synthetic.active-review-next', ambulatoryId: 'ambulatory.synthetic.active-review' }); });
    await invalidated((current) => { current.session.expiresAt = Date.now(); }); await invalidated((current) => { deleteSession(current.session.id); });
    await invalidated((current) => { current.state.currentAuthority = authority(current.session.id, 'synthetic-different-principal'); });
});
test('rejects transparent and throwing proxies at every object boundary before traps or accessors run', async () => {
    const current = fixture(); const valid = { acquireContext: async () => Object.freeze({ session: current.session, owner: current.owner }), deriveAuthority: async () => current.state.currentAuthority, recheckAuthority: async () => current.state.currentAuthority, locateCurrentReview: () => current.state.currentReview, registerSessionResource };
    assert.throws(() => createActiveReviewBindingService(new Proxy(valid, {})), (error) => error instanceof ActiveReviewBindingError && error.code === 'input_invalid'); assert.throws(() => createActiveReviewBindingService(new Proxy(valid, { ownKeys() { throw new Error('must not run'); } })), (error) => error instanceof ActiveReviewBindingError && error.code === 'input_invalid');
    await denied(createActiveReviewBindingService({ ...valid, acquireContext: async () => new Proxy({ session: current.session, owner: current.owner }, {}) }).resolve(), 'context_unavailable');
    await denied(createActiveReviewBindingService({ ...valid, recheckAuthority: async () => new Proxy(current.state.currentAuthority, {}) }).resolve(), 'authority_unavailable');
    await denied(createActiveReviewBindingService({ ...valid, locateCurrentReview: () => new Proxy(current.state.currentReview, {}) }).resolve(), 'review_unavailable');
});
test('denies hostile dependency input and keeps routes, persistence, gestures, commands, and clinical writes unreachable', () => {
    const current = fixture(); const valid = { acquireContext: async () => null, deriveAuthority: async () => current.state.currentAuthority, recheckAuthority: async () => current.state.currentAuthority, locateCurrentReview: () => review(), registerSessionResource };
    for (const hostile of [null, [], Object.create(null), { ...valid, extra: true }]) assert.throws(() => createActiveReviewBindingService(hostile), (error) => error instanceof ActiveReviewBindingError && error.code === 'input_invalid');
    const accessor = {}; Object.defineProperty(accessor, 'acquireContext', { enumerable: true, get() { throw new Error('hostile getter'); } }); assert.throws(() => createActiveReviewBindingService(accessor), (error) => error instanceof ActiveReviewBindingError && error.code === 'input_invalid');
    const symbol = { ...valid }; Object.defineProperty(symbol, Symbol('synthetic'), { value: true }); assert.throws(() => createActiveReviewBindingService(symbol), (error) => error instanceof ActiveReviewBindingError && error.code === 'input_invalid');
    const source = readFileSync(new URL('./active-review-binding.ts', import.meta.url), 'utf8'); assert.match(source, /withLeaseCriticalSection/u); assert.doesNotMatch(source, /app\/api|NextResponse|cookies|headers|Request|gesture|command|audit|dbServer\.(?:insert|update|delete)/u); assert.equal(current.service.resolve.length, 0);
});
