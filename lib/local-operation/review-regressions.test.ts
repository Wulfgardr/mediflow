import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { syntheticFixture } from './synthetic.fixture.ts';
import { createLocalOperationService } from './service.ts';
import { createLocalOperationHost } from './host.ts';
import { createSqliteLocalOperationJournal } from './sqlite-journal.ts';
import { createLocalOperationJournalCipher } from './journal-cipher.ts';
import { planDigest, type AdapterContext, type LocalOperationPlan, type LiveContext } from './contract.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const snapshot = (f: Awaited<ReturnType<typeof syntheticFixture>>) => ({
    journal: f.db.prepare('SELECT value FROM settings WHERE key=?').get('localOperationJournal.v1'),
    audit: f.db.prepare('SELECT * FROM audit_events ORDER BY rowid').all(),
});

for (const phase of ['prepare', 'execute', 'reconcile'] as const) {
    test(`CU R1: observe non autorizza POST di atto nella fase ${phase}`, async t => {
        const f = await syntheticFixture(); t.after(() => f.close());
        const cap = f.service.create(f.plan.operationId);
        if (phase !== 'prepare') { await f.service.prepare(cap); await f.service.approve(cap); }
        if (phase === 'reconcile') { f.loseResponse(); await assert.rejects(f.service.execute(cap)); }
        const before = f.traffic.filter(r => r.path === '/act').length;
        const observe = f.adapter.observe;
        f.adapter.observe = async ctx => {
            const d = f.plan.destinations.find(d => d.purpose === 'act')!;
            ctx.authorizeRequest(d);
            await fetch(d.origin + d.path, { method: 'POST', signal: ctx.signal });
            throw new Error('synthetic observation attempted act');
        };
        await assert.rejects(f.service[phase](cap));
        assert.equal(f.traffic.filter(r => r.path === '/act').length, before, 'observe must emit zero act POSTs');
        f.adapter.observe = observe;
    });
}

for (const failure of ['audit', 'commit'] as const) {
    test(`CU R1: fallimento ${failure} del marker nega dispatch HTTP`, async t => {
        const f = await syntheticFixture(); t.after(() => f.close());
        f.service.close();
        const journal = f.journal;
        const service = createLocalOperationService({ ...f.ports, journal: { ...journal,
            save(value, revision, guard, lane) {
                if (failure === 'commit' && value.state === 'attempt_started') throw new Error('synthetic commit failure');
                return journal.save(value, revision, guard, lane);
            },
        } }); t.after(() => service.close());
        const cap = service.create(f.plan.operationId); await service.prepare(cap); await service.approve(cap);
        if (failure === 'audit') f.db.exec("CREATE TRIGGER reject_marker BEFORE INSERT ON audit_events WHEN NEW.redacted_metadata LIKE '%attempt_started%' BEGIN SELECT RAISE(IGNORE); END");
        await assert.rejects(service.execute(cap));
        assert.equal(f.traffic.filter(r => r.path === '/act').length, 0);
        assert.equal(service.inspect(f.plan.operationId).attempt, 0);
        assert.equal(service.inspect(f.plan.operationId).effectPossible, false);
    });
}

test('CU R1: dispatch unico vincolato a marker/revisione, errore e crash non reinviano', async t => {
    const f = await syntheticFixture(); t.after(() => f.close());
    let retained: AdapterContext | undefined;
    const act = f.adapter.act;
    f.adapter.act = async (ctx, plan) => {
        retained = ctx;
        const marker = f.service.inspect(plan.operationId);
        assert.equal(marker.state, 'attempt_started'); assert.equal(marker.effectPossible, true);
        assert.equal(marker.attempt, ctx.attempt); assert.equal(marker.attempt, 1);
        assert.equal(ctx.revision, marker.revision);
        const result = await act(ctx, plan);
        assert.throws(() => ctx.authorizeRequest(plan.destinations.find(d => d.purpose === 'act')!));
        return result;
    };
    const cap = f.service.create(f.plan.operationId); await f.service.prepare(cap); await f.service.approve(cap);
    f.loseResponse(); await assert.rejects(f.service.execute(cap));
    assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
    assert.throws(() => retained!.authorizeRequest(f.plan.destinations.find(d => d.purpose === 'act')!));
    await assert.rejects(f.service.prepare(cap)); await assert.rejects(f.service.execute(cap));
    const restarted = f.reopen(), fresh = restarted.resume(f.plan.operationId);
    await assert.rejects(restarted.execute(fresh)); await assert.rejects(restarted.prepare(fresh));
    assert.equal((await restarted.reconcile(fresh)).state, 'confirmed');
    assert.equal(f.traffic.filter(r => r.path === '/act').length, 1);
});

test('CU R1: errore dopo commit prima del dispatch conserva marker e impone riconciliazione', async t => {
    const f = await syntheticFixture(); t.after(() => f.close()); f.service.close();
    const journal = f.journal;
    const service = createLocalOperationService({ ...f.ports, journal: { ...journal,
        save(value, revision, guard, lane) {
            const saved = journal.save(value, revision, guard, lane);
            if (value.state === 'attempt_started') throw new Error('synthetic crash after committed marker');
            return saved;
        },
    } }); t.after(() => service.close());
    const cap = service.create(f.plan.operationId); await service.prepare(cap); await service.approve(cap);
    await assert.rejects(service.execute(cap));
    assert.equal(service.inspect(f.plan.operationId).effectPossible, true);
    assert.equal(service.inspect(f.plan.operationId).state, 'uncertain');
    await assert.rejects(service.execute(cap)); await assert.rejects(service.prepare(cap));
    assert.equal(f.traffic.filter(r => r.path === '/act').length, 0);
});

for (const changed of ['revision', 'attempt'] as const) {
    test(`CU R1: marker ${changed} cambiato prima del dispatch nega POST`, async t => {
        const f = await syntheticFixture(); t.after(() => f.close());
        const entered = deferred(), release = deferred();
        f.adapter.act = async (ctx, plan) => {
            entered.resolve(); await release.promise;
            const destination = plan.destinations.find(d => d.purpose === 'act')!;
            ctx.authorizeRequest(destination);
            await fetch(destination.origin + destination.path, { method: 'POST', signal: ctx.signal });
            throw new Error('synthetic late dispatch');
        };
        const cap = f.service.create(f.plan.operationId); await f.service.prepare(cap); await f.service.approve(cap);
        const pending = f.service.execute(cap); await entered.promise;
        const current = f.journal.read(f.plan.operationId)!;
        f.journal.save({ ...current, revision: current.revision + 1,
            attempt: current.attempt + (changed === 'attempt' ? 1 : 0) }, current.revision, () => {}, 'core');
        release.resolve(); await assert.rejects(pending);
        assert.equal(f.traffic.filter(r => r.path === '/act').length, 0);
        assert.equal(f.service.inspect(f.plan.operationId).effectPossible, true);
        await assert.rejects(f.service.execute(cap));
    });
}

const immutableFields = ['operationId', 'patientId', 'practiceId', 'procedureId', 'territory', 'installationId', 'archiveGeneration'] as const;
for (const field of immutableFields) for (const manual of [false, true]) {
    test(`CU R2: identità immutabile ${field}, revisione ${manual ? 'manuale' : 'ordinaria'} negata senza scritture`, async t => {
        const f = await syntheticFixture(); t.after(() => f.close());
        if (manual) f.setPlan({ finalAct: 'manual' });
        let confirmations = 0; f.setConfirmation(async () => { confirmations++; return true; });
        const id = f.plan.operationId, cap = f.service.create(id);
        if (manual) await f.service.prepare(cap);
        const before = snapshot(f), traffic = f.traffic.length;
        const value = field === 'territory' ? 'it' : `synthetic-other-${field}`;
        f.setPlan({ [field]: value } as Partial<LocalOperationPlan>);
        if (field in f.context) f.setContext({ [field]: value } as Partial<LiveContext>);
        if (manual) await assert.rejects(f.service.reviewManualContent(id));
        else assert.throws(() => f.service.revise(id));
        assert.deepEqual(snapshot(f), before, 'rejection must preserve journal and audit');
        assert.equal(confirmations, 0, 'identity must be checked before native content review');
        assert.equal(f.traffic.length, traffic);
        assert.throws(() => f.service.acquire(id));
        await assert.rejects(f.service.prepare(cap));
        assert.deepEqual(snapshot(f), before);
    });
}

test('CU R2: record ereditato con digest del piano B non emette capability per identità A', async t => {
    const f = await syntheticFixture(); t.after(() => f.close());
    f.service.create(f.plan.operationId);
    const current = f.journal.read(f.plan.operationId)!;
    f.setPlan({ patientId: 'synthetic-B' }); f.setContext({ patientId: 'synthetic-B' });
    // State left by the old revise defect: immutable A, but digest of B.
    f.journal.save({ ...current, planDigest: planDigest(f.plan), revision: current.revision + 1 }, current.revision, () => {}, 'core');
    const before = snapshot(f);
    assert.throws(() => f.service.acquire(f.plan.operationId));
    assert.deepEqual(snapshot(f), before); assert.equal(f.traffic.length, 0);
});

test('CU R2: esito incerto precedente resta bloccato anche dopo tentato retarget', async t => {
    const f = await syntheticFixture(); t.after(() => f.close());
    const cap = f.service.create(f.plan.operationId); await f.service.prepare(cap); await f.service.approve(cap);
    f.loseResponse(); await assert.rejects(f.service.execute(cap));
    const before = snapshot(f), plan = f.plan;
    f.setPlan({ patientId: 'synthetic-other' }); f.setContext({ patientId: 'synthetic-other' });
    assert.throws(() => f.service.revise(plan.operationId)); assert.deepEqual(snapshot(f), before);
    f.setPlan(plan); f.setContext({ patientId: plan.patientId });
    await assert.rejects(f.service.prepare(cap)); assert.equal(f.service.inspect(plan.operationId).effectPossible, true);
    assert.equal(f.traffic.filter(r => r.path === '/act').length, 1);
});

for (const notify of [false, true]) for (const marker of [false, true]) for (const error of [false, true]) {
    test(`CU R3: due archivi/chiavi stesso ID notify=${notify} marker=${marker} error=${error}`, async t => {
        const a = await syntheticFixture(), b = await syntheticFixture();
        t.after(async () => { await a.close(); await b.close(); });
        a.service.close(); b.service.close();
        for (const f of [a, b]) {
            const generation = randomUUID();
            f.db.exec('CREATE TABLE archive_generation(id INTEGER PRIMARY KEY,generation TEXT NOT NULL)');
            f.db.prepare('INSERT INTO archive_generation VALUES (1,?)').run(generation);
            f.setContext({ archiveGeneration: generation }); f.setPlan({ archiveGeneration: generation });
        }
        b.setContext({ patientId: 'synthetic-B' }); b.setPlan({ patientId: 'synthetic-B' });
        const keys = new Map([[a, randomBytes(32)], [b, randomBytes(32)]]);
        let active = a;
        const listeners = new Set<() => void>();
        const makeHost = () => createLocalOperationHost({ ...a.ports, database: () => active.db,
            currentArchiveKey: () => keys.get(active)!, currentContext: () => active.context, resolvePlan: () => active.plan,
            subscribeInvalidation(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
            sourceSurface: 'native', requestOpen: async () => {}, requestResume: async () => {},
        });
        active = b; const hb = makeHost(); hb.trusted.create(b.plan.operationId); hb.close();
        active = a; const host = makeHost(); t.after(() => host.close());
        const s = host.trusted, cap = s.create(a.plan.operationId), entered = deferred(), release = deferred();
        const paused = async () => { entered.resolve(); await release.promise; if (error) throw new Error('synthetic late adapter error'); };
        if (marker) {
            await s.prepare(cap); await s.approve(cap);
            a.setAfterAct(paused);
        } else {
            const observe = a.adapter.observe;
            a.adapter.observe = async ctx => { const value = await observe(ctx); await paused(); return value; };
        }
        const pending = marker ? s.execute(cap) : s.prepare(cap);
        await entered.promise;
        const originJournal = createSqliteLocalOperationJournal(a.db, { ...createLocalOperationJournalCipher(() => keys.get(a)!),
            actor: () => ({ operatorId: a.context.operatorId, sourceSurface: 'native' }) });
        const beforeA = snapshot(a), beforeB = snapshot(b);
        assert.equal(originJournal.read(a.plan.operationId)!.effectPossible, marker);
        active = b;
        if (notify) for (const listener of listeners) listener();
        release.resolve(); await assert.rejects(pending);
        assert.deepEqual(snapshot(b), beforeB, 'late promise/invalidation must never read-write B by reused operation ID');
        assert.deepEqual(snapshot(a), beforeA, 'detached archive must not be written');
        assert.equal(originJournal.read(a.plan.operationId)!.effectPossible, marker, 'origin marker must preserve uncertainty');
        await assert.rejects(s.prepare(cap));
        assert.equal(a.traffic.filter(r => r.path === '/act').length, marker ? 1 : 0);
        assert.equal(b.traffic.length, 0);
    });
}
