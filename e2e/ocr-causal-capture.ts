/* Candidate r-ocr-92a1: owner-local synthetic capture, never a test oracle.
 * Reads the NEW source probe namespace. Does not wrap fetch/readers, add headers,
 * touch CDP streaming, read response bodies, or alter test timeouts/retries.
 */
import type { Page, Request as BrowserRequest, Response as BrowserResponse, TestInfo } from '@playwright/test';
import contract from '../scripts/anydoc-diagnostic-contract.cjs';

const APP_EVENTS = new Set<string>([
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
]);
const APP_PHASES = new Set(['ui', 'session', 'acquire', 'source', 'project', 'release']);
type Phase = 'acquire' | 'source' | 'project' | 'release' | 'context';
type Event = 'request' | 'response' | 'finished' | 'failed' | 'navigation' | 'closed' | 'crashed';
type Row = { seq: number; req: number; phase: Phase; event: Event; value: number };
type NewProbe = { arm(): void; snapshot(): unknown; seal(): unknown };
type Host = typeof globalThis & { __mfOcrCausalProbeV1?: NewProbe };
const natural = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
function exact(x: unknown, keys: readonly string[]): x is Record<string, unknown> {
    return !!x && typeof x === 'object' && !Array.isArray(x)
        && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
}
function cleanApp(value: unknown) {
    const keys = ['schema','enabled','total','dropped','invalid','late','armed','sealed','operationCount','active','events'];
    if (!exact(value, keys) || value.schema !== 'mediflow.ocr_causal_probe.v1' || value.enabled !== true
        || typeof value.armed !== 'boolean' || typeof value.sealed !== 'boolean'
        || !['total','dropped','invalid','late','operationCount','active'].every(k => natural(value[k]))
        || !Array.isArray(value.events) || value.events.length > 1024) return null;
    const rows: Array<{ seq: number; op: number; event: string; phase: string; ms: number; value: number; flags: number }> = [];
    for (const row of value.events) {
        if (!exact(row, ['seq','op','event','phase','ms','value','flags']) || !natural(row.seq)
            || !natural(row.op, 8) || row.op === 0 || typeof row.event !== 'string' || !APP_EVENTS.has(row.event)
            || typeof row.phase !== 'string' || !APP_PHASES.has(row.phase)
            || typeof row.ms !== 'number' || !Number.isFinite(row.ms) || row.ms < 0
            || !natural(row.value, 32 * 1024 * 1024) || !natural(row.flags, 255)) return null;
        // Construct the export; never forward unknown fields, objects or text.
        rows.push({ seq: row.seq, op: row.op, event: row.event, phase: row.phase,
            ms: row.ms, value: row.value, flags: row.flags });
    }
    return { schema: 'mediflow.ocr_causal_probe.v1', enabled: true,
        total: value.total as number, dropped: value.dropped as number, invalid: value.invalid as number,
        late: value.late as number, armed: value.armed, sealed: value.sealed,
        operationCount: value.operationCount as number, active: value.active as number, events: rows };
}

export async function beginOcrCausalCapture(page: Page, attachmentId: string) {
    // Existing source contract checks absolute isolated directory, matching E2E dir,
    // both legacy-copy guards and the non-symlink synthetic marker. It is not a
    // security approval or an attestation of the running server's directory.
    contract.assertSyntheticFixture(process.env);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1')
        throw new Error('OCR_CAUSAL_SYNTHETIC_OPT_IN_REQUIRED');
    // Used for in-memory selection only. No URL, identifier or headers are exported.
    const detail = new URL(`/api/attachments/${encodeURIComponent(attachmentId)}`, page.url()).href;
    const endpoint = `${detail}/local-extraction`;
    const rows: Row[] = [];
    const owners = new WeakMap<BrowserRequest, number>();
    const states = new Map<number, { phase: Phase; terminals: number }>();
    let total = 0, dropped = 0, invalid = 0, next = 0, sealed = false, late = 0;
    const emit = (event: Event, req = 0, phase: Phase = 'context', value = 0) => {
        if (sealed) { late++; return; }
        if (!natural(value, 65535)) { invalid++; return; }
        total++;
        if (rows.length >= 256) { dropped++; return; }
        rows.push({ seq: total, req, phase, event, value });
    };
    const request = (value: BrowserRequest) => {
        try {
            const url = value.url(), method = value.method();
            let phase: Phase | undefined;
            if (url === detail && method === 'GET') phase = 'source';
            else if (url === endpoint && method === 'DELETE') phase = 'release';
            else if (url === endpoint && method === 'POST') {
                const action = value.headers()['x-mediflow-extraction-action'];
                if (action === 'acquire' || action === 'project') phase = action;
                else invalid++;
            }
            if (!phase) return;
            if (next >= 16 || owners.has(value)) { invalid++; return; }
            const req = ++next; owners.set(value, req); states.set(req, { phase, terminals: 0 });
            emit('request', req, phase);
        } catch { invalid++; }
    };
    const response = (value: BrowserResponse) => {
        try {
            const req = owners.get(value.request()); const state = req ? states.get(req) : undefined;
            if (req && state) emit('response', req, state.phase, value.status());
        } catch { invalid++; }
    };
    const terminal = (value: BrowserRequest, event: 'finished' | 'failed') => {
        const req = owners.get(value); const state = req ? states.get(req) : undefined;
        if (req && state) { state.terminals++; emit(event, req, state.phase); }
    };
    const finished = (r: BrowserRequest) => terminal(r, 'finished');
    const failed = (r: BrowserRequest) => terminal(r, 'failed');
    const navigation = (frame: import('@playwright/test').Frame) => { if (frame === page.mainFrame()) emit('navigation'); };
    const closed = () => emit('closed'); const crashed = () => emit('crashed');
    page.on('request', request); page.on('response', response);
    page.on('requestfinished', finished); page.on('requestfailed', failed);
    page.on('framenavigated', navigation); page.on('close', closed); page.on('crash', crashed);
    const detach = () => {
        page.off('request', request); page.off('response', response);
        page.off('requestfinished', finished); page.off('requestfailed', failed);
        page.off('framenavigated', navigation); page.off('close', closed); page.off('crash', crashed);
    };
    try {
        const initial = cleanApp(await page.evaluate(() => {
            const probe = (globalThis as Host).__mfOcrCausalProbeV1;
            if (!probe) return null;
            probe.arm(); return probe.snapshot();
        }));
        if (!initial || !initial.armed || initial.sealed || initial.operationCount !== 0
            || initial.active !== 0 || initial.total !== 0 || initial.events.length !== 0
            || initial.dropped !== 0 || initial.invalid !== 0 || initial.late !== 0)
            throw new Error('OCR_CAUSAL_SOURCE_PROBE_UNAVAILABLE');
    } catch { detach(); throw new Error('OCR_CAUSAL_ARM_FAILED'); }
    return {
        async attachAndSeal(testInfo: TestInfo) {
            // Called ONLY at the existing final observation boundary. No polling,
            // extra wait for EOF, changed assertion, or new terminal condition.
            // Never infer absence of app abort if the network terminal arrives
            // while the page is already sealed. Require terminals BEFORE sending
            // the seal command; late-arriving terminals remain incomplete.
            const requestsBeforeSeal = next;
            const browserSettledBeforeSeal = [...states.values()].every(s => s.terminals === 1);
            let app: ReturnType<typeof cleanApp> = null;
            try { app = cleanApp(await page.evaluate(() => (globalThis as Host).__mfOcrCausalProbeV1?.seal() ?? null)); }
            catch { /* Missing page/realm is an explicit coverage gap below. */ }
            sealed = true; detach();
            const phases = ['acquire','source','project','release'] as const;
            const roots = phases.map(phase => ({ phase, count: [...states.values()].filter(s => s.phase === phase).length }));
            const browserComplete = browserSettledBeforeSeal && requestsBeforeSeal === next && !dropped && !invalid && !late
                && [...states.values()].every(s => s.terminals === 1)
                && !rows.some(r => r.phase === 'context');
            const appComplete = !!app && app.sealed && app.armed && app.active === 0 && app.operationCount === 1
                && app.total === app.events.length && app.dropped === 0 && app.invalid === 0 && app.late === 0
                && app.events.every((r, i) => r.seq === i + 1 && r.op === 1)
                && app.events.filter(r => r.event === 'operation_begin').length === 1
                && app.events.filter(r => r.event === 'operation_end').length === 1;
            // The facade owns the source GET; source_call, not fetch_call,
            // identifies its unique invocation within the exclusive operation.
            const appCalls = phases.map(phase => ({ phase,
                count: app?.events.filter(r => r.phase === phase
                    && r.event === (phase === 'source' ? 'source_call' : 'fetch_call')).length ?? 0,
            }));
            const uniqueAppCalls = appCalls.every(r => r.count === 1)
                && !!app && app.events.filter(r => r.event === 'fetch_call').length === 3
                && app.events.filter(r => r.event === 'source_call').length === 1;
            // Exclusive-page role/cardinality join only. It does not attest
            // fetch identity, stack ownership, timing or a causal verdict.
            const singleOperationJoinEligible = browserComplete && appComplete
                && uniqueAppCalls && roots.every(r => r.count === 1);
            await testInfo.attach('ocr-causal-metadata', {
                contentType: 'application/json', body: Buffer.from(JSON.stringify({
                    schema: 'mediflow.ocr_causal_capture.v1', app,
                    browser: { total, dropped, invalid, late, sealed, events: rows },
                    coverage: { appComplete, browserComplete, browserSettledBeforeSeal, roots, appCalls,
                        uniqueAppCalls, singleOperationJoinEligible },
                })),
            });
        },
    };
}
