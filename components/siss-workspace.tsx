'use client';

import { useLiveQueryState } from '@/lib/live-query';
import { describeFhirExportReadiness, inspectFhirExportReadiness } from '@/lib/fhir/export-readiness';
import { type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
import { Button } from '@/components/ui/button';
import { Download, Share2 } from 'lucide-react';
import SissPatientContextPanel from '@/components/siss-patient-context-panel';
import SissHandoffDiary from '@/components/siss-handoff-diary';
import styles from './siss-workspace.module.css';

type Props = {
    patientId: string;
    patientTaxCode: string | null | undefined;
    canShareFhirFile: boolean;
    onExportFhir: () => void;
    onShareFhir: () => void | Promise<void>;
};

export default function SissWorkspace({ patientId, patientTaxCode, canShareFhirFile, onExportFhir, onShareFhir }: Props) {
    const checks = useLiveQueryState(
        () => inspectFhirExportReadiness(patientId, async () => {
            const response = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(patientId)}`);
            if (!response.ok) throw new Error('FSE_VALIDATION_UNAVAILABLE');
            return await response.json() as ValidatePatientExportResponse;
        }, async confirm => {
            const { generatePatientBundle } = await import('@/lib/fhir/bundle-generator');
            return generatePatientBundle(patientId, confirm);
        }),
        [patientId],
        undefined,
        ['patients', 'entries', 'therapies', 'checkups', 'observations'],
    );
    const fseReadiness = describeFhirExportReadiness(checks, patientId);

    return (
        <div className={styles.workspace}>
            <section aria-label="Esportazione locale">
                <h3 className={styles.heading}>Esportazione locale</h3>
                <p className={styles.caption}>Esportazione locale in formato FHIR R4. Il file non viene inviato al FSE.</p>
                <p role={fseReadiness.role}
                    className={fseReadiness.role === 'alert' ? `mf-alert mf-alert-${fseReadiness.tone} mb-3` : styles.caption}>
                    {fseReadiness.label}
                </p>
                <div className={styles.actions}>
                    <Button variant="secondary" onClick={onExportFhir}>
                        <Download size={18} aria-hidden="true" />Esporta FHIR
                    </Button>
                    {canShareFhirFile && (
                        <Button variant="secondary" onClick={() => void onShareFhir()}>
                            <Share2 size={18} aria-hidden="true" />Condividi file
                        </Button>
                    )}
                </div>
            </section>
            <SissPatientContextPanel patientId={patientId} patientTaxCode={patientTaxCode} fseReadiness={fseReadiness} onRefreshFseReadiness={checks.refresh} embedded />
            <div className={styles.diary}><SissHandoffDiary patientId={patientId} embedded /></div>
        </div>
    );
}
