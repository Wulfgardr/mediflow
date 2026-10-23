import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLocalOperationHost } from './host.ts';
import { createLocalOperationJournalCipher } from './journal-cipher.ts';
import { syntheticFixture, SENTINELS } from './synthetic.fixture.ts';
import { LOCAL_OPERATION_TOOL } from '../../packages/mcp/src/local-operation-contract.ts';

async function fixture() {
    const f = await syntheticFixture(); f.service.close();
    const generation = randomUUID(), key = randomBytes(32);
    f.db.exec('CREATE TABLE archive_generation(id INTEGER PRIMARY KEY, generation TEXT NOT NULL)');
    f.db.prepare('INSERT INTO archive_generation VALUES (1,?)').run(generation);
    f.setContext({ archiveGeneration: generation }); f.setPlan({ archiveGeneration: generation });
    const host = createLocalOperationHost({ ...f.ports, currentArchiveKey: () => key, database: () => f.db,
        sourceSurface: 'native', requestOpen: async () => {}, requestResume: async () => {} });
    return { f, host, close: async () => { host.close(); await f.close(); } };
}

test('CU-1a: composizione host usa archivio/capacità correnti e solo il servizio scrive esito e audit', async t => {
    const x = await fixture(); t.after(x.close);
    const { f, host } = x, service = host.trusted;
    const cap = service.create(f.plan.operationId);
    await service.prepare(cap); await service.approve(cap);
    assert.equal((await service.execute(cap)).state, 'confirmed');
    const raw = f.db.prepare('SELECT value FROM settings WHERE key=?').pluck().get('localOperationJournal.v1') as string;
    assert.match(raw, /^CU1:/);
    for (const sentinel of SENTINELS) assert.ok(!raw.includes(sentinel));
    assert.equal(f.db.prepare("SELECT count(*) FROM audit_events WHERE event_type='local_operation.changed' AND source_surface='native'").pluck().get(), 6);
});

test('CU-1a: host nega archivio sostituito e capacità disattiva anche senza notifica/cache del client', async t => {
    const x = await fixture(); t.after(x.close);
    const { f, host } = x, service = host.trusted;
    const cap = service.create(f.plan.operationId);
    f.setTerritory('core', false);
    await assert.rejects(service.prepare(cap)); assert.equal(f.traffic.length, 0);
    f.setTerritory('core+it+lom', false);
    const fresh = service.resume(f.plan.operationId);
    f.db.prepare('UPDATE archive_generation SET generation=?').run(randomUUID());
    await assert.rejects(service.prepare(fresh)); assert.equal(f.traffic.length, 0);
});

test('CU-1a: porta AIP del figlio espone solo il protocollo remoto, senza approvazione o journal', async t => {
    const x = await fixture(); t.after(x.close);
    const listeners = new Set<(frame: unknown) => void>(), closures = new Set<() => void>(), received: string[] = [];
    const child = x.host.attachChild({
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        publish(frame) { received.push(frame); },
        onClose(listener) { closures.add(listener); return () => { closures.delete(listener); }; },
    });
    const cap = x.host.trusted.create(x.f.plan.operationId), ref = x.host.publish(child, cap);
    for (const listener of listeners) listener(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call',
        requestId: 'rpc_lo_1', operationId: LOCAL_OPERATION_TOOL, input: { action: 'open' } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.parse(received.at(-1)!).result.value.ref, ref);
    assert.deepEqual(Object.keys(JSON.parse(received.at(-1)!).result.value).sort(), ['ref', 'schema', 'status']);
    for (const listener of listeners) listener(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call',
        requestId: 'rpc_lo_2', operationId: 'mediflow.approve', input: { approved: true } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(JSON.parse(received.at(-1)!).outcome, 'completed');
    for (const listener of [...closures]) listener();
    assert.throws(() => x.host.publish(child, cap));
    await assert.rejects(x.host.trusted.prepare(cap));
    assert.equal(x.f.traffic.length, 0);
});

test('CU-1a: journal cifrato autenticato, chiave host necessaria e corruzione negata', () => {
    let key: Uint8Array | null = randomBytes(32);
    const cipher = createLocalOperationJournalCipher(() => key), plaintext = SENTINELS.join('|');
    const first = cipher.seal(plaintext), second = cipher.seal(plaintext);
    assert.notEqual(first, second); assert.equal(cipher.open(first), plaintext);
    const changed = Buffer.from(first.slice(4), 'base64'); changed[changed.length - 1]! ^= 1;
    assert.throws(() => cipher.open(`CU1:${changed.toString('base64')}`), /corrupt/);
    key = randomBytes(32); assert.throws(() => cipher.open(first), /corrupt/);
    key = null; assert.throws(() => cipher.seal(plaintext), /denied/);
});
