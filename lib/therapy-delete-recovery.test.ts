import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTherapyDeleteRecovery, type DeleteRecovery } from './therapy-delete-recovery.ts';
import { LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER, LOCKED_CIPHERTEXT_KEY } from './locked-field-guard';

const therapy = { id: 'synthetic-therapy', patientId: 'synthetic-patient', version: 2, drugName: 'Farmaco sintetico', dosage: 'Dose sintetica' };
const reason = 'Duplicato sintetico';
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
function fixture() {
    const session = new AbortController();
    const writes: { id: string; version: number; deletionReason: string }[] = [];
    const states: (DeleteRecovery<typeof therapy> | null)[] = [];
    let active = true;
    let successes = 0;
    let parentSignal: AbortSignal | undefined;
    const facade = {
        remove: async (): Promise<void> => { throw new Error('conflict'); },
        parent: async (): Promise<{ id: string } | undefined> => ({ id: therapy.patientId }),
        list: async () => [{ ...therapy, version: 7, dosage: 'Dose aggiornata' }],
    };
    const controller = createTherapyDeleteRecovery({
        patientId: therapy.patientId, isCurrent: () => active,
        signal: () => session.signal,
        readParent: (_id, signal) => { parentSignal = signal; return facade.parent(); },
        readTherapies: () => facade.list(),
        remove: (id, options) => { writes.push({ id, version: options.version, deletionReason: options.deletionReason }); return facade.remove(); },
        isConflict: (error) => error instanceof Error && error.message === 'conflict',
        changed: (state) => states.push(state), succeeded: () => { successes++; },
    });
    return { controller, facade, session, writes, states, leave: () => { active = false; },
        successes: () => successes, parentSignal: () => parentSignal,
        begin: () => controller.begin(therapy, async () => ({ confirmed: true, reason })),
    };
}

test('one rejected initial write preserves identity, snapshot, version and reason; no automatic retry', async () => {
    const f = fixture();
    await f.begin();
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.controller.snapshot?.original, therapy);
    assert.equal(f.controller.snapshot?.reason, reason);
    assert.equal(f.controller.snapshot?.phase, 'conflict');
    await f.begin();
    await f.controller.retry(async () => ({ confirmed: true }));
    assert.equal(f.writes.length, 1);
});

test('uncertain response is distinct from conflict, without claiming success', async () => {
    const f = fixture();
    f.facade.remove = async () => { throw new Error('response lost'); };
    await f.begin();
    assert.equal(f.controller.snapshot?.phase, 'uncertain');
    assert.equal(f.controller.snapshot?.reason, reason);
    assert.equal(f.successes(), 0);
});

test('read failure prevents retry and retains reason', async () => {
    const f = fixture();
    await f.begin();
    f.facade.list = async () => { throw new Error('read failed'); };
    await f.controller.reread();
    await f.controller.retry(async () => { assert.fail('must not prompt'); });
    assert.equal(f.controller.snapshot?.phase, 'unavailable');
    assert.equal(f.controller.snapshot?.reason, reason);
    assert.equal(f.writes.length, 1);
});

test('valid authenticated reread never writes; explicit consent uses reread version and preserved reason', async () => {
    const f = fixture();
    await f.begin();
    await f.controller.reread();
    assert.equal(f.parentSignal(), f.session.signal);
    assert.equal(f.controller.snapshot?.phase, 'ready');
    assert.equal(f.writes.length, 1);
    await f.controller.retry(async () => ({ confirmed: false }));
    assert.equal(f.writes.length, 1);
    f.facade.remove = async () => {};
    await f.controller.retry(async () => ({ confirmed: true }));
    assert.deepEqual(f.writes[1], { id: therapy.id, version: 7, deletionReason: reason });
    assert.equal(f.controller.snapshot, null);
    assert.equal(f.successes(), 1);
});

for (const invalid of ['wrong patient', 'missing parent', 'wrong parent', 'invalid version', 'deleted therapy', 'absent therapy']) {
    test(`${invalid} cannot authorize another deletion or prove success`, async () => {
        const f = fixture();
        await f.begin();
        if (invalid === 'wrong patient') f.facade.list = async () => [{ ...therapy, patientId: 'other-patient' }];
        if (invalid === 'missing parent') f.facade.parent = async () => undefined;
        if (invalid === 'wrong parent') f.facade.parent = async () => ({ id: 'other-patient' });
        if (invalid === 'invalid version') f.facade.list = async () => [{ ...therapy, version: NaN }];
        if (invalid === 'deleted therapy') f.facade.list = async () => [Object.assign({ ...therapy }, { deletedAt: new Date() })];
        if (invalid === 'absent therapy') f.facade.list = async () => [];
        await f.controller.reread();
        await f.controller.retry(async () => { assert.fail('must not prompt'); });
        assert.equal(f.controller.snapshot?.phase, invalid === 'absent therapy' ? 'absent' : 'unavailable');
        assert.equal(f.writes.length, 1);
        assert.equal(f.successes(), 0);
    });
}

for (const boundary of ['patient change', 'unmount', 'session abort']) {
    test(`${boundary} while initial confirmation is open prevents the first write`, async () => {
        const f = fixture();
        const prompt = deferred<{ confirmed: boolean; reason: string }>();
        const first = f.controller.begin(therapy, () => prompt.promise);
        await f.controller.begin(therapy, async () => { assert.fail('duplicate prompt'); });
        if (boundary === 'patient change') f.leave();
        if (boundary === 'unmount') f.controller.dispose();
        if (boundary === 'session abort') f.session.abort();
        prompt.resolve({ confirmed: true, reason });
        await first;
        assert.equal(f.writes.length, 0);
    });
    test(`${boundary} during reread cannot authorize retry or publish a stale result`, async () => {
        const f = fixture();
        await f.begin();
        const list = deferred<typeof therapy[]>();
        f.facade.list = () => list.promise;
        const read = f.controller.reread();
        if (boundary === 'patient change') f.leave();
        if (boundary === 'unmount') f.controller.dispose();
        if (boundary === 'session abort') f.session.abort();
        const published = f.states.length;
        list.resolve([{ ...therapy, version: 7 }]);
        await read;
        await f.controller.retry(async () => { assert.fail('must not prompt'); });
        assert.equal(f.writes.length, 1);
        if (boundary !== 'session abort') assert.equal(f.states.length, published);
        else assert.equal(f.controller.snapshot?.phase, 'unavailable');
    });
    test(`${boundary} during retry confirmation prevents a second write`, async () => {
        const f = fixture();
        await f.begin();
        await f.controller.reread();
        const prompt = deferred<{ confirmed: boolean }>();
        const retry = f.controller.retry(() => prompt.promise);
        await f.controller.retry(async () => { assert.fail('duplicate retry prompt'); });
        if (boundary === 'patient change') f.leave();
        if (boundary === 'unmount') f.controller.dispose();
        if (boundary === 'session abort') f.session.abort();
        prompt.resolve({ confirmed: true });
        await retry;
        assert.equal(f.writes.length, 1);
    });
}

test('abort after a valid read invalidates its authorization', async () => {
    const f = fixture();
    await f.begin();
    await f.controller.reread();
    f.session.abort();
    await f.controller.retry(async () => { assert.fail('must not prompt'); });
    assert.equal(f.writes.length, 1);
    assert.equal(f.controller.snapshot?.phase, 'unavailable');
});

test('synchronous locks protect in-flight writes and rereads; cancellation only discards local recovery', async () => {
    const f = fixture();
    const write = deferred<void>();
    f.facade.remove = () => write.promise;
    const first = f.begin();
    await Promise.resolve();
    await f.begin();
    f.controller.cancel();
    await f.controller.reread();
    assert.equal(f.writes.length, 1);
    assert.equal(f.controller.snapshot?.phase, 'writing');
    write.reject(new Error('conflict'));
    await first;
    const list = deferred<typeof therapy[]>();
    let reads = 0;
    f.facade.list = () => { reads++; return list.promise; };
    const read = f.controller.reread();
    await f.controller.reread();
    assert.equal(reads, 1);
    list.resolve([{ ...therapy, version: 7 }]);
    await read;
    const retryWrite = deferred<void>();
    f.facade.remove = () => retryWrite.promise;
    const retry = f.controller.retry(async () => ({ confirmed: true }));
    await Promise.resolve();
    await f.controller.retry(async () => { assert.fail('inflight duplicate'); });
    f.controller.cancel();
    assert.equal(f.writes.length, 2);
    retryWrite.reject(new Error('response lost'));
    await retry;
    f.controller.cancel();
    assert.equal(f.controller.snapshot, null);
    assert.equal(f.successes(), 0);
    assert.equal(f.writes.length, 2);
});

test('late write completion after disposal cannot publish success or affect a new controller', async () => {
    const f = fixture();
    const write = deferred<void>();
    f.facade.remove = () => write.promise;
    const run = f.begin();
    await Promise.resolve();
    f.controller.dispose();
    f.controller.activate();
    const count = f.states.length;
    write.resolve();
    await run;
    assert.equal(f.states.length, count);
    assert.equal(f.successes(), 0);
    assert.equal(f.controller.snapshot, null);
});

test('wrong-patient initial request and invalid initial versions do not open confirmation', async () => {
    const f = fixture();
    const confirm = async () => { assert.fail('must not prompt'); };
    await f.controller.begin({ ...therapy, patientId: 'other-patient' }, confirm);
    await f.controller.begin({ ...therapy, version: 0 }, confirm);
    assert.equal(f.writes.length, 0);
});

test('confirmed initial success clears local recovery and notifies exactly once', async () => {
    const f = fixture();
    f.facade.remove = async () => {};
    await f.begin();
    assert.equal(f.writes.length, 1);
    assert.equal(f.successes(), 1);
    assert.equal(f.controller.snapshot, null);
});

test('write response after session abort remains uncertain and retains the reason', async () => {
    const f = fixture();
    const write = deferred<void>();
    f.facade.remove = () => write.promise;
    const run = f.begin();
    await Promise.resolve();
    f.session.abort();
    write.resolve();
    await run;
    assert.equal(f.controller.snapshot?.phase, 'uncertain');
    assert.equal(f.controller.snapshot?.reason, reason);
    assert.equal(f.successes(), 0);
});

for (const unreadable of [LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER, 'ENC:malformed']) {
    test(`unreadable comparison data cannot authorize retry: ${unreadable}`, async () => {
        const f = fixture();
        await f.begin();
        f.facade.list = async () => [Object.assign({ ...therapy, version: 7 }, { motivation: unreadable })];
        await f.controller.reread();
        assert.equal(f.controller.snapshot?.phase, 'unavailable');
        await f.controller.retry(async () => { assert.fail('must not prompt'); });
        assert.equal(f.writes.length, 1);
        assert.equal(f.controller.snapshot?.reason, reason);
    });
}

test('preserved ciphertext also prevents review authorization', async () => {
    const f = fixture();
    await f.begin();
    f.facade.list = async () => [Object.assign({ ...therapy, version: 7 }, { [LOCKED_CIPHERTEXT_KEY]: { motivation: 'ENC:synthetic' } })];
    await f.controller.reread();
    assert.equal(f.controller.snapshot?.phase, 'unavailable');
    assert.equal(f.writes.length, 1);
});

for (const rejected of [true, false]) {
    test(`discarding the reason cannot bypass reread; rejected=${rejected}`, async () => {
        const f = fixture();
        if (!rejected) f.facade.remove = async () => { throw new Error('uncertain'); };
        await f.begin();
        f.controller.cancel();
        assert.equal(f.controller.snapshot, null);
        await f.controller.begin(therapy, async () => { assert.fail('must reread first'); });
        assert.equal(f.writes.length, 1);
        assert.equal(f.controller.snapshot?.reason, '');
        assert.equal(f.controller.snapshot?.phase, 'uncertain');
        await f.controller.retry(async () => { assert.fail('must not prompt'); });
        await f.controller.reread();
        assert.equal(f.writes.length, 1);
        await f.controller.retry(async () => ({ confirmed: true }));
        assert.equal(f.writes.length, 1);
        f.facade.remove = async () => {};
        await f.controller.retry(async () => ({ confirmed: true, reason: 'Nuova motivazione sintetica' }));
        assert.deepEqual(f.writes[1], { id: therapy.id, version: 7, deletionReason: 'Nuova motivazione sintetica' });
        assert.equal(f.successes(), 1);
    });
}
