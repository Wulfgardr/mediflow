'use client';

import { isProfileResult, assertProfileResultBudget, type ProfileProjection, type ProfileQuery,
    type ProfileResult, type ProfileQueryErrorCode } from '../packages/patient-profile-contracts/src/query';

type ErrorCode = ProfileQueryErrorCode | 'operation_superseded' | 'response_invalid';
type Sources = Readonly<{ fetch?: typeof fetch; now?: () => number }>;
export class PatientProfileBrowserAdapterError extends Error {
    constructor(readonly code: ErrorCode) {
        super('Lettura del profilo non disponibile.'); this.name = 'PatientProfileBrowserAdapterError';
    }
}
function fail(code: ErrorCode): never { throw new PatientProfileBrowserAdapterError(code); }
function patientId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) return fail('input_invalid');
    return value;
}
function epoch(value: unknown): number {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 'contractVersion')
        || !Object.hasOwn(value, 'selectionEpoch')) return fail('response_invalid');
    const record = value as Record<string, unknown>;
    if (record.contractVersion !== 1 || !Number.isSafeInteger(record.selectionEpoch)
        || (record.selectionEpoch as number) < 0) return fail('response_invalid');
    return record.selectionEpoch as number;
}
function status(response: Response): void {
    if (response.status === 401) return fail('session_unavailable');
    if (response.status === 403) return fail('scope_denied');
    if (response.status === 409) return fail('selection_conflict');
    if (response.status === 410) return fail('handle_expired');
    if (response.status === 413) return fail('output_too_large');
    if (!response.ok) return fail('query_unavailable');
}

/** Each explicit open is one intention; reads never silently reopen or reselect. */
export function createPatientProfileScopedBrowserAdapter(sources: Sources = {}) {
    // Resolve the document-wide archive-generation transport at call time.
    const request: typeof fetch = sources.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const now = sources.now ?? Date.now;
    let generation = 0, intent = 0, pending: AbortController | null = null;
    let current: { patientId: string; result: ProfileResult } | null = null;
    const reset = () => { generation++; intent++; current = null; pending?.abort(); pending = null; };
    const begin = (sessionSignal?: AbortSignal) => {
        if (sessionSignal?.aborted) return fail('session_unavailable');
        pending?.abort(); const controller = new AbortController(); pending = controller;
        const token = generation, operation = ++intent;
        const signal = sessionSignal ? AbortSignal.any([sessionSignal, controller.signal]) : controller.signal;
        const guard = () => {
            if (token !== generation || operation !== intent) return fail('operation_superseded');
            if (signal.aborted) return fail('session_unavailable');
        };
        return { guard, signal };
    };
    const query = async (id: string, input: ProfileQuery, operation: ReturnType<typeof begin>) => {
        let response: Response;
        try {
            response = await request(`/api/patients/${encodeURIComponent(id)}/profile-query`, {
                method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: operation.signal,
                headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
            });
        } catch { operation.guard(); return fail('query_unavailable'); }
        operation.guard(); status(response);
        let body: unknown;
        try { body = await response.json(); } catch { operation.guard(); return fail('response_invalid'); }
        operation.guard();
        if (!isProfileResult(body) || body.projection !== input.projection || body.currentness.expiresAt <= now()) return fail('response_invalid');
        try { assertProfileResultBudget(body); } catch { return fail('output_too_large'); }
        if (input.kind === 'read' && (body.handle !== input.handle || body.currentness.revision !== input.expectedRevision
            || body.currentness.selectionEpoch !== current?.result.currentness.selectionEpoch)) return fail('response_invalid');
        const result = Object.freeze({ ...body, currentness: Object.freeze({ ...body.currentness }),
            profile: Object.freeze({ ...body.profile }) }) as ProfileResult;
        current = { patientId: id, result };
        return result;
    };
    return Object.freeze({
        reset,
        async open(idValue: unknown, projection: ProfileProjection, sessionSignal?: AbortSignal): Promise<ProfileResult> {
            const id = patientId(idValue);
            if (projection !== 'notes' && projection !== 'profile') return fail('input_invalid');
            const operation = begin(sessionSignal); current = null;
            let response: Response;
            try { response = await request('/api/patient-profile/selection-epoch', {
                method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: operation.signal,
            }); } catch { operation.guard(); return fail('query_unavailable'); }
            operation.guard(); status(response);
            let value: unknown;
            try { value = await response.json(); } catch { operation.guard(); return fail('response_invalid'); }
            operation.guard(); const expectedSelectionEpoch = epoch(value);
            return query(id, { kind: 'open', contractVersion: 1, projection, expectedSelectionEpoch }, operation);
        },
        async read(sessionSignal?: AbortSignal): Promise<ProfileResult> {
            const selected = current;
            if (!selected) return fail('handle_unavailable');
            if (selected.result.currentness.expiresAt <= now()) { current = null; return fail('handle_expired'); }
            const operation = begin(sessionSignal);
            try {
                return await query(selected.patientId, { kind: 'read', contractVersion: 1,
                    projection: selected.result.projection, handle: selected.result.handle,
                    expectedRevision: selected.result.currentness.revision }, operation);
            } catch (error) { operation.guard(); current = null; throw error; }
        },
    });
}
