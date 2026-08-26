/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { composeDocumentSynthesisProviderProjection } from './document-synthesis-source-set-contract';
import {
    isServerSessionProjectionOwner,
    type DocumentSynthesisLeaseCommitPort,
    type ServerSessionProjectionOwner,
} from '../../security/server-session-projection-owner';

type Source = Readonly<{ label: string; documentSourceRef: string; documentRevision: bigint; documentFreshnessEpoch: bigint }>;
export type DocumentSynthesisSourceSetCurrentness = Readonly<{
    sourceSetEpoch: bigint;
    revocationGeneration: bigint;
    sources: readonly Source[];
}>;

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectIsFrozen = Object.isFrozen;
const ReflectOwnKeys = Reflect.ownKeys;
const ArrayIsArray = Array.isArray;
const IsProxy = types.isProxy;
const NumberIsSafeInteger = Number.isSafeInteger;
const MAX_U64 = BigInt('18446744073709551615');

export class DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError extends Error {
    constructor() {
        super('Document synthesis source-set currentness owner configuration rejected');
        this.name = 'DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError';
    }
}

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    for (const key of ReflectOwnKeys(value)) if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    return ObjectFreeze(output);
}

function record(value: unknown, keys: readonly string[], prototype: object | null): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== prototype) return null;
        const found = ReflectOwnKeys(value);
        if (found.length !== keys.length) return null;
        const copy: Record<string, unknown> = ObjectCreate(null);
        for (const key of keys) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function sourceList(value: unknown): readonly Source[] | null {
    try {
        if (!ArrayIsArray(value) || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== ARRAY) return null;
        const length = ObjectGetOwnPropertyDescriptor(value, 'length');
        if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value) || length.value < 1 || length.value > 32) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== length.value + 2 || !ObjectGetOwnPropertyDescriptor(value, 'toJSON')) return null;
        const output: Source[] = [];
        for (let index = 0; index < length.value; index += 1) {
            const item = ObjectGetOwnPropertyDescriptor(value, String(index));
            const source = item && item.enumerable && ObjectHasOwn(item, 'value')
                ? record(item.value, ['label', 'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceText', 'sourceByteLength', 'projectionDigestSha256'], null)
                : null;
            if (!source || typeof source.label !== 'string' || typeof source.documentSourceRef !== 'string'
                || typeof source.documentRevision !== 'bigint' || typeof source.documentFreshnessEpoch !== 'bigint'
                || source.documentRevision < BigInt(0) || source.documentRevision > MAX_U64
                || source.documentFreshnessEpoch < BigInt(0) || source.documentFreshnessEpoch > MAX_U64) return null;
            output[index] = sealed({ label: source.label, documentSourceRef: source.documentSourceRef,
                documentRevision: source.documentRevision, documentFreshnessEpoch: source.documentFreshnessEpoch }) as Source;
        }
        return ObjectFreeze(output);
    } catch { return null; }
}

function capture(value: unknown): DocumentSynthesisSourceSetCurrentness | null {
    try {
        if (!composeDocumentSynthesisProviderProjection(value)) return null;
        const input = record(value, ['sourceSetEpoch', 'revocationGeneration', 'sources', 'digestPayloadBytes', 'sourceSetDigestSha256'], null);
        if (!input || typeof input.sourceSetEpoch !== 'bigint' || typeof input.revocationGeneration !== 'bigint'
            || input.sourceSetEpoch < BigInt(0) || input.sourceSetEpoch > MAX_U64
            || input.revocationGeneration < BigInt(0) || input.revocationGeneration > MAX_U64) return null;
        const sources = sourceList(input.sources);
        return sources ? sealed({ sourceSetEpoch: input.sourceSetEpoch, revocationGeneration: input.revocationGeneration, sources }) as DocumentSynthesisSourceSetCurrentness : null;
    } catch { return null; }
}

function configuration(value: unknown): Readonly<{ owner: ServerSessionProjectionOwner; session: unknown; sourceSet: unknown }> | null {
    const input = record(value, ['owner', 'session', 'sourceSet'], OBJECT);
    if (!input || IsProxy(input.session) || !isServerSessionProjectionOwner(input.owner)) return null;
    return sealed({ owner: input.owner, session: input.session, sourceSet: input.sourceSet });
}

/**
 * Owns one C3c2 source-set currentness lineage inside the same host process.
 * Its caller can only advance with a newly authentic source-set; it cannot
 * inject source fields, epochs, clocks, revocation callbacks, or a DS port.
 */
export function createDocumentSynthesisSourceSetCurrentnessOwner(value: unknown): Readonly<{
    snapshot(): DocumentSynthesisSourceSetCurrentness | null;
    transition(sourceSet: unknown): boolean;
    revoke(): void;
    dispose(): void;
}> {
    const input = configuration(value);
    const initial = input && capture(input.sourceSet);
    if (!input || !initial) throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError();

    let port: DocumentSynthesisLeaseCommitPort;
    try { port = input.owner.mintDocumentSynthesisLeaseCommitPort(input.session as Parameters<ServerSessionProjectionOwner['mintDocumentSynthesisLeaseCommitPort']>[0]); }
    catch { throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError(); }
    let current = initial;
    let lineage = new Map<string, Source>();
    let terminal = false;
    let active = false;
    let reentered = false;

    const preservesLineage = (next: DocumentSynthesisSourceSetCurrentness): boolean => {
        const nextLineage = new Map(lineage);
        for (const source of next.sources) {
            const previous = nextLineage.get(source.documentSourceRef);
            if (previous && (source.documentRevision < previous.documentRevision || source.documentFreshnessEpoch < previous.documentFreshnessEpoch)) return false;
            nextLineage.set(source.documentSourceRef, source);
        }
        lineage = nextLineage;
        return true;
    };
    if (!preservesLineage(initial)) throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError();

    const live = (): boolean => {
        if (terminal || active) { reentered = active; return false; }
        active = true;
        try {
            const snapshot = port.snapshot();
            if (!snapshot || reentered) { terminal = true; return false; }
            return true;
        } finally { active = false; }
    };

    return sealed({
        snapshot() {
            if (!live()) return null;
            return sealed({ sourceSetEpoch: current.sourceSetEpoch, revocationGeneration: current.revocationGeneration, sources: current.sources }) as DocumentSynthesisSourceSetCurrentness;
        },
        transition(sourceSet: unknown) {
            if (!live()) return false;
            const next = capture(sourceSet);
            if (!next || next.sourceSetEpoch <= current.sourceSetEpoch || next.revocationGeneration < current.revocationGeneration || !preservesLineage(next)) {
                terminal = true;
                return false;
            }
            current = next;
            return true;
        },
        revoke() { terminal = true; port.dispose(); },
        dispose() { terminal = true; port.dispose(); },
    });
}
