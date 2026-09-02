/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
    PatientOpenLoopsFollowUpProposalV1Error,
    createPatientOpenLoopsFollowUpProposalServiceV1,
} from './patient-open-loops-follow-up-proposal.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const PERMIT = Object.freeze(Object.create(null)) as object;
const EXECUTION = Object.freeze(Object.create(null)) as object;
const record = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const list = <T>(values: T[]): readonly T[] => Object.freeze(values);
const input = () => ({ schemaVersion: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
    operationId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1 });

const sourceResult = () => record({ schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
    operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
    outcome: 'read' as const, items: list([
        record({ loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending' as const,
            temporalState: 'open' as const, openedAt: 800, dueAt: 1_100, revision: 2 }),
        record({ loopRef: `aipl_${'2'.repeat(64)}`, kind: 'series_stalled' as const,
            temporalState: 'overdue' as const, openedAt: 700, dueAt: 900, revision: 3 }),
        record({ loopRef: `aipl_${'3'.repeat(64)}`, kind: 'registered_expectation' as const,
            temporalState: 'unscheduled' as const, openedAt: 600, dueAt: null, revision: 4 }),
    ]), truncated: false, snapshotRevision: 7,
    receipt: record({ schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1',
        receiptRef: `aipr_${'4'.repeat(64)}`, operationId: 'mediflow.patient.open_loops.read.v1',
        capabilityId: 'mediflow.patient.open_loops.read.v1', outcome: 'read' as const,
        ownerRefHash: DIGEST, leaseRefHash: DIGEST, receiptRefHash: DIGEST,
        generation: 1, revocationGeneration: 0, selectionEpoch: 2, snapshotRevision: 7,
        itemCount: 3, truncated: false, timestamp: 1_000 }),
});

function makeSources(overrides: Record<string, unknown> = {}) {
    const refs = [`aipfp_${'5'.repeat(64)}`, `aipfr_${'6'.repeat(64)}`];
    return {
        now: () => 1_001,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        current: () => record({ generation: 1 }),
        beginPermit: () => EXECUTION,
        finalizePermit: () => true,
        denyPermit: () => true,
        readOpenLoops: async () => sourceResult(),
        writeAudit: async () => undefined,
        timeoutMs: 250,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => { resolve = settle; });
    return { promise, resolve };
}

test('maps the governed Open Loops read into one bounded review-first proposal', async () => {
    const audits: unknown[] = [];
    const calls: string[] = [];
    const refs = [`aipfp_${'5'.repeat(64)}`, `aipfr_${'6'.repeat(64)}`];
    const service = createPatientOpenLoopsFollowUpProposalServiceV1({
        now: () => 1_001,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        current: () => record({ generation: 1, revocationGeneration: 0, selectionEpoch: 2 }),
        beginPermit: (permit: unknown, _current: unknown, claim: unknown) => {
            assert.equal(permit, PERMIT);
            assert.deepEqual({ ...(claim as object) }, { operation: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1 });
            calls.push('begin'); return EXECUTION;
        },
        finalizePermit: (execution: unknown) => { assert.equal(execution, EXECUTION); calls.push('finalize'); return true; },
        denyPermit: () => false,
        readOpenLoops: async (_signal: AbortSignal) => { calls.push('read'); return sourceResult(); },
        writeAudit: async (audit: unknown) => { calls.push('audit'); audits.push(audit); },
        timeoutMs: 250,
    });

    const output = await service.propose(PERMIT, input());

    assert.deepEqual(calls, ['begin', 'read', 'audit', 'finalize']);
    assert.deepEqual(output.items.map((item) => ({ ...item })), [
        { loopRef: `aipl_${'1'.repeat(64)}`, action: 'review_result' },
        { loopRef: `aipl_${'2'.repeat(64)}`, action: 'review_measurement_series' },
        { loopRef: `aipl_${'3'.repeat(64)}`, action: 'review_expected_follow_up' },
    ]);
    assert.equal(output.operationId, PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1);
    assert.equal(output.applicationServiceRef, 'PatientOpenLoopsFollowUpProposalServiceV1');
    assert.equal(output.maximumStage, 'proposal_only');
    assert.equal(output.reviewRequired, true);
    assert.equal(output.writesPerformed, 0);
    assert.equal(output.apply, 'none');
    assert.equal(output.basedOnSnapshotRevision, 7);
    assert.equal(output.proposalRef, `aipfp_${'5'.repeat(64)}`);
    assert.equal(output.receipt.receiptRef, `aipfr_${'6'.repeat(64)}`);
    assert.equal(output.receipt.itemCount, 3);
    assert.equal(output.receipt.basedOnSnapshotRevision, 7);
    assert.equal(Object.getPrototypeOf(output), null);
    assert.equal(Object.isFrozen(output), true);
    assert.doesNotMatch(JSON.stringify({ output, audits }), /patientId|scope|diagnosis|reasoning|prompt|text/iu);
});

test('fails closed with a PHI-safe denial audit when the governed read fails', async () => {
    const audits: unknown[] = [];
    let denied = 0;
    let finalized = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1({
        now: () => 1_001,
        nextRef: () => `aipfp_${'5'.repeat(64)}`,
        hashRef: () => DIGEST,
        current: () => record({ generation: 1 }),
        beginPermit: () => EXECUTION,
        finalizePermit: () => { finalized += 1; return true; },
        denyPermit: (execution: unknown) => { assert.equal(execution, EXECUTION); denied += 1; return true; },
        readOpenLoops: async () => { throw new Error('synthetic dependency failure'); },
        writeAudit: async (audit: unknown) => { audits.push(audit); },
        timeoutMs: 250,
    });

    await assert.rejects(service.propose(PERMIT, input()),
        (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
            && error.code === 'read_unavailable');
    assert.equal(denied, 1);
    assert.equal(finalized, 0);
    assert.equal(audits.length, 1);
    assert.deepEqual({ ...(audits[0] as object) }, {
        schemaVersion: 'mediflow.aip.audit.v1',
        eventType: 'patient_open_loops_follow_up_proposal',
        outcome: 'denied',
        operation: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
        capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
        proposalRefHash: null,
        receiptRefHash: null,
        sourceReceiptRefHash: null,
        basedOnSnapshotRevision: null,
        itemCount: 0,
        maximumStage: 'proposal_only',
        reviewRequired: true,
        writesPerformed: 0,
        apply: 'none',
        egress: 'none',
        timestamp: 1_001,
        denialCode: 'read_unavailable',
    });
    assert.doesNotMatch(JSON.stringify(audits), /patientId|scope|diagnosis|reasoning|prompt|text/iu);
});

test('rejects caller patient, scope, text, and authority fields before acquiring a permit', async () => {
    for (const forbidden of ['patientId', 'scope', 'text', 'authority']) {
        let begins = 0;
        let reads = 0;
        const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
            beginPermit: () => { begins += 1; return EXECUTION; },
            readOpenLoops: async () => { reads += 1; return sourceResult(); },
        }));
        await assert.rejects(service.propose(PERMIT, { ...input(), [forbidden]: 'synthetic-forbidden' }),
            (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
                && error.code === 'invalid_input');
        assert.equal(begins, 0);
        assert.equal(reads, 0);
    }
});

test('denies a governed read that exceeds the 32-item proposal bound', async () => {
    const base = sourceResult();
    const items = list(Array.from({ length: 33 }, (_unused, index) => record({
        loopRef: `aipl_${(index + 1).toString(16).padStart(64, '0')}`,
        kind: 'results_pending' as const, temporalState: 'open' as const,
        openedAt: 800, dueAt: 1_100, revision: 2,
    })));
    const read = record({ ...base, items, receipt: record({ ...base.receipt, itemCount: 33 }) });
    let denied = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
        readOpenLoops: async () => read,
        denyPermit: () => { denied += 1; return true; },
    }));

    await assert.rejects(service.propose(PERMIT, input()),
        (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
            && error.code === 'read_unavailable');
    assert.equal(denied, 1);
});

test('cancellation aborts the governed read and suppresses finalization and late results', async () => {
    const pending = deferred<ReturnType<typeof sourceResult>>();
    let observedSignal: AbortSignal | undefined;
    let denied = 0;
    let finalized = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
        readOpenLoops: (signal: AbortSignal) => { observedSignal = signal; return pending.promise; },
        denyPermit: () => { denied += 1; return true; },
        finalizePermit: () => { finalized += 1; return true; },
    }));

    const result = service.propose(PERMIT, input());
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.cancel();
    await assert.rejects(result, (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
        && error.code === 'cancelled');
    assert.equal(observedSignal?.aborted, true);
    assert.equal(denied, 1);
    assert.equal(finalized, 0);
    pending.resolve(sourceResult());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finalized, 0);
});

test('the fixed native deadline denies a pending read and suppresses its late result', async () => {
    const pending = deferred<ReturnType<typeof sourceResult>>();
    let denied = 0;
    let finalized = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
        readOpenLoops: () => pending.promise,
        denyPermit: () => { denied += 1; return true; },
        finalizePermit: () => { finalized += 1; return true; },
    }));

    await assert.rejects(service.propose(PERMIT, input()),
        (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
            && error.code === 'timeout');
    assert.equal(denied, 1);
    assert.equal(finalized, 0);
    pending.resolve(sourceResult());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finalized, 0);
});

test('rechecks broker currentness after audit and denies before finalization', async () => {
    const calls: string[] = [];
    let currentnessChecks = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
        current: () => {
            currentnessChecks += 1;
            calls.push(`current:${currentnessChecks}`);
            if (currentnessChecks === 2) throw new Error('synthetic revocation');
            return record({ generation: 1 });
        },
        writeAudit: async () => { calls.push('audit'); },
        finalizePermit: () => { calls.push('finalize'); return true; },
        denyPermit: () => { calls.push('deny'); return true; },
    }));

    await assert.rejects(service.propose(PERMIT, input()),
        (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
            && error.code === 'authorization_denied');
    assert.deepEqual(calls, ['current:1', 'audit', 'current:2', 'deny', 'audit']);
});

test('post-fences a blocking final-currentness callback before permit finalization', async () => {
    let currentnessChecks = 0;
    let finalized = 0;
    const service = createPatientOpenLoopsFollowUpProposalServiceV1(makeSources({
        current: () => {
            currentnessChecks += 1;
            if (currentnessChecks === 2) {
                const until = performance.now() + 275;
                while (performance.now() < until) { /* bounded synthetic hostile callback */ }
            }
            return record({ generation: 1 });
        },
        finalizePermit: () => { finalized += 1; return true; },
    }));

    await assert.rejects(service.propose(PERMIT, input()),
        (error: unknown) => error instanceof PatientOpenLoopsFollowUpProposalV1Error
            && error.code === 'timeout');
    assert.equal(finalized, 0);
});
