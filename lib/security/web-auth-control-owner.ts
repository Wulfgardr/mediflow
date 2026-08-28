/* @Codex */

import crypto from 'node:crypto';
import { types } from 'node:util';
import {
    abortPreparedAuthControlTicket,
    commitAuthControlTicket,
    createWebAuthControlRecord,
    type AuthControlTicket,
} from './web-auth-control-record';

export type WebAuthKind = 'login' | 'setup';
declare const webAuthAttemptBrand: unique symbol;
export type WebAuthAttempt = Readonly<{ readonly [webAuthAttemptBrand]: never }>;
declare const webAuthActivationBrand: unique symbol;
export type WebAuthActivation = Readonly<{ readonly [webAuthActivationBrand]: never }>;

type ControlRecord = ReturnType<typeof createWebAuthControlRecord>;
type AttemptBinding = {
    lifecycle: 'pending' | 'prepared' | 'finished' | 'cancelled';
    control: ControlRecord; operation: string; key: string; fingerprint: string;
    fence: string; generation: bigint; at: number; activation: ActivationBinding | null;
};
type ActivationBinding = {
    lifecycle: 'prepared' | 'finished' | 'cancelled'; attempt: AttemptBinding;
    ticket: AuthControlTicket; capability: WebAuthActivation;
};

const apply = Reflect.apply;
const freeze = Object.freeze;
const create = Object.create;
const getPrototypeOf = Object.getPrototypeOf;
const isProxy = types.isProxy;
const randomBytes = crypto.randomBytes;
const isBuffer = Buffer.isBuffer;
const bufferPrototype = Buffer.prototype;
const byteLength = Object.getOwnPropertyDescriptor(getPrototypeOf(Uint8Array.prototype), 'byteLength')?.get;
const dateNow = Date.now;
const safeInteger = Number.isSafeInteger;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakDelete = WeakMap.prototype.delete;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const attempts = new WeakMap<object, AttemptBinding>();
const activations = new WeakMap<object, ActivationBinding>();
const usedKeys = new Set<string>(); // Entropy tombstones only; this is not an authority registry.
let control: ControlRecord | null = null;
let operationActive = false;
let operationPoisoned = false;

function enter(): boolean {
    if (operationActive) { operationPoisoned = true; return false; }
    operationActive = true; operationPoisoned = false; return true;
}
function leave(): void { operationActive = false; operationPoisoned = false; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function now(): number | null {
    try { const value = apply(dateNow, Date, []); return safeInteger(value) && value >= 0 ? value : null; } catch { return null; }
}
function opaque<Value>(): Value { return apply(freeze, Object, [apply(create, Object, [null])]) as Value; }
function mint(prefix: string): string | null {
    try {
        const bytes = apply(randomBytes, crypto, [32]);
        if (!isBuffer(bytes) || isProxy(bytes) || getPrototypeOf(bytes) !== bufferPrototype || !byteLength || apply(byteLength, bytes, []) !== 32) return null;
        const digits = '0123456789abcdef'; let value = prefix;
        for (let index = 0; index < 32; index += 1) { const byte = bytes[index]!; if (!safeInteger(byte) || byte < 0 || byte > 255) return null; value += digits[byte >> 4] + digits[byte & 15]; }
        return value;
    } catch { return null; }
}
function get<Value>(map: WeakMap<object, Value>, value: unknown): Value | undefined {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
    try { return apply(weakGet, map, [value]) as Value | undefined; } catch { return undefined; }
}
function set<Value>(map: WeakMap<object, Value>, value: object, item: Value): void { apply(weakSet, map, [value, item]); }
function drop(map: WeakMap<object, unknown>, value: object): void { apply(weakDelete, map, [value]); }
function rememberKey(value: string): boolean {
    try { if (apply(setHas, usedKeys, [value])) return false; apply(setAdd, usedKeys, [value]); return true; } catch { return false; }
}
function ensureControl(): ControlRecord | null {
    if (control) return control;
    const fence = mint('wac_fence_');
    if (!fence || operationPoisoned) return null;
    try { control = createWebAuthControlRecord(fence); return control; } catch { return null; }
}
function cancelExact(binding: AttemptBinding): void {
    const current = now();
    if (current !== null) binding.control.cancelPendingAuth(binding.fence, binding.operation, binding.generation, binding.fingerprint, current);
}

/** Starts one owner-generated login/setup operation; no caller metadata enters P2. */
/* @Codex */
export function beginWebAuth(kind: unknown): WebAuthAttempt | null {
    if (!enter()) return null;
    let binding: AttemptBinding | null = null; let attempt: WebAuthAttempt | null = null;
    try {
        if (kind !== 'login' && kind !== 'setup') return null;
        const owner = ensureControl(); const operation = mint('wac_operation_'); const key = mint('wac_key_'); const fingerprint = mint('wac_fingerprint_'); const at = now();
        if (!owner || !operation || !key || !fingerprint || at === null || operationPoisoned || !rememberKey(key)) return null;
        const result = owner.begin(kind, operation, key, fingerprint, at);
        if (!result.ok || operationPoisoned) return null;
        attempt = opaque<WebAuthAttempt>();
        binding = { lifecycle: 'pending', control: owner, operation, key, fingerprint, fence: result.fence, generation: result.generation, at, activation: null };
        set(attempts, attempt, binding);
        if (operationPoisoned) { try { drop(attempts, attempt); } catch { /* no caller capability was returned */ } cancelExact(binding); return null; }
        return attempt;
    } catch { if (binding) cancelExact(binding); return null; }
    finally { leave(); }
}

/** Prepares one exact owner ticket for a trusted future P3 activation seam. */
/* @Codex */
export function prepareWebAuthActivation(attempt: unknown, exactSessionId: unknown): WebAuthActivation | null {
    if (!enter()) return null;
    let binding: AttemptBinding | undefined; let raw: AuthControlTicket | null = null; let capability: WebAuthActivation | null = null;
    try {
        binding = get(attempts, attempt);
        if (operationPoisoned || !binding || binding.lifecycle !== 'pending' || !text(exactSessionId)) return null;
        const at = now(); if (at === null) return null;
        raw = binding.control.prepareAuthControlTicket(binding.fence, binding.operation, binding.generation, binding.fingerprint, exactSessionId, at);
        if (!raw || operationPoisoned) { if (raw) abortPreparedAuthControlTicket(raw); return null; }
        capability = opaque<WebAuthActivation>();
        const activation: ActivationBinding = { lifecycle: 'prepared', attempt: binding, ticket: raw, capability };
        set(activations, capability, activation);
        if (operationPoisoned) { try { drop(activations, capability); } catch { /* unreachable capability remains private */ } abortPreparedAuthControlTicket(raw); return null; }
        binding.activation = activation; binding.lifecycle = 'prepared'; return capability;
    } catch {
        if (capability) { try { drop(activations, capability); } catch { /* no caller capability was returned */ } }
        if (raw) { abortPreparedAuthControlTicket(raw); }
        return null;
    } finally { leave(); }
}

/** Burns a prepared ticket, then performs the exact pending cancellation when still applicable. */
/* @Codex */
export function cancelWebAuth(attempt: unknown): boolean {
    if (!enter()) return false;
    try {
        const binding = get(attempts, attempt);
        if (operationPoisoned || !binding || (binding.lifecycle !== 'pending' && binding.lifecycle !== 'prepared')) return false;
        if (binding.lifecycle === 'prepared') {
            const activation = binding.activation;
            if (!activation || activation.lifecycle !== 'prepared' || !abortPreparedAuthControlTicket(activation.ticket)) return false;
            activation.lifecycle = 'cancelled'; binding.lifecycle = 'cancelled'; cancelExact(binding); return true;
        }
        const current = now(); if (current === null) return false;
        if (binding.control.cancelPendingAuth(binding.fence, binding.operation, binding.generation, binding.fingerprint, current) !== 1) return false;
        binding.lifecycle = 'cancelled'; return true;
    } catch { return false; }
    finally { leave(); }
}

/** Commits only the exact prepared ticket; P3 owns the future caller of this seam. */
/* @Codex */
export function finishWebAuth(attempt: unknown, activated: unknown): boolean {
    if (!enter()) return false;
    try {
        const binding = get(attempts, attempt); const activation = get(activations, activated);
        if (operationPoisoned || !binding || binding.lifecycle !== 'prepared' || !activation || activation.lifecycle !== 'prepared' || activation.attempt !== binding) return false;
        if (!commitAuthControlTicket(activation.ticket)) return false;
        activation.lifecycle = 'finished'; binding.lifecycle = 'finished'; return true;
    } catch { return false; }
    finally { leave(); }
}
