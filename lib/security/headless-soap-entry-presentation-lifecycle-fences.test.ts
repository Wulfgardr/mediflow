/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createClinicianSoapEntryFieldSet } from '../headless/clinician-soap-entry-field-set.ts';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import {
    createHeadlessSoapEntryPresentationLifecycleOwner,
} from './headless-soap-entry-presentation-lifecycle.ts';

const TOKEN_A = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

function opaque(): Readonly<Record<never, never>> {
    return Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
}

function canonicalFieldSet() {
    const draft = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico', objective: 'Parametro sintetico',
        assessment: 'Valutazione sintetica', plan: 'Piano sintetico',
    });
    const accepted = validateClinicianSoapWriteDraft(draft); assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('synthetic H1 fixture denied');
    const fieldSet = createClinicianSoapEntryFieldSet(accepted, 1_704_067_200_987); assert.ok(fieldSet); return fieldSet;
}

type EntryMode = 'normal' | 'duplicate' | 'held' | 'false_after_callback';
type DependentMode = 'normal' | 'duplicate';

function fixture(count = 2) {
    const fieldSet = canonicalFieldSet();
    const entries = Array.from({ length: count }, () => ({
        ref: opaque(), registration: opaque(), current: true, dispose: null as (() => void) | null,
        entryMode: 'normal' as EntryMode, dependentMode: 'normal' as DependentMode,
        entryCallbacks: 0, dependentCallbacks: 0, registerCalls: 0, wipeCalls: 0,
        release: null as ((current: boolean) => void) | null,
    }));
    let entropyCalls = 0;
    let entropyFactory: () => Uint8Array = () => Uint8Array.from({ length: 32 }, (_, index) => index);
    const entryFor = (candidate: unknown) => entries.find((entry) => entry.ref === candidate) ?? null;
    const entryLifecycle = {
        async withCurrentEntry(candidate: unknown, operation: (value: typeof fieldSet) => void) {
            const entry = entryFor(candidate); if (!entry?.current) return false;
            entry.entryCallbacks += 1; operation(fieldSet);
            if (entry.entryMode === 'duplicate') { entry.entryCallbacks += 1; operation(fieldSet); }
            if (entry.entryMode === 'held') return new Promise<boolean>((resolve) => { entry.release = resolve; });
            return entry.entryMode !== 'false_after_callback' && entry.current;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            const entry = entryFor(candidate); if (entry) entry.registerCalls += 1;
            if (!entry?.current || entry.dispose) return null; entry.dispose = dispose; return entry.registration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            const entry = entryFor(candidate);
            return !!entry?.current && entry.registration === registration && entry.dispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            const entry = entryFor(candidate);
            if (!entry?.current || entry.registration !== registration || !entry.dispose) return false;
            entry.dispose = null; return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
            const entry = entryFor(candidate);
            if (!entry?.current || entry.registration !== registration || !entry.dispose) return false;
            entry.dependentCallbacks += 1; operation();
            if (entry.dependentMode === 'duplicate') { entry.dependentCallbacks += 1; operation(); }
            return entry.current;
        },
    };
    const entryService = { wipe(candidate: unknown) {
        const entry = entryFor(candidate); if (entry) entry.wipeCalls += 1; if (!entry?.current) return false;
        entry.current = false; const dispose = entry.dispose; entry.dispose = null; dispose?.(); return true;
    } };
    return {
        entries,
        sources: { entryLifecycle, entryService,
            entropy: () => { entropyCalls += 1; return entropyFactory(); } },
        entropyCalls: () => entropyCalls,
        setEntropy(factory: () => Uint8Array) { entropyFactory = factory; },
        drain(index: number) { const entry = entries[index]!; if (!entry.current) return false;
            entry.current = false; const dispose = entry.dispose; entry.dispose = null; dispose?.(); return true; },
    };
}

test('duplicate H4 withCurrentEntry callback poisons the presentation without a second entropy claim', async () => {
    const current = fixture(); current.entries[0]!.entryMode = 'duplicate';
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);

    await assert.rejects(owner.service.present(current.entries[0]!.ref));

    assert.equal(current.entries[0]!.entryCallbacks, 2);
    assert.equal(current.entropyCalls(), 1); assert.equal(current.entries[0]!.registerCalls, 1);
    assert.equal(current.entries[0]!.wipeCalls, 1);
    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        TOKEN_A, () => assert.fail('duplicate H4 callback published a presentation'),
    ), false);
});

test('duplicate H4 withCurrentDependent callback runs the client callback once and retires the presentation', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.entries[0]!.ref);
    current.entries[0]!.dependentMode = 'duplicate'; let callbackCalls = 0;

    assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
        callbackCalls += 1;
    }), false);

    assert.equal(current.entries[0]!.dependentCallbacks, 2); assert.equal(callbackCalls, 1);
    assert.equal(current.entries[0]!.wipeCalls, 1); assert.equal(owner.service.cancel(handoff.correlationToken), false);
});

test('H4 drain before a held completion wins over the late successful completion', async () => {
    const current = fixture(); current.entries[0]!.entryMode = 'held';
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const pending = owner.service.present(current.entries[0]!.ref);

    assert.equal(current.entropyCalls(), 1); assert.equal(current.entries[0]!.registerCalls, 1);
    assert.equal(current.drain(0), true); const release = current.entries[0]!.release; assert.ok(release); release(true);
    await assert.rejects(pending);

    assert.equal(current.entries[0]!.wipeCalls, 0);
    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        TOKEN_A, () => assert.fail('late H4 completion resurrected a presentation'),
    ), false);
});

test('a post-entropy failure clears pending token state and a distinct token can publish', async () => {
    const current = fixture(); current.entries[0]!.entryMode = 'false_after_callback';
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);

    await assert.rejects(owner.service.present(current.entries[0]!.ref));
    current.setEntropy(() => Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const retry = await owner.service.present(current.entries[1]!.ref);

    assert.notEqual(retry.correlationToken, TOKEN_A); assert.equal(current.entropyCalls(), 2);
    let observed = 0;
    assert.equal(await owner.lifecycleController.withCurrentPresentation(retry.correlationToken, () => {
        observed += 1;
    }), true);
    assert.equal(observed, 1); assert.equal(owner.service.cancel(TOKEN_A), false);
});

test('entropy sibling reentry poisons both operations while leaving the sibling retryable', async () => {
    const current = fixture(); const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    let nested: Promise<'fulfilled' | 'rejected'> | null = null;
    current.setEntropy(() => {
        nested = owner.service.present(current.entries[1]!.ref)
            .then(() => 'fulfilled' as const, () => 'rejected' as const);
        return Uint8Array.from({ length: 32 }, (_, index) => index);
    });

    await assert.rejects(owner.service.present(current.entries[0]!.ref));
    assert.ok(nested); assert.equal(await nested, 'rejected');
    assert.equal(current.entries[0]!.wipeCalls, 1); assert.equal(current.entries[1]!.wipeCalls, 0);
    assert.equal(current.entries[1]!.entryCallbacks, 0);

    current.setEntropy(() => Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const retry = await owner.service.present(current.entries[1]!.ref);
    assert.equal(typeof retry.correlationToken, 'string'); assert.equal(current.entries[1]!.entryCallbacks, 1);
});
