/* @Codex */
import {
    FABRIC_VENUE_COPY,
    VENUE_OBSERVATION_STATE_LABELS,
    orderVenueObservations,
    venueReasonLabel,
} from '@/lib/fabric-settings-view';
import type { FabricObservabilitySnapshot } from '@/lib/ai-providers/fabric/routing-observability';
import { SETTINGS_CARD_CLASS } from './settings-ui';
import styles from './settings-lume.module.css';

export function FabricVenueSection({
    snapshot,
}: {
    snapshot: FabricObservabilitySnapshot;
}) {
    const observations = orderVenueObservations(snapshot.observations);

    return (
        <section className={SETTINGS_CARD_CLASS} data-testid="fabric-venue-section">
            <header className={styles.fabricBlockHeader}>
                <h2>Dove gira il calcolo</h2>
                <p>La sede di esecuzione indica dove vengono trattate le informazioni e quali collegamenti devono essere disponibili.</p>
            </header>

            <div className={styles.fabricGuarantee}>
                <span className={styles.fabricGuaranteeMarker} aria-hidden="true" />
                <p>
                    <strong>Nessun dirottamento automatico.</strong>{' '}
                    Se una sede non è disponibile, la richiesta viene rifiutata e non passa a un&apos;altra sede.
                </p>
                <code className="lume-registro">{snapshot.fallback}</code>
            </div>

            <dl className={styles.fabricVenueList}>
                {observations.map((observation) => {
                    const copy = FABRIC_VENUE_COPY[observation.venue];
                    return (
                        <div
                            key={observation.venue}
                            className={styles.fabricVenueRow}
                            data-testid={`fabric-venue-${observation.venue}`}
                        >
                            <dt>
                                <strong>{copy.title}</strong>
                                <span>{copy.description}</span>
                            </dt>
                            <dd>
                                <span
                                    className={styles.fabricStatusPill}
                                    data-state={observation.state}
                                >
                                    <span aria-hidden="true" />
                                    {VENUE_OBSERVATION_STATE_LABELS[observation.state]}
                                </span>
                                <p>{venueReasonLabel(observation.reason)}</p>
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </section>
    );
}
