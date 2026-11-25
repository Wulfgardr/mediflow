'use client';

import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatCountLabel } from '@/lib/format-count';
import { SECURITY_CONFIG } from '@/lib/security/security';
import { validateConfirmationPinSubmission } from '@/lib/security/pin-input';
import {
    AMBULATORY_COMMAND_RETRY_CODES, executeAmbulatoryCommand, prepareAmbulatoryCommand,
    type WebAmbulatoryPlan, type WebAmbulatoryReceipt,
} from '@/lib/web-ambulatory-destructive-client';

const pinErrors: Record<string, string> = {
    PIN_DENIED: 'PIN non accettato.',
    PIN_LOCKED: 'Troppi tentativi falliti. Riprova più tardi.',
};

function PlanSummary({ plan }: { plan: WebAmbulatoryPlan }) {
    if (plan.operation === 'ambulatory.delete.v1') return <ul className="grid gap-1 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
        <li>Nessun paziente e nessun reparto collegato.</li>
        {plan.fallback && <li>«{plan.fallback.name}» diventa la sede predefinita.</li>}
    </ul>;
    const counts = plan.counts!;
    if (counts.tombstonedPatients + counts.unlinkedPatients === 0) return <p className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">La sede è già vuota.</p>;
    return <ul className="grid gap-1 text-sm leading-6 text-[color:var(--lume-ink-muted)]" data-testid="ambulatory-command-plan">
        {counts.tombstonedPatients > 0 && <li>{formatCountLabel(counts.tombstonedPatients, 'paziente va nel Cestino.', 'pazienti vanno nel Cestino.')}</li>}
        {counts.unlinkedPatients > 0 && <li>{formatCountLabel(counts.unlinkedPatients, 'paziente resta nelle altre sedi.', 'pazienti restano nelle altre sedi.')}</li>}
    </ul>;
}

export function AmbulatoryDestructiveDialog({ plan: initialPlan, onClose, onApplied, onFailed }: {
    plan: WebAmbulatoryPlan;
    onClose: () => void;
    onApplied: (receipt: WebAmbulatoryReceipt, plan: WebAmbulatoryPlan) => void;
    onFailed: (code: string) => void;
}) {
    const [plan, setPlan] = useState(initialPlan);
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [refreshed, setRefreshed] = useState(false);
    const [sending, setSending] = useState(false);
    const clear = plan.operation === 'ambulatory.clear-test.v1';

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const invalid = validateConfirmationPinSubmission(pin);
        if (invalid) { setError(invalid); return; }
        setSending(true);
        setError('');
        try {
            const executed = await executeAmbulatoryCommand(plan.reference, pin);
            if (executed.ok) { onApplied(executed.value, plan); return; }
            if (pinErrors[executed.code]) { setError(pinErrors[executed.code]); setPin(''); return; }
            if (!AMBULATORY_COMMAND_RETRY_CODES.has(executed.code)) { onFailed(executed.code); return; }
            const prepared = await prepareAmbulatoryCommand(plan.operation, plan.target.id, plan.target.version);
            if (!prepared.ok) { onFailed(prepared.code); return; }
            setPlan(prepared.value);
            setPin('');
            setRefreshed(true);
        } catch {
            onFailed('NETWORK');
        } finally {
            setSending(false);
        }
    };

    return <Modal open onClose={onClose} accent="critical"
        title={clear ? `Svuotare «${plan.target.name}»?` : `Eliminare la sede «${plan.target.name}»?`}>
        <form onSubmit={submit} className="grid gap-4" aria-busy={sending}>
            {refreshed && <p role="status" className="text-sm font-semibold text-[color:var(--lume-ink)]">Controlla di nuovo i dati e conferma.</p>}
            <PlanSummary plan={plan} />
            <label className="mf-field-label grid gap-1">PIN di conferma
                <input name="pin" type="password" autoComplete="off" required value={pin}
                    minLength={SECURITY_CONFIG.PIN_MIN_LENGTH} maxLength={SECURITY_CONFIG.PIN_MAX_LENGTH + 1}
                    onChange={event => { setPin(event.target.value); setError(''); }} className="mf-input" aria-invalid={Boolean(error)} />
            </label>
            {error && <p role="alert" className="text-sm text-[color:var(--lume-signal-critical)]">{error}</p>}
            <div className="flex flex-wrap justify-end gap-3">
                <Button variant="secondary" onClick={onClose} disabled={sending}>Annulla</Button>
                <Button variant="destructive" confirmation type="submit" disabled={sending || pin.length === 0}>{clear ? 'Svuota' : 'Elimina'}</Button>
            </div>
        </form>
    </Modal>;
}
