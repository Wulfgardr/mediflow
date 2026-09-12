/* @Codex: controller ports below are declared synthetic doubles, NOT auth/API evidence. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATIENT_CSV_HEADERS, PATIENT_CSV_LIMITS } from './patient-bulk-import.ts';
import {
    PatientBulkImportSession, PatientBulkReceiptStore, hasUnresolvedPatientBulkReceipt,
    type PatientBulkContext, type PatientBulkCreate, type PatientBulkObserved, type PatientBulkPorts, type PatientBulkWriteGuard,
} from './patient-bulk-import-session.ts';

const code = (index: number) => `SYNTHETIC${String(index).padStart(7, '0')}`;
const csv = (indexes = [1, 2, 3]) => `${PATIENT_CSV_HEADERS.join(';')}\n${indexes.map(i => `Ada;Sintetica;${code(i)};2000-02-29;Via Sintetica ${i};+39000${i}`).join('\n')}`;
function file(text = csv()): Pick<File, 'size' | 'arrayBuffer'> {
    const data = new TextEncoder().encode(text);
    return { size: data.byteLength, arrayBuffer: async () => data.buffer as ArrayBuffer };
}
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function harness(store = new PatientBulkReceiptStore()) {
    let signalOwner = new AbortController();
    let context: PatientBulkContext = { operatorId: 'operator-synthetic', ambulatoryId: 'clinic-A', ambulatoryName: 'Ambulatorio sintetico A', cookie: null, signal: signalOwner.signal };
    let sequence = 0;
    let clock = new Date('2026-01-01T12:00:00Z').getTime();
    let captures = 0;
    const guards: import('./patient-bulk-import-session.ts').PatientBulkWriteGuard[] = [];
    const writes: PatientBulkCreate[] = [];
    const records = new Map<string, PatientBulkObserved>();
    const reads: string[] = [];
    const ports: PatientBulkPorts = {
        captureContext: async () => ({ ...context }),
        captureCreateContext: async candidate => { captures += 1; return { version: 1, nonce: 'a'.repeat(64),
            ambulatoryId: candidate.ambulatoryId, ambulatoryName: 'Destinazione sintetica A dal server', expiresAt: clock + 300_000 }; },
        isCurrent: candidate => candidate.signal === context.signal && !candidate.signal.aborted
            && candidate.cookie === context.cookie && candidate.operatorId === context.operatorId && candidate.ambulatoryId === context.ambulatoryId,
        listPatients: async () => [...records.values()].filter(record => record.ambulatoryId === context.ambulatoryId),
        getPatient: async id => { reads.push(id); return records.get(id); },
        addPatient: async (input, guard) => { guards.push(guard); writes.push(input); records.set(input.id, { ...input, ambulatoryId: context.ambulatoryId }); return input.id; },
        createId: () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
        now: () => new Date(clock),
    };
    return {
        ports, store, writes, records, reads, guards,
        captures: () => captures,
        advance: (ms: number) => { clock += ms; },
        session: () => new PatientBulkImportSession(ports, store),
        context: () => context,
        change: (changes: Partial<PatientBulkContext>) => { context = { ...context, ...changes }; },
        lock: () => signalOwner.abort(),
        unlock: () => { signalOwner = new AbortController(); context = { ...context, signal: signalOwner.signal }; },
    };
}
async function confirmed(session: PatientBulkImportSession) {
    await session.confirm(session.getSnapshot().previewRevision, true);
}
const outcomes = (h: ReturnType<typeof harness>) => h.store.read()?.rows.map(row => row.outcome);

test('file selection, parse, list, false consent and stale revision all do zero writes', async () => {
    const h = harness(); const session = h.session();
    await session.observeReceipt(); await session.prepare(file());
    assert.equal(session.getSnapshot().phase, 'preview');
    await session.confirm(session.getSnapshot().previewRevision, false);
    await session.confirm(session.getSnapshot().previewRevision - 1, true);
    assert.equal(h.writes.length, 0); assert.equal(h.store.read(), undefined);
    session.dispose();
});
test('oversized file is denied without calling arrayBuffer', async () => {
    const h = harness(); const session = h.session(); let opened = false;
    await session.prepare({ size: PATIENT_CSV_LIMITS.fileBytes + 1, arrayBuffer: async () => { opened = true; return new ArrayBuffer(0); } });
    assert.equal(opened, false); assert.equal(h.writes.length, 0); assert.equal(session.getSnapshot().phase, 'error');
    session.dispose();
});
test('manual confirmation calls the create port sequentially and verifies each UUID', async () => {
    const h = harness(); const session = h.session();
    await session.prepare(file()); await confirmed(session);
    assert.equal(h.writes.length, 3); assert.equal(new Set(h.writes.map(row => row.id)).size, 3);
    assert.deepEqual(h.reads, h.writes.map(row => row.id));
    assert.deepEqual(outcomes(h), ['confirmed', 'confirmed', 'confirmed']);
    assert.equal(h.store.read()?.active, false);
    assert.equal(session.getSnapshot().phase, 'complete');
    assert.equal(h.writes[0].birthDate?.toISOString(), '2000-02-29T00:00:00.000Z');
    assert.equal(h.writes[0].createdAt.toISOString(), '2026-01-01T12:00:00.000Z');
    session.dispose();
});
test('empty optionals stay absent in the actual create payload', async () => {
    const h = harness(); const session = h.session();
    await session.prepare(file(`${PATIENT_CSV_HEADERS.join(';')}\nAda;Sintetica;${code(1)};;;`));
    await confirmed(session);
    for (const field of ['address', 'phone', 'birthDate', 'diagnoses', 'checkups', 'exemptions', 'notes']) assert.equal(Object.hasOwn(h.writes[0], field), false);
    session.dispose();
});
test('all invalid/file duplicate/existing duplicate rows excluded, with no mutation of existing records', async () => {
    const h = harness(); const session = h.session();
    const old = { id: 'preexisting', firstName: 'Old', lastName: 'Synthetic', taxCode: code(9), ambulatoryId: 'clinic-A' };
    h.records.set(old.id, old);
    await session.prepare(file(`${csv([1, 1, 9, 2])}\nA;B;INVALID;;;`));
    await confirmed(session);
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].taxCode, code(2));
    assert.deepEqual(outcomes(h), ['excluded', 'excluded', 'excluded', 'confirmed', 'excluded']);
    assert.deepEqual(h.records.get(old.id), old);
    session.dispose();
});
test('a changed list requires another manual confirmation, with a new revision', async () => {
    const h = harness(); const session = h.session();
    await session.prepare(file(csv([1, 2]))); const revision = session.getSnapshot().previewRevision;
    h.records.set('other-actor', { id: 'other-actor', firstName: 'Other', lastName: 'Synthetic', taxCode: code(1), ambulatoryId: 'clinic-A' });
    await confirmed(session);
    assert.equal(h.writes.length, 0); assert.equal(session.getSnapshot().phase, 'preview');
    assert.equal(session.getSnapshot().previewRevision, revision + 1);
    await session.confirm(revision, true); assert.equal(h.writes.length, 0);
    await confirmed(session); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].taxCode, code(2));
    session.dispose();
});
test('double confirmation while rechecking starts one batch only', async () => {
    const h = harness(); const recheck = deferred(); const entered = deferred();
    const original = h.ports.captureContext;
    let calls = 0;
    const session = new PatientBulkImportSession({ ...h.ports, captureContext: async () => {
        calls += 1; if (calls === 2) { entered.resolve(); await recheck.promise; } return original();
    } }, h.store);
    await session.prepare(file()); const revision = session.getSnapshot().previewRevision;
    const first = session.confirm(revision, true); await entered.promise;
    await session.confirm(revision, true); assert.equal(h.writes.length, 0);
    recheck.resolve(); await first; assert.equal(h.writes.length, 3);
    session.dispose();
});
test('first create rejection stops the queue; committed-before-rejection remains unknown until read-only reconciliation', async () => {
    const h = harness(); const original = h.ports.addPatient;
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        const id = await original(input, guard); if (h.writes.length === 2) throw new Error('SYNTHETIC_SECRET_ERROR_NOT_FOR_UI'); return id;
    } }, h.store);
    await session.prepare(file()); await confirmed(session);
    assert.deepEqual(outcomes(h), ['confirmed', 'unknown', 'not-sent']);
    assert.equal(h.writes.length, 2);
    const unknownId = h.store.read()?.rows[1].id;
    assert.equal(unknownId, h.writes[1].id);
    assert.equal(JSON.stringify(session.getSnapshot()).includes('SYNTHETIC_SECRET_ERROR_NOT_FOR_UI'), false);
    await confirmed(session); await session.prepare(file()); assert.equal(h.writes.length, 2);
    await session.reconcile(); assert.deepEqual(outcomes(h), ['confirmed', 'confirmed', 'not-sent']);
    assert.equal(h.store.read()?.rows[1].evidence, 'read-only'); assert.equal(h.store.read()?.rows[1].id, unknownId);
    assert.equal(h.writes.length, 2); session.dispose();
});
test('404/absence after a rejected create does not become a claim of rollback or safe automatic retry', async () => {
    const h = harness(); const session = new PatientBulkImportSession({ ...h.ports, addPatient: async () => { throw new Error('Fixture rejected'); } }, h.store);
    await session.prepare(file()); await confirmed(session); const id = h.store.read()?.rows[0].id;
    await session.reconcile(); assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']);
    assert.equal(h.store.read()?.rows[0].id, id); assert.equal(hasUnresolvedPatientBulkReceipt(h.store.read()), true);
    await session.prepare(file()); assert.equal(session.getSnapshot().phase, 'complete'); session.dispose();
});
test('cancel preview and cancel during list recheck both do zero writes', async () => {
    const h = harness(); const session = h.session(); await session.prepare(file()); session.cancel(); await confirmed(session);
    assert.equal(h.writes.length, 0); assert.equal(session.getSnapshot().preview, undefined); session.dispose();
    const gate = deferred(); const entered = deferred(); let count = 0;
    const second = new PatientBulkImportSession({ ...h.ports, listPatients: async () => {
        if (++count === 2) { entered.resolve(); await gate.promise; } return [];
    } }, h.store);
    await second.prepare(file()); const run = confirmed(second); await entered.promise; second.cancel(); gate.resolve(); await run;
    assert.equal(h.writes.length, 0); second.dispose();
});
test('cancel awaits the in-flight create and records it, without submitting remaining rows', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        const id = await h.ports.addPatient(input, guard); entered.resolve(); await gate.promise; return id;
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    const id = h.store.read()?.rows[0].id; assert.equal(h.store.read()?.rows[0].outcome, 'in-flight');
    session.cancel(); assert.equal(session.getSnapshot().phase, 'stopping'); assert.equal(h.writes.length, 1);
    gate.resolve(); await run;
    assert.deepEqual(outcomes(h), ['confirmed', 'not-sent', 'not-sent']); assert.equal(h.store.read()?.rows[0].id, id);
    assert.equal(h.store.read()?.stopReason, 'cancelled'); assert.equal(h.writes.length, 1); session.dispose();
});
test('cancel during the per-row context check prevents even the first create', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred(); let calls = 0;
    const session = new PatientBulkImportSession({ ...h.ports, captureContext: async () => {
        if (++calls === 3) { entered.resolve(); await gate.promise; } return h.context();
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    session.cancel(); gate.resolve(); await run;
    assert.equal(h.writes.length, 0); assert.deepEqual(outcomes(h), ['not-sent', 'not-sent', 'not-sent']); session.dispose();
});
test('lock invalidates preview synchronously; unlock does not restore authority to confirm that preview', async () => {
    const h = harness(); const session = h.session(); await session.prepare(file()); const revision = session.getSnapshot().previewRevision;
    h.lock(); assert.equal(session.getSnapshot().preview, undefined); h.unlock();
    await session.confirm(revision, true); assert.equal(h.writes.length, 0); session.dispose();
});
test('revocation during an in-flight create preserves only the stable receipt; a new session can reconcile, never auto-resume', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        const id = await h.ports.addPatient(input, guard); entered.resolve(); await gate.promise; return id;
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    const id = h.store.read()?.rows[0].id; h.lock(); assert.equal(session.getSnapshot().preview, undefined); session.dispose();
    gate.resolve(); await run;
    assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']);
    const metadata = JSON.stringify(h.store.read());
    for (const secret of ['Ada', 'Sintetica', code(1), 'Via Sintetica', '+39000']) assert.equal(metadata.includes(secret), false);
    h.unlock(); const next = h.session(); await next.observeReceipt();
    assert.equal(next.getSnapshot().receipt?.rows[0].id, id); assert.equal(next.getSnapshot().preview, undefined);
    assert.equal(h.writes.length, 1); await next.reconcile();
    assert.deepEqual(outcomes(h), ['confirmed', 'not-sent', 'not-sent']); assert.equal(h.writes.length, 1); next.dispose();
});
test('changed cookie or default ambulatorio before commit denies the old preview', async () => {
    for (const change of [{ cookie: 'clinic-B' }, { ambulatoryId: 'clinic-B' }]) {
        const h = harness(); const session = h.session(); await session.prepare(file()); h.change(change); await confirmed(session);
        assert.equal(h.writes.length, 0); assert.equal(session.getSnapshot().phase, 'invalidated'); session.dispose();
    }
});
test('context changing while add is in-flight is UNKNOWN, not misreported as saved in the reviewed ambulatorio', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        entered.resolve(); await gate.promise; return h.ports.addPatient(input, guard);
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    h.change({ ambulatoryId: 'clinic-B', cookie: 'clinic-B' }); gate.resolve(); await run;
    assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']); assert.equal(h.writes.length, 1);
    h.change({ ambulatoryId: 'clinic-A', cookie: null }); await session.reconcile();
    assert.equal(h.store.read()?.rows[0].outcome, 'unknown'); session.dispose();
});
test('navigation disposal stops queued creates and keeps uncertain in-flight UUID available to the next controller', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        const id = await h.ports.addPatient(input, guard); entered.resolve(); await gate.promise; return id;
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise; session.dispose(); gate.resolve(); await run;
    assert.equal(h.writes.length, 1); assert.equal(h.store.read()?.rows[0].outcome, 'unknown');
    const next = h.session(); await next.observeReceipt(); assert.ok(next.getSnapshot().receipt); await confirmed(next); assert.equal(h.writes.length, 1); next.dispose();
});
test('empty list returned on auth loss is not accepted as a successful empty-scope deduplication', async () => {
    const h = harness(); const session = new PatientBulkImportSession({ ...h.ports, listPatients: async () => { h.lock(); return []; } }, h.store);
    await session.prepare(file()); assert.equal(session.getSnapshot().phase, 'invalidated'); assert.equal(session.getSnapshot().preview, undefined);
    assert.equal(h.writes.length, 0); session.dispose();
});
test('old file-read completion cannot overwrite a newer preview after cancellation', async () => {
    const h = harness(); const gate = deferred<ArrayBuffer>(); const entered = deferred(); const session = h.session();
    const old = session.prepare({ size: 100, arrayBuffer: () => { entered.resolve(); return gate.promise; } });
    await entered.promise; session.cancel(); await session.prepare(file(csv([9])));
    gate.resolve(await file().arrayBuffer()); await old;
    assert.equal(session.getSnapshot().preview?.rows[0].values?.taxCode, code(9)); assert.equal(h.writes.length, 0); session.dispose();
});
test('old context-read completion after cancel cannot invalidate a newer preview', async () => {
    const h = harness(); const gate = deferred<PatientBulkContext>(); let first = true;
    const session = new PatientBulkImportSession({ ...h.ports, captureContext: async () => {
        if (first) { first = false; return gate.promise; } return h.context();
    } }, h.store);
    const old = session.prepare(file()); session.cancel(); await session.prepare(file(csv([9])));
    gate.resolve(h.context()); await old;
    assert.equal(session.getSnapshot().phase, 'preview'); assert.equal(session.getSnapshot().preview?.rows[0].values?.taxCode, code(9)); session.dispose();
});
test('context change during file read retires loading instead of leaving a stuck spinner', async () => {
    const h = harness(); const gate = deferred<ArrayBuffer>(); const entered = deferred(); const session = h.session();
    const run = session.prepare({ size: 100, arrayBuffer: () => { entered.resolve(); return gate.promise; } });
    await entered.promise; h.change({ cookie: 'clinic-B' }); gate.resolve(await file().arrayBuffer()); await run;
    assert.equal(session.getSnapshot().phase, 'invalidated'); assert.equal(h.writes.length, 0); session.dispose();
});
for (const fault of ['wrong-id', 'wrong-fields', 'read-error'] as const) {
    test(`successful HTTP-like acknowledgement still requires matching read-back: ${fault}`, async () => {
        const h = harness(); const session = new PatientBulkImportSession({ ...h.ports,
            addPatient: async (input, guard) => { const id = await h.ports.addPatient(input, guard); return fault === 'wrong-id' ? 'wrong' : id; },
            getPatient: async (id, signal) => {
                if (fault === 'read-error') throw new Error('Fixture read error');
                const record = await h.ports.getPatient(id, signal);
                return record && fault === 'wrong-fields' ? { ...record, taxCode: code(99) } : record;
            },
        }, h.store);
        await session.prepare(file()); await confirmed(session);
        assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']); assert.equal(h.writes.length, 1); session.dispose();
    });
}
test('invalid or repeated UUID generation never submits a create', async () => {
    for (const id of ['invalid', '00000000-0000-4000-8000-000000000001']) {
        const h = harness(); const session = new PatientBulkImportSession({ ...h.ports, createId: () => id }, h.store);
        await session.prepare(file()); await confirmed(session); assert.equal(h.writes.length, 0);
        if (h.store.read()) assert.equal(h.store.read()?.active, false); session.dispose();
    }
});
test('a receipt for another operator is not disclosed, and cannot be reconciled under that operator', async () => {
    const h = harness(); const session = new PatientBulkImportSession({ ...h.ports, addPatient: async () => { throw new Error('Fixture'); } }, h.store);
    await session.prepare(file()); await confirmed(session); session.dispose();
    h.change({ operatorId: 'other-synthetic-operator' }); const other = h.session(); await other.observeReceipt();
    assert.equal(other.getSnapshot().receipt, undefined); await other.reconcile(); assert.equal(other.getSnapshot().receipt, undefined);
    assert.equal(h.store.read()?.rows[0].outcome, 'unknown'); other.dispose();
});
test('two controllers sharing the document receipt cannot overlap batches', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const ports = { ...h.ports, addPatient: async (input: PatientBulkCreate, guard: PatientBulkWriteGuard) => {
        const id = await h.ports.addPatient(input, guard); entered.resolve(); await gate.promise; return id;
    } };
    const first = new PatientBulkImportSession(ports, h.store); const second = new PatientBulkImportSession(ports, h.store);
    await first.prepare(file(csv([1]))); await second.prepare(file(csv([2])));
    const run = confirmed(first); await entered.promise; await confirmed(second); assert.equal(h.writes.length, 1);
    gate.resolve(); await run; assert.equal(h.writes.length, 1); first.dispose(); second.dispose();
});

test('a failed rendering observer cannot turn a completed write into a retry or leave the batch active', async () => {
    const h = harness(); const session = h.session(); await session.prepare(file(csv([1])));
    const detach = session.subscribe(snapshot => { if (snapshot.phase === 'applying') throw new Error('Synthetic render observer'); });
    await confirmed(session);
    assert.deepEqual(outcomes(h), ['confirmed']); assert.equal(h.writes.length, 1); assert.equal(h.store.read()?.active, false);
    detach(); session.dispose();
});
test('a stale reconciliation context response cannot overwrite a later manual cancellation', async () => {
    const h = harness(); const original = new PatientBulkImportSession({ ...h.ports, addPatient: async () => { throw new Error('Synthetic rejection'); } }, h.store);
    await original.prepare(file(csv([1]))); await confirmed(original); original.dispose();
    const gate = deferred<PatientBulkContext>();
    const session = new PatientBulkImportSession({ ...h.ports, captureContext: () => gate.promise }, h.store);
    const run = session.reconcile(); session.cancel(); gate.resolve(h.context()); await run;
    assert.equal(session.getSnapshot().phase, 'cancelled'); assert.deepEqual(outcomes(h), ['unknown']);
    assert.equal(h.writes.length, 0); session.dispose();
});
test('a stale in-flight context is removed from the UI even without a browser context-change event', async () => {
    const h = harness(); const entered = deferred(); const gate = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (input, guard) => {
        const id = await h.ports.addPatient(input, guard); entered.resolve(); await gate.promise; return id;
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    h.change({ cookie: 'clinic-B', ambulatoryId: 'clinic-B' }); gate.resolve(); await run;
    assert.equal(session.getSnapshot().preview, undefined); assert.equal(session.getSnapshot().phase, 'invalidated');
    assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']); assert.equal(h.writes.length, 1); session.dispose();
});

// New replacement tests; these ports are still UI/controller doubles, never owner proof.
test('preview names the server destination and captures once, never silently renewing on confirm or each row', async () => {
    const h = harness(); const session = h.session();
    await session.observeReceipt(); assert.equal(h.captures(), 0);
    await session.prepare(file()); assert.equal(h.captures(), 1);
    assert.equal(session.getSnapshot().ambulatoryName, 'Destinazione sintetica A dal server');
    await confirmed(session); assert.equal(h.captures(), 1);
    assert.equal(h.guards.length, 3);
    assert(h.guards.every(guard => guard.precondition === h.guards[0].precondition));
    assert.equal(h.guards[0].precondition.ambulatoryId, 'clinic-A');
    assert.equal(JSON.stringify(h.store.read()).includes('nonce'), false);
    session.dispose();
});
test('expired consent denies without acquiring a new nonce or sending; only new file selection renews', async () => {
    const h = harness(); const session = h.session(); await session.prepare(file());
    const revision = session.getSnapshot().previewRevision; h.advance(300_000);
    await session.confirm(revision, true);
    assert.equal(h.writes.length, 0); assert.equal(h.captures(), 1);
    assert.equal(session.getSnapshot().phase, 'invalidated');
    await session.prepare(file()); assert.equal(h.captures(), 2);
    await session.confirm(revision, true); assert.equal(h.writes.length, 0);
    await confirmed(session); assert.equal(h.writes.length, 3); session.dispose();
});
test('missing, malformed, expired or different-target capture cannot produce a confirmable preview', async () => {
    const h = harness(); const valid = await h.ports.captureCreateContext(h.context());
    for (const result of [undefined, { ...valid, nonce: '' }, { ...valid, ambulatoryId: 'clinic-B' },
        { ...valid, expiresAt: 0 }, { ...valid, version: 2 }]) {
        const session = new PatientBulkImportSession({ ...h.ports,
            captureCreateContext: async () => result as typeof valid }, h.store);
        await session.prepare(file()); await confirmed(session);
        assert.equal(h.writes.length, 0); assert.equal(session.getSnapshot().preview, undefined); session.dispose();
    }
});
test('a context switch while preview capture resolves retires the continuation', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred();
    const session = new PatientBulkImportSession({ ...h.ports, captureCreateContext: async context => {
        const preview = await h.ports.captureCreateContext(context); entered.resolve(); await gate.promise; return preview;
    } }, h.store);
    const preparing = session.prepare(file()); await entered.promise;
    h.change({ cookie: 'clinic-B' }); gate.resolve(); await preparing;
    assert.equal(session.getSnapshot().preview, undefined); assert.equal(h.writes.length, 0); session.dispose();
});
test('client continuation guard retires during asynchronous encryption or navigation, never resumes a disposed controller', async () => {
    const h = harness(); const gate = deferred(); const entered = deferred(); let dispatched = 0;
    const session = new PatientBulkImportSession({ ...h.ports, addPatient: async (_input, guard) => {
        entered.resolve(); await gate.promise;
        if (!guard.isCurrent()) throw new Error('Synthetic pre-dispatch retirement');
        dispatched += 1; return 'not-used';
    } }, h.store);
    await session.prepare(file()); const run = confirmed(session); await entered.promise;
    session.dispose(); gate.resolve(); await run;
    assert.equal(dispatched, 0); assert.deepEqual(outcomes(h), ['unknown', 'not-sent', 'not-sent']);
});
test('constructor is pure; subscription/cleanup/remount detach receipt observers without automatic writes', async () => {
    const h = harness(); let active = 0;
    const original = h.store.subscribe.bind(h.store);
    h.store.subscribe = listener => { active += 1; const detach = original(listener);
        let attached = true; return () => { if (attached) { attached = false; active -= 1; detach(); } }; };
    const abandoned = h.session(); assert.equal(active, 0); abandoned.dispose();
    for (let cycle = 0; cycle < 3; cycle += 1) {
        const session = h.session(); let notifications = 0;
        const detach = session.subscribe(() => { notifications += 1; });
        assert.equal(active, 1); await session.observeReceipt();
        const stable = session.getSnapshot(); assert.equal(session.getSnapshot(), stable);
        detach(); session.dispose(); session.dispose(); assert.equal(active, 0);
        const before = notifications; await session.prepare(file()); assert.equal(notifications, before);
    }
    assert.equal(h.captures(), 0); assert.equal(h.writes.length, 0);
});
test('an observer throwing at subscription cannot leak the receipt subscription or initiate writes', () => {
    const h = harness(); let active = 0; const original = h.store.subscribe.bind(h.store);
    h.store.subscribe = listener => { active += 1; const detach = original(listener); return () => { active -= 1; detach(); }; };
    const session = h.session(); const detach = session.subscribe(() => { throw new Error('Synthetic initial observer'); });
    assert.equal(active, 1); detach(); assert.equal(active, 0); session.dispose(); assert.equal(active, 0); assert.equal(h.writes.length, 0);
});
