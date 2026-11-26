'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CircleDashed, FileText, Inbox, NotebookPen } from 'lucide-react';
import { taxCodeBirthDetails } from '@/lib/patient-identity';
import { applyReviewedAgentVisits, decideAgentVisitItem, readIncomingAgentPdf } from '@/lib/agent-incoming';
import { AGENT_CORRECTABLE_FIELDS, AGENT_THERAPY_STATUSES, AGENT_THERAPY_STATUS_NEEDED, agentCorrectionDropsDrugCodes, agentItemAwaitsDecision, agentItemCorrectable, agentVisitAwaitsReview, type AgentVisitReview } from '@/lib/agent-visit-review';
import type { AgentItemDecision } from '@/lib/agent-visit-application-contract';
import { AGENT_DOSAGE_NOT_STATED, agentReviewDisplayValue, agentReviewDocumentLabel, agentReviewFieldLabels as fieldLabels, agentReviewFieldValues as fieldValues,
    agentReviewItemLabels, agentReviewShownFields } from '@/lib/agent-visit-review-labels';
import surface from '@/components/record-surface.module.css';
import DocumentViewer from '@/components/document-viewer';
import { Button } from '@/components/ui/button';
import css from './da-decidere.module.css';

type VisitItem = AgentVisitReview['visit']['items'][number];
type Snapshot = { visits: AgentVisitReview[]; busy: boolean; applicationError: { visitId: string | null; itemId?: string; message: string } | null };

const SOAP_LABELS: Record<string, string> = { S: 'Soggettivo', O: 'Obiettivo', A: 'Valutazione', P: 'Piano' };
const DATE_FIELDS = new Set(['startDate', 'endDate', 'observedAt', 'date']);

function parseSoapSections(text: string): Array<{ key: string; label: string; body: string }> | null {
    const sections: Array<{ key: string; label: string; body: string[] }> = [];
    for (const rawLine of text.split('\n')) {
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

function itemValues(item: VisitItem): Record<string, string> {
    const raw = item.value.values;
    return raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).map(([field, value]) => [field, String(value ?? '')])) : {};
}

function proposalHeadline(item: VisitItem): string {
    const values = itemValues(item);
    if (item.kind === 'therapy' && values.drugName) return values.dosage && values.dosage !== AGENT_DOSAGE_NOT_STATED ? `${values.drugName} · ${values.dosage}` : values.drugName;
    if (item.kind === 'service' && values.serviceName) return values.serviceName;
    if (item.kind === 'diagnosis' && values.description) return values.code ? `${values.code} · ${values.description}` : values.description;
    if (item.kind === 'exemption' && values.code) return `Esenzione ${values.code}`;
    if (item.kind === 'observation' && values.display) return [values.display, [values.value, values.unitCode].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    if (item.kind === 'pdf' && typeof item.value.name === 'string') return agentReviewDocumentLabel(item.value.name, null);
    return agentReviewItemLabels[item.kind];
}

function formatDepositTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function itemSource(item: VisitItem): { fileName: string; label: string } | null {
    const source = item.value.source;
    if (!source || typeof source !== 'object' || !('fileName' in source)) return null;
    const fileName = String(source.fileName);
    const values = itemValues(item);
    const date = 'documentDate' in source && typeof source.documentDate === 'string' && source.documentDate ? source.documentDate
        : values.startDate || values.prescribedAt || values.observedAt || values.date;
    return { fileName, label: agentReviewDocumentLabel(fileName, date) };
}

function documentLabels(items: VisitItem[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const item of items) {
        const source = itemSource(item);
        if (source && !labels.has(source.fileName)) labels.set(source.fileName, source.label);
    }
    return labels;
}

function CorrectionForm({ item, busy, onCancel, onSave }: { item: VisitItem; busy: boolean; onCancel: () => void; onSave: (values: Record<string, string>) => void }) {
    const fields = agentItemCorrectable(item.kind) ? AGENT_CORRECTABLE_FIELDS[item.kind] : [];
    const values = itemValues(item);
    const [dropsCodes, setDropsCodes] = useState(false);
    const read = (form: HTMLFormElement) => {
        const data = new FormData(form);
        return Object.fromEntries(fields.map(field => [field, String(data.get(field) ?? '')]));
    };
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSave(read(event.currentTarget));
    };
    return <form className={css.correction} onSubmit={submit} onChange={event => setDropsCodes(agentCorrectionDropsDrugCodes(item, read(event.currentTarget)))}
        aria-label={'Correggi ' + agentReviewItemLabels[item.kind].toLowerCase()}>
        {fields.map(field => <label key={field} className={css.correctionField}>
            <span>{fieldLabels[field] ?? field}</span>
            {field === 'status' && item.kind === 'therapy'
                ? <select name={field} defaultValue={values[field] ?? ''} className="mf-input" required>
                    {values[field] ? null : <option value="" disabled>Scegli</option>}
                    {AGENT_THERAPY_STATUSES.map(status => <option key={status} value={status}>{fieldValues.status?.[status] ?? status}</option>)}
                </select>
                : <input name={field} type={DATE_FIELDS.has(field) ? 'date' : 'text'} className="mf-input"
                    defaultValue={DATE_FIELDS.has(field) ? (values[field] ?? '').slice(0, 10) : values[field] ?? ''} />}
        </label>)}
        {dropsCodes ? <p className={css.correctionNote}>Senza codice AIC e ATC: valevano per il farmaco depositato.</p> : null}
        <div className={css.itemActions}>
            <Button variant="text" onClick={onCancel} disabled={busy}>Annulla</Button>
            <Button variant="secondary" type="submit" disabled={busy}>Tieni corretta</Button>
        </div>
    </form>;
}

function StatusChoice({ item, chosen, busy, onChoose }: { item: VisitItem; chosen: string | undefined; busy: boolean; onChoose: (status: string) => void }) {
    return <fieldset className={css.statusChoice} aria-label={'Stato di ' + proposalHeadline(item)}>
        <legend>{fieldLabels.status}</legend>
        {AGENT_THERAPY_STATUSES.map(status => <label key={status}>
            <input type="radio" name={'stato-' + item.id} value={status} checked={chosen === status} disabled={busy} onChange={() => onChoose(status)} />
            {fieldValues.status?.[status] ?? status}
        </label>)}
    </fieldset>;
}

function ItemGestures({ review, item, busy, missing, onDecide, onCorrect }: { review: AgentVisitReview; item: VisitItem; busy: boolean; missing: boolean;
    onDecide: (decision: AgentItemDecision) => void; onCorrect: () => void }) {
    if (!agentItemAwaitsDecision(review, item.id)) return null;
    const blocked = Boolean(review.itemBlockers.get(item.id)?.length) || review.inRecordItemIds.includes(item.id) || missing;
    return <div className={css.itemActions} role="group" aria-label={'Decidi ' + proposalHeadline(item)}>
        <Button variant="text" disabled={busy} onClick={() => onDecide('discard')}>Scarta</Button>
        {agentItemCorrectable(item.kind) ? <Button variant="secondary" disabled={busy} onClick={onCorrect}>Correggi</Button> : null}
        <Button variant={blocked ? 'secondary' : 'primary'} disabled={busy || blocked} onClick={() => onDecide('keep')}>Tieni</Button>
    </div>;
}

export function VisitQueue({ visits, busy, applicationError }: Snapshot) {
    const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null);
    const [openingPdf, setOpeningPdf] = useState(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [correcting, setCorrecting] = useState<string | null>(null);
    const [chosenStatus, setChosenStatus] = useState<Record<string, string>>({});
    const showPdf = async (visitId: string, revision: number, itemId: string) => {
        setOpeningPdf(true);
        setPdfError(null);
        try { setPdf(await readIncomingAgentPdf(visitId, revision, itemId)); }
        catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) setPdfError(error instanceof Error ? error.message : 'PDF non disponibile.');
        } finally { setOpeningPdf(false); }
    };
    const decide = async (visitId: string, itemId: string, decision: AgentItemDecision, correction?: Record<string, string>) => {
        if (await decideAgentVisitItem(visitId, itemId, decision, correction)) setCorrecting(null);
    };
    const applicable = visits.filter(agentVisitAwaitsReview);
    const generalApplicationError = applicationError && !visits.some(({ visit }) => visit.cassette.id === applicationError.visitId)
        ? applicationError.message : null;

    return <>
        {generalApplicationError && <p role="alert" className={css.alert}>{generalApplicationError}</p>}
        {pdfError && <p role="alert" className={css.alert}>{pdfError}</p>}
        {!visits.length && !busy && (
            <section className={surface.tray} data-record-tray="in-arrivo" aria-labelledby="da-decidere-vuoto">
                <div className={`${surface.island} ${css.empty}`}>
                    <div className={surface.islandHeader}>
                        <span className={surface.islandIcon} aria-hidden="true"><Inbox size={15} /></span>
                        <h2 id="da-decidere-vuoto">Nessuna visita in attesa</h2>
                    </div>
                    <p>Le visite depositate da Codex compaiono qui per la conferma prima di entrare in cartella.</p>
                </div>
            </section>
        )}
        {visits.map(review => {
            const { visit } = review;
            const decidedIds = new Set([...review.appliedItemIds, ...review.discardedItemIds]);
            const pending = visit.items.filter(item => !decidedIds.has(item.id));
            const decided = visit.items.filter(item => decidedIds.has(item.id));
            const pdfItems = visit.items.filter(item => item.kind === 'pdf');
            const pendingPdfs = pending.filter(item => item.kind === 'pdf');
            const pdfByName = new Map(pdfItems.filter(item => typeof item.value.name === 'string').map(item => [String(item.value.name), item.id]));
            const pdfLabels = documentLabels(visit.items);
            const pdfLabel = (name: string) => pdfLabels.get(name) ?? agentReviewDocumentLabel(name, null);
            const gesturesUnavailable = review.newPatient ? 'Prima visita: le voci entrano tutte insieme con «Applica la visita».'
                : review.blockers.length ? 'Risolvi prima i dubbi della visita, qui sopra.' : null;
            const notes = pending.filter(item => item.kind === 'note');
            const transcriptions = pending.filter(item => item.kind === 'transcription');
            const proposals = pending.filter(item => item.kind !== 'pdf' && item.kind !== 'note' && item.kind !== 'transcription');
            const itemError = applicationError?.visitId === visit.cassette.id && applicationError.itemId ? applicationError : null;
            const visitError = applicationError?.visitId === visit.cassette.id && !applicationError.itemId ? applicationError.message : null;
            const itemsBlocked = !review.blockers.length && review.proposalBlockers.length > 0;
            const actionMessages = [...review.blockers, ...(itemsBlocked ? ['Decidi prima le voci segnate.'] : []), ...(visitError ? [visitError] : [])];
            const actionMessagesId = `visita-${visit.cassette.id}-esito`;
            const isApplicable = applicable.includes(review);
            const fiscalCode = typeof visit.anchor.fiscalCode === 'string' ? visit.anchor.fiscalCode : null;
            const birth = review.newPatient && taxCodeBirthDetails(review.newPatient.taxCode);
            const hasPatientName = Boolean(review.patient && (review.patient.firstName || review.patient.lastName));
            const status = visit.cassette.status !== 'closed'
                ? { label: 'Deposito in corso', pill: surface.pillNeutral }
                : isApplicable
                ? { label: decided.length ? 'Decisa in parte' : 'Pronta da applicare', pill: surface.pillSuccess }
                : { label: 'Da verificare', pill: surface.pillWarning };
            const contents = [
                notes.length > 0 ? 'Nota' : null,
                transcriptions.length > 0 ? 'Trascrizione' : null,
                pdfItems.length > 0 ? `${pdfItems.length} PDF` : null,
                proposals.length > 0 ? (proposals.length === 1 ? '1 proposta' : `${proposals.length} proposte`) : null,
            ].filter(Boolean).join(' · ');
            const gestures = (item: VisitItem) => {
                const asksStatus = review.itemNeeds.get(item.id)?.includes('status') ?? false;
                const status = chosenStatus[item.id];
                return <>
                    {itemError?.itemId === item.id ? <p role="alert" className={css.itemAlert}>{itemError.message}</p> : null}
                    <ItemGestures review={review} item={item} busy={busy} missing={asksStatus && !status} onCorrect={() => setCorrecting(item.id)}
                        onDecide={decision => { void decide(visit.cassette.id, item.id, decision, decision === 'keep' && asksStatus && status ? { status } : undefined); }} />
                </>;
            };

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
                {actionMessages.length > 0 && (
                    <div id={actionMessagesId} className={`${surface.island} ${css.blockers}`}>
                        {actionMessages.map((message, index) => <p role="alert" key={index}>{message}</p>)}
                    </div>
                )}

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
                                    {pdfLabel(item.value.name)}
                                </button>
                            ))}
                        </div>
                        {pendingPdfs.map(item => agentItemAwaitsDecision(review, item.id) ? <div key={item.id} className={css.pdfDecision}>
                            <span>{proposalHeadline(item)}</span>
                            {gestures(item)}
                        </div> : null)}
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
                        {gestures(item)}
                    </article>;
                })}

                {proposals.length > 0 && (
                    <>
                        <p className={css.groupLabel}>Proposte da confermare <span>{proposals.length}</span></p>
                        <div className={css.proposals}>
                            {proposals.map(item => {
                                const source = itemSource(item);
                                const sourcePdfId = source ? pdfByName.get(source.fileName) : undefined;
                                const currentInRecord = review.currentSummary.get(item.id);
                                const itemBlockers = review.itemBlockers.get(item.id) ?? [];
                                const asksStatus = review.itemNeeds.get(item.id)?.includes('status') ?? false;
                                const inRecord = review.inRecordItemIds.includes(item.id);
                                const state = inRecord ? { label: 'Già in scheda', pill: surface.pillNeutral }
                                    : itemBlockers.length ? { label: 'Da verificare', pill: surface.pillWarning }
                                    : asksStatus ? { label: 'Manca lo stato', pill: surface.pillWarning } : null;
                                return <article key={item.id} className={`${surface.islandProposal} ${css.proposal}`}>
                                    <div className={`${surface.islandHeader} ${css.proposalHeader}`}>
                                        <span className={surface.islandIcon} aria-hidden="true"><CircleDashed size={15} /></span>
                                        <h3>{agentReviewItemLabels[item.kind]}</h3>
                                        {state ? <span className={state.pill}>{state.label}</span> : null}
                                    </div>
                                    <div className={css.proposalBody}>
                                        <div className={css.proposalFacts}>
                                            <p className={css.headline}>{proposalHeadline(item)}</p>
                                            {currentInRecord !== undefined && <p className={css.current}>In scheda: {currentInRecord}</p>}
                                            {correcting === item.id ? (
                                                <CorrectionForm item={item} busy={busy} onCancel={() => setCorrecting(null)}
                                                    onSave={values => { void decide(visit.cassette.id, item.id, 'correct', values); }} />
                                            ) : (
                                                <dl className={css.fields}>
                                                    {agentReviewShownFields(item.kind, itemValues(item)).map(([field, value]) => (
                                                        <div key={field}>
                                                            <dt>{fieldLabels[field] ?? field}</dt>
                                                            <dd className={field === 'dosage' && value === AGENT_DOSAGE_NOT_STATED ? css.notStated : undefined}>
                                                                {agentReviewDisplayValue(field, value)}
                                                            </dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                            )}
                                        </div>
                                        <aside className={css.proposalSource} aria-label="Fonte">
                                            {source ? (
                                                sourcePdfId ? (
                                                    <button type="button" aria-label={`Apri ${source.label}`} className={`${surface.islandAction} ${css.sourceLink}`} disabled={openingPdf}
                                                        onClick={() => { void showPdf(visit.cassette.id, visit.cassette.revision, sourcePdfId); }}>
                                                        {source.label}
                                                    </button>
                                                ) : <span className={css.sourceName}>{source.label}</span>
                                            ) : null}
                                            {typeof item.value.quote === 'string' && <blockquote className={css.quote}>{item.value.quote}</blockquote>}
                                        </aside>
                                    </div>
                                    {itemBlockers.map(message => <p key={message} className={css.itemBlocker}>{message}</p>)}
                                    {review.itemNeeds.get(item.id)?.includes('status') && correcting !== item.id ? <>
                                        <p className={css.itemBlocker}>{AGENT_THERAPY_STATUS_NEEDED}</p>
                                        {agentItemAwaitsDecision(review, item.id) ? <StatusChoice item={item} chosen={chosenStatus[item.id]} busy={busy}
                                            onChoose={status => setChosenStatus(current => ({ ...current, [item.id]: status }))} /> : null}
                                    </> : null}
                                    {correcting === item.id ? null : gestures(item)}
                                    {gesturesUnavailable && !agentItemAwaitsDecision(review, item.id) ? <p className={css.itemInRecord}>{gesturesUnavailable}</p> : null}
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
                        {gestures(item)}
                    </details>;
                })}

                {decided.length > 0 && (
                    <section className={`${surface.island} ${css.decided}`} aria-label="Voci decise">
                        <p className={css.groupLabel}>Decise <span>{decided.length}</span></p>
                        <ul>
                            {decided.map(item => <li key={item.id}>
                                {review.correctedItemIds.includes(item.id)
                                    ? <><span>{agentReviewItemLabels[item.kind]}</span><span className={surface.pillSuccess}>Corretta in scheda</span></>
                                    : <><span>{agentReviewItemLabels[item.kind]} · {proposalHeadline(item)}</span>
                                        {review.discardedItemIds.includes(item.id)
                                            ? <span className={surface.pillNeutral}>Scartata</span>
                                            : <span className={surface.pillSuccess}>In scheda</span>}</>}
                            </li>)}
                        </ul>
                    </section>
                )}

                <footer className={css.visitFooterBlock}>
                    {isApplicable && review.newPatient && <p className="[font:var(--type-meta)]">
                        Applicando questa visita crei anche la scheda del paziente.
                        {birth && ` Sesso nel CF: ${birth.sex}.`}
                    </p>}
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
    </>;
}
