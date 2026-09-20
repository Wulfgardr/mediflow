'use client';

/* @Codex: presentation only; export/share retain the chart's existing gates. */
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
                <h3 className={styles.heading}>File della cartella</h3>
                <p className={styles.caption}>Export locale FHIR R4. Il file non viene inviato al FSE.</p>
                <div className={styles.actions}>
                    <button type="button" className={styles.control} onClick={onExportFhir}>
                        <Download size={18} aria-hidden="true" />Esporta
                    </button>
                    {canShareFhirFile && (
                        <button type="button" className={styles.control} onClick={() => void onShareFhir()}>
                            <Share2 size={18} aria-hidden="true" />Condividi
                        </button>
                    )}
                </div>
            </section>
            <SissPatientContextPanel patientId={patientId} patientTaxCode={patientTaxCode} embedded />
            <details className={styles.disclosure}>
                <summary>Diario dei passaggi</summary>
                <p className={styles.caption}>Registro locale: l’atto regionale si svolge nel portale ufficiale.</p>
                <div className={styles.diary}><SissHandoffDiary patientId={patientId} embedded /></div>
            </details>
        </div>
    );
}
