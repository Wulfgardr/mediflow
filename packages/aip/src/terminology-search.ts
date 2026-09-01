/* @Codex */

import { types } from 'node:util';

import {
    searchStaticTerminology,
    type TerminologyItem,
    type TerminologySystemCode,
} from '../../../lib/terminology.ts';

const OPERATION_ID = 'mediflow.terminology.search.v1' as const;
const INPUT_SCHEMA = 'mediflow.terminology.search.input.v1' as const;
const OUTPUT_SCHEMA = 'mediflow.terminology.search.output.v1' as const;
const RECEIPT_SCHEMA = 'mediflow.terminology.search.receipt.v1' as const;
const APPLICATION_SERVICE = 'AipTerminologySearchServiceV1' as const;
const SOURCE_KEYS = ['now', 'nextReceiptRef', 'current', 'consumePermit', 'searchCatalog', 'writeAudit'] as const;
const LOCAL_SOURCE_KEYS = ['now', 'nextReceiptRef', 'current', 'consumePermit', 'writeAudit'] as const;
const INPUT_KEYS = ['schemaVersion', 'operationId', 'system', 'query', 'limit'] as const;
const ITEM_KEYS = ['system', 'code', 'display', 'displayIt', 'defaultUnit', 'version', 'source'] as const;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const encoder = new TextEncoder();

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function list<T>(values: readonly T[]): readonly T[] {
    const output = Array.from(values);
    Object.setPrototypeOf(output, null);
    return Object.freeze(output);
}

export const AIP_TERMINOLOGY_SEARCH_CONTRACT_V1 = record({
    operationId: OPERATION_ID,
    capabilityId: OPERATION_ID,
    applicationServiceRef: APPLICATION_SERVICE,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    maximumStage: 'read_only' as const,
    authorityPolicy: 'aip_owner_lease_permit.v1' as const,
    sessionPolicy: 'aip_child_owner_process_bound.v1' as const,
    casPolicy: 'not_applicable_read_only' as const,
    idempotencyPolicy: 'deterministic_local_catalog_read.v1' as const,
    limitPolicy: record({ queryMaxBytes: 96, resultLimitMax: 10, outputMaxBytes: 16 * 1024, timeoutMs: 250 }),
    receiptPolicy: RECEIPT_SCHEMA,
    fabricDependency: 'none' as const,
});

export type AipTerminologySearchV1ErrorCode = 'input_invalid' | 'authorization_denied' | 'catalog_invalid'
    | 'timeout' | 'cancelled' | 'disposed' | 'reference_invalid' | 'clock_invalid' | 'audit_failed';
export class AipTerminologySearchV1Error extends Error {
    constructor(public readonly code: AipTerminologySearchV1ErrorCode) {
        super(`AIP terminology search rejected: ${code}`);
        this.name = 'AipTerminologySearchV1Error';
    }
}

type ParsedInput = Readonly<{ system: 'LOINC' | 'UCUM'; query: string; limit: number }>;
type CatalogRequest = Readonly<ParsedInput>;
type Sources = Readonly<{
    now: () => unknown;
    nextReceiptRef: () => unknown;
    current: () => unknown;
    consumePermit: (permit: unknown, current: unknown, claim: unknown) => unknown;
    searchCatalog: (request: CatalogRequest, signal: AbortSignal) => unknown;
    writeAudit: (record: unknown) => unknown;
}>;

function exactValues(value: unknown, keys: readonly string[], code: AipTerminologySearchV1ErrorCode): unknown[] {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || types.isPromise(value)) {
        throw new AipTerminologySearchV1Error(code);
    }
    let prototype: object | null;
    let ownKeys: (string | symbol)[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    } catch { throw new AipTerminologySearchV1Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
        throw new AipTerminologySearchV1Error(code);
    }
    return keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new AipTerminologySearchV1Error(code);
        }
        return descriptor.value;
    });
}

function parseInput(value: unknown): ParsedInput {
    const [schemaVersion, operationId, system, rawQuery, limit] = exactValues(value, INPUT_KEYS, 'input_invalid');
    if (schemaVersion !== INPUT_SCHEMA || operationId !== OPERATION_ID || (system !== 'LOINC' && system !== 'UCUM')
        || typeof rawQuery !== 'string' || CONTROL.test(rawQuery) || UNPAIRED_SURROGATE.test(rawQuery)
        || !Number.isSafeInteger(limit)
        || (limit as number) < 1 || (limit as number) > AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.resultLimitMax) {
        throw new AipTerminologySearchV1Error('input_invalid');
    }
    const query = rawQuery.trim().replace(/\s+/gu, ' ');
    const bytes = encoder.encode(query).byteLength;
    if (bytes < 1 || bytes > AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.queryMaxBytes) {
        throw new AipTerminologySearchV1Error('input_invalid');
    }
    return record({ system, query, limit: limit as number });
}

function safeText(value: unknown, maxBytes: number): value is string {
    return typeof value === 'string' && value.length > 0 && !CONTROL.test(value)
        && encoder.encode(value).byteLength <= maxBytes;
}

function parseCatalogItems(value: unknown, request: ParsedInput): readonly Readonly<{
    system: 'LOINC' | 'UCUM'; code: string; display: string; displayIt?: string; defaultUnit?: string;
    version: string | null;
}>[] {
    if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value)
        || value.length > request.limit) throw new AipTerminologySearchV1Error('catalog_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== 'length'
        && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key)))) {
        throw new AipTerminologySearchV1Error('catalog_invalid');
    }
    const output: Array<Readonly<{ system: 'LOINC' | 'UCUM'; code: string; display: string;
        displayIt?: string; defaultUnit?: string; version: string | null }>> = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const slot = descriptors[String(index)];
        if (!slot || !slot.enumerable || !('value' in slot)) throw new AipTerminologySearchV1Error('catalog_invalid');
        const [system, code, display, displayIt, defaultUnit, version, source] = exactValues(
            slot.value, ITEM_KEYS, 'catalog_invalid');
        if (system !== request.system || !safeText(code, 64) || !safeText(display, 256)
            || (displayIt !== undefined && !safeText(displayIt, 256))
            || (defaultUnit !== undefined && !safeText(defaultUnit, 64))
            || (version !== null && !safeText(version, 32)) || source !== 'local-pilot-catalog'
            || seen.has(code)) throw new AipTerminologySearchV1Error('catalog_invalid');
        seen.add(code);
        output.push(record({ system: request.system, code, display, ...(displayIt ? { displayIt } : {}),
            ...(defaultUnit ? { defaultUnit } : {}), version }));
    }
    return list(output);
}

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
    const startedPermits = new WeakSet<object>();
    const issuedReceiptRefs = new Set<string>();
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
    const execute = async (permit: unknown, inputValue: unknown) => {
        if (disposed) throw new AipTerminologySearchV1Error('disposed');
        const input = parseInput(inputValue);
        if (!permit || typeof permit !== 'object' || types.isProxy(permit) || Array.isArray(permit)
            || types.isPromise(permit)) throw new AipTerminologySearchV1Error('authorization_denied');
        let permitPrototype: object | null;
        let permitKeys: (string | symbol)[];
        try { permitPrototype = Object.getPrototypeOf(permit); permitKeys = Reflect.ownKeys(permit); }
        catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
        if (permitPrototype !== null || permitKeys.length !== 0 || startedPermits.has(permit)) {
            throw new AipTerminologySearchV1Error('authorization_denied');
        }
        startedPermits.add(permit);
        const controller = new AbortController();
        active.add(controller);
        const timer = setTimeout(() => controller.abort('timeout'), AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.timeoutMs);
        try {
            let raw: unknown;
            try { raw = sources.searchCatalog(input, controller.signal); } catch {
                throw new AipTerminologySearchV1Error('catalog_invalid');
            }
            if (controller.signal.aborted) throw abortFailure(controller.signal);
            const settled = types.isPromise(raw)
                ? await wait(raw as Promise<unknown>, controller.signal, 'catalog_invalid') : raw;
            const items = parseCatalogItems(settled, input);
            let current: unknown;
            try { current = sources.current(); } catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            let consumed: unknown;
            try { consumed = sources.consumePermit(permit, current, record({ operation: OPERATION_ID, capabilityId: OPERATION_ID })); }
            catch { throw new AipTerminologySearchV1Error('authorization_denied'); }
            if (consumed !== true) throw new AipTerminologySearchV1Error('authorization_denied');
            let receiptRef: unknown;
            try { receiptRef = sources.nextReceiptRef(); } catch { throw new AipTerminologySearchV1Error('reference_invalid'); }
            if (typeof receiptRef !== 'string' || !REF.test(receiptRef) || issuedReceiptRefs.has(receiptRef)) {
                throw new AipTerminologySearchV1Error('reference_invalid');
            }
            issuedReceiptRefs.add(receiptRef);
            const timestamp = now();
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
            if (auditResult !== undefined && !types.isPromise(auditResult)) throw new AipTerminologySearchV1Error('audit_failed');
            if (types.isPromise(auditResult)) {
                await wait(auditResult as Promise<unknown>, controller.signal, 'audit_failed');
            }
            const output = record({ schemaVersion: OUTPUT_SCHEMA, operationId: OPERATION_ID,
                capabilityId: OPERATION_ID, applicationServiceRef: APPLICATION_SERVICE, outcome: 'read' as const,
                items, receipt });
            if (encoder.encode(JSON.stringify(output)).byteLength > AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.outputMaxBytes) {
                throw new AipTerminologySearchV1Error('catalog_invalid');
            }
            return output;
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
    const [now, nextReceiptRef, current, consumePermit, searchCatalog, writeAudit] = parseSources(sourcesValue, SOURCE_KEYS);
    return buildService({ now, nextReceiptRef, current, consumePermit, searchCatalog, writeAudit } as Sources);
}

export function createLocalAipTerminologySearchServiceV1(sourcesValue: unknown) {
    const [now, nextReceiptRef, current, consumePermit, writeAudit] = parseSources(sourcesValue, LOCAL_SOURCE_KEYS);
    const searchCatalog = (request: CatalogRequest): TerminologyItem[] => searchStaticTerminology(
        request.system as TerminologySystemCode, request.query, request.limit);
    return buildService({ now, nextReceiptRef, current, consumePermit, searchCatalog, writeAudit } as Sources);
}
