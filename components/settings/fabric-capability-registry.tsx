/* @Codex */
import Link from 'next/link';
import {
    EGRESS_PROFILE_LABELS,
    FABRIC_CAPABILITY_LABELS,
    FABRIC_OPERATION_LABELS,
    FABRIC_REVIEW_LABELS,
    FABRIC_VENUE_COPY,
    groupFabricCapabilities,
} from '@/lib/fabric-settings-view';
import type { FabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { SETTINGS_CARD_CLASS, SETTINGS_SECTION_CARD_CLASS } from './settings-ui';
import styles from './settings-lume.module.css';

export function FabricCapabilityRegistry({ snapshot }: { snapshot: FabricStatusSnapshot }) {
    const groups = groupFabricCapabilities(snapshot.capabilities);

    return (
        <section className={SETTINGS_CARD_CLASS} data-testid="fabric-capability-registry">
            <header className={styles.fabricBlockHeader}>
                <h2>Registro delle capacità</h2>
                <p>Il registro distingue ciò che prepara una proposta da ciò che applica regole locali, così sai quando serve la tua decisione.</p>
            </header>

            <div className={styles.fabricRegistryGroups}>
                {groups.map((group) => (
                    <section
                        key={group.id}
                        className={`${SETTINGS_SECTION_CARD_CLASS} ${styles.fabricRegistryGroup}`}
                        data-testid={`fabric-group-${group.id}`}
                    >
                        <header>
                            <div>
                                <h3>{group.title}</h3>
                                <p>{group.description}</p>
                            </div>
                            <span className={styles.fabricCount}>{group.capabilities.length}</span>
                        </header>

                        <ol className={styles.fabricCapabilityList}>
                            {group.capabilities.map((capability) => (
                                <li
                                    key={capability.id}
                                    className={styles.fabricCapabilityRow}
                                    data-testid={`fabric-capability-${capability.id}`}
                                >
                                    <div className={styles.fabricCapabilityName}>
                                        <strong>{FABRIC_CAPABILITY_LABELS[capability.id]}</strong>
                                        <code className="lume-registro">{capability.id}</code>
                                    </div>

                                    <dl className={styles.fabricCapabilityFacts}>
                                        <div>
                                            <dt>Operazione</dt>
                                            <dd>{FABRIC_OPERATION_LABELS[capability.operation]}</dd>
                                        </div>
                                        <div>
                                            <dt>Revisione</dt>
                                            <dd>{FABRIC_REVIEW_LABELS[capability.review]}</dd>
                                        </div>
                                        <div>
                                            <dt>Sedi ammesse</dt>
                                            <dd>{capability.venues.map((venue) => FABRIC_VENUE_COPY[venue].title).join(' · ')}</dd>
                                        </div>
                                        <div>
                                            <dt>Uscita dati</dt>
                                            <dd>{EGRESS_PROFILE_LABELS[capability.egressProfile.id].title}</dd>
                                        </div>
                                    </dl>

                                    <div className={styles.fabricKillSwitch}>
                                        {capability.killSwitch ? (
                                            <>
                                                <Link href="/settings/ai/funzioni">Vai agli interruttori delle funzioni</Link>
                                                <code className="lume-registro">{capability.killSwitch}</code>
                                            </>
                                        ) : (
                                            <span>Nessun interruttore dedicato</span>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </section>
                ))}
            </div>
        </section>
    );
}
