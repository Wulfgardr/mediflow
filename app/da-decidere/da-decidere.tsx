'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSecurity } from '@/components/security-provider';
import { DossierFolderReview } from '@/components/dossier-import-panel';
import { agentIncomingSnapshot, agentIncomingServerSnapshot, subscribeAgentIncoming, refreshAgentIncoming, applyReviewedAgentVisits } from '@/lib/agent-incoming';
import { agentVisitAwaitsReview } from '@/lib/agent-visit-review';
import surface from '@/components/record-surface.module.css';
import { PageHeader } from '@/components/ui/page-header';
import { VisitQueue } from './visit-queue';
import css from './da-decidere.module.css';

export type DaDecidereView = 'visite' | 'documenti';

function Filters({ view, visits }: { view: DaDecidereView; visits: number }) {
    return <nav className={surface.segmented} aria-label="Filtri">
        <Link href="/da-decidere" aria-current={view === 'visite' ? 'page' : undefined}>Visite{visits ? <span>{visits}</span> : null}</Link>
        <Link href="/da-decidere?vista=documenti" aria-current={view === 'documenti' ? 'page' : undefined}>Documenti</Link>
    </nav>;
}

function UnlockedDaDecidere({ view, patientId }: { view: DaDecidereView; patientId: string | null }) {
    const snapshot = useSyncExternalStore(subscribeAgentIncoming, agentIncomingSnapshot, agentIncomingServerSnapshot);
    const { visits, busy, error } = snapshot;
    const applicable = visits.filter(agentVisitAwaitsReview);
    const blockedCount = visits.length - applicable.length;
    const meta = view === 'visite' && visits.length > 0 ? <>
        {applicable.length === 1 ? '1 visita pronta' : `${applicable.length} visite pronte`}
        {blockedCount > 0 ? ` · ${blockedCount === 1 ? '1 da verificare' : `${blockedCount} da verificare`}` : ''}
    </> : null;
    return <main className={`${surface.page} ${css.page}`} data-record-page>
        <PageHeader
            title="Da decidere"
            meta={meta}
            actions={view === 'visite' ? <>
                <Link href="/settings/agenti" className="mf-button-secondary">Agenti</Link>
                <button type="button" className="mf-button-secondary" disabled={busy} onClick={() => { void refreshAgentIncoming(); }}>Aggiorna</button>
                {visits.length > 0 ? (
                    <button type="button" className={applicable.length ? 'mf-button-primary' : 'mf-button-secondary'} disabled={busy || !applicable.length} onClick={() => { void applyReviewedAgentVisits(applicable.map(value => value.visit.cassette.id)); }}>Applica tutte le visite senza dubbi</button>
                ) : null}
            </> : null}
        />
        <Filters view={view} visits={visits.length} />
        {view === 'visite' ? <>
            {error && <p role="alert" className={css.alert}>{error}</p>}
            <VisitQueue {...snapshot} />
        </> : <DossierFolderReview initialPatientId={patientId} />}
    </main>;
}

export function DaDecidere({ view, patientId }: { view: DaDecidereView; patientId: string | null }) {
    const { isLocked } = useSecurity();
    return isLocked ? null : <UnlockedDaDecidere view={view} patientId={patientId} />;
}
