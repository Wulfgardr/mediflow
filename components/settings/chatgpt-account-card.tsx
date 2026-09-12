'use client';
/* @Codex */
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { createAccountBrowser, type AccountBrowserView } from '@/lib/chatgpt-account/account-browser';
import { accountNotices, presentAccount } from '@/lib/chatgpt-account/account-presentation';
import type { AccountAction, AccountLimitWindow, AccountOperation } from '@/lib/chatgpt-account/account-contract';
import { SETTINGS_CARD_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';
import styles from './chatgpt-account-card.module.css';

function Quota({ window, title }: { window: AccountLimitWindow | null; title: string }) {
    if (!window) return <p>{title}: dato non disponibile.</p>;
    return <div className={styles.quota}>
        <p><strong>{title}</strong> · {Math.round(window.usedPercent)}% utilizzato</p>
        <progress max={100} value={Math.min(window.usedPercent, 100)} aria-label={`${title}: utilizzo`} />
        {window.windowDurationMins !== null && <p className={styles.hint}>Finestra di {window.windowDurationMins >= 60 ? `${window.windowDurationMins / 60} ore` : `${window.windowDurationMins} minuti`}</p>}
        {window.resetsAt !== null && <p className={styles.hint}>Ripristino: {new Date(window.resetsAt * 1000).toLocaleString('it-IT')}</p>}
    </div>;
}
function ObservationTime({ value }: { value: number }) {
    return <span>Ultima lettura: <time dateTime={new Date(value).toISOString()}>{new Date(value).toLocaleTimeString('it-IT')}</time>.</span>;
}
export function ChatGptAccountCard({ active }: { active: boolean }) {
    const [client] = useState(() => createAccountBrowser());
    const [view, setView] = useState<AccountBrowserView>(client.snapshot);
    const id = useId();
    const presentation = presentAccount(view, active);
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
        if (presentation.pollDelay === null) return;
        const timer = setTimeout(() => { void client.run('status'); }, presentation.pollDelay);
        return () => clearTimeout(timer);
    }, [client, presentation.pollDelay, view]);
    const locked = presentation.locked;
    const status = locked ? null : view.status;
    const busy = view.busy !== null;
    const allowed = (action: AccountAction) => !locked && (!view.error || ['cancel_login', 'logout'].includes(action)) && status?.actions.includes(action);
    const run = (operation: AccountOperation | 'status') => { void client.run(operation); };
    return <section id="chatgpt-account" className={`${SETTINGS_CARD_CLASS} ${styles.card}`} aria-labelledby={`${id}-title`} data-testid="chatgpt-account-panel">
        <header className={styles.header}>
            <div className={styles.identity}>
                <Image className={styles.logo} src="/brand/openai/chatgpt-mark.png" alt="Logo OpenAI" width={40} height={40} unoptimized />
                <div><h3 id={`${id}-title`}>ChatGPT · OpenAI</h3><p>Servizio esterno · account personale</p></div>
            </div>
            <span className={styles.status} role="status" data-testid="chatgpt-account-state">{presentation.accountLabel}</span>
        </header>
        <div className={styles.boundary} aria-label="Disponibilità ChatGPT in MediFlow">
            <strong data-testid="chatgpt-execution-state">{presentation.executionLabel}</strong>
            <p>Il collegamento dell’account non abilita le funzioni di MediFlow. L’ammissione OpenAI resta sospesa (ADR0134).</p>
            <p>Questa scheda gestisce soltanto accesso e informazioni account: non invia contesto paziente e non avvia sintesi, neppure dimostrative.</p>
        </div>
        <div className={styles.actions}>
            <Link href="/settings/ai/chatgpt" prefetch={false} className={SETTINGS_SECONDARY_BUTTON_CLASS}>Apri prova OpenAI · solo dati demo</Link>
        </div>
        {locked ? <p>Sblocca MediFlow per gestire il collegamento.</p> : <>
            {status?.notice && <p role="status">{accountNotices[status.notice]}</p>}
            {presentation.planLabel && <p>Piano restituito dal servizio: <strong>{presentation.planLabel}</strong>. Non attesta la disponibilità di una funzione.</p>}
            {view.error && <p role="alert" className={styles.error}>{view.error}</p>}
            {status?.state === 'awaiting_login' && <p>Completa l’accesso ufficiale sul computer che ospita MediFlow, poi torna qui. Se il link non è più visibile, annulla e avvia un nuovo accesso.</p>}
            {status?.state === 'verifying' && <p>Accesso ricevuto. Verifica il collegamento per completare.</p>}
            <div className={styles.actions}>
                {allowed('connect') && <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => run('login/start')}>Collega ChatGPT</button>}
                {view.authUrl && status?.state === 'awaiting_login' && <a className={SETTINGS_PRIMARY_BUTTON_CLASS} href={view.authUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Apri accesso ufficiale</a>}
                {allowed('complete_login') && <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => run('login/complete')}>Verifica accesso</button>}
                {(allowed('cancel_login') || view.busy === 'login/start') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy === 'login/cancel'} onClick={() => run('login/cancel')}>Annulla accesso</button>}
                {allowed('logout') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy === 'logout'} onClick={() => run('logout')}>Scollega ChatGPT</button>}
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('status')}>Rileggi stato</button>
            </div>
            {busy && !presentation.operation && view.busy !== 'status' && <p role="status">Lettura in corso…</p>}
            {presentation.showDetails && <details className={styles.disclosure}>
                <summary>Modelli e utilizzo dell’account</summary>
                <div className={styles.detailBody}>
                    <p className={styles.hint}>Catalogo informativo dell’account, separato dal selettore delle funzioni. Nessun modello qui è selezionabile per una proposta.</p>
                    <p className={styles.hint}>Modelli e utilizzo si leggono solo su richiesta e vengono nascosti dopo un minuto o quando lo stato cambia. «Rileggi stato» controlla lo stato locale, non aggiorna questi dati.</p>
                    <div className={styles.actions}>
                        {allowed('read_models') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('models')}>{view.modelsObservedAt === null ? 'Mostra modelli' : 'Rileggi modelli'}</button>}
                        {allowed('read_rate_limits') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('rate-limits')}>Controlla utilizzo</button>}
                        {allowed('refresh_account') && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => run('read')}>Aggiorna account</button>}
                    </div>
                    <div data-testid="chatgpt-catalog">
                        <h4>Modelli dell’account · sola consultazione</h4>
                        {view.modelsObservedAt !== null && <p className={styles.hint}><ObservationTime value={view.modelsObservedAt} /></p>}
                        {view.busy === 'models' ? <p role="status">Lettura catalogo…</p>
                            : view.models !== null ? view.models.length ? <ul className={styles.catalog}>{view.models.map((model, index) => <li key={`${model.id}-${index}`}>{model.model}{model.isDefault ? ' · predefinito dell’account, non di MediFlow' : ''}</li>)}</ul>
                                : <p>Nessun modello restituito dal servizio.</p>
                            : <p role="status">{view.modelsObservedAt === null ? 'Catalogo non ancora letto.' : 'Catalogo da rileggere: i valori precedenti non sono più mostrati.'}</p>}
                    </div>
                    <div data-testid="chatgpt-limits">
                        <h4>Utilizzo restituito dal servizio account</h4>
                        <p className={styles.hint}>Finestre del servizio Codex: non sono credito API né garanzia di esecuzione. Un dato assente non significa utilizzo zero.</p>
                        {view.limitsObservedAt !== null && <p className={styles.hint}><ObservationTime value={view.limitsObservedAt} /></p>}
                        {view.busy === 'rate-limits' ? <p role="status">Lettura utilizzo…</p>
                            : view.limits ? <div className={styles.quotas}><Quota title="Limite principale" window={view.limits.primary} /><Quota title="Limite aggiuntivo" window={view.limits.secondary} /></div>
                                : <p role="status">{view.limitsObservedAt === null ? 'Utilizzo non ancora letto.' : 'Utilizzo da rileggere: i valori precedenti non sono più mostrati.'}</p>}
                    </div>
                </div>
            </details>}
            {allowed('configure_host') && <details className={styles.disclosure}><summary>Come predisporre il collegamento</summary><div className={styles.detailBody}><p>Il componente account deve essere predisposto dall’operatore sul computer che ospita MediFlow. Dopo la configurazione, rileggi lo stato. Il login si completa sullo stesso computer; questa scheda non installa componenti né recupera credenziali esistenti.</p></div></details>}
        </>}
    </section>;
}
