/* @Codex */
'use client';

export type SmartImportSelectionLease = Readonly<{ sessionRef: string; selectionEpoch: number; patientRef: string;
    ambulatoryRef: string; leaseRef: string; expiresAt: number }>;
export type SmartImportSelectionBrowserSnapshot = Readonly<{ selectionEpoch: number | null; lease: SmartImportSelectionLease | null }>;
export type SmartImportSelectionBrowserAdapterErrorCode = 'confirmation_required' | 'input_invalid' | 'response_invalid'
    | 'selection_unavailable' | 'selection_outcome_unknown' | 'selection_resync_required' | 'selection_superseded'
    | 'selection_generation_changed' | 'session_unavailable';

export class SmartImportSelectionBrowserAdapterError extends Error {
    constructor(readonly code: SmartImportSelectionBrowserAdapterErrorCode) {
        super(`Smart Import selection browser adapter rejected: ${code}`);
        this.name = 'SmartImportSelectionBrowserAdapterError';
    }
}

type Proposal = Readonly<{ patientId: string; ambulatoryId: string }>;
type Sources = Readonly<{ fetch?: typeof fetch }>;
const PATH = '/api/ai/smart-import/selection';
const REF = Object.freeze({ sessionRef: /^ssr_[0-9a-f]{32}$/u, patientRef: /^ptr_[0-9a-f]{32}$/u,
    ambulatoryRef: /^abr_[0-9a-f]{32}$/u, leaseRef: /^lsr_[0-9a-f]{32}$/u });

function fail(code: SmartImportSelectionBrowserAdapterErrorCode): never { throw new SmartImportSelectionBrowserAdapterError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch { return null; }
}
function proposal(value: unknown): Proposal | null {
    const record = exact(value, ['patientId', 'ambulatoryId']);
    if (!record || typeof record.patientId !== 'string' || typeof record.ambulatoryId !== 'string') return null;
    return Object.freeze({ patientId: record.patientId, ambulatoryId: record.ambulatoryId });
}
function epoch(value: unknown): number | null {
    const record = exact(value, ['selectionEpoch']);
    return record && Number.isSafeInteger(record.selectionEpoch) && (record.selectionEpoch as number) >= 0 ? record.selectionEpoch as number : null;
}
function lease(value: unknown): SmartImportSelectionLease | null {
    const root = exact(value, ['selection']); const record = root ? exact(root.selection, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef', 'expiresAt']) : null;
    if (!record || !Number.isSafeInteger(record.selectionEpoch) || (record.selectionEpoch as number) < 1
        || !Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) < 0
        || !Object.entries(REF).every(([key, pattern]) => typeof record[key] === 'string' && pattern.test(record[key] as string))) return null;
    return Object.freeze({ sessionRef: record.sessionRef as string, selectionEpoch: record.selectionEpoch as number,
        patientRef: record.patientRef as string, ambulatoryRef: record.ambulatoryRef as string,
        leaseRef: record.leaseRef as string, expiresAt: record.expiresAt as number });
}

/* @Codex */
export function createSmartImportSelectionBrowserAdapter(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    let generation = 0; let currentEpoch: number | null = null; let currentLease: SmartImportSelectionLease | null = null;
    const snapshot = (): SmartImportSelectionBrowserSnapshot => Object.freeze({ selectionEpoch: currentEpoch, lease: currentLease });
    const reset = (): SmartImportSelectionBrowserSnapshot => { generation += 1; currentEpoch = null; currentLease = null; return snapshot(); };
    const acceptEpoch = (next: number): SmartImportSelectionBrowserSnapshot => {
        if (currentEpoch === null || next > currentEpoch) currentEpoch = next;
        if (currentLease && currentEpoch > currentLease.selectionEpoch) currentLease = null;
        return snapshot();
    };
    const readEpoch = async (): Promise<SmartImportSelectionBrowserSnapshot> => {
        const token = generation; let response: Response;
        try { response = await request(PATH, { method: 'GET', cache: 'no-store' }); } catch {
            if (token !== generation) return snapshot();
            return fail('selection_unavailable');
        }
        if (token !== generation) return snapshot();
        if (response.status === 401) { reset(); return fail('session_unavailable'); }
        if (!response.ok) { currentLease = null; return fail('selection_unavailable'); }
        let body: unknown;
        try { body = await response.json(); } catch {
            if (token !== generation) return snapshot();
            currentLease = null; return fail('response_invalid');
        }
        const next = epoch(body);
        if (next === null) {
            if (token !== generation) return snapshot();
            currentLease = null; return fail('response_invalid');
        }
        return token === generation ? acceptEpoch(next) : snapshot();
    };
    return Object.freeze({
        initialize: readEpoch,
        resync: readEpoch,
        reset,
        async select(value: unknown, confirmed: true): Promise<SmartImportSelectionBrowserSnapshot> {
            if (confirmed !== true) return fail('confirmation_required');
            const selected = proposal(value); if (!selected) return fail('input_invalid');
            if (currentEpoch === null) return fail('selection_unavailable');
            const token = generation; const expectedEpoch = currentEpoch; let response: Response;
            try {
                response = await request(PATH, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ expectedEpoch, patientId: selected.patientId, ambulatoryId: selected.ambulatoryId }) });
            } catch {
                if (token !== generation) return fail('selection_generation_changed');
                currentLease = null;
                return fail('selection_outcome_unknown');
            }
            if (token !== generation) return fail('selection_generation_changed');
            if (response.status === 401) { reset(); return fail('session_unavailable'); }
            if (response.status === 409) {
                currentLease = null;
                await readEpoch();
                if (token !== generation) return fail('selection_generation_changed');
                return fail('selection_resync_required');
            }
            if (!response.ok) { currentLease = null; return fail('selection_outcome_unknown'); }
            let body: unknown;
            try { body = await response.json(); } catch {
                if (token !== generation) return fail('selection_generation_changed');
                currentLease = null; return fail('response_invalid');
            }
            if (token !== generation) return fail('selection_generation_changed');
            const next = lease(body);
            if (!next) { currentLease = null; return fail('response_invalid'); }
            if (currentEpoch !== null && next.selectionEpoch < currentEpoch) return fail('selection_superseded');
            if (next.selectionEpoch !== expectedEpoch + 1) { currentLease = null; return fail('response_invalid'); }
            currentEpoch = next.selectionEpoch; currentLease = next;
            return snapshot();
        },
    });
}
