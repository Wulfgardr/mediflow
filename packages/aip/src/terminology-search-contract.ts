/* @Codex */

import { types } from 'node:util';

export const OPERATION_ID = 'mediflow.terminology.search.v1' as const;
export const INPUT_SCHEMA = 'mediflow.terminology.search.input.v1' as const;
export const OUTPUT_SCHEMA = 'mediflow.terminology.search.output.v1' as const;
export const RECEIPT_SCHEMA = 'mediflow.terminology.search.receipt.v1' as const;
export const APPLICATION_SERVICE = 'AipTerminologySearchServiceV1' as const;
const INPUT_KEYS = ['schemaVersion', 'operationId', 'system', 'query', 'limit'] as const;
const ITEM_KEYS = ['system', 'code', 'display', 'displayIt', 'defaultUnit', 'version', 'source'] as const;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
export const encoder = new TextEncoder();

export function record<T extends object>(value: T): Readonly<T> {
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
    limitPolicy: record({ queryMaxBytes: 96, resultLimitMax: 10, outputMaxBytes: 16 * 1024, timeoutMs: 250,
        timeoutMode: 'cooperative_pending_promise_and_post_callback_fence' as const }),
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

export type ParsedInput = Readonly<{ system: 'LOINC' | 'UCUM'; query: string; limit: number }>;
export type CatalogRequest = Readonly<ParsedInput>;

export function exactValues(value: unknown, keys: readonly string[], code: AipTerminologySearchV1ErrorCode): unknown[] {
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

export function parseInput(value: unknown): ParsedInput {
    const [schemaVersion, operationId, system, rawQuery, limit] = exactValues(value, INPUT_KEYS, 'input_invalid');
    if (schemaVersion !== INPUT_SCHEMA || operationId !== OPERATION_ID || (system !== 'LOINC' && system !== 'UCUM')
        || typeof rawQuery !== 'string' || CONTROL.test(rawQuery) || UNPAIRED_SURROGATE.test(rawQuery)
        || !Number.isSafeInteger(limit) || (limit as number) < 1
        || (limit as number) > AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.resultLimitMax) {
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

export function parseCatalogItems(value: unknown, request: ParsedInput): readonly Readonly<{
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
