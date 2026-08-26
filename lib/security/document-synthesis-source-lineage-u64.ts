// @Codex
import { types } from 'node:util';

const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const ArrayIsArray = Array.isArray;
const CanonicalArrayPrototype = Array.prototype;
const ReflectOwnKeys = Reflect.ownKeys;
const IsProxy = types.isProxy;
const StringFrom = String;

/** Pure arithmetic only: these values do not authenticate, authorize, or resolve a source set. */
const ZERO = BigInt(0); const ONE = BigInt(1);
export const DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX = (ONE << BigInt(64)) - ONE;

export type DocumentSynthesisSourceLineageState = Readonly<{
    nextSourceSetEpoch: bigint; exhausted: boolean; revocationGeneration: bigint; seenRevocationEvents: readonly object[];
}>;
type AdvanceResult = Readonly<{ status: 'advanced'; value: bigint; next: bigint; exhausted: boolean }> | Readonly<{ status: 'exhausted' | 'invalid' }>;
type AllocationResult = Readonly<{ status: 'allocated'; sourceSetEpoch: bigint; state: DocumentSynthesisSourceLineageState }>
    | Readonly<{ status: 'exhausted' | 'invalid' }>;
type RevocationResult = Readonly<{ status: 'advanced' | 'repeated'; state: DocumentSynthesisSourceLineageState }>
    | Readonly<{ status: 'exhausted'; state: DocumentSynthesisSourceLineageState }> | Readonly<{ status: 'invalid' }>;

function frozen<T extends object>(value: T): Readonly<T> {
    const copy = ObjectCreate(null) as T;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
        if (descriptor) ObjectDefineProperty(copy, key, descriptor);
    }
    return ObjectFreeze(copy);
}

function result<T extends object>(value: T): Readonly<T> { return frozen(value); }

function u64(value: unknown): value is bigint {
    return typeof value === 'bigint' && value >= ZERO && value <= DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX;
}

function event(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !IsProxy(value) && ObjectIsFrozen(value)
        && ObjectGetPrototypeOf(value) === null && ReflectOwnKeys(value).length === 0;
}

function events(value: unknown): value is readonly object[] {
    if (IsProxy(value) || !ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== CanonicalArrayPrototype
        || !ObjectIsFrozen(value) || ReflectOwnKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = ObjectGetOwnPropertyDescriptor(value, StringFrom(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !event(descriptor.value)) return false;
    }
    return true;
}

function state(value: unknown): value is DocumentSynthesisSourceLineageState {
    if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value)
        || ObjectGetPrototypeOf(value) !== null || ReflectOwnKeys(value).length !== 4) return false;
    const next = ObjectGetOwnPropertyDescriptor(value, 'nextSourceSetEpoch');
    const exhausted = ObjectGetOwnPropertyDescriptor(value, 'exhausted');
    const generation = ObjectGetOwnPropertyDescriptor(value, 'revocationGeneration');
    const seen = ObjectGetOwnPropertyDescriptor(value, 'seenRevocationEvents');
    if (!next || !next.enumerable || !('value' in next)
        || !exhausted || !exhausted.enumerable || !('value' in exhausted)
        || !generation || !generation.enumerable || !('value' in generation)
        || !seen || !seen.enumerable || !('value' in seen)) return false;
    return u64(next.value) && typeof exhausted.value === 'boolean' && u64(generation.value) && events(seen.value);
}

function contains(values: readonly object[], candidate: object): boolean {
    for (let index = 0; index < values.length; index += 1) if (values[index] === candidate) return true;
    return false;
}

function copyEvents(eventsToCopy: readonly object[]): object[] {
    const copy: object[] = [];
    for (let index = 0; index < eventsToCopy.length; index += 1) {
        const descriptor = ObjectGetOwnPropertyDescriptor(eventsToCopy, StringFrom(index));
        if (descriptor && 'value' in descriptor) {
            ObjectDefineProperty(copy, StringFrom(index), {
                value: descriptor.value, enumerable: true, configurable: true, writable: true,
            });
        }
    }
    return copy;
}

function makeState(nextSourceSetEpoch: bigint, exhausted: boolean, revocationGeneration: bigint, seenRevocationEvents: readonly object[]): DocumentSynthesisSourceLineageState {
    return frozen({ nextSourceSetEpoch, exhausted, revocationGeneration, seenRevocationEvents: ObjectFreeze(copyEvents(seenRevocationEvents)) });
}

export function createDocumentSynthesisSourceLineageState(): DocumentSynthesisSourceLineageState {
    return makeState(ONE, false, ZERO, []);
}

export function advanceDocumentSynthesisSourceSetEpoch(value: unknown): AdvanceResult {
    if (!u64(value)) return result({ status: 'invalid' });
    return result({ status: 'advanced', value, next: value === DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX ? value : value + ONE,
        exhausted: value === DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX });
}

export function advanceDocumentSynthesisRevocationGeneration(value: unknown): AdvanceResult {
    if (!u64(value)) return result({ status: 'invalid' });
    if (value === DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX) return result({ status: 'exhausted' });
    return result({ status: 'advanced', value: value + ONE, next: value + ONE, exhausted: false });
}

export function allocateDocumentSynthesisSourceSetEpoch(value: unknown): AllocationResult {
    if (!state(value)) return result({ status: 'invalid' });
    if (value.exhausted) return result({ status: 'exhausted' });
    const advanced = advanceDocumentSynthesisSourceSetEpoch(value.nextSourceSetEpoch);
    if (advanced.status !== 'advanced') return result({ status: 'exhausted' });
    return result({ status: 'allocated', sourceSetEpoch: advanced.value,
        state: makeState(advanced.next, advanced.exhausted, value.revocationGeneration, value.seenRevocationEvents) });
}

export function observeDocumentSynthesisRevocation(value: unknown, identity: unknown): RevocationResult {
    if (!state(value) || !event(identity)) return result({ status: 'invalid' });
    if (value.exhausted) return result({ status: 'exhausted', state: value });
    if (contains(value.seenRevocationEvents, identity)) return result({ status: 'repeated', state: value });
    const advanced = advanceDocumentSynthesisRevocationGeneration(value.revocationGeneration);
    if (advanced.status !== 'advanced') return result({ status: 'exhausted', state: makeState(value.nextSourceSetEpoch,
        true, value.revocationGeneration, value.seenRevocationEvents) });
    const seenRevocationEvents = copyEvents(value.seenRevocationEvents);
    ObjectDefineProperty(seenRevocationEvents, StringFrom(seenRevocationEvents.length), {
        value: identity, enumerable: true, configurable: true, writable: true,
    });
    return result({ status: 'advanced', state: makeState(value.nextSourceSetEpoch, advanced.exhausted,
        advanced.value, seenRevocationEvents) });
}
