'use client';

/* presentation only; export/share retain the chart's existing gates. */
import { useEffect, useState } from 'react';
import { type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
import { Button } from '@/components/ui/button';
import { Download, Share2 } from 'lucide-react';
import SissPatientContextPanel, { type FseReadinessState } from '@/components/siss-patient-context-panel';
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
    const [fseReadiness, setFseReadiness] = useState<FseReadinessState>({
        loading: true,
        error: null,
        validation: null,
    });

    const refreshFseReadiness = async () => {
        setFseReadiness((current) => ({
            loading: true,
            error: null,
            validation: current.validation,
        }));

        try {
            const response = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(patientId)}`);
            const payload = await response.json().catch(() => null) as ValidatePatientExportResponse | { error?: string } | null;

            if (!response.ok) {
                const message = payload && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Pre-check FSE non disponibile';
                setFseReadiness({
                    loading: false,
                    error: message,
                    validation: null,
                });
                return;
            }

            setFseReadiness({
                loading: false,
                error: null,
                validation: payload as ValidatePatientExportResponse,
            });
        } catch (error) {
            setFseReadiness({
                loading: false,
                error: error instanceof Error ? error.message : 'Controllo preliminare FSE non riuscito.',
                validation: null,
            });
        }
    };

    useEffect(() => {
        void refreshFseReadiness();
    }, [patientId]);

    const validation = fseReadiness.validation;
    const readinessTone: 'success' | 'warning' | 'critical' | 'muted' = validation?.hasErrors
        ? 'critical'
        : validation?.hasWarnings
            ? 'warning'
            : validation
                ? 'success'
                : 'muted';
    const readinessLabel = fseReadiness.loading
        ? 'Controllo dei dati per l’esportazione FSE in corso.'
        : validation?.hasErrors
            ? 'Dati da correggere per l’esportazione FSE.'
            : validation?.hasWarnings
                ? 'Dati da verificare per l’esportazione FSE.'
                : validation
                    ? 'Dati pronti per l’esportazione FSE.'
                    : 'Controllo dei dati per l’esportazione FSE non disponibile.';

    return (
        <div className={styles.workspace}>
            <section aria-label="Esportazione locale">
                <h3 className={styles.heading}>Esportazione locale</h3>
                <p className={styles.caption}>Esportazione locale in formato FHIR R4. Il file non viene inviato al FSE.</p>
                <p role={readinessTone === 'critical' || readinessTone === 'warning' ? 'alert' : 'status'}
                    className={readinessTone === 'critical' || readinessTone === 'warning' ? `mf-alert mf-alert-${readinessTone} mb-3` : styles.caption}>
                    {readinessLabel}
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
            <SissPatientContextPanel patientId={patientId} patientTaxCode={patientTaxCode} fseReadiness={fseReadiness} onRefreshFseReadiness={refreshFseReadiness} embedded />
            <div className={styles.diary}><SissHandoffDiary patientId={patientId} embedded /></div>
        </div>
    );
}
