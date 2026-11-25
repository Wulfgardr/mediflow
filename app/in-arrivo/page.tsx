'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { taxCodeBirthDetails } from '@/lib/patient-identity';
import { useSecurity } from '@/components/security-provider';
import { agentIncomingSnapshot, agentIncomingServerSnapshot, subscribeAgentIncoming, refreshAgentIncoming, applyReviewedAgentVisits, readIncomingAgentPdf } from '@/lib/agent-incoming';
import { agentVisitAwaitsReview, type AgentVisitReview } from '@/lib/agent-visit-review';
import { CircleDashed, FileText, Inbox, NotebookPen } from 'lucide-react';
import surface from '@/components/record-surface.module.css';
import css from './in-arrivo.module.css';
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

    return <main className={`${surface.page} ${css.page}`} data-record-page>
        <header className={surface.pageHeader}>
            <div className={surface.pageHeading}>
                <h1 className={surface.pageTitle}>In arrivo</h1>
                {visits.length > 0 ? (
                    <p className={surface.pageMeta}>
                        {applicable.length === 1 ? '1 visita pronta' : `${applicable.length} visite pronte`}
                        {blockedCount > 0 ? ` · ${blockedCount === 1 ? '1 da verificare' : `${blockedCount} da verificare`}` : ''}
                    </p>
                ) : null}
            </div>
            <div className={surface.pageActions}>
                <Link href="/settings/agenti" className="mf-button-secondary">Agenti</Link>
                <button type="button" className="mf-button-secondary" disabled={busy} onClick={() => { void refreshAgentIncoming(); }}>Aggiorna</button>
                {visits.length > 0 ? (
                    <button type="button" className={applicable.length ? 'mf-button-primary' : 'mf-button-secondary'} disabled={busy || !applicable.length} onClick={() => { void applyReviewedAgentVisits(applicable.map(value => value.visit.cassette.id)); }}>Applica tutte le visite senza dubbi</button>
                ) : null}
            </div>
        </header>
        {error && <p role="alert" className={css.alert}>{error}</p>}
        {generalApplicationError && <p role="alert" className={css.alert}>{generalApplicationError}</p>}
        {pdfError && <p role="alert" className={css.alert}>{pdfError}</p>}
        {!visits.length && !busy && !error && (
            <section className={surface.tray} data-record-tray="in-arrivo" aria-labelledby="in-arrivo-vuoto">
                <div className={`${surface.island} ${css.empty}`}>
                    <div className={surface.islandHeader}>
                        <span className={surface.islandIcon} aria-hidden="true"><Inbox size={15} /></span>
                        <h2 id="in-arrivo-vuoto">Nessuna visita in attesa</h2>
                    </div>
                    <p>Le visite depositate da Codex compaiono qui per la conferma prima di entrare in cartella.</p>
                </div>
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
            const birth = review.newPatient && taxCodeBirthDetails(review.newPatient.taxCode);
            const hasPatientName = Boolean(review.patient && (review.patient.firstName || review.patient.lastName));
            const status = visit.cassette.status !== 'closed'
                ? { label: 'Deposito in corso', pill: surface.pillNeutral }
                : isApplicable
                ? { label: 'Pronta da applicare', pill: surface.pillSuccess }
                : { label: 'Da verificare', pill: surface.pillWarning };
            const contents = [
                notes.length > 0 ? 'Nota' : null,
                transcriptions.length > 0 ? 'Trascrizione' : null,
                pdfItems.length > 0 ? `${pdfItems.length} PDF` : null,
                proposals.length > 0 ? (proposals.length === 1 ? '1 proposta' : `${proposals.length} proposte`) : null,
            ].filter(Boolean).join(' · ');

            return <section key={visit.cassette.id} className={surface.tray} data-record-tray="in-arrivo" aria-label={'Visita ' + visit.cassette.id}>
                <h2 className={surface.zoneTitle}>
                    {hasPatientName && review.patient ? `${review.patient.lastName} ${review.patient.firstName}` : fiscalCode ?? 'Identità da confermare'}
                </h2>
                <div className={css.visitMeta}>
                    <span className={status.pill}>{status.label}</span>
                    {hasPatientName && fiscalCode ? <span className="lume-code">{fiscalCode}</span> : null}
                    <span>Depositata {formatDepositTime(visit.cassette.depositedAt)}</span>
                    {contents ? <span>{contents}</span> : null}
                    {review.patient ? (
                        <Link href={`/patients/${review.patient.id}/modules`} className={surface.islandAction}>Apri scheda</Link>
                    ) : null}
                </div>

                {pdfItems.length > 0 && (
                    <section className={surface.island} aria-label="PDF della visita">
                        <div className={surface.islandHeader}>
                            <span className={surface.islandIcon} aria-hidden="true"><FileText size={15} /></span>
                            <h3>PDF</h3>
                            <span className={css.pdfCount}>{pdfItems.length}</span>
                        </div>
                        <div className={css.pdfList}>
                            {pdfItems.map(item => typeof item.value.name === 'string' && (
                                <button key={item.id} type="button" className="mf-button-secondary" disabled={openingPdf}
                                    onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, item.id); }}>
                                    {item.value.name}
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {notes.map(item => {
                    const noteText = typeof item.value.text === 'string' ? item.value.text : '';
                    const soap = parseSoapSections(noteText);
                    return <article key={item.id} className={surface.island}>
                        <div className={surface.islandHeader}>
                            <span className={surface.islandIcon} aria-hidden="true"><NotebookPen size={15} /></span>
                            <h3>{agentReviewItemLabels[item.kind]}</h3>
                        </div>
                        {soap ? (
                            <dl className={css.soap}>
                                {soap.map(section => (
                                    <div key={section.key}>
                                        <dt>{section.label}</dt>
                                        <dd>{section.body}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className={css.prose}>{noteText}</p>
                        )}
                    </article>;
                })}

                {proposals.length > 0 && (
                    <>
                        <p className={css.groupLabel}>Proposte da confermare <span>{proposals.length}</span></p>
                        <div className={css.proposals}>
                            {proposals.map(item => {
                                const sourceFileName = Boolean(item.value.source) && typeof item.value.source === 'object' && item.value.source !== null && 'fileName' in item.value.source
                                    ? String(item.value.source.fileName)
                                    : null;
                                const sourcePdfId = sourceFileName ? pdfByName.get(sourceFileName) : undefined;
                                const currentInRecord = review.currentSummary.get(item.id);
                                return <article key={item.id} className={surface.islandProposal}>
                                    <div className={surface.islandHeader}>
                                        <span className={surface.islandIcon} aria-hidden="true"><CircleDashed size={15} /></span>
                                        <h3>{agentReviewItemLabels[item.kind]}</h3>
                                        {sourceFileName ? (
                                            sourcePdfId ? (
                                                <button type="button" aria-label={`Apri ${sourceFileName}`} className={`${surface.islandAction} ${css.sourceLink}`} disabled={openingPdf}
                                                    onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, sourcePdfId); }}>
                                                    {sourceFileName}
                                                </button>
                                            ) : <span className={css.sourceName}>{sourceFileName}</span>
                                        ) : null}
                                    </div>
                                    <p className={css.headline}>{proposalHeadline(item)}</p>
                                    {currentInRecord !== undefined && (
                                        <p className={css.current}>In scheda: {currentInRecord}</p>
                                    )}
                                    {typeof item.value.values === 'object' && item.value.values !== null && (
                                        <dl className={css.fields}>
                                            {Object.entries(item.value.values).map(([field, value]) => (
                                                <div key={field}>
                                                    <dt>{fieldLabels[field] ?? 'Dato'}</dt>
                                                    <dd>{fieldValues[field]?.[String(value)] ?? String(value)}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    )}
                                    {typeof item.value.quote === 'string' && (
                                        <blockquote className={css.quote}>{item.value.quote}</blockquote>
                                    )}
                                </article>;
                            })}
                        </div>
                    </>
                )}

                {transcriptions.map(item => {
                    const transcriptText = typeof item.value.text === 'string' ? item.value.text : '';
                    const lineCount = transcriptText.split('\n').filter(line => line.trim().length > 0).length;
                    return <details key={item.id} open={notes.length === 0} className={`${surface.island} ${css.transcript}`}>
                        <summary>
                            {agentReviewItemLabels[item.kind]} ({lineCount} {lineCount === 1 ? 'riga' : 'righe'})
                        </summary>
                        <p className={css.prose}>{transcriptText}</p>
                    </details>;
                })}

                <footer className={css.visitFooterBlock}>
                    {isApplicable && review.newPatient && <p className="[font:var(--type-meta)]">
                        Applicando questa visita crei anche la scheda del paziente.
                        {birth && ` Sesso nel CF: ${birth.sex}.`}
                    </p>}
                    {actionMessages.length > 0 && (
                        <div id={actionMessagesId} className={`${surface.island} ${css.blockers}`}>
                            {actionMessages.map((message, index) => <p role="alert" key={index}>{message}</p>)}
                        </div>
                    )}
                    <div className={css.visitFooter}>
                        <span>
                            {pending.length === 1 ? '1 elemento in attesa di conferma' : `${pending.length} elementi in attesa di conferma`}
                        </span>
                        <button type="button" className={isApplicable ? 'mf-button-primary' : 'mf-button-secondary'} disabled={busy || !isApplicable}
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
