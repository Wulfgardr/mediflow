/* @Codex */
import {
    FABRIC_VENUE_COPY,
    VENUE_OBSERVATION_STATE_LABELS,
    buildFabricProviderDisclosures,
    orderVenueObservations,
    venueReasonLabel,
} from '@/lib/fabric-settings-view';
import type { FabricObservabilitySnapshot } from '@/lib/ai-providers/fabric/routing-observability';
import type { FabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { SETTINGS_CARD_CLASS } from './settings-ui';
import styles from './settings-lume.module.css';

export function FabricVenueSection({
    snapshot,
    status,
}: {
    snapshot: FabricObservabilitySnapshot;
    status: FabricStatusSnapshot;
}) {
    const observations = orderVenueObservations(snapshot.observations);
    const providerDisclosures = buildFabricProviderDisclosures(status, snapshot);

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

            <section className={styles.fabricProviderDisclosure} data-testid="fabric-provider-disclosure" aria-labelledby="fabric-provider-disclosure-title">
                <header className={styles.fabricBlockHeader}>
                    <h3 id="fabric-provider-disclosure-title">Provider e percorsi dichiarati</h3>
                    <p>Questa proiezione descrive i percorsi dichiarati. Non configura accessi, modelli o servizi.</p>
                </header>

                <ul className={styles.fabricProviderList}>
                    {providerDisclosures.map((provider) => (
                        <li key={provider.id} className={styles.fabricProviderRow} data-testid={`fabric-provider-${provider.id}`}>
                            <span className={styles.fabricProviderMark} aria-hidden="true">{provider.mark}</span>
                            <div>
                                <h4>{provider.title}</h4>
                                <p>{provider.detail}</p>
                                <p className={styles.fabricProviderObservation}>{provider.observation}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>
        </section>
    );
}
