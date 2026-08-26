/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { buildDocumentSynthesisMultiSourcePrompt } from './document-synthesis-multi-source-prompt';
import { bindDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope-binding';
import { type DocumentSynthesisClaimCitationsResult } from './document-synthesis-claim-citations';
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
type Capsule = Readonly<{ snapshot(): DocumentSynthesisSourceSetCurrentness | null; transition(sourceSet: unknown): boolean; revoke(): void; dispose(): void }>;
export type DocumentSynthesisSourceSetCurrentnessAccessor = Readonly<{ snapshot(): DocumentSynthesisSourceSetCurrentness | null }>;
export type DocumentSynthesisSourceSetValidationToken = Readonly<Record<never, never>>;
export type DocumentSynthesisSourceSetExecutionInput = Readonly<{ currentness: DocumentSynthesisSourceSetCurrentness; prompt: string; validationToken: DocumentSynthesisSourceSetValidationToken }>;
export type DocumentSynthesisSourceSetExecutionInputAccessor = Readonly<{ snapshotExecutionInput(): DocumentSynthesisSourceSetExecutionInput | null }>;
type AvailableClaimCitations = Extract<DocumentSynthesisClaimCitationsResult, Readonly<{ status: 'available' }>>;
export type DocumentSynthesisSourceSetValidationResult = (AvailableClaimCitations & Readonly<{ sourceSetDigestSha256: readonly number[] }>) | Readonly<{ status: 'denied'; code: 'input_invalid'; output: null; outputSha256: null; citations: null; claims: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; sourceSetDigestSha256: null }>;
type ProviderInput = Readonly<{ prompt: string }>;
type CapsuleBinding = Readonly<{
    owner: ServerSessionProjectionOwner;
    session: unknown;
    accessor: DocumentSynthesisSourceSetCurrentnessAccessor;
    executionInputAccessor: DocumentSynthesisSourceSetExecutionInputAccessor;
}>;
type ValidationEntry = Readonly<{ capsule: object; owner: ServerSessionProjectionOwner; session: unknown; validate(envelopeToken: object): DocumentSynthesisSourceSetValidationResult }>;

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
const WeakSetConstructor = WeakSet; const WeakMapConstructor = WeakMap; const MapConstructor = Map; const ReflectApply = Reflect.apply;
const weakSetAdd = WeakSet.prototype.add; const weakSetHas = WeakSet.prototype.has; const weakMapGet = WeakMap.prototype.get; const weakMapSet = WeakMap.prototype.set; const weakMapDelete = WeakMap.prototype.delete;
const authenticCapsules = new WeakSetConstructor<object>();
const capsuleBindings = new WeakMapConstructor<object, CapsuleBinding>();
const validationTokens = new WeakSetConstructor<object>();
const validationEntries = new WeakMapConstructor<object, ValidationEntry>();

const VALIDATION_DENIED = sealed({ status: 'denied' as const, code: 'input_invalid' as const, output: null, outputSha256: null, citations: null, claims: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, sourceSetDigestSha256: null }) as DocumentSynthesisSourceSetValidationResult;

export class DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError extends Error {
    constructor() {
        super('Document synthesis source-set currentness owner configuration rejected');
        this.name = 'DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError';
    }
}

export function resolveDocumentSynthesisSourceSetCurrentnessAccessor(value: unknown, owner: unknown, session: unknown): DocumentSynthesisSourceSetCurrentnessAccessor | null {
    if (typeof value !== 'object' || value === null || IsProxy(value)) return null;
    try {
        if (!ReflectApply(weakSetHas, authenticCapsules, [value])) return null;
        const binding = ReflectApply(weakMapGet, capsuleBindings, [value]) as CapsuleBinding | undefined;
        if (!binding || binding.owner !== owner || binding.session !== session) return null;
        return binding.accessor;
    } catch { return null; }
}

/** Resolves one atomic currentness-and-prompt snapshot for a branded owner/session capsule only. */
export function resolveDocumentSynthesisSourceSetExecutionInputAccessor(value: unknown, owner: unknown, session: unknown): DocumentSynthesisSourceSetExecutionInputAccessor | null {
    if (typeof value !== 'object' || value === null || IsProxy(value)) return null;
    try {
        if (!ReflectApply(weakSetHas, authenticCapsules, [value])) return null;
        const binding = ReflectApply(weakMapGet, capsuleBindings, [value]) as CapsuleBinding | undefined;
        if (!binding || binding.owner !== owner || binding.session !== session) return null;
        return binding.executionInputAccessor;
    } catch { return null; }
}

/** Binds one snapshot-minted token to its privately retained source set in the same owner/session/capsule. */
export function resolveDocumentSynthesisSourceSetValidation(value: unknown, capsule: unknown, owner: unknown, session: unknown): DocumentSynthesisSourceSetValidationResult {
    const input = validationInput(value);
    if (!input || typeof capsule !== 'object' || capsule === null || IsProxy(capsule) || !isServerSessionProjectionOwner(owner) || IsProxy(session)) return VALIDATION_DENIED;
    try {
        if (!ReflectApply(weakSetHas, authenticCapsules, [capsule]) || !ReflectApply(weakSetHas, validationTokens, [input.validationToken])) return VALIDATION_DENIED;
        const entry = ReflectApply(weakMapGet, validationEntries, [input.validationToken]) as ValidationEntry | undefined;
        if (!entry || entry.capsule !== capsule || entry.owner !== owner || entry.session !== session) return VALIDATION_DENIED;
        ReflectApply(weakMapDelete, validationEntries, [input.validationToken]);
        return entry.validate(input.envelopeToken);
    } catch { return VALIDATION_DENIED; }
}

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    for (const key of ReflectOwnKeys(value)) if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    return ObjectFreeze(output);
}

function bytes(value: unknown): readonly number[] | null {
    try {
        if (!ArrayIsArray(value) || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== ARRAY) return null;
        const length = ObjectGetOwnPropertyDescriptor(value, 'length');
        if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value) || length.value !== 32) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== length.value + 2 || !ObjectGetOwnPropertyDescriptor(value, 'toJSON')) return null;
        const copy: number[] = [];
        for (let index = 0; index < length.value; index += 1) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value') || typeof descriptor.value !== 'number' || !NumberIsSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) return null;
            copy[index] = descriptor.value;
        }
        return ObjectFreeze(copy);
    } catch { return null; }
}

function sourceSetDigest(value: object): readonly number[] | null {
    const input = record(value, ['sourceSetEpoch', 'revocationGeneration', 'sources', 'digestPayloadBytes', 'sourceSetDigestSha256'], null);
    return input ? bytes(input.sourceSetDigestSha256) : null;
}

function validationInput(value: unknown): Readonly<{ validationToken: object; envelopeToken: object }> | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 2) return null;
        const token = ObjectGetOwnPropertyDescriptor(value, 'validationToken');
        const envelope = ObjectGetOwnPropertyDescriptor(value, 'envelopeToken');
        if (!token || !envelope || !token.enumerable || !envelope.enumerable || !ObjectHasOwn(token, 'value') || !ObjectHasOwn(envelope, 'value') || typeof token.value !== 'object' || token.value === null || IsProxy(token.value) || typeof envelope.value !== 'object' || envelope.value === null || IsProxy(envelope.value)) return null;
        return sealed({ validationToken: token.value, envelopeToken: envelope.value });
    } catch { return null; }
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

function providerInput(value: unknown): ProviderInput | null {
    try {
        const result = buildDocumentSynthesisMultiSourcePrompt(value);
        return result.status === 'available' && typeof result.prompt === 'string'
            ? sealed({ prompt: result.prompt }) as ProviderInput
            : null;
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
export function createDocumentSynthesisSourceSetCurrentnessOwner(value: unknown): Capsule {
    const input = configuration(value);
    const initial = input && capture(input.sourceSet);
    const initialProviderInput = input && providerInput(input.sourceSet);
    if (!input || !initial || !initialProviderInput) throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError();

    let port: DocumentSynthesisLeaseCommitPort;
    try { port = input.owner.mintDocumentSynthesisLeaseCommitPort(input.session as Parameters<ServerSessionProjectionOwner['mintDocumentSynthesisLeaseCommitPort']>[0]); }
    catch { throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError(); }
    let current = initial;
    let currentProviderInput = initialProviderInput;
    let currentSourceSet = input.sourceSet as object;
    let lineage = new MapConstructor<string, Source>();
    let terminal = false;
    let active = false;
    let resolving = false;
    let reentered = false;

    const continuedLineage = (next: DocumentSynthesisSourceSetCurrentness): Map<string, Source> | null => {
        const nextLineage = new MapConstructor(lineage);
        for (const source of next.sources) {
            const previous = nextLineage.get(source.documentSourceRef);
            if (previous && (source.documentRevision < previous.documentRevision || source.documentFreshnessEpoch < previous.documentFreshnessEpoch)) return null;
            nextLineage.set(source.documentSourceRef, source);
        }
        return nextLineage;
    };
    const initialLineage = continuedLineage(initial);
    if (!initialLineage) throw new DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError();
    lineage = initialLineage;

    const live = (duringResolution = false): boolean => {
        if (terminal || active || (resolving && !duringResolution)) { if (active || resolving) reentered = true; return false; }
        active = true; reentered = false;
        try {
            const snapshot = port.snapshot();
            if (!snapshot) { terminal = true; return false; }
            if (reentered) return false;
            return true;
        } finally { active = false; }
    };
    const snapshotCurrentness = (): DocumentSynthesisSourceSetCurrentness => sealed({
        sourceSetEpoch: current.sourceSetEpoch,
        revocationGeneration: current.revocationGeneration,
        sources: current.sources,
    }) as DocumentSynthesisSourceSetCurrentness;

    const capsule = sealed({
        snapshot() {
            if (!live()) return null;
            return snapshotCurrentness();
        },
        transition(sourceSet: unknown) {
            if (!live()) return false;
            const next = capture(sourceSet);
            const nextProviderInput = providerInput(sourceSet);
            const nextLineage = next && nextProviderInput ? continuedLineage(next) : null;
            if (!next || !nextProviderInput || !nextLineage || next.sourceSetEpoch <= current.sourceSetEpoch || next.revocationGeneration < current.revocationGeneration || reentered) return false;
            current = next; currentProviderInput = nextProviderInput; currentSourceSet = sourceSet as object; lineage = nextLineage;
            return true;
        },
        revoke() { terminal = true; port.dispose(); },
        dispose() { terminal = true; port.dispose(); },
    }) as Capsule;
    const accessor = sealed({ snapshot: capsule.snapshot }) as DocumentSynthesisSourceSetCurrentnessAccessor;
    const validationResult = (sourceSet: object, envelopeToken: object): DocumentSynthesisSourceSetValidationResult => {
        if (resolving) { reentered = true; return VALIDATION_DENIED; }
        resolving = true; reentered = false;
        try {
            if (!live(true) || reentered) return VALIDATION_DENIED;
            const digest = sourceSetDigest(sourceSet);
            if (!digest || reentered) return VALIDATION_DENIED;
            const result = bindDocumentSynthesisProviderEnvelope({ sourceSet, envelopeToken });
            if (reentered || result.status !== 'available') return VALIDATION_DENIED;
            return sealed({ status: 'available' as const, code: null, schemaVersion: result.schemaVersion, output: result.output, outputSha256: result.outputSha256, citations: result.citations, claims: result.claims, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, sourceSetDigestSha256: digest }) as DocumentSynthesisSourceSetValidationResult;
        } catch { return VALIDATION_DENIED; }
        finally { resolving = false; }
    };
    const mintValidationToken = (): DocumentSynthesisSourceSetValidationToken => {
        const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisSourceSetValidationToken;
        const sourceSet = currentSourceSet;
        ReflectApply(weakSetAdd, validationTokens, [token]);
        ReflectApply(weakMapSet, validationEntries, [token, sealed({ capsule, owner: input.owner, session: input.session, validate(envelopeToken: object) { return validationResult(sourceSet, envelopeToken); } }) as ValidationEntry]);
        return token;
    };
    const executionInputAccessor = sealed({
        snapshotExecutionInput() {
            if (!live()) return null;
            return sealed({ currentness: snapshotCurrentness(), prompt: currentProviderInput.prompt, validationToken: mintValidationToken() }) as DocumentSynthesisSourceSetExecutionInput;
        },
    }) as DocumentSynthesisSourceSetExecutionInputAccessor;
    ReflectApply(weakSetAdd, authenticCapsules, [capsule]);
    ReflectApply(weakMapSet, capsuleBindings, [capsule, sealed({ owner: input.owner, session: input.session, accessor, executionInputAccessor }) as CapsuleBinding]);
    return capsule;
}
