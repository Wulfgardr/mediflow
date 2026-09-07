'use client';
/* @Codex */
import { useEffect, useId, useState } from 'react';
import { createAccountBrowser, type AccountBrowserView } from '@/lib/chatgpt-account/account-browser';
import type { AccountAction, AccountLimitWindow, AccountNotice, AccountOperation, AccountState } from '@/lib/chatgpt-account/account-contract';
import { SETTINGS_CARD_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';
import styles from './chatgpt-account-card.module.css';

const labels: Record<AccountState, string> = { unavailable: 'Da configurare', disconnected: 'Non collegato', starting: 'Avvio accesso', awaiting_login: 'Accesso in attesa', verifying: 'Da verificare', connected: 'Account collegato', error: 'Collegamento interrotto' };
const notices: Partial<Record<Exclude<AccountNotice, null>, string>> = {
    host_unavailable: 'Il collegamento richiede la configurazione del computer che ospita MediFlow.',
    timeout: 'Il controllo ha impiegato troppo tempo. Puoi riprovare.', protocol_error: 'Il servizio account ha restituito una risposta inattesa.',
    process_exited: 'Il servizio account si è arrestato. Collega di nuovo ChatGPT.', login_failed: 'Accesso non completato. Puoi riprovare.',
    login_expired: 'Il tempo per accedere è scaduto. Avvia un nuovo accesso.', canceled: 'Accesso annullato.',
    logout_unconfirmed: 'Account scollegato da MediFlow. Il servizio non ha confermato il logout remoto.',
};
function Quota({ window, title }: { window: AccountLimitWindow | null; title: string }) {
    if (!window) return <p>{title}: dato non disponibile.</p>;
    return <div className={styles.quota}>
        <p><strong>{title}</strong> · {Math.round(window.usedPercent)}% utilizzato</p>
        <progress max={100} value={Math.min(window.usedPercent, 100)} aria-label={`${title}: utilizzo`} />
        {window.windowDurationMins !== null && <p className={styles.hint}>Finestra di {window.windowDurationMins >= 60 ? `${window.windowDurationMins / 60} ore` : `${window.windowDurationMins} minuti`}</p>}
        {window.resetsAt !== null && <p className={styles.hint}>Ripristino: {new Date(window.resetsAt * 1000).toLocaleString('it-IT')}</p>}
    </div>;
}
export function ChatGptAccountCard({ active }: { active: boolean }) {
    const [client] = useState(() => createAccountBrowser());
    const [view, setView] = useState<AccountBrowserView>(client.snapshot);
    const id = useId();
    useEffect(() => {
        const unsubscribe = client.subscribe(() => setView(client.snapshot()));
        client.setActive(active);
        if (active) void client.run('status');
        const hide = () => client.setActive(false);
        const show = (event: PageTransitionEvent) => {
            if (event.persisted && active) { client.setActive(true); void client.run('status'); }
        };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', show);
        return () => { unsubscribe(); client.setActive(false); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
    }, [active, client]);
    useEffect(() => {
        if (!active || view.kind === 'locked' || view.busy || !view.status || !['starting', 'awaiting_login', 'verifying', 'connected'].includes(view.status.state)) return;
        const timer = setTimeout(() => { void client.run('status'); }, view.status.state === 'connected' ? 10_000 : 2000);
        return () => clearTimeout(timer);
    }, [active, client, view]);
    const locked = !active || view.kind === 'locked';
    const status = locked ? null : view.status;
    const busy = view.busy !== null;
    const allowed = (action: AccountAction) => !locked && (!view.error || ['cancel_login', 'logout'].includes(action)) && status?.actions.includes(action);
    const run = (operation: AccountOperation | 'status') => { void client.run(operation); };
    const operationCaption = view.busy === 'login/start' ? 'Avvio accesso…' : view.busy === 'login/cancel' ? 'Annullamento…' : view.busy === 'login/complete' ? 'Verifica in corso…' : view.busy === 'logout' ? 'Scollegamento…' : null;
    const caption = locked ? 'Sessione bloccata' : operationCaption ? operationCaption : view.error ? 'Stato da rileggere' : status ? labels[status.state] : view.kind === 'error' ? 'Stato non disponibile' : 'Lettura dello stato…';
    return <section className={`${SETTINGS_CARD_CLASS} ${styles.card}`} aria-labelledby={`${id}-title`} data-testid="chatgpt-account-panel">
        <header className={styles.header}>
            <div className={styles.identity}><h3 id={`${id}-title`}>ChatGPT</h3><p>Account personale · accesso ufficiale</p></div>
            <span className={styles.status} role="status">{caption}</span>
        </header>
        <p className={styles.hint}>Il collegamento dell’account non abilita le funzioni di MediFlow.</p>
        {locked ? <p>Sblocca MediFlow per gestire il collegamento.</p> : <>
            {status?.notice && notices[status.notice] && <p role="status">{notices[status.notice]}</p>}
            {view.error && <p role="alert" className={styles.error}>{view.error}</p>}
            {status?.state === 'awaiting_login' && <p>Completa l’accesso sul computer che ospita MediFlow, poi torna qui.</p>}
            {status?.state === 'verifying' && <p>Accesso ricevuto. Verifica il collegamento per completare.</p>}
            <div className={styles.actions}>
                {allowed('connect') && <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => run('login/start')}>Collega ChatGPT</button>}
                {view.authUrl && status?.state === 'awaiting_login' && <a className={SETTINGS_PRIMARY_BUTTON_CLASS} href={view.authUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Apri accesso ufficiale</a>}
                {allowed('complete_login') && <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => run('login/complete')}>Verifica accesso</button>}
                {(allowed('cancel_login') || view.busy === 'login/start') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy === 'login/cancel'} onClick={() => run('login/cancel')}>Annulla accesso</button>}
                {allowed('logout') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy === 'logout'} onClick={() => run('logout')}>Scollega ChatGPT</button>}
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('status')}>Rileggi stato</button>
            </div>
            {busy && !operationCaption && view.busy !== 'status' && <p role="status">Lettura in corso…</p>}
            {status?.state === 'connected' && <details className={styles.disclosure}>
                <summary>Modelli e utilizzo dell’account</summary>
                <div className={styles.detailBody}>
                    <p className={styles.hint}>Catalogo informativo. I modelli non sono utilizzabili nelle funzioni di MediFlow.</p>
                    <div className={styles.actions}>
                        {allowed('read_models') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('models')}>Mostra modelli</button>}
                        {allowed('read_rate_limits') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('rate-limits')}>Controlla utilizzo</button>}
                        {allowed('refresh_account') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('read')}>Aggiorna account</button>}
                    </div>
                    {view.models !== null && <div><h4>Modelli dell’account</h4>{view.models.length ? <ul className={styles.catalog}>{view.models.map((model, index) => <li key={`${model.id}-${index}`}>{model.model}</li>)}</ul> : <p>Nessun modello restituito dal servizio.</p>}</div>}
                    {view.limits && <div className={styles.quotas}><Quota title="Limite principale" window={view.limits.primary} /><Quota title="Limite aggiuntivo" window={view.limits.secondary} /></div>}
                </div>
            </details>}
            {allowed('configure_host') && <details className={styles.disclosure}><summary>Come predisporre il collegamento</summary><div className={styles.detailBody}><p>Il componente account deve essere configurato sul computer che ospita MediFlow. Dopo la configurazione, rileggi lo stato.</p></div></details>}
        </>}
    </section>;
}
