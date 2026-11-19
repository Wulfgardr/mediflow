'use client';

import { useState, useSyncExternalStore } from 'react';
import { useSecurity } from '@/components/security-provider';
import { agentIncomingSnapshot, agentIncomingServerSnapshot, subscribeAgentIncoming, refreshAgentIncoming, applyReviewedAgentVisits, readIncomingAgentPdf } from '@/lib/agent-incoming';
import { agentItemPhase, agentVisitAwaitsReview } from '@/lib/agent-visit-review';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import DocumentViewer from '@/components/document-viewer';
import { agentReviewFieldLabels as fieldLabels, agentReviewFieldValues as fieldValues, agentReviewItemLabels } from '@/lib/agent-visit-review-labels';

function UnlockedIncoming() {
    const { visits, busy, error } = useSyncExternalStore(subscribeAgentIncoming, agentIncomingSnapshot, agentIncomingServerSnapshot);
    const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null);
    const [openingPdf, setOpeningPdf] = useState(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const showPdf = async (visitId: string, revision: number, itemId: string) => {
        setOpeningPdf(true);
        setPdfError(null);
        try { setPdf(await readIncomingAgentPdf(visitId, revision, itemId)); }
        catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) setPdfError(error instanceof Error ? error.message : 'PDF non disponibile.');
        } finally { setOpeningPdf(false); }
    };
    const applicable = visits.filter(agentVisitAwaitsReview);
    return <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="type-page-title">In arrivo</h1>
        <div className="flex flex-wrap gap-3">
            <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void refreshAgentIncoming(); }}>Aggiorna</button>
            <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !applicable.length} onClick={() => { void applyReviewedAgentVisits(applicable.map(value => value.visit.cassette.id)); }}>Applica tutte le visite senza dubbi</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {pdfError && <p role="alert">{pdfError}</p>}
        {!visits.length && !busy && !error && <p>Nessuna visita in attesa.</p>}
        {visits.map(review => {
            const { visit } = review;
            const pending = visit.items.filter(item => !review.appliedItemIds.includes(item.id));
            return <section key={visit.cassette.id} className="space-y-4 rounded-lg border p-4" aria-label={'Visita ' + visit.cassette.id}>
                <h2 className="[font:var(--type-section-heading)]">{typeof visit.anchor.fiscalCode === 'string' ? visit.anchor.fiscalCode : 'Identità da confermare'}</h2>
                {review.patient && <p>{review.patient.lastName} {review.patient.firstName}</p>}
                <p>{visit.cassette.status === 'closed' ? 'Visita chiusa' : 'Deposito in corso'}</p>
                {pending.some(item => agentItemPhase(review, item) === 'review') ? <p className="type-meta">◇ Da rivedere</p> : null}
                {[...review.blockers, ...review.proposalBlockers].map((message, index) => <p role="alert" key={index}>{message}</p>)}
                <div className="flex flex-wrap gap-3">{visit.items.filter(item => item.kind === 'pdf').map(item =>
                    typeof item.value.name === 'string' && <button key={item.id} className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={openingPdf}
                        onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, item.id); }}>{item.value.name}</button>)}</div>
                {pending.map(item => <article key={item.id} className="min-w-0 space-y-2 whitespace-pre-wrap break-words border-t pt-3">
                    <h3 className="font-semibold">{agentReviewItemLabels[item.kind]}</h3>
                    {typeof item.value.text === 'string' && <p>{item.value.text}</p>}
                    {review.currentSummary.has(item.id) && <p>In scheda: {review.currentSummary.get(item.id)}</p>}
                    {typeof item.value.values === 'object' && item.value.values !== null && <dl>{Object.entries(item.value.values).map(([field, value]) => <div key={field} className="grid gap-1 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)] sm:gap-3"><dt>{fieldLabels[field] ?? 'Dato'}</dt><dd>{fieldValues[field]?.[String(value)] ?? String(value)}</dd></div>)}</dl>}
                    {typeof item.value.quote === 'string' && <blockquote className="border-l-2 pl-3">{item.value.quote}</blockquote>}
                    {Boolean(item.value.source) && typeof item.value.source === 'object' && item.value.source !== null && 'fileName' in item.value.source && <p>{String(item.value.source.fileName)}</p>}
                </article>)}
                <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !applicable.includes(review)} onClick={() => { void applyReviewedAgentVisits([visit.cassette.id]); }}>Applica la visita</button>
            </section>;
        })}
        {pdf && <DocumentViewer file={'data:application/pdf;base64,' + pdf.base64} fileName={pdf.name} onClose={() => setPdf(null)} />}
    </main>;
}
export default function IncomingPage() {
    const { isLocked } = useSecurity();
    return isLocked ? null : <UnlockedIncoming />;
}
