# ADR 0080: serializzare le schema guard SQLite al bootstrap

Date: 2026-07-15  
Status: Proposed

Related: [ADR 0066](./0066-patient-soft-delete-lifecycle.md), [ADR 0068](./0068-cross-platform-runtime-windows-linux.md)

---

## Problema

`next build` valuta i moduli server in piu processi. Ogni import di
`lib/db-server.ts` apre lo stesso database locale, imposta i pragma e applica
le schema guard additive. I worker possono quindi eseguire contemporaneamente
`journal_mode`, `ALTER TABLE` e `CREATE INDEX`, producendo errori intermittenti
`SQLITE_BUSY` o avvisi `duplicate column` durante una build altrimenti valida.

## Contesto

Emendamento 0.8.6, 6 settembre 2026: il primo controllo auth puo avviare il
bootstrap quando mancano sia il database corrente sia quello legacy e la
cartella dati e completamente vuota. La prima apertura di `/` deve raggiungere
il setup senza una richiesta API preparatoria. Se nella cartella ci sono altri
file, l'assenza di `medical.db` conserva invece la risposta `DB_MISSING` e il
percorso di recupero esplicito; uno schema esistente sconosciuto resta negato.

SQLite resta l'unico storage autorevole e le schema guard runtime restano il
meccanismo operativo per aggiornare database esistenti. La soluzione deve
funzionare per build, avvio e reopen dopo repair, senza leggere dati reali nei
test, senza lockfile esterni e senza disabilitare le guard durante il runtime.

## Opzioni

1. Limitare Next.js a un solo worker durante ogni build.
2. Dare a ogni worker un database sintetico separato.
3. Impostare prima il `busy_timeout` e serializzare le schema guard nello stesso
   database con una transazione SQLite `IMMEDIATE`.

## Trade-off

- Opzione 1: riduce il parallelismo e dipende da un controllo non canonico del
  framework, senza proteggere altri bootstrap multiprocesso.
- Opzione 2: isola bene la build, ma introduce una seconda procedura di
  provisioning e non irrobustisce l'avvio concorrente sul database reale.
- Opzione 3: usa l'arbitraggio nativo del file SQLite, conserva un solo percorso
  di bootstrap e fa attendere i processi concorrenti invece di farli scrivere
  insieme; il costo e una breve serializzazione solo all'apertura.

## Decisione

Adottiamo l'opzione 3.

- `busy_timeout` viene configurato prima del primo pragma che puo richiedere un
  lock di scrittura.
- Il passaggio a WAL ritenta soltanto errori SQLite di lock entro lo stesso
  limite di cinque secondi; errori diversi o lock persistenti restano espliciti.
- L'intera batteria di schema guard viene eseguita dentro una transazione
  `IMMEDIATE`, cosi un solo processo alla volta puo controllare e modificare lo
  schema.
- Lo stesso helper viene usato al boot e dopo un database swap.
- Le singole guard restano additive e idempotenti; nessun errore di schema viene
  nascosto o trasformato in una modifica distruttiva.

### Emendamento 2026-09-04: database realmente nuovo

Il bootstrap serializzato deve coprire anche il primo avvio senza un
`medical.db` preesistente.

- Dentro la stessa transazione `IMMEDIATE`, prima delle schema guard, il runtime
  controlla se SQLite non contiene alcuna tabella applicativa.
- Solo in quel caso crea il minimo schema base necessario alle guard tramite
  `lib/sqlite-new-database-bootstrap.ts`; subito dopo esegue le guard canoniche.
- Il bootstrap non crea utenti, ambulatori o dati clinici e non incorpora un
  database nel bundle.
- Un database non vuoto, anche se parziale o sconosciuto, non viene sintetizzato
  né ricostruito: prosegue sul percorso ordinario e fallisce esplicitamente se
  non soddisfa i vincoli.
- I file `drizzle/*.sql` restano artefatti storici e non vengono replayati al
  runtime.
- La regressione usa una directory dati realmente vuota e la guardia anti-drift
  ora verifica lo stesso percorso di bootstrap del prodotto.

## Emendamento 2026-10-10: apertura esplicita e schema versionato (C09)

Questo emendamento sostituisce le precedenti descrizioni dell'apertura durante
l'import e dell'ammissione di qualsiasi database vuoto.

| Responsabilità | Owner e ordine |
| --- | --- |
| Import e connessione applicativa | `lib/db-server.ts`: import inerte; `openDbServer()` risolve l'archivio, riconcilia il journal di swap, considera l'eventuale adozione legacy consentita e chiama l'apertura versionata. La build usa soltanto memoria. |
| Ammissione e migrazione | `lib/sqlite-schema-open.ts`: timeout e FK ON, transazione IMMEDIATE, identità/versione/integrità, originale verificato, inizializzatore, convergenza, validazione e stamp atomico. WAL segue il commit. |
| Definizione runtime corrente | `lib/sqlite-schema.ts`: `initializeSqliteSchema()` orchestra base fresh, guard additive e upgrade della currentness allegati. Il DDL prima incorporato in `db-server` è qui; gli helper di dominio restano richiamati da questo owner. |
| Convergenza del default storico | `lib/sqlite-observation-schema-upgrade.ts`: sotto la transazione del chiamante ricostruisce soltanto la forma riconosciuta di `observations` senza default `updated_at`, mantenendo dati e FK attive. |
| Originale recuperabile | `lib/sqlite-repair.ts`: snapshot SQLite autonomo, integrità/FK verificate, pubblicazione senza sovrascrittura e sincronizzazione durevole prima del DDL. |
| Prima installazione nativa | `scripts/native-first-install.mjs`: prenota un database senza tabelle tramite l'header condiviso in `native-first-install-contract.json`; il runtime consuma la prenotazione insieme allo schema. |
| Storia e dichiarazioni ORM | `drizzle/*.sql` resta immutato e non viene replayato dal runtime; `lib/schema.ts` descrive l'ORM e viene confrontato con il bootstrap reale. |
| Riparazione e swap | Il protocollo esistente riconcilia i propri artefatti prima dell'apertura; il reopen usa la stessa ammissione versionata. Il lifecycle della sostituzione appartiene a C15 e ADR0142. |

La versione SQLite corrente è `user_version=1`. La prima installazione ammette
un file creato esclusivamente dal processo in una directory vuota, oppure la
prenotazione nativa riconoscibile. Un file preesistente di zero byte o un
SQLite vuoto senza prenotazione non diventa un archivio nuovo. Un processo
concorrente attende il primo writer entro il limite esistente di cinque secondi.

Le origini di aggiornamento dichiarate sono gli schemi non versionati
(`user_version=0`) delle release sorgente v0.5.0, v0.6.0, v0.7.0, v0.7.2,
v0.7.3, v0.8.0, v0.8.2 e v0.8.6 ricostruiti dai rispettivi SQL pubblicati e
dalle guard dello stesso tag; per v0.8.6 è coperto anche il bootstrap fresh.
I pin e l'ordine preciso sono nel [manifest delle origini](../../scripts/fixtures/schema-convergence/README.md).
Questa lista non autorizza schemi modificati a mano o ogni possibile storia
di provisioning: l'ammissione richiede che la migrazione in avanti raggiunga
lo schema canonico, compresi indici, FK, CHECK e trigger; viste inattese sono negate.

Per un'origine ammessa l'originale `medical.db.schema-original-v0-<uuid>.db`
è verificato e pubblicato prima della prima modifica. Schema e versione si
confermano insieme. Al riavvio, la versione 1 viene validata senza DDL,
backfill o nuove copie; un suo drift non viene riparato automaticamente.
Interruzione prima del commit conserva lo schema precedente tramite rollback;
un originale già pubblicato resta disponibile. Versione futura, corruzione,
lock persistente o schema non riconosciuto impediscono l'apertura operativa.

### Percorso per archivi non ammessi

Conservare l'archivio e gli eventuali sidecar originali, senza azzerare la
versione, cancellare marker o creare un database vuoto al loro posto. Fermare
l'app e i processi che possiedono connessioni prima di un recupero offline.
Un archivio più recente richiede la versione compatibile di MediFlow. Per
origini non riconosciute, l'ispezione va eseguita su una copia integra in sola
lettura con strumenti compatibili; l'eventuale recupero passa dal percorso
esplicito di backup/ripristino dopo verifica della copia e dell'audit.
L'apertura ordinaria non autorizza una sostituzione automatica né una migrazione
all'indietro. La validazione C09 usa esclusivamente fixture sintetiche isolate.

## Conseguenze

Build e avvii multiprocesso non eseguono piu migrazioni concorrenti sullo stesso
file. Un bootstrap attende il writer corrente entro il timeout dichiarato; un
lock che supera il timeout continua a fallire in modo esplicito. Un primo avvio
su directory dati vuota crea lo schema applicativo senza seed e raggiunge il
normale onboarding. Il throughput runtime dopo il bootstrap non cambia.

## First Thin Slice

1. Riordinare i pragma per configurare il timeout prima di `journal_mode`.
2. Serializzare `applySchemaGuards()` con una transazione `IMMEDIATE` al boot e
   al reopen.
3. Aggiungere una regressione multiprocesso sullo stesso database sintetico e
   verificare tre build standard consecutive piu il bundle macOS Release.
