/* @Codex: presentation only; readiness strings never grant installation or activation. */
export function whoSetupGuideStatus(status?: string): string {
    switch (status) {
        case 'loading': return 'Lettura dello stato WHO…';
        case 'error': return 'Lettura dello stato WHO non riuscita. Riprova con Rileggi stato WHO.';
        case 'available': return 'Lo stato applicativo riporta una risposta diretta osservata. Esegui una nuova verifica per controllare il servizio adesso.';
        case 'configured': return 'Configurazione WHO caricata. Questo stato, da solo, non conferma una risposta del servizio: esegui la verifica.';
        case 'unavailable': return 'WHO risulta non disponibile nello stato letto. Rileggi lo stato o apri il passaggio Recupera.';
        case 'disabled': return 'WHO non è abilitato nel processo MediFlow corrente. La guida non modifica il processo.';
        case 'configuration_required': return 'La configurazione locale non è completa. Riprendi i controlli sul computer host; non inserire digest o prove inventati.';
        case 'downloading': return 'Download dichiarato in corso dalla procedura host. Non conferma che il catalogo sia pronto o che WHO risponda.';
        case 'qualifying': return 'Qualifica dichiarata in corso dalla procedura host: servono inventario, riavvio offline e ripristino. Non è disponibilità applicativa.';
        case 'missing_prerequisites': return 'Mancano prerequisiti del computer host. Segui le istruzioni locali e ripeti la procedura; nessun servizio viene installato dalla guida.';
        case 'image_evidence_missing': return 'Il target compare nell’indice, ma mancano evidenze dell’immagine. Download e attivazione restano bloccati; non inserire prove inventate.';
        case 'credentials_absent': return 'Mancano prerequisiti della modalità WHO configurata. Verifica la modalità con il gestore: questa guida non raccoglie credenziali.';
        case 'offline': return 'La modalità WHO configurata risulta offline. La guida non abilita servizi o fallback di rete.';
        default: return 'Stato WHO non disponibile o non riconosciuto. Rileggi lo stato prima di trarre conclusioni.';
    }
}
