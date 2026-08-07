/* @Codex */
import { SETTINGS_CARD_CLASS } from './settings-ui';
import styles from './settings-lume.module.css';

export function FabricLoadingState() {
    return (
        <div className={SETTINGS_CARD_CLASS} role="status" aria-live="polite" data-testid="fabric-loading-state">
            <p className={styles.fabricStateTitle}>Lettura del registro in corso…</p>
            <div className={styles.fabricSkeleton} aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
        </div>
    );
}

export function FabricErrorState({ unauthorized = false }: { unauthorized?: boolean }) {
    return (
        <div className={`${SETTINGS_CARD_CLASS} ${styles.fabricErrorState}`} role="alert" data-testid="fabric-error-state">
            <p className={styles.fabricStateTitle}>
                {unauthorized ? 'Sessione non valida' : 'Stato della Intelligence Fabric non disponibile'}
            </p>
            <p>
                {unauthorized
                    ? 'Sblocca di nuovo MediFlow. Senza una sessione valida il registro non può essere letto.'
                    : 'Gli snapshot di capacità e connessioni non sono arrivati. Questo stato non significa che sia tutto operativo.'}
            </p>
        </div>
    );
}
