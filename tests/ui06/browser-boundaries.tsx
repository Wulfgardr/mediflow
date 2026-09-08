/* @Codex UI06: test-only outer boundaries. NOT an implementation of auth, a router, a provider, or Fabric.
   Production ScaleEngine, ConfirmProvider, RuntimeTwinDesignProvider, cards and CSS are NOT mocked. */
import { useState, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from 'react';
import type { DocumentSynthesisContextProposal } from '../../lib/ai-providers/fabric/document-synthesis-review-browser-controller';
import type { DocumentSynthesisPreviewWire } from '../../lib/ai-providers/fabric/document-synthesis-preview-wire';
import { syntheticPreview } from './preview-fixture';

const listeners = new Set<() => void>();
let locked = false;
export const boundaryState = {
    reads: 0, runs: 0, resets: 0, begins: 0, current: true,
    runConfirmed: false, selectedAmbulatory: '',
    mode: new URLSearchParams(window.location.search).get('mode') ?? 'available',
    resolve: null as null | ((value: DocumentSynthesisPreviewWire) => void),
    lock(value: boolean) { locked = value; for (const notify of listeners) notify(); },
    publish() { this.resolve?.(syntheticPreview); },
};
export function useSecurity() {
    const isLocked = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => locked, () => false);
    return { isLocked };
}
export function FixturePrivacy({ children }: { children: ReactNode; intensity?: string }) { return <>{children}</>; }
export function FixtureLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} />; }
export function usePathname() { return window.location.pathname; }
export function Kree8WorkspaceShell({ children, title, backHref, backLabel }: { children: ReactNode; title: string; backHref: string; backLabel: string }) {
    return <main><header><a href={backHref}>{backLabel}</a><h1>{title}</h1></header>{children}</main>;
}
export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest: () => void }) { return <button onClick={onSearchRequest}>Ricerca impostazioni (fixture)</button>; }
export function SettingsSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) { return open ? <div role="dialog" aria-label="Ricerca fixture"><button onClick={onClose}>Chiudi ricerca</button></div> : null; }
export function useSettingsSearch() { const [isSearchOpen, setOpen] = useState(false); return { isSearchOpen, openSearch: () => setOpen(true), closeSearch: () => setOpen(false) }; }

export class DocumentSynthesisBrowserOrchestratorError extends Error { constructor(readonly code: string) { super(code); } }
export class DocumentSynthesisReviewBrowserControllerError extends Error { constructor(readonly code: string) { super(code); } }
export class SmartImportSelectionBrowserAdapterError extends Error { constructor(readonly code: string) { super(code); } }
const proposal: DocumentSynthesisContextProposal = {
    patientId: 'ui06-patient', patientName: 'Persona Sintetica', patientVersion: 1,
    ambulatories: [{ ambulatoryId: 'ui06-ambulatory', name: 'Ambulatorio inventato UI06', address: '', version: 1 }],
};
const blockedFetch: typeof fetch = async () => { throw new Error('UI06: unexpected network access'); };
const client = {
    fetch: blockedFetch,
    async begin() { boundaryState.begins += 1; return 'synthetic-model-token'; },
    isCurrent() { return boundaryState.current; },
    reset() {},
};
const view = { blocked: false, choice: 'synthetic-model-choice' };
export function useFunctionModelPicker(_function: string, _patientId: string, _attachmentId: string, enabled: boolean) {
    return { active: enabled, canGenerate: enabled, client, view };
}
export function FunctionModelPicker() { return <p>Selettore sostituito solo nel test; nessun provider attivo.</p>; }
export function createDocumentSynthesisReviewBrowserController() {
    return {
        reset() { boundaryState.resets += 1; },
        async readProposal() {
            boundaryState.reads += 1;
            if (boundaryState.mode === 'unavailable') throw new DocumentSynthesisReviewBrowserControllerError('context_unavailable');
            return proposal;
        },
        async run(input: { ambulatory: { ambulatoryId: string } }, confirmed: boolean) {
            boundaryState.runs += 1; boundaryState.runConfirmed = confirmed; boundaryState.selectedAmbulatory = input.ambulatory.ambulatoryId;
            if (boundaryState.mode === 'unsupported') throw new DocumentSynthesisBrowserOrchestratorError('unsupported_local_extraction');
            if (boundaryState.mode === 'deferred') return await new Promise<DocumentSynthesisPreviewWire>(resolve => { boundaryState.resolve = resolve; });
            return syntheticPreview;
        },
    };
}
