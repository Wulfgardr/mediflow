import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { syntheticFixture } from './synthetic.fixture.ts';

// Esempi del contratto comune: nessun adapter o validatore clinico specifico.
const examples = [
    { id: 'specialistica', territory: 'lom', fields: { prestazione: 'DEMO.01', quantità: '2', quesito: 'Controllo inventato', esenzione: 'DEMO-E' } },
    { id: 'farmaceutica', territory: 'lom', fields: { aic: 'DEMO-AIC', dose: '0,5 mg', confezioni: '2', sostituibilità: 'Decisione inventata del medico' } },
    { id: 'protesica', territory: 'lom', fields: { ausilio: 'DEMO-ISO', misura: '12,5 cm', allegato: 'Scheda inventata v1', atto: 'inserimento' } },
    { id: 'esenzioni', territory: 'lom', fields: { contenitore: 'DEMO-RICETTA', titolo: 'DEMO-E', rigaEsente: 'DEMO.01', rigaNonEsente: 'DEMO.02' } },
    { id: 'inps', territory: 'it', fields: { ramo: 'DEMO-TERRITORIO-v1', diagnosi: 'Testo inventato integrale', allegato: 'PDF inventato v1', atto: 'presentazione' } },
] as const;

async function fixture(t: TestContext, example: typeof examples[number], manual = false) {
    const f = await syntheticFixture(); t.after(() => f.close());
    assert.notEqual(new URL(f.plan.destinations[0]!.origin).port, '3000');
    f.setPlan({ procedureId: `synthetic-contract-${example.id}`, territory: example.territory,
        finalAct: manual ? 'manual' : 'protected',
        fields: Object.entries(example.fields).map(([name, value]) => ({ name, value,
            classification: 'clinical', sourceRef: 'physician-decision', sourceVersion: '1',
            transformation: 'none', required: true })) });
    if (example.territory === 'it') f.setTerritory('core+it');
    return f;
}
for (const example of examples) {
    test(`CU contratto ${example.id}: contenuto esatto, sospensione e ripresa della stessa pratica`, async t => {
        const f = await fixture(t, example), cap = f.service.create(f.plan.operationId);
        await f.service.prepare(cap); await f.service.approve(cap);
        f.service.suspend(cap, 'choice', 'Attesa di documento inventato');
        f.reopen();
        assert.equal(f.service.inspect(f.plan.operationId).state, 'suspended');
        await assert.rejects(f.service.execute(cap));
        const fresh = f.service.resume(f.plan.operationId);
        await f.service.prepare(fresh); await f.service.approve(fresh);
        const result = await f.service.execute(fresh);
        assert.equal(result.state, 'confirmed'); assert.equal(result.practiceId, f.plan.practiceId);
        assert.equal(f.actCount, 1);
        const sent = JSON.parse(f.traffic.find(item => item.path === '/act')!.body);
        assert.deepEqual(sent.fields, f.plan.fields);
        await assert.rejects(f.service.execute(fresh));
    });
    test(`CU contratto ${example.id}: atto manuale, ricevuta assente e parziale senza reinvio`, async t => {
        const f = await fixture(t, example, true), cap = f.service.create(f.plan.operationId);
        assert.equal((await f.service.prepare(cap)).state, 'awaiting_manual_act');
        await assert.rejects(f.service.execute(cap)); assert.equal(f.actCount, 0);
        await assert.rejects(f.service.reconcile(cap));
        assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
        const receipt = f.manualAct();
        f.setReceipt({ ...receipt, parts: receipt.parts.slice(0, 1) });
        await assert.rejects(f.service.reconcile(cap));
        assert.equal(f.service.inspect(f.plan.operationId).state, 'uncertain');
        f.setReceipt(receipt);
        assert.equal((await f.service.reconcile(cap)).state, 'confirmed');
        assert.equal(f.actCount, 1);
    });
    for (const afterAct of [false, true]) {
        test(`CU contratto ${example.id}: pacchetto disattivato ${afterAct ? 'dopo' : 'prima'} dell'atto, riavvio e zero accessi`, async t => {
            const f = await fixture(t, example), cap = f.service.create(f.plan.operationId);
            await f.service.prepare(cap); await f.service.approve(cap);
            if (afterAct) {
                f.setAfterAct(async () => { f.setTerritory('core'); });
                await assert.rejects(f.service.execute(cap));
            } else f.setTerritory('core');
            const calls = f.traffic.length;
            const audit = f.db.prepare('SELECT count(*) FROM audit_events').pluck().get();
            await assert.rejects(f.service.execute(cap));
            await assert.rejects(f.service.reconcile(cap));
            await assert.rejects(f.backgroundProbe());
            assert.equal(f.traffic.length, calls);
            assert.equal(f.db.prepare('SELECT count(*) FROM audit_events').pluck().get(), audit);
            f.reopen();
            assert.equal(f.service.inspect(f.plan.operationId).state, afterAct ? 'uncertain' : 'suspended_pack_disabled');
            assert.throws(() => f.service.resume(f.plan.operationId));
            assert.equal(f.traffic.length, calls);
            f.setTerritory(example.territory === 'it' ? 'core+it' : 'core+it+lom');
            const fresh = f.service.resume(f.plan.operationId);
            await assert.rejects(f.service.execute(fresh));
            if (afterAct) assert.equal((await f.service.reconcile(fresh)).state, 'confirmed');
            else {
                await f.service.prepare(fresh); await f.service.approve(fresh);
                assert.equal((await f.service.execute(fresh)).state, 'confirmed');
            }
            assert.equal(f.actCount, 1);
        });
    }
}
