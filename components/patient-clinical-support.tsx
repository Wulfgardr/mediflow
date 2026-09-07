'use client';

/* @Codex WUL-678: one clinical proposal area, folded without unmounting controllers. */
import type { ReactNode } from 'react';
import AIPatientInsight from '@/components/ai-patient-insight';
import type { Patient } from '@/lib/db';
import disclosure from '@/components/patient-disclosure.module.css';

export function PatientClinicalSupport({ patient, stale, smartImport }: {
    patient: Patient;
    stale: boolean;
    smartImport?: ReactNode;
}) {
    return <div className={disclosure.clinicalSupport}>
        <details id="patient-insight" className={disclosure.disclosure}>
            <summary>Riepilogo assistito · Patient Insight{stale ? ' · dati da aggiornare' : ''}</summary>
            <AIPatientInsight patient={patient} stale={stale} />
        </details>
        {smartImport ? <details id="smart-import" className={disclosure.disclosure}>
            <summary>Proposte dalle fonti cliniche · Smart Import</summary>
            {smartImport}
        </details> : null}
    </div>;
}
