/* @Codex: presentation only; readiness strings never grant installation or activation. */
export function whoSetupGuideStatus(status?: string): string {
    switch (status) {
        case 'loading': return 'Lettura dello stato WHO…';
        case 'error': return 'Lettura dello stato WHO non riuscita. Riprova con Rileggi stato WHO.';
        case 'available': return 'Lo stato applicativo riporta una risposta diretta osservata. Esegui una nuova verifica per controllare il servizio adesso.';
        case 'configured': return 'Configurazione WHO caricata. Questo stato, da solo, non conferma una risposta del servizio: esegui la verifica.';
        case 'unavailable': return 'WHO risulta non disponibile nello stato letto. Rileggi lo stato o apri il passaggio Recupera.';
        case 'disabled': return 'WHO non è abilitato nel processo MediFlow corrente. La guida non modifica il processo.';
        case 'configuration_required': return 'La configurazione locale non è completa. Riprendi i controlli sul Mac; non inserire digest o prove inventati.';
        case 'credentials_absent': return 'Mancano prerequisiti della modalità WHO configurata. Verifica la modalità con il gestore: questa guida non raccoglie credenziali.';
        case 'offline': return 'La modalità WHO configurata risulta offline. La guida non abilita servizi o fallback di rete.';
        default: return 'Stato WHO non disponibile o non riconosciuto. Rileggi lo stato prima di trarre conclusioni.';
    }
}
