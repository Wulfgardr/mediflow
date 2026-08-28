/* @Codex */
import { types } from 'node:util';

import {
    activatePreparedWebAuthSession, beginWebAuth, cancelWebAuth, prepareWebAuthActivation,
    type WebAuthAttempt,
} from './web-auth-control-owner';
import {
    abortPreparedWebServerSession, abortStagedWebServerSession, armPreparedWebServerSession,
    getPreparedWebServerSessionId, prepareStagedWebServerSession, stageWebServerSession,
    tombstoneArmedWebServerSession, type ArmedWebServerSessionPort, type PreparedWebServerSession,
    type StagedWebServerSession,
} from './server-session';

declare const webAuthSessionAttemptBrand: unique symbol;
export type WebAuthSessionAttempt = Readonly<{ readonly [webAuthSessionAttemptBrand]: never }>;
export type WebAuthSessionIssue = Readonly<{ readonly ok: true; readonly sessionId: string }>;
type PendingAttempt = { state: 'pending' | 'burned'; owner: WebAuthAttempt };

const apply = Reflect.apply;
const freeze = Object.freeze;
const create = Object.create;
const assign = Object.assign;
const objectPrototype = Object.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyNames = Object.getOwnPropertyNames;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
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

function exactUser(value: unknown): { id: string; username: string; role: string } | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || getPrototypeOf(value) !== objectPrototype
            || getOwnPropertySymbols(value).length !== 0 || getOwnPropertyNames(value).length !== 3) return null;
        const id = getOwnPropertyDescriptor(value, 'id'); const username = getOwnPropertyDescriptor(value, 'username'); const role = getOwnPropertyDescriptor(value, 'role');
        if (!id || !username || !role || !('value' in id) || !('value' in username) || !('value' in role)
            || !id.enumerable || !username.enumerable || !role.enumerable || typeof id.value !== 'string'
            || typeof username.value !== 'string' || typeof role.value !== 'string') return null;
        return freeze({ id: id.value, username: username.value, role: role.value });
    } catch { return null; }
}

function cleanup(pending: PendingAttempt | undefined, staged: StagedWebServerSession | null,
    prepared: PreparedWebServerSession | null, armed: ArmedWebServerSessionPort | null): void {
    if (armed) { try { tombstoneArmedWebServerSession(armed); } catch { /* terminal denial remains */ } }
    if (prepared) { try { abortPreparedWebServerSession(prepared); } catch { /* terminal denial remains */ } }
    if (staged) { try { abortStagedWebServerSession(staged); } catch { /* terminal denial remains */ } }
    if (pending) cancel(pending);
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

/** Consumes one attempt and synchronously splices one exact staged Web session into P3. */
export function issue(value: unknown, user: unknown): WebAuthSessionIssue | null {
    if (!enter()) return null;
    let pending: PendingAttempt | undefined; let staged: StagedWebServerSession | null = null;
    let prepared: PreparedWebServerSession | null = null; let armed: ArmedWebServerSessionPort | null = null;
    try {
        pending = get(value);
        if (operationPoisoned || !pending || pending.state !== 'pending') { if (operationPoisoned && pending) { pending.state = 'burned'; cancel(pending); } return null; }
        pending.state = 'burned';
        if (typeof value !== 'object' || value === null) { cancel(pending); return null; }
        try { drop(value); } catch { cancel(pending); return null; }
        if (operationPoisoned) { cancel(pending); return null; }
        const exact = exactUser(user);
        if (operationPoisoned || !exact) { cancel(pending); return null; }
        staged = stageWebServerSession(exact);
        if (operationPoisoned || !staged) { cleanup(pending, staged, prepared, armed); return null; }
        prepared = prepareStagedWebServerSession(staged);
        if (operationPoisoned || !prepared) { cleanup(pending, staged, prepared, armed); return null; }
        const sessionId = getPreparedWebServerSessionId(prepared);
        if (operationPoisoned || !sessionId) { cleanup(pending, staged, prepared, armed); return null; }
        const activation = prepareWebAuthActivation(pending.owner, sessionId);
        if (operationPoisoned || !activation) { cleanup(pending, staged, prepared, armed); return null; }
        armed = armPreparedWebServerSession(prepared);
        if (operationPoisoned || !armed) { cleanup(pending, staged, prepared, armed); return null; }
        const result = freeze(assign(create(null), { ok: true, sessionId })) as WebAuthSessionIssue;
        const activated = activatePreparedWebAuthSession(pending.owner, activation, armed);
        if (!activated || operationPoisoned) { cleanup(pending, staged, prepared, armed); return null; }
        return result;
    } catch { cleanup(pending, staged, prepared, armed); return null; }
    finally { leave(); }
}

/** Burns one pending attempt and its owner control reservation. */
export function abort(value: unknown): boolean {
    if (!enter()) return false;
    try {
        const pending = get(value);
        if (operationPoisoned || !pending || pending.state !== 'pending') { if (operationPoisoned && pending) { pending.state = 'burned'; cancel(pending); } return false; }
        if (typeof value !== 'object' || value === null || isProxy(value)) { pending.state = 'burned'; cancel(pending); return false; }
        pending.state = 'burned';
        try { drop(value); } catch { cancel(pending); return false; }
        const cancelled = (() => { try { return cancelWebAuth(pending.owner); } catch { return false; } })();
        return !operationPoisoned && cancelled;
    } catch { return false; }
    finally { leave(); }
}
