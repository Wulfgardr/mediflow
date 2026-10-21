import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTherapyStatusConfirmation, type StatusTherapy } from './therapy-status-confirmation';

const original: StatusTherapy = { id: 'therapy', patientId: 'patient', version: 1, drugName: 'Sintetico', dosage: '1 cp', status: 'active' };
function harness(options: { write?: () => Promise<unknown>; timeoutMs?: number } = {}) {
    let items = [{ ...original }];
    const writes: Array<{ item: StatusTherapy; target: string }> = [];
    let reads = 0;
    let readable = true;
    const session = new AbortController();
    const controller = createTherapyStatusConfirmation({
        patientId: 'patient', isCurrent: () => true, signal: () => session.signal,
        read: async () => { reads++; if (!readable) throw new Error('Unreadable'); return items; },
        write: async (item, target) => {
            writes.push({ item, target });
            if (options.write) return options.write();
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

test('timeout blocks cancellation and another therapy until verified; applied state becomes registered', async () => {
    const h = harness({ write: () => new Promise(() => {}), timeoutMs: 1 });
    h.controller.begin(original, 'suspended', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.controller.snapshot?.phase, 'uncertain');
    h.controller.cancel();
    h.controller.begin({ ...original, id: 'other' }, 'completed', 'Sintetico');
    await h.controller.confirm();
    assert.equal(h.writes.length, 1);
    assert.equal(h.controller.snapshot?.original.id, 'therapy');
    h.setItems([{ ...original, status: 'suspended', version: 2 }]);
    await h.controller.reread();
    assert.equal(h.controller.snapshot?.phase, 'registered');
});

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
    h.controller.dispose();
    h.controller.activate();
    h.controller.begin({ ...original, id: 'other' }, 'completed', 'Sintetico');
    resolve();
    await pending;
    assert.equal(h.controller.snapshot?.original.id, 'other');
    assert.equal(h.controller.snapshot?.phase, 'confirm');
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
