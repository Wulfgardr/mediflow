/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequestGuard } from './latest-request-guard';

/* @Codex */
test('createLatestRequestGuard discards stale out-of-order responses', async () => {
    const guard = createLatestRequestGuard();
    const applied: string[] = [];
    let resolveSlow: (value: string) => void = () => undefined;
    let resolveFast: (value: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
        resolveSlow = resolve;
    });
    const fast = new Promise<string>((resolve) => {
        resolveFast = resolve;
    });

    const slowRequestId = guard.issue();
    const slowApply = slow.then((value) => {
        if (guard.isLatest(slowRequestId)) {
            applied.push(value);
        }
    });

    const fastRequestId = guard.issue();
    const fastApply = fast.then((value) => {
        if (guard.isLatest(fastRequestId)) {
            applied.push(value);
        }
    });

    resolveFast('fresh');
    await fastApply;
    resolveSlow('stale');
    await slowApply;

    assert.deepEqual(applied, ['fresh']);
});

/* @Codex */
test('createLatestRequestGuard discard invalidates pending requests', () => {
    const guard = createLatestRequestGuard();
    const requestId = guard.issue();

    guard.discard();

    assert.equal(guard.isLatest(requestId), false);
});
