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
import { CircleDashed } from 'lucide-react';

export type SheetInsightProposal = Extract<PatientInsightPreviewWire, { status: 'available' }>;

const venueLabels = { local_process: 'dal modello locale', cloud: 'da un servizio esterno' } as const;

export function PatientProposalsSummary({ hasInsightProposal, hasSmartImportProposal, preview, patientId }: {
    hasInsightProposal: boolean;
    hasSmartImportProposal: boolean;
    preview?: SheetInsightProposal | null;
    patientId?: string;
}) {
    const count = Number(hasInsightProposal) + Number(hasSmartImportProposal);
    const shown = hasInsightProposal && preview ? preview : null;
    const sentences = shown ? [...shown.proposal.alerts, ...shown.proposal.currentState, ...shown.proposal.nextSteps] : [];
    const generated = shown ? new Date(shown.proposal.generatedAt) : null;
    return <div className={`${styles.summary} ${sheet.proposalSummary}`} data-testid="patient-proposals-summary" data-has-proposals={count > 0}>
        <header className={sheet.islandHeader}>
            <span className={sheet.proposalIcon}><CircleDashed size={16} aria-hidden="true" /></span>
            <h2 className="type-section-heading">Quadro paziente</h2>
        </header>
        {shown ? <p className={sheet.proposalLabel}>Proposta · non registrata</p> : null}
        {shown && !hasSmartImportProposal ? null : <InkState state="pencil">{count === 0 ? 'Nessuna proposta da rivedere' : `${count} ${count === 1 ? 'proposta' : 'proposte'} da rivedere`}</InkState>}
        {shown ? <>
            {sentences.length === 0 && shown.proposal.summary ? <p className={sheet.proposalText}><PrivacyBlur intensity="sm">{shown.proposal.summary}</PrivacyBlur></p> : null}
            {sentences.length ? <ul className={sheet.proposalList}>{sentences.map((sentence, index) => <li key={`${index}-${sentence}`}>
                <PrivacyBlur intensity="sm">{sentence}</PrivacyBlur>
            </li>)}</ul> : null}
            {shown.proposal.gaps.length ? <div className={sheet.proposalGaps}>
                <h3>Dati mancanti</h3>
                <ul>{shown.proposal.gaps.map((gap, index) => <li key={`${index}-${gap}`}><PrivacyBlur intensity="sm">{gap}</PrivacyBlur></li>)}</ul>
            </div> : null}
            {patientId ? <nav aria-label="Sezioni della cartella per la revisione" className={sheet.proposalSources}>
                <a href={`/patients/${patientId}/modules#terapie`}>Terapie</a>
                <a href={`/patients/${patientId}/modules#diario`}>Diario</a>
                <a href={`/patients/${patientId}/modules#quadro`}>Scheda clinica</a>
            </nav> : null}
        </> : null}
        {shown && generated && Number.isFinite(generated.getTime()) ? <p className={sheet.proposalReceipt}>
            Generata <time dateTime={generated.toISOString()}>{generated.toDateString() === new Date().toDateString() ? 'oggi' : `il ${generated.toLocaleDateString('it-IT')}`} alle {generated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</time> <span title={shown.receipt.model}>{venueLabels[shown.receipt.venue]}</span>.{shown.receipt.egress === 'none' ? ' Nessun dato inviato all’esterno.' : null}
        </p> : null}
        <nav aria-label="Azioni sulle proposte" className={styles.links}>
            <a href="#patient-insight" aria-label="Apri il Quadro e le fonti" className="mf-button-secondary">Apri il Quadro</a>
            {hasSmartImportProposal ? <a href="#smart-import" className="mf-button-text">Smart Import</a> : null}
        </nav>
    </div>;
}

export function PatientClinicalSupport({ patient, stale, onProposalChange }: {
    patient: Patient;
    stale: boolean;
    onProposalChange?: (patientKey: string | null, preview?: SheetInsightProposal | null) => void;
}) {
    const folder = useRuntimeTwinFolder();
    return <section className={styles.section} aria-label="Quadro paziente" hidden={folder !== null && folder !== 'attenzione'}>
        <h3>Quadro paziente</h3>
        <Disclosure id="patient-insight" className={disclosure.disclosure} title="Proposte">
            <AIPatientInsight patient={patient} stale={stale} onProposalChange={onProposalChange} />
        </Disclosure>
    </section>;
}
