'use client';

/* @Codex */

import {
    SmartImportSelectionBrowserAdapterError,
    createSmartImportSelectionBrowserAdapter,
} from './smart-import-selection-browser-adapter';

type PatientScope = Readonly<{ patientId: string; ambulatoryId: string }>;
type ActiveHost = Readonly<{ state: 'active'; expiresAt: number }>;
type Sources = Readonly<{ fetch?: typeof fetch }>;

export type IntelligentHostBrowserAdapterErrorCode =
    | 'confirmation_required' | 'input_invalid' | 'selection_unavailable'
    | 'selection_resync_required' | 'session_unavailable' | 'host_unavailable'
    | 'activation_outcome_unknown' | 'response_invalid' | 'operation_superseded'
    | 'operation_terminal';

export class IntelligentHostBrowserAdapterError extends Error {
    constructor(readonly code: IntelligentHostBrowserAdapterErrorCode) {
        super('Intelligent Host non disponibile.');
        this.name = 'IntelligentHostBrowserAdapterError';
    }
}

function fail(code: IntelligentHostBrowserAdapterErrorCode): never {
    throw new IntelligentHostBrowserAdapterError(code);
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch {
        return null;
    }
}

function patientScope(value: unknown): PatientScope | null {
    const record = exact(value, ['patientId', 'ambulatoryId']);
    if (!record || typeof record.patientId !== 'string' || typeof record.ambulatoryId !== 'string'
        || record.patientId.length < 1 || record.patientId.length > 160
        || record.ambulatoryId.length < 1 || record.ambulatoryId.length > 160) return null;
    return Object.freeze({ patientId: record.patientId, ambulatoryId: record.ambulatoryId });
}

function activeHost(value: unknown): ActiveHost | null {
    const record = exact(value, ['state', 'expiresAt']);
    return record?.state === 'active' && Number.isSafeInteger(record.expiresAt)
        && (record.expiresAt as number) > 0
        ? Object.freeze({ state: 'active', expiresAt: record.expiresAt as number }) : null;
}

function selectionError(error: unknown): never {
    if (!(error instanceof SmartImportSelectionBrowserAdapterError)) return fail('selection_unavailable');
    if (error.code === 'session_unavailable') return fail('session_unavailable');
    if (error.code === 'selection_generation_changed' || error.code === 'selection_superseded') {
        return fail('operation_superseded');
    }
    if (error.code === 'selection_resync_required' || error.code === 'selection_outcome_unknown') {
        return fail('selection_resync_required');
    }
    if (error.code === 'response_invalid') return fail('response_invalid');
    return fail('selection_unavailable');
}

/* @Codex One-shot boundary: the authoritative selection yields the sole epoch
   sent to the host route, and no unknown outcome is retried automatically. */
export function createIntelligentHostBrowserAdapter(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    const selection = createSmartImportSelectionBrowserAdapter({ fetch: request });
    let generation = 0;
    let operation = 0;
    let terminal = false;
    const guard = (token: number, currentOperation: number) => {
        if (token !== generation || currentOperation !== operation) fail('operation_superseded');
    };
    const sync = async (method: 'initialize' | 'resync') => {
        const token = generation;
        const currentOperation = ++operation;
        try {
            await selection[method]();
        } catch (error) {
            guard(token, currentOperation);
            selectionError(error);
        }
        guard(token, currentOperation);
    };

    return Object.freeze({
        initialize: () => sync('initialize'),
        resync: () => sync('resync'),
        reset() {
            generation += 1;
            operation += 1;
            terminal = false;
            selection.reset();
        },
        async activate(value: unknown, confirmed: true): Promise<ActiveHost> {
            if (confirmed !== true) return fail('confirmation_required');
            if (terminal) return fail('operation_terminal');
            const scope = patientScope(value);
            if (!scope) return fail('input_invalid');
            const token = generation;
            const currentOperation = ++operation;
            let selected;
            try {
                selected = await selection.select(scope, true);
            } catch (error) {
                guard(token, currentOperation);
                selectionError(error);
            }
            guard(token, currentOperation);
            if (!selection.isCurrent(selected) || !selected.lease
                || selected.selectionEpoch !== selected.lease.selectionEpoch) return fail('selection_unavailable');

            let response: Response;
            terminal = true;
            try {
                response = await request(
                    `/api/patients/${encodeURIComponent(scope.patientId)}/intelligent-host/activate`,
                    {
                        method: 'POST', cache: 'no-store',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ selectionEpoch: selected.selectionEpoch }),
                    },
                );
            } catch {
                guard(token, currentOperation);
                return fail('activation_outcome_unknown');
            }
            guard(token, currentOperation);
            // A host-side 409 is terminal for this one-shot Supervisor command.
            // Only the Smart Import selection step above can request a recoverable resync.
            if (response.status === 409) return fail('host_unavailable');
            if (response.status === 503) return fail('host_unavailable');
            if (response.status === 401) {
                selection.reset();
                return fail('session_unavailable');
            }
            if (!response.ok) return fail('activation_outcome_unknown');
            let body: unknown;
            try {
                body = await response.json();
            } catch {
                guard(token, currentOperation);
                return fail('response_invalid');
            }
            guard(token, currentOperation);
            return activeHost(body) ?? fail('response_invalid');
        },
    });
}
