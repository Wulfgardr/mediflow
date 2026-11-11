import 'server-only';

import { types } from 'node:util';

import { resolveDocumentSynthesisFabricExecutionHandoff, type DocumentSynthesisFabricExecutionCapability } from './document-synthesis-fabric-admission';
import { parseDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope';
import { runLocalGenerationAttempts } from './local-generation-attempts';
import type { LocalProviderResolution } from '../registry';

export type DocumentSynthesisFabricPreparedExecutionToken = object;
type DenialCode = 'input_invalid' | 'handoff_unavailable' | 'binding_invalid' | 'provider_unavailable' | 'provider_timeout' | 'response_invalid' | 'validation_denied' | 'canceled';
export type DocumentSynthesisFabricExecutionPrepareResult = Readonly<{ status: 'available'; code: null; preparedToken: DocumentSynthesisFabricPreparedExecutionToken; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract' }>
    | Readonly<{ status: 'denied'; code: DenialCode; preparedToken: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract' }>;

type Entry = { state: 'running' | 'prepared' | 'aborted'; handoff: object; execution: DocumentSynthesisFabricExecutionCapability; controller: AbortController; timer: ReturnType<typeof setTimeout> | null; settle: ((outcome: Outcome) => void) | null; validation: unknown; envelope: object | null };
type Outcome = Readonly<{ kind: 'response'; value: unknown }> | Readonly<{ kind: 'failure' | 'timeout' }>;
const OBJECT = Object.prototype; const ObjectAssign = Object.assign; const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn; const ReflectApply = Reflect.apply; const ReflectOwnKeys = Reflect.ownKeys; const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap; const WeakMapGet = WeakMap.prototype.get; const WeakMapSet = WeakMap.prototype.set; const WeakMapDelete = WeakMap.prototype.delete; const PromiseConstructor = Promise; const PromiseThen = Promise.prototype.then; const AbortControllerConstructor = AbortController; const SetTimeout = setTimeout; const ClearTimeout = clearTimeout;
const handoffs = new WeakMapConstructor<object, Entry>(); const prepared = new WeakMapConstructor<object, Entry>(); const COMMON = ObjectFreeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied_by_contract' as const });
let timeoutMs = 300_000;
// Tetto dei token di risposta. Collaudo dell'11/11/2026 (qwen3.5:35b-a3b, JSON indentato): sul
// referto cardiologico sintetico (prompt di 5544 caratteri) l'involucro completo chiedeva 1306 e
// 1911 token, sugli esami (5302 caratteri) 1156-1387; il vecchio tetto di 1400 tagliava 8 risposte
// su 10. Citazioni ed evidenze copiano testo del documento, quindi l'involucro cresce col prompt:
// mezzo token per carattere (le misure stanno fra 0,22 e 0,35) e mai meno di 2560 (1911 piu' un
// terzo). Il soffitto copre il prompt piu' lungo ammesso (12 000 unita' di testo piu' le istruzioni).
const RESPONSE_TOKENS_FLOOR = 2560; const RESPONSE_TOKENS_CEILING = 8192; const MathCeil = Math.ceil;
function documentSynthesisResponseTokenLimit(prompt: string): number { const proportional = MathCeil(prompt.length / 2); return proportional < RESPONSE_TOKENS_FLOOR ? RESPONSE_TOKENS_FLOOR : proportional > RESPONSE_TOKENS_CEILING ? RESPONSE_TOKENS_CEILING : proportional; }

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function denied(code: DenialCode): DocumentSynthesisFabricExecutionPrepareResult { return frozen({ status: 'denied' as const, code, preparedToken: null, ...COMMON }) as DocumentSynthesisFabricExecutionPrepareResult; }
function opaque(value: unknown): value is object { try { return typeof value === 'object' && value !== null && !IsProxy(value); } catch { return false; } }
function abort(entry: Entry): void { if (entry.state === 'aborted') return; entry.state = 'aborted'; if (entry.timer !== null) { ClearTimeout(entry.timer); entry.timer = null; } try { entry.controller.abort(); } catch { /* The local signal is never caller authority. */ } entry.settle?.(frozen({ kind: 'failure' as const })); try { entry.execution.abort(); } catch { /* B2ab remains fail-closed. */ } ReflectApply(WeakMapDelete, handoffs, [entry.handoff]); }
function responseContent(value: unknown): object | null {
    try { if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== 2) return null; const content = ObjectGetOwnPropertyDescriptor(value, 'content'); const stats = ObjectGetOwnPropertyDescriptor(value, 'stats'); if (!content || !stats || !content.enumerable || !stats.enumerable || !ObjectHasOwn(content, 'value') || !ObjectHasOwn(stats, 'value') || typeof content.value !== 'string') return null; return ObjectFreeze({ content: content.value }); } catch { return null; }
}
function invoke(entry: Entry, resolution: LocalProviderResolution, prompt: string): Promise<Outcome> {
    let resolveOutcome!: (value: Outcome) => void;
    const outcome = new PromiseConstructor<Outcome>((resolve) => { resolveOutcome = resolve; }); entry.settle = resolveOutcome;
    entry.timer = SetTimeout(() => { if (entry.state === 'running') { try { entry.controller.abort(); } catch { /* Internal timeout only. */ } resolveOutcome(frozen({ kind: 'timeout' as const })); } }, timeoutMs);
    let returned: unknown; try { returned = resolution.adapter.chat([{ role: 'user', content: prompt }], entry.controller.signal, documentSynthesisResponseTokenLimit(prompt), ObjectFreeze({ responseFormat: 'document_synthesis_v2' })); } catch { resolveOutcome(frozen({ kind: 'failure' as const })); return outcome; }
    try {
        if (opaque(returned) && ObjectGetPrototypeOf(returned) === PromiseConstructor.prototype) { const observed = ReflectApply(PromiseThen, returned, [(value: unknown) => resolveOutcome(frozen({ kind: 'response' as const, value })), () => resolveOutcome(frozen({ kind: 'failure' as const }))]); ReflectApply(PromiseThen, observed, [() => undefined, () => undefined]); }
        else { const then = opaque(returned) ? ObjectGetOwnPropertyDescriptor(returned, 'then') : null; if (then && ObjectHasOwn(then, 'value') && typeof then.value === 'function') { const tail = ReflectApply(then.value, returned, [(value: unknown) => resolveOutcome(frozen({ kind: 'response' as const, value })), () => resolveOutcome(frozen({ kind: 'failure' as const }))]); if (opaque(tail) && ObjectGetPrototypeOf(tail) === PromiseConstructor.prototype) ReflectApply(PromiseThen, tail, [() => undefined, () => undefined]); } else resolveOutcome(frozen({ kind: 'response' as const, value: returned })); }
    } catch { resolveOutcome(frozen({ kind: 'failure' as const })); }
    return outcome;
}

function truncatedResponse(value: unknown): boolean {
    try { if (!value || typeof value !== 'object' || IsProxy(value)) return false; const stats = ObjectGetOwnPropertyDescriptor(value, 'stats'); const inner = stats && ObjectHasOwn(stats, 'value') ? stats.value : null; if (!inner || typeof inner !== 'object' || IsProxy(inner)) return false; const flag = ObjectGetOwnPropertyDescriptor(inner, 'truncated'); return !!flag && ObjectHasOwn(flag, 'value') && flag.value === true; } catch { return false; }
}

/**
 * Resolves one B2ab handoff and invokes its fixed local binding; returns no provider output.
 * Come il Quadro paziente (#891): se l'involucro della risposta non si legge o la risposta e'
 * tagliata dal tetto di token, la stessa richiesta parte una seconda volta, mai di piu'. La
 * validazione delle fonti chiude il lease e non si ritenta. `stillCurrent` (consenso e
 * attualita' letti dal chiamante) e l'annullamento si rileggono prima del secondo tentativo.
 */
export async function prepareDocumentSynthesisFabricExecution(handoff: unknown, stillCurrent?: unknown): Promise<DocumentSynthesisFabricExecutionPrepareResult> {
    if (!opaque(handoff)) return denied('input_invalid');
    const retained = ReflectApply(WeakMapGet, handoffs, [handoff]) as Entry | undefined;
    if (retained) { abort(retained); return denied('canceled'); }
    const admission = resolveDocumentSynthesisFabricExecutionHandoff(handoff); if (!admission) return denied('handoff_unavailable');
    const entry: Entry = { state: 'running', handoff, execution: admission.execution, controller: new AbortControllerConstructor(), timer: null, settle: null, validation: null, envelope: null };
    ReflectApply(WeakMapSet, handoffs, [handoff, entry]);
    const input = entry.execution.takeProviderInput(); if (!input) { abort(entry); return denied('input_invalid'); }
    const current = typeof stillCurrent === 'function' && !IsProxy(stillCurrent) ? stillCurrent as () => unknown : null;
    const failure: { code: DenialCode } = { code: 'provider_unavailable' };
    // L'ammissione accetta solo una ricevuta `local_process`: il luogo e' sempre il modello locale.
    const outcome = await runLocalGenerationAttempts<object, DenialCode>({
        venue: 'local_process',
        attempt: async () => {
            const settled = await invoke(entry, admission.resolution, input.prompt);
            if (entry.timer !== null) { ClearTimeout(entry.timer); entry.timer = null; } entry.settle = null;
            if (entry.state !== 'running') { failure.code = 'canceled'; return ObjectFreeze({ status: 'provider_failed' as const }); }
            if (settled.kind === 'timeout') { failure.code = 'provider_timeout'; return ObjectFreeze({ status: 'provider_failed' as const }); }
            if (settled.kind !== 'response') { failure.code = 'provider_unavailable'; return ObjectFreeze({ status: 'provider_failed' as const }); }
            if (truncatedResponse(settled.value)) return ObjectFreeze({ status: 'rejected' as const, reason: 'truncated' as const });
            const parsed = parseDocumentSynthesisProviderEnvelope(responseContent(settled.value));
            return parsed.status === 'available' ? ObjectFreeze({ status: 'accepted' as const, value: parsed.token }) : ObjectFreeze({ status: 'rejected' as const, reason: 'invalid' as const });
        },
        between: async () => {
            if (entry.state !== 'running') return 'canceled';
            try { if (current && current() !== true) return 'canceled'; } catch { return 'canceled'; }
            return entry.state === 'running' ? null : 'canceled';
        },
    });
    if (outcome.status === 'stopped') { abort(entry); return denied(outcome.stop); }
    if (outcome.status === 'provider_failed') { if (failure.code !== 'canceled') abort(entry); return denied(failure.code); }
    if (outcome.status === 'rejected') { abort(entry); return denied('response_invalid'); }
    const validation = entry.execution.validateProviderEnvelope(outcome.value);
    if (validation.status !== 'available') { abort(entry); return denied('validation_denied'); }
    const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisFabricPreparedExecutionToken;
    entry.state = 'prepared'; entry.validation = validation; entry.envelope = outcome.value; ReflectApply(WeakMapDelete, handoffs, [handoff]); ReflectApply(WeakMapSet, prepared, [token, entry]);
    return frozen({ status: 'available' as const, code: null, preparedToken: token, ...COMMON }) as DocumentSynthesisFabricExecutionPrepareResult;
}

/** Cancels only the authentic handoff retained by an active preparation. */
export function cancelDocumentSynthesisFabricExecutionPrepare(handoff: unknown): void { if (!opaque(handoff)) return; const entry = ReflectApply(WeakMapGet, handoffs, [handoff]) as Entry | undefined; if (entry) abort(entry); }

/** Burns only an authentic prepared token; C3d3c1 never finalizes it. */
export function disposeDocumentSynthesisFabricPreparedExecution(token: unknown): void { if (!opaque(token)) return; const entry = ReflectApply(WeakMapGet, prepared, [token]) as Entry | undefined; if (!entry) return; abort(entry); ReflectApply(WeakMapDelete, prepared, [token]); }

/** Atomically burns one prepared token and tail-calls its already validated execution. */
export function finalizeDocumentSynthesisFabricPreparedExecution(token: unknown): ReturnType<DocumentSynthesisFabricExecutionCapability['finalize']> { if (!opaque(token)) return null; const entry = ReflectApply(WeakMapGet, prepared, [token]) as Entry | undefined; if (!entry || entry.state !== 'prepared') return null; const execution = entry.execution; entry.state = 'aborted'; ReflectApply(WeakMapDelete, prepared, [token]); return execution.finalize(); }

/** Test-only timing seam. It cannot alter provider, prompt, output, or B2ab authority. */
export function setDocumentSynthesisFabricExecutionPrepareTimeoutForTest(value: unknown): (() => void) | null { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 300_000) return null; const prior = timeoutMs; timeoutMs = value; return () => { timeoutMs = prior; }; }
