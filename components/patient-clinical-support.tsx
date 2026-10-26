'use client';

/* WUL-678: one clinical proposal area, folded without unmounting controllers. */
import { Disclosure } from '@/components/disclosure';
import AIPatientInsight from '@/components/ai-patient-insight';
import type { Patient } from '@/lib/db';
import disclosure from '@/components/patient-disclosure.module.css';
import styles from './patient-insight.module.css';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';

export function PatientInsightSummary({ hasProposal }: { hasProposal: boolean }) {
    return <p className={styles.summary} data-testid="patient-insight-proposal-summary">
        <span>Patient Insight · {hasProposal ? '1 proposta da rivedere' : 'Nessuna proposta da rivedere'}</span>
        <a href="#patient-insight" className="mf-button-text">Apri Patient Insight</a>
    </p>;
}

export function PatientClinicalSupport({ patient, stale, onProposalChange }: {
    patient: Patient;
    stale: boolean;
    onProposalChange?: (patientKey: string | null) => void;
}) {
    const folder = useRuntimeTwinFolder();
    return <section className={styles.section} aria-label="Patient Insight" hidden={folder !== null && folder !== 'attenzione'}>
        <h3>Patient Insight</h3>
        <Disclosure id="patient-insight" className={disclosure.disclosure} title="Proposte">
            <AIPatientInsight patient={patient} stale={stale} onProposalChange={onProposalChange} />
        </Disclosure>
    </section>;
}
