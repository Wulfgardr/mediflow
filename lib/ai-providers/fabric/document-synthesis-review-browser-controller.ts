/* @Codex */
'use client';

import { createSmartImportContextProposalBrowserAdapter, type SmartImportContextProposal } from '../../security/smart-import-context-proposal-browser-adapter';
import { createSmartImportSelectionBrowserAdapter } from '../../security/smart-import-selection-browser-adapter';
import { createDocumentSynthesisBrowserOrchestrator } from './document-synthesis-browser-orchestrator';
import type { DocumentSynthesisPreviewWire } from './document-synthesis-preview-wire';

type Sources = Readonly<{ fetch?: typeof fetch }>;
type Intent = Readonly<{ patientId: string; attachmentId: string; proposal: SmartImportContextProposal }>;
type ErrorCode = 'confirmation_required' | 'input_invalid' | 'proposal_stale' | 'operation_superseded';

export class DocumentSynthesisReviewBrowserControllerError extends Error {
    constructor(readonly code: ErrorCode) {
        super('Sintesi documentale non disponibile.');
        this.name = 'DocumentSynthesisReviewBrowserControllerError';
    }
}
function fail(code: ErrorCode): never { throw new DocumentSynthesisReviewBrowserControllerError(code); }
function intent(value: unknown): Intent | null {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = ['patientId', 'attachmentId', 'proposal'];
    if (Reflect.ownKeys(value).length !== keys.length) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (!keys.every((key) => fields[key] && Object.hasOwn(fields[key], 'value'))) return null;
    if (![fields.patientId.value, fields.attachmentId.value].every((id) => typeof id === 'string'
        && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(id))) return null;
    return { patientId: fields.patientId.value, attachmentId: fields.attachmentId.value, proposal: fields.proposal.value };
}

/** The selection endpoint owns authority; this controller only submits a confirmed intent. */
export function createDocumentSynthesisReviewBrowserController(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    let generation = 0;
    let transport: AbortController | null = null;
    let proposal: SmartImportContextProposal | null = null;
    const fetcher: typeof fetch = (input, init) => request(input, { ...init, signal: transport?.signal });
    const context = createSmartImportContextProposalBrowserAdapter({ fetch: fetcher });
    const selection = createSmartImportSelectionBrowserAdapter({ fetch: fetcher });
    const synthesis = createDocumentSynthesisBrowserOrchestrator({ fetch: fetcher });
    const reset = () => {
        generation += 1; proposal = null;
        transport?.abort(); transport = null;
        selection.reset(); synthesis.reset();
    };
    const current = (token: number) => { if (token !== generation) return fail('operation_superseded'); };
    return Object.freeze({
        reset,
        async readProposal(): Promise<SmartImportContextProposal> {
            reset(); transport = new AbortController(); const token = generation;
            try { const value = await context.read(); current(token); proposal = value; return value; }
            catch (error) { current(token); throw error; }
        },
        async run(value: unknown, confirmed: true): Promise<DocumentSynthesisPreviewWire> {
            if (confirmed !== true) return fail('confirmation_required');
            const input = intent(value); if (!input) return fail('input_invalid');
            if (!proposal || input.proposal !== proposal) return fail('proposal_stale');
            const selectedProposal = proposal; proposal = null; const token = generation;
            try {
                await selection.initialize(); current(token);
                const selected = await selection.select({ patientId: input.patientId, ambulatoryId: selectedProposal.ambulatoryId }, true);
                current(token);
                if (!selection.isCurrent(selected)) return fail('operation_superseded');
                const preview = await synthesis.run(input.attachmentId); current(token);
                if (!selection.isCurrent(selected)) return fail('operation_superseded');
                return preview;
            } catch (error) { current(token); throw error; }
        },
    });
}
