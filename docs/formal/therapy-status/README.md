# Cambio di stato della terapia: modello legacy e prove del comando durevole

Il TLC in questa directory conserva il modello ADR0156 del percorso PUT legacy,
ora raggiunto dalla UI soltanto per recuperare marker precedenti. Il consumer
ordinario di TherapyManager usa invece ADR0168 e il controller durevole:
`verify:therapy-status` esegue anche i suoi test causali e le gare/crash SQLite.
Il test di composizione controlla il consumer reale e impedisce di ripristinare
implicitamente una PUT dal nuovo controller. Le proprietà del nuovo ledger non
sono una prova TLA né un'estensione implicita degli invarianti legacy sottostanti.

Il recovery cifrato supporta lo schema corrente 11 ed i predecessori canonici 3, 4, 5, 6, 9 e 10; le prove di compatibilità sono esterne a TLC, che non copre schema, migrazione, cifratura o ricevute. Restano aperte la verifica verticale Rust-host e quella della GUI.

## Raccordo del 9 novembre 2026: backup della 0.9.0 pubblicata

Lo schema 3, scritto dalla 0.9.0, entra fra i predecessori ammessi da
`lib/recovery-backup-server.ts`. La ricostruzione in
`lib/ambulatory-destructive-command-recovery-schema.ts` toglie, oltre a quanto
già tolto per il 4, le fonti e i documenti del catalogo protesico e le due
colonne nate dopo la 0.9.0; come il 4, lo schema 3 non ha il ledger dei comandi
terapia. La nuova impronta è confrontata con un archivio prodotto dal codice del
tag `v0.9.0`, senza differenze di forma; le impronte 4, 5, 6, 9 e 10 restano
invariate. Il test sul predecessore 3 fallisce con
`RECOVERY_BACKUP_PREFLIGHT_FAILED` prima della modifica e poi ripristina account,
pazienti, diario e audit; un ledger terapia o una fonte protesica dentro un
archivio dichiarato 3 restano respinti.

Le transizioni delle terapie, le autorità di commit, i comandi e le ricevute
non cambiano: il ripristino conserva il ledger della destinazione come per il
predecessore 4. Modello, statechart, invarianti, testimoni e mutanti restano
invariati. I digest dei due file sono aggiornati dopo le prove sui predecessori
e sul recupero cifrato; `syncCommit` indica il commit di implementazione
09642085a e il gate completo riesegue TLC.

## Raccordo autore del diario del 7 novembre 2026 (ADR 0183)

Lo schema passa da 9 a 10 aggiungendo `entries.recorded_by` nullable soltanto
nel passaggio versionato. Le voci esistenti restano senza autore. La
ricostruzione dei predecessori 4, 5 e 6 rimuove anche questa colonna prima
del confronto: le tre impronte canoniche restano immutate. Le fixture di
migrazione e di recupero cifrato ricostruiscono gli stessi schemi storici.
I test aggiungono il rifiuto di `recorded_by` su ciascun predecessore,
lo schema nuovo, la migrazione v9, il rollback dopo il DDL v10 ed il retry. Il
recupero cifrato conserva anche l'ammissione del precedente schema 9. La sua
nuova impronta è verificata sul codice della base `93ed225c8`, senza riscrivere
le tre impronte storiche. Una controprova fallisce con
`RECOVERY_BACKUP_PREFLIGHT_FAILED` prima dell'aggiunta, poi ripristina il v9
cifrato preservando account e ledger. Anche il punto di ammissione del recovery
entra fra i file con digest, senza estendere le proprietà di TLC.

`lib/db.ts` aggiunge soltanto il campo facoltativo di lettura a ClinicalEntry.
Le transizioni delle terapie, le autorità di commit, i comandi e le ricevute
non cambiano. Modello, statechart, invarianti, testimoni e mutanti restano
invariati. I digest dei file modificati sono aggiornati dopo le prove
sullo schema, sui predecessori e sul recupero cifrato. `syncCommit` indica
il commit di implementazione d72bea412. Il gate completo riesegue anche TLC,
che non dimostra la correttezza della nuova attribuzione del diario: questa
è verificata dai test API, del componente e dello standalone Web.

## Raccordo dell'8 novembre 2026: conflitti di versione e import inutilizzati

`lib/therapy-write-operation.ts` costruisce la risposta 409 con il
costruttore generico di `lib/version-concurrency.ts`, che produce la stessa
istantanea (id, paziente, versione, aggiornamento, eliminazione) della copia
per le terapie, ora rimossa. `lib/db.ts` riconosce i conflitti di versione con
il solo controllo generico, che copre già paziente, voci e controlli.
`components/therapy-manager.tsx` perde un import di tipo inutilizzato.

Le transizioni delle terapie, le autorità di commit, i comandi e le ricevute
non cambiano. Modello, statechart, invarianti, testimoni e mutanti restano
invariati. I digest sono aggiornati dopo i test delle terapie, del client API
e delle scritture HTTP con conflitto; `syncCommit` indica il commit di
implementazione 1c582ba21 e il gate completo riesegue TLC.

## Raccordo dell'8 novembre 2026: tabelle di review durevole e SOAP headless

Lo schema corrente passa da 10 a 11 in `lib/sqlite-schema-open.ts`.
`lib/sqlite-schema.ts` non crea più le sette tabelle `durable_review_*` e
`headless_soap_*`, mai scritte dal prodotto, e le elimina nell'apertura
versionata di un archivio esistente, dopo la copia verificata dell'originale.
La ricostruzione dei predecessori in
`lib/ambulatory-destructive-command-recovery-schema.ts` le aggiunge con il
loro DDL storico, così le impronte 4, 5, 6 e 9 restano immutate; la 10 entra
fra i predecessori ammessi da `lib/recovery-backup-server.ts`.
`lib/backup-restore-executor.ts` perde le collezioni ritirate.

Le transizioni delle terapie, le autorità di commit, i comandi e le ricevute
non cambiano. Modello, statechart, invarianti, testimoni e mutanti restano
invariati. I digest dei file modificati sono aggiornati dopo le prove sullo
schema, sui predecessori e sul recupero cifrato; il gate completo riesegue TLC.

## Raccordo allergie strutturate del 7 novembre 2026 (ADR 0182)

Lo schema corrente passa da 8 a 9 in `lib/sqlite-schema-open.ts`.
L'inizializzatore corrente `lib/sqlite-schema.ts` aggiunge la colonna nullable
`patients.allergies`: nell'apertura versionata di un archivio esistente il DDL
segue la copia verificata dell'originale, nella stessa transazione dello stamp.
La riapertura della versione 9 valida lo schema senza eseguire DDL.
`lib/db.ts` aggiunge il tipo ed il campo facoltativo. Il registro
`lib/backup-encrypted-fields.json` include le allergie cifrate.

La ricostruzione in memoria dei predecessori canonici 4, 5 e 6 esclude anche
`allergies` in `lib/ambulatory-destructive-command-recovery-schema.ts`, come
esclude le colonne della versione 8. Le impronte storiche restano immutate.
Le prove coprono ammissione in sola lettura, rifiuto di una colonna allergie
su un predecessore, recupero cifrato, migrazione da v6 e v8, rollback del DDL
allergie e nuovo tentativo. Le fixture storiche non contengono la colonna v9.

Transizioni delle terapie, comandi, ricevute ed autorità di scrittura restano
invariati, insieme a modello, statechart, invarianti, testimoni e mutanti.
I digest sono ricalcolati sui file finali e `syncCommit` identifica il commit
con la correzione del controllo dei predecessori. Il gate completo resta
necessario: TLC non verifica schema, migrazione o cifratura.

## Raccordo PR #769 del 31 ottobre 2026: autorità network al commit

Riesaminato `lib/therapy-write-operation.ts` del runtime
`745118a84c9234b581278cb76c1234db9fb43812` rispetto alla sincronizzazione
`826a4df3fc0ec069c0eabb5fb77c93fe3aa69757`. Il nuovo parametro
`authorizeCommit` viene invocato prima di ogni lettura clinica, CAS e audit,
nel corpo sincrono della stessa transazione `IMMEDIATE`. La preparazione
asincrona del grant in `network-therapy-write.ts` resta fuori dalla transazione;
la rivalidazione effettiva di pairing, modalità, capability, sessione, archivio
e ambulatorio avviene dentro. Un rifiuto o un errore non scrive terapia o audit
di successo e non restituisce la ricevuta positiva di un duplicato.

La PUT Web legacy non passa `authorizeCommit`: `Host`, CAS, incremento e audit
mantengono il comportamento precedente. Gli altri writer rimangono astratti da
`OtherWriter`: la nuova guardia può impedire un incremento prima ammesso, senza
aggiungere stati, cambiare versione o separare CAS e audit. Un tentativo negato
senza effetti clinici è uno stuttering step per quell'astrazione; il rifiuto
di una richiesta host pendente è già ammesso da `HostReject`. La richiesta può
ancora committare dopo un abort client se l'autorità è corrente: non si assume
che l'abort annulli la transazione. Il consumer durevole e l'adapter paired
specializzato conservano le proprie guardie; non vengono convertiti nel
protocollo PUT legacy.

**Il modello non cambia.** Statechart, cinque invarianti, bound, sei testimoni
e tre mutanti restano identici. Identità e autorizzazione restano fuori da TLC;
la prova non viene estesa alla revoca paired. Il modello conserva un insieme
conservativo di possibili scritture esterne e non dichiara liveness. Le negazioni
network sono controllate dalla matrice causale con SQLite reale.

Prima di aggiornare il digest, TLC sul modello e configurazione originali ha
completato 28.149.669 stati generati, 5.903.794 distinti, profondità 36 e coda
vuota. Sono poi passati 266 test del codice, inclusa la matrice di revoca.
La fixture di `therapy-required-audit.test.ts` ora fornisce pairing e sessione
sintetici reali alla guardia e un secondo ambulatorio esistente per il caso
fuori scope: nessuna guardia è sostituita e le asserzioni 404 e assenza di effetti
restano attive. Solo dopo questi esiti sono aggiornati il digest del writer e
`syncCommit`; il gate completo riesegue modello, controlli negativi, testimoni
e test causali. `legacyModelSyncCommit` resta invariato.

## Raccordo PR #739 del 30 ottobre 2026: lettura degli allegati ENC2

Confrontati `lib/db.ts` e `lib/locked-field-guard.ts` di
`826a4df3fc0ec069c0eabb5fb77c93fe3aa69757` con il runtime sincronizzato
`91acfa2f5abfbdb1c0029a0b89dac708da0bcab8`: il diff coperto contiene soltanto
il riconoscimento di `ENC2:` e il ramo di apertura del file. Nessun writer,
controller, consumer TherapyManager, conferma, journal, CAS, ledger o audit
è modificato. Il resto di `ApiTable`, inclusi trasporto, letture e fence di
sessione, conserva il codice precedente.

L'await aggiunto è raggiungibile soltanto per `attachments.data`. Nei campi
delle altre tabelle un valore ENC2 viene conservato come ciphertext bloccato,
senza tentare l'apertura; senza chiave, le terapie tornano come prima, ma
entrambi i controller rifiutano anche il prefisso ENC2 nei tre campi letti
per confermare uno stato. La guardia condivisa estende quindi il rifiuto dei
valori illeggibili, non l'autorità di scrittura o una transizione. Le sei
regressioni `ENC2 in therapy … cannot authorize a status command` verificano
che nome farmaco, dose o stato così marcati non aprano una conferma né inviino
un comando: il legacy resta senza intento e il durevole pubblica `unavailable`.

Restano valide le assunzioni di contesto corrente, versione leggibile,
marker conservativo e atomicità host: non cambiano gli await della terapia,
l'ordine delle guardie, le gare o il recupero. Modello, statechart, invarianti,
limiti, testimoni e mutanti restano invariati. Cifratura e cancellazione della
memoria non sono proprietà di TLC: sono verificate separatamente dai test
dei codec, dei buffer e degli allegati grandi. Dopo questa verifica di
corrispondenza sono aggiornati solo i due digest e `syncCommit`; il comando
completo `npm run verify:therapy-status` riesegue TLC e i test causali, senza
ampliare esclusioni o attribuire al modello la prova della cifratura.

## Raccordo G-3 del 30 ottobre 2026: contratto dei campi cifrati

Riesaminato `91acfa2f5abfbdb1c0029a0b89dac708da0bcab8` rispetto a
`498658cbf`: fra le sorgenti coperte cambia soltanto `lib/db.ts`.
Il literal `ENCRYPTED_FIELDS` viene trasferito in
`lib/backup-encrypted-fields.json`, condiviso con il controllo delle chiavi
nel client Rust. Il confronto strutturale attesta identità di tutte le
collezioni, dei campi e del loro ordine; sottraendo import e dichiarazione,
il resto di `lib/db.ts` è identico byte per byte alla base.

Non cambiano letture, cifratura dei valori, HTTP, await, stato della terapia,
controller, conferma, CAS, ledger o audit. Le altre sorgenti coperte mantengono
le impronte precedenti. Sono aggiornati il solo digest di `lib/db.ts` e
`syncCommit`; il JSON condiviso entra nelle sorgenti fissate per impedire
future derive non riesaminate. Modello, invarianti, testimoni, mutanti e
limiti restano invariati. Backup e ricevute G-3 restano fuori dal modello
TLC e sono verificati dai rispettivi test di transazione, crash e trasporto.

## Raccordo C-6 Web del 2 novembre 2026: documento del nuovo paziente

Fra le sorgenti coperte cambia soltanto `lib/db.ts`: l'import da
`attachment-file-envelope` aggiunge tre funzioni già esistenti e il client
aggiunge `sealPatientDocumentSource` e `verifyPatientDocumentAttachment`,
chiamati esclusivamente dal pannello «Nuova scheda da documento». Il primo
usa la master key già sbloccata e il segnale di lettura della sessione per
cifrare nome, percorso e byte del documento, e azzera la chiave del file se
la sessione si blocca durante la cifratura; il secondo rilegge un allegato
con la `get` esistente e ne confronta i byte, o dichiara soltanto che si apre
come PDF quando l'originale non è più in memoria. Non inviano scritture, non
toccano terapie, chiave o segnale. Tutti i metodi preesistenti restano
identici alla base. Modello, statechart, invarianti, testimoni, mutanti e
limiti restano invariati; è aggiornato il solo digest di `lib/db.ts`.

## Raccordo WUL-757 del 29 ottobre 2026: copia locale della bozza

Riesaminato il runtime `e9e170e4790159ae1f4d10922f7508c4c128981c`
rispetto alla base `f52ac1e4bfc7c423a9a45da9860c337038615b21`.
Il solo file coperto modificato è `lib/db.ts`: aggiunge `sealLocalDraft` e
`openLocalDraft`, chiamati esclusivamente dalla copia locale dell'editor.
Acquisiscono il segnale di lettura della sessione, usano la master key già
sbloccata e ricontrollano il segnale dopo la cifratura o decifratura. Non
inviano HTTP, non scrivono tabelle e non modificano la chiave o il segnale.
Tutti i metodi preesistenti del client, inclusi letture, `setKey`, invii,
await e controlli di concorrenza, restano identici alla base.

Controller legacy e durevole, consumer TherapyManager, conferma, recupero,
CAS, ledger e audit host conservano i byte già coperti. Nessuna transizione,
guardia, atomicità, assunzione o posizione degli await del cambio stato
terapia cambia. Modello, statechart, invarianti, testimoni, mutanti e limiti
restano invariati. La copia cifrata della bozza e i lease del runtime sono
fuori dal modello TLC; li verificano i rispettivi test e il collaudo browser.
Dopo questo riesame sono aggiornati il solo digest di `lib/db.ts` e il
riferimento del runtime; il comando completo `verify:therapy-status` deve
verificare modello legacy e test causali senza ampliare la loro copertura.

## Raccordo WUL-757: attivazione esplicita del lease UI

Riesaminato `75393f7d8a3a86f9dc4aa85cd9489719a1c2a379` rispetto a
`e9e170e4790159ae1f4d10922f7508c4c128981c` e alla precedente head della PR
`fca91f9517bd1bfb214cd09940aab559ce7e47f6`. Fra i file coperti cambia solo
`lib/security/client-auth-api.ts`: il tipo `AuthHealthPayload` aggiunge il
campo opzionale booleano `localUiLeaseRequired`. Il codice eseguibile del
modulo resta identico: nessuna modifica a richieste HTTP, fence, segnali,
recupero, transizioni, guardie o posizione degli await.

Il consumer SecurityProvider legge il campo per il solo lease documentale.
Il controllo delle terapie, i suoi writer, CAS, ledger e audit restano
identici alla copertura precedente. Anche lo scarto esplicito della bozza
agisce solo sulla copia cifrata del browser, prima della navigazione, senza
scritture cliniche. Il confronto non estende TLC a lease o bozze.
Dopo questo riesame sono aggiornati il digest del solo tipo modificato e
`syncCommit`; modello, invarianti, limiti, mutanti e testimoni restano invariati.

## Raccordo HC-A2 del 29 ottobre 2026: esiti delle scale

Riesaminato il diff rispetto a `d7e5e0f4228d5a4e112c5b526f5e212e106c122d`,
comprese porte, consumer e writer host. La prima implementazione aggiungeva
un metodo di invio delle scale in `ApiTable`, facendo scattare correttamente
il controllo di deriva. Il metodo è stato estratto in `lib/scale-entry-client.ts`:
`lib/db.ts` torna identico byte per byte alla revisione coperta e conserva
l'impronta già registrata. Non è necessario aggiornare hash o `syncCommit`.

Il nuovo consumer è soltanto il runner delle scale. Usa le API pubbliche
esistenti `entries.prepareWritePayload` e `getSessionReadSignal`, conserva
una sola richiesta cifrata e notifica soltanto `entries`. Il segnale cambia
e quello precedente viene ritirato in ogni `setKey`, anche con la stessa
chiave: il controllo prima/dopo la cifratura e l'invio conserva il vincolo
alla sessione senza esporre la chiave né cambiare `ApiTable`.

Il gate di paziente attivo e il replay sono nei writer delle sole entries,
`lib/entry-write-operation.ts`; non aggiornano terapie, versione della terapia,
marker o ledger del comando di stato. I controller legacy ADR0156 e durevole
ADR0168, i loro consumer in TherapyManager, letture rigorose, await, CAS e
writer/audit host delle terapie restano identici. Un abort client continua
a non annullare il commit host. Non cambiano `Begin`/`Confirm`/`Dispatch`,
`Host`/`HostReject`, recupero, rimozione per attemptID, limiti o assunzioni.

Modello, statechart, invarianti, testimoni e mutanti restano invariati. Il
riesame non estende TLC a idempotenza, cifratura o lifecycle delle scale,
protetti dai test specifici del writer e dei client. Il comando completo
`npm run verify:therapy-status` ha verificato questo raccordo: 5.903.794 stati
distinti, coda vuota, nessuna violazione dei cinque invarianti; tre mutanti
del modello e sei testimoni rilevati come atteso, 122 test causali verdi,
due mutazioni del controller rilevate e originale ripristinato 29/29 verde.

## Riconciliazione delle letture di sessione con HC-7 del 27 ottobre 2026

Riesaminato il risultato dell'unione di #696 (`32ea06c6b10fa29c51418704a6133aef4f4b7a09`)
con `main` dopo #694 (`45caae3de3723bc4fd230532de3435aab12b04a7`),
rispetto a entrambi i genitori e ai rispettivi `syncCommit` precedenti.
`lib/db.ts` è identico alla head approvata di #696: conserva acquisizione,
composizione e controllo del segnale nei lettori `get`/`toArray`, query clonate
e collegamento delle tabelle all'owner. `components/therapy-manager.tsx` è
identico a `main`: conserva destinatario, riepiloghi, verbi e callback HC-7.
Le letture rigorose del manager e il loro segnale restano quelli già riesaminati.

Il confronto dei consumer `SecurityProvider`, `ConfirmProvider` e
`useDialogA11y` conferma che il ritiro delle letture e il filtro dei dinieghi
rimangono separati da focus, conferma e annullamento. Nessuna transizione,
guardia, posizione degli await, chiamata ai controller, CAS, ledger, audit o
writer cambia per questa riconciliazione. In `document-upload.tsx` si combinano
il lettore di #696 e il titolo nominativo HC-7; gli scrittori restano invariati.
Modello, invarianti, limiti, testimoni e mutanti non cambiano; gli AbortSignal
restano fuori dalla copertura TLC e sotto i test causali del client.

Dopo questo riesame scritto vengono ricalcolate le impronte dei file risultanti,
conservando anche la copertura dell'helper e degli input causali di #696.
`syncCommit` identifica il commit di merge del runtime riesaminato; il comando
completo `npm run verify:therapy-status` verifica il risultato senza estendere
le proprietà del modello alla presentazione o al protocollo durevole.

## Riconciliazione HC-6 con #696 del 28 ottobre 2026

Riesaminato il runtime `d7e5e0f4228d5a4e112c5b526f5e212e106c122d`
rispetto a entrambi i genitori (`3277bc44f7a19a04bce565d6b98122b934238063`
e `8547541fce58a086cc428c163d046c3561db22a3`). Il manager della terapia
è identico al primo genitore: cambia ancora soltanto la presentazione del
vuoto e la ricetta della sezione. `lib/db.ts`, `lib/api-table-response.ts`,
`SecurityProvider` e `document-upload.tsx` sono identici al secondo genitore.
La pagina paziente conserva il segnale di sessione della lettura allegati.

Riesaminati anche i consumer `ViewState`, `CollapsibleSection`, i callback del
manager e i lettori session-scoped: nessuna nuova lettura o scrittura,
transizione, guardia, confine degli await, CAS, ledger, audit o assunzione
è introdotta dall'unione. Il ritiro delle letture resta distinto dal vuoto e
non annulla un commit host. Modello, statechart, proprietà, limiti, testimoni
e mutanti restano invariati; sessioni e presentazione restano fuori dal TLC.
Il record conserva le impronte del manager HC-6 e dei lettori #696, con gli
input causali di questi ultimi; dopo il riesame `syncCommit` identifica il
runtime combinato. Il comando completo verifica nuovamente questa unione.

## Riesame HC-7 del 27 ottobre 2026

Confrontato `components/therapy-manager.tsx` fra la base `c4ddf2e35` e
`b051f6970`: il delta riguarda titolo/conseguenza della conferma di eliminazione,
ordine cognome/nome del destinatario e testo della conferma di cambio stato.
Il riepilogo mostra stato di partenza, destinazione e data corrente; la data
effettiva resta determinata dall'host al commit. Il verbo del comando identifica
il farmaco. Il componente comune dà priorità al ritorno nelle conferme distruttive;
Escape, chiusura e annullamento risolvono ancora `confirmed: false`. Motivazione
richiesta, trimming e controllo di presenza non cambiano.

Riesaminati `updateStatus`, `handleSoftDelete`, recupero e consumer dei due
controller: transizioni, guardie, confini degli await e chiamate a
`begin`/`confirm`/`cancel`/`recover` restano invariati. La stringa del destinatario
è solo presentazione; ID paziente/terapia, target, versioni e payload non cambiano.
Controller ADR0168, recupero legacy ADR0156, route, CAS, ledger e audit sono
identici alla base e conservano le impronte coperte. Il secondo confronto, su `9370053e4` (vedi `coverage.json.syncCommit` per il riferimento
completo), allinea anche titolo, conseguenza e verbo del nuovo invio dopo conflitto.
Sono ancora identici callback `deletion.retry`, scelta del motivo conservato o
nuovo e condizione `requireReason`: cambia soltanto il testo. Anche le conferme
di nuovo invio conservano motivo e guardie esistenti.

L'impronta del solo componente e `syncCommit` sono aggiornati manualmente dopo
questo confronto. Modello, statechart, invarianti, limiti e mutanti non cambiano;
`verify:therapy-status` deve completare il modello legacy e i test causali correnti.
Questa revisione di presentazione non estende la copertura TLC al protocollo durevole.

## Riconciliazione HC-7 e HC-8 del 27 ottobre 2026

Riesaminato il manager risultante dal merge `b55681f6e5d27a55a42ae42c4a1dd9f3ad0a8668` rispetto a entrambi
i genitori: HC-8 conserva `htmlFor`/`id` del campo Farmaco e il consumer
`DrugAutocomplete`; HC-7 conserva destinatario cognome/nome, oggetto e
conseguenza delle eliminazioni, riepilogo e verbo del cambio stato e del
nuovo invio. Riesaminati i consumer `ConfirmProvider`, `useDialogA11y` e
`DrugAutocomplete`: focus iniziale e associazione del campo restano separati
dai callback del controller. Non cambiano transizioni, guardie, confini degli
await, `begin`/`confirm`/`cancel`/`recover`, CAS, ledger, audit o altri writer.
Le altre superfici coperte conservano le impronte precedenti. Modello,
statechart, invarianti, limiti, testimoni e mutanti restano invariati.
Aggiornati manualmente il pin del manager e `syncCommit` alla revisione
riesaminata; il raccordo non estende TLC a presentazione e accessibilità.
Il comando completo `verify:therapy-status` deve essere rieseguito sul risultato.

## Raccordo della copertura al 26 ottobre 2026

`coverage.json.syncCommit` identifica ora la revisione del runtime riesaminata
`c4ae8c6eab6966e40414457ae3b666ac618154e8`; `legacyModelSyncCommit` conserva
`64e190438da8287928f0903b9b719c18b329a7ec` come precedente riferimento del modello
legacy. Le altre impronte coperte restano invariate: il delta rispetto a b806
cambia soltanto il validatore del predecessore recovery cifrato v4.
Il confronto ora rifiuta anche tabelle estranee invece di ignorarle. Non cambia
transizioni, guardie, await, CAS o audit del controller.

`StorageRestored` e `Recover` nel TLC riguardano leggibilità e recupero del
marker browser, non il ripristino del database o l'ammissione del suo schema.
Schema, migrazione, cifratura, chiavi e ricevute durevoli restano fuori dal TLC.
Il pin del validatore è un controllo di deriva con riesame manuale; non rende
quelle proprietà modellate. `durableProtocolCoverage.recoveryCompatibility`
registra questo confine e la revisione del confronto.

`code-current` esegue anche gli otto test causali del validatore: ammissione del
canonico v4 con impronta immutabile e byte invariati; diniego di tabella estranea,
colonna, indice, trigger, vista, versione falsa e v5 senza ledger. Il test è anche
in `verificationInputs`. Le prove cifrate del percorso owner restano evidenza
separata: verificano originale/destinazione e conservazione delle estensioni nel
backup fisico corrente v5. Il verifier generico non aggiunge quel carico né il
caso da257MiB. Modello, configurazione, invarianti, limiti, testimoni e mutanti
TLC restano identici.

Il primo gesto legacy apre una conferma sul paziente, sulla terapia e sulla versione
mostrati. Solo la conferma può iniziare una PUT CAS. Se il browser interrompe
l'attesa, il server può ancora scrivere: una GET alla vecchia versione non
basta per consentire un nuovo intento.

Lo [statechart](./statechart.mmd) descrive il controller Web e l'host separati.
La [lettura interattiva offline](./traces.html) presenta pochi ordini di eventi,
con parole del dominio, senza dati reali né dipendenze di rete. Il diagramma
include anche comportamenti controllati dai test e non astratti nel modello.
La decisione di prodotto rimane [ADR 0156](../../adr/0156-therapy-status-uncertain-client-write.md),
Accepted dal 2026-10-21 dopo la review indipendente completa sulla PR #591 (revisione `399265ffa`).

## Eseguire

Servono Node 24, le dipendenze npm del progetto e Java già installato (provato
con Temurin 25.0.2; Java 17 o superiore è il requisito di questo comando).

```sh
npm run verify:therapy-status
```

Il runner scarica soltanto l'artefatto ufficiale `tla2tools.jar`, release
[v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4), e ne controlla
SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`.
Il digest è stato calcolato sul download HTTPS ufficiale: l'API della release
non forniva un digest. Il record distingue la release Tools `1.7.4` dal verificatore incluso,
`TLC 2.19` (build 2024-08-08, revisione `5a47802`): sono nomenclature diverse
dello stesso artefatto. SHA-1 osservato:
`bee4a54f3ee3d4afc347c3240ec2d9e93b075104`.
Il JAR vive in `~/.cache/mediflow-formal/tla/v1.7.4`, fuori da Git; cache valida
permette esecuzioni offline. `MEDIFLOW_TLA_CACHE` può scegliere un'altra cache.
Non viene modificato Java di sistema.

Ogni esecuzione conserva configurazioni, log, controesempi e `result.json` in
una nuova directory temporanea esterna al checkout. Per conservarli altrove,
impostare `MEDIFLOW_FORMAL_OUTPUT_DIR` su una directory nuova fuori da repository,
Documents e Desktop. Il runner crea lì anche `MEDIFLOW_DATA_DIR` sintetica e
imposta `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`. Non legge né copia il DB reale.
I file di esecuzione non vengono cancellati automaticamente.

Il comando verifica la copertura dichiarata, esegue TLC sul modello corrente,
3 controlli negativi del modello e 6 testimoni di raggiungibilità; poi esegue
i test reali del controller e della route HTTP autenticata/ApiTable, 2 mutazioni
isolate del controller e il controller originale dopo le mutazioni. Un rosso
atteso richiede l'invariante preciso e una traccia TLC, oppure un'asserzione
comportamentale del test. Errori di parser, import, timeout o tool non valgono.
Web Core esegue lo stesso comando prima della build, solo quando il diff CI
tocca una superficie coperta o un input di verifica elencato nel record. Il range
arriva tramite `MEDIFLOW_FORMAL_BASE_REF`; base mancante/non valida o diff non
leggibile fanno eseguire il controllo completo. In locale senza quella variabile
il controllo è sempre completo. Non si aggiunge un workflow separato. I test `.test.ts` restano nella selezione unit
esistente; il runner non è un test scoperto tramite naming.

## Proprietà e danno evitato

| Invariante | Promessa e danno evitato |
| --- | --- |
| `NoWriteWithoutConfirmation` | Nessuna richiesta host generata dal controller senza conferma esplicita: evita una modifica clinica al primo gesto. |
| `NoNewIntentWhileApplicable` | Non apre un nuovo intento quando una vecchia richiesta può ancora superare la CAS: evita che il medico agisca su un esito che crede annullato. |
| `NoUnprovedRegistration` | `Registrata` richiede risposta positiva, conferma ancora in memoria, stato coerente e versione osservata avanzata: evita una falsa conferma di salvataggio. |
| `AdmissionIsNotUncertain` | Il fallimento del nuovo claim prima dell'invio è `unavailable`: evita di far credere che sia partita una nuova PUT. Un marker recuperato può invece essere ignoto anche se il processo che sapeva di non aver inviato è scomparso. |
| `OldOwnerPreservesMarker` | Una rimozione del vecchio owner non elimina il marker di un altro attemptID: evita uno sblocco mentre una richiesta diversa resta irrisolta. |

Gli invarianti si applicano al modello finito, non direttamente al TypeScript.
Il collegamento al codice è manuale e qualificato con test comportamentali,
mutazioni reali isolate e controllo di deriva; non è una prova di raffinamento.

## Limiti e ipotesi esplicite

I limiti macchina sono in [coverage.json](./coverage.json): 2 client/tab nello
stesso profilo e origine, 1 archivio, 1 paziente, 1 terapia, 2 tentativi totali
(compresi i claim falliti), stato iniziale `active`, target `suspended` o
`completed`. `active` come nuovo target è simmetrico per le proprietà scelte,
ma non viene esplorato come gesto. Versioni positive monotone, al massimo 5;
nessun riuso degli attemptID. Un writer esterno può incrementare la versione
fino a 3, anche senza cambiare lo stato. I due tentativi possono incrementarla
ancora. Un processo TLC usa un worker, heap di 512 MiB e timeout di 300 secondi;
lo stato su disco è esterno a Git. La simmetria scambia soltanto i nomi dei due
client e riduce gli stati duplicati; non identifica i tentativi o le versioni. Il timeout è un errore, mai un risultato verde. TLC usa fingerprint finiti: non è
una dimostrazione matematica senza possibilità di collisioni.

Web Locks rende atomici solo lettura/claim, settle e remove nel callback
sincrono del registro; non l'intero controller. Il marker persiste fra remount,
e storage illeggibile blocca. `StorageRestored` rappresenta il ritorno della
leggibilità dello stesso contenuto, non cancellazione o riparazione inventata.
Il modello assume integrità dello storage: manomissione, cancellazione,
profili/origini diversi e perdita completa della cache non sono coperti.
Il latch di generazione archivio e il contesto paziente/sessione validi sono
precondizioni, protette anche da test; non si modellano più archivi/sessioni.

L'host è autorevole: CAS e audit sono una transazione indivisibile, le versioni
non tornano indietro, un rifiuto autorevole non committa quella richiesta. Un
abort client non cambia `attempt.host`. La GET campiona la versione host in
`GetStart` e può arrivare dopo un commit; non inventa versioni future.
Lo stato osservato dal client resta distinto dalla verità host.

La coerenza del modello riguarda lo stato della terapia. Nomi, dosi, cifratura,
identità/autorizzazione, endDate e messaggi UI non sono domini TLC: i test reali
coprono i controlli di dose/paziente/campi bloccati e i confini HTTP. `GetFailure`
astrae lettura negata/non valida. Non si modellano tutte le eccezioni del lock
alla risoluzione post-invio, ogni microtask del trasporto o tutte le risposte
positive tardive dopo timeout: i test del controller le affiancano. Remount
azzera l'intento; la richiesta host sopravvive. La rimozione già decisa può
intercalarsi con una seconda tab e con un nuovo marker. Il rimontaggio TLC
è esplorato dopo dispatch, su unavailable e su conferma/terminali; non esplora
direttamente ogni rimontaggio fra claim e dispatch o callback di owner smontati
a metà lettura. I test di generazione/sessione affiancano questo confine.

Nessuna fairness o liveness è dichiarata. Esito ignoto e versione invariata
possono rimanere bloccati indefinitamente. Non si dimostrano idempotenza
universale, audit/cifratura completi, correttezza dell'app intera, qualificazione
clinica o funzionamento su un'installazione reale.

## Dal modello al codice

Il 27 ottobre 2026, HC-6, è stato riesaminato il diff completo di
`components/therapy-manager.tsx` fra il precedente `coverage.json.syncCommit`
`b55681f6e5d27a55a42ae42c4a1dd9f3ad0a8668` e
`d44efa7149d5913573a795df99d9522f7a1d7d9f`, insieme ai consumer
`ViewState`, `CollapsibleSection` e alle ricette CSS delle sezioni.
Il vuoto usa il componente comune, senza azione aggiunta; il manager lascia
la propria creazione presso il titolo e rimuove la variante CSS dedicata.
Il ramo di caricamento, la condizione del vuoto, gli handler e i collegamenti
alle porte restano identici. I consumer riesaminati non invocano letture o
scritture nella nuova presentazione. Non cambiano transizioni, guardie,
confini degli await, CAS, audit, altri writer o assunzioni del modello.
Le altre superfici coperte conservano le impronte precedenti; modello,
configurazione, statechart, proprietà, limiti, testimoni e mutanti restano
invariati. Dopo il riesame sono aggiornati manualmente soltanto l'impronta
del manager e `syncCommit`. Questo raccordo non estende le proprietà formali
alla geometria o ai testi degli stati vuoti.

Il 27 ottobre 2026, PR #696, è stato riesaminato il diff di `lib/db.ts`
fra `f44fff7fcbdc2708a15958c0123c09ff1ac4b0b4` e
`09166e707572ccf1d15008da244f7bd320de0851`. `ApiTable.get` e `toArray`
acquisiscono il segnale della sessione della richiesta, lo compongono con
l'eventuale segnale del chiamante e verificano la validità prima e dopo
risposta, JSON e decifratura. `count` delega alla stessa lettura; i costruttori
e le query clonate conservano il riferimento all'owner della sessione.
Il consumer TherapyManager continua a usare le letture rigorose e il segnale
del suo contesto. Una lettura ritirata resta un errore: non prova assenza,
registrazione o autorizzazione a riprovare una scrittura.

Il confronto dei metodi conferma identici tutti i writer di ApiTable e
`MedicalApiClient.setKey`; non cambiano controller, marker, CAS, audit o
writer host. Il ritiro del client continua a non annullare un commit host.
`GetFailure` astrae già la lettura negata o non disponibile; sessioni,
microtask e composizione degli AbortSignal restano fuori dal TLC e sono
verificati dai test causali del client. Modello, invarianti, limiti,
configurazioni, testimoni e mutanti rimangono identici. Dopo il riesame
sono stati aggiornati l'impronta di `lib/db.ts` e `syncCommit`; la nuova
dipendenza `lib/api-table-response.ts` entra nel controllo di deriva insieme
agli input dei suoi test causali. Questo pin non amplia le proprietà TLC.
Il comando completo `npm run verify:therapy-status` è passato su Node 24.22.0:
TLC corrente con 5.903.794 stati distinti e coda vuota, 3 controlli negativi,
6 testimoni, test reali del controller/HTTP, 2 mutazioni del controller
rilevate e controller ripristinato verde.

Il 27 ottobre 2026, PR #692 (HC-8), è stato riesaminato il diff completo di
`components/therapy-manager.tsx` fra il precedente `coverage.json.syncCommit`
`2bf054fabf0b44e943022d8ad0654a2b243f0796` e
`f44fff7fcbdc2708a15958c0123c09ff1ac4b0b4`, insieme al consumer
`DrugAutocomplete`. Il manager associa l'etichetta Farmaco al campo tramite
`htmlFor` e `id`, sia per il galenico sia per il combobox AIFA. Nel consumer
cambiano soltanto l'ID dell'input e la presentazione di bordo e focus; ricerca,
selezione e callback restano identici. Non cambiano transizioni, guardie,
confini degli await, CAS, audit, altri writer o assunzioni del modello.
Tutte le altre superfici coperte conservano l'impronta precedente. Modello,
configurazione, statechart, invarianti, limiti, testimoni e mutanti restano
invariati. Dopo questo riesame sono stati aggiornati manualmente soltanto
l'impronta del manager e `syncCommit` alla revisione riesaminata.
Il raccordo non estende le proprietà modellate alla presentazione o
all'accessibilità del campo; il contrasto del bordo fuori fuoco resta aperto
nell'unità HC-4, responsabile della ricetta condivisa dei campi in `globals.css`.
Il comando completo `npm run verify:therapy-status` è passato su Node 24.22.0:
TLC corrente con 5.903.794 stati distinti e coda vuota, 3 controlli negativi,
6 testimoni, 122 test reali, 2 mutazioni del controller rilevate e 29 test del
controller ripristinato verdi.

Il 27 ottobre 2026, PR #686 (A1/A2), è stato riesaminato il diff completo di
`components/therapy-manager.tsx` fra il precedente `coverage.json.syncCommit`
`3c3529729a74a7cd0be82ef3290715d0fa5fb7ec` e
`2bf054fabf0b44e943022d8ad0654a2b243f0796`. Cambiano soltanto classi CSS,
spaziatura dei comandi e presentazione della selezione dei suggerimenti:
`aria-pressed` espone la stessa condizione prima usata dalle classi condizionali;
la ricetta secondaria comune usa i token di selezione Lume. Gli handler dei
suggerimenti restano identici. Non cambiano transizioni, guardie, confini degli
await, CAS, audit, altri writer o assunzioni del modello. Tutte le altre
superfici coperte conservano l'impronta precedente. Modello, configurazione,
statechart, invarianti, limiti, testimoni e mutanti restano invariati.
Dopo questo riesame sono stati aggiornati manualmente soltanto l'impronta del
manager e `syncCommit` alla revisione riesaminata; il raccordo non estende le
proprietà modellate alla presentazione o all'accessibilità dei suggerimenti.
Il comando completo `npm run verify:therapy-status` è passato su Node 24.21.0:
TLC corrente con 5.903.794 stati distinti e coda vuota, 3 controlli negativi,
6 testimoni, 122 test reali, 2 mutazioni del controller rilevate e 29 test del
controller ripristinato verdi.


Il 27 ottobre 2026, PR #684, è stato riesaminato il diff di
`components/therapy-manager.tsx` fra il precedente `coverage.json.syncCommit`
`719509e92f81c15adc1e8abb9beb82740615c27e` e
`3c3529729a74a7cd0be82ef3290715d0fa5fb7ec`. Cambiano soltanto le due etichette
dell'età passate a `statusChange.recover` e `statusChange.begin`: il conteggio
usa `formatCountLabel(age, 'anno', 'anni')` e conserva la guardia
`Number.isFinite(age)` e il testo per l'età non disponibile. Non cambiano
transizioni, guardie, confini degli await, CAS, audit, altri writer o assunzioni.
Modello, statechart, invarianti e limiti restano invariati. Dopo questo riesame
sono stati aggiornati manualmente soltanto l'impronta del manager e `syncCommit`
alla revisione riesaminata. Il comando completo `npm run verify:therapy-status`
è passato su Node 24.22.0: TLC corrente con 5.903.794 stati distinti e coda
vuota, 3 controlli negativi del modello, 6 testimoni, 122 test reali,
2 mutazioni del controller e 29 test del controller ripristinato.

Gli stati interni `claiming/admitted` corrispondono alla UI `writing` prima
dell’invio; `get/removing/publishing` alle fasi della UI `reading`. Il modello
unisce `conflict/rejected` nel rifiuto autorevole (entrambi impediscono
l’attribuzione di `Registrata`) e i motivi di `unavailable` nel blocco di
disponibilità. Non unisce la verità host al risultato del fetch.

Commit di sincronizzazione del runtime:
`dc9bcbf12cdd990b34676e3136be4cf412a3cd16`. Il file di copertura fissa gli hash
completi delle superfici lette; il runtime non viene modificato da questo lavoro.

Il 22 ottobre 2026, PR #617 (`9ff52b5f822a24c2996ab11b1e5d84ed1c51dbc8`),
è stato riesaminato e aggiornato soltanto l'hash di `components/therapy-manager.tsx`.
Rispetto al commit di sincronizzazione cambia solo la presentazione dei dettagli
di riga (`details` → `Disclosure`, con lo stesso contenuto già montato). Non
cambiano comandi, conferma, CAS, recupero, audit, transizioni o assunzioni del
modello. Prima dell'aggiornamento sono passati TLC sul modello corrente
(5.903.794 stati distinti, coda vuota) e i 48 test del controller e della route.
Il gate completo conserva invarianti, limiti, testimoni e controlli negativi.

Il 23 ottobre 2026, revisione `2e73fe52f9a0cd021677cedac69745a1a8db81b3`, è stata riesaminata
la composizione di Terapie. Titolo, contatori e creazione appartengono ora
alla stessa sezione; i comandi meno frequenti passano nel menu comune.
Le azioni disponibili per ciascuno stato e i relativi handler restano gli
stessi: nessuna eliminazione o modifica è aggiunta alle righe sospese o concluse.
Il form conserva la bozza; la soglia rimane montata e usa un ruolo secondario
quando l'invio del form occupa il ruolo principale.

Il collegamento alle porte e i callback di conferma, CAS, recupero, audit e
transizioni fino a `handleSoftDelete` restano quelli di main `64e190438`.
Il manager aggiunge un riferimento al form e un effetto di layout che porta
il fuoco al primo campo quando si apre una bozza o si cambia terapia in modifica;
l'effetto non invoca porte di lettura o scrittura. Sono stati riesaminati anche
i callback JSX e le guardie dei
comandi spostati: cambia la collocazione, non il comportamento. I componenti
comuni non invocano l'azione all'apertura del menu. Modello, statechart,
limiti e proprietà non cambiano. Prima dell'aggiornamento manuale della copertura
sono passati TLC corrente (28.149.669 stati generati, 5.903.794 distinti,
profondità 36, coda vuota) e tutti i 48 test controller/HTTP su Node 24.21.0.
Il record usa come `syncCommit` la base di main
`64e190438da8287928f0903b9b719c18b329a7ec`, che resta nella storia dopo lo squash;
`2e73fe52f9a0cd021677cedac69745a1a8db81b3` identifica la revisione riesaminata
della composizione. La voce di menu «Elimina (inserita per errore)» conserva
il vincolo d'uso nel testo visibile e nel nome accessibile; conferma e recupero
restano invariati. L'apertura di una bozza porta anche `defaultOpen` a true,
sia per nuova terapia sia per modifica: il form diventa visibile se la sezione
era chiusa. Cambia soltanto la visibilità del contenitore e non i comandi di
scrittura. Si aggiorna solo l'hash del manager fra le superfici coperte;
il comando completo viene rieseguito dopo l'aggiornamento.

| Azione TLC / confine | Implementazione letta |
| --- | --- |
| `Begin`, `Cancel`, `Confirm` | [controller](../../../lib/therapy-status-confirmation.ts), [`begin/cancel/confirm`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L219): copia contesto, guardie, generazione; nessun `write` in `begin`. |
| `Claim`, `ClaimFailure`, `ClaimCompletionFailure`, `Dispatch` | [`await journal.claim`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L245), controllo corrente/segnale dopo l'attesa, quindi `ports.write`. Un errore anche dopo la persistenza può lasciare un marker certamente non inviato noto solo in memoria. |
| `Receive`, `Settle`, `Deliver` | [Risposta `ports.write`, `await journal.settle`, continuazione di `Promise.race`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L267): sono passi separati; settle controlla l'identità del marker. |
| `LoseResponse`, `Host`, `HostReject` | Abort/timeout client separato dalla [PUT Web](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/app/api/therapies/%5Bid%5D/route.ts#L19) e da [updateTherapyOperation](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-write-operation.ts#L58): CAS, incremento e audit nella transazione IMMEDIATE. |
| `GetStart`, `GetReturn`, `GetFailure` | [`reread`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L132): GET autorizzata; dopo `await read` controlla contesto e marker, confronta versione e rifiuto autorevole; nessun write. |
| `Remove`, `Publish` | [`await journal.remove`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L155) sotto lock con attemptID, poi controlli corrente/segnale e pubblicazione `registered/reviewed`; i passi non sono atomici insieme. |
| `Remount`, `Recover` | [`dispose`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L218), nuovo controller e `recover/restore`: perde intento e attribuzione; conserva il marker. |
| `RecheckCleanup`, `RecheckInspect` | [`recheck`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L190): rimuove solo il proprio marker noto non inviato, attende inspect/lettura/inspect; senza marker torna alla scheda, altrimenti recupera senza retry. Le attese fra inspect sono astratte come possibili cambi del marker prima dell'inspect finale. |
| `OtherWriter` | Writer esterno alla barriera browser; resta soggetto alla CAS host. Nessun nuovo endpoint. |

[therapy-manager](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/components/therapy-manager.tsx#L84) collega il controller
all'UI e alle porte reali; [ApiTable.update](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/db.ts#L499) attende cifratura,
fetch e parsing del rifiuto; il [fence del trasporto](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/security/client-auth-api.ts#L453)
propaga segnali e generazione archivio. L'ammissione HTTP prima della CAS non
rende annullabile la transazione se il client abortisce.

## Controesempi e collegamento ai test

`AbortUnlock=TRUE` risolve erroneamente una lettura alla stessa versione.
TLC trova: `Begin → Confirm → Claim → Dispatch → LoseResponse → GetStart(v1)
→ GetReturn → Remove → Begin` dell'altra tab, mentre la vecchia CAS v1 è ancora
applicabile. Il server può committare dopo. Il modello corretto conserva il marker.
Il runner muta lo stesso confronto nel controller (`>` diventa `>=`), e il test
`client abort before server commit keeps same-version readback unresolved`
fallisce con `reviewed` invece di `uncertain`. Il source reale non viene editato:
si usa una copia temporanea, con il solo import della guardia puntato al file
originale. Questo è un controllo semantico della regressione, non una ricostruzione
byte per byte del controller storico.

`AdmissionUncertain=TRUE` classifica un claim fallito come esito ignoto; TLC
viola `AdmissionIsNotUncertain`. La mutazione corrispondente nel controller è
rilevata dai test `P2 admission failure`: nessuna PUT, ma fase errata `uncertain`
invece di `unavailable`. `OwnerBlindRemove=TRUE` rimuove il marker senza verificare
attemptID: TLC trova la cancellazione di un marker differente. Il test reale
`archive namespaces, stale owners and marker minimization` e i test P2 della
rimozione conservativa esercitano il registro autentico.

I 6 invarianti negati di raggiungibilità devono fallire con un testimone:
`registered`, rifiuto autorevole, ammissione non inviata, GET stessa versione con
CAS ancora pendente, recupero che porta al confronto e vecchia rimozione con un
marker sostitutivo presente. Non si accetta una ricerca vuota o interrotta.

Il test aggiunto `formal trace: a GET sampled before late host commit stays
uncertain across two owners` esercita anche il ritorno tardivo di una GET vecchia:
resta bloccato, quindi una nuova GET avanzata apre il confronto, senza attribuire
il commit all'owner recuperato. I due test `HTTP abort settles the real client
before the admitted host write; intervening no-op=…` usano ApiTable, HTTP loopback,
route autenticata e CAS/audit reali su SQLite sintetico: tengono la route prima
della CAS, interrompono il fetch, leggono la vecchia versione, verificano blocco
e recupero, poi liberano il writer. Nel ramo no-op il writer tardivo riceve 409;
nell'altro committa con un solo audit. Sono eseguiti dal comando corrente.

La riproduzione storica sul controller `00673251bd40854b6a2832a964f842d9e30eabba`
è evidenza precedente riusata: gli stessi due ordini HTTP avevano dato `reviewed`
invece di `uncertain`, 2 asserzioni fallite. Anche i rossi P2 su `bbf3ebe…` sono
precedenti, non nuovi run di questo contributo. Nessun nuovo difetto del prodotto
è stato dedotto soltanto da un mutante.

## Esito osservato (2026-10-21)

Sul runtime sincronizzato a `dc9bcbf…`, il comando ha completato TLC con
28.149.669 stati generati, 5.903.794 distinti, profondità 36 e coda finale vuota:
i 5 invarianti non hanno violazioni nel limite dichiarato. Una prima esecuzione
con polinomio fingerprint 0 e una seconda con 37 hanno gli stessi conteggi;
la seconda è il default riproducibile. La prima stima basata sui fingerprint
osservati era più pessimistica della stima teorica: il secondo run è un controllo
aggiuntivo di quella specifica incertezza, non una prova illimitata.

Il run finale corrente ha richiesto circa 107 secondi per TLC e 117 secondi
complessivi dei processi del comando su macOS, Node 24.21.0 e Temurin 25.0.2.
Heap TLC fissato a 512 MiB, un worker; il campione RSS osservato in un run era
circa 563 MiB, non una misura del picco. I 3 mutanti del modello e i 6 testimoni
hanno dato il rosso atteso (violazione identificata e controesempio); le
2 mutazioni isolate del controller hanno fallito su asserzioni comportamentali.
I test controller/HTTP sono 48 verdi, compresi i due casi HTTP; il controller
originale dopo le mutazioni è 29/29 verde. Lint, typecheck, selezione dei test e
claims guard sono verdi. Le 5 tracce HTML sono state percorse nei 24 passi e
ispezionate a larghezza 728 e 390 px, senza richieste di rete.

Non è emerso un nuovo bug riprodotto sul runtime corrente: sono stati riscoperti
i controlli negativi delle regressioni note. Runtime e UI non sono cambiati.
Non sono state ripetute le suite E2E complete; le evidenze precedenti restano
limitate alle loro revisioni. Build di produzione, CI remota, installazione,
review indipendente e accettazione non sono esiti di questo contributo.

## Manutenzione

Quando cambia una superficie coperta, il comando si ferma prima di TLC con
`Formal coverage drift`. Confrontare il diff con il commit di sincronizzazione,
comprese funzioni spostate e altri writer. Riesaminare transizioni, guardie,
confini degli await e assunzioni; aggiornare modello, statechart e test pertinenti.
Solo dopo una review esplicita della corrispondenza aggiornare manualmente gli
hash e il commit in `coverage.json`, quindi rieseguire il comando completo.
Non esiste un comando di auto-rehash: un hash aggiornato da solo non qualifica
il collegamento. Se cambia una proprietà, documentare la modifica intenzionale
del contratto. Conservare i difetti aperti e qualificare nuovamente le mutazioni.

Le fonti di metodo sono [pstack, commit fissato](https://github.com/cursor/plugins/blob/7b353f78f6ec193bdbe48ed8059444eb09b6878e/pstack/skills/create-formal-verification-skill/SKILL.md),
la [vista di TLA+](https://lamport.azurewebsites.net/tla/high-level-view.html) e
la [descrizione degli strumenti](https://lamport.azurewebsites.net/tla/tools.html).
Il modello è un'astrazione manuale sopra il codice, coerente con questo uso di TLC.

## Raccordo C-5 del 30 ottobre 2026

Il corpo transazionale di `executeTherapyStatusCommand` è condiviso con
l'adapter paired nativo. Per il Web rimangono identici ammissione, CAS,
identità del comando, terminalità, audit e transazione. Il ramo nativo
aggiunge lo scope ambulatoriale del writer esistente e una provenienza audit
`native`; l'autorizzazione precede la stessa transazione. Il digest del
servizio è aggiornato dopo il confronto del corpo estratto e le prove Web,
PIN nativo, gare e crash. Il modello legacy non viene esteso ai grant nativi:
scadenze, consumo e revoca sono provati separatamente con orologio iniettabile
e mutazioni in `scripts/falsify-chat-therapy.mjs`.

## Raccordo PR #768: provenienza delle ricevute e importazione portabile

Riesaminata la correzione `3ff78ad3c` rispetto a `b81feca35` e al precedente
head `a8d6e3f75`. Il delta iniziale di `lib/db.ts` riguarda soltanto l'header
di credenziale del ripristino portabile. La conferma di una terapia continua
a usare lo stesso protocollo, writer, CAS e legame audit/ledger; l'ammissione
della superficie `native` nel validatore segue il writer esistente.

Il lettore ricevute ora propaga `origin: local | imported | unattested`. Il controller
mostra come registrazione locale soltanto una ricevuta locale e corrente;
una ricevuta importata resta storico da esaminare, anche se lo stato della
terapia coincide. Il client verifica il nuovo campo e rifiuta un'origine
importata dichiarata corrente. Il modulo `backup-import-provenance.ts` entra
nelle sorgenti fissate: consulta esclusivamente il registro locale `portable_import_origins`, senza
cambiare le righe originali. Il ripristino assegna la provenienza solo alle
righe nuove nella stessa transazione. I marcatori del file restano storia:
non riclassificano righe locali, neppure dopo il percorso A → B → A. La
migrazione allo schema 7 fissa come non attestate le righe preesistenti non
indicizzate soltanto negli archivi con ricevuta portabile o traccia legacy
di ripristino. Non ricostruisce l’origine dai riferimenti dei marcatori.
La conservazione nel vero owner trasferisce anche indice ed eventi necessari
alle FK per le nuove righe; le righe identiche in B mantengono l’autorità di B.

Il modello TLC legacy non viene esteso a fiducia nella sorgente, backup o
migrazioni. Il nuovo vincolo del controller durevole è coperto dai test del
client, della conferma e da un vero ripristino di ledger ostile, incluso il
caso di 650 audit importati con budget di lettura locale separato. Tale
prova entra nel gruppo `code-current` del verificatore insieme alla migrazione
6 → 7 e al suo rollback, insieme ai 19 casi del vero owner. Le prove HTTP su due server e l’aggiornamento da
v0.9.0 restano evidenze separate dal modello. Modello, invarianti,
assunzioni, mutanti e testimoni legacy restano invariati. Le impronte vengono
aggiornate dopo questo confronto; `verify:therapy-status` deve ancora
rieseguire TLC, i mutanti e tutti i test causali sull'head consegnato.

## Raccordo WUL-800 del 2 novembre 2026: passaggi di stato sul server

Confrontati `lib/therapy-write-operation.ts` e `lib/therapy-status-command-service.ts`
di `1c97e50bcc00ad06edcad6df78b85b62ae4272d0` con il runtime sincronizzato
`1c6fdef4ff091d8c912bbc5a2f08fe8a3ebb868d`. Il writer comune, dopo il controllo
di versione e prima dell'UPDATE, applica la tabella dei passaggi
(`lib/clinical-status-transitions.ts`, decisione in
`docs/domain/clinical-status-transitions.json`): attiva verso sospesa o conclusa,
sospesa verso attiva o conclusa, conclusa verso attiva. Un passaggio fuori
tabella, o la rimozione della data di fine di una terapia conclusa, risponde
409 senza scrittura né audit. Lo stesso writer allinea la data di fine al
passaggio secondo le regole precisate più sotto, dopo la review indipendente.

Nel modello questo è un caso di `HostReject`: l'host può già rifiutare un
tentativo pendente senza effetti, a qualunque versione. Il nuovo rifiuto non
aggiunge scritture, non cambia l'ordine delle guardie né l'atomicità host, e
lo stato raggiunto da un commit resta il bersaglio del tentativo. Dopo la review
indipendente il writer comune segue anche le regole di data del comando:
concludendo prima di una fine programmata vale l'istante del passaggio,
riattivando una terapia conclusa la vecchia data si svuota anche se il client la
rimanda, e il momento del passaggio è l'orologio del server. Le sorgenti fissate
comprendono ora la tabella (`lib/clinical-status-transitions.ts`), la mappa
degli alias (`lib/status-normalization.ts`) e il file di decisione. Nel comando
durevole un rifiuto di passaggio non è più registrato come `version_conflict`:
il servizio lo nega come una risorsa non ammessa (`denied`), senza ricevuta e
senza effetti, lo stesso esito già previsto per il 404. Nel modello il cammino è
`HostReject` seguito da `LoseResponse`, non una risposta negativa consegnata: il
client che ha già inviato resta `uncertain` finché il medico non rilegge o
chiude, e la chiusura scrive la ricevuta `closed`. Il Web non offre questi
passaggi (per una terapia conclusa propone solo «Riattiva») e l'anteprima della
chat li nega prima del PIN, quindi il cammino resta raggiungibile solo da un
client che costruisce il comando da sé. La data di fine
scritta dal comando resta quella di prima: conclusa usa l'istante del commit,
attiva la svuota, sospesa la conserva.

Il modello non cambia: statechart, invarianti, limiti, testimoni e mutanti
restano identici. Prima di aggiornare i due digest e `syncCommit` sono passati
i test delle terapie (339, compresi i nuovi `therapy-status-transitions` e il
diniego del comando su una terapia conclusa) e il gate completo
`npm run verify:therapy-status` su questo commit.

WUL-800 coorte 4 (prescrizioni protesiche) aggiunge la sua tabella a `lib/clinical-status-transitions.ts` e al file di decisione.
Righe, regole e funzioni delle terapie restano identiche: le impronte dei due
file cambiano per le parti di altre entità, il modello no.

WUL-800 coorte 5 (handoff SISS) aggiunge la sua tabella agli stessi due file,
con lo stesso esito per il modello delle terapie: nessuna riga o regola delle
terapie cambia.

## Raccordo 0.9.1 del 3 novembre 2026: collezione degli allegati nei writer del browser

Fra le sorgenti coperte cambia soltanto `lib/db.ts`. `ApiTable.add` e
`ApiTable.delete` accettano un'opzione `attachmentCollection`, una vista
della collezione degli allegati di un paziente presa dall'elenco che il
medico ha davanti (`lib/attachment-collection-client.ts`, fuori dalle
sorgenti fissate perché non tocca terapie). La vista è usata soltanto quando
la tabella è `attachments` e l'opzione è presente: per ogni altra tabella
`attachmentCollectionFor` restituisce `undefined` e il corpo, la richiesta,
gli await e gli errori restano quelli di prima. Il `.catch` che ritira la vista
dopo una risposta mancata avvolge la `fetch` e il `json` solo in presenza
della vista, quindi il percorso della terapia, compreso il delete recintato
con `deleteContext`, non acquista microtask né cambia l'ordine delle guardie.

Non cambiano controller, conferma, CAS, ledger, audit, stato della terapia
o cifratura. Modello, statechart, invarianti, limiti, testimoni e mutanti
restano invariati. La precondizione di collezione è verificata dal confine
reale con SQLite (`lib/attachment-web-create-currentness.test.ts`, caso «due
finestre») e dai test del client (`lib/attachment-client-preconditions.test.ts`),
non da TLC. È aggiornato il solo digest di `lib/db.ts`; `syncCommit` resta
invariato perché nessuna sorgente della terapia cambia comportamento.

## Raccordo PR #846

Confrontati la sincronizzazione `1c97e50bcc00ad06edcad6df78b85b62ae4272d0`,
la base `fb6c3966d8b4108c60708af50612359ecf082035`, l'head iniziale
`300a56ff1031cba557475ffd8f0be359bc3f3c42` e la correzione
`6978d4816`. Le quattro impronte precedenti coincidono con i file della
base; gli altri delta da `syncCommit` alla base di `db.ts` sono già raccordati
sopra per documenti e collezione allegati.

Il delta della PR in `lib/db.ts` aggiunge i tipi dell'identità a `Patient`
e riconosce il 409 duplicato solo quando `tableName === 'patients'`.
L'await per leggere il payload clonato dell'add resta dentro quella guardia;
nessun await delle terapie viene aggiunto. Update e relativi errori delle
terapie conservano il percorso precedente. Non cambiano transizioni,
conferma, journal, CAS, ledger, audit o atomicità delle scritture delle terapie.

Sono riesaminate anche le altre tre superfici coperte modificate dalla PR:
`sqlite-schema.ts` aggiunge esclusivamente le quattro colonne dei pazienti
e il loro backfill; ora distingue STP ed ENI solo con 13 cifre e assegna
`none` al valore vuoto. `sqlite-schema-open.ts` porta la versione da 7 a 8.
`ambulatory-destructive-command-recovery-schema.ts` sottrae queste quattro
colonne dalla copia canonica in memoria usata per riconoscere gli schemi
precedenti, conservando i vincoli delle tabelle terapie, audit e comandi.
I test reali di migrazione, recovery, gare, crash e ripristino passano;
la migrazione resta fuori dalle proprietà TLC.

Prima di aggiornare le impronte è stata eseguita una copia temporanea del
verificatore con gli stessi comandi e asserzioni, che segnala le quattro
derive senza arrestarsi al controllo preliminare. TLC ha completato
5.903.794 stati distinti, con coda vuota; sono passati i tre controlli
negativi, i sei testimoni, 188 test `code-current`, i mutanti del controller,
il controllo del codice ripristinato e le mutazioni della chat.
Solo dopo questi esiti vengono aggiornate le quattro impronte e `syncCommit`
alla revisione della correzione. `legacyModelSyncCommit`, modello, statechart,
invarianti, limiti e mutanti restano invariati. Il gate ufficiale completo
viene rieseguito sul manifest aggiornato senza esclusioni.

La riesecuzione ufficiale `npm run verify:therapy-status` passa sul manifest
aggiornato: TLC, tre mutanti, sei testimoni, 188 test causali, due mutanti
del controller, codice ripristinato e mutazioni della chat. Nessun file
runtime o test viene modificato dopo questi esiti.

## Riconciliazione del 7 novembre 2026: blocchi di conservazione sugli allegati

`lib/db.ts` cambia solo nel percorso di eliminazione degli allegati: un 409
`legal_hold` diventa `AttachmentLegalHoldError` (ADR 0178). Confronto con
`syncCommit` fff8aefc3a6786d64e31019be3398cb6388ee55f: nessuna modifica a transizioni, guardie, await, CAS o
audit delle terapie, e nessun codice delle terapie legge il testo degli errori di
eliminazione. Aggiornate a mano l'impronta di `lib/db.ts` e `syncCommit`.
## Riconciliazione del 7 novembre 2026: rifiuti 412 nella creazione

`lib/db.ts` cambia solo nel testo dell'errore di creazione: un 412 con codice e
messaggio (per esempio `PROSTHETICS_CATALOG_REQUIRED`) mostra il solo messaggio.
Confronto su 46dfd4274f2740930d5f266e13ec3a05348f20ad, poi sull'unione con main ae2ab57aa37e5837cd4e02e6a8d1c5c8e9988a53 (`syncCommit`), che contiene anche il blocco sugli allegati: nessuna modifica a transizioni, guardie, await,
CAS o audit delle terapie, e nessun codice delle terapie legge il testo degli
errori di creazione. Aggiornate a mano l'impronta di `lib/db.ts` e `syncCommit`.
Modello, configurazione, invarianti, limiti e mutanti TLC restano identici.

## Raccordo del 10 novembre 2026: copy del collegamento clinico (PR #922)

`components/therapy-manager.tsx` perde soltanto il paragrafo di testo sotto
«Collegamento clinico» nel modulo della terapia («Indicazione: prevenzione.»,
«La diagnosi selezionata viene mantenuta come contesto della terapia.»,
«Opzionale: collega una diagnosi…»). La condizione su `selectedDiagnosis`
sceglieva soltanto quale frase mostrare: nessuno stato, gestore, scrittura o
lettura dipendeva da quel paragrafo. Confronto con `syncCommit`
09642085a7c6efd9863a9b980a4e174116d86036, la cui impronta coincideva con il
file di `origin/main` 35fea6183: nessuna modifica a transizioni, guardie,
await, CAS, ledger, audit o ricevute delle terapie.

È aggiornato il solo digest di `components/therapy-manager.tsx`; `syncCommit`
resta invariato perché nessuna sorgente della terapia cambia comportamento.
Modello, statechart, invarianti, limiti, testimoni e mutanti restano invariati;
il comando completo `npm run verify:therapy-status` è rieseguito sul manifest
aggiornato.
