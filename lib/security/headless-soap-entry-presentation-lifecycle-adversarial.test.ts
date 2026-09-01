/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessSoapEntryPresentationLifecycleOwner,
} from './headless-soap-entry-presentation-lifecycle.ts';
import {
    bindHeadlessSoapEntryPresentationGoldenSeal,
    createHeadlessSoapEntryPresentationGoldenFieldSet,
    HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4,
} from './headless-soap-entry-presentation-lifecycle-fixture.test.ts';

const CANONICAL_TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

function opaque(): Readonly<Record<never, never>> {
    return Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
}

function fixture(count = 1) {
    const fieldSet = createHeadlessSoapEntryPresentationGoldenFieldSet();
    const records = Array.from({ length: count }, () => ({
        entryRef: opaque(), registration: opaque(), current: true, returnCurrent: true, returnDependentCurrent: true,
        allowRegister: true, allowConfirm: true, dispose: null as (() => void) | null,
        gate: null as Promise<void> | null, releaseGate: null as (() => void) | null,
        withCalls: 0, registerCalls: 0, confirmCalls: 0, wipeCalls: 0,
    }));
    let entropyCalls = 0;
    let entropyFactory: () => Uint8Array = () => Uint8Array.from({ length: 32 }, (_, index) => index);
    const recordFor = (candidate: unknown) => records.find((record) => record.entryRef === candidate) ?? null;
    const entryLifecycle = {
        async withCurrentEntry(candidate: unknown, operation: (value: typeof fieldSet) => void) {
            const record = recordFor(candidate); if (!record?.current) return false; record.withCalls += 1;
            const gate = record.gate; if (gate) await gate; if (!record.current) return false;
            operation(fieldSet); return record.current && record.returnCurrent;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            const record = recordFor(candidate); if (record) record.registerCalls += 1;
            if (!record?.current || !record.allowRegister || record.dispose) return null;
            record.dispose = dispose; return record.registration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            const record = recordFor(candidate); if (record) record.confirmCalls += 1;
            return !!record?.current && record.allowConfirm && registration === record.registration && record.dispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            const record = recordFor(candidate);
            if (!record?.current || registration !== record.registration || !record.dispose) return false;
            record.dispose = null; return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
            const record = recordFor(candidate);
            if (!record?.current || registration !== record.registration || !record.dispose) return false;
            operation(); return record.current && record.returnDependentCurrent;
        },
    };
    const entryService = { wipe(candidate: unknown) {
        const record = recordFor(candidate); if (record) record.wipeCalls += 1; if (!record?.current) return false;
        record.current = false; const dispose = record.dispose; record.dispose = null; dispose?.(); return true;
    } };
    const entropy = () => { entropyCalls += 1; return entropyFactory(); };
    return {
        records, sources: { entryLifecycle, entryService, entropy }, entropyCalls: () => entropyCalls,
        setEntropy(factory: () => Uint8Array) { entropyFactory = factory; },
        block(index: number) { const record = records[index]!;
            record.gate = new Promise<void>((resolve) => { record.releaseGate = resolve; }); },
        release(index: number) { const record = records[index]!; const release = record.releaseGate;
            record.gate = null; record.releaseGate = null; release?.(); },
        retire(index: number) { const record = records[index]!; if (!record.current) return false;
            record.current = false; const dispose = record.dispose; record.dispose = null; dispose?.(); return true; },
    };
}

test('claims one entry before await so concurrent presentations sample entropy and attach only once', async () => {
    const current = fixture(); current.block(0);
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const first = owner.service.present(current.records[0]!.entryRef); await Promise.resolve();
    const second = owner.service.present(current.records[0]!.entryRef);
    const settled = Promise.allSettled([first, second]); await Promise.resolve(); current.release(0);
    const results = await settled;
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(current.records[0]!.withCalls, 1); assert.equal(current.entropyCalls(), 1);
    assert.equal(current.records[0]!.registerCalls, 1);
});

test('never publishes after currentness, attach, entropy, confirmation, or token uniqueness fails', async () => {
    const cases = [
        { name: 'currentness', prepare(current: ReturnType<typeof fixture>) { current.records[0]!.returnCurrent = false; } },
        { name: 'attach', prepare(current: ReturnType<typeof fixture>) { current.records[0]!.allowRegister = false; } },
        { name: 'confirm', prepare(current: ReturnType<typeof fixture>) { current.records[0]!.allowConfirm = false; } },
        { name: 'invalid entropy', prepare(current: ReturnType<typeof fixture>) {
            current.setEntropy(() => new Uint8Array(31)); } },
        { name: 'throwing entropy', prepare(current: ReturnType<typeof fixture>) {
            current.setEntropy(() => { throw new Error('synthetic entropy failure'); }); } },
    ];
    await Promise.all(cases.map(async ({ name, prepare }) => {
        const current = fixture(); prepare(current);
        const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        await assert.rejects(owner.service.present(current.records[0]!.entryRef), name);
        assert.equal(await owner.lifecycleController.withCurrentPresentation(
            CANONICAL_TOKEN, () => assert.fail(`${name} published a token`),
        ), false);
        assert.equal(current.records[0]!.wipeCalls, 1);
    }));

    const collision = fixture(2);
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(collision.sources);
    const first = await owner.service.present(collision.records[0]!.entryRef);
    await assert.rejects(owner.service.present(collision.records[1]!.entryRef));
    let firstStillCurrent = false;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(first.correlationToken, () => {
        firstStillCurrent = true;
    }), true);
    assert.equal(firstStillCurrent, true); assert.equal(collision.entropyCalls(), 2);
    assert.equal(collision.records[0]!.wipeCalls, 0); assert.equal(collision.records[1]!.wipeCalls, 1);
});

test('keeps foreign, noncanonical, and stale correlation tokens completely inert', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.records[0]!.entryRef); let callbacks = 0; let disposals = 0;
    const inertTokens = ['A'.repeat(43), `${handoff.correlationToken}=`, handoff.correlationToken.slice(0, -1), 'token-sintetico'];
    await Promise.all(inertTokens.map(async (token) => {
        assert.equal(owner.service.cancel(token), false);
        assert.equal(await owner.lifecycleController.withCurrentPresentation(token, () => { callbacks += 1; }), false);
        const registration = owner.lifecycleController.registerDependent(token, () => { disposals += 1; });
        assert.equal(registration, null); assert.equal(owner.lifecycleController.confirmDependent(token, opaque()), false);
        assert.equal(owner.lifecycleController.unregisterDependent(token, opaque()), false);
        assert.equal(await owner.lifecycleController.withCurrentDependent(token, opaque(), () => { callbacks += 1; }), false);
    }));
    assert.equal(callbacks, 0); assert.equal(disposals, 0); assert.equal(current.records[0]!.wipeCalls, 0);
    assert.equal(owner.service.cancel(handoff.correlationToken), true);
    assert.equal(owner.service.cancel(handoff.correlationToken), false);
    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        handoff.correlationToken, () => { callbacks += 1; },
    ), false);
    assert.equal(callbacks, 0);
});

test('H4 drain wins over cancel and drains its H5b dependent exactly once', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.records[0]!.entryRef);
    await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
    let drainCalls = 0; let reentrantCancel: boolean | null = null; let registration: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
        registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => {
            drainCalls += 1; reentrantCancel = owner.service.cancel(handoff.correlationToken);
        });
    }), true);
    assert.ok(registration); assert.equal(current.retire(0), true);
    assert.equal(drainCalls, 1); assert.equal(reentrantCancel, false);
    assert.equal(owner.service.cancel(handoff.correlationToken), false);
    assert.equal(owner.lifecycleController.confirmDependent(handoff.correlationToken, registration), false);
    assert.equal(current.records[0]!.wipeCalls, 0);
});

test('terminalizes seal binding when the final H4 currentness fence is lost', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.records[0]!.entryRef);
    current.records[0]!.returnDependentCurrent = false;

    assert.equal(await owner.sealBindingController.bindGestureSeal(
        handoff.correlationToken,
        HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal,
    ), false);
    assert.equal(current.records[0]!.wipeCalls, 1);
    assert.equal(owner.service.cancel(handoff.correlationToken), false);
    assert.equal(owner.lifecycleController.registerDependent(handoff.correlationToken, () => undefined), null);
});

test('blocks cross-entry presentation and currentness reentry for the whole H5b drain', async () => {
    const current = fixture(3); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const first = await owner.service.present(current.records[0]!.entryRef);
    current.setEntropy(() => Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const second = await owner.service.present(current.records[1]!.entryRef);
    await bindHeadlessSoapEntryPresentationGoldenSeal(owner, first.correlationToken);
    let nestedPresentation: Promise<'fulfilled' | 'rejected'> | null = null;
    let nestedCurrentness: Promise<boolean> | null = null;
    let siblingCallbacks = 0;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(first.correlationToken, () => {
        assert.ok(owner.lifecycleController.registerDependent(first.correlationToken, () => {
            nestedPresentation = owner.service.present(current.records[2]!.entryRef)
                .then(() => 'fulfilled' as const, () => 'rejected' as const);
            nestedCurrentness = owner.lifecycleController.withCurrentPresentation(second.correlationToken, () => {
                siblingCallbacks += 1;
            });
        }));
    }), true);

    assert.equal(owner.service.cancel(first.correlationToken), true);
    assert.ok(nestedPresentation); assert.ok(nestedCurrentness);
    assert.equal(await nestedPresentation, 'rejected');
    assert.equal(await nestedCurrentness, false);
    assert.equal(siblingCallbacks, 0);
    assert.equal(current.records[1]!.withCalls, 1);
    assert.equal(current.records[1]!.wipeCalls, 0);
    assert.equal(current.records[2]!.withCalls, 0);
    assert.equal(current.records[2]!.wipeCalls, 0);
    let secondStillCurrent = false;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(second.correlationToken, () => {
        secondStillCurrent = true;
    }), true);
    assert.equal(secondStillCurrent, true);
    current.setEntropy(() => Uint8Array.from({ length: 32 }, (_, index) => index + 2));
    const retry = await owner.service.present(current.records[2]!.entryRef);
    assert.equal(typeof retry.correlationToken, 'string');
});

test('poisons the outer presentation when entropy reenters with the same entry', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    let nested: Promise<'fulfilled' | 'rejected'> | null = null;
    current.setEntropy(() => {
        nested = owner.service.present(current.records[0]!.entryRef)
            .then(() => 'fulfilled' as const, () => 'rejected' as const);
        return Uint8Array.from({ length: 32 }, (_, index) => index);
    });

    await assert.rejects(owner.service.present(current.records[0]!.entryRef));
    assert.ok(nested); assert.equal(await nested, 'rejected');
    assert.equal(current.entropyCalls(), 1);
    assert.equal(current.records[0]!.wipeCalls, 1);
    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        CANONICAL_TOKEN,
        () => assert.fail('reentrant outer operation published a token'),
    ), false);
});

test('never reissues a correlation token after its presentation is terminal', async () => {
    const current = fixture(3); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const first = await owner.service.present(current.records[0]!.entryRef);
    assert.equal(owner.service.cancel(first.correlationToken), true);

    await assert.rejects(owner.service.present(current.records[1]!.entryRef));
    assert.equal(current.records[1]!.wipeCalls, 1);
    assert.equal(owner.service.cancel(first.correlationToken), false);

    current.setEntropy(() => Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const distinct = await owner.service.present(current.records[2]!.entryRef);
    assert.notEqual(distinct.correlationToken, first.correlationToken);
    let currentCalls = 0;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(distinct.correlationToken, () => {
        currentCalls += 1;
    }), true);
    assert.equal(currentCalls, 1);
    assert.equal(owner.service.cancel(first.correlationToken), false);
});

test('contains throwing, Promise-returning, and reentrant H5b disposers fail-closed', async () => {
    await Promise.all(['throw', 'promise', 'reentry'].map(async (mode) => {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        const handoff = await owner.service.present(current.records[0]!.entryRef);
        await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
        let drainCalls = 0; let reentrantCancel: boolean | null = null; let reentrantRegistration: unknown = undefined;
        const disposer = (() => {
            drainCalls += 1;
            if (mode === 'throw') throw new Error('synthetic disposer failure');
            if (mode === 'promise') return Promise.reject(new Error('synthetic disposer rejection'));
            reentrantCancel = owner.service.cancel(handoff.correlationToken);
            reentrantRegistration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => undefined);
            return undefined;
        }) as () => void;
        let registration: unknown = null;
        assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
            registration = owner.lifecycleController.registerDependent(handoff.correlationToken, disposer);
        }), true);
        assert.ok(registration); assert.equal(owner.service.cancel(handoff.correlationToken), true); await Promise.resolve();
        assert.equal(drainCalls, 1); assert.equal(owner.service.cancel(handoff.correlationToken), false);
        assert.equal(owner.lifecycleController.confirmDependent(handoff.correlationToken, registration), false);
        if (mode === 'reentry') { assert.equal(reentrantCancel, false); assert.equal(reentrantRegistration, null); }
    }));
});

test('async, generator, Proxy, and non-void callbacks never obtain presentation currentness', async () => {
    const callbackFactories = [
        { name: 'async', expectedCalls: 0, make(observed: { calls: number; traps: number }) {
            return (async () => { observed.calls += 1; }) as unknown as () => void; } },
        { name: 'generator', expectedCalls: 0, make(observed: { calls: number; traps: number }) {
            return (function* () { observed.calls += 1; yield undefined; }) as unknown as () => void; } },
        { name: 'Proxy', expectedCalls: 0, make(observed: { calls: number; traps: number }) {
            return new Proxy(() => { observed.calls += 1; }, { apply(target, thisArg, argumentsList) {
                observed.traps += 1; return Reflect.apply(target, thisArg, argumentsList); } }); } },
        { name: 'non-void', expectedCalls: 1, make(observed: { calls: number; traps: number }) {
            return (() => { observed.calls += 1; return 1; }) as unknown as () => void; } },
    ];
    const surfaces = ['presentation', 'dependent'] as const;
    await Promise.all(callbackFactories.flatMap((callbackCase) => surfaces.map(async (surface) => {
        const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
        const handoff = await owner.service.present(current.records[0]!.entryRef);
        const observed = { calls: 0, traps: 0 }; let registration: unknown = null; let dependentDrains = 0;
        if (surface === 'dependent') {
            await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
            assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
                registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => { dependentDrains += 1; });
            }), true);
            assert.ok(registration);
        }
        const callback = callbackCase.make(observed);
        const result = surface === 'presentation'
            ? await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, callback)
            : await owner.lifecycleController.withCurrentDependent(handoff.correlationToken, registration, callback);
        assert.equal(result, false, `${callbackCase.name}/${surface}`);
        assert.equal(observed.calls, callbackCase.expectedCalls); assert.equal(observed.traps, 0);
        assert.equal(owner.service.cancel(handoff.correlationToken), false);
        assert.equal(current.records[0]!.wipeCalls, 1);
        assert.equal(dependentDrains, surface === 'dependent' ? 1 : 0);
    })));
});
