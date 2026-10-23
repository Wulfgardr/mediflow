import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { syntheticFixture, SENTINELS } from './synthetic.fixture.ts';
import { createLocalOperationRemoteHost } from './remote-host.ts';
import { planDigest } from './contract.ts';
import { createLocalOperationService } from './service.ts';

async function fixture(t: TestContext) {
    const f = await syntheticFixture(); t.after(() => f.close()); return f;
}
async function authorized(f: Awaited<ReturnType<typeof syntheticFixture>>) {
    const cap = f.service.create(f.plan.operationId);
    assert.equal((await f.service.prepare(cap)).state, 'saved');
    assert.equal((await f.service.approve(cap)).state, 'authorized');
    return cap;
}

test('CU-1a: atto protetto, esito e audit tramite servizio; capability consumata', async t => {
    const f = await fixture(t), cap = await authorized(f);
    assert.equal((await f.service.execute(cap)).state, 'confirmed');
    assert.equal(f.actCount, 1);
    await assert.rejects(f.service.execute(cap));
    assert.throws(() => f.service.acquire(f.plan.operationId));
    const stored = f.db.prepare('SELECT * FROM settings').all();
    for (const sentinel of SENTINELS) assert.ok(!JSON.stringify(stored).includes(sentinel));
    assert.equal(f.db.prepare("SELECT count(*) FROM audit_events WHERE redacted_metadata LIKE '%state:confirmed\"%'").pluck().get(), 1);
    assert.ok(f.traffic.some(item => SENTINELS.every(sentinel => item.body.includes(sentinel))));
    assert.equal(f.service.inspect(f.plan.operationId).receipt?.planDigest, planDigest(f.plan));
});

test('CU-1a: capability vincolata al contesto corrente e non clonabile', async t => {
    const fields = ['sessionId', 'clientId', 'operatorId', 'patientId', 'practiceId', 'portalAccountId', 'installationId', 'archiveGeneration'] as const;
    for (const field of fields) {
        const f = await fixture(t), cap = f.service.create(f.plan.operationId);
        f.setContext({ [field]: 'synthetic-other' });
        await assert.rejects(f.service.prepare(cap), { message: 'denied' }, field);
        assert.equal(f.traffic.length, 0);
    }
    const f = await fixture(t), cap = f.service.create(f.plan.operationId);
    await assert.rejects(f.service.prepare({ ...cap }));
    f.advance(300_001); await assert.rejects(f.service.prepare(cap));
    assert.equal(f.traffic.length, 0);
});

test('CU-1a: approvazione solo locale, esatta e revocata quando cambia il contenuto', async t => {
    const f = await fixture(t), cap = await authorized(f);
    f.setPlan({ fields: f.plan.fields.map((field, index) => index === 2 ? { ...field, value: 'SYNTHETIC_CHANGED' } : field) });
    await assert.rejects(f.service.execute(cap));
    assert.equal(f.actCount, 0);
    const replacement = f.service.revise(f.plan.operationId);
    await f.service.prepare(replacement);
    await assert.rejects(f.service.execute(replacement));
    f.setConfirmation(async () => false);
    await assert.rejects(f.service.approve(replacement));
    f.setConfirmation(async () => { f.setContext({ humanRevision: 2 }); return true; });
    await assert.rejects(f.service.approve(replacement));
    assert.equal(f.actCount, 0);
});

test('CU-1a: revoca e scadenza impediscono replay e atto', async t => {
    const f = await fixture(t), cap = await authorized(f);
    f.service.revoke();
    await assert.rejects(f.service.execute(cap));
    const fresh = f.service.resume(f.plan.operationId);
    await assert.rejects(f.service.execute(fresh));
    await f.service.prepare(fresh); await f.service.approve(fresh);
    f.advance(120_001);
    await assert.rejects(f.service.execute(fresh));
    assert.equal(f.actCount, 0);
});

test('CU-1a: sospensione durevole, ripresa della stessa pratica e nuova autorità', async t => {
    const f = await fixture(t), cap = await authorized(f);
    const suspended = f.service.suspend(cap, 'choice', 'Attesa di documentazione inventata');
    assert.equal(suspended.state, 'suspended'); assert.equal(suspended.resumeState, 'authorized');
    f.reopen();
    assert.equal(f.service.inspect(f.plan.operationId).state, 'suspended');
    assert.equal(f.service.inspect(f.plan.operationId).suspensionNote, 'Attesa di documentazione inventata');
    await assert.rejects(f.service.execute(cap));
    const fresh = f.service.resume(f.plan.operationId);
    await f.service.prepare(fresh); await f.service.approve(fresh);
    assert.equal((await f.service.execute(fresh)).practiceId, f.plan.practiceId);
    assert.equal(f.actCount, 1);
});

test('CU-1a: risposta persa, riavvio, riconciliazione senza duplicato', async t => {
    const f = await fixture(t), cap = await authorized(f);
    f.loseResponse(); await assert.rejects(f.service.execute(cap));
    assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain'); assert.equal(f.actCount, 1);
    f.reopen(); const fresh = f.service.resume(f.plan.operationId);
    await assert.rejects(f.service.execute(fresh));
    await assert.rejects(f.service.prepare(fresh));
    assert.equal((await f.service.reconcile(fresh)).state, 'confirmed');
    await assert.rejects(f.service.reconcile(fresh));
    assert.equal(f.actCount, 1);
});

test('CU-1a: errore writer finale conserva ricevuta; recupero locale senza rete', async t => {
    const f = await fixture(t), cap = await authorized(f);
    f.db.exec(`CREATE TRIGGER synthetic_writer_failure BEFORE INSERT ON audit_events
        WHEN NEW.redacted_metadata LIKE '%state:confirmed"%' BEGIN SELECT RAISE(IGNORE); END`);
    await assert.rejects(f.service.execute(cap));
    assert.equal(f.service.inspect(f.plan.operationId).state, 'confirmed_pending_recording');
    const calls = f.traffic.length;
    f.db.exec('DROP TRIGGER synthetic_writer_failure'); f.reopen();
    const fresh = f.service.resume(f.plan.operationId);
    assert.equal((await f.service.reconcile(fresh)).state, 'confirmed');
    assert.equal(f.traffic.length, calls); assert.equal(f.actCount, 1);
});

test('CU-1a: pacchetto disattivo prima dell’atto: zero rete e nessun writer territoriale', async t => {
    const f = await fixture(t), cap = await authorized(f);
    const calls = f.traffic.length;
    f.setTerritory('core');
    assert.equal(f.service.inspect(f.plan.operationId).state, 'suspended_pack_disabled');
    const audit = f.db.prepare('SELECT count(*) FROM audit_events').pluck().get();
    await assert.rejects(f.service.execute(cap));
    await assert.rejects(f.service.reconcile(cap));
    await assert.rejects(f.backgroundProbe());
    assert.throws(() => f.service.resume(f.plan.operationId));
    assert.equal(f.traffic.length, calls);
    assert.equal(f.db.prepare('SELECT count(*) FROM audit_events').pluck().get(), audit);
    f.reopen(); assert.equal(f.service.inspect(f.plan.operationId).state, 'suspended_pack_disabled');
    f.setTerritory('core+it+lom');
    const fresh = f.service.resume(f.plan.operationId);
    await assert.rejects(f.service.execute(fresh));
    assert.equal(f.actCount, 0);
});

test('CU-1a: disattivazione dopo possibile atto ignora risposta tardiva; niente riconciliazione fino a riattivazione', async t => {
    const f = await fixture(t), cap = await authorized(f);
    f.setAfterAct(async () => { f.setTerritory('core'); });
    await assert.rejects(f.service.execute(cap));
    assert.equal(f.actCount, 1); assert.ok(f.stopped > 0);
    assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
    const calls = f.traffic.length;
    await assert.rejects(f.service.reconcile(cap));
    assert.equal(f.traffic.length, calls);
    f.reopen(); f.setTerritory('core+it+lom');
    const fresh = f.service.resume(f.plan.operationId);
    assert.equal((await f.service.reconcile(fresh)).state, 'confirmed');
    assert.equal(f.actCount, 1);
});

test('CU-1a: nessun atto automatico senza protezione finale; riconciliazione dell’atto manuale', async t => {
    const f = await fixture(t); f.setPlan({ finalAct: 'manual' });
    const cap = f.service.create(f.plan.operationId);
    assert.equal((await f.service.prepare(cap)).state, 'awaiting_manual_act');
    assert.equal(f.actCount, 0);
    await assert.rejects(f.service.approve(cap)); await assert.rejects(f.service.execute(cap));
    await assert.rejects(f.service.reconcile(cap));
    assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
    f.manualAct();
    assert.equal((await f.service.reconcile(cap)).state, 'confirmed');
    assert.equal(f.actCount, 1);
});

test('CU-1a: contenuto modificato nel passo manuale richiede nuova revisione locale', async t => {
    const f = await fixture(t); f.setPlan({ finalAct: 'manual' });
    const cap = f.service.create(f.plan.operationId); await f.service.prepare(cap);
    f.setPlan({ sourceVersion: '2', fields: f.plan.fields.map(field => ({ ...field, value: `${field.value}_REVIEWED` })) });
    f.manualAct();
    await assert.rejects(f.service.reconcile(cap));
    const fresh = await f.service.reviewManualContent(f.plan.operationId);
    await assert.rejects(f.service.execute(fresh));
    assert.equal((await f.service.reconcile(fresh)).state, 'confirmed');
    assert.equal(f.actCount, 1);
});

test('CU-1a: errore o audit ignorato prima dell’atto non invia e non registra successo', async t => {
    for (const failure of ['IGNORE', "FAIL, 'synthetic'"]) {
        const f = await fixture(t), cap = await authorized(f);
        f.db.exec(`CREATE TRIGGER synthetic_attempt_fault BEFORE INSERT ON audit_events
            WHEN NEW.redacted_metadata LIKE '%state:attempt_started%' BEGIN SELECT RAISE(${failure}); END`);
        await assert.rejects(f.service.execute(cap));
        assert.equal(f.actCount, 0);
        assert.equal(f.service.inspect(f.plan.operationId).attempt, 0);
        assert.equal(f.db.prepare("SELECT count(*) FROM audit_events WHERE redacted_metadata LIKE '%state:attempt_started%'").pluck().get(), 0);
    }
});

test('CU-1a: UI, paziente, pratica, account e campi ignoti bloccano prima di compilare', async t => {
    for (const value of [{ patientId: 'wrong' }, { practiceId: 'wrong' }, { portalAccountId: 'wrong' }, { uiVersion: 'wrong' },
        { humanRevision: 99 }, { unclassifiedFields: ['SYNTHETIC_HOSTILE_NEW_FIELD'] }]) {
        const f = await fixture(t), cap = f.service.create(f.plan.operationId);
        f.setWrongObservation(value); await assert.rejects(f.service.prepare(cap));
        assert.equal(f.traffic.filter(item => item.method === 'POST').length, 0);
    }
});

test('CU-1a: destinazioni, percorsi e richieste di fondo non ammesse sono negate', async t => {
    const f = await fixture(t), cap = f.service.create(f.plan.operationId);
    f.setExtraRequest({ origin: f.plan.destinations[0]!.origin, path: '/hostile-beacon', method: 'POST', purpose: 'prepare' });
    await assert.rejects(f.service.prepare(cap));
    assert.equal(f.traffic.filter(item => item.path === '/hostile-beacon').length, 0);
    f.setExtraRequest(f.plan.destinations.find(destination => destination.purpose === 'act')!);
    await assert.rejects(f.service.prepare(cap));
    assert.equal(f.traffic.filter(item => item.path === '/act').length, 0);
    f.setExtraRequest(null); f.setTerritory('core', false);
    const calls = f.traffic.length;
    await assert.rejects(f.service.prepare(cap));
    assert.equal(f.traffic.length, calls);
});

test('CU-1a: tentativi concorrenti e nuovo ID sulla stessa pratica non duplicano l’atto', async t => {
    const f = await fixture(t), cap = await authorized(f);
    const results = await Promise.allSettled([f.service.execute(cap), f.service.execute(cap)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.actCount, 1);
    const g = await fixture(t); g.service.create(g.plan.operationId);
    g.setPlan({ operationId: 'synthetic-other-operation' });
    assert.throws(() => g.service.create(g.plan.operationId), /conflict/);
});

test('CU-1a: una seconda istanza invalida la precedente approvazione tramite revisione durevole', async t => {
    const f = await fixture(t), oldCap = await authorized(f);
    const second = createLocalOperationService(f.ports); t.after(() => second.close());
    const cap = second.acquire(f.plan.operationId);
    await second.prepare(cap); await second.approve(cap);
    await assert.rejects(f.service.execute(oldCap));
    assert.equal((await second.execute(cap)).state, 'confirmed');
    assert.equal(f.actCount, 1);
});

test('CU-1a: lease del passo terminata vieta anche il traffico di fondo residuo', async t => {
    const f = await fixture(t), cap = f.service.create(f.plan.operationId);
    await f.service.prepare(cap); const calls = f.traffic.length;
    await assert.rejects(f.backgroundProbe());
    assert.equal(f.traffic.length, calls);
});

test('CU-1a: ricevuta parziale, contraffatta o non correlata lascia esito incerto', async t => {
    for (const change of [ { patientId: 'wrong' }, { planDigest: 'a'.repeat(64) }, { evidence: 'forged' },
        { parts: [{ id: 'synthetic-part-1', state: 'confirmed' as const }] } ]) {
        const f = await fixture(t), cap = await authorized(f); f.loseResponse();
        await assert.rejects(f.service.execute(cap));
        f.setReceipt({ ...f.receipt!, ...change });
        await assert.rejects(f.service.reconcile(cap));
        assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain'); assert.equal(f.actCount, 1);
    }
});

test('CU-1a: riferimento pubblico di sessione, revoca e limiti di polling', async t => {
    const f = await fixture(t), cap = f.service.create(f.plan.operationId);
    let session: string | null = 'authenticated-child-1', opened = 0, resumed = 0;
    const ports = { service: f.service, currentSessionBinding: () => session, now: f.now,
        requestOpen: async () => { opened++; }, requestResume: async () => { resumed++; } };
    const host = createLocalOperationRemoteHost(ports), other = createLocalOperationRemoteHost(ports);
    const ref = host.publish(cap);
    assert.match(ref, /^lo_[a-f0-9]{32}$/); assert.equal(new Set([ref, host.publish(cap)]).size, 2);
    assert.equal((await other.remote.request({ action: 'status', ref })).status, 'unavailable');
    assert.equal((await host.remote.request({ action: 'status', ref })).status, 'local_result_available');
    assert.equal((await host.remote.request({ action: 'status', ref })).status, 'unavailable');
    f.advance(250); await host.remote.request({ action: 'resume', ref }); assert.equal(resumed, 1);
    f.advance(250); await host.remote.request({ action: 'open' }); assert.equal(opened, 1);
    session = 'authenticated-child-2'; f.advance(250);
    assert.equal((await host.remote.request({ action: 'status', ref })).status, 'unavailable');
    session = 'authenticated-child-1'; f.service.revoke(); f.advance(250);
    assert.equal((await host.remote.request({ action: 'status', ref })).status, 'unavailable');
    for (const sentinel of SENTINELS) assert.ok(!JSON.stringify(await host.remote.request({ action: 'status', ref })).includes(sentinel));
});
