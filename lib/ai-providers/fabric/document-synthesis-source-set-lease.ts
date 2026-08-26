/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    resolveDocumentSynthesisSourceSetCurrentnessAccessor,
    type DocumentSynthesisSourceSetCurrentness,
} from './document-synthesis-source-set-currentness-owner';
import {
    isServerSessionProjectionOwner,
    type DocumentSynthesisLeaseCommitPort,
    type DocumentSynthesisLeaseCommitRef,
    type ServerSessionProjectionOwner,
} from '../../security/server-session-projection-owner';

declare const sourceSetLeaseInput: unique symbol;
export type DocumentSynthesisSourceSetLeaseInput = Readonly<{ readonly [sourceSetLeaseInput]?: never }>;
export type DocumentSynthesisSourceSetLease = Readonly<{
    issue(): DocumentSynthesisSourceSetLeaseInput | null;
    consume(input: unknown): boolean;
    dispose(): void;
}>;

type Witness = Readonly<{ epoch: bigint; revocation: bigint; sources: readonly Readonly<{ ref: string; revision: bigint; freshness: bigint }>[] }>;
type Entry = { spent: boolean; expected: DocumentSynthesisLeaseCommitRef; witness: Witness };

const OBJECT = Object.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectIsFrozen = Object.isFrozen;
const ReflectOwnKeys = Reflect.ownKeys;
const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap;
const WeakSetConstructor = WeakSet;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const apply = Reflect.apply;
const inputs = new WeakSetConstructor<object>();
const entries = new WeakMapConstructor<object, Entry>();

export class DocumentSynthesisSourceSetLeaseConfigurationError extends Error {
    constructor() { super('Document synthesis source-set lease configuration rejected'); this.name = 'DocumentSynthesisSourceSetLeaseConfigurationError'; }
}

function exact(value: unknown): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value); if (keys.length !== 3 || keys[0] === undefined) return null;
        const output = ObjectCreate(null) as Record<string, unknown>;
        for (const key of ['owner', 'session', 'capsule']) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function witness(value: DocumentSynthesisSourceSetCurrentness | null): Witness | null {
    if (!value) return null;
    const sources: Array<Readonly<{ ref: string; revision: bigint; freshness: bigint }>> = [];
    for (let index = 0; index < value.sources.length; index += 1) {
        const source = value.sources[index]!;
        sources[index] = ObjectFreeze({ ref: source.documentSourceRef, revision: source.documentRevision, freshness: source.documentFreshnessEpoch });
    }
    return ObjectFreeze({ epoch: value.sourceSetEpoch, revocation: value.revocationGeneration, sources: ObjectFreeze(sources) });
}

function same(left: Witness, right: Witness | null): boolean {
    if (!right || left.epoch !== right.epoch || left.revocation !== right.revocation || left.sources.length !== right.sources.length) return false;
    for (let index = 0; index < left.sources.length; index += 1) {
        const a = left.sources[index]!; const b = right.sources[index]!;
        if (a.ref !== b.ref || a.revision !== b.revision || a.freshness !== b.freshness) return false;
    }
    return true;
}

/** Mints and burns one host-only Document Synthesis execution gate; it never carries source text or provider authority. */
export function createDocumentSynthesisSourceSetLease(value: unknown): DocumentSynthesisSourceSetLease {
    const input = exact(value);
    const owner = input?.owner;
    const session = input?.session;
    const accessor = input && isServerSessionProjectionOwner(owner) && !IsProxy(session)
        ? resolveDocumentSynthesisSourceSetCurrentnessAccessor(input.capsule, owner, session) : null;
    if (!input || !accessor || !isServerSessionProjectionOwner(owner)) throw new DocumentSynthesisSourceSetLeaseConfigurationError();
    let port: DocumentSynthesisLeaseCommitPort;
    try { port = owner.mintDocumentSynthesisLeaseCommitPort(session as Parameters<ServerSessionProjectionOwner['mintDocumentSynthesisLeaseCommitPort']>[0]); }
    catch { throw new DocumentSynthesisSourceSetLeaseConfigurationError(); }
    let closed = false; let active = false; let reentered = false;
    const close = () => { closed = true; port.dispose(); };
    const enter = () => { if (closed || active) { if (active) reentered = true; return false; } active = true; reentered = false; return true; };
    const leave = () => { active = false; };
    const lease = ObjectFreeze({
        issue() {
            if (!enter()) return null;
            try {
                const state = port.snapshot(); const current = witness(accessor.snapshot());
                if (!state || state.terminal || state.stagedRef !== null || !current || reentered) { if (reentered) close(); return null; }
                const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisSourceSetLeaseInput;
                apply(weakSetAdd, inputs, [token]); apply(weakMapSet, entries, [token, { spent: false, expected: state.currentRef, witness: current }]);
                return token;
            } finally { leave(); }
        },
        consume(token: unknown) {
            if (!enter()) return false;
            try {
                if (typeof token !== 'object' || token === null || IsProxy(token) || !apply(weakSetHas, inputs, [token])) return false;
                const entry = apply(weakMapGet, entries, [token]) as Entry | undefined;
                if (!entry || entry.spent) return false;
                entry.spent = true;
                const replacement = port.prepare(ObjectFreeze({ expected: entry.expected }));
                if (!replacement || reentered || !same(entry.witness, witness(accessor.snapshot()))) { if (replacement) port.abort(ObjectFreeze({ replacement })); close(); return false; }
                if (port.commit(ObjectFreeze({ expected: entry.expected, replacement })) && !reentered) { closed = true; return true; }
                close(); return false;
            } finally { leave(); }
        },
        dispose() { close(); },
    }) as DocumentSynthesisSourceSetLease;
    return lease;
}
