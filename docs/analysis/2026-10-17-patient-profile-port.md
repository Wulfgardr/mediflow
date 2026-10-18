# Porta comune di lettura e aggiornamento del profilo paziente

Data: 2026-10-17. Base pubblica verificata:
`db98dcf0993d1cae69508186a6e3f7a8d3f2c984`.

Il profilo paziente ha ora un punto di ingresso applicativo condiviso
dagli adattatori Web, API v1 e paired:
[`lib/patient-profile-service.ts`](../../lib/patient-profile-service.ts).
La lettura e la preparazione dell'aggiornamento escono dalle route HTTP.
Il commit SQLite resta nell'operazione esistente
[`updatePatientOperation`](../../lib/patient-update-operation.ts), insieme
al controllo della versione, alle membership e all'audit obbligatorio.

Questo passo prepara il confine condiviso richiesto da WUL-582 e WUL-706.
Il servizio è ancora TypeScript e l'autorità di questi ingressi resta Node.
La migrazione del writer, la scelta IPC/FFI e il GO di WUL-736 conservano
i criteri e i prerequisiti di [ADR 0145](../adr/0145-rust-gpui-connected-client.md),
[ADR 0137](../adr/0137-rust-boundary-pilot-proposal.md) e del
[verbale del client collegato](./2026-10-17-rust-gpui-connected-client.md).

## Provenienza

Questa revisione è stata ricostruita dal commit pubblico dopo la perdita
dell'ambiente temporaneo. Il servizio e i test sono stati nuovamente
revisionati e verificati. Le prove qui riportate sono nuove esecuzioni su
questi file; non riattribuiscono ai nuovi byte risultati o hash precedenti.
La [ricevuta di validazione](../../experiments/gpui-patient-pilot/evidence/connected/patient-profile-port-validation.json)
contiene gli hash ricalcolati dei sorgenti, degli ingressi e dei log.

## Confine implementato

| Ingresso | Adattatore | Operazione comune |
| --- | --- | --- |
| Web GET/PUT | [app/api/patients/[id]/route.ts](../../app/api/patients/[id]/route.ts) | Lettura con proiezione `web`; aggiornamento dopo ammissione e parsing della versione. |
| API v1 GET/PUT | [app/api/v1/patients/[id]/route.ts](../../app/api/v1/patients/[id]/route.ts) | Proiezione `api-v1` e contesto audit dell'ingresso API. |
| Lettura paired | [lib/network-patient-read.ts](../../lib/network-patient-read.ts) | Proiezione `network`, limitata all'ambulatorio ammesso. |
| Aggiornamento paired | [lib/network-patient-write.ts](../../lib/network-patient-write.ts) | Aggiornamento comune dopo allowlist, verifica dei campi sigillati e confine paired. |

`readPatientProfile` conserva le tre proiezioni esistenti. Web riceve il
record Drizzle con le date `Date`; la serializzazione HTTP resta quella
corrente. API v1 mantiene la selezione esplicita dei campi e le date ISO,
senza aggiungere `deletedAt` o `deletionReason`. Paired conserva anche
questi due campi e richiede lo scope nel tipo di input e nella query.
I record eliminati restano assenti; quelli archiviati restano leggibili.

`updatePatientProfile` riusa il normalizzatore esistente e riceve il body
separatamente dal contesto costruito dall'adattatore: identificativo,
versione attesa, eventuale scope, preparazione del guard paired e callback
audit. Non introduce un registro di motori, un secondo modello del paziente
o una connessione SQLite aggiuntiva. Il servizio ricostruito misura 103
righe; considerando il servizio e i quattro adattatori, il codice di
produzione diminuisce di 20 righe nette. I sei nuovi test sono 166 righe.

## Invarianti preservati

L'ammissione HTTP resta negli adattatori correnti: sessione, ruolo,
capability, scope, stato dell'archivio e parsing precedono la porta comune
come prima. La porta è un confine fra moduli del servizio fidato, non un
sandbox contro codice ostile già in esecuzione nel processo dell'host.

Per Web e API v1, l'esistenza del paziente viene controllata prima della
normalizzazione, preservando il 404 per un paziente assente anche con
payload invalido. La transazione controlla nuovamente esistenza e versione:
la lettura preliminare non autorizza il commit. Per paired, filtro dei
campi e normalizzazione restano prima dell'ultimo guard asincrono.

Il contesto audit viene risolto dopo il guard paired, immediatamente prima
della chiamata sincrona a `updatePatientOperation`, senza un nuovo `await`
fra identità audit e commit. Il writer conserva la transazione SQLite
`immediate`, le verifiche autorevoli di versione e generazione, membership
e audit nella stessa unità atomica. Un fallimento dell'audit o delle
membership annulla anche la modifica del paziente e della versione.

Il body non può sostituire identificativo, scope, actor, ruolo, audit o
guard dell'host. Nel test diretto della porta, una `version` nel body non
prevale sulla `expectedVersion` del contesto. Le route HTTP continuano a
leggere la versione dal payload secondo il loro contratto, prima di
costruire quel contesto: il test non cambia questo contratto pubblico.

I campi `ENC:iv:data` attraversano la porta senza decifratura o ricifratura.
Paired continua a rifiutare valori sensibili in chiaro e campi AI esclusi
dalla sua autorità. Web/API v1 conservano la differenza fra note omesse,
`null` e stringa vuota. La stringa vuota non diventa implicitamente un
payload paired ammesso. Le risposte pubbliche non acquisiscono il record
interno `existing` restituito dall'operazione.

Un replay con versione obsoleta resta un conflitto 409 privo di effetti.
Non viene introdotto un ledger persistente di idempotenza, né un receipt
del client può attestare un commit. Una risposta persa continua a
richiedere rilettura e decisione esplicita secondo il contratto del client.

## Nuove prove sul contenuto ricostruito

Ambiente: Ubuntu 24.04.3 LTS, Linux x64, Node 24.19.0, ABI 137,
TypeScript 5.9.3, Next 16.3.8 e better-sqlite3 12.6.2. Le dipendenze
sono state reinstallate con `npm ci` dal lockfile invariato.

| Verifica | Esito osservato | Limite |
| --- | --- | --- |
| Porta comune, writer, audit, paired e autorità di commit | 119 casi individuali PASS; 0 falliti, saltati o cancellati. | SQLite e identità sintetiche; nessuna qualifica del writer Rust. |
| Sei nuovi test | Proiezioni, date epoch, cifrato, scope, lifecycle, spoofing, precedenza degli errori e guard sugli import delle route PASS. | Il cifrato delle unità è opaco; la crittografia reale è verificata via HTTP. |
| HTTP old, commit pubblico `db98dcf` | PASS su un archivio sintetico nuovo, da snapshot `git archive`. | Il checkout principale non viene modificato. |
| HTTP new, porta ricostruita | PASS sullo stesso harness e un secondo archivio nuovo. | Stesse invarianti su fixture equivalenti, non confronto binario di database con nonce casuali. |
| Typecheck completo | `tsc -p tsconfig.typecheck.json --noEmit --incremental false --pretty false` PASS. | TypeScript 5.9.3. |
| ESLint | PASS sui sette file TypeScript modificati, con `--quiet`. | Non attesta il lint dell'intero repository. |
| Inventario dei test | 1.061 file: 1.032 in suite, 29 esclusi con motivazione; COMPLETE. | Inventario, non esecuzione di tutte le suite. |

Ogni esecuzione HTTP effettua due aggiornamenti cifrati reali, via Web e
API v1, e verifica due eventi audit attribuibili. Rilegge e decifra con la
chiave del login, verifica tutti gli altri campi e le membership, conserva
l'audit precedente, controlla quattro replay obsoleti con 409 e due rifiuti
di modifica di un tombstone. Letture di pazienti attivi, archiviati ed
eliminati sono verificate su entrambi gli ingressi. Ogni run usa un archivio
sintetico proprio e un server loopback.

La suite include fallimenti indotti nell'audit e nelle membership, chiamate
Web/v1 concorrenti alla stessa versione e concorrenza da un secondo processo
SQLite. Gli hash nella ricevuta confrontano con la base il writer,
normalizzatore, guard di commit, audit, cifratura, schema e route paired.

I test con processi figli sono stati eseguiti fuori dal sandbox del runner:
un'anomalia dell'ambiente può riportare solo i nomi dei file al posto dei
casi. Il risultato qui richiede i 119 casi individuali osservati.

## Riproduzione

Dal checkout candidato, con le dipendenze del lockfile installate:

```bash
MEDIFLOW_DATA_DIR="$(mktemp -d /tmp/mediflow-profile-port-suite.XXXXXX)" node scripts/run-strip-types.mjs --test --test-concurrency=1 lib/patient-profile-service.test.ts lib/patient-update-operation.test.ts lib/patient-required-audit.test.ts lib/network-patient-write.test.ts lib/network-patient-commit-authority.test.ts

node node_modules/typescript/lib/tsc.js -p tsconfig.typecheck.json --noEmit --incremental false --pretty false

node node_modules/eslint/bin/eslint.js --quiet 'app/api/patients/[id]/route.ts' 'app/api/v1/patients/[id]/route.ts' lib/network-patient-read.ts lib/network-patient-write.ts lib/patient-profile-service.ts lib/patient-profile-service.test.ts lib/chatgpt-execution/execution-mac-qualification.ts

npm run check:test-selection
git diff --check
```

Per HTTP, eseguire separatamente nella base pubblica e nel candidato il
comando della [baseline cifrata](./2026-10-17-patient-notes-pilot.md#riproduzione),
con `MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT=scripts/patient-notes-pilot-http.test.mjs`,
archivi temporanei distinti, `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`,
`MEDIFLOW_LOCAL_AUTHORITY=0`, provider disabilitati e una porta loopback
libera per run. Usare credenziali sintetiche uniche. L'harness e gli ingressi
dei due run hanno gli hash registrati nella ricevuta.

## Annotazione TypeScript separata

Il recupero include una sola annotazione nella qualificazione Mac:
`const fields: PropertyDescriptorMap = ...`. Il controllo della
configurazione, i descrittori e i rami di esecuzione restano uguali.
Una nuova verifica con `transpileModule` di TypeScript 5.9.3, target
ES2017 e modulo ESNext, produce JavaScript identico prima e dopo:
29.984 byte, SHA-256
`e5f64015497b12b136f2915a1ca83aa5ac15c4274a8145cc46dc67dc642e3f9b`.
La ricevuta registra gli hash ricalcolati dei sorgenti e dell'emissione.
Questo non sostituisce la libreria runtime TypeScript; il confronto dei
compilatori CLI tsc-ts e TypeScript 7 resta separato.

## Passo successivo e ripristino

La porta rende sostituibili le operazioni applicative senza spostare oggi
l'autorità di commit. Il writer Rust richiede ancora protocollo e owner del
runtime espliciti, continuità di sessione e generazione, transazioni con
audit e membership equivalenti, prove sui processi reali e ripristino sullo
stesso archivio. WUL-573 e WUL-580 non sono dichiarati conclusi.

Resta inoltre l'autorità Swift locale opzionale descritta nel
[censimento delle autorità](../authority-census.md): con
`MEDIFLOW_LOCAL_AUTHORITY` la factory Apple può scegliere
`LocalPatientsDataSource` e gli store SQLite locali, fuori dall'audit
obbligatorio Node. Questa estrazione non ne prova l'attivazione e non ne
risolve la destinazione in WUL-582; non dimostra un unico writer per tutte
le superfici Apple.

Schema, formati cifrati, dipendenze e lockfile non cambiano. Il ripristino
del codice può reinserire gli adattatori della base senza convertire dati.
Il doppio test HTTP verifica le revisioni separatamente; non attesta un
downgrade installato sul medesimo database, un arresto a ogni istruzione o
il rollback di un'operazione con risposta perduta. Le prove GPUI restano
nei rispettivi verbali.
