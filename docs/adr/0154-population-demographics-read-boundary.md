# ADR 0154 — Analisi demografica della popolazione e calendario del client

Data: 2026-10-19. Stato: Proposed; documento e dipendenza approvati per
implementazione, accettazione finale dopo review e integrazione protetta.
Riferimenti: WUL-771, ADR 0145, ADR 0146, ADR 0151, ADR 0152.

## Risultato e confine

La prima lettura applicativa di Analisi risponde a una domanda: quante schede
attive dell'ambulatorio corrente sono nella fascia d'età scelta e quante sono
ADI. L'host riusa `buildAnalyticsStats` di `lib/patient-analytics.ts` e restituisce
solo la proiezione demografica. Il client presenta il risultato senza calcolare
età, fasce o aggregati clinici in Rust.

Questo incremento appartiene al mandato completo WUL-771. Non completa da solo
la schermata Analisi: diagnosi, audit e qualifica della vista sulle piattaforme
restano risultati distinti. La funzione Web continua a essere il riferimento
delle regole di conteggio; non si modifica la pagina Web in questo contributo.

`birthDate`, `isAdi` e `isArchived` sono disponibili in chiaro nell'archivio
attuale. `diagnoses` viene invece decifrato dal client sbloccato prima del calcolo
Web. La nuova lettura non seleziona diagnosi, ciphertext, note, identificativi
personali o profili completi. Non restituisce `withDiagnoses: 0` o
`topDiagnoses: []`: sarebbero falsi zeri derivati da dati non letti.

L'audit amministrativo conserva il proprio ingresso e la policy admin/Web di
`/api/system/audit`. La capability di lettura dei pazienti non lo concede.
Le diagnosi complete richiederanno un successivo confine di esecuzione dello
stesso TS nel contesto già autorizzato e sbloccato che decifra i dati; questo
ADR non autorizza trasferimenti impliciti di chiavi o dati decifrati all'host.

## Ingresso e contratto

Ingresso proposto: `GET /api/v1/network/analytics/demographics`.
Operazione: `population-demographics.read.v1`, `contractVersion: 1`.
È una lettura paired nominata, non un ingresso local-token o un motore di query.

I soli parametri ammessi, ciascuno presente una volta, sono:

| Parametro | Significato e validazione |
| --- | --- |
| `minAge` | Intero decimale da 0 a 120. |
| `maxAge` | Intero decimale da 0 a 120; estremi invertiti normalizzati dalla funzione canonica. |
| `timeZone` | Nome IANA riconosciuto da `Intl` dell'host, compreso `UTC`; stringa ASCII non vuota, massimo 100 caratteri. Offset numerici, spazio o zona non riconosciuta sono negati. Nessun ripiego sul fuso dell'host. |

Non sono ammessi altri parametri, selezioni di pazienti, proiezioni libere,
`includeDeleted`, provider, ruoli, chiavi, dati clinici o istanti scelti dal
chiamante. Il client invia le asserzioni già previste per ambulatorio e archivio
correnti; questo nuovo ingresso richiede entrambe e non le tratta come grant.

La risposta contiene solamente:

- `operation` e `contractVersion` fissi;
- `scope.ambulatoryId` e `scope.archiveGeneration`, risolti e verificati dall'host;
- `ageRange` normalizzato e `timeZone` riconosciuto/canonicalizzato;
- `observedAt`, istante UTC ISO determinato dall'host per quel calcolo;
- `stats.totalInRange`, `stats.withBirthDate`, `stats.withoutBirthDate`,
  `stats.adiCount` e `stats.ageDist` con i quattro bucket canonici.

Non crea ricevute, handle, lease, revisioni della popolazione o autorità di
scrittura. È uno snapshot osservato, senza promessa di validità dopo la risposta.
La revisione del software `/network/revision` non è una revisione dei dati.
Il JSON UTF-8 ha budget 4096 byte, senza dati parziali o troncamento, e tutte le
risposte dell'ingresso sono `Cache-Control: no-store`.

La route usa il runtime Node e delega al servizio host. Ammissione ordinaria
prima della validazione applicativa; query non valida: 400 con errore stabile e
generico. Pairing/sessione non ammessi: 401; capability/scope non ammessi: 403;
archivio sostituito o asserzione di archivio non corrente: 409 con il contratto
`ARCHIVE_REPLACED` esistente. Le altre condizioni riusano i dinieghi correnti.
Budget ecceduto: 413; errore interno: 500 senza dettagli di SQL, input o record.
Una popolazione vuota produce 200 e conteggi zero; un diniego non diventa `[]`
né un'analisi vuota riuscita.

## Ammissione corrente e popolazione

Il servizio riusa `requireNetworkCapabilityContext` con la capability fissa
`network.replica.readonly-patients`: pairing, modalità, sessione operatore e
scope mantengono le policy correnti. Il pairing da solo non ammette la lettura.
Le sessioni native restano legate al dispositivo autenticato; il canale Web,
quando ammesso dal resolver corrente, usa il proprio owner fisico.

Dopo tutti gli await, la stessa operazione applica
`prepareNetworkPatientCommitGuard(context, 'network.replica.readonly-patients')`
prima e dopo query/calcolo in una transazione di sola lettura e senza ulteriori
await. Il guard esistente controlla generazione, pairing originale, token,
piattaforma, modalità, capability, sessione originale corrente, utente/ruolo e
scope/header. Il suo nome storico non concede una scrittura: questa operazione
esegue solo SELECT. La firma string esistente basta; questo contributo non
modifica l'helper condiviso né introduce un secondo controllo di autorizzazione.
L'asserzione della generazione inviata dal client deve inoltre corrispondere
alla generazione della sessione ammessa e dell'archivio corrente.

Non si usa l'owner della selezione del singolo paziente per autorizzare la
popolazione; non si seleziona un paziente, apre un profilo o crea una review.
La membership è quella paziente–ambulatorio già autorizzata dalle liste paired,
non una nuova policy RBAC dell'operatore.

La query seleziona soltanto `birthDate`, `isAdi`, `isArchived`, tramite join su
`patientsToAmbulatories`, predicato dello scope e `activePatients()` per escludere
i tombstone. `isAnalyticsPatient` esclude poi gli archiviati con la semantica
canonica, inclusi i valori nulli. Il vecchio `patients.ambulatoryId` non sostituisce
la relazione M2M. La sua chiave composta evita contributi duplicati nello scope.
Nessun limite silenzioso, pagina di roster o filtro di ricerca del client può
trasformarsi nella popolazione analizzata.

Le regole restano quelle di `buildAnalyticsStats`: copertura delle date prima
del filtro; data assente/non valida esclusa da età e ADI; estremi inclusivi;
ADI solo nella fascia; età 80 in `65-80`, oltre 80 in `80+`.
La lettura non modifica cartella, membership, configurazione o audit clinico.

## Calendario: adattatore ufficiale, non nuovo algoritmo

Il Web passa oggi `differenceInYears` di `date-fns` nel calendario locale del
browser. Il nuovo ingresso conserva quel calendario come dato esplicito del
client, mentre l'istante del calcolo proviene dall'host. Le date di nascita
mantengono gli istanti memorizzati: non vengono riscritte o reinterpretate come
nuove date UTC. Non si modifica `process.env.TZ` condiviso e non si calcola l'età
con divisioni, sottrazioni di anni o una copia Rust/Swift dell'algoritmo.

Il repository ha già `date-fns` 4.1.0 nel lockfile e nessuna dipendenza
`@date-fns/tz` o `@date-fns/utc`. Si propone una sola nuova dipendenza runtime,
`@date-fns/tz` **1.5.0**, fissata esattamente e verificata nel registro npm
ufficiale il 19 ottobre 2026. Licenza MIT; nessuna dipendenza runtime, peer od
opzionale e nessuno script lifecycle dichiarato. Il pacchetto pubblicato misura
25 236 byte compresso e 100 524 byte estratto, inclusi sorgenti e dichiarazioni:
non sono misure del bundle finale. L'integrità viene fissata nel lockfile.

Il README distribuito e l'API ufficiale documentano `tz` come contesto `in`
compatibile da `date-fns` 4. Il sorgente 4.1.0 già installato di
`differenceInYears` normalizza entrambe le date tramite `options.in`. Il raccordo
proposto verso il parametro già iniettato in `buildAnalyticsStats` è:

```ts
const context = tz(validatedTimeZone);
const age = (now: Date, birthDate: Date) =>
    differenceInYears(now, birthDate, { in: context });
```

Sono interessati manifest e lockfile, un raccordo di calendario del servizio e
le prove; nessun runtime JS nativo o pacchetto di timezone per Rust, nessun
aggiornamento di `date-fns`, nessuna tabella o migrazione. `@date-fns/utc` non
copre il requisito dei calendari client diversi da UTC. Un adattatore manuale
basato su `Intl` richiederebbe nuove regole sui setter/calendari: si preferisce
quello ufficiale che la funzione canonica già sa consumare.

Fonti primarie: [API ufficiale tz](https://github.com/date-fns/tz#tz),
[pacchetto ufficiale 1.5.0](https://www.npmjs.com/package/@date-fns/tz/v/1.5.0),
[sorgente corrente del monorepo](https://github.com/date-fns/date-fns/tree/main/pkgs/tz).
Prima dell'approvazione sono stati letti anche README e `tz/index.js` del tarball
npm 1.5.0, senza installarlo nel progetto o eseguirne codice. L'implementazione
approvata fissa ora il pacchetto nel manifest e nel lockfile.

## Prima prova verificabile e gate

La prima prova attraversa route, ammissione reale, SQLite sintetico e aggregatore
canonico. Include due ambulatori, membership M2M, paziente condiviso, esterno,
archiviato, tombstone, date mancanti e ADI dentro/fuori fascia. Verifica la
proiezione SQL dei soli tre campi e l'assenza di letture di dettaglio/ciphertext;
la sola assenza del campo nel JSON non è sufficiente.

Un'attesa controllata prima del segmento finale permette di revocare sessione,
pairing/capability, ruolo o archivio e provare il diniego sul contesto originale.
I dinieghi e gli errori lasciano invariati cartella, membership e audit clinico.
Popolazione vuota e query malformata hanno esiti distinti. Le prove di calendario
confrontano l'adattatore con la stessa funzione date-fns eseguita in processi
isolati con fuso iniziale esplicito: compleanno, anno bisestile, istanti a cavallo
del giorno e zone con regole storiche/DST. Il probe discriminante deve fallire
con il calendario host implicito della baseline, senza cambiare il TZ del
processo che serve richieste concorrenti.

Il diff di implementazione documenta l'endpoint in OpenAPI, aggiorna i censimenti
applicabili di route/autorità e import DB senza deroghe generiche, e conserva la
selezione dei test. Si eseguono i gate richiesti da CONTRIBUTING: lint, typecheck,
build, never-regress, claims, OpenAPI drift e i tre smoke home-base read/write/
diary-write, oltre alle prove del nuovo confine. Nessun writer viene cambiato.

La verifica host e l'integrazione Git sono distinte dalla successiva vista GPUI,
dai suoi stati di loading/empty/offline/stale/denied/error, dal ritiro delle
risposte tardive e dalla qualifica sui sistemi richiesti. WUL-771 resta aperta
fino alla consegna del suo mandato completo.
