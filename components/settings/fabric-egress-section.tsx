/* @Codex */
import {
    EGRESS_PROFILE_LABELS,
    summarizeEgressProfiles,
} from '@/lib/fabric-settings-view';
import type { FabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { SETTINGS_CARD_CLASS } from './settings-ui';
import styles from './settings-lume.module.css';

export function FabricEgressSection({ snapshot }: { snapshot: FabricStatusSnapshot }) {
    const summaries = summarizeEgressProfiles(snapshot.capabilities);
    const gateOpen = snapshot.egressGateOpen;

    return (
        <section className={SETTINGS_CARD_CLASS} data-testid="fabric-egress-section">
            <header className={styles.fabricBlockHeader}>
                <h2>Uscita dei dati</h2>
                <p>Questo controllo chiarisce se una funzione può far uscire informazioni dalla postazione.</p>
            </header>

            <div
                className={styles.fabricEgressGate}
                data-open={gateOpen ? 'true' : 'false'}
                role={gateOpen ? 'alert' : 'status'}
                aria-live="polite"
            >
                <span className={styles.fabricEgressMarker} aria-hidden="true" />
                <div>
                    <strong>{gateOpen ? 'Uscita esterna APERTA' : 'Uscita esterna chiusa'}</strong>
                    <p>
                        {gateOpen
                            ? 'Il gate runtime consente l’uscita: verifica subito policy, consenso e funzione interessata.'
                            : 'Il gate runtime non consente invii fuori dalla postazione.'}
                    </p>
                </div>
            </div>

            <dl className={styles.fabricEgressList}>
                {summaries.map((summary) => {
                    const copy = EGRESS_PROFILE_LABELS[summary.id];
                    return (
                        <div key={summary.id} className={styles.fabricEgressRow}>
                            <dt>
                                <strong>{copy.title}</strong>
                                <code className="lume-registro">{summary.id}</code>
                            </dt>
                            <dd>
                                <p>{copy.description}</p>
                                <span className={styles.fabricCount}>
                                    {summary.capabilityCount === 1
                                        ? '1 capacità nel registro'
                                        : `${summary.capabilityCount} capacità nel registro`}
                                </span>
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </section>
    );
}
