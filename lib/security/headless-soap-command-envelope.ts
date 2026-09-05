/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { digestHeadlessSoapAuthorizationProof } from './headless-soap-authorization-proof-token';

export type HeadlessSoapCommandEnvelopeV1 = Readonly<{
    approvalRef: string;
    idempotencyKey: string;
    authorizationProof: string;
}>;

export type ParsedHeadlessSoapCommandEnvelopeV1 = Readonly<{
    envelope: HeadlessSoapCommandEnvelopeV1;
    authorizationProofDigest: string;
}>;

const APPROVAL_REF = /^hsaa_[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^hsai_[0-9a-f]{64}$/u;
const ENVELOPE_KEYS = ['approvalRef', 'idempotencyKey', 'authorizationProof'] as const;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIsFrozen = Object.isFrozen;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const isProxy = types.isProxy;

/** Parses the one exact H6/H7a envelope without retaining caller-owned objects. */
export function parseHeadlessSoapCommandEnvelope(
    value: unknown,
): ParsedHeadlessSoapCommandEnvelopeV1 | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== null
            || !objectIsFrozen(value)) return null;
        const keys = reflectOwnKeys(value);
        if (keys.length !== ENVELOPE_KEYS.length) return null;
        const fields: unknown[] = [];
        for (let index = 0; index < ENVELOPE_KEYS.length; index += 1) {
            const key = ENVELOPE_KEYS[index]!;
            if (keys[index] !== key) return null;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return null;
            fields.push(descriptor.value);
        }
        const [approvalRef, idempotencyKey, authorizationProof] = fields;
        if (typeof approvalRef !== 'string' || !reflectApply(regexpTest, APPROVAL_REF, [approvalRef])
            || typeof idempotencyKey !== 'string' || !reflectApply(regexpTest, IDEMPOTENCY_KEY, [idempotencyKey])) {
            return null;
        }
        const authorizationProofDigest = digestHeadlessSoapAuthorizationProof(authorizationProof);
        if (!authorizationProofDigest || typeof authorizationProof !== 'string') return null;
        const envelope = objectFreeze(objectAssign(objectCreate(null), {
            approvalRef, idempotencyKey, authorizationProof,
        })) as HeadlessSoapCommandEnvelopeV1;
        return objectFreeze(objectAssign(objectCreate(null), {
            envelope, authorizationProofDigest,
        })) as ParsedHeadlessSoapCommandEnvelopeV1;
    } catch {
        return null;
    }
}
