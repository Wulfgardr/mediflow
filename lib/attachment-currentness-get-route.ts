/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { NextResponse } from 'next/server';

import { isAttachmentCurrentnessHostError, observeHostAttachmentCurrentness } from '@/lib/attachment-currentness-host';
import { unauthorizedResponse } from '@/lib/security/server-auth';

const CURRENTNESS_KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const REF = /^[0-9a-f]{64}$/u;
const objectCreate = Object.create;
const objectDefineProperties = Object.defineProperties;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const reflectOwnKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger;
const stringTrim = Function.call.bind(String.prototype.trim) as (value: string) => string;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const objectPrototype = Object.prototype;
const responseJson = NextResponse.json.bind(NextResponse);
const isProxy = types.isProxy;
const arrayEvery = Function.call.bind(Array.prototype.every) as <T>(values: readonly T[], predicate: (value: T) => boolean) => boolean;

type CurrentnessObserver = (id: unknown) => unknown;

function exactDataFields(value: unknown, keys: readonly string[], prototype: object | null): Record<string, PropertyDescriptor> | null {
    if (!value || typeof value !== 'object' || isProxy(value) || objectGetPrototypeOf(value) !== prototype) return null;
    const fields = objectGetOwnPropertyDescriptors(value);
    if (reflectOwnKeys(fields).length !== keys.length) return null;
    for (const key of keys) {
        const field = objectGetOwnPropertyDescriptor(fields, key)?.value;
        if (!field || typeof field !== 'object' || !objectHasOwn(field, 'value') || !field.enumerable) return null;
    }
    return fields;
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === stringTrim(value);
}

function validSession(value: unknown): boolean {
    const fields = exactDataFields(value, SESSION_KEYS, objectPrototype);
    if (!fields) return false;
    const { id, userId, username, role, authChannel, createdAt, expiresAt } = fields;
    return arrayEvery([id, userId, username, role], (field) => typeof field.value === 'string' && field.value.length > 0 && field.value === stringTrim(field.value))
        && authChannel.value === 'web' && typeof createdAt.value === 'number' && numberIsSafeInteger(createdAt.value)
        && typeof expiresAt.value === 'number' && numberIsSafeInteger(expiresAt.value) && expiresAt.value > createdAt.value;
}

function validCurrentness(value: unknown): { sourceRef: string; revision: number; freshnessEpoch: number } | null {
    const fields = exactDataFields(value, CURRENTNESS_KEYS, null);
    if (!fields) return null;
    const { sourceRef, revision, freshnessEpoch } = fields;
    if (typeof sourceRef.value !== 'string' || !regexpTest(REF, sourceRef.value)
        || typeof revision.value !== 'number' || !numberIsSafeInteger(revision.value) || revision.value < 1
        || typeof freshnessEpoch.value !== 'number' || !numberIsSafeInteger(freshnessEpoch.value) || freshnessEpoch.value < 1) return null;
    return { sourceRef: sourceRef.value, revision: revision.value, freshnessEpoch: freshnessEpoch.value };
}

function unavailableResponse(): Response {
    return responseJson({ error: 'Attachment currentness unavailable' }, { status: 503 });
}

function mapError(error: unknown): Response {
    if (!isAttachmentCurrentnessHostError(error)) return unavailableResponse();
    switch (error.code) {
        case 'input_invalid': return responseJson({ error: 'Invalid attachment id' }, { status: 400 });
        case 'attachment_missing': return responseJson({ error: 'Not found' }, { status: 404 });
        case 'currentness_conflict':
        case 'currentness_overflow':
        case 'stored_state_invalid':
        case 'storage_unavailable': return unavailableResponse();
        default: return error.code satisfies never;
    }
}

function successResponse(currentness: { sourceRef: string; revision: number; freshnessEpoch: number }): Response {
    const tuple = objectCreate(null);
    objectDefineProperties(tuple, {
        sourceRef: { value: currentness.sourceRef, enumerable: true },
        revision: { value: currentness.revision, enumerable: true },
        freshnessEpoch: { value: currentness.freshnessEpoch, enumerable: true },
    });
    const body = objectCreate(null);
    objectDefineProperties(body, { currentness: { value: objectFreeze(tuple), enumerable: true } });
    return responseJson(objectFreeze(body));
}

/** Session-injected read adapter; it exposes only a validated currentness tuple. */
export function getAttachmentCurrentness(id: unknown, session: unknown, observer: CurrentnessObserver = observeHostAttachmentCurrentness): Response {
    if (!validSession(session)) return unauthorizedResponse();
    if (!validId(id)) return responseJson({ error: 'Invalid attachment id' }, { status: 400 });
    try {
        const observed = observer(id);
        if (observed === null) return responseJson({ error: 'Not found' }, { status: 404 });
        const currentness = validCurrentness(observed);
        return currentness ? successResponse(currentness) : unavailableResponse();
    } catch (error) {
        return mapError(error);
    }
}
