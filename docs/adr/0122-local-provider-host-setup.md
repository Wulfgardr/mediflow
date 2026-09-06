# ADR 0122: ammissione esplicita del provider dal processo host

Data: 2026-09-06. Stato: accettato per il candidato locale 0.8.6.
Ambito: WUL-674. Integra ADR 0095 senza concedere controllo alle route consumer.

Il lifecycle durevole è obbligatorio per i servizi clinici, ma il tree non
offriva un comando operativo di ammissione. Il controllo connessione della UI
legge i modelli; non è un'autorizzazione al lifecycle.

Il comando host `setup:local-provider` usa una directory dati assoluta scelta
dall'operatore e apre il database esistente in sola lettura. Riusa il resolver
del binding clinico, legge esclusivamente le cinque impostazioni pertinenti e
verifica Ollama mediante l'attestazione locale già usata dalle capability.
Non accetta modello, endpoint, onboarding o receipt come argomenti. L’attestazione può caricare in RAM il modello già installato, senza prompt.
Non crea database, non scarica modelli, non genera testo e non cambia kill switch.

`inspect` non scrive. `admit`, `recover` e `revoke` richiedono conferma esplicita
da riga di comando. Ammissione e recupero richiedono una nuova attestazione
locale, ricontrollano il binding e applicano il CAS del lifecycle. Un record
corrotto o revocato non viene riparato, sostituito o riammesso. La revoca resta
terminale; il comando non offre una cancellazione del record.

La scrittura produce `available_unqualified`, non readiness clinica o prova
di inferenza. Le capability continuano a verificare sessione, selection,
policy, binding e disponibilità per ciascuna operazione. La UI può spiegare il
comando ma non importarne o invocarne il controllo. ATHENA resta sul proprio
percorso e non riceve ammissione per analogia con Ollama.

Verifica: fixture SQLite con sole impostazioni, denial senza rete/scritture,
attestazione fallita, binding mutato, CAS concorrente, ripetizione idempotente,
recupero e revoca terminale; boundary test contro import da UI/route.
