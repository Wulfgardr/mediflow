'use client';

/* WUL-678: one clinical proposal area, folded without unmounting controllers. */
import { Disclosure } from '@/components/disclosure';
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
        <Disclosure id="patient-insight" className={disclosure.disclosure} title={<>Riepilogo assistito · Patient Insight{stale ? ' · dati da aggiornare' : ''}</>}>
            <AIPatientInsight patient={patient} stale={stale} />
        </Disclosure>
        {smartImport ? <Disclosure id="smart-import" className={disclosure.disclosure} title="Proposte dalle fonti cliniche · Smart Import">
            {smartImport}
        </Disclosure> : null}
    </div>;
}
