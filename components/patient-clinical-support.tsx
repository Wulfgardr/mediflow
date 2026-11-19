'use client';

/* WUL-678: one clinical proposal area, folded without unmounting controllers. */
import { Disclosure } from '@/components/disclosure';
import AIPatientInsight from '@/components/ai-patient-insight';
import type { Patient } from '@/lib/db';
import type { PatientInsightPreviewWire } from '@/lib/ai-providers/fabric/patient-insight-preview-contract';
import disclosure from '@/components/patient-disclosure.module.css';
import styles from './patient-insight.module.css';
import sheet from './twin-synoptic-sheet.module.css';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';
import { InkState } from '@/components/ui/ink-state';
import PrivacyBlur from './privacy-blur';
import { CircleDashed, Sparkles } from 'lucide-react';

export type SheetInsightProposal = Extract<PatientInsightPreviewWire, { status: 'available' }>;

const venueLabels = { local_process: 'dal modello locale', cloud: 'da un servizio esterno' } as const;

function proposalSentences(proposal: SheetInsightProposal['proposal']) {
    return [
        ...proposal.alerts.map(text => ({ text, alert: true })),
        ...proposal.currentState.map(text => ({ text, alert: false })),
        ...proposal.nextSteps.map(text => ({ text, alert: false })),
    ];
}

export function PatientProposalsSummary({ hasInsightProposal, hasSmartImportProposal, smartImportAvailable, proposal, patientId }: {
    hasInsightProposal: boolean;
    hasSmartImportProposal: boolean;
    smartImportAvailable: boolean;
    proposal?: SheetInsightProposal | null;
    patientId?: string;
}) {
    const count = Number(hasInsightProposal) + Number(hasSmartImportProposal);
    const shown = hasInsightProposal && proposal ? proposal : null;
    const sentences = shown ? proposalSentences(shown.proposal) : [];
    const captured = shown ? new Date(shown.proposal.currentness.capturedAt) : null;
    return <div className={`${styles.summary} ${sheet.proposalSummary}`} data-testid="patient-proposals-summary" data-has-proposals={count > 0}>
        <header className={sheet.islandHeader}>
            <span className={sheet.proposalIcon}><CircleDashed size={16} aria-hidden="true" /></span>
            <h2 className="type-section-heading">Quadro paziente</h2>
        </header>
        {shown ? <p className={sheet.proposalLabel}>Proposta · non registrata</p>
            : <InkState state="pencil">{count === 0 ? 'Nessuna proposta da rivedere' : `${count} ${count === 1 ? 'proposta' : 'proposte'} da rivedere`}</InkState>}
        {shown ? <>
            {shown.proposal.summary ? <p className={sheet.proposalText}><PrivacyBlur intensity="sm">{shown.proposal.summary}</PrivacyBlur></p> : null}
            <ul className={sheet.proposalList}>{sentences.map((sentence, index) => <li key={`${index}-${sentence.text}`} data-alert={sentence.alert ? 'true' : undefined}>
                <PrivacyBlur intensity="sm">{sentence.text}</PrivacyBlur>
            </li>)}</ul>
            {patientId ? <nav aria-label="Fonti della proposta" className={sheet.proposalSources}>
                <a href={`/patients/${patientId}/modules#terapie`}>Terapie</a>
                <a href={`/patients/${patientId}/modules#diario`}>Diario</a>
                <a href={`/patients/${patientId}/modules#quadro`}>Scheda clinica</a>
            </nav> : null}
        </> : null}
        <span className={styles.links}>
            <a href="#patient-insight" className="mf-button-secondary"><Sparkles size={16} aria-hidden="true" />Apri il Quadro e le fonti</a>
            {smartImportAvailable ? <a href="#smart-import" className="mf-button-text">Smart Import</a> : null}
        </span>
        {shown && captured ? <p className={sheet.proposalReceipt}>
            Generata il <time dateTime={captured.toISOString()}>{captured.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> {venueLabels[shown.receipt.venue]} · {shown.receipt.model}
        </p> : null}
    </div>;
}

export function PatientClinicalSupport({ patient, stale, onProposalChange }: {
    patient: Patient;
    stale: boolean;
    onProposalChange?: (patientKey: string | null) => void;
}) {
    const folder = useRuntimeTwinFolder();
    return <section className={styles.section} aria-label="Quadro paziente" hidden={folder !== null && folder !== 'attenzione'}>
        <h3>Quadro paziente</h3>
        <Disclosure id="patient-insight" className={disclosure.disclosure} title="Proposte">
            <AIPatientInsight patient={patient} stale={stale} onProposalChange={onProposalChange} />
        </Disclosure>
    </section>;
}
