'use client';

import { useState } from 'react';
import { AGENT_OPERATIONS, type AgentMandate, type AgentMandateInput } from '@/lib/agent-mandate-contract';
import { generateMandateKeys } from '@/lib/agent-mandate-client';
import { SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

export default function AgentSettingsPage() {
    const [mandates, setMandates] = useState<AgentMandate[]>([]);
    const [readAt, setReadAt] = useState(0);
    const [pin, setPin] = useState('');
    const [hours, setHours] = useState('12');
    const [provider, setProvider] = useState<AgentMandateInput['provider']>('openai');
    const [egress, setEgress] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const operationLabels = ['Aprire una visita', 'Allegare PDF', 'Depositare trascrizioni', 'Depositare note', 'Proporre terapie', 'Proporre prestazioni', 'Proporre diagnosi', 'Proporre esenzioni', 'Proporre osservazioni', 'Chiudere una visita'];
    const [operations, setOperations] = useState([...AGENT_OPERATIONS]);
    async function run(action: () => Promise<void>) {
        setBusy(true); setError(null);
        try { await action(); } catch { setError('Operazione non riuscita. Riprova.'); }
        finally { setBusy(false); setPin(''); }
    }
    async function refresh() {
        const response = await fetch('/api/agent-mandates', { cache: 'no-store' });
        if (!response.ok) throw new Error('denied');
        setMandates(await response.json());
        setReadAt(Date.now());
    }
    return <main className="mx-auto max-w-3xl space-y-8 p-6">
        <h1 className="text-2xl font-semibold">Agenti</h1>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void run(async () => {
            const keys = await generateMandateKeys();
            const response = await fetch('/api/agent-mandates', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, mandate: { id: crypto.randomUUID(), durationMs: Number(hours) * 3600000,
                    operations, provider, allowsClinicalEgress: provider !== 'local' && egress, ...keys } }) });
            if (!response.ok) throw new Error('denied');
            await refresh();
        }); }}>
            <h2 className="text-lg font-semibold">Nuovo mandato</h2>
            <label className="block">Durata in ore<input className={SETTINGS_INPUT_CLASS} type="number" min="1" max="12" required value={hours} onChange={event => setHours(event.target.value)} /></label>
            <label className="block">Fornitore<select className={SETTINGS_INPUT_CLASS} value={provider} onChange={event => { setProvider(event.target.value as typeof provider); setEgress(false); }}>
                <option value="openai">OpenAI (Codex)</option><option value="anthropic">Anthropic</option><option value="local">Locale</option>
            </select></label>
            {provider !== 'local' && <label className="flex gap-2"><input type="checkbox" checked={egress} onChange={event => setEgress(event.target.checked)} />Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto</label>}
            <fieldset><legend>Operazioni consentite</legend>{AGENT_OPERATIONS.map((operation, index) => <label className="flex gap-2" key={operation}>
                <input type="checkbox" checked={operations.includes(operation)} onChange={event => setOperations(current => event.target.checked ? [...current, operation] : current.filter(value => value !== operation))} />{operationLabels[index]}
            </label>)}</fieldset>
            <p>Nota, trascrizione e PDF verificati entrano nella scheda allo sblocco. Le proposte cliniche attendono la tua conferma.</p>
            <label className="block">PIN di conferma<input className={SETTINGS_INPUT_CLASS} type="password" inputMode="numeric" autoComplete="off" required pattern="[0-9]{4,8}" value={pin} onChange={event => setPin(event.target.value)} /></label>
            <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !operations.length}>Crea mandato</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <section className="space-y-3"><h2 className="text-lg font-semibold">Mandati</h2>
            <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void run(refresh); }}>Aggiorna</button>
            <ul>{mandates.map(mandate => <li key={mandate.id} className="flex items-center justify-between gap-4 py-2">
                <span>{mandate.provider} · {mandate.revokedAt !== null ? 'Revocato' : mandate.expiresAt <= readAt ? 'Scaduto' : `Fino alle ${new Date(mandate.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}</span>
                {mandate.revokedAt === null && <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void run(async () => {
                    const response = await fetch('/api/agent-mandates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: mandate.id }) });
                    if (!response.ok) throw new Error('denied'); await refresh();
                }); }}>Revoca</button>}
            </li>)}</ul>
        </section>
    </main>;
}
