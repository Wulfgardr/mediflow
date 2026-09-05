/* @Codex */
'use client';

/** A context proposal only; it proves neither membership, currentness, nor authority. */
export type SmartImportContextProposal = Readonly<{ ambulatoryId: string }>;
export type SmartImportContextProposalBrowserAdapterErrorCode = 'context_missing' | 'context_unavailable'
    | 'response_invalid' | 'session_unavailable';

export class SmartImportContextProposalBrowserAdapterError extends Error {
    constructor(readonly code: SmartImportContextProposalBrowserAdapterErrorCode) {
        super(`Smart Import context proposal rejected: ${code}`);
        this.name = 'SmartImportContextProposalBrowserAdapterError';
    }
}

type Sources = Readonly<{ fetch?: typeof fetch }>;
const PATH = '/api/context';
const AMBULATORY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function fail(code: SmartImportContextProposalBrowserAdapterErrorCode): never {
    throw new SmartImportContextProposalBrowserAdapterError(code);
}
function exact(value: unknown): Readonly<{ ambulatoryId: unknown }> | null {
    try {
        if (value === null || typeof value !== 'object' || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== 1 || keys[0] !== 'ambulatoryId') return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, 'ambulatoryId');
        return descriptor && 'value' in descriptor ? Object.freeze({ ambulatoryId: descriptor.value }) : null;
    } catch { return null; }
}
function proposal(value: unknown): SmartImportContextProposal | null {
    const record = exact(value);
    if (!record || typeof record.ambulatoryId !== 'string' || !AMBULATORY_ID.test(record.ambulatoryId)) return null;
    return Object.freeze({ ambulatoryId: record.ambulatoryId });
}

/* @Codex */
export function createSmartImportContextProposalBrowserAdapter(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    return Object.freeze({
        async read(): Promise<SmartImportContextProposal> {
            let response: Response;
            try { response = await request(PATH, { method: 'GET', cache: 'no-store' }); }
            catch { return fail('context_unavailable'); }
            if (response.status === 401) return fail('session_unavailable');
            if (!response.ok) return fail('context_unavailable');
            let body: unknown;
            try { body = await response.json(); } catch { return fail('response_invalid'); }
            const value = exact(body);
            if (!value) return fail('response_invalid');
            if (value.ambulatoryId === null) return fail('context_missing');
            const result = proposal(body);
            return result ?? fail('response_invalid');
        },
    });
}
