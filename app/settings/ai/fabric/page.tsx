'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { FabricCapabilityRegistry } from '@/components/settings/fabric-capability-registry';
import { FabricEgressSection } from '@/components/settings/fabric-egress-section';
import { FabricErrorState, FabricLoadingState } from '@/components/settings/fabric-load-state';
import { FabricVenueSection } from '@/components/settings/fabric-venue-section';
import styles from '@/components/settings/settings-lume.module.css';
import { SETTINGS_CARD_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';
import type { FabricObservabilitySnapshot } from '@/lib/ai-providers/fabric/routing-observability';
import type { FabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import {
    describeProviderDisclosure,
    parseFabricSnapshotPair,
} from '@/lib/fabric-settings-view';

type FabricPageState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'unauthorized' }>
    | Readonly<{ kind: 'error' }>
    | Readonly<{
        kind: 'ready';
        status: FabricStatusSnapshot;
        observability: FabricObservabilitySnapshot;
    }>;

class FabricFetchError extends Error {
    constructor(public readonly kind: 'unauthorized' | 'error') {
        super(kind);
        this.name = 'FabricFetchError';
    }
}

async function readFabricResponse(response: Response): Promise<unknown> {
    if (response.status === 401) throw new FabricFetchError('unauthorized');
    if (!response.ok) throw new FabricFetchError('error');
    return response.json();
}

function FabricProviderSection({ snapshot }: { snapshot: FabricStatusSnapshot }) {
    return (
        <section className={SETTINGS_CARD_CLASS} data-testid="fabric-provider-section">
            <header className={styles.fabricBlockHeader}>
                <h2>Provider</h2>
                <p>
                    Il catalogo dichiarato non prova un&apos;esecuzione. Lo stato effettivo resta non osservato
                    senza una receipt dell&apos;operazione corrente.
                </p>
            </header>

            <div className={styles.fabricGuarantee}>
                <span className={styles.fabricGuaranteeMarker} aria-hidden="true" />
                <p>
                    <strong>Readiness distinta.</strong>{' '}
                    <code>available_unqualified</code> è un&apos;annotazione statica e non qualifica provider,
                    modello o runtime.
                </p>
            </div>

            <ol className={styles.fabricCapabilityList}>
                {snapshot.providerDisclosure.providers.map((provider) => {
                    const presentation = describeProviderDisclosure(provider);
                    return (
                        <li
                            key={provider.id}
                            className={styles.fabricCapabilityRow}
                            data-testid={`fabric-provider-${provider.id}`}
                        >
                            <div className={styles.fabricCapabilityName}>
                                <strong>{provider.label}</strong>
                                <code className="lume-registro">{provider.id}</code>
                                <p className="mt-2 text-xs leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                    {presentation.accessBoundary}
                                </p>
                            </div>

                            <div>
                                <strong className="text-xs" style={{ color: 'var(--lume-ink)' }}>Dichiarato</strong>
                                <dl className={`${styles.fabricCapabilityFacts} mt-3`}>
                                    <div><dt>Lifecycle</dt><dd>{presentation.declaredLifecycle}</dd></div>
                                    <div><dt>Osservazione runtime</dt><dd>{presentation.declaredRuntimeObservation}</dd></div>
                                    <div><dt>Sede</dt><dd>{presentation.declaredVenue}</dd></div>
                                    <div><dt>Uscita dati</dt><dd>{presentation.declaredEgress}</dd></div>
                                    <div><dt>Credenziale</dt><dd>{presentation.declaredCredentialClass}</dd></div>
                                    <div><dt>Disposizione</dt><dd>{presentation.declaredExecutionDisposition}</dd></div>
                                </dl>
                            </div>

                            <div>
                                <strong className="text-xs" style={{ color: 'var(--lume-ink)' }}>Effettivo</strong>
                                <dl className={`${styles.fabricCapabilityFacts} mt-3`}>
                                    <div><dt>Lifecycle</dt><dd>{presentation.lifecycle}</dd></div>
                                    <div><dt>Osservazione runtime</dt><dd>{presentation.runtimeObservation}</dd></div>
                                    <div><dt>Sede</dt><dd>{presentation.effectiveVenue}</dd></div>
                                    <div><dt>Uscita dati</dt><dd>{presentation.effectiveEgress}</dd></div>
                                    <div><dt>Credenziale</dt><dd>{presentation.effectiveCredentialClass}</dd></div>
                                    <div><dt>Disposizione</dt><dd>{presentation.executionDisposition}</dd></div>
                                </dl>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

export default function SettingsAiFabricPage() {
    const [state, setState] = useState<FabricPageState>({ kind: 'loading' });

    useEffect(() => {
        const controller = new AbortController();

        async function loadSnapshots() {
            try {
                const [statusResponse, observabilityResponse] = await Promise.all([
                    fetch('/api/ai/fabric/status', { cache: 'no-store', signal: controller.signal }),
                    fetch('/api/ai/fabric/observability', { cache: 'no-store', signal: controller.signal }),
                ]);
                const [statusValue, observabilityValue] = await Promise.all([
                    readFabricResponse(statusResponse),
                    readFabricResponse(observabilityResponse),
                ]);
                const snapshots = parseFabricSnapshotPair(statusValue, observabilityValue);
                setState({ kind: 'ready', ...snapshots });
            } catch (error) {
                if (controller.signal.aborted) return;
                setState({
                    kind: error instanceof FabricFetchError && error.kind === 'unauthorized'
                        ? 'unauthorized'
                        : 'error',
                });
            }
        }

        void loadSnapshots();
        return () => controller.abort();
    }, []);

    return (
        <section className="space-y-4" data-testid="settings-ai-fabric-section">
            <SettingsSectionIntro
                kicker="Intelligenza locale"
                title="Capacità e connessioni"
                description="Registro in sola lettura delle funzioni intelligenti, della sede di calcolo e dell’eventuale uscita dei dati."
            />

            {state.kind === 'loading' ? <FabricLoadingState /> : null}
            {state.kind === 'unauthorized' ? <FabricErrorState unauthorized /> : null}
            {state.kind === 'error' ? <FabricErrorState /> : null}
            {state.kind === 'ready' ? (
                <div className="space-y-6">
                    <FabricProviderSection snapshot={state.status} />
                    <FabricVenueSection snapshot={state.observability} />
                    <FabricEgressSection snapshot={state.status} />
                    <FabricCapabilityRegistry snapshot={state.status} />
                </div>
            ) : null}
        </section>
    );
}
