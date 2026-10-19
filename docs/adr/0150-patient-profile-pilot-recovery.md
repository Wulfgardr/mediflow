# ADR 0150 / BT-06 — Recupero del pilota e continuità delle ricevute

Data: 2026-10-19. Stato: Accepted con l'integrazione protetta; review indipendente favorevole.
Riferimenti: WUL-579, WUL-730, ADR 0144 archive-generation, ADR 0149.

## Problema

Il backup completo C15 conserva SQLite, chiavi avvolte, audit e journal del
pilota. Il ripristino cambia invece la generazione dell'archivio e rimuove i
binding delle sessioni precedenti: il dato recuperato non può riattivare
un'autorizzazione. Il candidato delle note includeva quella generazione anche
nell'impronta durevole dell'ambito della ricevuta. Dopo un ripristino, un nuovo
accesso legittimo trovava l'evento ma non riusciva più a verificarne la ricevuta.

## Decisione

Separare l'identità durevole dell'esito dall'ammissione corrente. L'impronta
di ambito del journal lega autore, paziente e ambulatorio. Riferimento,
impronta del comando, contenuto dell'esito e controllo dei metadati restano
quelli dell'ADR 0149. Il reader verifica la generazione **corrente** attraverso
la transazione che legge l'audit, prima di cercare la ricevuta. L'ingresso Web
continua a richiedere sessione, account, generazione e ambito correnti.

Questa separazione riguarda il journal candidato, mai pubblicato o distribuito.
Non cambia il formato della ricevuta, del backup o dello schema e non introduce
un convertitore per journal distribuiti. La ricevuta è una lettura di un fatto
registrato nell'archivio autorevole; non costituisce un permesso. La lettura non
riattiva selezione, attestazione, review o proof e non può creare un evento.
Un comando già commesso può restituire il suo esito, senza nuova scrittura;
una preparazione precedente al ripristino non può essere confermata.

Si riusano esclusivamente `createRecoverySnapshot`, `encryptRecoveryBackup`
e `restoreRecoveryBackup`. Il recupero rimane offline, su destinazione vuota,
con kit e chiave corretti, esclusione dei partecipanti e sostituzione SQLite
qualificata. La generazione viene ruotata e le sessioni precedenti restano
invalide. Non si aggiungono un writer, un registro o un formato di backup.

## Compatibilità e ritorno al percorso precedente

Il GET ordinario e la query scoped leggono gli stessi dati recuperati. Il
normale PUT del profilo rimane utilizzabile dalla versione appena riletta,
anche ritirando la capacità nuova. Non deve decifrare o convertire dati,
arretrare lo schema o rieseguire il comando di cui si è persa la risposta.
Il ripristino C15 non dipende dal nuovo reader del journal delle note.

Conservare la vecchia generazione renderebbe nuovamente ammissibili contesti
superati. Riscrivere gli eventi al restore modificherebbe lo storico append-only.
Entrambe le alternative sono escluse; mantenere il digest legato alla vecchia
generazione lascerebbe invece irrecuperabile l'esito del pilota.

## Prova discriminante

`lib/patient-profile-recovery.test.ts` usa chiavi e dati sintetici, il vero
salvataggio riveduto e SQLite reale. Produce backup prima e dopo il commit,
recupera ciascuno in una destinazione vuota e confronta tutte le tabelle salvo
la generazione e i binding di sessione, intenzionalmente invalidati.

Un processo nuovo usa gli owner reali di sessione e gli handler correnti per
leggere sia dal percorso ordinario sia dalla query scoped. Recupera la stessa
ricevuta soltanto quando presente nel backup, senza ulteriori effetti; rifiuta
sessione, generazione, preparazione o ambito precedenti/non pertinenti.
La prova include backup corrotto con destinazione invariata e una successiva
modifica ordinaria. L'errore atteso sulla baseline è il conflitto della ricevuta
dopo la rotazione della generazione. La prova è specifica del pilota: non
estende la qualifica dei pacchetti installati o la politica di disaster recovery.

## Evidenza locale del candidato

Su Linux, con Node 24.19.0 e il runner canonico a processi isolati, il drill
fallisce sul runtime della base `dac6b676` con `409` invece di `200` nel recupero
della ricevuta dopo restore. Con questa correzione passa, compreso il diniego
diretto del reader transazionale con generazione assente o precedente.

La selezione `patient-profile-recovery.test.ts`, `patient-profile-review.test.ts`,
`patient-profile-update-dispatch.test.ts` e `patient-update-operation.test.ts`
supera 55 prove. Il controllo TypeScript completo, il lint dei file cambiati e
`check-test-selection` passano; quest'ultimo include il nuovo drill nella suite
canonica. Queste sono verifiche locali del codice candidato. Review indipendente,
integrazione, CI e funzionamento dei pacchetti installati restano evidenze distinte.
