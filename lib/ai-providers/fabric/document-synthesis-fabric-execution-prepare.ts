/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { resolveDocumentSynthesisFabricExecutionHandoff, type DocumentSynthesisFabricExecutionCapability } from './document-synthesis-fabric-admission';
import { parseDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope';
import { claimDocumentSynthesisProviderBindingForExecution, type DocumentSynthesisProviderBindingReceipt } from './document-synthesis-provider-binding';

export type DocumentSynthesisFabricPreparedExecutionToken = object;
type DenialCode = 'input_invalid' | 'handoff_unavailable' | 'binding_invalid' | 'provider_unavailable' | 'provider_timeout' | 'response_invalid' | 'validation_denied' | 'canceled';
export type DocumentSynthesisFabricExecutionPrepareResult = Readonly<{ status: 'available'; code: null; preparedToken: DocumentSynthesisFabricPreparedExecutionToken; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract' }>
    | Readonly<{ status: 'denied'; code: DenialCode; preparedToken: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract' }>;

type Entry = { state: 'running' | 'prepared' | 'aborted'; handoff: object; execution: DocumentSynthesisFabricExecutionCapability; controller: AbortController; timer: ReturnType<typeof setTimeout> | null; settle: ((outcome: Outcome) => void) | null; validation: unknown; envelope: object | null; receipt: DocumentSynthesisProviderBindingReceipt | null };
type Outcome = Readonly<{ kind: 'response'; value: unknown }> | Readonly<{ kind: 'failure' | 'timeout' }>;
const OBJECT = Object.prototype; const ObjectAssign = Object.assign; const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn; const ReflectApply = Reflect.apply; const ReflectOwnKeys = Reflect.ownKeys; const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap; const WeakMapGet = WeakMap.prototype.get; const WeakMapSet = WeakMap.prototype.set; const WeakMapDelete = WeakMap.prototype.delete; const PromiseConstructor = Promise; const PromiseThen = Promise.prototype.then; const AbortControllerConstructor = AbortController; const SetTimeout = setTimeout; const ClearTimeout = clearTimeout;
const handoffs = new WeakMapConstructor<object, Entry>(); const prepared = new WeakMapConstructor<object, Entry>(); const COMMON = ObjectFreeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied_by_contract' as const });
let timeoutMs = 300_000;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function denied(code: DenialCode): DocumentSynthesisFabricExecutionPrepareResult { return frozen({ status: 'denied' as const, code, preparedToken: null, ...COMMON }) as DocumentSynthesisFabricExecutionPrepareResult; }
function opaque(value: unknown): value is object { try { return typeof value === 'object' && value !== null && !IsProxy(value); } catch { return false; } }
function abort(entry: Entry): void { if (entry.state === 'aborted') return; entry.state = 'aborted'; if (entry.timer !== null) { ClearTimeout(entry.timer); entry.timer = null; } try { entry.controller.abort(); } catch { /* The local signal is never caller authority. */ } entry.settle?.(frozen({ kind: 'failure' as const })); try { entry.execution.abort(); } catch { /* B2ab remains fail-closed. */ } ReflectApply(WeakMapDelete, handoffs, [entry.handoff]); }
function responseContent(value: unknown): object | null {
    try { if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== 2) return null; const content = ObjectGetOwnPropertyDescriptor(value, 'content'); const stats = ObjectGetOwnPropertyDescriptor(value, 'stats'); if (!content || !stats || !content.enumerable || !stats.enumerable || !ObjectHasOwn(content, 'value') || !ObjectHasOwn(stats, 'value') || typeof content.value !== 'string') return null; return ObjectFreeze({ content: content.value }); } catch { return null; }
}
function invoke(entry: Entry, binding: NonNullable<ReturnType<typeof claimDocumentSynthesisProviderBindingForExecution>>['resolution'], prompt: string): Promise<Outcome> {
    let resolveOutcome!: (value: Outcome) => void;
    const outcome = new PromiseConstructor<Outcome>((resolve) => { resolveOutcome = resolve; }); entry.settle = resolveOutcome;
    entry.timer = SetTimeout(() => { if (entry.state === 'running') { try { entry.controller.abort(); } catch { /* Internal timeout only. */ } resolveOutcome(frozen({ kind: 'timeout' as const })); } }, timeoutMs);
    let returned: unknown; try { returned = binding.adapter.chat([{ role: 'user', content: prompt }], entry.controller.signal, 1400, ObjectFreeze({ responseFormat: 'json' })); } catch { resolveOutcome(frozen({ kind: 'failure' as const })); return outcome; }
    try {
        if (opaque(returned) && ObjectGetPrototypeOf(returned) === PromiseConstructor.prototype) { const observed = ReflectApply(PromiseThen, returned, [(value: unknown) => resolveOutcome(frozen({ kind: 'response' as const, value })), () => resolveOutcome(frozen({ kind: 'failure' as const }))]); ReflectApply(PromiseThen, observed, [() => undefined, () => undefined]); }
        else { const then = opaque(returned) ? ObjectGetOwnPropertyDescriptor(returned, 'then') : null; if (then && ObjectHasOwn(then, 'value') && typeof then.value === 'function') { const tail = ReflectApply(then.value, returned, [(value: unknown) => resolveOutcome(frozen({ kind: 'response' as const, value })), () => resolveOutcome(frozen({ kind: 'failure' as const }))]); if (opaque(tail) && ObjectGetPrototypeOf(tail) === PromiseConstructor.prototype) ReflectApply(PromiseThen, tail, [() => undefined, () => undefined]); } else resolveOutcome(frozen({ kind: 'response' as const, value: returned })); }
    } catch { resolveOutcome(frozen({ kind: 'failure' as const })); }
    return outcome;
}

/** Resolves one B2ab handoff, invokes its fixed local binding once, and returns no provider output. */
export async function prepareDocumentSynthesisFabricExecution(handoff: unknown): Promise<DocumentSynthesisFabricExecutionPrepareResult> {
    if (!opaque(handoff)) return denied('input_invalid');
    const retained = ReflectApply(WeakMapGet, handoffs, [handoff]) as Entry | undefined;
    if (retained) { abort(retained); return denied('canceled'); }
    const admission = resolveDocumentSynthesisFabricExecutionHandoff(handoff); if (!admission) return denied('handoff_unavailable');
    const entry: Entry = { state: 'running', handoff, execution: admission.execution, controller: new AbortControllerConstructor(), timer: null, settle: null, validation: null, envelope: null, receipt: null };
    ReflectApply(WeakMapSet, handoffs, [handoff, entry]);
    const binding = claimDocumentSynthesisProviderBindingForExecution(admission.providerToken); if (!binding) { abort(entry); return denied('binding_invalid'); }
    entry.receipt = binding.receipt;
    const input = entry.execution.takeProviderInput(); if (!input) { abort(entry); return denied('input_invalid'); }
    const settled = await invoke(entry, binding.resolution, input.prompt);
    if (entry.timer !== null) { ClearTimeout(entry.timer); entry.timer = null; } entry.settle = null;
    if (entry.state !== 'running') return denied('canceled');
    if (settled.kind === 'timeout') { abort(entry); return denied('provider_timeout'); }
    if (settled.kind !== 'response') { abort(entry); return denied('provider_unavailable'); }
    const parsed = parseDocumentSynthesisProviderEnvelope(responseContent(settled.value));
    if (parsed.status !== 'available') { abort(entry); return denied('response_invalid'); }
    const validation = entry.execution.validateProviderEnvelope(parsed.token);
    if (validation.status !== 'available') { abort(entry); return denied('validation_denied'); }
    const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisFabricPreparedExecutionToken;
    entry.state = 'prepared'; entry.validation = validation; entry.envelope = parsed.token; ReflectApply(WeakMapDelete, handoffs, [handoff]); ReflectApply(WeakMapSet, prepared, [token, entry]);
    return frozen({ status: 'available' as const, code: null, preparedToken: token, ...COMMON }) as DocumentSynthesisFabricExecutionPrepareResult;
}

/** Cancels only the authentic handoff retained by an active preparation. */
export function cancelDocumentSynthesisFabricExecutionPrepare(handoff: unknown): void { if (!opaque(handoff)) return; const entry = ReflectApply(WeakMapGet, handoffs, [handoff]) as Entry | undefined; if (entry) abort(entry); }

/** Burns only an authentic prepared token; C3d3c1 never finalizes it. */
export function disposeDocumentSynthesisFabricPreparedExecution(token: unknown): void { if (!opaque(token)) return; const entry = ReflectApply(WeakMapGet, prepared, [token]) as Entry | undefined; if (!entry) return; abort(entry); ReflectApply(WeakMapDelete, prepared, [token]); }

/** Test-only timing seam. It cannot alter provider, prompt, output, or B2ab authority. */
export function setDocumentSynthesisFabricExecutionPrepareTimeoutForTest(value: unknown): (() => void) | null { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 300_000) return null; const prior = timeoutMs; timeoutMs = value; return () => { timeoutMs = prior; }; }
