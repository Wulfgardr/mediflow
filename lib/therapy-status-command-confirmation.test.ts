import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDurableTherapyStatusConfirmation, createTherapyCommandJournal, type DurableStatusState } from './therapy-status-command-confirmation.ts';
import { createTherapyStatusWriteJournal } from './therapy-status-confirmation.ts';
import type { TherapyCommandResponse } from './therapy-status-command-client.ts';
const generation = 'b47fd783-6813-4c62-9d56-062099fa5111';
const therapy = { id: 'synthetic-therapy', patientId: 'synthetic-patient', version: 3, drugName: 'Farmaco inventato', dosage: 'Dose inventata', status: 'active' as const };
function fixture(timeoutMs = 100) {
    const storage = new Map<string, string>();
    let locked = false, ownerCurrent = true, unavailable = false, version = 3, calls = 0;
    let signal = new AbortController();
    const env = { archive: () => generation, storage: () => ({ getItem: (key: string) => { if (unavailable) throw new Error('storage unavailable'); return storage.get(key) ?? null; }, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } }),
        locks: () => ({ request: async (_: string, action: () => unknown) => { while (locked) await new Promise(resolve => setTimeout(resolve, 1)); locked = true; try { return action(); } finally { locked = false; } } }) };
    const legacy = createTherapyStatusWriteJournal(env as never), journal = createTherapyCommandJournal(env as never, legacy);
    let state: DurableStatusState<typeof therapy> | null = null;
    let response: TherapyCommandResponse = { outcome: 'unknown' };
    let remote: ((...args: unknown[]) => Promise<TherapyCommandResponse>) | undefined;
    const operations: string[] = [];
    const make = () => createDurableTherapyStatusConfirmation({ patientId: therapy.patientId, archive: () => generation, journal, legacy,
        signal: () => signal.signal, isCurrent: () => ownerCurrent,
        read: async () => [{ ...therapy, version }],
        request: async (op, command) => { calls++; operations.push(op); if (remote) return remote(op, command); return response; },
        changed: value => { state = value; }, refreshed: () => undefined, timeoutMs });
    return { make, journal, legacy, storage, operations, state: () => state, calls: () => calls,
        setResponse(value: TherapyCommandResponse) { response = value; }, setRemote(value: typeof remote) { remote = value; },
        lock() { signal.abort(); }, unlock() { signal = new AbortController(); }, leave() { ownerCurrent = false; }, setUnavailable() { unavailable = true; }, setVersion(n: number) { version = n; } };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 20));
test('production consumer uses durable controller; legacy model remains recovery-only', () => {
    const source = readFileSync(new URL('../components/therapy-manager.tsx', import.meta.url), 'utf8');
    assert.match(source, /createDurableTherapyStatusConfirmation<Therapy>/);
    assert.match(source, /request: requestTherapyStatusCommand/);
    assert.doesNotMatch(source, /write: \(therapy, status/);
    assert.match(source, /Ritira richiesta e verifica/);
});
test('only explicit confirmation sends once, marker opaque, unknown does not retry on reread/reload', async () => {
    const f = fixture(), owner = f.make();
    owner.begin(therapy, 'completed', 'Paziente inventato'); assert.equal(f.calls(), 0);
    await Promise.all([owner.confirm(), owner.confirm()]); assert.deepEqual(f.operations, ['execute']);
    const marker = JSON.parse([...f.storage.values()][0]!);
    assert.deepEqual(Object.keys(marker).sort(), ['archiveGeneration', 'commandId', 'expectedVersion', 'patientId', 'protocol', 'therapyId']);
    assert.equal(f.state()?.phase, 'uncertain');
    f.setVersion(20); await owner.reread(); assert.equal(f.state()?.phase, 'uncertain');
    owner.cancel(); assert(owner.blocked); owner.dispose();
    const remount = f.make(); await remount.recover([{ ...therapy, version: 20 }], 'Paziente inventato');
    assert.equal(f.state()?.target, undefined); await remount.reread();
    assert.deepEqual(f.operations, ['execute', 'receipt', 'receipt']); assert.equal(f.state()?.phase, 'uncertain');
});
test('close resolves only from terminal host response and retains historical/current distinction', async () => {
    const f = fixture(), owner = f.make(); owner.begin(therapy, 'suspended', 'Inventato'); await owner.confirm();
    const command = f.journal.get(therapy.patientId)!;
    f.setResponse({ outcome: 'terminal', historical: true, receipt: { ...command, actorRef: 'synthetic-actor', target: null, outcome: 'closed', reason: null, committedAt: 10, resultVersion: null, resultEndDate: null, auditEventId: null } });
    await owner.close(); assert.equal(f.state()?.phase, 'reviewed'); assert.equal(f.state()?.historical, true);
    assert.equal(f.state()?.current?.version, 3); assert.equal(f.journal.get(therapy.patientId), null);
    assert.deepEqual(f.operations, ['execute', 'close']); assert.equal(owner.blocked, false);
});
test('two tab claim serializes and only one execute reaches host', async () => {
    const f = fixture(), a = f.make(), b = f.make();
    a.begin(therapy, 'suspended', 'A'); b.begin(therapy, 'completed', 'B');
    await Promise.all([a.confirm(), b.confirm()]); assert.equal(f.calls(), 1); assert(a.blocked); assert(b.blocked);
});
test('legacy unresolved marker blocks new protocol and preserves legacy recovery', async () => {
    const f = fixture(), owner = f.make();
    await f.legacy.claim({ id: 'legacy-synthetic', patientId: therapy.patientId, therapyId: therapy.id, version: 3, outcome: 'unknown' });
    await owner.recover([therapy], 'Inventato'); assert.equal(f.state()?.legacy, true); assert(owner.blocked);
    owner.begin(therapy, 'completed', 'Inventato'); await owner.confirm(); await owner.close();
    assert.equal(f.calls(), 0); assert(f.legacy.get(therapy.patientId));
});
for (const stop of ['lock', 'patient', 'timeout'] as const) test(`late execute completion after ${stop} never clears marker or grants new intent`, async () => {
    const f = fixture(stop === 'timeout' ? 10 : 100), owner = f.make(); let resolve!: (value: TherapyCommandResponse) => void;
    f.setRemote(() => new Promise(yes => { resolve = yes; }));
    owner.begin(therapy, 'completed', 'Inventato'); const pending = owner.confirm(); await turn();
    if (stop === 'lock') f.lock(); if (stop === 'patient') f.leave();
    const command = f.journal.get(therapy.patientId)!;
    resolve({ outcome: 'terminal', historical: false, receipt: { ...command, actorRef: 'synthetic-actor', target: 'completed', outcome: 'applied', committedAt: 10, resultEndDate: 10, resultVersion: 4, reason: null, auditEventId: 'synthetic-audit' } });
    await pending; await turn(); if (stop !== 'patient') assert.equal(f.state()?.phase, 'uncertain'); assert(f.journal.get(therapy.patientId)); assert(owner.blocked); assert.equal(f.calls(), 1);
});
test('storage unavailable denies before transport', async () => {
    const f = fixture(), owner = f.make(); owner.begin(therapy, 'completed', 'Inventato'); f.setUnavailable(); await owner.confirm(); assert.equal(f.calls(), 0); assert(owner.blocked);
});
