import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableTherapyStatusConfirmation, createTherapyCommandJournal, type DurableStatusState } from './therapy-status-command-confirmation.ts';
import { createTherapyStatusWriteJournal } from './therapy-status-confirmation.ts';
import { THERAPY_STATUS_PROTOCOL } from './therapy-status-command-contract.ts';

// Rischio #5 (censimento macchine a stati, 11/11): il controller durevole
// della terapia (ADR 0168) non è nel modello TLA+. L'invariante del modello
// legacy AdmissionIsNotUncertain dice che un comando mai inviato non diventa
// «esito incerto». Qui la sessione si blocca (signal abortito) mentre il
// marker locale è in fase di claim, quindi nessuna richiesta parte.
const generation = 'b47fd783-6813-4c62-9d56-062099fa5111';
const therapy = { id: 'synthetic-therapy', patientId: 'synthetic-patient', version: 3, drugName: 'Farmaco inventato', dosage: 'Dose inventata', status: 'active' as const };

function fixture() {
    const storage = new Map<string, string>();
    let gate: Promise<void> | null = null, open!: () => void, calls = 0;
    const signal = new AbortController();
    const env = { archive: () => generation,
        storage: () => ({ getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } }),
        locks: () => ({ request: async (_: string, action: () => unknown) => { if (gate) await gate; return action(); } }) };
    const legacy = createTherapyStatusWriteJournal(env as never), journal = createTherapyCommandJournal(env as never, legacy);
    let state: DurableStatusState<typeof therapy> | null = null;
    const owner = createDurableTherapyStatusConfirmation({ patientId: therapy.patientId, archive: () => generation, journal, legacy,
        signal: () => signal.signal, isCurrent: () => true, read: async () => [therapy],
        request: async () => { calls++; return { outcome: 'unknown' }; },
        changed: value => { state = value; }, refreshed: () => undefined, timeoutMs: 100 });
    return { owner, journal, storage, state: () => state, calls: () => calls, abort: () => signal.abort(),
        hold() { gate = new Promise(resolve => { open = () => { gate = null; resolve(); }; }); }, release: () => open() };
}

test('sessione bloccata durante il claim: il comando non inviato non resta incerto né col marker', async () => {
    const f = fixture();
    f.owner.begin(therapy, 'completed', 'Paziente inventato');
    f.hold();
    const pending = f.owner.confirm();
    await new Promise(resolve => setTimeout(resolve, 5));
    f.abort();
    f.release();
    await pending;
    assert.equal(f.calls(), 0, 'nessuna richiesta è partita');
    assert.notEqual(f.state()?.phase, 'uncertain', 'un comando mai inviato non è un esito incerto');
    assert.equal(f.journal.get(therapy.patientId), null, 'il marker di un comando mai inviato non resta in localStorage');
});

test('claim negato a sessione bloccata: il controller non resta in scrittura', async () => {
    const f = fixture();
    f.owner.begin(therapy, 'completed', 'Paziente inventato');
    f.hold();
    const pending = f.owner.confirm();
    await new Promise(resolve => setTimeout(resolve, 5));
    // Un'altra scheda ha già un comando in sospeso per lo stesso paziente: il claim restituirà false.
    f.storage.set(`mediflow:therapy-status-command:v1:${encodeURIComponent(generation)}:${encodeURIComponent(therapy.patientId)}`,
        JSON.stringify({ commandId: '9c7e1f5e-2d1b-4f7a-9d0e-0a6b5c4d3e2f', protocol: THERAPY_STATUS_PROTOCOL, archiveGeneration: generation,
            patientId: therapy.patientId, therapyId: therapy.id, expectedVersion: 3 }));
    f.abort();
    f.release();
    await pending;
    assert.equal(f.calls(), 0, 'nessuna richiesta è partita');
    assert.notEqual(f.state()?.phase, 'writing', 'confirm() è terminata: la fase non può restare «writing»');
    assert.notEqual(f.state()?.writePending, true, 'nessuna scrittura è in corso');
});
