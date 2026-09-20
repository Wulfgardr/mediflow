'use client';
/* @Codex */
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSecurity } from '@/components/security-provider';
import { createProductBrowser } from '@/lib/chatgpt-product/product-browser';
import type { ProductOperation } from '@/lib/chatgpt-product/product-contract';
import { SETTINGS_CARD_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';
import { presentSynthesisStatus, presentSynthesisNotice, qualificationCopy } from './chatgpt-synthesis-presentation';
import styles from './chatgpt-synthesis-panel.module.css';

export function ChatGptSynthesisCard({ active }: { active: boolean }) {
    const [client] = useState(() => createProductBrowser());
    const view = useSyncExternalStore(client.subscribe, client.snapshot, client.snapshot);
    const [acceptedRevision, setAcceptedRevision] = useState<string | null>(null);
    useEffect(() => {
        client.setActive(active);
        if (active) void client.run('status');
        // This poll is only local GET status, never a catalog or inference RPC.
        const timer = active ? setInterval(() => { void client.run('status'); }, 2000) : undefined;
        return () => { clearInterval(timer); client.setActive(false); };
    }, [active, client]);
    const snapshot = view.snapshot;
    const invoke = (operation: ProductOperation) => { void client.run(operation); };
    if (!active) return <section className={`${SETTINGS_CARD_CLASS} ${styles.panel}`} data-testid="chatgpt-synthesis-panel"><h2>Prova di sintesi</h2><p>Sblocca la sessione MediFlow per accedere.</p></section>;
    const canConsent = snapshot?.state === 'needs_consent';
    const canPrepare = snapshot && snapshot.qualification.platform === 'darwin' && ['not_prepared', 'closed'].includes(snapshot.preparation.state);
    const preparing = view.busy === 'prepare' || snapshot?.preparation.state === 'preparing';
    const canRead = snapshot && ['connected', 'ready'].includes(snapshot.state);
    const loginPending = snapshot && ['starting', 'awaiting_login', 'verifying'].includes(snapshot.state);
    const selected = snapshot?.catalog?.choices.find(choice => choice.optionId === view.selection?.modelOptionId);
    const status = presentSynthesisStatus(snapshot, view.busy);
    return <section className={`${SETTINGS_CARD_CLASS} ${styles.panel}`} aria-labelledby="synthesis-heading" data-testid="chatgpt-synthesis-panel">
        <header className={styles.intro}>
            <h2 id="synthesis-heading">Prova di sintesi</h2>
            <p>Solo fonti demo, nessun dato paziente e nessuna scrittura clinica. <strong>Uso clinico sospeso.</strong></p>
        </header>
        <div className={styles.status} role="status" aria-live="polite" data-testid="synthesis-state">
            <strong>{status.title}</strong><p>{status.next}</p>
        </div>
        {view.error ? <p className={styles.error} role="alert">{view.error}</p> : null}
        {snapshot?.notice ? <p className={styles.error} role="alert">{presentSynthesisNotice(snapshot.notice)}</p> : null}
        {snapshot && snapshot.qualification.state !== 'qualified' ? <p>{qualificationCopy[snapshot.qualification.state]} La prova resta bloccata finché la configurazione non è verificata.</p> : null}
        {snapshot?.receipt.cleanup === 'unconfirmed' ? <p className={styles.error}>La pulizia della prova precedente non è confermata. Un nuovo consenso resta bloccato: controlla la configurazione.</p> : null}
        {snapshot?.receipt.remoteLogout === 'unconfirmed' ? <p className={styles.error}>Lo scollegamento remoto non è confermato. La chiusura locale non revoca gli altri accessi OpenAI.</p> : null}
        <div className={styles.actions}>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!!view.busy} onClick={() => invoke('status')}>Rileggi stato locale</button>
            {!snapshot || snapshot.state === 'held' || snapshot.state === 'error' || snapshot.qualification.state !== 'qualified' || snapshot.receipt.cleanup === 'unconfirmed' ?
                <Link href="/settings/ai/modelli" prefetch={false} className={SETTINGS_SECONDARY_BUTTON_CLASS}>Apri Modelli e hardware</Link> : null}
        </div>
        {canPrepare ? <div className={styles.step}>
            <p>Prepara un ambiente dedicato con verifiche locali. Questo passaggio non apre collegamenti a OpenAI e non usa il tuo account.</p>
            <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!!view.busy} onClick={() => invoke('prepare')}>Prepara postazione</button>
        </div> : null}
        {preparing || snapshot?.preparation.state === 'ready' ? <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => invoke('cancel')}>Annulla preparazione</button> : null}
        {snapshot?.preparation.state === 'blocked' ? <p className={styles.error}>La chiusura dell’ambiente precedente non è confermata. La preparazione resta sospesa: riavviare l’app non risolve questa verifica.</p> : null}
        {snapshot ? <>
            <details className={styles.disclosure}>
                <summary>Fonti demo da inviare ({snapshot.disclosure.sources.length})</summary>
                <div className={styles.detailBody}>
                    {snapshot.disclosure.sources.map(source => <article className={styles.source} key={source.id}>
                        <h3>{source.id} · {source.title}</h3><p>{source.text}</p>
                    </article>)}
                </div>
            </details>
            {canConsent ? <fieldset className={styles.step} disabled={!!view.busy}>
                <legend>Autorizza questa prova</legend>
                <p>Avviare l’accesso aprirà un collegamento a OpenAI nel solo ambiente appena preparato. Le sole fonti demo sopra saranno inviate quando premi Genera sintesi DEMO. La prova scade entro cinque minuti dall’inizio della preparazione.</p>
                <label className={styles.consent}>
                    <input type="checkbox" checked={acceptedRevision === snapshot.disclosure.revision} onChange={event => setAcceptedRevision(event.target.checked ? snapshot.disclosure.revision : null)} />
                    <span>Autorizzo accesso dedicato e invio delle sole fonti demo per questa prova.</span>
                </label>
                <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={acceptedRevision !== snapshot.disclosure.revision || snapshot.qualification.state !== 'qualified' || snapshot.receipt.cleanup === 'unconfirmed'} onClick={() => { setAcceptedRevision(null); invoke('consent'); }}>Autorizza prova DEMO</button>
            </fieldset> : null}
            {snapshot.state === 'consented' ? <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!!view.busy} onClick={() => invoke('login/start')}>Avvia accesso per la prova</button> : null}
            {view.login ? <div className={styles.login} data-testid="execution-login">
                <h3>Accesso dedicato alla prova</h3>
                <p>È separato dal controllo account e dal tuo Codex personale. Completa l’accesso OpenAI, poi torna qui.</p>
                <a className={SETTINGS_PRIMARY_BUTTON_CLASS} href={view.login.verificationUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Apri accesso ufficiale OpenAI</a>
                <p>Codice monouso: <strong>{view.login.userCode}</strong>. Non viene salvato da questa pagina.</p>
            </div> : null}
            {loginPending ? <div className={styles.actions}>
                <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!!view.busy || snapshot.state === 'starting'} onClick={() => invoke('login/complete')}>Verifica accesso</button>
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => invoke('login/cancel')}>Annulla accesso</button>
            </div> : null}
            {canRead ? <div className={styles.actions}>
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!!view.busy} onClick={() => invoke('read')}>Aggiorna account e quota</button>
                <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!!view.busy} onClick={() => invoke('models')}>Leggi modelli disponibili</button>
            </div> : null}
            {snapshot.limits ? <p>Quota osservata: finestra primaria {snapshot.limits.primaryUsedPercent === null ? 'non disponibile' : `${snapshot.limits.primaryUsedPercent}% usato`}; secondaria {snapshot.limits.secondaryUsedPercent === null ? 'non disponibile' : `${snapshot.limits.secondaryUsedPercent}% usato`}. Non garantisce la quota futura.</p> : null}
            {snapshot.catalog ? <fieldset className={styles.step}>
                <legend>Scegli il modello per questa prova</legend>
                <label htmlFor="execution-choice">Modello e livello di ragionamento (effort)</label>
                <select className={SETTINGS_INPUT_CLASS} id="execution-choice" value={view.selection?.modelOptionId ?? ''} onChange={event => { void client.select(event.target.value); }}>
                    <option value="">Scegli modello e livello di ragionamento</option>
                    {snapshot.catalog.choices.map(choice => <option key={choice.optionId} value={choice.optionId}>{choice.model} · {choice.effort}</option>)}
                </select>
                <p>{selected ? `Scelta: ${selected.model}, effort ${selected.effort}.` : 'Nessun modello selezionato.'} Nessuna sostituzione automatica.</p>
                <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!view.selection || !!view.busy || snapshot.state !== 'ready'} onClick={() => invoke('generate')}>Genera sintesi DEMO</button>
                <p className={styles.hint}>Cambiare scelta durante la generazione annulla l’operazione; non ne avvia un’altra.</p>
            </fieldset> : null}
            {snapshot.state === 'generating' || view.busy === 'generate' || view.busy === 'login/start' || snapshot.state === 'starting' ? <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => invoke('cancel')}>Annulla operazione</button> : null}
            {snapshot.result ? <article className={styles.result} data-testid="synthesis-result">
                <h3>Proposta da revisionare</h3><p>{snapshot.result.summary}</p>
                <h4>Spiegazione basata sulle fonti</h4><p>{snapshot.result.explanation}</p>
                <h4>Fonti citate</h4>
                {snapshot.result.citations.map((citation, index) => <blockquote key={`${citation.sourceId}-${index}`}>
                    <p>{citation.quote}</p><footer>Fonte {citation.sourceId}</footer>
                </blockquote>)}
                <p>Modello utilizzato: {snapshot.result.provenance.model} · effort: {snapshot.result.provenance.effort}.</p>
                <p>Solo proposta. Scritture cliniche: {snapshot.result.clinicalWrites}. Completare la DEMO non abilita l’uso clinico.</p>
            </article> : null}
            {!canConsent && snapshot.consentExpiresAt ? <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => invoke('logout')}>Scollega e ritira consenso</button> : null}
            <details className={styles.disclosure} data-testid="synthesis-receipt">
                <summary>Ricevuta di chiusura e limiti</summary>
                <div className={styles.detailBody}>
                    <dl><dt>Autorità locale ritirata</dt><dd>{String(snapshot.receipt.localAuthorityWithdrawn)}</dd>
                        <dt>Interruzione turno</dt><dd>{snapshot.receipt.interruption}</dd><dt>Uscita leader</dt><dd>{snapshot.receipt.leaderExit}</dd>
                        <dt>Cessazione gruppo posseduto</dt><dd>{snapshot.receipt.ownedGroupCessation}</dd><dt>Discendenti usciti dal gruppo</dt><dd>Non attestati da questa ricevuta</dd>
                        <dt>Cleanup</dt><dd>{snapshot.receipt.cleanup}</dd><dt>Logout remoto</dt><dd>{snapshot.receipt.remoteLogout}</dd></dl>
                    <p>La cancellazione locale non attesta revoca remota globale, cancellazione sicura dei supporti o rimborso quota.</p>
                </div>
            </details>
            <details className={styles.disclosure}>
                <summary>Dettagli tecnici della prova</summary>
                <div className={styles.detailBody}>
                    <p>Abbonamento personale ChatGPT · protocollo ufficiale Codex app-server. Il controllo account non autentica il processo della prova.</p>
                    <p>Postazione: {snapshot.qualification.platform}. {qualificationCopy[snapshot.qualification.state]}</p>
                    {snapshot.qualification.missing.length ? <div><h3>Prerequisiti da verificare</h3><ul>{snapshot.qualification.missing.map(item => <li key={item}><code className={styles.hash}>{item}</code></li>)}</ul></div> : null}
                    {snapshot.notice ? <p>Codice dell’esito: <code>{snapshot.notice}</code>.</p> : null}
                    <p>Autenticazione verificata: {snapshot.authenticatedProcess === 'dedicated_execution' ? (snapshot.state === 'completed' ? 'esecuzione dedicata, trasporto chiuso' : 'esecuzione dedicata') : 'nessuna'}. Piano osservato: {snapshot.plan ?? 'non disponibile'}.</p>
                    <p>Destinazioni autorizzate: auth.openai.com e chatgpt.com su TLS. Tier richiesto: priority. Nessun fallback.</p>
                    <p>Digest del corpus: <code className={styles.hash}>{snapshot.disclosure.inputSha256}</code></p>
                    <dl>{snapshot.disclosure.sources.map(source => <div className={styles.digest} key={source.id}><dt>Fonte {source.id} · SHA-256</dt><dd><code className={styles.hash}>{source.sha256}</code></dd></div>)}</dl>
                    {snapshot.result ? <>
                        <p>Tier richiesto: {snapshot.result.provenance.requestedServiceTier}; tier osservato: {snapshot.result.provenance.observedServiceTier ?? 'non osservato'}.</p>
                        <p>Output SHA-256: <code className={styles.hash}>{snapshot.result.provenance.outputSha256}</code></p>
                        <dl>{snapshot.result.citations.map((citation, index) => <div className={styles.digest} key={`${citation.sourceId}-${index}`}><dt>Citazione {index + 1} · fonte {citation.sourceId}</dt><dd><code className={styles.hash}>{citation.sourceSha256}</code></dd></div>)}</dl>
                    </> : null}
                </div>
            </details>
        </> : null}
    </section>;
}
export function ChatGptSynthesisPanel() {
    const { isAuthenticated, isLocked, authRecoveryState, user } = useSecurity();
    return <ChatGptSynthesisCard key={user?.id ?? 'no-user'} active={user !== null && isAuthenticated && !isLocked && authRecoveryState === 'ready'} />;
}
