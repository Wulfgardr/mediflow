'use client';

import { useState, useSyncExternalStore } from 'react';
import { useSecurity } from '@/components/security-provider';
import { agentIncomingSnapshot, agentIncomingServerSnapshot, subscribeAgentIncoming, refreshAgentIncoming, applyReviewedAgentVisits } from '@/lib/agent-incoming';
import { automaticAgentKind } from '@/lib/agent-visit-application-contract';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import DocumentViewer from '@/components/document-viewer';

const fieldLabels: Record<string, string> = { drugName: 'Farmaco', activePrinciple: 'Principio attivo', dosage: 'Posologia', status: 'Stato', startDate: 'Dal', endDate: 'Al', aic: 'AIC', atc: 'ATC', serviceName: 'Prestazione', items: 'Voci', category: 'Categoria', priority: 'Priorità', prescribedAt: 'Prescritta il', requestReference: 'Riferimento', clinicalQuestion: 'Quesito clinico', description: 'Descrizione', code: 'Codice', system: 'Sistema', date: 'Data', display: 'Esame', value: 'Valore', unit: 'Unità', unitCode: 'Codice unità', refText: 'Intervallo di riferimento', refLow: 'Limite inferiore', refHigh: 'Limite superiore', observedAt: 'Misurato il', subject: 'Soggetto', temporality: 'Periodo', certainty: 'Certezza' };

function UnlockedIncoming() {
    const { visits, busy, error } = useSyncExternalStore(subscribeAgentIncoming, agentIncomingSnapshot, agentIncomingServerSnapshot);
    const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null);
    const applicable = visits.filter(review => review.visit.cassette.status === 'closed' && !review.blockers.length && !review.proposalBlockers.length
        && review.visit.items.filter(item => automaticAgentKind(item.kind)).every(item => review.appliedItemIds.includes(item.id))
        && review.visit.items.some(item => !automaticAgentKind(item.kind) && !review.appliedItemIds.includes(item.id)));
    return <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="type-page-title">In arrivo</h1>
        <div className="flex flex-wrap gap-3">
            <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void refreshAgentIncoming(); }}>Aggiorna</button>
            <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !applicable.length} onClick={() => { void applyReviewedAgentVisits(applicable.map(value => value.visit.cassette.id)); }}>Applica tutte le visite senza dubbi</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {!visits.length && !busy && !error && <p>Nessuna visita in attesa.</p>}
        {visits.map(review => {
            const { visit } = review;
            const pending = visit.items.filter(item => !review.appliedItemIds.includes(item.id));
            return <section key={visit.cassette.id} className="space-y-4 rounded-lg border p-4" aria-label={'Visita ' + visit.cassette.id}>
                <h2 className="text-lg font-semibold">{typeof visit.anchor.fiscalCode === 'string' ? visit.anchor.fiscalCode : 'Identità da confermare'}</h2>
                {review.patient && <p>{review.patient.lastName} {review.patient.firstName}</p>}
                <p>{visit.cassette.status === 'closed' ? 'Visita chiusa' : 'Deposito in corso'}</p>
                {[...review.blockers, ...review.proposalBlockers].map((message, index) => <p role="alert" key={index}>{message}</p>)}
                {pending.map(item => <article key={item.id} className="space-y-2 whitespace-pre-wrap border-t pt-3">
                    <h3 className="font-semibold">{{ note: 'Nota', transcription: 'Trascrizione', pdf: 'PDF', therapy: 'Terapia proposta', service: 'Prestazione proposta', diagnosis: 'Diagnosi proposta', exemption: 'Esenzione proposta', observation: 'Osservazione proposta' }[item.kind]}</h3>
                    {typeof item.value.text === 'string' && <p>{item.value.text}</p>}
                    {review.currentSummary.has(item.id) && <p>In scheda: {review.currentSummary.get(item.id)}</p>}
                    {typeof item.value.values === 'object' && item.value.values !== null && <dl>{Object.entries(item.value.values).map(([field, value]) => <div key={field} className="grid grid-cols-[minmax(8rem,1fr)_3fr] gap-3"><dt>{fieldLabels[field] ?? 'Dato'}</dt><dd>{String(value)}</dd></div>)}</dl>}
                    {typeof item.value.quote === 'string' && <blockquote className="border-l-2 pl-3">{item.value.quote}</blockquote>}
                    {Boolean(item.value.source) && typeof item.value.source === 'object' && item.value.source !== null && 'fileName' in item.value.source && <p>{String(item.value.source.fileName)}</p>}
                    {item.kind === 'pdf' && typeof item.value.name === 'string' && typeof item.value.base64 === 'string'
                        && <button className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => setPdf({ name: String(item.value.name), base64: String(item.value.base64) })}>{item.value.name}</button>}
                </article>)}
                <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !applicable.includes(review)} onClick={() => { void applyReviewedAgentVisits([visit.cassette.id]); }}>Applica la visita</button>
            </section>;
        })}
        {pdf && <DocumentViewer file={'data:application/pdf;base64,' + pdf.base64} fileName={pdf.name} onClose={() => setPdf(null)} />}
    </main>;
}
export default function IncomingPage() {
    const { isLocked } = useSecurity();
    return isLocked ? null : <UnlockedIncoming />;
}
