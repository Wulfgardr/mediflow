/* @Codex — deterministic local clock tests, no cross-process clock comparison. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createProductConsent } = await import('./product-consent.ts');
const { ProductError } = await import('./product-contract.ts');
const denied = (code: string) => (error: unknown) => error instanceof ProductError && error.code === code;
function setup() {
    let now = 50, wall = 1000000, current = true;
    const consent = createProductConsent(Object.freeze({ synthetic: true }), () => current, () => now, () => wall);
    const request = () => ({ operation: 'synthetic_synthesis', dataClass: 'synthetic_fixture', expectedDisclosureRevision: consent.disclosure().revision } as const);
    return { consent, request, advance: (ms: number) => { now += ms; }, wall: (ms: number) => { wall += ms; }, revoke: () => { current = false; } };
}
test('host corpus/grant is fixed; old checkbox, different context and different qualification deny', () => {
    const f = setup(); assert.throws(() => f.consent.assert('context', 'qualification'), denied('consent_required'));
    const old = f.request(); f.consent.reset(); assert.throws(() => f.consent.grant(old, 'context', 'qualification'), denied('consent_stale'));
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
