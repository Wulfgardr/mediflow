# ADR 0153 — Preparazione delle scale paired e autorità corrente del diario

- Stato: Accepted per l'implementazione WUL-771; integrazione dopo prove e review indipendente
- Data: 2026-10-19
- Riferimenti: WUL-771, WUL-767; ADR 0053, 0076, 0118, 0145, 0146

## Mandato e decisione

La vista Scale GPUI deve usare il calcolo TypeScript già qualificato dal Web.
I cinque strumenti attivi, le domande, le risposte ammesse, l'interpretazione
versionata e i limiti d'uso restano quelli di `scale-definitions`,
`scale-validation`, `scale-submission` e `scales/scale-use-contract`.
Il vecchio identificativo `tinetti` conserva soltanto il suo significato storico.
Non si duplicano scoring o interpretazione nel client Rust e non si ricalcola
lo storico salvato. La proposta di sospensione presente nel registro dei limiti
d'uso rimane `hold-proposed-not-enforced`, senza diventare una nuova policy.

L'incremento host espone il catalogo e una preparazione in sola lettura. La
registrazione usa il writer ordinario `entry-write-operation` e la tabella
`entries`, già condivisi con Web e Swift. Non aggiunge una tabella, un writer,
un endpoint di commit delle scale o un canale Headless. GPUI applicherà la
soglia a due tempi del diario: revisione della bozza, conferma esplicita e
rilettura integrale prima di presentare la valutazione come registrata.

## Ingressi e capacità esplicite

| Ingresso | Ammissione e risultato |
| --- | --- |
| `GET /api/v1/network/scales` | Dispositivo paired, modalità home-base, sessione operatore corrente, scope risolto dall'host e capacità già esistente `network.catalogs.readonly`. Restituisce solo le definizioni serializzabili dei cinque strumenti attivi. |
| `POST /api/v1/network/patients/{id}/scales/prepare` | Stessa ammissione, più `network.replica.readonly-patients`, selezione corrente del profilo e membership nel medesimo ambulatorio. Valida risposte e revisioni, poi restituisce la submission canonica in bozza. Non richiede né attribuisce la capacità di scrittura. |
| `POST /api/v1/network/patients/{id}/entries` esistente | La conferma client sigilla titolo, contenuto e metadata e usa `type: scale`. Rimane necessaria `network.replica.write-clinical-diary`; il risultato della preparazione non è un permesso di scrittura. |
| `GET /api/v1/network/patients/{id}/entries/{entryId}` esistente | Rilettura con `network.replica.readonly-clinical-diary`, nel contesto corrente. Il client decifra e confronta identità, tipo, titolo, contenuto, metadata, data, setting e versione prima di dichiarare il successo. |

Le prime due route rifiutano parametri di query. Le credenziali e le capacità
rimangono quelle dell'ammissione paired esistente; non esiste un grant nuovo
implicito. L'header `x-mediflow-expected-ambulatory-id` conserva la semantica
di asserzione sullo scope già autorizzato, senza selezionare l'ambulatorio.
I nuovi contratti richiedono che il client supporti la relativa versione,
senza ripiegare su un calcolo locale se il servizio manca.

## Contratto di lettura e preparazione

Il catalogo ha `contractVersion: 1`, `preparationVersion`, `catalogRevision`
e `scales`. Ogni scala contiene `id`, `title`, `description`, domande con
`id`, `text`, `type: choice` e `options`, la provenienza `instrument` quando
presente e il `useContract` vigente. Funzioni e strumenti ritirati non sono
serializzati. Una futura definizione con un tipo di domanda non supportato
richiede un'evoluzione esplicita: questo contratto fallisce chiuso.

`catalogRevision` è SHA-256 del catalogo serializzabile e della versione
esplicita del preparatore, con ordine deterministico. Non è una firma né
un'approvazione clinica. `preparationVersion` deve cambiare se cambia la
semantica del calcolo, della validazione o della submission; il digest copre
automaticamente domande, opzioni, provenienza e registro d'uso. Le versioni
editoriali locali e le versioni delle interpretazioni restano distinte.

Il POST accetta esattamente `contractVersion`, `scaleId`, `answers`,
`expectedCatalogRevision`, `expectedPatientVersion`, `expectedSelectionEpoch`.
Il corpo JSON ha un limite inclusivo di 65.536 byte UTF-8, applicato dal reader
bounded esistente dopo l'ammissione. Le risposte sono numeri espliciti ammessi
dalle opzioni; nessuna imputazione, conversione di stringhe o domanda estranea.
Campi come `score`, `interpretation`, `metadata`, autore o paziente nel corpo
vengono respinti. `prepareScaleSubmission(scaleId, answers)` resta l'unico
calcolo chiamato dalla preparazione.

Il paziente viene dalla route. Il client deve aver aperto il profilo attraverso
la `profile-query` esistente: la preparazione usa lo stesso owner di selezione,
senza selezionare da sé un paziente e senza emettere lease o handle aggiuntivi.
`expectedSelectionEpoch` è l'epoch restituito dall'host, distinto dall'epoch
locale che la finestra usa per ignorare risposte tardive.
Sessione, dispositivo, ruolo, capacità, generazione archivio, scope, membership,
versione del paziente ed epoch vengono verificati dopo l'ultima attesa e prima
di consegnare il risultato. La lettura avviene in una transazione SQLite senza
mutazioni cliniche; la sezione critica della selezione non contiene `await`.
Le revisioni fornite dal client sono solo veto su un contesto già autorizzato.

Il risultato contiene `contractVersion`, `preparationVersion`,
`catalogRevision`, `status: draft`, il contesto osservato
(`patientId`, `ambulatoryId`, `patientVersion`, `selectionEpoch`) e la
`submission` canonica (`title`, `content`, `metadata`). Tutte le risposte,
compresi gli errori, sono `Cache-Control: no-store`. Corpo malformato o risposte
non valide producono 400; autenticazione 401; capacità/scope negati 403;
revisioni o selezione non correnti 409; corpo eccessivo 413; indisponibilità
503. Nessun errore include risposte, contenuto clinico o dettagli interni.

## Garanzia della cifratura e della conferma

Il server riceve risposte chiuse per il calcolo deterministico, le mantiene
solo durante la richiesta e non le scrive in log, audit o database. Non riceve
la master key. Il client autorizzato trattiene la submission, la mostra alla
persona, la cifra con il percorso già esistente e conserva identità e payload
del tentativo fino alla rilettura o alla risoluzione di un esito incerto.
Nessun nuovo PIN o trasferimento di chiavi è introdotto.

Come nel confine keyless dell'ADR 0076, l'host non attesta che il plaintext
dentro il ciphertext inviato da un client alterato coincida con la bozza
calcolata. Il writer controlla formato ENC e contenitore ordinario; l'integrità
del client e il confronto dopo decifratura fanno parte della garanzia della
UI. Non si presenta una preparazione come attestazione crittografica,
autorizzazione umana del server o prova dell'avvenuto salvataggio.

## Raccordo nel writer e impatto ordinario

`createEntryOperation` e `updateEntryOperation` ricevono un guard opzionale
costruito dall'host, mai dal corpo JSON. Gli adapter paired lo preparano con
`prepareNetworkPatientCommitGuard` e la capacità di scrittura del diario.
Dentro la stessa transazione `IMMEDIATE`, prima di cercare duplicati o
modificare righe, il guard ricontrolla generazione archivio, pairing/token,
modalità, capacità, identità della sessione, ruolo corrente e scope.
Seguono le verifiche già esistenti di padre, membership, CAS, scrittura e audit
obbligatorio. Il preparatore del guard può ricevere un insieme chiuso e non
vuoto di capacità scelte dall'host per le due letture e le richiede tutte.
Una lista vuota, malformata o duplicata è respinta, senza fallback o nuove
capacità.

Questo raccordo riguarda **tutti i POST e PUT paired del diario (E-05/E-04)**,
comprese note ordinarie e lifecycle delle voci. Una revoca durante la lettura
del body deve impedire anche il replay idempotente. Payload, versioni, audit,
idempotenza su ID e ciphertext identici e semantica di archiviazione restano
quelli dell'ADR 0053. Gli ingressi Web e local-v1 non ricevono implicitamente
una policy paired; i loro percorsi e contratti rimangono gli esistenti.
La bozza di scala non aggiunge un CAS del profilo al writer ordinario: GPUI
deve invalidarla quando cambia il contesto osservato e ricontrollarlo prima
della conferma; il writer garantisce al commit la propria autorità corrente,
il padre ammesso e la membership, non una nuova ricevuta del profilo.

## Finita quando e prove proporzionate

- Catalogo serializzabile e preparazione usano i vettori clinici sintetici
  esistenti. Una prova HTTP rappresentativa confronta l'intera submission
  con il calcolatore TS, verifica il rifiuto di input inventati o incompleti
  e dimostra l'assenza di scritture cliniche/audit.
- Una prova con SQLite e sessione/pairing reali cambia autorità o selezione
  mentre il body è sospeso: niente bozza consegnata e niente scrittura negata
  accettata. Il negativo del diary fallisce sul writer precedente al guard.
- La stessa prova registra ciphertext AES sintetico nel writer esistente,
  rilegge e confronta il plaintext, verifica il retry idempotente senza altro
  audit e un guasto audit con rollback. La suite `entry-required-audit`
  conserva le regressioni delle superfici ordinarie, senza duplicarne la matrice.
- OpenAPI, mappa delle autorità, E-04/E-05 e indici documentali descrivono il
  raccordo. Passano lint, typecheck, build, never-regress, claims, drift OpenAPI
  e i tre smoke network richiesti da CONTRIBUTING; review indipendente sul
  diff finale prima della pubblicazione.

Questa fetta qualifica il confine host. La consegna della vista GPUI e dei suoi
stati, la prova della soglia e della rilettura nella UI costruita, accessibilità,
larghezze e funzionamento sui sistemi richiesti restano verifiche della
composizione client di WUL-771/WUL-767. Un test Node non le sostituisce.
