/* @Codex */
import { types } from 'node:util';

import type { HeadlessSemanticRequest } from '../../../lib/headless-semantic-orchestrator';
import type { MiniTransport } from './cli';

export const HEADLESS_INTENT_COMMANDS = Object.freeze({
    chat: 'headless.intent.chat',
    voice: 'headless.intent.voice',
});

const TRANSPORT_KEYS = ['format', 'request'] as const;
const REQUEST_KEYS = ['command', 'args'] as const;
const ARG_KEYS = ['intent', 'requestRef', 'idempotencyRef'] as const;
const REF = /^[a-z][a-z0-9-]*_[a-z0-9][a-z0-9.-]{7,63}$/;
const SENSITIVE_REF = /^(patient|clinical|prompt|model|credential|cookie|token)[-_.]/i;
const SYNTHETIC_INTENT_PREFIX = 'synthetic: ';
const INTENT_ALLOWED_CHARS = /^[\p{Script=Latin}\p{Number} .,;:!?'"()/_+\-–—’]*$/u;
const INTENT_TOKENS = /[\p{Letter}\p{Number}]+/gu;
const FORBIDDEN_INTENT_TOKENS = new Set([
    'authority', 'clinical', 'session', 'role', 'patient', 'provider', 'venue', 'egress',
    'prompt', 'credential', 'cookie', 'token', 'sql', 'sqlite', 'write', 'apply',
]);

export class HeadlessIntentAdapterError extends Error {
    constructor(readonly code: string) {
        super(code);
        this.name = 'HeadlessIntentAdapterError';
    }
}

function fail(code: string): never {
    throw new HeadlessIntentAdapterError(code);
}

function exactDataRecord(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value)) fail(code);
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string') || Object.keys(descriptors).length !== keys.length) fail(code);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(code);
    }
    return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function safeRef(value: unknown): value is string {
    return typeof value === 'string' && REF.test(value) && !SENSITIVE_REF.test(value);
}

/**
 * P4b receives parsed transport only; raw duplicate JSON-key detection stays
 * with the P4a parser. NFKC is detection-only: a changed string is denied so
 * the frozen result retains the caller's exact, already-normalized intent.
 */
function safeSyntheticIntent(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const normalized = value.normalize('NFKC');
    if (normalized !== value || !normalized.startsWith(SYNTHETIC_INTENT_PREFIX) || normalized.length > 160) return false;
    const body = normalized.slice(SYNTHETIC_INTENT_PREFIX.length);
    if (!INTENT_ALLOWED_CHARS.test(body)) return false;
    const tokens = body.toLocaleLowerCase('en-US').match(INTENT_TOKENS) ?? [];
    return !tokens.some((token) => FORBIDDEN_INTENT_TOKENS.has(token));
}

export function adaptMiniTransportToHeadlessRequest(transport: MiniTransport): HeadlessSemanticRequest {
    const envelope = exactDataRecord(transport, TRANSPORT_KEYS, 'transport_invalid');
    if (envelope.format !== 'json' && envelope.format !== 'ndjson') fail('transport_invalid');
    const request = exactDataRecord(envelope.request, REQUEST_KEYS, 'request_invalid');
    const adapterKind = request.command === HEADLESS_INTENT_COMMANDS.chat ? 'chat'
        : request.command === HEADLESS_INTENT_COMMANDS.voice ? 'voice' : fail('command_invalid');
    const args = exactDataRecord(request.args, ARG_KEYS, 'request_invalid');
    if (!safeSyntheticIntent(args.intent) || !safeRef(args.requestRef) || !safeRef(args.idempotencyRef)) fail('request_invalid');
    return Object.freeze({
        adapterKind, intent: args.intent, requestRef: args.requestRef, idempotencyRef: args.idempotencyRef,
    });
}
