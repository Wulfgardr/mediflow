/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const HEADLESS_SOAP_AUTHORIZATION_PROOF_DOMAIN_V1 =
    'mediflow.headless.soap-authorization-proof.v1' as const;

export type HeadlessSoapAuthorizationProofTokenV1 = Readonly<{
    authorizationProof: string;
    digest: string;
}>;

const HEX = '0123456789abcdef';
const AUTHORIZATION_PROOF = /^hsap_[0-9a-f]{64}$/u;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const isProxy = types.isProxy;
const uint8ArrayPrototype = Uint8Array.prototype;
const arrayBufferPrototype = ArrayBuffer.prototype;
const typedArrayPrototype = objectGetPrototypeOf(uint8ArrayPrototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'byteLength')?.get;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'resizable')?.get;

function frozenRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value));
}

function exactEntropy(value: unknown): Uint8Array | null {
    if (!typedArrayByteLength || !typedArrayByteOffset || !typedArrayBuffer || !arrayBufferByteLength
        || typeof value !== 'object' || value === null || isProxy(value)
        || objectGetPrototypeOf(value) !== uint8ArrayPrototype) return null;
    try {
        const keys = reflectOwnKeys(value);
        if (keys.length !== 32) return null;
        for (let index = 0; index < 32; index += 1) {
            if (keys[index] !== String(index)) return null;
        }
        if (reflectApply(typedArrayByteLength, value, []) !== 32
            || reflectApply(typedArrayByteOffset, value, []) !== 0) return null;
        const buffer = reflectApply(typedArrayBuffer, value, []) as unknown;
        if (typeof buffer !== 'object' || buffer === null || isProxy(buffer)
            || objectGetPrototypeOf(buffer) !== arrayBufferPrototype
            || reflectApply(arrayBufferByteLength, buffer, []) !== 32
            || (arrayBufferResizable && reflectApply(arrayBufferResizable, buffer, []) !== false)) return null;
        return value as Uint8Array;
    } catch {
        return null;
    }
}

export function digestHeadlessSoapAuthorizationProof(candidate: unknown): string | null {
    if (typeof candidate !== 'string' || !reflectApply(regexpTest, AUTHORIZATION_PROOF, [candidate])) return null;
    return createHash('sha256')
        .update(HEADLESS_SOAP_AUTHORIZATION_PROOF_DOMAIN_V1, 'ascii')
        .update('\0', 'ascii')
        .update(candidate, 'ascii')
        .digest('hex');
}

export function createHeadlessSoapAuthorizationProofToken(
    candidateEntropy: unknown,
): HeadlessSoapAuthorizationProofTokenV1 | null {
    try {
        const entropy = exactEntropy(candidateEntropy); if (!entropy) return null;
        let authorizationProof = 'hsap_';
        for (let index = 0; index < 32; index += 1) {
            const byte = entropy[index]!;
            authorizationProof += HEX[byte >>> 4]! + HEX[byte & 15]!;
        }
        const digest = digestHeadlessSoapAuthorizationProof(authorizationProof);
        return digest ? frozenRecord({ authorizationProof, digest }) : null;
    } catch {
        return null;
    }
}
