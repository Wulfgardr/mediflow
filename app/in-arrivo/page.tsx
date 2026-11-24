'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSecurity } from '@/components/security-provider';
import { agentIncomingSnapshot, agentIncomingServerSnapshot, subscribeAgentIncoming, refreshAgentIncoming, applyReviewedAgentVisits, readIncomingAgentPdf } from '@/lib/agent-incoming';
import { agentVisitAwaitsReview, type AgentVisitReview } from '@/lib/agent-visit-review';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import DocumentViewer from '@/components/document-viewer';
import { agentReviewFieldLabels as fieldLabels, agentReviewFieldValues as fieldValues, agentReviewItemLabels } from '@/lib/agent-visit-review-labels';

type VisitItem = AgentVisitReview['visit']['items'][number];

const SOAP_LABELS: Record<string, string> = {
    S: 'Soggettivo',
    O: 'Obiettivo',
    A: 'Valutazione',
    P: 'Piano',
};

function parseSoapSections(text: string): Array<{ key: string; label: string; body: string }> | null {
    const lines = text.split('\n');
    const sections: Array<{ key: string; label: string; body: string[] }> = [];
    for (const rawLine of lines) {
        const match = /^\s*([SOAP])\s*:\s*(.*)$/u.exec(rawLine);
        if (match) {
            const key = match[1]!;
            sections.push({ key, label: SOAP_LABELS[key] ?? key, body: [rawLine.trim()] });
        } else if (sections.length > 0) {
            sections[sections.length - 1]!.body.push(rawLine);
        } else if (rawLine.trim()) {
            return null;
        }
    }
    if (sections.length < 2) return null;
    return sections.map(section => ({ key: section.key, label: section.label, body: section.body.join('\n').trim() }));
}

function proposalHeadline(item: VisitItem): string {
    const raw = item.value.values;
    if (!raw || typeof raw !== 'object') return agentReviewItemLabels[item.kind];
    const values = raw as Record<string, unknown>;
    if (item.kind === 'therapy' && typeof values.drugName === 'string') {
        return typeof values.dosage === 'string' && values.dosage ? `${values.drugName} · ${values.dosage}` : values.drugName;
    }
    if (item.kind === 'service' && typeof values.serviceName === 'string') return values.serviceName;
    if (item.kind === 'diagnosis' && typeof values.description === 'string') {
        return typeof values.code === 'string' && values.code ? `${values.code} · ${values.description}` : values.description;
    }
    if (item.kind === 'exemption' && typeof values.code === 'string') return `Esenzione ${values.code}`;
    if (item.kind === 'observation' && typeof values.display === 'string') {
        const value = typeof values.value === 'string' ? values.value : '';
        const unit = typeof values.unitCode === 'string' ? values.unitCode : '';
        return [values.display, [value, unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    }
    return agentReviewItemLabels[item.kind];
}

function formatDepositTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function UnlockedIncoming() {
    const { visits, busy, error, applicationError } = useSyncExternalStore(subscribeAgentIncoming, agentIncomingSnapshot, agentIncomingServerSnapshot);
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
    const blockedCount = visits.length - applicable.length;
    const generalApplicationError = applicationError && !visits.some(({ visit }) => visit.cassette.id === applicationError.visitId)
        ? applicationError.message : null;

    return <main className="mx-auto max-w-4xl space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lume-rule)] pb-4">
            <div className="space-y-1">
                <h1 className="type-page-title">In arrivo</h1>
                {visits.length > 0 ? (
                    <p className="[font:var(--type-meta)] text-[var(--lume-ink-muted)]">
                        {applicable.length === 1 ? '1 visita pronta' : `${applicable.length} visite pronte`}
                        {blockedCount > 0 ? ` · ${blockedCount === 1 ? '1 da verificare' : `${blockedCount} da verificare`}` : ''}
                    </p>
                ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
                <Link href="/settings/agenti" className={SETTINGS_SECONDARY_BUTTON_CLASS}>Agenti</Link>
                <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void refreshAgentIncoming(); }}>Aggiorna</button>
                <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !applicable.length} onClick={() => { void applyReviewedAgentVisits(applicable.map(value => value.visit.cassette.id)); }}>Applica tutte le visite senza dubbi</button>
            </div>
        </header>
        {error && <p role="alert" className="rounded-lg border border-[var(--lume-signal-critical)] p-3 text-[var(--lume-signal-critical)]">{error}</p>}
        {generalApplicationError && <p role="alert" className="rounded-lg border border-[var(--lume-signal-critical)] p-3 text-[var(--lume-signal-critical)]">{generalApplicationError}</p>}
        {pdfError && <p role="alert" className="rounded-lg border border-[var(--lume-signal-critical)] p-3 text-[var(--lume-signal-critical)]">{pdfError}</p>}
        {!visits.length && !busy && !error && (
            <section className="rounded-lg border border-[var(--lume-rule)] bg-[var(--lume-surface-field)] p-6 space-y-2">
                <p className="[font:var(--type-strong)]">Nessuna visita in attesa.</p>
                <p className="[font:var(--type-meta)] text-[var(--lume-ink-muted)]">Le visite depositate da Codex compaiono qui per la conferma prima di entrare in cartella.</p>
            </section>
        )}
        {visits.map(review => {
            const { visit } = review;
            const pending = visit.items.filter(item => !review.appliedItemIds.includes(item.id));
            const pdfItems = visit.items.filter(item => item.kind === 'pdf');
            const pdfByName = new Map(pdfItems.filter(item => typeof item.value.name === 'string').map(item => [String(item.value.name), item.id]));
            const notes = pending.filter(item => item.kind === 'note');
            const transcriptions = pending.filter(item => item.kind === 'transcription');
            const proposals = pending.filter(item => item.kind !== 'pdf' && item.kind !== 'note' && item.kind !== 'transcription');
            const allBlockers = [...review.blockers, ...review.proposalBlockers];
            const actionMessages = applicationError?.visitId === visit.cassette.id ? [...allBlockers, applicationError.message] : allBlockers;
            const actionMessagesId = `visita-${visit.cassette.id}-esito`;
            const isApplicable = applicable.includes(review);
            const fiscalCode = typeof visit.anchor.fiscalCode === 'string' ? visit.anchor.fiscalCode : null;
            const statusText = visit.cassette.status !== 'closed'
                ? 'Deposito in corso'
                : allBlockers.length > 0
                ? 'Da verificare'
                : 'Pronta da applicare';
            const statusColor = visit.cassette.status !== 'closed'
                ? 'var(--lume-ink-muted)'
                : allBlockers.length > 0
                ? 'var(--lume-signal-warning)'
                : 'var(--lume-signal-success)';

            return <section key={visit.cassette.id} className="space-y-5 rounded-xl border border-[var(--lume-rule)] bg-[var(--lume-surface-field)] p-5" aria-label={'Visita ' + visit.cassette.id}>
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--lume-rule)] pb-4">
                    <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            {review.patient ? (
                                <h2 className="[font:var(--type-person-preview)]">
                                    {review.patient.lastName} {review.patient.firstName}
                                </h2>
                            ) : (
                                <h2 className="[font:var(--type-section-heading)]">{fiscalCode ?? 'Identità da confermare'}</h2>
                            )}
                            <span className="rounded-full border border-[var(--lume-rule)] px-2.5 py-0.5 [font:var(--type-record-meta)]" style={{ color: statusColor }}>
                                {statusText}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 [font:var(--type-meta)] text-[var(--lume-ink-muted)]">
                            {review.patient && fiscalCode ? <span className="[font:var(--type-code)]">{fiscalCode}</span> : null}
                            <span>{visit.cassette.status === 'closed' ? 'Visita chiusa' : 'Deposito in corso'}</span>
                            <span>Depositata {formatDepositTime(visit.cassette.depositedAt)}</span>
                            <span>
                                {[
                                    notes.length > 0 ? 'Nota' : null,
                                    transcriptions.length > 0 ? 'Trascrizione' : null,
                                    pdfItems.length > 0 ? `${pdfItems.length} PDF` : null,
                                    proposals.length > 0 ? (proposals.length === 1 ? '1 proposta' : `${proposals.length} proposte`) : null,
                                ].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                    </div>
                    {review.patient ? (
                        <Link href={`/patients/${review.patient.id}/modules`} className={SETTINGS_SECONDARY_BUTTON_CLASS}>Apri scheda</Link>
                    ) : null}
                </header>

                {pdfItems.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="[font:var(--type-record-label)] text-[var(--lume-ink-muted)]">PDF</h3>
                        <div className="flex flex-wrap gap-2">
                            {pdfItems.map(item => typeof item.value.name === 'string' && (
                                <button key={item.id} type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={openingPdf}
                                    onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, item.id); }}>
                                    {item.value.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {notes.map(item => {
                    const noteText = typeof item.value.text === 'string' ? item.value.text : '';
                    const soap = parseSoapSections(noteText);
                    return <article key={item.id} className="space-y-3 rounded-lg border border-[var(--lume-rule)] bg-[var(--lume-surface-draft)] p-4">
                        <h3 className="[font:var(--type-section-heading)]">{agentReviewItemLabels[item.kind]}</h3>
                        {soap ? (
                            <dl className="space-y-3">
                                {soap.map(section => (
                                    <div key={section.key} className="grid gap-1 sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)] sm:gap-3">
                                        <dt className="[font:var(--type-record-label)] text-[var(--lume-ink-muted)]">{section.label}</dt>
                                        <dd className="min-w-0 whitespace-pre-wrap break-words [font:var(--type-body)]">{section.body}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className="min-w-0 whitespace-pre-wrap break-words [font:var(--type-body)]">{noteText}</p>
                        )}
                    </article>;
                })}

                {proposals.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="[font:var(--type-record-label)] text-[var(--lume-ink-muted)]">Proposte da confermare</h3>
                        <div className="space-y-3">
                            {proposals.map(item => {
                                const sourceFileName = Boolean(item.value.source) && typeof item.value.source === 'object' && item.value.source !== null && 'fileName' in item.value.source
                                    ? String(item.value.source.fileName)
                                    : null;
                                const sourcePdfId = sourceFileName ? pdfByName.get(sourceFileName) : undefined;
                                const currentInRecord = review.currentSummary.get(item.id);
                                return <article key={item.id} className="min-w-0 space-y-3 rounded-lg border border-[var(--lume-rule)] p-4">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <div className="space-y-0.5">
                                            <h3 className="[font:var(--type-record-label)] text-[var(--lume-ink-muted)]">{agentReviewItemLabels[item.kind]}</h3>
                                            <p className="[font:var(--type-strong)]">{proposalHeadline(item)}</p>
                                        </div>
                                        {sourceFileName ? (
                                            sourcePdfId ? (
                                                <button type="button" aria-label={`Apri ${sourceFileName}`} className="underline [font:var(--type-meta)] text-[var(--lume-ink-muted)]" disabled={openingPdf}
                                                    onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, sourcePdfId); }}>
                                                    {sourceFileName}
                                                </button>
                                            ) : <span className="[font:var(--type-meta)] text-[var(--lume-ink-muted)]">{sourceFileName}</span>
                                        ) : null}
                                    </div>
                                    {currentInRecord !== undefined && (
                                        <p className="rounded border border-[var(--lume-rule)] bg-[var(--lume-surface-draft)] px-3 py-1.5 [font:var(--type-meta)]">
                                            In scheda: {currentInRecord}
                                        </p>
                                    )}
                                    {typeof item.value.values === 'object' && item.value.values !== null && (
                                        <dl className="space-y-1.5 [font:var(--type-body)]">
                                            {Object.entries(item.value.values).map(([field, value]) => (
                                                <div key={field} className="grid gap-1 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] sm:gap-3">
                                                    <dt className="text-[var(--lume-ink-muted)]">{fieldLabels[field] ?? 'Dato'}</dt>
                                                    <dd className="min-w-0 break-words">{fieldValues[field]?.[String(value)] ?? String(value)}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    )}
                                    {typeof item.value.quote === 'string' && (
                                        <blockquote className="border-l-2 border-[var(--lume-rule-strong)] pl-3 [font:var(--type-meta)] text-[var(--lume-ink-muted)] whitespace-pre-wrap break-words">
                                            {item.value.quote}
                                        </blockquote>
                                    )}
                                </article>;
                            })}
                        </div>
                    </div>
                )}

                {transcriptions.map(item => {
                    const transcriptText = typeof item.value.text === 'string' ? item.value.text : '';
                    const lineCount = transcriptText.split('\n').filter(line => line.trim().length > 0).length;
                    return <details key={item.id} open={notes.length === 0} className="rounded-lg border border-[var(--lume-rule)] p-3">
                        <summary className="cursor-pointer [font:var(--type-strong)]">
                            {agentReviewItemLabels[item.kind]} ({lineCount} {lineCount === 1 ? 'riga' : 'righe'})
                        </summary>
                        <p className="mt-3 min-w-0 whitespace-pre-wrap break-words [font:var(--type-body)]">{transcriptText}</p>
                    </details>;
                })}

                <footer className="space-y-3 border-t border-[var(--lume-rule)] pt-4">
                    {actionMessages.length > 0 && (
                        <div id={actionMessagesId} className="space-y-1.5 rounded-lg border border-[var(--lume-signal-critical)] p-3">
                            {actionMessages.map((message, index) => <p role="alert" key={index} className="[font:var(--type-body)] text-[var(--lume-signal-critical)]">{message}</p>)}
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="[font:var(--type-meta)] text-[var(--lume-ink-muted)]">
                            {pending.length === 1 ? '1 elemento in attesa di conferma' : `${pending.length} elementi in attesa di conferma`}
                        </span>
                        <button className={isApplicable ? SETTINGS_PRIMARY_BUTTON_CLASS : SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !isApplicable}
                            aria-describedby={actionMessages.length > 0 ? actionMessagesId : undefined}
                            onClick={() => { void applyReviewedAgentVisits([visit.cassette.id]); }}>
                            Applica la visita
                        </button>
                    </div>
                </footer>
            </section>;
        })}
        {pdf && <DocumentViewer file={'data:application/pdf;base64,' + pdf.base64} fileName={pdf.name} onClose={() => setPdf(null)} />}
    </main>;
}

export default function IncomingPage() {
    const { isLocked } = useSecurity();
    return isLocked ? null : <UnlockedIncoming />;
}
