'use client';

// WUL-297 Zona pericolo: isolated surface with explicit typed confirmation.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import styles from '@/components/settings/maintenance-pages.module.css';
import { ViewState } from '@/components/ui/view-state';
import { SETTINGS_INPUT_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

const RESET_CONFIRM_KEYWORD = 'RESET';

type ResetReceipt = {
    id: string;
    outcome: 'in_progress' | 'completed' | 'aborted' | 'undetermined';
    startedAt: string | null;
    finishedAt: string | null;
    reconciled: boolean;
    previousArchive: { retained: boolean; sha256: string | null; discardedAt: string | null };
};

function receiptDetail(receipt: ResetReceipt): string {
    const when = receipt.finishedAt ?? receipt.startedAt;
    const date = when ? new Date(when).toLocaleString('it-IT') : 'data non registrata';
    const parts = [`Ricevuta ${receipt.id.slice(0, 8)}, ${date}.`];
    if (receipt.reconciled) parts.push('Esito stabilito al riavvio dopo un’interruzione.');
    if (receipt.previousArchive.retained) parts.push(`Copia dell’archivio precedente conservata (SHA-256 ${receipt.previousArchive.sha256?.slice(0, 12) ?? 'non registrato'}).`);
    else if (receipt.previousArchive.discardedAt) parts.push('Copia dell’archivio precedente eliminata su conferma.');
    return parts.join(' ');
}

function ReceiptState({ receipt, onDiscard, discarding }: { receipt: ResetReceipt; onDiscard: (receipt: ResetReceipt) => void; discarding: boolean }) {
    const detail = receiptDetail(receipt);
    const discard = receipt.previousArchive.retained && (receipt.outcome === 'completed' || receipt.outcome === 'aborted')
        ? { label: discarding ? 'Eliminazione in corso...' : 'Elimina la copia precedente', onClick: () => onDiscard(receipt) } : undefined;
    if (receipt.outcome === 'completed') return <div role="status" data-reset-outcome="completed" className="py-4">
        <p className="type-strong">Ripristino completato</p>
        <p className="mt-2 type-meta text-muted">{detail}</p>
        {discard && <button type="button" className="mf-button-text" onClick={discard.onClick} disabled={discarding}>{discard.label}</button>}
    </div>;
    if (receipt.outcome === 'aborted') return <div data-reset-outcome="aborted"><ViewState state="unavailable" title="Ripristino annullato, archivio precedente intatto" detail={detail} action={discarding ? undefined : discard} /></div>;
    if (receipt.outcome === 'in_progress') return <div data-reset-outcome="in_progress"><ViewState state="loading" title="Ripristino in corso" detail={detail} /></div>;
    return <div data-reset-outcome="undetermined"><ViewState state="error" title="Esito del ripristino non determinabile. Conserva la cartella dati e la cartella del giornale accanto all’archivio." detail={detail} /></div>;
}

export default function SettingsDangerZonePage() {
    const [confirmText, setConfirmText] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [resetOutcome, setResetOutcome] = useState<'sessions_unconfirmed' | 'unknown' | null>(null);
    const { showToast } = useToast();
    const confirm = useConfirm();
    const confirmed = confirmText.trim().toUpperCase() === RESET_CONFIRM_KEYWORD;
    const [receipts, setReceipts] = useState<ResetReceipt[] | null>(null);
    const [discarding, setDiscarding] = useState<string | null>(null);

    const loadReceipts = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/reset', { cache: 'no-store' });
            const body = res.ok ? await res.json() as { receipts?: ResetReceipt[] } : null;
            setReceipts(Array.isArray(body?.receipts) ? body.receipts : []);
        } catch { setReceipts([]); }
    }, []);
    useEffect(() => { void loadReceipts(); }, [loadReceipts]);

    const discardPrevious = async (receipt: ResetReceipt) => {
        if (discarding) return;
        const { confirmed: proceed } = await confirm({
            title: 'Eliminare la copia dell’archivio precedente?',
            message: 'La copia contiene gli account e le chiavi di prima del ripristino. Dopo l’eliminazione non si può più tornare indietro.',
            confirmLabel: 'Elimina la copia',
            tone: 'danger',
        });
        if (!proceed) return;
        setDiscarding(receipt.id);
        try {
            const res = await fetch('/api/auth/reset/previous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: receipt.id }) });
            if (!res.ok) showToast({ tone: 'error', title: 'Copia non eliminata' });
        } catch { showToast({ tone: 'error', title: 'Copia non eliminata' }); }
        finally { setDiscarding(null); await loadReceipts(); }
    };
    const shownReceipts = (receipts ?? []).filter((receipt, index) => index === 0 || receipt.previousArchive.retained || receipt.outcome === 'undetermined' || receipt.outcome === 'in_progress');

    const resetOnboarding = async () => {
        if (!confirmed || isResetting || resetOutcome) return;
        const { confirmed: proceed } = await confirm({
            title: 'Ripristinare la configurazione iniziale?',
            message: 'Gli account saranno eliminati e sarà necessaria una nuova configurazione iniziale.',
            confirmLabel: 'Ripristina configurazione',
            tone: 'danger',
        });
        if (!proceed) return;
        setIsResetting(true);
        try {
            const res = await fetch('/api/auth/reset', { method: 'POST' });
            if (res.ok) {
                window.location.href = '/';
            } else {
                const outcome = await res.json().catch(() => null) as { code?: string } | null;
                if (res.status === 500 && outcome?.code === 'RESET_AUTHORITY_COMMIT_FAILED') setResetOutcome('sessions_unconfirmed');
                else if (res.status >= 500) setResetOutcome('unknown');
                else showToast({ tone: 'error', title: 'Errore durante il reset' });
            }
        } catch (e) {
            console.error(e);
            setResetOutcome('unknown');
        } finally {
            setIsResetting(false);
            void loadReceipts();
        }
    };

    return (
        <section className={styles.page} data-testid="settings-danger-zone-section">
            <header className={styles.intro}><h2>Zona pericolo</h2><p>Operazioni che riportano la postazione a uno stato precedente. Richiedono riconfigurazione.</p></header>
            <section className={styles.section}>
                <h3 className={styles.heading}><AlertTriangle aria-hidden />Ripristina configurazione iniziale</h3>
                <p>Elimina gli account e richiede una nuova configurazione iniziale. Una copia dell’archivio precedente resta conservata finché non ne confermi l’eliminazione.</p>
                <label className={styles.fieldLabel}><span>Scrivi <strong>{RESET_CONFIRM_KEYWORD}</strong> per abilitare il reset.</span>
                    <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Digita qui la parola richiesta"
                        autoComplete="off" spellCheck={false} data-testid="danger-zone-confirm-input" className={SETTINGS_INPUT_CLASS} readOnly={isResetting} />
                </label>
                {shownReceipts.map(receipt => <ReceiptState key={receipt.id} receipt={receipt} onDiscard={discardPrevious} discarding={discarding === receipt.id} />)}
                {resetOutcome && <div>
                    <ViewState state="error" title={resetOutcome === 'sessions_unconfirmed' ? 'Reset eseguito, ma la chiusura delle sessioni non è stata confermata.' : 'Esito del reset non confermato. Verifica l’accesso prima di procedere.'} />
                    <Link href="/settings/accesso" className={SETTINGS_SECONDARY_BUTTON_CLASS}>Accesso</Link>
                </div>}
                <div className={styles.actions}><button onClick={resetOnboarding} disabled={!confirmed || isResetting || resetOutcome !== null} data-testid="danger-zone-reset-button" className="mf-button-destructive">{isResetting ? 'Reset in corso...' : 'Ripristina configurazione'}</button></div>
            </section>
        </section>
    );
}
