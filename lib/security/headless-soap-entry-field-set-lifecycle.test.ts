/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import {
    createHeadlessSoapEntryFieldSetLifecycleOwner, HeadlessSoapEntryFieldSetLifecycleError,
} from './headless-soap-entry-field-set-lifecycle.ts';

const hasCode = (code: string) => (error: unknown) => error instanceof HeadlessSoapEntryFieldSetLifecycleError && error.code === code;

function h1Snapshot() {
    const draft = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico', objective: 'Esame sintetico', assessment: '', plan: 'Piano sintetico',
    });
    const result = validateClinicianSoapWriteDraft(draft); assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('synthetic H1 snapshot denied'); return result;
}

function fixture() {
    const proposalRef = Object.freeze(Object.create(null)); const registration = Object.freeze(Object.create(null));
    let current = true, dispose: (() => void) | null = null, wipeCalls = 0, now = 1_704_067_200_987, proposalCalls = 0;
    let proposalGate: Promise<void> | null = null, releaseProposalGate: (() => void) | null = null;
    const proposalLifecycle = {
        async withCurrentProposal(candidate: unknown, operation: (snapshot: ReturnType<typeof h1Snapshot>) => void) {
            proposalCalls += 1; if (!current || candidate !== proposalRef) return false;
            if (proposalGate) await proposalGate; operation(h1Snapshot()); return current;
        },
        registerDependent(candidate: unknown, disposer: () => void) {
            if (!current || candidate !== proposalRef || dispose) return null; dispose = disposer; return registration;
        },
        confirmDependent(candidate: unknown, candidateRegistration: unknown) {
            return current && candidate === proposalRef && candidateRegistration === registration && dispose !== null;
        },
        unregisterDependent(candidate: unknown, candidateRegistration: unknown) {
            if (!current || candidate !== proposalRef || candidateRegistration !== registration || !dispose) return false;
            dispose = null; return true;
        },
        async withCurrentDependent(candidate: unknown, candidateRegistration: unknown,
            operation: (snapshot: ReturnType<typeof h1Snapshot>) => void) {
            if (!current || candidate !== proposalRef || candidateRegistration !== registration || !dispose) return false;
            operation(h1Snapshot()); return current;
        },
    };
    const proposalService = { wipe(candidate: unknown) { wipeCalls += 1; if (!current || candidate !== proposalRef) return false;
        current = false; const disposer = dispose; dispose = null; disposer?.(); return true; } };
    return { proposalRef, proposalLifecycle, proposalService, clock: () => now,
        setNow(value: number) { now = value; }, retire() { const disposer = dispose; current = false; dispose = null; disposer?.(); },
        blockProposal() { proposalGate = new Promise<void>((resolve) => { releaseProposalGate = resolve; }); },
        releaseProposal() { const release = releaseProposalGate; proposalGate = null; releaseProposalGate = null; release?.(); },
        proposalCalls: () => proposalCalls, wipeCalls: () => wipeCalls };
}

function twoProposalFixture() {
    const records = [0, 1].map(() => ({ proposalRef: Object.freeze(Object.create(null)),
        registration: Object.freeze(Object.create(null)), current: true, dispose: null as (() => void) | null, calls: 0 }));
    let gate: Promise<void> | null = null, releaseGate: (() => void) | null = null;
    let dependentGate: Promise<void> | null = null, releaseDependentGate: (() => void) | null = null;
    const byProposal = (candidate: unknown) => records.find((record) => record.proposalRef === candidate) ?? null;
    const proposalLifecycle = {
        async withCurrentProposal(candidate: unknown, operation: (snapshot: ReturnType<typeof h1Snapshot>) => void) {
            const record = byProposal(candidate); if (!record?.current) return false; record.calls += 1;
            if (record === records[0] && gate) await gate; operation(h1Snapshot()); return record.current;
        },
        registerDependent(candidate: unknown, dispose: () => void) { const record = byProposal(candidate);
            if (!record?.current || record.dispose) return null; record.dispose = dispose; return record.registration; },
        confirmDependent(candidate: unknown, registration: unknown) { const record = byProposal(candidate);
            return !!record?.current && record.registration === registration && record.dispose !== null; },
        unregisterDependent(candidate: unknown, registration: unknown) { const record = byProposal(candidate);
            if (!record?.current || record.registration !== registration || !record.dispose) return false; record.dispose = null; return true; },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: (snapshot: ReturnType<typeof h1Snapshot>) => void) {
            const record = byProposal(candidate); if (!record?.current || record.registration !== registration || !record.dispose) return false;
            if (record === records[0] && dependentGate) await dependentGate;
            operation(h1Snapshot()); return record.current;
        },
    };
    const proposalService = { wipe(candidate: unknown) { const record = byProposal(candidate); if (!record?.current) return false;
        record.current = false; const dispose = record.dispose; record.dispose = null; dispose?.(); return true; } };
    return { records, proposalLifecycle, proposalService, clock: () => 1_704_067_200_987,
        blockFirst() { gate = new Promise<void>((resolve) => { releaseGate = resolve; }); },
        releaseFirst() { const release = releaseGate; gate = null; releaseGate = null; release?.(); },
        blockFirstDependent() { dependentGate = new Promise<void>((resolve) => { releaseDependentGate = resolve; }); },
        releaseFirstDependent() { const release = releaseDependentGate; dependentGate = null; releaseDependentGate = null; release?.(); } };
}

test('materializes one opaque entry and exposes its exact host field set only through H5 continuation', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    assert.equal(Object.isFrozen(owner), true); assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['materialize', 'wipe']);
    const entryRef = await owner.service.materialize(current.proposalRef);
    assert.equal(Object.getPrototypeOf(entryRef), null); assert.equal(Object.isFrozen(entryRef), true); assert.deepEqual(Reflect.ownKeys(entryRef), []);
    let observed: unknown;
    assert.equal(await owner.lifecycleController.withCurrentEntry(entryRef, (fieldSet) => { observed = fieldSet; }), true);
    assert.equal((observed as { date?: unknown }).date, '2024-01-01T00:00:00.000Z');
    assert.equal(Object.isFrozen(observed), true); assert.equal(Object.getPrototypeOf(observed), null);
    await assert.rejects(owner.service.materialize(current.proposalRef), hasCode('proposal_unavailable'));
});

test('registers one opaque H5 dependent and drains it exactly once on explicit wipe', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const entryRef = await owner.service.materialize(current.proposalRef); let drainCalls = 0;
    const registration = owner.lifecycleController.registerDependent(entryRef, () => { drainCalls += 1; });
    assert.ok(registration); assert.equal(Object.getPrototypeOf(registration), null); assert.equal(Object.isFrozen(registration), true);
    assert.deepEqual(Reflect.ownKeys(registration), []); assert.equal(owner.lifecycleController.confirmDependent(entryRef, registration), true);
    let observed = false; assert.equal(await owner.lifecycleController.withCurrentDependent(entryRef, registration, () => { observed = true; }), true);
    assert.equal(observed, true); assert.equal(owner.service.wipe(entryRef), true); assert.equal(owner.service.wipe(entryRef), false);
    assert.equal(drainCalls, 1); assert.equal(owner.lifecycleController.confirmDependent(entryRef, registration), false);
    assert.equal(current.wipeCalls(), 1);
});

test('claims a proposal before the first await so a concurrent same-ref materialization stays inert', async () => {
    const current = fixture(); current.blockProposal(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const first = owner.service.materialize(current.proposalRef); await Promise.resolve();
    const second = owner.service.materialize(current.proposalRef); await Promise.resolve(); current.releaseProposal();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const denied = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(denied); assert.equal(hasCode('proposal_unavailable')(denied.reason), true);
    assert.equal(current.proposalCalls(), 1); assert.equal(current.wipeCalls(), 0);
});

test('serializes H3 calls owner-wide while keeping a different proposal retryable after overlap', async () => {
    const current = twoProposalFixture(); current.blockFirst(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const first = owner.service.materialize(current.records[0]!.proposalRef); await Promise.resolve();
    await assert.rejects(owner.service.materialize(current.records[1]!.proposalRef), hasCode('lifecycle_unavailable'));
    assert.equal(current.records[1]!.calls, 0); current.releaseFirst(); await first;
    const secondEntry = await owner.service.materialize(current.records[1]!.proposalRef);
    assert.deepEqual(Reflect.ownKeys(secondEntry), []); assert.equal(current.records[1]!.calls, 1);
});

test('keeps a foreign proposal inert and terminalizes every denial after a proposal was claimed', async () => {
    const foreignCurrent = fixture(); const foreignOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(foreignCurrent);
    const foreign = Object.freeze(Object.create(null));
    await assert.rejects(foreignOwner.service.materialize(foreign), hasCode('proposal_unavailable'));
    assert.equal(foreignCurrent.wipeCalls(), 0);

    const clockFailure = fixture(); let samples = 0; clockFailure.clock = () => { samples += 1; return Number.NaN; };
    const clockOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(clockFailure);
    await assert.rejects(clockOwner.service.materialize(clockFailure.proposalRef), hasCode('field_set_unavailable'));
    assert.equal(samples, 1); assert.equal(clockFailure.wipeCalls(), 1);
    await assert.rejects(clockOwner.service.materialize(clockFailure.proposalRef), hasCode('proposal_unavailable'));

    const attachFailure = fixture(); attachFailure.proposalLifecycle.registerDependent = () => null;
    const attachOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(attachFailure);
    await assert.rejects(attachOwner.service.materialize(attachFailure.proposalRef), hasCode('lifecycle_unavailable'));
    assert.equal(attachFailure.wipeCalls(), 1);

    const fenceFailure = fixture(); fenceFailure.proposalLifecycle.confirmDependent = () => false;
    const fenceOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(fenceFailure);
    await assert.rejects(fenceOwner.service.materialize(fenceFailure.proposalRef), hasCode('lifecycle_unavailable'));
    assert.equal(fenceFailure.wipeCalls(), 1);
});

test('uses a two-phase H5 drain and contains throw, rejected Promise, and drain reentry on H3 retirement', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const entryRef = await owner.service.materialize(current.proposalRef); const calls: string[] = [];
    const first = owner.lifecycleController.registerDependent(entryRef, () => { calls.push('first'); throw new Error('synthetic disposer'); });
    const second = owner.lifecycleController.registerDependent(entryRef, (() => { calls.push('second');
        return Promise.reject(new Error('synthetic rejected disposer')); }) as () => void);
    const third = owner.lifecycleController.registerDependent(entryRef, () => { calls.push('third');
        assert.equal(owner.service.wipe(entryRef), false); assert.equal(owner.lifecycleController.registerDependent(entryRef, () => undefined), null); });
    const removed = owner.lifecycleController.registerDependent(entryRef, () => { calls.push('removed'); });
    assert.ok(first && second && third && removed); assert.equal(owner.lifecycleController.unregisterDependent(entryRef, removed), true);
    assert.equal(owner.lifecycleController.unregisterDependent(entryRef, removed), false);
    current.retire(); await Promise.resolve();
    assert.deepEqual(calls.sort(), ['first', 'second', 'third']); assert.equal(owner.service.wipe(entryRef), false);
    assert.equal(owner.lifecycleController.confirmDependent(entryRef, first), false); assert.equal(current.wipeCalls(), 0);
});

test('terminalizes an authentic entry when H5 supplies an asynchronous continuation', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const entryRef = await owner.service.materialize(current.proposalRef);
    assert.equal(await owner.lifecycleController.withCurrentEntry(entryRef, (async () => undefined) as () => void), false);
    assert.equal(owner.service.wipe(entryRef), false); assert.equal(current.wipeCalls(), 1);
});

test('contains every invalid H5 continuation result and synchronous reentry', async () => {
    const invalidOperations: Array<() => () => void> = [
        () => (function* () { yield undefined; }) as unknown as () => void,
        () => new Proxy(() => undefined, {}) as () => void,
        () => (() => { throw new Error('synthetic continuation'); }),
        () => (() => 1) as unknown as () => void,
        () => (() => Promise.reject(new Error('synthetic rejected continuation'))) as unknown as () => void,
    ];
    for (const operation of invalidOperations) {
        const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
        const entryRef = await owner.service.materialize(current.proposalRef);
        assert.equal(await owner.lifecycleController.withCurrentEntry(entryRef, operation()), false);
        await Promise.resolve(); assert.equal(owner.service.wipe(entryRef), false); assert.equal(current.wipeCalls(), 1);
    }

    const reentryCurrent = fixture(); const reentryOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(reentryCurrent);
    const reentryRef = await reentryOwner.service.materialize(reentryCurrent.proposalRef); let inner: Promise<boolean> | null = null;
    const outer = await reentryOwner.lifecycleController.withCurrentEntry(reentryRef, () => {
        inner = reentryOwner.lifecycleController.withCurrentEntry(reentryRef, () => undefined);
    });
    assert.equal(outer, false); assert.ok(inner); assert.equal(await inner, false);
    assert.equal(reentryOwner.service.wipe(reentryRef), false); assert.equal(reentryCurrent.wipeCalls(), 1);
});

test('allows H5 registration only in the entry continuation and fences every created dependent', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const entryRef = await owner.service.materialize(current.proposalRef); let registration: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentEntry(entryRef, () => {
        registration = owner.lifecycleController.registerDependent(entryRef, () => undefined); assert.ok(registration);
    }), true);
    assert.equal(owner.lifecycleController.confirmDependent(entryRef, registration), true);
    assert.equal(await owner.lifecycleController.withCurrentDependent(entryRef, registration, () => {
        assert.equal(owner.lifecycleController.registerDependent(entryRef, () => undefined), null);
    }), false);
    assert.equal(owner.service.wipe(entryRef), false); assert.equal(current.wipeCalls(), 1);
});

test('keeps foreign H4 identities inert across every public and private surface', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const foreignRef = Object.freeze(Object.create(null)); const foreignRegistration = Object.freeze(Object.create(null));
    assert.equal(owner.service.wipe(foreignRef), false);
    assert.equal(await owner.lifecycleController.withCurrentEntry(foreignRef, () => undefined), false);
    assert.equal(owner.lifecycleController.registerDependent(foreignRef, () => undefined), null);
    assert.equal(owner.lifecycleController.confirmDependent(foreignRef, foreignRegistration), false);
    assert.equal(owner.lifecycleController.unregisterDependent(foreignRef, foreignRegistration), false);
    assert.equal(await owner.lifecycleController.withCurrentDependent(foreignRef, foreignRegistration, () => undefined), false);
    assert.equal(current.wipeCalls(), 0);
});

test('keeps foreign H5 registration inert even with an invalid callback', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const entryRef = await owner.service.materialize(current.proposalRef); const foreignRegistration = Object.freeze(Object.create(null));
    assert.equal(await owner.lifecycleController.withCurrentDependent(
        entryRef, foreignRegistration, (async () => undefined) as () => void,
    ), false);
    assert.equal(owner.service.wipe(entryRef), true); assert.equal(current.wipeCalls(), 1);
});

test('keeps a second entry retryable during an external H3-operation overlap', async () => {
    const current = twoProposalFixture(); const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    const firstRef = await owner.service.materialize(current.records[0]!.proposalRef);
    const secondRef = await owner.service.materialize(current.records[1]!.proposalRef);
    current.blockFirstDependent(); const first = owner.lifecycleController.withCurrentEntry(firstRef, () => undefined); await Promise.resolve();
    assert.equal(await owner.lifecycleController.withCurrentEntry(secondRef, () => undefined), false);
    current.releaseFirstDependent(); assert.equal(await first, true);
    assert.equal(await owner.lifecycleController.withCurrentEntry(secondRef, () => undefined), true);
});

test('terminalizes on upstream callback duplication, final loss, and synchronous materialize reentry', async () => {
    const duplicate = fixture(); duplicate.proposalLifecycle.withCurrentDependent = async (candidate, registration, operation) => {
        if (!duplicate.proposalLifecycle.confirmDependent(candidate, registration)) return false;
        operation(h1Snapshot()); operation(h1Snapshot()); return true;
    };
    const duplicateOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(duplicate);
    const duplicateRef = await duplicateOwner.service.materialize(duplicate.proposalRef);
    assert.equal(await duplicateOwner.lifecycleController.withCurrentEntry(duplicateRef, () => undefined), false);
    assert.equal(duplicate.wipeCalls(), 1);

    const lost = fixture(); const lostOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(lost);
    const lostRef = await lostOwner.service.materialize(lost.proposalRef);
    lost.proposalLifecycle.withCurrentDependent = async (_candidate, _registration, operation) => { operation(h1Snapshot()); return false; };
    assert.equal(await lostOwner.lifecycleController.withCurrentEntry(lostRef, () => undefined), false);
    assert.equal(lost.wipeCalls(), 1);

    const reentry = twoProposalFixture();
    const ownerBox: { value: ReturnType<typeof createHeadlessSoapEntryFieldSetLifecycleOwner> | null } = { value: null };
    let nestedCode: unknown = null; let samples = 0;
    reentry.clock = () => { samples += 1; void ownerBox.value!.service.materialize(reentry.records[1]!.proposalRef)
        .catch((error: unknown) => { nestedCode = (error as { code?: unknown }).code; }); return 1_704_067_200_987; };
    const reentryOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(reentry); ownerBox.value = reentryOwner;
    await assert.rejects(reentryOwner.service.materialize(reentry.records[0]!.proposalRef), hasCode('lifecycle_unavailable'));
    await Promise.resolve(); assert.equal(samples, 1); assert.equal(nestedCode, 'lifecycle_unavailable');
    const retry = await reentryOwner.service.materialize(reentry.records[1]!.proposalRef); assert.deepEqual(Reflect.ownKeys(retry), []);
});

test('does not reuse H3 after its disposer retires a provisional entry during attach', async () => {
    const current = fixture(); current.proposalLifecycle.registerDependent = (_candidate, dispose) => {
        dispose(); current.retire(); return Object.freeze(Object.create(null));
    };
    const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current);
    await assert.rejects(owner.service.materialize(current.proposalRef), hasCode('lifecycle_unavailable'));
    assert.equal(current.wipeCalls(), 0);
});
