'use client';

/* presentation only; export/share retain the chart's existing gates. */
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
    return (
        <div className={styles.workspace}>
            <section aria-label="Export FHIR">
                <h3 className={styles.heading}>Esportazione locale</h3>
                <p className={styles.caption}>Export locale FHIR R4. Il file non viene inviato al FSE.</p>
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
            <SissPatientContextPanel patientId={patientId} patientTaxCode={patientTaxCode} embedded />
            <div className={styles.diary}><SissHandoffDiary patientId={patientId} embedded /></div>
        </div>
    );
}
