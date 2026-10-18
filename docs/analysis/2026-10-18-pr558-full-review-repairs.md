# PR #558 — correzioni dopo la review dell'intero diff

18 ottobre 2026, UTC. Consegna **r08ef12a**, steering **s20261018merge**.
Questo documento registra i file e le prove locali preparati dopo
`e51a86e9f23934ef35815f0a078b8500886fbc91`. La
[PR #558](https://github.com/Wulfgardr/mediflow/pull/558) contiene la
disposizione indipendente sulla revisione pubblicata, gli esiti CI effettivi
e, dopo l'integrazione, SHA e controlli di `main`. Questo verbale non
anticipa quegli esiti e non riattribuisce alla nuova head le prove di e51.

## Risultato della review iniziale

Un revisore distinto dagli autori ha esaminato **tutti i 282 file** della
PR a e51, oltre ai callees e ai contratti pertinenti. Il perimetro include
auth, chiavi, trasporto, autorità delle scritture, audit, servizio paziente,
GPUI, guard, workflow, contratti, dipendenze e prove generate. L'inventario
REST è stato riconciliato con i blob della head e dell'integrazione reale
`59172192c50846eef4006e757dde07c186531099`, su `main`
`2dde0c0503abf828b99d73d7129cb7beed733044`, comprensivo di #560–562.
La base restituita dai metadati della PR era storica: non è stata usata
come sostituto del `main` effettivo.

La review ha controllato integralmente i sorgenti cambiati e le famiglie
di artefatti. Per i 42 PNG pubblicati ha verificato hash e struttura,
ispezionando visivamente 13 campioni; ha ripetuto 25 confronti offline
fra report JS/Rust, tutti PASS. Non è una review del codice di tutte le
dipendenze transitive, né una nuova qualifica visiva nativa. Il primo esito
era **changes requested**, per i tre rilievi seguenti.

| Rilievo | Causa osservata | Correzione |
| --- | --- | --- |
| TA-1, scope | Il preflight dell'identità e l'operazione successiva potevano risolvere scope diversi; un cookie non più valido poteva ricadere sul default. | Ogni richiesta scoped porta un'asserzione dello scope atteso, confrontata con quello realmente risolto. Il writer paziente la ricontrolla nella transazione. |
| GPUI-01, controlli | Una data scelta come giorno locale diventava mezzanotte UTC, mentre visualizzazione, agenda e filtro usavano il fuso locale. | Creazione e modifica condividono data e ora locali esplicite, convertite in un istante; rifiuto di ore ambigue/inesistenti e frazioni non persistibili. |
| GPUI-02, tastiera | Dopo la rimozione del controllo focalizzato, il workspace poteva perdere il dispatch delle scorciatoie. | Subscription `on_focus_lost` del GPUI pinned: ripristina il focus del workspace dopo il nuovo albero, conservando gli editor ancora presenti. |

## Scope: asserzione della richiesta e autorità del commit

[`lib/network-request-scope.ts`](../../lib/network-request-scope.ts) confronta
`x-mediflow-expected-ambulatory-id` con la codifica canonica dello scope
effettivo. L'header **non concede autorità e non seleziona un ambulatorio**.
Un valore incoerente, vuoto, malformato o combinato da duplicati non viene
accettato. I client che non inviano l'header conservano la precedente
risoluzione cookie/default.

Il contesto comune serve letture e scritture; le route paziente delegano
allo stesso resolver. La route identity applica il binding quando è richiesto.
[`network-patient-commit-authority.ts`](../../lib/network-patient-commit-authority.ts)
ricontrolla l'asserzione dentro l'autorità esistente, con scope corrente,
operatore, capability, appartenenza, versione e audit nella transazione
IMMEDIATE. Non viene aggiunto un secondo writer. La nuova asserzione non
estende implicitamente questa riqualificazione transazionale a ogni writer
figlio: tali operazioni conservano i rispettivi confini preesistenti.

Il trasporto Rust invia l'header su ogni richiesta scoped, compresi
preflight e richiesta concreta. Prima delle operazioni richiede il marker
`scope.requestBinding = expected-ambulatory-id-v1`, lo scope, l'operatore e
il canale nativo attesi. Un host senza supporto dichiarato non permette di
iniziare l'operazione clinica. Il protocollo network passa a **1.13.0** e la
specifica OpenAPI a **1.38.0**; il marker e l'header sono opzionali nel
contratto host per conservare la compatibilità dei client precedenti.

L'header è documentato sui 37 percorsi pubblicati pertinenti; sulla
collezione ambulatori è dichiarato solo per POST, poiché GET elenca il roster
globale. Il guard OpenAPI ora risolve i parametri locali `$ref`, quelli di
path e gli override di operazione. Aggiungere un parametro opzionale è
compatibile; rimuovere o restringere un parametro, renderlo obbligatorio
o cambiarne la serializzazione resta bloccante. Riferimenti non risolti,
ciclici e duplicati sono errori. I 28 self-test includono 13 nuove regressioni.
**Nessun ampliamento degli override di `contract-policy.json`.** Il guard
rimane un confronto delimitato, non un validatore completo di OpenAPI.

## Controlli: istante, giorno locale e precisione conservata

[`appointments.rs`](../../experiments/gpui-patient-pilot/app/src/appointments.rs)
è usato dai form reali di creazione e modifica. L'ora iniziale è vuota e
deve essere scelta. Le prove coprono Roma e New York, riapertura vicino
alla mezzanotte, cambi d'ora legale, filtri dell'intero giorno e agenda.
Ore inesistenti o ambigue sono rifiutate senza scegliere un offset al
posto dell'utente.

La review del mapper Drizzle della colonna `checkups.date` ha verificato
che lo storage usa **secondi interi**. Nuovi valori e modifiche temporali
rifiutano ogni frazione nonzero, anche `.125`: nessun troncamento, modifica
di schema o indebolimento della rilettura. Se giorno e ora sono invariati,
una modifica a titolo/stato/note conserva i byte del timestamp originale,
inclusi offset e precisione. Le altre date cliniche mantengono il loro
contratto precedente.

## Focus e dipendenze di test

La subscription viene conservata nell'app e reagisce alla scomparsa del
percorso focalizzato dopo la sostituzione dell'albero di dispatch. I due
test GPUI usano il vero `ClinicalApp` su `TestAppContext`: rimozione di un
controllo condizionale, Tab/Shift+Tab/blocco, sopravvivenza dell'editor con
resize e disattivazione. Non aprono sessioni, richieste HTTP o archivi.
Le sette transizioni collegate, compresa una scrittura in corso, sono
coperte dalla review del meccanismo comune; non sono sette nuove sequenze
native eseguite. Non vengono aggiunti callback periodici.

`gpui/test-support` e `chrono-tz` entrano nelle sole dev-dependencies.
Il lock passa da 688 a 708 pacchetti: identità, versioni, fonti e checksum
dei 688 preesistenti sono preservati; 2.152 archi si risolvono univocamente.
Le dipendenze di produzione del manifest sono invariate. Questa verifica
di integrità non sostituisce un audit delle implementazioni transitive.

## Prove locali attribuite ai file

La [ricevuta completa](../../experiments/gpui-patient-pilot/evidence/connected/pr558-review-repairs-validation.json)
registra hash dei sorgenti, comandi, autori delle esecuzioni, risultati e
limiti. I [log aggregati](../../experiments/gpui-patient-pilot/evidence/connected/pr558-review-repairs-local.log)
conservano i transcript indicizzati nella ricevuta.

| Prova sul candidato | Esito |
| --- | --- |
| Scope, identità, versione protocollo e autorità del commit | **101 PASS**, zero fallimenti o skip |
| Guard tombstone route → porta → writer | **12 PASS**, zero fallimenti o skip; mutanti e controlli AND conservati |
| Trasporto Rust, tutti i target del package | **30 PASS**, zero fallimenti, ignorati o filtrati |
| App GPUI | **53 PASS**, zero fallimenti, ignorati o filtrati; 45 precedenti, sei date/edit, due render/dispatch |
| OpenAPI self-test / confronto semantico con main 2dde | **28/28 PASS / PASS** |
| Typecheck TypeScript / ESLint file modificati | **PASS / PASS** |
| GPUI Clippy all-targets con `-D warnings` / fmt | **PASS / PASS** |

I test di scope usano Request e fixture unit esistenti: rifiuto con 403
prima degli effetti su pazienti, appartenenze e audit; percorso ordinario
valido e compatibilità senza header conservati. Non sono un'esecuzione HTTP
della sequenza temporale che aveva motivato TA-1. Un precedente agente
aveva preparato un reproducer inerte, poi il turno era stato bloccato dal
controllo automatico per possibile rischio cybersecurity: **nessuna
esecuzione tentata o completata, nessun retry del percorso respinto**.

I primi tentativi nel sandbox ristretto non potevano eseguire correttamente
i subprocessi Node/Git o i listener TCP locali dei mock Rust: non sono
prove valide. Il confronto OpenAPI precedente segnalava inoltre l'header
opzionale come breaking; è passato solo dopo la correzione semantica del
guard e i suoi casi negativi. Le esecuzioni valide usano i permessi già
autorizzati, directory sintetiche temporanee e copia legacy disabilitata.
L'helper subreaper esistente raccoglie soltanto propri figli già terminati;
in questo batch non ha inviato segnali e non restano figli residui.

### Follow-up della CI: binding Cargo della selezione

Il candidato precedente è stato pubblicato come
`8cfb7d7065c7c7f114e49e04bb5412dfcebb3b6e`. Nel
[Repository Guards effettivo](https://github.com/Wulfgardr/mediflow/actions/runs/39110303479/job/117624811357),
checkout `cb45b9f9a4e395d445447ce4ce412b3c046bc1b3`, il controllo della
selezione aveva **113 PASS e 2 FAIL su 115**: il contratto chiuso del
selettore non modellava ancora `[dev-dependencies]` dell'app. La lettura
del codice ha trovato anche il prefisso dei moduli fermo a `clinical_text`,
prima dell'aggiunta del nuovo `appointments`.

Il follow-up aggiorna soltanto
[`native-tool-test-selection.mjs`](../../scripts/native-tool-test-selection.mjs),
le sue fixture e questo verbale con la ricevuta. La tabella deve contenere
esattamente GPUI workspace con `test-support` e `chrono-tz` come nel manifest
pubblicato; il prefisso ordinato richiede `mod appointments;` senza condizioni.
`appointments.rs` è un helper senza test propri e non viene dichiarato
artificialmente come test selezionato. Target, comando `--workspace
--all-targets --locked`, matrici OS, errori ed esclusioni preesistenti
mantengono il loro contratto.

La suite canonica passa a **131 PASS, zero FAIL/SKIP**, compresi 15 nuovi
subtest negativi su dipendenze mancanti/opzionali/duplicate/condizionali,
harness disabilitato, target con `required-features` e moduli mancanti o
condizionali. Il censimento risulta **COMPLETE: 1.062 file, 1.033 presi da
una suite, 29 esclusioni motivate preesistenti**. Lint e diff-check PASS.
La ricevuta precedente resta disponibile allo SHA 8cfb7d7, con i suoi hash;
quella aggiornata distingue i risultati conservati dai nuovi test del
selettore. Nessun nuovo sorgente di prodotto, run nativo facoltativo o
ampliamento generico per ottenere verde. La nuova revisione richiede
nuovo binding della review completa e CI propria prima del merge.

### Comandi riproducibili

Da un checkout della revisione pubblicata, con dipendenze installate tramite
`npm ci`, Node 24, Rust 1.98.1 e le dipendenze native documentate nel README:

```bash
node --test scripts/patient-soft-delete.test.mjs
node scripts/check-openapi-drift.mjs --self-test
node scripts/check-openapi-drift.mjs --base-ref 2dde0c0503abf828b99d73d7129cb7beed733044
npm run test:test-selection
npm run check:test-selection
npm run typecheck
cargo test --manifest-path experiments/gpui-patient-pilot/Cargo.toml --locked -p mediflow-runtime-client --all-targets
cargo test --manifest-path experiments/gpui-patient-pilot/Cargo.toml --locked -p mediflow-gpui-patient-pilot
cargo clippy --manifest-path experiments/gpui-patient-pilot/Cargo.toml --locked -p mediflow-gpui-patient-pilot --all-targets -- -D warnings
cargo fmt --manifest-path experiments/gpui-patient-pilot/Cargo.toml -p mediflow-gpui-patient-pilot -p mediflow-runtime-client -p mediflow-patient-client -- --check
```

Il batch TypeScript con database richiede esplicitamente un archivio
sintetico nuovo. La directory appartiene al comando ed è rimossa all'uscita:

```python
import os
import subprocess
import tempfile

with tempfile.TemporaryDirectory(prefix="mediflow-pr558-scope-") as data:
    env = dict(os.environ, MEDIFLOW_DATA_DIR=data,
               MEDIFLOW_E2E_DISABLE_LEGACY_COPY="1")
    subprocess.run(["node", "scripts/prepare-e2e-db.mjs"], env=env, check=True)
    subprocess.run([
        "node", "scripts/run-strip-types.mjs", "--test",
        "--test-reporter=tap", "--test-concurrency=1",
        "lib/network-request-scope.test.ts", "lib/network-identity.test.ts",
        "lib/network-contract.test.ts", "lib/network-patient-commit-authority.test.ts",
    ], env=env, check=True)
```

I mock Rust richiedono loopback locale. `--offline` è riproducibile quando
le dipendenze fissate sono già presenti. I workflow canonici restano la
prova della revisione pubblicata sui runner dei sistemi operativi.

## Consegna, conservazione e prossima sessione

Lo [steering pubblico](https://github.com/Wulfgardr/mediflow/pull/558#issuecomment-6246684340)
affida a Pro il completamento, la review mediante revisore distinto e il
merge ordinario senza override. Codex osserva. Il verdetto finale deve
riconciliare tutti i percorsi della PR, portando avanti solo i blob già
reviewed rimasti identici e leggendo ogni nuova modifica; i sei file GPUI
da soli non costituiscono il perimetro. La CI di e51 resta storica.

Il delta conserva la base #560–562, v3/ChatGPT, prodotto CSV, Diario/iPad,
font, asset e geometrie preesistenti. L'annotazione `PropertyDescriptorMap`
non è cambiata e non è usata per rivendicare una nuova qualifica Mac.
Non viene pubblicata alcuna nuova immagine; la PNG 09 respinta resta esclusa.

Dopo il merge, la prossima Pro parte dallo **SHA di main realmente integrato
indicato sulla PR**, verifica head/ancestry e legge WUL-574/582/706/714.
Il prossimo incremento sostanziale rimane **WUL-582, profilo/sole note**, poi
WUL-575 nella sequenza del pilota WUL-573. Il
[brief della verticale](./2026-10-18-pr558-soft-delete-delivery.md#prossimo-incremento-sostanziale)
separa i servizi affidabili da riusare dalle decisioni su canonicalizzazione
prima della cifratura, vista interna distinta dall'ORM, registri operativi
e destino dell'autorità SQLite Swift opzionale.

Prima di dichiarare un solo writer occorre decidere e provare convergenza
o ritiro di `LocalPatientsDataSource`, oppure qualificare esplicitamente
quella seconda autorità. Nessuna delle due decisioni è simulata da questo
binding HTTP. **Client GPUI collegato, core Rust e prodotto installato sono
risultati diversi.** ADR0145 rimane Proposed; WUL-573/580/736, GO riservati,
qualifica clinica, parità completa, IME/accessibilità, mobile, firma e
aggiornamento del prodotto installato restano aperti.
