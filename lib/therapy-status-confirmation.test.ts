import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTherapyStatusConfirmation, createTherapyStatusWriteJournal, type StatusWriteJournal, type StatusTherapy } from './therapy-status-confirmation';

const original: StatusTherapy = { id: 'therapy', patientId: 'patient', version: 1, drugName: 'Sintetico', dosage: '1 cp', status: 'active' };
function journal() {
    const values = new Map<string, string>();
    return createTherapyStatusWriteJournal({ archive: () => 'synthetic-archive', locks: () => navigator.locks, storage: () => ({ getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }) });
}
function harness(options: { write?: (signal: AbortSignal) => Promise<unknown>; timeoutMs?: number; journal?: StatusWriteJournal } = {}) {
    let items = [{ ...original }];
    const writes: Array<{ item: StatusTherapy; target: string }> = [];
    let reads = 0;
    let readable = true;
    const session = new AbortController();
    const controller = createTherapyStatusConfirmation({
        journal: options.journal ?? journal(), isRejected: error => error === 'rejected',
        patientId: 'patient', isCurrent: () => true, signal: () => session.signal,
        read: async () => { reads++; if (!readable) throw new Error('Unreadable'); return items; },
        write: async (item, target, signal) => {
            writes.push({ item, target });
            if (options.write) return options.write(signal);
            items = [{ ...item, status: target, version: item.version! + 1 }];
        },
        isConflict: error => error === 'conflict', changed: () => {}, refreshed: () => {}, timeoutMs: options.timeoutMs,
    });
    return { controller, writes, session, get reads() { return reads; }, setItems: (value: StatusTherapy[]) => { items = value; }, failRead: () => { readable = false; } };
}

test('first gesture and cancel write nothing; a confirmation uses the captured patient and version once', async () => {
    const h = harness();
    h.controller.begin(original, 'suspended', 'Sintetico, 54 anni');
    h.controller.cancel();
    await h.controller.confirm();
    assert.equal(h.writes.length, 0);
    const shown = { ...original };
    h.controller.begin(shown, 'suspended', 'Sintetico, 54 anni');
    shown.version = 99;
    await Promise.all([h.controller.confirm(), h.controller.confirm()]);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].item.version, 1);
    assert.equal(h.writes[0].item.patientId, 'patient');
    assert.equal(h.reads, 1);
    assert.equal(h.controller.snapshot?.phase, 'registered');
});

test('conflict reread cannot register or resend even when the concurrent state matches', async () => {
    const h = harness({ write: async () => { throw 'conflict'; } });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    h.setItems([{ ...original, status: 'suspended', version: 2 }]);
    await h.controller.confirm();
    assert.equal(h.reads, 0);
    assert.equal(h.controller.snapshot?.phase, 'conflict');
    await h.controller.reread();
    await h.controller.confirm();
    assert.equal(h.controller.snapshot?.phase, 'reviewed');
    assert.equal(h.writes.length, 1);
});

test('timeout aborts the write signal', async () => {
    let signal!: AbortSignal;
    const h = harness({ write: value => { signal = value; return new Promise(() => {}); }, timeoutMs: 1 });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    assert.equal(signal.aborted, true);
    assert.equal(h.controller.snapshot?.phase, 'uncertain');
});

for (const outcome of ['resolved', 'rejected', 'aborted'] as const) {
    test(`timeout blocks readback and another action until the write is ${outcome}`, async () => {
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const h = harness({ write: () => new Promise<void>((done, fail) => { resolve = done; reject = fail; }), timeoutMs: 1 });
        h.controller.begin(original, 'suspended', 'Sintetico');
        await h.controller.confirm();
        assert.equal(h.controller.snapshot?.phase, 'uncertain');
        assert.equal(h.controller.snapshot?.writePending, true);
        await h.controller.reread();
        assert.equal(h.reads, 0);
        h.controller.cancel();
        h.controller.begin({ ...original, id: 'other' }, 'completed', 'Sintetico');
        await h.controller.confirm();
        assert.equal(h.controller.blocked, true);
        assert.equal(h.writes.length, 1);
        assert.equal(h.controller.snapshot?.original?.id, 'therapy');
        if (outcome === 'resolved') {
            h.setItems([{ ...original, status: 'suspended', version: 2 }]);
            resolve();
        } else reject(outcome === 'aborted' ? new DOMException('Aborted', 'AbortError') : 'conflict');
        await new Promise<void>(done => setImmediate(done));
        assert.equal(h.controller.snapshot?.writePending, false);
        assert.equal(h.controller.snapshot?.phase, 'uncertain');
        assert.equal(h.controller.blocked, true);
        assert.equal(h.reads, 0);
        await h.controller.reread();
        assert.equal(h.reads, 1);
        assert.equal(h.controller.snapshot?.phase, outcome === 'resolved' ? 'registered' : outcome === 'rejected' ? 'reviewed' : 'uncertain');
        assert.equal(h.writes.length, 1);
    });
}

test('failed read, changed dose and unchanged version never claim registered', async () => {
    for (const kind of ['failed', 'dose', 'version', 'patient'] as const) {
        const h = harness({ write: async () => {} });
        if (kind === 'failed') h.failRead();
        h.setItems([{ ...original, status: 'suspended', version: kind === 'version' ? 1 : 2,
            dosage: kind === 'dose' ? '2 cp' : original.dosage, patientId: kind === 'patient' ? 'other' : original.patientId }]);
        h.controller.begin(original, 'suspended', 'Sintetico');
        await h.controller.confirm();
        assert.notEqual(h.controller.snapshot?.phase, 'registered');
        assert.equal(h.writes.length, 1);
    }
});

test('a different therapy replaces the prompt; retired context and expired session cannot reuse confirmation', async () => {
    const h = harness();
    h.controller.begin(original, 'suspended', 'Sintetico');
    h.controller.begin({ ...original, id: 'other' }, 'completed', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.writes[0].item.id, 'other');
    const retired = harness();
    retired.controller.begin(original, 'suspended', 'Sintetico');
    retired.controller.dispose();
    retired.controller.activate();
    await retired.controller.confirm();
    assert.equal(retired.writes.length, 0);
    retired.controller.begin(original, 'suspended', 'Sintetico');
    retired.session.abort();
    await retired.controller.confirm();
    assert.equal(retired.writes.length, 0);
});

test('late completion from a disposed owner cannot publish into a fresh context', async () => {
    let resolve!: () => void;
    const h = harness({ write: () => new Promise<void>(done => { resolve = done; }) });
    h.controller.begin(original, 'suspended', 'Sintetico');
    const pending = h.controller.confirm();
    await new Promise<void>(done => setImmediate(done));
    h.controller.dispose();
    h.controller.activate();
    h.controller.begin({ ...original, id: 'other' }, 'completed', 'Sintetico');
    resolve();
    await pending;
    assert.equal(h.controller.snapshot, null);
    assert.equal(h.controller.blocked, true);
    assert.equal(h.writes.length, 1);
    assert.equal(h.reads, 0);
});

test('another patient or an invalid version cannot open an actionable confirmation', async () => {
    for (const item of [{ ...original, patientId: 'other-patient' }, { ...original, version: undefined }, { ...original, version: 0 }]) {
        const h = harness();
        h.controller.begin(item, 'suspended', 'Sintetico');
        await h.controller.confirm();
        assert.equal(h.controller.snapshot, null);
        assert.equal(h.writes.length, 0);
    }
});


test('client abort before server commit keeps same-version readback unresolved', async () => {
    const h = harness({ write: signal => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }), timeoutMs: 1 });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    await new Promise<void>(done => setImmediate(done));
    await h.controller.reread();
    assert.equal(h.controller.snapshot?.phase, 'uncertain');
    h.controller.cancel();
    h.controller.begin(original, 'completed', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.writes.length, 1);
    h.setItems([{ ...original, status: 'suspended', version: 2 }]);
    await h.controller.reread();
    assert.equal(h.controller.snapshot?.phase, 'reviewed');
});


for (const outcome of ['unknown', 'accepted', 'rejected'] as const) {
    test(`remount and separate owners retain the ${outcome} command until authoritative readback`, async () => {
        const shared = journal();
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const h = harness({ journal: shared, write: () => new Promise<void>((yes, no) => { resolve = yes; reject = no; }), timeoutMs: 1 });
        h.controller.begin(original, 'suspended', 'Sintetico');
        await h.controller.confirm();
        h.controller.dispose();
        const fresh = harness({ journal: shared });
        fresh.controller.begin(original, 'completed', 'Sintetico');
        await fresh.controller.confirm();
        assert.equal(fresh.writes.length, 0);
        assert.equal(fresh.controller.blocked, true);
        if (outcome === 'accepted') resolve();
        else reject(outcome === 'rejected' ? 'rejected' : new TypeError('Network failed'));
        await new Promise<void>(done => setImmediate(done));
        fresh.controller.recover([original], 'Sintetico');
        await fresh.controller.reread();
        assert.equal(fresh.controller.snapshot?.phase, outcome === 'rejected' ? 'reviewed' : 'uncertain');
        if (outcome !== 'rejected') {
            assert.equal(fresh.controller.blocked, true);
            fresh.setItems([{ ...original, version: 2, status: 'completed' }]);
            await fresh.controller.reread();
            assert.equal(fresh.controller.snapshot?.phase, 'reviewed');
        }
        fresh.controller.cancel();
        fresh.controller.begin({ ...original, version: 2 }, 'completed', 'Sintetico');
        await fresh.controller.confirm();
        assert.equal(fresh.writes.length, 1);
    });
}

test('an unavailable journal never dispatches a write', async () => {
    const h = harness({ journal: createTherapyStatusWriteJournal({ archive: () => 'synthetic-archive', locks: () => navigator.locks, storage: () => { throw new Error('Storage unavailable'); } }) });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.writes.length, 0);
    assert.equal(h.controller.blocked, true);
});

test('an authoritative rejection allows a fresh intent only after readback', async () => {
    const h = harness({ write: async () => { throw 'rejected'; } });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.controller.blocked, true);
    assert.equal(h.controller.snapshot?.phase, 'rejected');
    await h.controller.reread();
    assert.equal(h.controller.snapshot?.phase, 'reviewed');
    assert.equal(h.controller.blocked, false);
    assert.equal(h.writes.length, 1);
});

test('competing owners cannot overwrite an unresolved write or dispatch a second PUT', async () => {
    const shared = journal();
    const a = harness({ journal: shared, write: async () => { throw new TypeError('Network failed'); } });
    const b = harness({ journal: shared });
    a.controller.begin(original, 'suspended', 'Sintetico');
    b.controller.begin({ ...original, id: 'second' }, 'completed', 'Sintetico');
    await Promise.all([a.controller.confirm(), b.controller.confirm()]);
    assert.equal(a.writes.length + b.writes.length, 1);
    assert.equal(shared.get('patient')?.therapyId, 'therapy');
    assert.equal(a.controller.blocked, true);
    assert.equal(b.controller.blocked, true);
});

test('session expiry while waiting for admission dispatches nothing', async () => {
    const shared = journal();
    const h = harness({ journal: shared });
    h.controller.begin(original, 'suspended', 'Sintetico');
    const pending = h.controller.confirm();
    h.session.abort();
    await pending;
    assert.equal(h.writes.length, 0);
    assert.equal(shared.get('patient'), null);
});

test('archive namespaces, stale owners and marker minimization', async () => {
    const values = new Map<string, string>();
    let generation = 'archive-a';
    const environment = { archive: () => generation, locks: () => navigator.locks,
        storage: () => ({ getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }) };
    const a = createTherapyStatusWriteJournal(environment);
    const command = { id: 'old', therapyId: 'therapy', patientId: 'patient', version: 1, outcome: 'unknown' as const };
    assert.equal(await a.claim({ ...command, ...{ drugName: 'Private', dosage: 'Dose', target: 'suspended' } }), true);
    assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])).sort(), ['id', 'outcome', 'patientId', 'therapyId', 'version']);
    generation = 'archive-b';
    const b = createTherapyStatusWriteJournal(environment);
    assert.equal(b.get('patient'), null);
    assert.equal(await b.claim({ ...command, id: 'new' }), true);
    await assert.rejects(a.remove(command), /Archive unavailable/);
    await assert.rejects(a.settle({ ...command, outcome: 'accepted' }), /Archive unavailable/);
    assert.equal(b.get('patient')?.id, 'new');
    generation = 'archive-a';
    assert.equal(a.get('patient')?.id, 'old');
    await a.remove(command);
    await a.claim({ ...command, id: 'replacement' });
    await a.settle({ ...command, outcome: 'accepted' });
    await a.remove(command);
    assert.equal(a.get('patient')?.id, 'replacement');
    assert.equal(a.get('patient')?.outcome, 'unknown');
});

test('corrupt storage or missing Web Locks cannot admit a write', async () => {
    for (const broken of ['storage', 'locks']) {
        const h = harness({ journal: createTherapyStatusWriteJournal({ archive: () => 'synthetic-archive',
            storage: () => ({ getItem: () => broken === 'storage' ? '{' : null, setItem: () => {}, removeItem: () => {} }),
            locks: () => { throw new Error('Web Locks unavailable'); } }) });
        h.controller.begin(original, 'suspended', 'Sintetico');
        await h.controller.confirm();
        assert.equal(h.writes.length, 0);
        assert.equal(h.controller.blocked, true);
    }
});


const phase = (h: ReturnType<typeof harness>) => h.controller.snapshot?.phase;

function admissionFixture() {
    const values = new Map<string, string>();
    let locksAvailable = true;
    let readable = true;
    let writable = true;
    let failAfterLock = false;
    let archive = 'synthetic-archive';
    const shared = createTherapyStatusWriteJournal({
        archive: () => archive,
        storage: () => ({
            getItem: key => { if (!readable) throw new Error('Storage unavailable'); return values.get(key) ?? null; },
            setItem: (key, value) => { if (!writable) throw new Error('Storage full'); values.set(key, value); },
            removeItem: key => { values.delete(key); },
        }),
        locks: () => {
            if (!locksAvailable) throw new Error('Locks unavailable');
            return { request: async (...args: Parameters<LockManager['request']>) => {
                const result = await navigator.locks.request(...args);
                if (failAfterLock) throw new Error('Lock completion failed');
                return result;
            } } as Pick<LockManager, 'request'>;
        },
    });
    return { shared, values, locks: (value: boolean) => { locksAvailable = value; }, read: (value: boolean) => { readable = value; },
        write: (value: boolean) => { writable = value; }, afterLock: (value: boolean) => { failAfterLock = value; },
        archive: (value: string) => { archive = value; } };
}
const priorCommand = { id: 'prior', therapyId: original.id, patientId: original.patientId, version: 1, outcome: 'unknown' as const };

for (const failure of ['locks', 'write', 'afterLock'] as const) {
    test(`P2 admission failure (${failure}) is unsent and explicit recovery never retries`, async () => {
        const f = admissionFixture();
        const h = harness({ journal: f.shared });
        h.controller.begin(original, 'suspended', 'Sintetico');
        if (failure === 'locks') f.locks(false);
        if (failure === 'write') f.write(false);
        if (failure === 'afterLock') f.afterLock(true);
        await h.controller.confirm();
        assert.equal(phase(h), 'unavailable');
        assert.equal(h.writes.length, 0);
        assert.equal(h.controller.blocked, true);
        if (failure !== 'write') {
            await h.controller.recheck();
            assert.equal(phase(h), 'unavailable');
            assert.equal(h.controller.snapshot?.phase === 'unavailable' && h.controller.snapshot.reason, 'admission');
            assert.equal(h.writes.length, 0);
        }
        f.locks(true); f.write(true); f.afterLock(false);
        await Promise.all([h.controller.recheck(), h.controller.recheck()]);
        assert.equal(Boolean(h.controller.snapshot), false);
        assert.equal(f.shared.get('patient'), null);
        assert.equal(h.controller.blocked, false);
        await h.controller.confirm();
        assert.equal(h.writes.length, 0);
        h.controller.begin(original, 'completed', 'Sintetico');
        assert.equal(phase(h), 'confirm');
        assert.equal(h.writes.length, 0);
        await h.controller.confirm();
        assert.equal(h.writes.length, 1);
    });
}

for (const failure of ['corrupt', 'unreadable'] as const) {
    test(`P2 ${failure} storage shows a recoverable block and preserves the previous unknown write`, async () => {
        const f = admissionFixture();
        await f.shared.claim(priorCommand);
        const [key, value] = [...f.values][0];
        if (failure === 'corrupt') f.values.set(key, '{');
        else f.read(false);
        const h = harness({ journal: f.shared });
        h.controller.recover([original], 'Sintetico');
        assert.equal(phase(h), 'unavailable');
        assert.equal(h.controller.blocked, true);
        await h.controller.recheck();
        assert.equal(phase(h), 'unavailable');
        assert.equal(f.values.get(key), failure === 'corrupt' ? '{' : value);
        f.read(true); f.values.set(key, value);
        await h.controller.recheck();
        assert.equal(phase(h), 'uncertain');
        await h.controller.reread();
        assert.equal(phase(h), 'uncertain');
        assert.equal(f.shared.get('patient')?.id, 'prior');
        assert.equal(h.writes.length, 0);
    });
}

test('P2 a prior marker arriving after the prompt survives failed admission and recovery', async () => {
    const f = admissionFixture();
    const h = harness({ journal: f.shared });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await f.shared.claim(priorCommand);
    await h.controller.confirm();
    assert.equal(phase(h), 'unavailable');
    await h.controller.recheck();
    assert.equal(phase(h), 'uncertain');
    assert.equal(f.shared.get('patient')?.id, 'prior');
    await h.controller.reread();
    assert.equal(h.controller.blocked, true);
    assert.equal(h.writes.length, 0);
});

test('P2 cleanup of an unsent own marker cannot remove a replacement or cross archives', async () => {
    for (const change of ['replacement', 'archive'] as const) {
        const f = admissionFixture();
        const h = harness({ journal: f.shared });
        h.controller.begin(original, 'suspended', 'Sintetico');
        f.afterLock(true);
        await h.controller.confirm();
        assert.equal(phase(h), 'unavailable');
        f.afterLock(false);
        if (change === 'replacement') {
            const key = [...f.values.keys()][0];
            f.values.set(key, JSON.stringify(priorCommand));
        } else f.archive('other-archive');
        const before = [...f.values];
        await h.controller.recheck();
        assert.deepEqual([...f.values], before);
        assert.equal(phase(h), change === 'replacement' ? 'uncertain' : 'unavailable');
        assert.equal(h.controller.blocked, true);
        assert.equal(h.writes.length, 0);
    }
});

test('P2 an uninspectable therapy marker is visible and recovery waits for its therapy', async () => {
    const f = admissionFixture();
    await f.shared.claim({ ...priorCommand, therapyId: 'missing' });
    const h = harness({ journal: f.shared });
    h.controller.recover([original], 'Sintetico');
    assert.equal(phase(h), 'unavailable');
    await h.controller.recheck();
    assert.equal(phase(h), 'unavailable');
    h.setItems([{ ...original, id: 'missing' }]);
    await h.controller.recheck();
    assert.equal(phase(h), 'uncertain');
    assert.equal(h.writes.length, 0);
});
