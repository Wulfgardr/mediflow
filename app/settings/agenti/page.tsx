'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AgentRegistration } from '@/lib/agent-registration-store';
import type { AgentPairingRequest } from '@/lib/agent-pairing-store';
import type { AgentLocalKitStatus } from '@/lib/agent-local-kit-store';
import { AGENT_OPERATIONS, MANDATE_MAX_DURATION_MS, type AgentMandate, type AgentMandateInput } from '@/lib/agent-mandate-contract';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { generateMandateKeys } from '@/lib/agent-mandate-client';
import { useAgentSettingsLoad } from '@/lib/hooks/effects/use-agent-settings-load';
import { isValidNumericPin, numericPinError, validateNumericPinSubmission } from '@/lib/security/pin-input';
import { SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

const LOCAL_KIT_ERROR_MESSAGES: Record<string, string> = {
    LOCAL_KIT_PATH_INVALID: 'Cartella del kit non valida, inesistente o sincronizzata.',
    LOCAL_KIT_CONNECTED: 'Scollega Codex prima di cambiare la cartella del kit.',
    LOCAL_KIT_WRITE_FAILED: 'Impossibile scrivere le credenziali nella cartella del kit.',
    LOCAL_KIT_NOT_CONNECTED: 'Collega prima Codex · Ambulatorio.',
    LOCAL_KIT_INACTIVE: 'Collega e attiva prima Codex · Ambulatorio.',
};

function formatMandateExpiry(expiresAt: number, now: number): string {
    const target = new Date(expiresAt);
    const reference = new Date(now || Date.now());
    const time = target.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const sameDay = target.getFullYear() === reference.getFullYear()
        && target.getMonth() === reference.getMonth()
        && target.getDate() === reference.getDate();
    if (sameDay) return `fino alle ${time}`;
    const tomorrow = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
    const isTomorrow = target.getFullYear() === tomorrow.getFullYear()
        && target.getMonth() === tomorrow.getMonth()
        && target.getDate() === tomorrow.getDate();
    if (isTomorrow) return `fino a domani alle ${time}`;
    const day = target.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    return `fino al ${day} alle ${time}`;
}

async function readFailureMessage(response: Response): Promise<string> {
    try {
        const body = await response.json() as { code?: unknown };
        if (typeof body?.code === 'string' && body.code in LOCAL_KIT_ERROR_MESSAGES) {
            return LOCAL_KIT_ERROR_MESSAGES[body.code];
        }
    } catch {
    }
    return 'Operazione non riuscita. Riprova.';
}

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
    const [hours, setHours] = useState('24');
    const [provider, setProvider] = useState<AgentMandateInput['provider']>('openai');
    const [egress, setEgress] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const operationLabels = ['Aprire una visita', 'Allegare PDF', 'Depositare trascrizioni', 'Depositare note', 'Proporre terapie', 'Proporre prestazioni', 'Proporre diagnosi', 'Proporre esenzioni', 'Proporre osservazioni', 'Chiudere una visita'];
    const [operations, setOperations] = useState([...AGENT_OPERATIONS]);
    const [pinSubmitError, setPinSubmitError] = useState<string | null>(null);
    const [approvalPinSubmitError, setApprovalPinSubmitError] = useState<string | null>(null);
    const [localKit, setLocalKit] = useState<AgentLocalKitStatus | null>(null);
    const [localKitContextCount, setLocalKitContextCount] = useState(0);
    const [kitPathDraft, setKitPathDraft] = useState('');
    const [localKitConfirming, setLocalKitConfirming] = useState(false);
    const [localKitPin, setLocalKitPin] = useState('');
    const [localKitPinSubmitError, setLocalKitPinSubmitError] = useState<string | null>(null);
    const pinError = numericPinError(pin) ?? pinSubmitError;
    const approvalPinError = numericPinError(approvalPin) ?? approvalPinSubmitError;
    const localKitPinError = numericPinError(localKitPin) ?? localKitPinSubmitError;
    async function run(action: () => Promise<void>, clearPins = true) {
        setBusy(true); setError(null); setPinSubmitError(null); setApprovalPinSubmitError(null); setLocalKitPinSubmitError(null);
        try { await action(); } catch (failure) {
            setError(failure instanceof Error && failure.message && failure.message !== 'denied' ? failure.message : 'Operazione non riuscita. Riprova.');
        }
        finally {
            setBusy(false);
            if (clearPins) { setPin(''); setApprovalPin(''); setLocalKitPin(''); }
        }
    }
    async function refresh() {
        const [response, requests, clients, kitResponse, contextResponse] = await Promise.all([
            '/api/agent-mandates',
            '/api/agent-mandates/pairings',
            '/api/agent-mandates/registrations',
            '/api/agent-mandates/local-kit',
            '/api/agent-mandates/local-kit/context',
        ].map(url => fetch(url, { cache: 'no-store' })));
        if (!response.ok || !requests.ok || !clients.ok || !kitResponse.ok) throw new Error('denied');
        setMandates(await response.json());
        setPairings(await requests.json());
        setRegistrations(await clients.json());
        const nextKit = await kitResponse.json() as AgentLocalKitStatus;
        setLocalKit(nextKit);
        setKitPathDraft(nextKit.kitPath);
        if (contextResponse.ok) {
            const contextPayload = await contextResponse.json() as { count?: unknown };
            setLocalKitContextCount(typeof contextPayload?.count === 'number' ? contextPayload.count : 0);
        } else {
            setLocalKitContextCount(0);
        }
        setReadAt(Date.now());
    }
    useAgentSettingsLoad(() => refresh().catch(() => { setError('Operazione non riuscita. Riprova.'); }));
    const localKitConnected = Boolean(localKit?.connected);
    const localKitActive = Boolean(localKit?.connected && localKit.active && localKit.expiresAt && localKit.expiresAt > readAt);
    const localKitStatusText = localKit === null
        ? 'Lettura stato in corso'
        : !localKitConnected
        ? 'Non collegato'
        : localKitActive && localKit.expiresAt
            ? `Collegato · attivo ${formatMandateExpiry(localKit.expiresAt, readAt)}`
            : 'Collegato · mandato da rinnovare';
    return <section aria-labelledby="agenti-title" className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
            <h2 id="agenti-title" className="[font:var(--type-section-heading)]">Agenti</h2>
            <div className="flex flex-wrap gap-2">
                <Link href="/in-arrivo" className={SETTINGS_SECONDARY_BUTTON_CLASS}>In arrivo</Link>
                <button className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { void run(refresh, false); }}>Aggiorna</button>
            </div>
        </header>
        <nav aria-label="In questa pagina" className="flex flex-wrap gap-x-4 gap-y-2">
            <span>In questa pagina</span>
            <a href="#codex-ambulatorio" className="font-semibold">Codex · Ambulatorio</a>
            <a href="#mandato-nuovo" className="font-semibold">Nuovo mandato</a>
            <a href="#abbinamenti" className="font-semibold">Richieste di abbinamento</a>
            {registrations.length > 0 ? <a href="#client" className="font-semibold">Client registrati</a> : null}
            <a href="#mandati" className="font-semibold">Mandati</a>
        </nav>
        <section id="codex-ambulatorio" aria-labelledby="codex-ambulatorio-title" className="space-y-4 border-b border-[var(--lume-rule)] pb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 id="codex-ambulatorio-title" className="[font:var(--type-section-heading)]">Codex · Ambulatorio</h3>
                        {localKit !== null ? (
                            <span className="rounded-full border border-[var(--lume-rule)] px-2 py-0.5 [font:var(--type-record-meta)]" style={{ color: localKitActive ? 'var(--lume-signal-success)' : localKitConnected ? 'var(--lume-signal-warning)' : 'var(--lume-ink-muted)' }}>
                                {localKitActive ? 'Attivo' : localKitConnected ? 'Da rinnovare' : 'Non collegato'}
                            </span>
                        ) : null}
                    </div>
                    <p>{localKitStatusText}</p>
                    {localKitConnected ? (
                        <p className="[font:var(--type-meta)] text-[var(--lume-ink-muted)]">
                            Registrazione permanente · mandato di 24 ore con rinnovo automatico allo sblocco
                            {localKit?.lastRenewalAt ? ` · ultimo rinnovo ${new Date(localKit.lastRenewalAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    {localKit === null ? (
                        <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => { void run(refresh, false); }}>
                            Leggi lo stato
                        </button>
                    ) : localKitConnected ? (
                        <>
                            {!localKitActive ? (
                                <button
                                    type="button"
                                    className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                    disabled={busy}
                                    onClick={() => {
                                        void run(async () => {
                                            const response = await fetch('/api/agent-mandates/local-kit', { method: 'PATCH' });
                                            if (!response.ok) throw new Error(await readFailureMessage(response));
                                            await refresh();
                                        });
                                    }}
                                >
                                    Rinnova ora
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className={SETTINGS_SECONDARY_BUTTON_CLASS}
                                disabled={busy}
                                onClick={async () => {
                                    const answer = await confirm({
                                        title: 'Scollegare Codex · Ambulatorio?',
                                        message: 'Revoca mandato e credenziali del kit.',
                                        confirmLabel: 'Scollega',
                                        tone: 'danger',
                                    });
                                    if (!answer.confirmed) return;
                                    await run(async () => {
                                        const response = await fetch('/api/agent-mandates/local-kit', { method: 'DELETE' });
                                        if (!response.ok) throw new Error(await readFailureMessage(response));
                                        setLocalKitConfirming(false);
                                        await refresh();
                                    });
                                }}
                            >
                                Scollega
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                            disabled={busy}
                            onClick={() => {
                                setLocalKitConfirming(current => !current);
                                setLocalKitPin('');
                                setLocalKitPinSubmitError(null);
                            }}
                        >
                            Collega
                        </button>
                    )}
                </div>
            </div>
            {localKitConfirming && localKit !== null && !localKitConnected && (
                <form className="space-y-4 rounded-lg border border-[var(--lume-rule)] p-4" onSubmit={event => {
                    event.preventDefault();
                    const problem = validateNumericPinSubmission(localKitPin);
                    if (problem) { setLocalKitPinSubmitError(problem); return; }
                    void run(async () => {
                        const keys = await generateMandateKeys();
                        const payload: Record<string, unknown> = {
                            pin: localKitPin,
                            mandate: {
                                id: crypto.randomUUID(),
                                durationMs: MANDATE_MAX_DURATION_MS,
                                operations: [...AGENT_OPERATIONS],
                                provider: 'openai',
                                allowsClinicalEgress: true,
                                ...keys,
                            },
                        };
                        if (kitPathDraft.trim()) payload.kitPath = kitPathDraft.trim();
                        const response = await fetch('/api/agent-mandates/local-kit', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                        });
                        if (!response.ok) throw new Error(await readFailureMessage(response));
                        setLocalKitConfirming(false);
                        await refresh();
                    });
                }}>
                    <p>OpenAI (Codex) con passaggio di documenti e trascrizioni. Registrazione permanente con mandato di 24 ore rinnovato a ogni sblocco.</p>
                    <ul className="list-disc pl-5 text-sm">
                        {operationLabels.map(label => <li key={label}>{label}</li>)}
                    </ul>
                    <label className="block">
                        PIN per collegare Codex
                        <input
                            className={SETTINGS_INPUT_CLASS}
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            required
                            aria-invalid={Boolean(localKitPinError)}
                            aria-describedby={localKitPinError ? 'local-kit-pin-error' : undefined}
                            value={localKitPin}
                            onChange={event => { setLocalKitPin(event.target.value); setLocalKitPinSubmitError(null); }}
                        />
                    </label>
                    {localKitPinError && <p id="local-kit-pin-error" role="alert">{localKitPinError}</p>}
                    <div className="flex flex-wrap gap-2">
                        <button type="submit" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !isValidNumericPin(localKitPin)}>Consenti</button>
                        <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => setLocalKitConfirming(false)}>Annulla</button>
                    </div>
                </form>
            )}
            {localKitContextCount > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--lume-rule)] px-3 py-2">
                    <p className="[font:var(--type-meta)]">
                        Contesti paziente pronti per Codex: {localKitContextCount}
                    </p>
                    <button
                        type="button"
                        className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        disabled={busy}
                        onClick={() => {
                            void run(async () => {
                                const response = await fetch('/api/agent-mandates/local-kit/context', {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                });
                                if (!response.ok) throw new Error(await readFailureMessage(response));
                                await refresh();
                            }, false);
                        }}
                    >
                        Svuota contesti
                    </button>
                </div>
            ) : null}
            <details className="space-y-3">
                <summary className="cursor-pointer font-semibold">Cartella del kit</summary>
                <form className="mt-3 space-y-3" onSubmit={event => {
                    event.preventDefault();
                    void run(async () => {
                        const response = await fetch('/api/agent-mandates/local-kit', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ kitPath: kitPathDraft.trim() }),
                        });
                        if (!response.ok) throw new Error(await readFailureMessage(response));
                        await refresh();
                    });
                }}>
                    <label className="block">
                        Percorso cartella del kit
                        <input
                            className={SETTINGS_INPUT_CLASS}
                            type="text"
                            value={kitPathDraft}
                            placeholder={localKit?.kitPath ?? '/Users/<utente>/Antigravity/mf-ambulatorio-kit'}
                            onChange={event => setKitPathDraft(event.target.value)}
                        />
                    </label>
                    {localKitConnected ? <p>Scollega Codex per cambiare cartella.</p> : null}
                    <button type="submit" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !kitPathDraft.trim() || localKitConnected}>Salva percorso</button>
                </form>
            </details>
        </section>
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
            <label className="block">Durata in ore<input className={SETTINGS_INPUT_CLASS} type="number" min="1" max="24" required value={hours} onChange={event => setHours(event.target.value)} /></label>
            <label className="block">Fornitore<select className={SETTINGS_INPUT_CLASS} value={provider} onChange={event => { setProvider(event.target.value as typeof provider); setEgress(false); }}>
                <option value="openai">OpenAI (Codex)</option><option value="anthropic">Anthropic</option><option value="local">Locale</option>
            </select></label>
            {provider !== 'local' && <label className="flex gap-2"><input type="checkbox" checked={egress} onChange={event => setEgress(event.target.checked)} />Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto</label>}
            <fieldset><legend>Operazioni consentite</legend>{AGENT_OPERATIONS.map((operation, index) => <label className="flex gap-2" key={operation}>
                <input type="checkbox" checked={operations.includes(operation)} onChange={event => setOperations(current => event.target.checked ? [...current, operation] : current.filter(value => value !== operation))} />{operationLabels[index]}
            </label>)}</fieldset>
            <p>Nota, trascrizione, PDF e proposte attendono la tua conferma in «In arrivo».</p>
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
                return <li className="space-y-3 border-b border-[var(--lume-rule)] py-4" key={pairing.id}>
                    <h3>{pairing.name} <strong>{pairing.code}</strong></h3>
                    <p>{pairing.operations.map(operation => operationLabels[AGENT_OPERATIONS.indexOf(operation)]).join(', ')}</p>
                    <label className="block">Mandato per {pairing.name}<select className={SETTINGS_INPUT_CLASS} value={selected}
                        onChange={event => setSelectedMandates(current => ({ ...current, [pairing.id]: event.target.value }))}>
                        {!compatible.length && <option value="">Crea un mandato con queste operazioni</option>}
                        {compatible.map(mandate => <option key={mandate.id} value={mandate.id}>{mandate.provider} · {formatMandateExpiry(mandate.expiresAt, readAt)}</option>)}
                    </select></label>
                    <label className="flex gap-2">
                        <input type="checkbox" checked={renewOnUnlock} onChange={event => {
                            setRenewing(event.target.checked ? pairing.id : null); setApprovalPin(''); setApprovalPinSubmitError(null);
                        }} />Rinnova allo sblocco
                    </label>
                    {renewOnUnlock && <>
                        <p>Dal prossimo sblocco il client riceve un mandato di 24 ore con queste operazioni. Il blocco per inattività non lo ferma; «Blocca» lo revoca.</p>
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
                <span>{mandate.provider} · {mandate.revokedAt !== null ? 'Revocato' : mandate.expiresAt <= readAt ? 'Scaduto' : formatMandateExpiry(mandate.expiresAt, readAt)}</span>
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
