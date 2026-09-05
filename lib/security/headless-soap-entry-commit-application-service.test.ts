/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { digestHeadlessSoapAuthorizationProof } from './headless-soap-authorization-proof-token.ts';
import { syntheticBinding } from './headless-soap-command-binding-test-fixture.ts';
import {
    createHeadlessSoapEntryCommitApplicationService,
    HeadlessSoapEntryCommitError,
    HeadlessSoapEntryCommitOwnerError,
    type HeadlessSoapEntryCommitApplicationSources,
} from './headless-soap-entry-commit-application-service.ts';
import type { HeadlessSoapBoundCommandV1 } from './headless-soap-command-binding-lifecycle.ts';

const PROOF = `hsap_${'11'.repeat(32)}`;
const APPROVAL = `hsaa_${'22'.repeat(32)}`;
const IDEMPOTENCY = `hsai_${'33'.repeat(32)}`;
const COMMAND = `hsac_${'44'.repeat(32)}`;
const PROOF_DIGEST = digestHeadlessSoapAuthorizationProof(PROOF)!;

type Receipt = Readonly<{ schema: 'synthetic.soap-receipt.v1'; receiptRef: string }>;
type Lookup = Readonly<{ status: 'missing' }> | Readonly<{ status: 'conflict' }>
    | Readonly<{ status: 'exact'; receipt: Receipt }>;
type Commit = Readonly<{ status: 'committed'; receipt: Receipt }>
    | Readonly<{ status: 'denied'; code: 'binding_unavailable' | 'idempotency_conflict'
        | 'receipt_unavailable' | 'storage_unavailable' | 'lifecycle_unavailable' }>;

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

const RECEIPT = record({ schema: 'synthetic.soap-receipt.v1' as const, receiptRef: `receipt_${'55'.repeat(16)}` });
const OTHER_RECEIPT = record({ schema: 'synthetic.soap-receipt.v1' as const, receiptRef: `receipt_${'66'.repeat(16)}` });

function envelope() {
    return record({ approvalRef: APPROVAL, idempotencyKey: IDEMPOTENCY, authorizationProof: PROOF });
}

function command(): HeadlessSoapBoundCommandV1 {
    const source = syntheticBinding();
    return record({
        schema: 'mediflow.headless.soap-bound-command.v1' as const,
        commandId: COMMAND,
        approvalRef: APPROVAL,
        idempotencyKey: IDEMPOTENCY,
        authorizationProofDigest: PROOF_DIGEST,
        lineage: source.lineage,
        sealBundle: source.sealBundle as HeadlessSoapBoundCommandV1['sealBundle'],
    });
}

function hasCode(expected: string) {
    return (error: unknown) => error instanceof HeadlessSoapEntryCommitError && error.code === expected;
}

function fixture(overrides: Partial<{
    lookups: Lookup[];
    commit: Commit;
    approvalResult: boolean;
    selectionResult: boolean;
    approvalThrows: boolean;
    lookupThrows: boolean;
    lookupFailure: unknown;
    malformedLookup: unknown;
    malformedCommit: unknown;
    selectionBinding: unknown;
    approvalInvokes: boolean;
    duplicateApproval: boolean;
    duplicateSelection: boolean;
    approvalReturn: unknown;
}> = {}) {
    const calls: string[] = [];
    const lookupInputs: unknown[] = [];
    const commitInputs: unknown[][] = [];
    const lookups = [...(overrides.lookups ?? [record({ status: 'missing' as const })])];
    const bound = command();
    const binding = record({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory',
        patientVersion: bound.lineage.patientVersion });
    const sources = record({
        approvalController: record({
            withSingleUseApproval(candidate: unknown, operation: (value: HeadlessSoapBoundCommandV1) => void) {
                calls.push('approval');
                assert.deepEqual(candidate, envelope());
                if (overrides.approvalThrows) throw new Error('synthetic approval source');
                if (overrides.approvalInvokes !== false) operation(bound);
                if (overrides.duplicateApproval) operation(bound);
                if (Object.hasOwn(overrides, 'approvalReturn')) return overrides.approvalReturn as Promise<boolean>;
                return Promise.resolve(overrides.approvalResult ?? true);
            },
        }),
        selectionController: record({
            withCurrentCommitBinding(scopeIdentity: unknown, expected: unknown,
                operation: (value: typeof binding) => void) {
                calls.push('selection');
                assert.equal(scopeIdentity, bound.lineage.selection.scopeIdentity);
                assert.deepEqual(expected, record({
                    webSessionId: bound.lineage.webSession.id,
                    sessionRef: bound.lineage.selection.sessionRef,
                    patientRef: bound.lineage.selection.patientRef,
                    ambulatoryRef: bound.lineage.selection.ambulatoryRef,
                    leaseRef: bound.lineage.selection.leaseRef,
                    selectionEpoch: bound.lineage.selection.selectionEpoch,
                    patientVersion: bound.lineage.patientVersion,
                }));
                operation((overrides.selectionBinding ?? binding) as typeof binding);
                if (overrides.duplicateSelection) operation(binding);
                return overrides.selectionResult ?? true;
            },
        }),
        commitOwner: record({
            snapshotReceipt(candidate: unknown) {
                return candidate === RECEIPT ? RECEIPT : candidate === OTHER_RECEIPT ? OTHER_RECEIPT : null;
            },
            lookup(input: unknown) {
                calls.push('lookup'); lookupInputs.push(input);
                if (Object.hasOwn(overrides, 'lookupFailure')) throw overrides.lookupFailure;
                if (overrides.lookupThrows) throw new Error('synthetic lookup source');
                if (Object.hasOwn(overrides, 'malformedLookup')) return overrides.malformedLookup;
                return lookups.shift() ?? record({ status: 'missing' as const });
            },
            commit(candidateCommand: unknown, candidateBinding: unknown) {
                calls.push('commit'); commitInputs.push([candidateCommand, candidateBinding]);
                if (Object.hasOwn(overrides, 'malformedCommit')) return overrides.malformedCommit;
                return overrides.commit ?? record({ status: 'committed' as const, receipt: RECEIPT });
            },
        }),
    }) as unknown as HeadlessSoapEntryCommitApplicationSources<Receipt>;
    return { service: createHeadlessSoapEntryCommitApplicationService(sources), calls, lookupInputs, commitInputs,
        bound, binding };
}

test('returns one exact durable replay before H6 without exposing the raw proof to storage', async () => {
    const current = fixture({ lookups: [record({ status: 'exact' as const, receipt: RECEIPT })] });
    const output = await current.service.execute(envelope());
    assert.deepEqual(current.calls, ['lookup']);
    assert.deepEqual(Reflect.ownKeys(output), ['status', 'receipt']);
    assert.equal(Object.getPrototypeOf(output), null); assert.equal(Object.isFrozen(output), true);
    assert.equal(output.status, 'entry_committed'); assert.equal(output.receipt, RECEIPT);
    assert.deepEqual(current.lookupInputs[0], record({
        approvalRef: APPROVAL, idempotencyKey: IDEMPOTENCY, authorizationProofDigest: PROOF_DIGEST,
    }));
    assert.doesNotMatch(JSON.stringify(current.lookupInputs), /hsap_/u);
});

test('rejects a durable conflict before H6 and keeps malformed envelopes inert', async () => {
    const conflict = fixture({ lookups: [record({ status: 'conflict' as const })] });
    await assert.rejects(conflict.service.execute(envelope()), hasCode('idempotency_conflict'));
    assert.deepEqual(conflict.calls, ['lookup']);
    const malformed = fixture();
    await assert.rejects(malformed.service.execute({ ...envelope() }), hasCode('envelope_unavailable'));
    assert.deepEqual(malformed.calls, []);
});

test('commits once inside selection currentness and returns only a canonical receipt', async () => {
    const current = fixture();
    const output = await current.service.execute(envelope());
    assert.equal(output.receipt, RECEIPT);
    assert.deepEqual(current.calls, ['lookup', 'approval', 'selection', 'commit']);
    assert.equal(current.commitInputs.length, 1);
    assert.equal(current.commitInputs[0]![0], current.bound);
    assert.equal(current.commitInputs[0]![1], current.binding);
});

test('recovers the durable receipt after commit when the H6 or selection final fence is lost', async () => {
    for (const overrides of [{ approvalResult: false }, { selectionResult: false }]) {
        const current = fixture({ ...overrides, lookups: [record({ status: 'missing' as const }),
            record({ status: 'exact' as const, receipt: OTHER_RECEIPT })] });
        const output = await current.service.execute(envelope());
        assert.equal(output.receipt, OTHER_RECEIPT);
        assert.deepEqual(current.calls, ['lookup', 'approval', 'selection', 'commit', 'lookup']);
    }
});

test('maps selection denial and captured H7b denial only after one missing post-lookup', async () => {
    const selection = fixture({ selectionResult: false, malformedCommit: record({ status: 'denied', code: 'binding_unavailable' }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(selection.service.execute(envelope()), hasCode('binding_unavailable'));
    const storage = fixture({ commit: record({ status: 'denied' as const, code: 'storage_unavailable' as const }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(storage.service.execute(envelope()), hasCode('storage_unavailable'));
});

test('uses approval denial only after post-lookup and normalizes dependency protocol failures', async () => {
    const denied = fixture({ approvalResult: false,
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(denied.service.execute(envelope()), hasCode('approval_unavailable'));
    const uninvoked = fixture({ approvalResult: false, approvalInvokes: false,
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(uninvoked.service.execute(envelope()), hasCode('approval_unavailable'));
    assert.equal(uninvoked.commitInputs.length, 0);
    const lookupThrow = fixture({ lookupThrows: true });
    await assert.rejects(lookupThrow.service.execute(envelope()), hasCode('storage_unavailable'));
    const malformedLookup = fixture({ malformedLookup: record({ status: 'future' }) });
    await assert.rejects(malformedLookup.service.execute(envelope()), hasCode('lifecycle_unavailable'));
    const malformedCommit = fixture({ malformedCommit: record({ status: 'committed', receipt: record({ future: true }) }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(malformedCommit.service.execute(envelope()), hasCode('receipt_unavailable'));
});

test('preserves only typed durable lookup failures from the H7b owner', async () => {
    await assert.rejects(fixture({
        lookupFailure: new HeadlessSoapEntryCommitOwnerError('receipt_unavailable'),
    }).service.execute(envelope()), hasCode('receipt_unavailable'));
    await assert.rejects(fixture({
        lookupFailure: new HeadlessSoapEntryCommitOwnerError('storage_unavailable'),
    }).service.execute(envelope()), hasCode('storage_unavailable'));
    await assert.rejects(fixture({
        lookupFailure: Object.freeze({ code: 'receipt_unavailable' }),
    }).service.execute(envelope()), hasCode('storage_unavailable'));
});

test('lets an exact post-lookup outrank a captured denial and a conflict outrank approval denial', async () => {
    const exact = fixture({ commit: record({ status: 'denied' as const, code: 'storage_unavailable' as const }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'exact' as const, receipt: RECEIPT })] });
    assert.equal((await exact.service.execute(envelope())).receipt, RECEIPT);
    const conflict = fixture({ approvalResult: false,
        lookups: [record({ status: 'missing' as const }), record({ status: 'conflict' as const })] });
    await assert.rejects(conflict.service.execute(envelope()), hasCode('idempotency_conflict'));
    const commitConflict = fixture({ commit: record({ status: 'denied' as const, code: 'idempotency_conflict' as const }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(commitConflict.service.execute(envelope()), hasCode('idempotency_conflict'));
});

test('rejects a non-canonical selection binding before the H7b commit', async () => {
    const current = fixture({ selectionBinding: Object.freeze({ patientId: 'synthetic-patient',
        ambulatoryId: 'synthetic-ambulatory', patientVersion: 1 }),
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(current.service.execute(envelope()), hasCode('lifecycle_unavailable'));
    assert.deepEqual(current.calls, ['lookup', 'approval', 'selection', 'lookup']);
    assert.equal(current.commitInputs.length, 0);
});

test('poisons duplicate approval and selection callbacks without a second commit', async () => {
    for (const duplicate of [{ duplicateApproval: true }, { duplicateSelection: true }]) {
        const current = fixture({ ...duplicate,
            lookups: [record({ status: 'missing' as const }), record({ status: 'exact' as const, receipt: RECEIPT })] });
        assert.equal((await current.service.execute(envelope())).receipt, RECEIPT);
        assert.equal(current.commitInputs.length, 1);
    }
});

test('never returns a captured receipt when a final fence is lost without durable replay', async () => {
    for (const finalLoss of [{ approvalResult: false }, { selectionResult: false }]) {
        const current = fixture({ ...finalLoss,
            lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
        await assert.rejects(current.service.execute(envelope()),
            hasCode(Object.hasOwn(finalLoss, 'approvalResult') ? 'approval_unavailable' : 'binding_unavailable'));
    }
});

test('does not assimilate a foreign thenable returned by the H6 port', async () => {
    let thenCalls = 0;
    const thenable = record({ then() { thenCalls += 1; } });
    const current = fixture({ approvalReturn: thenable, approvalInvokes: false,
        lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] });
    await assert.rejects(current.service.execute(envelope()), hasCode('lifecycle_unavailable'));
    assert.equal(thenCalls, 0);
});

test('observes rejected native Promise values returned by synchronous H7 ports', async (context) => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', onUnhandled);
    context.after(() => { process.off('unhandledRejection', onUnhandled); });
    for (const source of ['lookup', 'commit', 'selection'] as const) {
        const rejected = Promise.reject(new Error(`synthetic ${source} rejection`));
        const options = source === 'lookup'
            ? { malformedLookup: rejected }
            : source === 'commit'
                ? { malformedCommit: rejected,
                    lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] }
                : { selectionResult: rejected as unknown as boolean,
                    lookups: [record({ status: 'missing' as const }), record({ status: 'missing' as const })] };
        await assert.rejects(fixture(options).service.execute(envelope()), hasCode('lifecycle_unavailable'));
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled, 0);
});

test('observes a rejected Promise subclass returned by a synchronous H7 port', async (context) => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', onUnhandled);
    context.after(() => { process.off('unhandledRejection', onUnhandled); });
    class ForeignPromise<T> extends Promise<T> {}
    const rejected = new ForeignPromise<never>((_resolve, reject) => {
        reject(new Error('synthetic foreign Promise rejection'));
    });
    await assert.rejects(
        fixture({ malformedLookup: rejected }).service.execute(envelope()),
        hasCode('lifecycle_unavailable'),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled, 0);
});
