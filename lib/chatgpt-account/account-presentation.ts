/* @Codex: presentation of ADR0126/0134 only, never an admission decision. */
import type { AccountBrowserView } from './account-browser';
import type { AccountNotice, AccountState } from './account-contract';

const accountLabels: Record<AccountState, string> = {
    unavailable: 'Da configurare', disconnected: 'Non collegato', starting: 'Avvio accesso',
    awaiting_login: 'Accesso in attesa', verifying: 'Da verificare', connected: 'Account collegato',
    error: 'Collegamento interrotto',
};
const planLabels: Readonly<Record<string, string>> = {
    free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business',
    enterprise: 'Enterprise', edu: 'Edu', unknown: 'Non disponibile',
};
export const accountNotices: Record<Exclude<AccountNotice, null>, string> = {
    host_unavailable: 'Il collegamento richiede la configurazione del computer che ospita MediFlow.',
    timeout: 'Il controllo ha impiegato troppo tempo. Rileggi lo stato prima di riprovare.',
    protocol_error: 'Il servizio account ha restituito una risposta inattesa. Rileggi lo stato.',
    process_exited: 'Il servizio account si è arrestato. Collega di nuovo ChatGPT.',
    login_failed: 'Accesso non completato. Puoi avviare un nuovo accesso.',
    login_expired: 'Il tempo per accedere è scaduto. Avvia un nuovo accesso.',
    canceled: 'Accesso annullato.',
    logout_unconfirmed: 'Account scollegato da MediFlow. Il servizio non ha confermato il logout remoto.',
    busy: 'È in corso un’altra operazione account. Rileggi lo stato.',
    session_expired: 'La sessione non è più disponibile. Sblocca MediFlow e rileggi lo stato.',
    invalid_state: 'Lo stato dell’account è cambiato. Rileggi prima di riprovare.',
};
export function presentAccount(view: AccountBrowserView, active: boolean) {
    const locked = !active || view.kind === 'locked';
    const operation = view.busy === 'login/start' ? 'Avvio accesso…'
        : view.busy === 'login/cancel' ? 'Annullamento…'
        : view.busy === 'login/complete' ? 'Verifica in corso…'
        : view.busy === 'logout' ? 'Scollegamento…' : null;
    return {
        locked,
        accountLabel: locked ? 'Sessione bloccata' : operation ?? (view.error ? 'Stato da rileggere'
            : view.status ? accountLabels[view.status.state]
            : view.kind === 'error' ? 'Stato non disponibile' : 'Lettura dello stato…'),
        operation,
        planLabel: !locked && !view.error && view.status?.state === 'connected'
            ? planLabels[view.status.plan ?? 'unknown'] ?? 'Non disponibile' : null,
        // @Codex WUL-684: this card is informational, not the ordinary execution
        // session or an admission decision. Account/plan/demo never grant use.
        executionLabel: 'Account informativo · non abilita le funzioni',
        showDetails: !locked && view.status?.state === 'connected',
        // A failed read requires an explicit gesture. Polling must not hide it.
        pollDelay: !locked && !view.error && !view.busy && view.status
            ? view.status.state === 'connected' ? 10_000
                : ['starting', 'awaiting_login', 'verifying'].includes(view.status.state) ? 2000 : null
            : null,
    } as const;
}
