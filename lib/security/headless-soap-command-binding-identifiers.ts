/* @Codex */
import 'server-only';

import { types } from 'node:util';

export type HeadlessSoapCommandBindingIdentifiersV1 = Readonly<{
    commandId: string;
    approvalRef: string;
    idempotencyKey: string;
}>;

const HEX = '0123456789abcdef';
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const isProxy = types.isProxy;
const uint8ArrayPrototype = Uint8Array.prototype;
const arrayBufferPrototype = ArrayBuffer.prototype;
const typedArrayPrototype = objectGetPrototypeOf(uint8ArrayPrototype);
const typedArrayByteLength = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const typedArrayByteOffset = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const typedArrayBuffer = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const arrayBufferByteLength = objectGetOwnPropertyDescriptor(arrayBufferPrototype, 'byteLength')?.get;
const arrayBufferResizable = objectGetOwnPropertyDescriptor(arrayBufferPrototype, 'resizable')?.get;

function exactEntropy(value: unknown): Uint8Array | null {
    if (!typedArrayByteLength || !typedArrayByteOffset || !typedArrayBuffer || !arrayBufferByteLength
        || typeof value !== 'object' || value === null || isProxy(value)
        || objectGetPrototypeOf(value) !== uint8ArrayPrototype) return null;
    try {
        const keys = reflectOwnKeys(value);
        if (keys.length !== 32) return null;
        for (let index = 0; index < 32; index += 1) if (keys[index] !== String(index)) return null;
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

function encode(prefix: 'hsac_' | 'hsaa_' | 'hsai_', value: unknown): string | null {
    const entropy = exactEntropy(value);
    if (!entropy) return null;
    let output: string = prefix;
    for (let index = 0; index < 32; index += 1) {
        const byte = entropy[index]!;
        output += HEX[byte >>> 4]! + HEX[byte & 15]!;
    }
    return output;
}

/** Draws the three independent process-local H6 identifiers exactly once. */
export function createHeadlessSoapCommandBindingIdentifiers(
    draw: () => unknown,
): HeadlessSoapCommandBindingIdentifiersV1 | null {
    try {
        if (typeof draw !== 'function' || isProxy(draw)) return null;
        const commandId = encode('hsac_', reflectApply(draw, undefined, []));
        if (!commandId) return null;
        const approvalRef = encode('hsaa_', reflectApply(draw, undefined, []));
        if (!approvalRef) return null;
        const idempotencyKey = encode('hsai_', reflectApply(draw, undefined, []));
        if (!idempotencyKey) return null;
        return objectFreeze(objectAssign(objectCreate(null), { commandId, approvalRef, idempotencyKey }));
    } catch {
        return null;
    }
}
