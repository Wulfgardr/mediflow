'use client';

/* WUL-678: one clinical proposal area, folded without unmounting controllers. */
import { Disclosure } from '@/components/disclosure';
import AIPatientInsight from '@/components/ai-patient-insight';
import type { Patient } from '@/lib/db';
import disclosure from '@/components/patient-disclosure.module.css';

export function PatientClinicalSupport({ patient, stale }: {
    patient: Patient;
    stale: boolean;
}) {
    return <div className={disclosure.clinicalSupport}>
        <Disclosure id="patient-insight" className={disclosure.disclosure} title={<>Riepilogo assistito · Patient Insight{stale ? ' · dati da aggiornare' : ''}</>}>
            <AIPatientInsight patient={patient} stale={stale} />
        </Disclosure>

    </div>;
}
