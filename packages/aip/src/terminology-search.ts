/* @Codex */

import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

import {
    searchStaticTerminology,
    type TerminologyItem,
    type TerminologySystemCode,
} from '../../../lib/terminology.ts';
import {
    AIP_TERMINOLOGY_SEARCH_CONTRACT_V1,
    APPLICATION_SERVICE,
    AipTerminologySearchV1Error,
    type AipTerminologySearchV1ErrorCode,
    type CatalogRequest,
    OPERATION_ID,
    OUTPUT_SCHEMA,
    type ParsedInput,
    RECEIPT_SCHEMA,
    encoder,
    exactValues,
    parseCatalogItems,
    parseInput,
    record,
} from './terminology-search-contract.ts';

export {
    AIP_TERMINOLOGY_SEARCH_CONTRACT_V1,
    AipTerminologySearchV1Error,
} from './terminology-search-contract.ts';
export type { AipTerminologySearchV1ErrorCode } from './terminology-search-contract.ts';

const SOURCE_KEYS = ['now', 'nextReceiptRef', 'current', 'beginPermit', 'finalizePermit', 'denyPermit',
    'searchCatalog', 'writeAudit'] as const;
const LOCAL_SOURCE_KEYS = ['now', 'nextReceiptRef', 'current', 'beginPermit', 'finalizePermit', 'denyPermit',
    'writeAudit'] as const;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
type Sources = Readonly<{
    now: () => unknown;
    nextReceiptRef: () => unknown;
    current: () => unknown;
    beginPermit: (permit: unknown, current: unknown, claim: unknown) => unknown;
    finalizePermit: (execution: unknown, current: unknown, claim: unknown) => unknown;
    denyPermit: (execution: unknown) => unknown;
    searchCatalog: (request: CatalogRequest, signal: AbortSignal) => unknown;
    writeAudit: (record: unknown) => unknown;
}>;

function parseSources(value: unknown, keys: readonly string[]): unknown[] {
    const values = exactValues(value, keys, 'input_invalid');
    if (values.some((item) => typeof item !== 'function' || types.isProxy(item))) {
        throw new AipTerminologySearchV1Error('input_invalid');
    }
    return values;
}

function buildService(sources: Sources) {
    let disposed = false;
    let lastNow = -1;
    const active = new Set<AbortController>();
    const issuedReceiptRefs = new Set<string>();
    const claim = record({ operation: OPERATION_ID, capabilityId: OPERATION_ID });
    const now = (): number => {
        let value: unknown;
        try { value = sources.now(); } catch { throw new AipTerminologySearchV1Error('clock_invalid'); }
        if (!Number.isSafeInteger(value) || (value as number) < lastNow) throw new AipTerminologySearchV1Error('clock_invalid');
        lastNow = value as number;
        return value as number;
    };
    const abortFailure = (signal: AbortSignal): AipTerminologySearchV1Error => new AipTerminologySearchV1Error(
        signal.reason === 'timeout' ? 'timeout' : signal.reason === 'disposed' ? 'disposed' : 'cancelled');
    const wait = async (value: Promise<unknown>, signal: AbortSignal,
        code: AipTerminologySearchV1ErrorCode): Promise<unknown> => {
        if (signal.aborted) throw abortFailure(signal);
        const aborted = new Promise<never>((_resolve, reject) => signal.addEventListener(
            'abort', () => reject(abortFailure(signal)), { once: true }));
        try {
            const result = await Promise.race([value, aborted]);
            if (signal.aborted) throw abortFailure(signal);
            return result;
        } catch {
            if (signal.aborted) throw abortFailure(signal);
            throw new AipTerminologySearchV1Error(code);
        }
    };
    const writeDenialAudit = async (input: ParsedInput, error: AipTerminologySearchV1Error): Promise<void> => {
        let timestamp: number;
        try { timestamp = now(); } catch { throw new AipTerminologySearchV1Error('audit_failed'); }
        const denial = record({ schemaVersion: 'mediflow.aip.audit.v1' as const,
            eventType: 'terminology_search' as const, outcome: 'denied' as const, operation: OPERATION_ID,
            capabilityId: OPERATION_ID, receiptRef: null, system: input.system, resultCount: 0 as const,
            maxStage: 'read_only' as const, egress: 'none' as const, writesPerformed: 0 as const,
            timestamp, denialCode: error.code });
        let result: unknown;
        try { result = sources.writeAudit(denial); } catch { throw new AipTerminologySearchV1Error('audit_failed'); }
        if (result === undefined) return;
        if (!types.isPromise(result)) throw new AipTerminologySearchV1Error('audit_failed');
        let auditTimer: ReturnType<typeof setTimeout> | undefined;
        const auditTimeout = new Promise<never>((_resolve, reject) => {
            auditTimer = setTimeout(() => reject(new AipTerminologySearchV1Error('audit_failed')),
                AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.timeoutMs);
        });
        try { await Promise.race([result, auditTimeout]); }
        catch { throw new AipTerminologySearchV1Error('audit_failed'); }
        finally { if (auditTimer) clearTimeout(auditTimer); }
    };
    const execute = async (permit: unknown, inputValue: unknown) => {
        if (disposed) throw new AipTerminologySearchV1Error('disposed');
        const input = parseInput(inputValue);
        if (!permit || typeof permit !== 'object' || types.isProxy(permit) || Array.isArray(permit)
            || types.isPromise(permit)) throw new AipTerminologySearchV1Error('authorization_denied');
        let permitPrototype: object | null;
        let permitKeys: (string | symbol)[];
        try { permitPrototype = Object.getPrototypeOf(permit); permitKeys = Reflect.ownKeys(permit); }
        catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
        if (permitPrototype !== null || permitKeys.length !== 0) {
            throw new AipTerminologySearchV1Error('authorization_denied');
        }
        const controller = new AbortController();
        active.add(controller);
        const startedAt = performance.now();
        const timer = setTimeout(() => controller.abort('timeout'), AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.timeoutMs);
        const fence = (): void => {
            if (!controller.signal.aborted
                && performance.now() - startedAt >= AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.timeoutMs) {
                controller.abort('timeout');
            }
            if (controller.signal.aborted) throw abortFailure(controller.signal);
        };
        let execution: unknown;
        let began = false;
        try {
            let current: unknown;
            try { current = sources.current(); } catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            fence();
            try { execution = sources.beginPermit(permit, current, claim); }
            catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            began = true;
            fence();
            if (!execution || typeof execution !== 'object' || types.isProxy(execution)
                || Array.isArray(execution) || types.isPromise(execution)) {
                throw new AipTerminologySearchV1Error('authorization_denied');
            }
            let raw: unknown;
            try { raw = sources.searchCatalog(input, controller.signal); } catch {
                throw new AipTerminologySearchV1Error('catalog_invalid');
            }
            fence();
            const settled = types.isPromise(raw)
                ? await wait(raw as Promise<unknown>, controller.signal, 'catalog_invalid') : raw;
            const items = parseCatalogItems(settled, input);
            let receiptRef: unknown;
            try { receiptRef = sources.nextReceiptRef(); } catch { throw new AipTerminologySearchV1Error('reference_invalid'); }
            fence();
            if (typeof receiptRef !== 'string' || !REF.test(receiptRef) || issuedReceiptRefs.has(receiptRef)) {
                throw new AipTerminologySearchV1Error('reference_invalid');
            }
            issuedReceiptRefs.add(receiptRef);
            const timestamp = now();
            fence();
            const receipt = record({ schemaVersion: RECEIPT_SCHEMA, receiptRef, operationId: OPERATION_ID,
                capabilityId: OPERATION_ID, outcome: 'read' as const, system: input.system, resultCount: items.length,
                catalogSource: 'local-pilot-catalog' as const, egress: 'none' as const, writesPerformed: 0 as const,
                fabricDependency: 'none' as const, timestamp });
            const audit = record({ schemaVersion: 'mediflow.aip.audit.v1' as const, eventType: 'terminology_search' as const,
                outcome: 'allowed' as const, operation: OPERATION_ID, capabilityId: OPERATION_ID, receiptRef,
                system: input.system, resultCount: items.length, maxStage: 'read_only' as const, egress: 'none' as const,
                writesPerformed: 0 as const, timestamp, denialCode: null });
            let auditResult: unknown;
            try { auditResult = sources.writeAudit(audit); } catch { throw new AipTerminologySearchV1Error('audit_failed'); }
            fence();
            if (auditResult !== undefined && !types.isPromise(auditResult)) throw new AipTerminologySearchV1Error('audit_failed');
            if (types.isPromise(auditResult)) {
                await wait(auditResult as Promise<unknown>, controller.signal, 'audit_failed');
            }
            fence();
            const output = record({ schemaVersion: OUTPUT_SCHEMA, operationId: OPERATION_ID,
                capabilityId: OPERATION_ID, applicationServiceRef: APPLICATION_SERVICE, outcome: 'read' as const,
                items, receipt });
            if (encoder.encode(JSON.stringify(output)).byteLength > AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.outputMaxBytes) {
                throw new AipTerminologySearchV1Error('catalog_invalid');
            }
            try { current = sources.current(); } catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            fence();
            let finalized: unknown;
            try { finalized = sources.finalizePermit(execution, current, claim); }
            catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            if (finalized !== true) throw new AipTerminologySearchV1Error('authorization_denied');
            fence();
            return output;
        } catch (error) {
            if (began) {
                try { sources.denyPermit(execution); } catch { /* terminal best effort; broker reservation remains closed */ }
            }
            const publicError = error instanceof AipTerminologySearchV1Error
                ? error : new AipTerminologySearchV1Error('catalog_invalid');
            await writeDenialAudit(input, publicError);
            throw publicError;
        } finally {
            clearTimeout(timer);
            active.delete(controller);
        }
    };
    const cancel = (): void => { for (const controller of active) controller.abort('cancelled'); };
    const dispose = (): void => { disposed = true; for (const controller of active) controller.abort('disposed'); };
    return Object.freeze({ execute, cancel, dispose });
}

export function createAipTerminologySearchServiceV1(sourcesValue: unknown) {
    const [now, nextReceiptRef, current, beginPermit, finalizePermit, denyPermit, searchCatalog, writeAudit]
        = parseSources(sourcesValue, SOURCE_KEYS);
    return buildService({ now, nextReceiptRef, current, beginPermit, finalizePermit, denyPermit,
        searchCatalog, writeAudit } as Sources);
}

export function createLocalAipTerminologySearchServiceV1(sourcesValue: unknown) {
    const [now, nextReceiptRef, current, beginPermit, finalizePermit, denyPermit, writeAudit]
        = parseSources(sourcesValue, LOCAL_SOURCE_KEYS);
    const searchCatalog = (request: CatalogRequest): TerminologyItem[] => searchStaticTerminology(
        request.system as TerminologySystemCode, request.query, request.limit);
    return buildService({ now, nextReceiptRef, current, beginPermit, finalizePermit, denyPermit,
        searchCatalog, writeAudit } as Sources);
}
