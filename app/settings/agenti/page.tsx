'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AgentRegistration } from '@/lib/agent-registration-store';
import type { AgentPairingRequest } from '@/lib/agent-pairing-store';
import { AGENT_OPERATIONS, type AgentMandate, type AgentMandateInput } from '@/lib/agent-mandate-contract';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { generateMandateKeys } from '@/lib/agent-mandate-client';
import { isValidNumericPin, numericPinError, validateNumericPinSubmission } from '@/lib/security/pin-input';
import { SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

export default function AgentSettingsPage() {
    const confirm = useConfirm();
    const [mandates, setMandates] = useState<AgentMandate[]>([]);
    const [pairings, setPairings] = useState<AgentPairingRequest[]>([]);
    const [selectedMandates, setSelectedMandates] = useState<Record<string, string>>({});
    const [registrations, setRegistrations] = useState<AgentRegistration[]>([]);
    const [renewing, setRenewing] = useState<string | null>(null);
    const [approvalPin, setApprovalPin] = useState('');
    const [readAt, setReadAt] = useState(0);
    const [pin, setPin] = useState('');
    const [hours, setHours] = useState('12');
    const [provider, setProvider] = useState<AgentMandateInput['provider']>('openai');
    const [egress, setEgress] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const operationLabels = ['Aprire una visita', 'Allegare PDF', 'Depositare trascrizioni', 'Depositare note', 'Proporre terapie', 'Proporre prestazioni', 'Proporre diagnosi', 'Proporre esenzioni', 'Proporre osservazioni', 'Chiudere una visita'];
    const [operations, setOperations] = useState([...AGENT_OPERATIONS]);
    const [pinSubmitError, setPinSubmitError] = useState<string | null>(null);
    const [approvalPinSubmitError, setApprovalPinSubmitError] = useState<string | null>(null);
    const pinError = numericPinError(pin) ?? pinSubmitError;
    const approvalPinError = numericPinError(approvalPin) ?? approvalPinSubmitError;
    async function run(action: () => Promise<void>) {
        setBusy(true); setError(null); setPinSubmitError(null); setApprovalPinSubmitError(null);
        try { await action(); } catch { setError('Operazione non riuscita. Riprova.'); }
        finally { setBusy(false); setPin(''); setApprovalPin(''); }
    }
    async function refresh() {
        const [response, requests, clients] = await Promise.all(['/api/agent-mandates', '/api/agent-mandates/pairings',
            '/api/agent-mandates/registrations'].map(url => fetch(url, { cache: 'no-store' })));
        if (!response.ok || !requests.ok || !clients.ok) throw new Error('denied');
        setMandates(await response.json());
        setPairings(await requests.json());
        setRegistrations(await clients.json());
        setReadAt(Date.now());
    }
    return <section aria-labelledby="agenti-title" className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
            <h2 id="agenti-title" className="[font:var(--type-section-heading)]">Agenti</h2>
            <div className="flex flex-wrap gap-2">
                <Link href="/in-arrivo" className={SETTINGS_SECONDARY_BUTTON_CLASS}>In arrivo</Link>
                <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void run(refresh); }}>Aggiorna</button>
            </div>
        </header>
        <nav aria-label="In questa pagina" className="flex flex-wrap gap-x-4 gap-y-2">
            <span>In questa pagina</span>
            <a href="#mandato-nuovo" className="font-semibold">Nuovo mandato</a>
            <a href="#abbinamenti" className="font-semibold">Richieste di abbinamento</a>
            {registrations.length > 0 ? <a href="#client" className="font-semibold">Client registrati</a> : null}
            <a href="#mandati" className="font-semibold">Mandati</a>
        </nav>
        <form id="mandato-nuovo" aria-labelledby="mandato-nuovo-title" className="space-y-4" onSubmit={event => {
            event.preventDefault();
            const pinProblem = validateNumericPinSubmission(pin);
            if (pinProblem) { setPinSubmitError(pinProblem); return; }
            void run(async () => {
                const keys = await generateMandateKeys();
                const response = await fetch('/api/agent-mandates', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin, mandate: { id: crypto.randomUUID(), durationMs: Number(hours) * 3600000,
                        operations, provider, allowsClinicalEgress: provider !== 'local' && egress, ...keys } }) });
                if (!response.ok) throw new Error('denied');
                await refresh();
            });
        }}>
            <h3 id="mandato-nuovo-title" className="[font:var(--type-section-heading)]">Nuovo mandato</h3>
            <label className="block">Durata in ore<input className={SETTINGS_INPUT_CLASS} type="number" min="1" max="12" required value={hours} onChange={event => setHours(event.target.value)} /></label>
            <label className="block">Fornitore<select className={SETTINGS_INPUT_CLASS} value={provider} onChange={event => { setProvider(event.target.value as typeof provider); setEgress(false); }}>
                <option value="openai">OpenAI (Codex)</option><option value="anthropic">Anthropic</option><option value="local">Locale</option>
            </select></label>
            {provider !== 'local' && <label className="flex gap-2"><input type="checkbox" checked={egress} onChange={event => setEgress(event.target.checked)} />Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto</label>}
            <fieldset><legend>Operazioni consentite</legend>{AGENT_OPERATIONS.map((operation, index) => <label className="flex gap-2" key={operation}>
                <input type="checkbox" checked={operations.includes(operation)} onChange={event => setOperations(current => event.target.checked ? [...current, operation] : current.filter(value => value !== operation))} />{operationLabels[index]}
            </label>)}</fieldset>
            <p>Nota, trascrizione e PDF verificati entrano nella scheda allo sblocco. Le proposte cliniche attendono la tua conferma.</p>
            <label className="block">PIN di conferma<input className={SETTINGS_INPUT_CLASS} type="password" inputMode="numeric" autoComplete="off" required aria-invalid={Boolean(pinError)} aria-describedby={pinError ? 'agent-mandate-pin-error' : undefined} value={pin} onChange={event => {
                setPin(event.target.value); setPinSubmitError(null);
            }} /></label>
            {pinError && <p id="agent-mandate-pin-error" role="alert">{pinError}</p>}
            <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !operations.length || !isValidNumericPin(pin)}>Crea mandato</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <section id="abbinamenti" className="space-y-3"><h3 className="[font:var(--type-section-heading)]">Richieste di abbinamento</h3>
            <p>Confronta il codice con quello mostrato dall’agente prima di approvare.</p>
            <ul>{pairings.map(pairing => {
                const compatible = mandates.filter(mandate => mandate.revokedAt === null && mandate.expiresAt > readAt
                    && pairing.operations.every(operation => mandate.operations.includes(operation)));
                const selected = compatible.find(mandate => mandate.id === selectedMandates[pairing.id])?.id ?? compatible[0]?.id ?? '';
                const renewOnUnlock = renewing === pairing.id;
                return <li className="space-y-3 border-b py-4" key={pairing.id}>
                    <h3>{pairing.name} <strong>{pairing.code}</strong></h3>
                    <p>{pairing.operations.map(operation => operationLabels[AGENT_OPERATIONS.indexOf(operation)]).join(', ')}</p>
                    <label className="block">Mandato per {pairing.name}<select className={SETTINGS_INPUT_CLASS} value={selected}
                        onChange={event => setSelectedMandates(current => ({ ...current, [pairing.id]: event.target.value }))}>
                        {!compatible.length && <option value="">Crea un mandato con queste operazioni</option>}
                        {compatible.map(mandate => <option key={mandate.id} value={mandate.id}>{mandate.provider} · {new Date(mandate.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</option>)}
                    </select></label>
                    <label className="flex gap-2">
                        <input type="checkbox" checked={renewOnUnlock} onChange={event => {
                            setRenewing(event.target.checked ? pairing.id : null); setApprovalPin(''); setApprovalPinSubmitError(null);
                        }} />Rinnova allo sblocco
                    </label>
                    {renewOnUnlock && <>
                        <p>Dal prossimo sblocco il client riceve un mandato di 12 ore con queste operazioni, finché l’accesso resta attivo.</p>
                        <label className="block">PIN per {pairing.name}<input className={SETTINGS_INPUT_CLASS} type="password"
                            inputMode="numeric" autoComplete="off" aria-invalid={Boolean(approvalPinError)} value={approvalPin} onChange={event => {
                                setApprovalPin(event.target.value); setApprovalPinSubmitError(null);
                            }} /></label>
                        {approvalPinError && <p role="alert">{approvalPinError}</p>}
                    </>}
                    <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !selected || (renewOnUnlock && !isValidNumericPin(approvalPin))} onClick={() => {
                        if (renewOnUnlock) {
                            const approvalProblem = validateNumericPinSubmission(approvalPin);
                            if (approvalProblem) { setApprovalPinSubmitError(approvalProblem); return; }
                        }
                        void run(async () => {
                            const response = await fetch('/api/agent-mandates/pairings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ requestId: pairing.id, code: pairing.code, mandateRef: selected, ...(renewOnUnlock ? { renewOnUnlock, pin: approvalPin } : {}) }) });
                            if (!response.ok) throw new Error('denied'); await refresh();
                        });
                    }}>Approva {pairing.code}</button>
                </li>;
            })}</ul>
        </section>
        {registrations.length > 0 && <section id="client" className="space-y-3"><h3 className="[font:var(--type-section-heading)]">Client registrati</h3>
            <ul>{registrations.map(registration => <li key={registration.id} className="flex items-center justify-between gap-4 py-2">
                <div>
                    <p>{registration.name}</p>
                    <p>{registration.revokedAt !== null ? 'Revocato' : registration.lastRenewalAt === null ? 'In attesa del primo sblocco'
                        : `Ultimo rinnovo · ${new Date(registration.lastRenewalAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`}</p>
                </div>
                {registration.revokedAt === null && <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy}
                    aria-label={`Revoca ${registration.name}`} onClick={async () => {
                        const answer = await confirm({ title: 'Revocare l’accesso del client?', message: registration.name, confirmLabel: 'Conferma revoca', tone: 'danger' });
                        if (!answer.confirmed) return;
                        await run(async () => {
                        const response = await fetch('/api/agent-mandates/registrations', { method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: registration.id }) });
                        if (!response.ok) throw new Error('denied'); await refresh();
                    }); }}>Revoca</button>}
            </li>)}</ul>
        </section>}
        <section id="mandati" className="space-y-3"><h3 className="[font:var(--type-section-heading)]">Mandati</h3>
            <ul>{mandates.map(mandate => <li key={mandate.id} className="flex items-center justify-between gap-4 py-2">
                <span>{mandate.provider} · {mandate.revokedAt !== null ? 'Revocato' : mandate.expiresAt <= readAt ? 'Scaduto' : `Fino alle ${new Date(mandate.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}</span>
                {mandate.revokedAt === null && <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={async () => {
                    const answer = await confirm({ title: 'Revocare il mandato?', message: mandate.provider, confirmLabel: 'Conferma revoca', tone: 'danger' });
                    if (!answer.confirmed) return;
                    await run(async () => {
                    const response = await fetch('/api/agent-mandates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: mandate.id }) });
                    if (!response.ok) throw new Error('denied'); await refresh();
                }); }}>Revoca</button>}
            </li>)}</ul>
        </section>
    </section>;
}
