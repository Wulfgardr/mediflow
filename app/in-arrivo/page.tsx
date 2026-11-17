'use client';

import { useState } from 'react';
import { useSecurity } from '@/components/security-provider';
import type { AgentCassette } from '@/lib/agent-cassette-contract';
import { openAgentVisit, type OpenedAgentVisit } from '@/lib/agent-cassette-client';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

function UnlockedIncoming() {
    const [visits, setVisits] = useState<OpenedAgentVisit[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="type-page-title">In arrivo</h1>
        <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => {
            setBusy(true); setError(null);
            void (async () => {
                const response = await fetch('/api/agent-mandates/incoming', { cache: 'no-store' });
                if (!response.ok) throw new Error('unavailable');
                const rows: AgentCassette[] = await response.json();
                const opened = await Promise.allSettled(rows.map(openAgentVisit));
                setVisits(opened.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
                if (opened.some(result => result.status === 'rejected')) setError('Una visita non è leggibile. Riprova dopo lo sblocco.');
            })().catch(() => setError('Una visita non è leggibile. Riprova dopo lo sblocco.')).finally(() => setBusy(false));
        }}>Aggiorna</button>
        {error && <p role="alert">{error}</p>}
        {visits.map(visit => <section key={visit.cassette.id} className="space-y-3 rounded-lg border p-4" aria-label={'Visita ' + visit.cassette.id}>
            <h2 className="text-lg font-semibold">{typeof visit.anchor.fiscalCode === 'string' ? visit.anchor.fiscalCode : 'Identità da confermare'}</h2>
            <p>{visit.cassette.status === 'closed' ? 'Visita chiusa' : 'Deposito in corso'}</p>
            {visit.items.map(item => <article key={item.id} className="whitespace-pre-wrap">
                <h3 className="font-semibold">{{ note: 'Nota', transcription: 'Trascrizione', pdf: 'PDF', therapy: 'Terapia proposta', service: 'Prestazione proposta', diagnosis: 'Diagnosi proposta', exemption: 'Esenzione proposta', observation: 'Osservazione proposta' }[item.kind]}</h3>
                {typeof item.value.text === 'string' && <p>{item.value.text}</p>}
                {item.kind === 'pdf' && typeof item.value.name === 'string' && <p>{item.value.name}</p>}
            </article>)}
        </section>)}
    </main>;
}
export default function IncomingPage() {
    const { isLocked } = useSecurity();
    return isLocked ? null : <UnlockedIncoming />;
}
