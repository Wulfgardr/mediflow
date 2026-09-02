/* @Codex */

import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

import {
    DIGEST,
    PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1,
    PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    RECEIPT_REF as READ_RECEIPT_REF,
    exact,
    integer,
    matches,
    opaque,
    record,
    type PatientOpenLoopItemV1,
    type PatientOpenLoopsReadResultV1,
} from './patient-open-loops-contract.ts';

export const PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1
    = 'mediflow.patient.open_loops.follow_up.propose.v1' as const;
export const PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_APPLICATION_SERVICE_V1
    = 'PatientOpenLoopsFollowUpProposalServiceV1' as const;
export const PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_MAX_ITEMS_V1
    = PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1;

const INPUT_SCHEMA = 'mediflow.patient.open_loops.follow_up.propose.input.v1' as const;
const OUTPUT_SCHEMA = 'mediflow.patient.open_loops.follow_up.proposal.v1' as const;
const RECEIPT_SCHEMA = 'mediflow.patient.open_loops.follow_up.proposal.receipt.v1' as const;
const TIMEOUT_MS = 250 as const;
const INPUT_KEYS = ['schemaVersion', 'operationId'] as const;
const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'current', 'beginPermit', 'finalizePermit', 'denyPermit',
    'readOpenLoops', 'writeAudit', 'timeoutMs'] as const;
const READ_RESULT_KEYS = ['schemaVersion', 'operationId', 'capabilityId', 'outcome', 'items', 'truncated',
    'snapshotRevision', 'receipt'] as const;
const READ_ITEM_KEYS = ['loopRef', 'kind', 'temporalState', 'openedAt', 'dueAt', 'revision'] as const;
const READ_RECEIPT_KEYS = ['schemaVersion', 'receiptRef', 'operationId', 'capabilityId', 'outcome', 'ownerRefHash',
    'leaseRefHash', 'receiptRefHash', 'generation', 'revocationGeneration', 'selectionEpoch', 'snapshotRevision',
    'itemCount', 'truncated', 'timestamp'] as const;
const LOOP_REF = /^aipl_[0-9a-f]{64}$/u;
const PROPOSAL_REF = /^aipfp_[0-9a-f]{64}$/u;
const PROPOSAL_RECEIPT_REF = /^aipfr_[0-9a-f]{64}$/u;

export type PatientOpenLoopsFollowUpProposalV1ErrorCode = 'invalid_input' | 'authorization_denied'
    | 'read_unavailable' | 'reference_invalid' | 'audit_unavailable' | 'timeout' | 'cancelled' | 'disposed';

export class PatientOpenLoopsFollowUpProposalV1Error extends Error {
    constructor(public readonly code: PatientOpenLoopsFollowUpProposalV1ErrorCode) {
        super(`Patient open-loops follow-up proposal rejected: ${code}`);
        this.name = 'PatientOpenLoopsFollowUpProposalV1Error';
    }
}

type FollowUpAction = 'review_result' | 'review_measurement_series' | 'review_expected_follow_up';
type Sources = Readonly<{
    now: () => unknown;
    nextRef: () => unknown;
    hashRef: (value: string) => unknown;
    current: () => unknown;
    beginPermit: (permit: unknown, current: unknown, claim: unknown) => unknown;
    finalizePermit: (execution: unknown, current: unknown, claim: unknown) => unknown;
    denyPermit: (execution: unknown) => unknown;
    readOpenLoops: (signal: AbortSignal) => unknown;
    writeAudit: (audit: unknown) => unknown;
    timeoutMs: 250;
}>;

const actionFor = (kind: PatientOpenLoopItemV1['kind']): FollowUpAction => {
    switch (kind) {
        case 'results_pending': return 'review_result';
        case 'series_stalled': return 'review_measurement_series';
        case 'registered_expectation': return 'review_expected_follow_up';
    }
};

function parseInput(value: unknown): void {
    const input = exact(value, INPUT_KEYS, false);
    if (!input || input.schemaVersion !== INPUT_SCHEMA
        || input.operationId !== PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1) {
        throw new PatientOpenLoopsFollowUpProposalV1Error('invalid_input');
    }
}

function frozenValues(value: unknown): readonly unknown[] | null {
    try {
        if (!Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)
            || Object.getPrototypeOf(value) !== Array.prototype
            || value.length > PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_MAX_ITEMS_V1) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || keys[value.length] !== 'length') return null;
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (keys[index] !== String(index) || !descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return null;
            output.push(descriptor.value);
        }
        return output;
    } catch { return null; }
}

function parseReadResult(value: unknown): PatientOpenLoopsReadResultV1 {
    const result = exact(value, READ_RESULT_KEYS);
    if (!result || result.schemaVersion !== 'mediflow.patient.open_loops.read.result.v1'
        || result.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1
        || result.capabilityId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1 || result.outcome !== 'read'
        || typeof result.truncated !== 'boolean' || !integer(result.snapshotRevision, 1)) {
        throw new PatientOpenLoopsFollowUpProposalV1Error('read_unavailable');
    }
    const values = frozenValues(result.items);
    if (!values) throw new PatientOpenLoopsFollowUpProposalV1Error('read_unavailable');
    const seen = new Set<string>();
    for (const candidate of values) {
        const item = exact(candidate, READ_ITEM_KEYS);
        if (!item || !matches(LOOP_REF, item.loopRef) || seen.has(item.loopRef)
            || !['results_pending', 'series_stalled', 'registered_expectation'].includes(item.kind as string)
            || !['open', 'overdue', 'unscheduled'].includes(item.temporalState as string)
            || !integer(item.openedAt) || !(item.dueAt === null || integer(item.dueAt))
            || !integer(item.revision, 1)) throw new PatientOpenLoopsFollowUpProposalV1Error('read_unavailable');
        seen.add(item.loopRef);
    }
    const receipt = exact(result.receipt, READ_RECEIPT_KEYS);
    if (!receipt || receipt.schemaVersion !== 'mediflow.patient.open_loops.read.receipt.v1'
        || !matches(READ_RECEIPT_REF, receipt.receiptRef)
        || receipt.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1
        || receipt.capabilityId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1 || receipt.outcome !== 'read'
        || !matches(DIGEST, receipt.ownerRefHash) || !matches(DIGEST, receipt.leaseRefHash)
        || !matches(DIGEST, receipt.receiptRefHash) || !integer(receipt.generation, 1)
        || !integer(receipt.revocationGeneration) || !integer(receipt.selectionEpoch)
        || receipt.snapshotRevision !== result.snapshotRevision || receipt.itemCount !== values.length
        || receipt.truncated !== result.truncated || !integer(receipt.timestamp)) {
        throw new PatientOpenLoopsFollowUpProposalV1Error('read_unavailable');
    }
    return value as PatientOpenLoopsReadResultV1;
}

function parseSources(value: unknown): Sources {
    const source = exact(value, SOURCE_KEYS, false);
    if (!source || source.timeoutMs !== TIMEOUT_MS) {
        throw new PatientOpenLoopsFollowUpProposalV1Error('invalid_input');
    }
    for (const key of SOURCE_KEYS.slice(0, -1)) {
        if (typeof source[key] !== 'function' || types.isProxy(source[key])) {
            throw new PatientOpenLoopsFollowUpProposalV1Error('invalid_input');
        }
    }
    return source as Sources;
}

export function createPatientOpenLoopsFollowUpProposalServiceV1(sourcesValue: unknown) {
    const sources = parseSources(sourcesValue);
    const active = new Set<AbortController>();
    const issuedRefs = new Set<string>();
    const claim = record({ operation: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
        capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1 });
    let disposed = false;
    let lastNow = -1;

    const now = (): number => {
        let value: unknown;
        try { value = sources.now(); } catch { throw new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable'); }
        if (!integer(value) || value < lastNow) throw new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable');
        lastNow = value;
        return value;
    };
    const abortError = (signal: AbortSignal): PatientOpenLoopsFollowUpProposalV1Error =>
        new PatientOpenLoopsFollowUpProposalV1Error(signal.reason === 'timeout' ? 'timeout'
            : signal.reason === 'disposed' ? 'disposed' : 'cancelled');
    const fence = (controller: AbortController, startedAt: number): void => {
        if (!controller.signal.aborted && performance.now() - startedAt >= TIMEOUT_MS) controller.abort('timeout');
        if (controller.signal.aborted) throw abortError(controller.signal);
    };
    const awaitPort = async (value: unknown, controller: AbortController, startedAt: number,
        failure: PatientOpenLoopsFollowUpProposalV1ErrorCode): Promise<unknown> => {
        fence(controller, startedAt);
        if (!types.isPromise(value)) return value;
        const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener(
            'abort', () => reject(abortError(controller.signal)), { once: true }));
        try {
            const settled = await Promise.race([value, aborted]);
            fence(controller, startedAt);
            return settled;
        } catch (error) {
            if (controller.signal.aborted) throw abortError(controller.signal);
            if (error instanceof PatientOpenLoopsFollowUpProposalV1Error) throw error;
            throw new PatientOpenLoopsFollowUpProposalV1Error(failure);
        }
    };
    const writeDenialAudit = async (error: PatientOpenLoopsFollowUpProposalV1Error): Promise<void> => {
        const audit = record({ schemaVersion: 'mediflow.aip.audit.v1' as const,
            eventType: 'patient_open_loops_follow_up_proposal' as const, outcome: 'denied' as const,
            operation: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
            capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
            proposalRefHash: null, receiptRefHash: null, sourceReceiptRefHash: null,
            basedOnSnapshotRevision: null, itemCount: 0 as const, maximumStage: 'proposal_only' as const,
            reviewRequired: true as const, writesPerformed: 0 as const, apply: 'none' as const,
            egress: 'none' as const, timestamp: now(), denialCode: error.code });
        let result: unknown;
        try { result = sources.writeAudit(audit); } catch {
            throw new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable');
        }
        if (result === undefined) return;
        if (!types.isPromise(result)) throw new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable')), TIMEOUT_MS);
        });
        try { await Promise.race([result, deadline]); } catch {
            throw new PatientOpenLoopsFollowUpProposalV1Error('audit_unavailable');
        } finally { if (timer) clearTimeout(timer); }
    };

    const propose = async (permit: unknown, input: unknown) => {
        if (disposed) throw new PatientOpenLoopsFollowUpProposalV1Error('disposed');
        parseInput(input);
        if (!opaque(permit)) throw new PatientOpenLoopsFollowUpProposalV1Error('authorization_denied');
        const controller = new AbortController();
        const startedAt = performance.now();
        const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
        active.add(controller);
        const call = <T>(callback: () => T, failure: PatientOpenLoopsFollowUpProposalV1ErrorCode): T => {
            fence(controller, startedAt);
            try {
                const value = callback();
                fence(controller, startedAt);
                return value;
            } catch (error) {
                fence(controller, startedAt);
                if (error instanceof PatientOpenLoopsFollowUpProposalV1Error) throw error;
                throw new PatientOpenLoopsFollowUpProposalV1Error(failure);
            }
        };
        let execution: unknown;
        let began = false;
        try {
            let current = call(() => sources.current(), 'authorization_denied');
            execution = call(() => sources.beginPermit(permit, current, claim), 'authorization_denied');
            began = true;
            if (!opaque(execution)) throw new PatientOpenLoopsFollowUpProposalV1Error('authorization_denied');
            const raw = call(() => sources.readOpenLoops(controller.signal), 'read_unavailable');
            const read = parseReadResult(await awaitPort(raw, controller, startedAt, 'read_unavailable'));
            const proposalRef = call(() => sources.nextRef(), 'reference_invalid');
            const receiptRef = call(() => sources.nextRef(), 'reference_invalid');
            if (!matches(PROPOSAL_REF, proposalRef) || !matches(PROPOSAL_RECEIPT_REF, receiptRef)
                || issuedRefs.has(proposalRef) || issuedRefs.has(receiptRef)) {
                throw new PatientOpenLoopsFollowUpProposalV1Error('reference_invalid');
            }
            issuedRefs.add(proposalRef); issuedRefs.add(receiptRef);
            const proposalRefHash = call(() => sources.hashRef(proposalRef), 'reference_invalid');
            const receiptRefHash = call(() => sources.hashRef(receiptRef), 'reference_invalid');
            const sourceReceiptRefHash = call(() => sources.hashRef(read.receipt.receiptRef), 'reference_invalid');
            if (!matches(DIGEST, proposalRefHash) || !matches(DIGEST, receiptRefHash)
                || !matches(DIGEST, sourceReceiptRefHash)) {
                throw new PatientOpenLoopsFollowUpProposalV1Error('reference_invalid');
            }
            const timestamp = call(now, 'audit_unavailable');
            const items = Object.freeze(read.items.map((item) => record({ loopRef: item.loopRef,
                action: actionFor(item.kind) })));
            const receipt = record({ schemaVersion: RECEIPT_SCHEMA, receiptRef,
                operationId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                applicationServiceRef: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_APPLICATION_SERVICE_V1,
                outcome: 'proposed' as const, proposalRefHash, receiptRefHash, sourceReceiptRefHash,
                basedOnSnapshotRevision: read.snapshotRevision, itemCount: items.length, truncated: read.truncated,
                maximumStage: 'proposal_only' as const, reviewRequired: true as const, writesPerformed: 0 as const,
                apply: 'none' as const, egress: 'none' as const, timestamp });
            const output = record({ schemaVersion: OUTPUT_SCHEMA,
                operationId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                applicationServiceRef: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_APPLICATION_SERVICE_V1,
                outcome: 'proposed' as const, maximumStage: 'proposal_only' as const,
                reviewRequired: true as const, writesPerformed: 0 as const, apply: 'none' as const,
                proposalRef, basedOnSnapshotRevision: read.snapshotRevision, items, receipt });
            const audit = record({ schemaVersion: 'mediflow.aip.audit.v1' as const,
                eventType: 'patient_open_loops_follow_up_proposal' as const, outcome: 'allowed' as const,
                operation: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_FOLLOW_UP_PROPOSAL_OPERATION_V1,
                proposalRefHash, receiptRefHash, sourceReceiptRefHash,
                basedOnSnapshotRevision: read.snapshotRevision, itemCount: items.length,
                maximumStage: 'proposal_only' as const, reviewRequired: true as const,
                writesPerformed: 0 as const, apply: 'none' as const, egress: 'none' as const,
                timestamp, denialCode: null });
            const auditResult = call(() => sources.writeAudit(audit), 'audit_unavailable');
            await awaitPort(auditResult, controller, startedAt, 'audit_unavailable');
            current = call(() => sources.current(), 'authorization_denied');
            const finalized = call(() => sources.finalizePermit(execution, current, claim), 'authorization_denied');
            if (finalized !== true) throw new PatientOpenLoopsFollowUpProposalV1Error('authorization_denied');
            return output;
        } catch (error) {
            if (began) {
                try { sources.denyPermit(execution); } catch { /* terminal best effort */ }
            }
            const publicError = error instanceof PatientOpenLoopsFollowUpProposalV1Error
                ? error : new PatientOpenLoopsFollowUpProposalV1Error('read_unavailable');
            await writeDenialAudit(publicError);
            throw publicError;
        } finally {
            clearTimeout(timer);
            active.delete(controller);
        }
    };

    const cancel = (): void => { for (const controller of active) controller.abort('cancelled'); };
    const dispose = (): void => { disposed = true; for (const controller of active) controller.abort('disposed'); };
    return Object.freeze({ propose, cancel, dispose });
}
