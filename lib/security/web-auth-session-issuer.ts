/* @Codex */
import { types } from 'node:util';

import { beginWebAuth, cancelWebAuth, type WebAuthAttempt } from './web-auth-control-owner';

declare const webAuthSessionAttemptBrand: unique symbol;
export type WebAuthSessionAttempt = Readonly<{ readonly [webAuthSessionAttemptBrand]: never }>;
type PendingAttempt = { state: 'pending' | 'burned'; owner: WebAuthAttempt };

const apply = Reflect.apply;
const freeze = Object.freeze;
const create = Object.create;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakDelete = WeakMap.prototype.delete;
const isProxy = types.isProxy;
const attempts = new WeakMap<object, PendingAttempt>();
let operationActive = false;
let operationPoisoned = false;

function enter(): boolean {
    if (operationActive) { operationPoisoned = true; return false; }
    operationActive = true; operationPoisoned = false; return true;
}
function leave(): void { operationActive = false; operationPoisoned = false; }
function get(value: unknown): PendingAttempt | undefined {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
    try { return apply(weakGet, attempts, [value]) as PendingAttempt | undefined; } catch { return undefined; }
}
function drop(value: object): void { apply(weakDelete, attempts, [value]); }
function cancel(pending: PendingAttempt): void {
    try { cancelWebAuth(pending.owner); } catch { /* owner denial remains terminal */ }
}
function burn(attempt: object, pending: PendingAttempt): void {
    pending.state = 'burned';
    try { drop(attempt); } catch { /* the burned record remains fail-closed */ }
    cancel(pending);
}

/** Starts one owner-generated login/setup attempt with no session authority. */
export function begin(kind: unknown): WebAuthSessionAttempt | null {
    if (!enter()) return null;
    let attempt: WebAuthSessionAttempt | null = null;
    let pending: PendingAttempt | undefined;
    try {
        if (kind !== 'login' && kind !== 'setup') return null;
        const owner = beginWebAuth(kind);
        if (!owner) return null;
        pending = { state: 'pending', owner };
        if (operationPoisoned) { pending.state = 'burned'; cancel(pending); return null; }
        attempt = freeze(create(null)) as WebAuthSessionAttempt;
        apply(weakSet, attempts, [attempt, pending]);
        if (operationPoisoned) { burn(attempt, pending); return null; }
        return attempt;
    } catch {
        if (attempt && pending) burn(attempt, pending);
        else if (pending) cancel(pending);
        return null;
    } finally { leave(); }
}

/** Burns one pending attempt and its owner control reservation. */
export function abort(value: unknown): boolean {
    if (!enter()) return false;
    try {
        const pending = get(value);
        if (operationPoisoned || !pending || pending.state !== 'pending') return false;
        if (typeof value !== 'object' || value === null || isProxy(value)) { pending.state = 'burned'; cancel(pending); return false; }
        pending.state = 'burned';
        try { drop(value); } catch { cancel(pending); return false; }
        const cancelled = (() => { try { return cancelWebAuth(pending.owner); } catch { return false; } })();
        return !operationPoisoned && cancelled;
    } catch { return false; }
    finally { leave(); }
}
