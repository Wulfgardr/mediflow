/* @Codex */
'use client';

import { createSmartImportSelectionBrowserAdapter } from '../../security/smart-import-selection-browser-adapter';
import { createDocumentSynthesisBrowserOrchestrator } from './document-synthesis-browser-orchestrator';
import type { DocumentSynthesisPreviewWire } from './document-synthesis-preview-wire';
import type { AnyDocDecryptedAttachmentSource } from '@/lib/domain/documents/anydoc-local-extraction-client';

type Sources = Readonly<{ fetch?: typeof fetch; readAttachment?: (attachmentId: string) => Promise<AnyDocDecryptedAttachmentSource | undefined | null> }>;
export type DocumentSynthesisAmbulatoryChoice = Readonly<{ ambulatoryId: string; name: string; address: string; version: number }>;
export type DocumentSynthesisContextProposal = Readonly<{ patientId: string; patientName: string; patientVersion: number;
    ambulatories: readonly DocumentSynthesisAmbulatoryChoice[] }>;
type Intent = Readonly<{ patientId: string; attachmentId: string; proposal: DocumentSynthesisContextProposal; ambulatory: DocumentSynthesisAmbulatoryChoice }>;
type ErrorCode = 'confirmation_required' | 'input_invalid' | 'proposal_stale' | 'operation_superseded' | 'choice_required' | 'context_unavailable' | 'session_unavailable';

export class DocumentSynthesisReviewBrowserControllerError extends Error {
    constructor(readonly code: ErrorCode) {
        super('Sintesi documentale non disponibile.');
        this.name = 'DocumentSynthesisReviewBrowserControllerError';
    }
}
function fail(code: ErrorCode): never { throw new DocumentSynthesisReviewBrowserControllerError(code); }
function intent(value: unknown): Intent | null {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = ['patientId', 'attachmentId', 'proposal', 'ambulatory'];
    if (Reflect.ownKeys(value).length !== keys.length) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (!keys.every((key) => fields[key] && Object.hasOwn(fields[key], 'value'))) return null;
    if (![fields.patientId.value, fields.attachmentId.value].every((id) => typeof id === 'string'
        && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(id))) return null;
    return { patientId: fields.patientId.value, attachmentId: fields.attachmentId.value, proposal: fields.proposal.value, ambulatory: fields.ambulatory.value };
}

/** The selection endpoint owns authority; this controller only submits a confirmed intent. */
export function createDocumentSynthesisReviewBrowserController(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    let generation = 0;
    let transport: AbortController | null = null;
    let proposal: DocumentSynthesisContextProposal | null = null;
    const fetcher: typeof fetch = (input, init) => request(input, { ...init, signal: transport?.signal });
    const selection = createSmartImportSelectionBrowserAdapter({ fetch: fetcher });
    const synthesis = createDocumentSynthesisBrowserOrchestrator({ fetch: fetcher });
    const reset = () => {
        generation += 1; proposal = null;
        transport?.abort(); transport = null;
        selection.reset(); synthesis.reset();
    };
    const current = (token: number) => { if (token !== generation) return fail('operation_superseded'); };
    const read = async (url: string, token: number): Promise<unknown> => {
        const response = await fetcher(url, { method: 'GET', cache: 'no-store' }); current(token);
        if (response.status === 401) return fail('session_unavailable');
        if (!response.ok) return fail('context_unavailable');
        const value: unknown = await response.json(); current(token); return value;
    };
    const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
        && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null;
    const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160
        && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
    const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    // Existing authenticated reads supply display candidates only. No cookie/default or membership authority.
    const readContext = async (patientId: string, token: number): Promise<DocumentSynthesisContextProposal> => {
        const patient = record(await read(`/api/patients/${encodeURIComponent(patientId)}`, token));
        if (!patient || patient.id !== patientId || !name(patient.firstName) || !name(patient.lastName)
            || !Number.isSafeInteger(patient.version) || (patient.version as number) < 1) return fail('context_unavailable');
        const rows = await read('/api/ambulatories', token);
        if (!Array.isArray(rows) || rows.length === 0) return fail('context_unavailable');
        const choices: DocumentSynthesisAmbulatoryChoice[] = []; const seen = new Set<string>();
        for (const value of rows) {
            const row = record(value);
            if (!row || !id(row.id) || !name(row.name) || !Number.isSafeInteger(row.version) || (row.version as number) < 1
                || seen.has(row.id) || (row.address != null && typeof row.address !== 'string')) return fail('context_unavailable');
            seen.add(row.id);
            choices.push(Object.freeze({ ambulatoryId: row.id, name: row.name.trim(), address: typeof row.address === 'string' ? row.address.trim() : '', version: row.version as number }));
        }
        return Object.freeze({ patientId, patientName: `${patient.firstName.trim()} ${patient.lastName.trim()}`,
            patientVersion: patient.version as number, ambulatories: Object.freeze(choices) });
    };
    return Object.freeze({
        reset,
        async readProposal(patientId: string): Promise<DocumentSynthesisContextProposal> {
            reset(); if (!id(patientId)) return fail('input_invalid');
            transport = new AbortController(); const token = generation;
            try { const value = await readContext(patientId, token); current(token); proposal = value; return value; }
            catch (error) { current(token); throw error; }
        },
        async run(value: unknown, confirmed: true): Promise<DocumentSynthesisPreviewWire> {
            if (confirmed !== true) return fail('confirmation_required');
            const input = intent(value); if (!input) return fail('input_invalid');
            if (!proposal || input.proposal !== proposal || input.patientId !== proposal.patientId) return fail('proposal_stale');
            if (!input.ambulatory || !proposal.ambulatories.includes(input.ambulatory)) return fail('choice_required');
            const selectedProposal = proposal; proposal = null; const token = generation;
            try {
                const latest = await readContext(input.patientId, token); current(token);
                const ambulatory = latest.ambulatories.find((choice) => choice.ambulatoryId === input.ambulatory.ambulatoryId);
                if (latest.patientVersion !== selectedProposal.patientVersion || latest.patientName !== selectedProposal.patientName
                    || !ambulatory || ambulatory.name !== input.ambulatory.name || ambulatory.address !== input.ambulatory.address
                    || ambulatory.version !== input.ambulatory.version) return fail('proposal_stale');
                await selection.initialize(); current(token);
                const selected = await selection.select({ patientId: input.patientId, ambulatoryId: input.ambulatory.ambulatoryId }, true);
                current(token);
                if (!selection.isCurrent(selected)) return fail('operation_superseded');
                if (!sources.readAttachment) return fail('context_unavailable');
                const preview = await synthesis.run(input.attachmentId, () => sources.readAttachment!(input.attachmentId)); current(token);
                if (!selection.isCurrent(selected)) return fail('operation_superseded');
                return preview;
            } catch (error) { current(token); throw error; }
        },
    });
}
