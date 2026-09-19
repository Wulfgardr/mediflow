/* @Codex — deterministic local clock tests, no cross-process clock comparison. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createProductConsent } = await import('./product-consent.ts');
const { ProductError } = await import('./product-contract.ts');
const denied = (code: string) => (error: unknown) => error instanceof ProductError && error.code === code;
function setup() {
    let now = 50, wall = 1000000, current = true;
    const consent = createProductConsent(Object.freeze({ synthetic: true }), () => current, () => now, () => wall);
    consent.bind('c', 'q');
    const request = () => ({ operation: 'synthetic_synthesis', dataClass: 'synthetic_fixture', expectedDisclosureRevision: consent.disclosure().revision } as const);
    return { consent, request, advance: (ms: number) => { now += ms; }, wall: (ms: number) => { wall += ms; }, revoke: () => { current = false; } };
}
test('host corpus/grant is fixed; old checkbox, different context and different qualification deny', () => {
    const f = setup(); assert.throws(() => f.consent.assert('context', 'qualification'), denied('consent_required'));
    f.consent.bind('context', 'qualification'); const old = f.request(); f.consent.bind('context', 'qualification'); assert.throws(() => f.consent.grant(old, 'context', 'qualification'), denied('consent_stale'));
    f.consent.grant(f.request(), 'context', 'qualification'); f.consent.assert('context', 'qualification');
    assert.throws(() => f.consent.assert('other', 'qualification'), denied('consent_stale'));
    assert.throws(() => f.consent.assert('context', 'other'), denied('consent_stale'));
    assert.throws(() => f.consent.grant(f.request(), 'context', 'qualification'), denied('consent_stale'));
    assert.equal(f.consent.remainingMs(), 300000); assert.equal(f.consent.disclosure().clinicalWrites, 0);
});
test('exact monotonic expiry survives a backward wall clock, no tolerance or renewed grant', () => {
    const f = setup(); f.consent.grant(f.request(), 'c', 'q'); f.advance(299999); f.wall(-10000);
    f.consent.assert('c', 'q'); assert.equal(f.consent.remainingMs(), 1);
    f.advance(1); assert.throws(() => f.consent.assert('c', 'q'), denied('consent_stale')); assert.equal(f.consent.remainingMs(), 0);
});
test('forward wall expiry and owner retirement independently revoke', () => {
    const f = setup(); f.consent.grant(f.request(), 'c', 'q'); f.wall(300000);
    assert.throws(() => f.consent.assert('c', 'q'), denied('consent_stale'));
    f.revoke(); assert.throws(() => f.consent.assert('c', 'q'), denied('session_expired'));
});

test('a disclosure cannot acquire a different preparation at grant time', () => {
    const f = setup(); const old = f.request();
    assert.throws(() => f.consent.grant(old, 'new-context', 'q'), denied('consent_stale'));
    assert.throws(() => f.consent.grant(old, 'c', 'new-qualification'), denied('consent_stale'));
    f.consent.bind('new-context', 'new-qualification', 1000);
    assert.throws(() => f.consent.grant(old, 'new-context', 'new-qualification'), denied('consent_stale'));
    f.consent.reset();
    assert.throws(() => f.consent.grant(f.request(), 'c', 'q'), denied('consent_stale'));
});
test('time spent before consent reduces the grant instead of restarting its life', () => {
    const f = setup(); f.consent.bind('c', 'q', 1000); f.advance(700); f.wall(700);
    f.consent.grant(f.request(), 'c', 'q'); assert.equal(f.consent.remainingMs(), 300);
    f.advance(300); assert.throws(() => f.consent.assert('c', 'q'), denied('consent_stale'));
});
test('an absolute preparation deadline caps the consent lease across wall-clock resampling', () => {
    const f = setup(); f.consent.bind('c', 'q', 1000, 1000250);
    f.consent.grant(f.request(), 'c', 'q'); assert.equal(f.consent.expiresAt(), 1000250);
    f.advance(249); f.wall(249); f.consent.assert('c', 'q');
    f.wall(1); assert.throws(() => f.consent.assert('c', 'q'), denied('consent_stale'));
});
