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


## Compatibilità locale Ollama 0.40.5 — WUL-694, 16 ottobre 2026

La versione 0.40.5 è ammessa puntualmente, conservando le versioni precedenti.
Per la linea 0.40, le versioni vicine non esaminate, le anteprime e i suffissi
build restano negate.
La [release ufficiale](https://github.com/ollama/ollama/releases/tag/v0.40.5)
e il [delta da 0.40.4](https://github.com/ollama/ollama/compare/v0.40.4...v0.40.5)
introducono aggiornamenti dei motori e cambiamenti dei percorsi cloud e
OpenAI-compatible. Il delta non modifica i tipi API usati dall'attestor né
i relativi handler locali; ciò non prova da solo il funzionamento del modello.

Sul Mac, client e daemon installati dichiarano entrambi 0.40.5. Il binario
osservato ha SHA-256 `3501c7c3d9885269fb5b3d141a0a3789e868f6ad15150d4a07b195965be33a5d`
e firma Developer ID valida di Infra Technologies, Inc. Con il modello già
installato `qwen3.5:35b-a3b`, la verifica reale di versione, tags, show,
precaricamento senza prompt e processi caricati ha osservato il medesimo digest
`3460ffeede5453ead027dbd2f821b12ad0aa3de54630971993babdb2165221f7`
e assenza dei marker remoti previsti dal contratto. Non sono stati scaricati modelli.

Restano obbligatori endpoint loopback, riferimento non cloud, località delle
risposte, digest del modello caricato e controlli per operazione. I test coprono
anche marker remoti nei diversi stadi e digest discordante. Questa ammissione
non cambia `available_unqualified` o `observed_not_causal` di
[ADR 0092](./0092-limite-digest-bound-readiness-ai-locale.md), non attribuisce
una garanzia causale al digest e non attesta UI, qualità o ammissione clinica.


La build sorgente `c3ee6f5f10e83664994e98c02ec25b532df84670` ha prodotto,
via HTTP e su un archivio cifrato interamente inventato, proposte valide di
Smart Import e Document Synthesis. Quest'ultima ha attraversato caricamento
cifrato, capture, estrazione locale AnyDoc da PDF testo e preview. Patient
Insight ha rifiutato la prima risposta con `proposal_invalid`; un replay
diagnostico dello stesso prompt e un secondo tentativo HTTP sono riusciti.
Il primo errore non è stato riprodotto e la causa non è stabilita: il successo
successivo non lo risolve. Tutte le proposte osservate conservano zero
scritture e applicazione negata o assente; non sono prove di UI o qualità clinica.

L'attivazione Web a freddo ha rispettato il limite host di 30 secondi e ha
restituito `verification_interrupted` (finestra del client circa 31,2 secondi).
Un precaricamento tecnico esplicito successivo ha richiesto circa 22,3 secondi;
la nuova attivazione completa a caldo circa 2,6 secondi. Le finestre includono
avvio del client e trasporto: non misurano il solo motore. Il precaricamento
manuale non costituisce un percorso utente a freddo riuscito. La pagina offre
rilettura dello stato e nuova conferma, senza retry automatico; il limite
host e tutti i controlli di autorità restano invariati.
