import 'server-only';

/* @Codex */
import { types } from 'node:util';

import { bindDocumentSynthesisClaimsToCitations, type DocumentSynthesisClaimCitationsResult } from './document-synthesis-claim-citations';
import { resolveDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope';

const OBJECT = Object.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectApply = Reflect.apply;
const IsProxy = types.isProxy;
const StructuredClone = structuredClone;

type Input = Readonly<{ sourceSet: object; envelopeToken: object }>;

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    }
    return ObjectFreeze(output);
}

const DENIED = sealed({
    status: 'denied' as const,
    code: 'input_invalid' as const,
    output: null,
    outputSha256: null,
    citations: null,
    claims: null,
    reviewOnly: true as const,
    writesPerformed: 0 as const,
    applyPolicy: 'none' as const,
}) as DocumentSynthesisClaimCitationsResult;

function input(value: unknown): Input | null {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 2 || !((keys[0] === 'sourceSet' && keys[1] === 'envelopeToken') || (keys[0] === 'envelopeToken' && keys[1] === 'sourceSet'))) return null;
        const sourceSet = ObjectGetOwnPropertyDescriptor(value, 'sourceSet');
        const envelopeToken = ObjectGetOwnPropertyDescriptor(value, 'envelopeToken');
        if (!sourceSet || !envelopeToken || !sourceSet.enumerable || !envelopeToken.enumerable || !ObjectHasOwn(sourceSet, 'value') || !ObjectHasOwn(envelopeToken, 'value')
            || !sourceSet.value || typeof sourceSet.value !== 'object' || IsProxy(sourceSet.value)
            || !envelopeToken.value || typeof envelopeToken.value !== 'object' || IsProxy(envelopeToken.value)) return null;
        return sealed({ sourceSet: sourceSet.value, envelopeToken: envelopeToken.value }) as Input;
    } catch { return null; }
}

/** C3d2b only: binds one authentic C3d2a envelope token to one authentic C3c2 source-set. */
export function bindDocumentSynthesisProviderEnvelope(value: unknown): DocumentSynthesisClaimCitationsResult {
    const descriptor = input(value);
    if (!descriptor) return DENIED;
    const envelope = resolveDocumentSynthesisProviderEnvelope(descriptor.envelopeToken);
    if (!envelope) return DENIED;
    try {
        const cloned = ReflectApply(StructuredClone, undefined, [envelope]) as Readonly<{ output: unknown; citations: unknown; claims: unknown }>;
        const result = bindDocumentSynthesisClaimsToCitations({ sourceSet: descriptor.sourceSet, output: cloned.output, citations: cloned.citations, claims: cloned.claims });
        return result.status === 'available' ? result : DENIED;
    } catch { return DENIED; }
}
