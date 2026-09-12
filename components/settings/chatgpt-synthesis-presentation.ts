/* @Codex — pure display copy, never an admission or action policy. */
import type { ProductCode, ProductOperation, ProductSnapshot, ProductState, QualificationSnapshot } from '../../lib/chatgpt-product/product-contract';

type StatusCopy = Readonly<{ title: string; next: string }>;
const stateCopy: Record<ProductState, StatusCopy> = {
    preparing: { title: 'Preparazione della postazione', next: 'Verifiche locali in corso. Puoi annullare; nessun accesso OpenAI è avviato.' },
    held: { title: 'Prova sospesa', next: 'Controlla la configurazione della postazione prima di riprovare.' },
    needs_consent: { title: 'In attesa del tuo consenso', next: 'Leggi le fonti demo, poi autorizza la prova.' },
    consented: { title: 'Consenso acquisito', next: 'Avvia l’accesso dedicato a questa prova.' },
    starting: { title: 'Avvio dell’accesso', next: 'Attendi il collegamento ufficiale OpenAI oppure annulla.' },
    awaiting_login: { title: 'In attesa dell’accesso OpenAI', next: 'Completa l’accesso dal link qui sotto, poi premi Verifica accesso.' },
    verifying: { title: 'Accesso da verificare', next: 'Premi Verifica accesso per completare il collegamento della prova.' },
    connected: { title: 'Accesso alla prova verificato', next: 'Leggi i modelli disponibili prima di scegliere.' },
    ready: { title: 'Modelli disponibili', next: 'Scegli modello e livello di ragionamento, poi genera.' },
    generating: { title: 'Sintesi in corso', next: 'Puoi annullare l’operazione. Nessuna scrittura clinica.' },
    completed: { title: 'Sintesi da revisionare', next: 'Confronta la proposta con le fonti citate. L’uso clinico resta sospeso.' },
    canceled: { title: 'Prova annullata', next: 'Per ripartire servono un nuovo consenso e un nuovo accesso.' },
    error: { title: 'Prova interrotta', next: 'Leggi il messaggio qui sotto, poi rileggi lo stato prima di riprovare.' },
};
const busyCopy: Record<Exclude<ProductOperation, 'status'>, string> = {
    prepare: 'Preparazione della postazione…',
    consent: 'Acquisizione del consenso…',
    'login/start': 'Avvio dell’accesso…',
    'login/complete': 'Verifica dell’accesso…',
    'login/cancel': 'Annullamento dell’accesso…',
    read: 'Lettura di account e quota…',
    models: 'Lettura dei modelli…',
    generate: 'Sintesi in corso',
    cancel: 'Annullamento della prova…',
    logout: 'Scollegamento della prova…',
};
export function presentSynthesisStatus(snapshot: ProductSnapshot | null, busy: ProductOperation | null): StatusCopy {
    if (busy && busy !== 'status') return { title: busyCopy[busy], next: 'Attendi l’esito. Nessun nuovo tentativo automatico.' };
    return snapshot ? stateCopy[snapshot.state] : { title: 'Stato non disponibile', next: 'Rileggi lo stato locale per verificare la disponibilità della prova.' };
}
export const qualificationCopy: Record<QualificationSnapshot['state'], string> = {
    unqualified: 'Verifiche della postazione incomplete.',
    unsupported: 'Questa postazione non supporta la prova.',
    qualified: 'Verifiche tecniche completate per questa versione. L’uso clinico resta sospeso.',
};
const noticeCopy: Record<ProductCode, string> = {
    unqualified_boundary: 'La postazione non è pronta per la prova. Controlla la configurazione.',
    session_expired: 'La sessione della prova è scaduta. Rileggi lo stato e autorizza nuovamente.',
    not_connected: 'L’accesso dedicato alla prova non è collegato. Rileggi lo stato prima di riprovare.',
    unsupported_account: 'Questo account non è supportato per la prova.',
    busy: 'Un’operazione è già in corso. Attendi l’esito oppure annulla.',
    canceled: 'L’operazione è stata annullata. Nessun riavvio automatico.',
    revoked: 'L’autorizzazione è stata ritirata. Per ripartire occorre un nuovo consenso.',
    quota_exhausted: 'Quota esaurita. La prova non può proseguire; nessun modello alternativo automatico.',
    limits_unavailable: 'Quota non verificabile. La generazione resta bloccata.',
    catalog_stale: 'I modelli disponibili sono cambiati. Rileggi lo stato: servono nuovo consenso e nuova scelta.',
    model_unavailable: 'Il modello scelto non è disponibile. Rileggi lo stato prima di riprovare.',
    model_mismatch: 'Il modello restituito non corrisponde alla scelta. Il risultato non viene accettato.',
    invalid_request: 'La richiesta non è stata accettata. Rileggi lo stato prima di riprovare.',
    invalid_output: 'La risposta non rispetta i requisiti della prova e non viene mostrata.',
    tool_use_denied: 'Il servizio ha richiesto un’azione non consentita. La prova è stata fermata.',
    timeout: 'Tempo di attesa scaduto. Rileggi lo stato prima di riprovare.',
    process_exited: 'Il processo della prova si è chiuso. Rileggi lo stato prima di riprovare.',
    protocol_error: 'Comunicazione con il servizio non valida. Rileggi lo stato prima di riprovare.',
    upstream_error: 'Il servizio ha restituito un errore. Rileggi lo stato prima di riprovare.',
    consent_required: 'È necessario autorizzare questa prova prima di procedere.',
    consent_stale: 'Il consenso non è più valido. Rileggi lo stato e autorizza nuovamente.',
    invalid_state: 'L’operazione non è disponibile nello stato attuale. Rileggi lo stato.',
    login_pending: 'Completa prima l’accesso ufficiale, poi premi Verifica accesso.',
    login_failed: 'Accesso non riuscito. Rileggi lo stato prima di un nuovo tentativo.',
    login_expired: 'Il link di accesso è scaduto. Rileggi lo stato e autorizza una nuova prova.',
    logout_unconfirmed: 'Lo scollegamento remoto non è confermato. Non considerare revocati gli altri accessi OpenAI.',
    unauthorized: 'Accesso a MediFlow non valido. Sblocca nuovamente la sessione.',
    forbidden: 'Questa operazione non è autorizzata. Rileggi lo stato.',
    method_not_allowed: 'Operazione non supportata. Rileggi lo stato.',
};
export function presentSynthesisNotice(code: ProductCode): string {
    // The browser accepts bounded server notice strings: an unknown future code
    // must still produce a visible warning, not an empty message or readiness.
    return Object.hasOwn(noticeCopy, code) ? noticeCopy[code] : 'La prova richiede attenzione. Rileggi lo stato; il codice è nei dettagli tecnici.';
}
