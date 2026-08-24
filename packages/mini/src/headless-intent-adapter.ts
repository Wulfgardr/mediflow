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
const FORBIDDEN_INTENT = /\b(authority|session|role|patient|provider|venue|egress|prompt|credential|cookie|token|sql|sqlite|write|apply)\b/i;

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
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
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

export function adaptMiniTransportToHeadlessRequest(transport: MiniTransport): HeadlessSemanticRequest {
    const envelope = exactDataRecord(transport, TRANSPORT_KEYS, 'transport_invalid');
    if (envelope.format !== 'json' && envelope.format !== 'ndjson') fail('transport_invalid');
    const request = exactDataRecord(envelope.request, REQUEST_KEYS, 'request_invalid');
    const adapterKind = request.command === HEADLESS_INTENT_COMMANDS.chat ? 'chat'
        : request.command === HEADLESS_INTENT_COMMANDS.voice ? 'voice' : fail('command_invalid');
    const args = exactDataRecord(request.args, ARG_KEYS, 'request_invalid');
    if (typeof args.intent !== 'string' || !args.intent.startsWith('synthetic: ') || args.intent.length > 160
        || FORBIDDEN_INTENT.test(args.intent) || !safeRef(args.requestRef) || !safeRef(args.idempotencyRef)) fail('request_invalid');
    return Object.freeze({
        adapterKind, intent: args.intent, requestRef: args.requestRef, idempotencyRef: args.idempotencyRef,
    });
}
