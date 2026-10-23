import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticFixture } from './synthetic.fixture.ts';
import type { AdapterContext } from './contract.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

for (const [beforeExecute, afterMarker] of [[0, 119_999], [0, 120_000], [0, 120_001], [0, 299_999], [0, 300_001],
    [60_000, 59_999], [60_000, 60_000]]) {
    test(`CU R5: scadenza originale al dispatch, prima=${beforeExecute}ms dopo marker=${afterMarker}ms`, async t => {
        const f = await syntheticFixture(); t.after(() => f.close());
        const cap = f.service.create(f.plan.operationId);
        await f.service.prepare(cap); await f.service.approve(cap);
        const approvedAt = f.now(), entered = deferred(), release = deferred(), act = f.adapter.act;
        let retained: AdapterContext | undefined;
        f.adapter.act = async (ctx, plan) => {
            retained = ctx; entered.resolve(); await release.promise;
            return act(ctx, plan);
        };
        f.advance(beforeExecute);
        const pending = f.service.execute(cap); await entered.promise;
        const marker = f.service.inspect(f.plan.operationId);
        assert.equal(marker.state, 'attempt_started'); assert.equal(marker.effectPossible, true);
        assert.equal(marker.attempt, 1);
        assert.equal(f.db.prepare("SELECT count(*) FROM audit_events WHERE redacted_metadata LIKE '%state:attempt_started%'").pluck().get(), 1);
        assert.equal(f.traffic.filter(r => r.path === '/act').length, 0);
        f.advance(afterMarker);
        const fresh = f.service.acquire(f.plan.operationId);
        assert.equal(f.service.publicStatus(fresh), 'local_processing');
        await assert.rejects(f.service.approve(fresh), { message: 'denied' });
        const expired = f.now() >= approvedAt + 120_000;
        release.resolve();
        if (expired) {
            await assert.rejects(pending, { message: 'denied' }, 'expired approval must deny the first dispatch');
            assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
            assert.equal(f.traffic.filter(r => r.path === '/act').length, 0, 'expired approval must emit zero act POSTs');
            assert.throws(() => retained!.authorizeRequest(f.plan.destinations.find(d => d.purpose === 'act')!));
            for (const handle of [cap, fresh, f.service.resume(f.plan.operationId)]) {
                await assert.rejects(f.service.prepare(handle)); await assert.rejects(f.service.approve(handle));
                await assert.rejects(f.service.execute(handle));
            }
            const restarted = f.reopen(), resumed = restarted.resume(f.plan.operationId);
            await assert.rejects(restarted.prepare(resumed)); await assert.rejects(restarted.approve(resumed));
            await assert.rejects(restarted.execute(resumed)); await assert.rejects(restarted.reconcile(resumed));
            const after = restarted.inspect(f.plan.operationId);
            assert.equal(after.state, 'uncertain'); assert.equal(after.effectPossible, true); assert.equal(after.attempt, 1);
            assert.equal(f.traffic.filter(r => r.path === '/act').length, 0, 'recovery must never reopen the act');
        } else {
            assert.equal((await pending).state, 'confirmed');
            assert.equal(f.traffic.filter(r => r.path === '/act').length, 1);
            await assert.rejects(f.service.execute(cap));
            assert.equal(f.traffic.filter(r => r.path === '/act').length, 1);
        }
    });
}
