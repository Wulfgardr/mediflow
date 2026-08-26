/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    resolveDocumentSynthesisSourceSetExecutionInputAccessor,
    resolveDocumentSynthesisSourceSetValidation,
    type DocumentSynthesisSourceSetCurrentness,
    type DocumentSynthesisSourceSetValidationResult,
} from './document-synthesis-source-set-currentness-owner';
import { isServerSessionProjectionOwner, type DocumentSynthesisLeaseCommitPort, type DocumentSynthesisLeaseCommitRef, type ServerSessionProjectionOwner } from '../../security/server-session-projection-owner';

declare const sourceSetLeaseInput: unique symbol;
declare const sourceSetExecution: unique symbol;
export type DocumentSynthesisSourceSetLeaseInput = Readonly<{ readonly [sourceSetLeaseInput]?: never }>;
export type DocumentSynthesisSourceSetExecution = Readonly<{ readonly [sourceSetExecution]?: never }>;
export type DocumentSynthesisSourceSetLease = Readonly<{
    issue(): DocumentSynthesisSourceSetLeaseInput | null;
    beginExecution(input: unknown): DocumentSynthesisSourceSetExecution | null;
    takeProviderInput(input: unknown): Readonly<{ prompt: string }> | null;
    validateProviderEnvelope(input: unknown): DocumentSynthesisSourceSetValidationResult;
    consume(input: unknown): boolean;
    dispose(): void;
}>;

type Witness = Readonly<{ epoch: bigint; revocation: bigint; sources: readonly Readonly<{ ref: string; revision: bigint; freshness: bigint }>[] }>;
type Entry = { state: 'issued' | 'in_flight' | 'input_taken' | 'validated' | 'finalized' | 'denied'; expected: DocumentSynthesisLeaseCommitRef; witness: Witness; provider: Readonly<{ prompt: string }>; validationToken: object; execution: object | null };
const OBJECT = Object.prototype; const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn; const ObjectIsFrozen = Object.isFrozen; const ReflectOwnKeys = Reflect.ownKeys; const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap; const WeakSetConstructor = WeakSet; const weakMapGet = WeakMap.prototype.get; const weakMapSet = WeakMap.prototype.set; const weakSetAdd = WeakSet.prototype.add; const weakSetHas = WeakSet.prototype.has; const apply = Reflect.apply;

export class DocumentSynthesisSourceSetLeaseConfigurationError extends Error { constructor() { super('Document synthesis source-set lease configuration rejected'); this.name = 'DocumentSynthesisSourceSetLeaseConfigurationError'; } }
const denied = ObjectFreeze({ status: 'denied' as const, code: 'input_invalid' as const, output: null, outputSha256: null, citations: null, claims: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, sourceSetDigestSha256: null }) as DocumentSynthesisSourceSetValidationResult;

function exact(value: unknown, keys: readonly string[], prototype: object | null): Record<string, unknown> | null {
    try { if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== prototype || ReflectOwnKeys(value).length !== keys.length) return null; const output = ObjectCreate(null) as Record<string, unknown>; for (const key of keys) { const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; output[key] = descriptor.value; } return output; } catch { return null; }
}
function witness(value: DocumentSynthesisSourceSetCurrentness | null): Witness | null {
    try { if (!value) return null; const sources: Array<Readonly<{ ref: string; revision: bigint; freshness: bigint }>> = []; for (let index = 0; index < value.sources.length; index += 1) { const source = value.sources[index]!; sources[index] = ObjectFreeze({ ref: source.documentSourceRef, revision: source.documentRevision, freshness: source.documentFreshnessEpoch }); } return ObjectFreeze({ epoch: value.sourceSetEpoch, revocation: value.revocationGeneration, sources: ObjectFreeze(sources) }); } catch { return null; }
}
function execution(value: unknown): Readonly<{ witness: Witness; provider: Readonly<{ prompt: string }>; validationToken: object }> | null {
    const input = exact(value, ['currentness', 'prompt', 'validationToken'], null);
    if (!input || typeof input.prompt !== 'string' || typeof input.validationToken !== 'object' || input.validationToken === null || IsProxy(input.validationToken)) return null;
    const current = witness(input.currentness as DocumentSynthesisSourceSetCurrentness | null);
    return current ? ObjectFreeze({ witness: current, provider: ObjectFreeze(ObjectCreate(null, { prompt: { enumerable: true, value: input.prompt } })) as Readonly<{ prompt: string }>, validationToken: input.validationToken }) : null;
}
function same(left: Witness, right: Witness | null): boolean { if (!right || left.epoch !== right.epoch || left.revocation !== right.revocation || left.sources.length !== right.sources.length) return false; for (let index = 0; index < left.sources.length; index += 1) { const a = left.sources[index]!; const b = right.sources[index]!; if (a.ref !== b.ref || a.revision !== b.revision || a.freshness !== b.freshness) return false; } return true; }

/** Binds one owner-minted source snapshot to a one-shot, server-only provider handoff. */
export function createDocumentSynthesisSourceSetLease(value: unknown): DocumentSynthesisSourceSetLease {
    const input = exact(value, ['owner', 'session', 'capsule'], OBJECT); const owner = input?.owner; const session = input?.session; const capsule = input?.capsule;
    const accessor = input && isServerSessionProjectionOwner(owner) && !IsProxy(session) ? resolveDocumentSynthesisSourceSetExecutionInputAccessor(input.capsule, owner, session) : null;
    if (!input || !accessor || !isServerSessionProjectionOwner(owner)) throw new DocumentSynthesisSourceSetLeaseConfigurationError();
    let port: DocumentSynthesisLeaseCommitPort; try { port = owner.mintDocumentSynthesisLeaseCommitPort(session as Parameters<ServerSessionProjectionOwner['mintDocumentSynthesisLeaseCommitPort']>[0]); } catch { throw new DocumentSynthesisSourceSetLeaseConfigurationError(); }
    let closed = false; let active = false; let reentered = false; let issued = false;
    const issues = new WeakSetConstructor<object>(); const executions = new WeakSetConstructor<object>(); const entries = new WeakMapConstructor<object, Entry>();
    const has = (set: WeakSet<object>, value: unknown): value is object => typeof value === 'object' && value !== null && !IsProxy(value) && apply(weakSetHas, set, [value]);
    const close = () => { closed = true; port.dispose(); }; const enter = () => { if (closed || active) { if (active) reentered = true; return false; } active = true; reentered = false; return true; }; const leave = () => { active = false; };
    const tokenEntry = (token: unknown, state?: Entry['state']) => { if (!has(executions, token)) return null; const entry = apply(weakMapGet, entries, [token]) as Entry | undefined; return entry && (!state || entry.state === state) ? entry : null; };
    return ObjectFreeze({
        issue() { if (!enter()) return null; try { const state = port.snapshot(); const current = execution(accessor.snapshotExecutionInput()); if (issued || !state || state.terminal || state.stagedRef !== null || !current || reentered) { if (reentered) close(); return null; } const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisSourceSetLeaseInput; issued = true; apply(weakSetAdd, issues, [token]); apply(weakMapSet, entries, [token, { state: 'issued', expected: state.currentRef, witness: current.witness, provider: current.provider, validationToken: current.validationToken, execution: null }]); return token; } finally { leave(); } },
        beginExecution(token: unknown) { if (!enter()) return null; try { if (!has(issues, token)) return null; const entry = apply(weakMapGet, entries, [token]) as Entry | undefined; const state = port.snapshot(); const current = execution(accessor.snapshotExecutionInput()); if (!entry || entry.state !== 'issued' || !state || state.terminal || state.stagedRef !== null || state.currentRef !== entry.expected || !current || !same(entry.witness, current.witness) || entry.provider.prompt !== current.provider.prompt || reentered) { if (entry) entry.state = 'denied'; close(); return null; } const executionToken = ObjectFreeze(ObjectCreate(null)); entry.state = 'in_flight'; entry.execution = executionToken; apply(weakSetAdd, executions, [executionToken]); apply(weakMapSet, entries, [executionToken, entry]); return executionToken as DocumentSynthesisSourceSetExecution; } finally { leave(); } },
        takeProviderInput(token: unknown) { if (!enter()) return null; try { const entry = tokenEntry(token, 'in_flight'); if (!entry) return null; entry.state = 'input_taken'; return entry.provider; } finally { leave(); } },
        validateProviderEnvelope(value: unknown) { if (!enter()) return denied; try { const input = exact(value, ['executionToken', 'envelopeToken'], OBJECT); const entry = input && tokenEntry(input.executionToken, 'input_taken'); if (!input || !entry || typeof input.envelopeToken !== 'object' || input.envelopeToken === null || IsProxy(input.envelopeToken)) return denied; entry.state = 'denied'; const result = resolveDocumentSynthesisSourceSetValidation(ObjectFreeze({ validationToken: entry.validationToken, envelopeToken: input.envelopeToken }), capsule, owner, session); if (result.status === 'available' && !reentered) { entry.state = 'validated'; return result; } close(); return result; } finally { leave(); } },
        consume(token: unknown) { if (!enter()) return false; try { const entry = tokenEntry(token); if (!entry || entry.state !== 'validated') { if (entry) { entry.state = 'denied'; close(); } return false; } entry.state = 'finalized'; const replacement = port.prepare(ObjectFreeze({ expected: entry.expected })); const current = execution(accessor.snapshotExecutionInput()); if (!replacement || !current || !same(entry.witness, current.witness) || entry.provider.prompt !== current.provider.prompt || reentered) { if (replacement) port.abort(ObjectFreeze({ replacement })); close(); return false; } if (port.commit(ObjectFreeze({ expected: entry.expected, replacement })) && !reentered) { closed = true; return true; } close(); return false; } finally { leave(); } },
        dispose() { close(); },
    }) as DocumentSynthesisSourceSetLease;
}
