# ADR 0136: verifica e attivazione locale esplicita dalla Web UI

Data: 2026-09-08. Stato: accettato per implementazione candidata locale.
Issue: WUL-674, WUL-691. Base: `493a6123a`.

## Decisione

Estende il confine CLI-only di [ADR 0122](./0122-local-provider-host-setup.md)
con il servizio host nominato `LocalProviderOnboarding`. La route Web dedicata
è un adapter autenticato di quel servizio; non importa script, shell o control.
I consumer clinici di ADR 0095 restano read-only rispetto al lifecycle.

L'operatore con sessione Web canonica attiva può autorizzare il collegamento
Ollama locale premendo «Verifica e attiva locale». Non occorre una qualifica
clinica dichiarata dal caller; il comando non concede una capability clinica.
Non è esposto a token locali, native, MCP o AIP. Nessun grant host aggiuntivo
è inventato: l'owner Web esistente governa la sessione e la sua revoca.

GET legge stato e revisione senza rete o ammissione. POST accetta soltanto
l'intento fisso `verify_and_activate` e la revisione opaca vista dall'utente.
Richiede origine same-origin, JSON bounded e timeout. Non accetta percorsi,
endpoint, modelli, provider, env, command, onboarding o receipt. Il servizio
risolve la directory dati host e legge solo le impostazioni del binding locale
salvato, con porta allowlisted 11434; impostazioni mancanti non attivano un modello di default.

L'attestor Ollama esistente verifica loopback, versione supportata, modello
installato, assenza di riferimenti remoti e digest del modello caricato. Può
precaricare il modello in RAM senza prompt; non scarica né genera testo.
Timeout e revoca negano il completamento tardivo.

Prima e dopo l'attestazione si autentica la stessa sessione. Un resource port
canonico tiene l'operazione legata all'owner. Il tratto finale è sincrono:
transazione SQLite IMMEDIATE per rileggere il binding, controllo della revisione
lifecycle e della revoca, commit del resource use ancora attivo, quindi CAS
atomico dello store lifecycle. Nessun await o callback esterno interviene tra
questo ultimo controllo e la scrittura. La revoca provider concorrente è
serializzata dal lock/CAS dello store; il lock Web successivo non annulla
retroattivamente un comando già autorizzato e concluso. Un owner indisponibile
o bloccato nega; nessun canale alternativo.

Il record resta `local_model`, `available_unqualified`, con receipt e versione
host. Il recupero da `degraded` richiede lo stesso gesto e nuova attestazione;
`revoked` è terminale e non viene riparato o cancellato. Corruzione, conflitto,
rete indisponibile e modello assente hanno esiti espliciti. La UI rilegge stato
e funzioni dopo il successo. Dopo un salvataggio riuscito della configurazione,
il pannello rilegge automaticamente lo stato senza avviare l’attivazione.
Una versione Ollama non ammessa produce `provider_version_unsupported` con
HTTP 409, versione rilevata e versioni ammesse. La UI indica di aggiornare
MediFlow o installare una versione ammessa. Il servizio irraggiungibile e
quello raggiungibile ma non pronto restano distinti, entrambi con HTTP 503.
La 0.9.0 ammette puntualmente anche la release osservata 0.40.4, mantenendo
la linea 0.32.x e le release 0.33.3 e 0.34.2.
Nessun kill switch, preferenza o fallback cambia.

## Attesa del caricamento a freddo — WUL-694, 16 ottobre 2026

Una prova sul candidato di compatibilità Ollama della PR #548 ha negato
l'attivazione al limite di 30 secondi; un successivo precaricamento esplicito
e la verifica a caldo sono riusciti.
Il solo aumento dell'attesa della pagina non potrebbe evitare quel diniego.
Il budget locale dell'intera verifica passa a 60 secondi; quello della pagina
a 70 secondi. La lettura conserva 10 secondi e il corpo HTTP 5 secondi.
La pagina comunica il nuovo limite e resta annullabile, senza polling o retry.

Il budget comprende attestazione, riautenticazione finale e commit; non è
la durata di una sessione o di un grant. Non cambia le scadenze dell'owner,
i suoi resource-use, lock o revoche. Il commit richiede ancora la medesima
sessione attiva, il resource-use corrente e la stessa revisione del binding e
del lifecycle. La scadenza monotona è verificata anche se il callback del timer
è ritardato. Un risultato dopo 60 secondi o dopo cancellazione non ammette il
provider. Non vengono omessi controlli di versione, località o digest.

La prova reale riguarda il candidato integrato `68d5e688985b`, comprensivo
del supporto Ollama 0.40.5 proposto nella PR #548; non attesta il runtime della
modifica isolata su main e non cambia qui le versioni ammesse. Quel candidato
ha completato l'attivazione HTTP a freddo con `qwen3.5:35b-a3b`:
nessun modello inizialmente caricato,
una sola conferma attraverso il workflow della pagina, senza precaricamento
manuale o retry. Il percorso completo ha richiesto circa 30,3 secondi;
la verifica del server circa 27. Lo stato finale è `available_unqualified`,
con digest invariato. Questa prova non esercita l'intervallo aggiunto oltre
30 secondi, coperto dai test a 55 e 60 secondi. Non include UI renderizzata
o generazione di testo. Il modello caricato dalla prova è stato rilasciato.

## Limiti e alternative

La receipt lifecycle attesta la transizione, non generazione riuscita,
qualificazione clinica o sicurezza assoluta del processo Ollama. I controlli
per operazione dei consumer rimangono obbligatori. La CLI resta indipendente.

Scartati: shell dal Web, ammissione al caricamento pagina, scelta libera del
target nel POST, riattivazione automatica di revocati. Se l'owner canonico non
consente il tratto finale richiesto, mantenere CLI-only e proporre un comando
host con grant specifico; non sostituire l'owner con un booleano client.

## Verifica candidata

Fixture sintetiche per servizio, route e componente montato: prima attivazione,
idempotenza, recupero, modello assente, errore rete, binding/versione cambiati,
owner bloccato e revoca. Lint e typecheck; nessuna build o inferenza live richiesta.
La promozione resta soggetta alla verifica del parent sul tree integrato.
