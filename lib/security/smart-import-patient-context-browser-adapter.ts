/* @Codex */
'use client';

/** Display candidates only. The authenticated selection endpoint owns membership and authority. */
export type SmartImportAmbulatoryChoice = Readonly<{ ambulatoryId: string; name: string; address: string; version: number }>;
export type SmartImportContextProposal = Readonly<{ patientId: string; patientName: string; patientVersion: number;
    ambulatories: readonly SmartImportAmbulatoryChoice[] }>;
export type SmartImportContextProposalBrowserAdapterErrorCode = 'context_missing' | 'context_unavailable'
    | 'response_invalid' | 'session_unavailable';
export class SmartImportContextProposalBrowserAdapterError extends Error {
    constructor(readonly code: SmartImportContextProposalBrowserAdapterErrorCode) {
        super(`Smart Import context proposal rejected: ${code}`);
        this.name = 'SmartImportContextProposalBrowserAdapterError';
    }
}
function fail(code: SmartImportContextProposalBrowserAdapterErrorCode): never { throw new SmartImportContextProposalBrowserAdapterError(code); }
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const label = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function record(value: unknown): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.values(descriptors).some(item => !Object.hasOwn(item, 'value'))) return null;
        return value as Record<string, unknown>;
    } catch { return null; }
}
export function createSmartImportContextProposalBrowserAdapter(sources: Readonly<{ fetch?: typeof fetch }> = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    async function read(url: string): Promise<unknown> {
        let response: Response;
        try { response = await request(url, { method: 'GET', cache: 'no-store' }); }
        catch { return fail('context_unavailable'); }
        if (response.status === 401) return fail('session_unavailable');
        if (!response.ok) return fail('context_unavailable');
        try { return await response.json(); } catch { return fail('response_invalid'); }
    }
    return Object.freeze({
        async read(patientId: string): Promise<SmartImportContextProposal> {
            if (!id(patientId)) return fail('response_invalid');
            const patient = record(await read(`/api/patients/${encodeURIComponent(patientId)}`));
            if (!patient || patient.id !== patientId || !label(patient.firstName) || !label(patient.lastName)
                || !Number.isSafeInteger(patient.version) || (patient.version as number) < 1) return fail('response_invalid');
            const rows = await read('/api/ambulatories');
            if (!Array.isArray(rows)) return fail('response_invalid');
            if (rows.length === 0) return fail('context_missing');
            const seen = new Set<string>(); const choices: SmartImportAmbulatoryChoice[] = [];
            for (const value of rows) {
                const row = record(value);
                if (!row || !id(row.id) || !label(row.name) || seen.has(row.id)
                    || !Number.isSafeInteger(row.version) || (row.version as number) < 1
                    || (row.address != null && typeof row.address !== 'string')) return fail('response_invalid');
                seen.add(row.id);
                choices.push(Object.freeze({ ambulatoryId: row.id, name: row.name.trim(),
                    address: typeof row.address === 'string' ? row.address.trim() : '', version: row.version as number }));
            }
            return Object.freeze({ patientId, patientName: `${patient.firstName.trim()} ${patient.lastName.trim()}`,
                patientVersion: patient.version as number, ambulatories: Object.freeze(choices) });
        },
    });
}
