/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessSoapEntryPresentationLifecycleOwner,
} from './headless-soap-entry-presentation-lifecycle.ts';
import {
    bindHeadlessSoapEntryPresentationGoldenSeal,
    createHeadlessSoapEntryPresentationGoldenFieldSet,
} from './headless-soap-entry-presentation-lifecycle-fixture.test.ts';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
type CallbackPhase = 'pre' | 'post' | null;

function opaque(): Readonly<Record<never, never>> {
    return Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
}

function fixture(count = 1) {
    const fieldSet = createHeadlessSoapEntryPresentationGoldenFieldSet();
    const records = Array.from({ length: count }, () => ({
        ref: opaque(), registration: opaque(), current: true, entryDispose: null as (() => void) | null,
        unregisterCalls: 0, wipeCalls: 0,
    }));
    const faults = {
        withEntry: null as CallbackPhase, withDependent: null as CallbackPhase,
        register: false, confirm: false, unregister: false, wipe: false,
    };
    const recordFor = (candidate: unknown) => records.find((record) => record.ref === candidate) ?? null;
    const failure = (source: string) => new Error(`synthetic ${source} failure`);
    const entryLifecycle = {
        async withCurrentEntry(candidate: unknown, operation: (value: typeof fieldSet) => void) {
            if (faults.withEntry === 'pre') throw failure('withCurrentEntry/pre');
            const record = recordFor(candidate); if (!record?.current) return false;
            operation(fieldSet);
            if (faults.withEntry === 'post') throw failure('withCurrentEntry/post');
            return record.current;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            if (faults.register) throw failure('registerDependent');
            const record = recordFor(candidate);
            if (!record?.current || record.entryDispose) return null;
            record.entryDispose = dispose; return record.registration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            if (faults.confirm) throw failure('confirmDependent');
            const record = recordFor(candidate);
            return !!record?.current && registration === record.registration && record.entryDispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            const record = recordFor(candidate); if (record) record.unregisterCalls += 1;
            if (faults.unregister) throw failure('unregisterDependent');
            if (!record?.current || registration !== record.registration || !record.entryDispose) return false;
            record.entryDispose = null; return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
            if (faults.withDependent === 'pre') throw failure('withCurrentDependent/pre');
            const record = recordFor(candidate);
            if (!record?.current || registration !== record.registration || !record.entryDispose) return false;
            operation();
            if (faults.withDependent === 'post') throw failure('withCurrentDependent/post');
            return record.current;
        },
    };
    const entryService = { wipe(candidate: unknown) {
        const record = recordFor(candidate); if (record) record.wipeCalls += 1;
        if (faults.wipe) throw failure('wipe');
        if (!record?.current) return false;
        record.current = false; const dispose = record.entryDispose; record.entryDispose = null; dispose?.(); return true;
    } };
    return {
        records, faults,
        sources: {
            entryLifecycle, entryService,
            entropy: () => Uint8Array.from({ length: 32 }, (_, index) => index),
        },
    };
}

async function assertStale(owner: ReturnType<typeof createHeadlessSoapEntryPresentationLifecycleOwner>) {
    let lateSuccess = 0;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(TOKEN, () => { lateSuccess += 1; }), false);
    assert.equal(owner.service.cancel(TOKEN), false);
    assert.equal(lateSuccess, 0);
}

test('contains withCurrentEntry throws before and after its callback without late publication', async () => {
    const pre = fixture(); const preOwner = createHeadlessSoapEntryPresentationLifecycleOwner(pre.sources);
    pre.faults.withEntry = 'pre'; await assert.rejects(preOwner.service.present(pre.records[0]!.ref));
    await assertStale(preOwner); pre.faults.withEntry = null;
    const retry = await preOwner.service.present(pre.records[0]!.ref); assert.equal(retry.correlationToken, TOKEN);
    assert.equal(preOwner.service.cancel(TOKEN), true);

    const post = fixture(2); const postOwner = createHeadlessSoapEntryPresentationLifecycleOwner(post.sources);
    post.faults.withEntry = 'post'; await assert.rejects(postOwner.service.present(post.records[0]!.ref));
    await assertStale(postOwner); assert.equal(post.records[0]!.unregisterCalls, 1); assert.equal(post.records[0]!.wipeCalls, 1);
    post.faults.withEntry = null;
    await assert.rejects(postOwner.service.present(post.records[1]!.ref), 'spent token must never publish later');
    await assertStale(postOwner);
});

test('contains register and confirm source throws and retires every claimed token', async () => {
    for (const source of ['register', 'confirm'] as const) {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        current.faults[source] = true;
        await assert.rejects(owner.service.present(current.records[0]!.ref), source);
        await assertStale(owner); assert.equal(current.records[0]!.wipeCalls, 1);
        assert.equal(current.records[0]!.unregisterCalls, source === 'confirm' ? 1 : 0);
    }
});

test('contains withCurrentDependent throws on both sides of its callback and drains once', async () => {
    for (const phase of ['pre', 'post'] as const) {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        const handoff = await owner.service.present(current.records[0]!.ref);
        await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
        let registration: unknown = null; let drains = 0; let callbackCalls = 0;
        assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
            registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => { drains += 1; });
        }), true);
        assert.ok(registration); current.faults.withDependent = phase;
        assert.equal(await owner.lifecycleController.withCurrentDependent(handoff.correlationToken, registration, () => {
            callbackCalls += 1;
        }), false);
        assert.equal(callbackCalls, phase === 'post' ? 1 : 0); assert.equal(drains, 1);
        await assertStale(owner);
    }
});

test('local retirement and drain win when unregister and wipe throw', async () => {
    for (const source of ['unregister', 'wipe', 'both'] as const) {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        const handoff = await owner.service.present(current.records[0]!.ref);
        await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
        let drains = 0; let registration: unknown = null;
        assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
            registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => { drains += 1; });
        }), true);
        assert.ok(registration); current.faults.unregister = source !== 'wipe'; current.faults.wipe = source !== 'unregister';
        assert.equal(owner.service.cancel(handoff.correlationToken), true); assert.equal(drains, 1);
        const lateSourceDispose = current.records[0]!.entryDispose; lateSourceDispose?.();
        assert.equal(drains, 1); await assertStale(owner);
        assert.equal(owner.lifecycleController.confirmDependent(TOKEN, registration), false);
    }
});

test('throwing, Promise, rejection, and hostile thenable callbacks fail closed without unhandled work', async () => {
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
        for (const kind of ['throw', 'resolved', 'rejected', 'thenable'] as const) {
            const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
            const handoff = await owner.service.present(current.records[0]!.ref); let calls = 0; let thenReads = 0;
            const thenable = Object.defineProperty(Object.create(null), 'then', { get() {
                thenReads += 1; throw new Error('hostile then getter');
            } });
            const callback = (() => {
                calls += 1;
                if (kind === 'throw') throw new Error('synthetic callback failure');
                if (kind === 'resolved') return Promise.resolve();
                if (kind === 'rejected') return Promise.reject(new Error('synthetic rejection'));
                return thenable;
            }) as unknown as () => void;
            assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, callback), false);
            assert.equal(calls, 1); assert.equal(thenReads, 0); await assertStale(owner);
        }
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', onUnhandled); }
});

test('rejects Proxy, async, and generator disposers without invoking them or their traps', async () => {
    for (const kind of ['proxy', 'async', 'generator'] as const) {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        const handoff = await owner.service.present(current.records[0]!.ref); let calls = 0; let traps = 0; let registration: unknown;
        await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
        const base = () => { calls += 1; };
        const disposer = kind === 'proxy'
            ? new Proxy(base, { apply() { traps += 1; return undefined; } })
            : kind === 'async' ? async () => { calls += 1; }
                : function* () { calls += 1; yield undefined; };
        assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
            registration = owner.lifecycleController.registerDependent(handoff.correlationToken, disposer as () => void);
        }), false);
        assert.equal(registration, null); assert.equal(calls, 0); assert.equal(traps, 0); await assertStale(owner);
    }
});
