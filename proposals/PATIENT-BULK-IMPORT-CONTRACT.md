# Importazione manuale CSV — destinazione fissata all'anteprima

**Stato: PROPOSED.** RUN_ID `fb6c297f52bc4e319eb5ba41dac27a3d`, follow-up 1.
Scritto prima del codice sostitutivo. Non è un ADR Accepted, un merge o una qualifica.
Base: i 114 source dello ZIP originale (SHA-256
`7bd41999208894dfdb501e346719e3929922a3147ba5472153610f2a707b1b85`)
più i sette source supplementari read-only. I postimages precedenti non sono preimage.

## Decisione e confine

La pagina acquisisce prima della preview un contesto autenticato e mostra il nome
esatto dell'ambulatorio A. Il consenso è legato alla revisione della preview e a
quel contesto. Il server salva solo in A o nega. Un cookie successivo B non può
sostituire A. Il browser non conferisce autorizzazione. La sessione Web proviene da
`requireSession`; l'owner fisico 0.8.7 verifica l'identità opaca della generazione.
Non basta che il nuovo accesso appartenga allo stesso utente.

Nessuna modifica a `/api/context`, caller di selezione, default, owner/adapter,
schema/migrazioni, GET pazienti, update/delete, native/CLI/Mini o altre lane.
Nessun ordine globale cross-tab: il cambio osservato dalla propria UI ritira
preview e continuazioni e ferma le righe future. Un commit concluso non viene
annullato da una revoca successiva, né da AbortSignal.

## Rappresentazione minima e durata

`GET /api/patients/create-context` richiede una sessione Web valida. Risolve una
sola volta cookie/default con la policy attuale, verifica che il target esista,
poi restituisce `{version:1, nonce, ambulatoryId, ambulatoryName, expiresAt}`.
La risposta è no-store. Nessun dato paziente è inviato a questo endpoint.
Il nonce casuale di 256 bit è una precondizione, non una credenziale: senza la
sessione autenticata della stessa generazione è inutilizzabile. Non include e non
serializza session ID, cookie auth, chiavi o authenticationGeneration.

Un registro consumer in RAM conserva solo nonce, target, scadenza, riferimento
opaco alla generazione, principal e port dell'owner. TTL 5 minuti non rinnovabile;
capienza globale 128, per generazione 8; pieno significa diniego, non eviction di
preview altrui. Pruning lazy su acquisizione/uso, nessun cron. La risorsa privata
registrata nell'owner elimina il contesto alla revoca. Cleanup lazy di un contesto
scaduto rilascia registration e port; nessuna chiamata reentrante all'owner dal
suo disposer. Non si persistono token e non sopravvivono al riavvio del processo.
Replica/processo diverso: nonce non trovato significa diniego, mai fallback.

Ogni add fenced usa tre header: `X-MediFlow-Patient-Create-Mode: fixed-preview-v1`,
`X-MediFlow-Patient-Create-Context: <nonce>`,
`X-MediFlow-Patient-Create-Target: <ambulatoryId>`.
Il body rimane quello cifrato dal client esistente. Presenza di un solo header,
valori malformati, nonce mancante/scaduto o target discordante negano la lane.
Solo assenza di tutti e tre seleziona il percorso legacy. Il client fenced non
ritenta senza precondizione e rifiuta un'opzione presente ma invalida.

## Transazione e generazione fino al commit

Il registro confronta il binding della sessione autenticata della richiesta con
quello originario per identità (`===`), senza convertirlo in stringa. Dentro una
transazione SQLite SINCRONA il consumer apre l'use originario e chiama
`withCurrentResourceBinding`: il callback verifica nuovamente TTL/binding e
inserisce paziente e membership nello stesso target, che deve ancora esistere.
Il callback non esegue await e NON committa il DB.

Il valore finale di `withCurrentResourceBinding` e poi `commitResourceUse` sono
verificati ancora DENTRO la transazione. Qualunque rifiuto fa lanciare un errore
prima che la transazione ritorni: SQLite esegue rollback di entrambe le tabelle.
Anche il controllo TTL finale deve precedere il ritorno. Non si confonde il commit
dell'use con il COMMIT SQL. Audit asincrono solo dopo la transazione conclusa.
Una seam sincrona per le operazioni DB rende verificabile il rollback usando SQL
reale; nessun fault switch o owner alternativo è esposto al percorso HTTP.

## Compatibilità e UI

`db.patients.add` accetta un'opzione tipizzata create-context riservata ai pazienti.
Controlla segnale, chiave e contesto prima e dopo la cifratura asincrona e sulle
continuazioni. Indirizzo/telefono continuano a usare AES-GCM/ENC originari;
campi facoltativi vuoti restano assenti dal body. Le altre tabelle e il legacy add
senza opzione mantengono il comportamento originario. Nessun fetch diretto di
valori paziente dalla UI.

Acquisire il contesto, leggere e preparare la preview non crea pazienti. Nessuna
scrittura viene avviata da effect/mount/subscribe. Lifecycle del controller:
istanza stabile nello scope montato, subscription esterna con snapshot stabile,
cleanup idempotente, nessun setState per copiare stato derivato in effect. Il
modello usa un link data costante (solo intestazione pubblica): nessun object URL
da creare/revocare in effect. Remount dopo cambio auth/contesto non riprende job.

## CSV, dedupe, esiti

UTF-8 rigoroso/BOM, separatore `;`, sei header ordinati
`nome;cognome;codice_fiscale;data_nascita;indirizzo;telefono`.
Massimi invariati: 2 MiB, 500 record, 4096 unità UTF-16 per record sorgente,
1024 per cella. Il terminatore esterno EOF/LF/CRLF non fa parte del record;
newline e CRLF DENTRO quote contano rispettivamente una e due unità.
Errori strutturali negano il file; errori semantici restano locali alla riga.
Nome/cognome conservati, CF ASCII verificato prima dell'uppercase, date reali
ISO, nessuna inferenza o esecuzione di formule/markup.

Dedupe nel file e nell'elenco accessibile, non globale/atomico. L'elenco viene
riletto prima del consenso applicato: nuove esclusioni richiedono nuova revisione.
Il consenso scaduto non può rigenerare da solo una precondizione. Creazioni
sequenziali con UUID per tentativo; doppio click non duplica il ciclo. Stop al
primo errore. Annulla ferma la coda, non effettua rollback dei commit precedenti.
Esiti: escluse, non inviate, in corso, confermate dopo readback, sconosciute quando
non verificabili. Nessun retry/upsert/exactly-once. Riconciliazione manuale solo
in lettura: assenza del record non prova rollback di una richiesta incerta.

Receipt RAM bounded con UUID/stati/posizioni/operator/target, mai anagrafiche,
nonce o generazione; il reload completo lo perde. PrivacyBlur preservato.
Niente nuovo local/sessionStorage, log di valori, account o traffico esterno.

## Evidenze e promozione

Nuovi test: owner fisico, SQL sintetico con rollback dopo callback, nuova
generazione stesso utente, TTL/capienza/disposal, target A contro cookie B,
header invalidi senza fallback, legacy e cifratura, scanner confini, controller,
React/browser lifecycle. Doubles HTTP/UI dichiarati, non prove di autenticazione.
Il test di diniego finale provoca una chiamata reentrante all'owner SOLO nella
seam DB del test dopo gli INSERT; l'owner immutato può così negare alla fine.

Qualificazione: Node24 reale, runner originale, dipendenze pinnate, dati sintetici;
typecheck completo incremental=false e lint interessati. Se non disponibili:
NOT_RUN preciso. Eventuali test nativi su Node22 sono supplementari, non
qualificazione canonica e senza usare un TypeScript globale sostitutivo.
E2E reale soltanto su build congiunta isolata parent, non sul runtime esistente.
Le prove precedenti (85 PASS) rimangono storiche. Parent decide la promozione.
