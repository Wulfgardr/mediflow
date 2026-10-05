/* Diagnostic candidate r-ocr-92a1. Default OFF. Synthetic owner review required.
 * New namespace only: never replaces fetch, a prototype, a stream or a reader.
 * No callbacks, identifiers, URLs, error objects, payloads or keys enter records.
 */
'use client';

const EVENTS = [
    'operation_begin', 'operation_end', 'effective_signal_abort',
    'abort_pagehide', 'abort_effect_cleanup', 'abort_delete', 'abort_session_listener',
    'abort_view_cleanup', 'abort_list_refresh', 'abort_user_interrupt',
    'session_set_key_clear', 'session_set_key_replace',
    'fetch_call', 'fetch_return', 'fetch_resolved', 'fetch_throw', 'fetch_rejected',
    'source_call', 'source_return', 'source_resolved', 'source_rejected',
    'reader_acquire_call', 'reader_acquired', 'reader_acquire_throw',
    'read_call', 'read_return', 'read_settled', 'read_throw', 'read_rejected', 'read_chunk',
    'read_guard_entry', 'read_guard_pre', 'read_guard_post', 'read_limit',
    'decode_chunk_throw', 'decode_flush_throw', 'body_complete', 'body_absent',
    'text_call', 'text_resolved', 'text_rejected',
    'reader_cancel_abort', 'reader_cancel_cleanup', 'reader_cancel_rejected',
    'reader_release_call', 'reader_release_return', 'reader_release_throw',
    'release_abort', 'release_finally', 'release_skipped',
    'project_guard', 'project_raw_rejected', 'extraction_keys_rejected',
    'client_available', 'client_catch', 'client_finally', 'ui_preview_return', 'ui_result_discarded',
] as const;
export type OcrProbeEvent = typeof EVENTS[number];
export type OcrProbePhase = 'ui' | 'session' | 'acquire' | 'source' | 'project' | 'release';
type Record = Readonly<{ seq: number; op: number; event: OcrProbeEvent; phase: OcrProbePhase;
    ms: number; value: number; flags: number }>;
type Snapshot = Readonly<{ schema: 'mediflow.ocr_causal_probe.v1'; enabled: true;
    total: number; dropped: number; invalid: number; late: number; armed: boolean; sealed: boolean;
    operationCount: number; active: number; events: readonly Record[] }>;
type Control = Readonly<{ arm(): void; snapshot(): Snapshot; seal(): Snapshot }>;
type ProbeGlobal = typeof globalThis & { __mfOcrCausalProbeV1?: Control };

// Both are build-time declarations, NOT proof of an isolated server/database.
// Owner must separately validate the synthetic data directory before build/start.
const enabled = typeof window !== 'undefined'
    && process.env.NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_PROBE === '1'
    && process.env.NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_SYNTHETIC_ONLY === '1';
const allowed = new Set<string>(EVENTS);
const phases = new Set<string>(['ui', 'session', 'acquire', 'source', 'project', 'release']);
const events: Record[] = [];
const signalOperations = new WeakMap<AbortSignal, number>();
const sessionOperations = new WeakMap<AbortSignal, Set<number>>();
const active = new Set<number>();
const signalRemovers: Array<() => void> = [];
let total = 0, dropped = 0, invalid = 0, late = 0, operations = 0;
let installed = false, failed = false, armed = false, sealed = false;
let start = 0;
const MAX_EVENTS = 1024;
const MAX_OPERATIONS = 8;
const MAX_VALUE = 32 * 1024 * 1024;

function snapshot(): Snapshot {
    return { schema: 'mediflow.ocr_causal_probe.v1', enabled: true, total, dropped, invalid, late,
        armed, sealed, operationCount: operations, active: active.size,
        events: events.map(event => ({ ...event })) };
}
function install(): boolean {
    if (!enabled || failed) return false;
    if (installed) return true;
    try {
        const host = globalThis as ProbeGlobal;
        if (Object.getOwnPropertyDescriptor(host, '__mfOcrCausalProbeV1')) { failed = true; return false; }
        start = performance.now();
        const api: Control = Object.freeze({
            arm() {
                if (armed || sealed || operations !== 0) { invalid += 1; return; }
                armed = true;
            },
            snapshot,
            seal() {
                sealed = true;
                for (const remove of signalRemovers) { try { remove(); } catch { invalid += 1; } }
                signalRemovers.length = 0;
                return snapshot();
            },
        });
        Object.defineProperty(host, '__mfOcrCausalProbeV1', { value: api, configurable: false,
            enumerable: false, writable: false });
        installed = true;
        return true;
    } catch { failed = true; return false; }
}
// Install before the E2E collector arms the already loaded document. No network/I/O.
if (enabled) install();

export function ocrProbeRecord(op: number, event: OcrProbeEvent, phase: OcrProbePhase,
    value = 0, flags = 0): void {
    if (!enabled || !installed || failed || !armed) return;
    if (sealed) { late += 1; return; }
    try {
        if (!Number.isSafeInteger(op) || op < 1 || op > operations || !allowed.has(event)
            || !phases.has(phase) || !Number.isSafeInteger(value) || value < 0 || value > MAX_VALUE
            || !Number.isSafeInteger(flags) || flags < 0 || flags > 255) { invalid += 1; return; }
        total += 1;
        if (events.length >= MAX_EVENTS) { dropped += 1; return; }
        const ms = performance.now() - start;
        if (!Number.isFinite(ms) || ms < 0) { invalid += 1; return; }
        events.push({ seq: total, op, event, phase, ms, value, flags });
    } catch { invalid += 1; }
}
export function ocrProbeBegin(controller: AbortSignal, session: AbortSignal, effective: AbortSignal): number {
    if (!install() || !armed || sealed) return 0;
    if (operations >= MAX_OPERATIONS) { invalid += 1; return 0; }
    const op = ++operations;
    signalOperations.set(controller, op); signalOperations.set(effective, op);
    const owners = sessionOperations.get(session) ?? new Set<number>();
    owners.add(op); sessionOperations.set(session, owners); active.add(op);
    // Observe through capture seal, not just UI return: native network completion
    // can be later. Retain signals/numbers only, never the UI operation/source.
    const observedAbort = () => ocrProbeRecord(op, 'effective_signal_abort', 'ui', 0,
        (controller.aborted ? 1 : 0) | (session.aborted ? 2 : 0));
    effective.addEventListener('abort', observedAbort, { once: true });
    signalRemovers.push(() => { effective.removeEventListener('abort', observedAbort); owners.delete(op); });
    ocrProbeRecord(op, 'operation_begin', 'ui', 0, (controller.aborted ? 1 : 0) | (session.aborted ? 2 : 0));
    return op;
}
export function ocrProbeFor(signal?: AbortSignal): number {
    if (!enabled || !armed || !signal) return 0;
    return signalOperations.get(signal) ?? 0;
}
export function ocrProbeEnd(op: number): void {
    if (!op) return;
    ocrProbeRecord(op, 'operation_end', 'ui');
    active.delete(op); // Signal ownership survives UI completion until capture seal.
}
export function ocrProbeSessionRetire(signal: AbortSignal | undefined, replacement: boolean): void {
    if (!enabled || !armed || !signal) return;
    for (const op of sessionOperations.get(signal) ?? []) {
        ocrProbeRecord(op, replacement ? 'session_set_key_replace' : 'session_set_key_clear',
            'session', 0, signal.aborted ? 1 : 0);
    }
}
