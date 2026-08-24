'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { FabricCapabilityRegistry } from '@/components/settings/fabric-capability-registry';
import { FabricEgressSection } from '@/components/settings/fabric-egress-section';
import { FabricErrorState, FabricLoadingState } from '@/components/settings/fabric-load-state';
import { FabricVenueSection } from '@/components/settings/fabric-venue-section';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';
import type { FabricObservabilitySnapshot } from '@/lib/ai-providers/fabric/routing-observability';
import type { FabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { parseFabricSnapshotPair } from '@/lib/fabric-settings-view';

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
                    <FabricVenueSection snapshot={state.observability} status={state.status} />
                    <FabricEgressSection snapshot={state.status} />
                    <FabricCapabilityRegistry snapshot={state.status} />
                </div>
            ) : null}
        </section>
    );
}
