/* @Codex */
import { types } from 'node:util';

const apply = Reflect.apply;
const ownKeys = Reflect.ownKeys;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectIsFrozen = Object.isFrozen;
const objectPrototype = Object.prototype;
const regexpTest = RegExp.prototype.test;
const numberIsSafeInteger = Number.isSafeInteger;
const DateConstructor = Date;
const dateToISOString = Date.prototype.toISOString;

export const CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA = 'mediflow.headless.soap-entry-commit-receipt.v1' as const;
export const CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1' as const;
export const CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME = 'entry_committed' as const;
export const CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-receipt-digest.v1' as const;
export const CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS = objectFreeze([
    'schema', 'receiptRef', 'operationId', 'outcome', 'commandId', 'entryRef', 'auditEventRef',
    'patientVersion', 'entryVersion', 'committedAt', 'bindingDigest', 'entryDigest', 'auditDigest',
] as const);

export type ClinicianSoapEntryCommitReceiptV1 = Readonly<{
    schema: typeof CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA;
    receiptRef: string;
    operationId: typeof CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID;
    outcome: typeof CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME;
    commandId: string;
    entryRef: string;
    auditEventRef: string;
    patientVersion: number;
    entryVersion: 1;
    committedAt: string;
    bindingDigest: string;
    entryDigest: string;
    auditDigest: string;
}>;

const RECEIPT_REF = /^hser_[0-9a-f]{64}$/u;
const COMMAND_ID = /^hsac_[0-9a-f]{64}$/u;
const ENTRY_REF = /^hsei_[0-9a-f]{64}$/u;
const AUDIT_REF = /^hsea_[0-9a-f]{64}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const isProxy = types.isProxy;

function record<T extends object>(source: T): Readonly<T> {
    const output = objectCreate(null) as Record<PropertyKey, unknown>;
    const keys = apply(ownKeys, Reflect, [source]);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        output[key] = (source as Record<PropertyKey, unknown>)[key];
    }
    return apply(objectFreeze, Object, [output]) as Readonly<T>;
}

function exactData(value: unknown): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)) return null;
        const prototype = apply(objectGetPrototypeOf, Object, [value]);
        if (prototype !== null && prototype !== objectPrototype) return null;
        const frozenNullPrototype = prototype === null;
        if (frozenNullPrototype && !apply(objectIsFrozen, Object, [value])) return null;
        const keys = apply(ownKeys, Reflect, [value]);
        if (keys.length !== CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS.length) return null;
        const descriptors = apply(objectGetOwnPropertyDescriptors, Object, [value]);
        const output = objectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS.length; index += 1) {
            const key = CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS[index]!;
            const descriptor = descriptors[key];
            if (keys[index] !== key || !descriptor || !descriptor.enumerable || !('value' in descriptor)
                || (frozenNullPrototype && (descriptor.writable || descriptor.configurable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && apply(regexpTest, pattern, [value]);
}

function canonicalTimestamp(value: unknown): value is string {
    if (!matches(value, ISO_SECONDS)) return false;
    try { return apply(dateToISOString, new DateConstructor(value), []) === value; } catch { return false; }
}

/** Copies one exact H7b receipt into its frozen, null-prototype shared snapshot. */
export function snapshotClinicianSoapEntryCommitReceipt(value: unknown): ClinicianSoapEntryCommitReceiptV1 | null {
    const source = exactData(value);
    if (!source || source.schema !== CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA
        || !matches(source.receiptRef, RECEIPT_REF)
        || source.operationId !== CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID
        || source.outcome !== CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME
        || !matches(source.commandId, COMMAND_ID) || !matches(source.entryRef, ENTRY_REF)
        || !matches(source.auditEventRef, AUDIT_REF) || !apply(numberIsSafeInteger, Number, [source.patientVersion])
        || (source.patientVersion as number) < 1 || source.entryVersion !== 1
        || !canonicalTimestamp(source.committedAt) || !matches(source.bindingDigest, HASH)
        || !matches(source.entryDigest, HASH) || !matches(source.auditDigest, HASH)) return null;
    return record({
        schema: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA,
        receiptRef: source.receiptRef,
        operationId: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID,
        outcome: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME,
        commandId: source.commandId,
        entryRef: source.entryRef,
        auditEventRef: source.auditEventRef,
        patientVersion: source.patientVersion,
        entryVersion: 1,
        committedAt: source.committedAt,
        bindingDigest: source.bindingDigest,
        entryDigest: source.entryDigest,
        auditDigest: source.auditDigest,
    }) as ClinicianSoapEntryCommitReceiptV1;
}
