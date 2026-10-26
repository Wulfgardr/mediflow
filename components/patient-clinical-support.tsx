'use client';

/* WUL-678: one clinical proposal area, folded without unmounting controllers. */
import { Disclosure } from '@/components/disclosure';
import AIPatientInsight from '@/components/ai-patient-insight';
import type { Patient } from '@/lib/db';
import disclosure from '@/components/patient-disclosure.module.css';
import styles from './patient-insight.module.css';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';

export function PatientProposalsSummary({ hasInsightProposal, hasSmartImportProposal, smartImportAvailable }: {
    hasInsightProposal: boolean;
    hasSmartImportProposal: boolean;
    smartImportAvailable: boolean;
}) {
    const count = Number(hasInsightProposal) + Number(hasSmartImportProposal);
    return <div className={styles.summary} data-testid="patient-proposals-summary">
        <span>{count === 0 ? 'Nessuna proposta da rivedere' : `${count} ${count === 1 ? 'proposta' : 'proposte'} da rivedere`}</span>
        <span className={styles.links}>
            <a href="#patient-insight" className="mf-button-text">Patient Insight</a>
            {smartImportAvailable ? <a href="#smart-import" className="mf-button-text">Smart Import</a> : null}
        </span>
    </div>;
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
