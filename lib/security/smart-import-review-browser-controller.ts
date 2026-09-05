/* @Codex */
'use client';

import { parseSmartImportPreviewWireRoot, type SmartImportPreviewWireRoot } from '../smart-import-preview-wire';
import { createSmartImportContextProposalBrowserAdapter, type SmartImportContextProposal } from './smart-import-context-proposal-browser-adapter';
import { createSmartImportSelectionBrowserAdapter } from './smart-import-selection-browser-adapter';
import { createSmartImportProjectionAttachmentBrowserNormalizer } from './smart-import-projection-attachment-browser-normalizer';
import { createSmartImportBrowserOrchestrator } from './smart-import-browser-orchestrator';

type Sources = Readonly<{ fetch?: typeof fetch; clock?: () => Date; requestId?: () => unknown }>;
export type SmartImportReviewBrowserControllerErrorCode = 'confirmation_required' | 'input_invalid' | 'proposal_stale' | 'operation_superseded';
export class SmartImportReviewBrowserControllerError extends Error {
    constructor(readonly code: SmartImportReviewBrowserControllerErrorCode) { super('Smart Import review operation rejected.'); this.name = 'SmartImportReviewBrowserControllerError'; }
}
function fail(code: SmartImportReviewBrowserControllerErrorCode): never { throw new SmartImportReviewBrowserControllerError(code); }
function exact(value: unknown): Record<string, unknown> | null {
    try { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value); if (keys.length !== 3 || !['patientId', 'proposal', 'captureInput'].every((key) => keys.includes(key))) return null;
        const result: Record<string, unknown> = {}; for (const key of ['patientId', 'proposal', 'captureInput']) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; result[key] = descriptor.value; } return result;
    } catch { return null; }
}

/* @Codex */
export function createSmartImportReviewBrowserController(sources: Sources = {}) {
    const context = createSmartImportContextProposalBrowserAdapter({ fetch: sources.fetch }); const selection = createSmartImportSelectionBrowserAdapter({ fetch: sources.fetch });
    const normalizer = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: sources.clock }); const orchestrator = createSmartImportBrowserOrchestrator({ fetch: sources.fetch, requestId: sources.requestId, isCurrent: selection.isCurrent });
    let proposal: SmartImportContextProposal | null = null; let generation = 0; let operation = 0; let readOperation = 0;
    const reset = () => { generation += 1; operation += 1; readOperation += 1; proposal = null; selection.reset(); orchestrator.reset(); };
    return Object.freeze({
        reset,
        async readProposal(): Promise<SmartImportContextProposal> {
            proposal = null; const token = generation; const currentRead = ++readOperation;
            try { const value = await context.read(); if (token !== generation || currentRead !== readOperation) return fail('operation_superseded'); proposal = value; return value; }
            catch (error) { if (token !== generation || currentRead !== readOperation) return fail('operation_superseded'); throw error; }
        },
        async run(value: unknown, confirmed: true): Promise<SmartImportPreviewWireRoot> {
            if (confirmed !== true) return fail('confirmation_required'); const input = exact(value);
            if (!input || typeof input.patientId !== 'string') return fail('input_invalid'); if (input.proposal !== proposal || proposal === null) return fail('proposal_stale');
            proposal = null; readOperation += 1; const token = generation; const currentOperation = ++operation; const current = () => { if (token !== generation || currentOperation !== operation) return fail('operation_superseded'); };
            try {
                await selection.initialize(); current();
                const lease = await selection.select({ patientId: input.patientId, ambulatoryId: (input.proposal as SmartImportContextProposal).ambulatoryId }, true); current();
                const bound = normalizer.captureForCurrentSelection(input.captureInput, true, lease, selection.isCurrent); current();
                const root = await orchestrator.run(lease, bound); current(); return parseSmartImportPreviewWireRoot(root) ?? fail('input_invalid');
            } catch (error) { current(); throw error; }
        },
    });
}
