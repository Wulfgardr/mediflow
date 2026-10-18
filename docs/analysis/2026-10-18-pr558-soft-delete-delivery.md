# PR #558 — tombstone verificati attraverso la porta del profilo

Data: 18 ottobre 2026, Europe/Rome. Continuazione: **r08ef12a**.
Questo verbale qualifica i file del candidato locale e prepara la consegna
della PR; gli esiti CI della revisione pubblicata sono registrati nella
[PR #558](https://github.com/Wulfgardr/mediflow/pull/558), con head e merge
effettivi. Non si attribuiscono alla nuova head i risultati di una precedente.

**Perimetro storico:** questo verbale descrive il commit tombstone
`e51a86e9f23934ef35815f0a078b8500886fbc91`. La continuazione della stessa
consegna, con review dell'intero diff e correzioni di produzione, è nel
[verbale successivo](./2026-10-18-pr558-full-review-repairs.md).

## Causa verificata e modifica

La head pubblicata all'ingresso era
`3b5068f621e18825cc99eeb447073e9302cc1aa2`, tree
`694eb941f9bae4f109054850728dce507bc72fe7`.
Il [Web Core fallito](https://github.com/Wulfgardr/mediflow/actions/runs/39069695204/job/117504554126)
usava il merge `e568866516fe3f03d782d62e085c0f79b4bf0f7f`, i cui parent
sono `main` `2dde0c0503abf828b99d73d7129cb7beed733044` e quella head.
La base comprende già le PR #560–562.

La recipe `local:test:patient-soft-delete` era l'unica delle 46 ricette
portabili con esito nonzero. Il blocco statico riportava 11 PASS e 2 FAIL:

1. Il test cercava `activePatients()` nei GET/PUT Web e API v1, sebbene le
   route delegassero ormai alla porta comune del profilo.
2. Il guard AST non seguiva `const condition = and(id, activePatients())`
   quando il predicato entrava in `.where(and(condition, scope))`.

La riproduzione locale ha confermato entrambi i rilievi. La correzione in
[`scripts/patient-soft-delete.test.mjs`](../../scripts/patient-soft-delete.test.mjs)
segue la catena concreta **route → porta → writer**. Le route non vengono
escluse dal controllo. Fingerprint, molteplicità delle letture ammesse e
allowlist degli hard delete restano byte-identici.

La catena deve conservare il binding dell'import del reader GET, lo stesso
paziente e la proiezione approvata, la risposta 404 e la propagazione dello
status del PUT. Nella porta restano il preflight del paziente attivo, le
letture scoped/unscoped e l'assenza prima della proiezione. Nel writer si
controllano le riletture della transazione, il rifiuto prima degli effetti
e il predicato dell'UPDATE finale. Il contratto audit già esistente verifica
la delega PUT, l'operazione autorevole e l'audit obbligatorio nella stessa
transazione; non è stata creata una seconda implementazione di quel guard.

La risalita AST ammette una costante locale precedente e immutabile solo
attraverso argomenti `and(...)` fino al WHERE della propria query pazienti.
Ogni utilizzo viene controllato: un uso laterale invalida anche le query
altrimenti corrette. Alias, assegnazioni, mutazioni, OR, negazione, callback,
closure, shadowing, chiamate opzionali e query estranee sono respinti.
È un controllo statico delimitato e conservativo, non un'analisi generale
del flusso dati TypeScript; restano necessarie le prove runtime e HTTP.

**Nessuna modifica di produzione nel solo commit tombstone e51.** Porta, route, writer,
audit, schema, prove lifecycle/cascade e workflow conservano i byte della
base. Sono preservati v3/ChatGPT, CSV, Diario/rendering iPad, font, asset e
geometrie. Il merge CI finale deve continuare a includere `main` e le PR
#560–562. Non è stato eseguito alcun reset o rebase né scritto un branch altrui.

## Prove sui file effettivi

Il guard finale ha SHA-256
`5c4981cad467d5c7c60ab4c104ae284b009ffefd0919d25a1b2b6735da714117`.
La [ricevuta](../../experiments/gpui-patient-pilot/evidence/connected/patient-profile-tombstone-guard-validation.json)
registra sorgenti, hash dei log, comandi, tempi, risultati, ripristino del
runtime e tentativi non qualificanti. Il [log statico completo](../../experiments/gpui-patient-pilot/evidence/connected/patient-profile-tombstone-static.log)
è pubblicato separatamente.

| Verifica locale | Esito osservato | Interpretazione |
| --- | --- | --- |
| Guard statico diretto | **12/12 PASS**, 0 FAIL/SKIP | Include 20 mutanti per route, 19 casi negativi AND/escape e l'invalidazione simultanea di due query. Sono asserzioni interne ai 12 test. |
| Recipe soft-delete completa | **PASS** | Esegue i tre file runtime lifecycle/cascade/clear e i due file statici previsti dal repository. Il runner locale aggrega alcuni risultati per file: non sono conteggi aggiuntivi di casi. |
| Lint del file modificato | **PASS** | Nessuna diagnostica. |
| Gate portabile completo | **46/46 ricette PASS** | Comando canonico invariato, SQLite sintetico, provider reali non utilizzati. |
| Generatori fixture | **PASS** | 40 fixture rich-text e tre JSON verificati; solo il finding di idempotenza già noto, nessuna divergenza inattesa. |
| Research boundary | **PASS** | 4 test Rust, 0 casi doctest, build release locked e comparatore JS/Rust del codec in `experiments/rust-boundary`. Distinto dal client GPUI e dal differenziale clinico HTTP. |

La review locale del nuovo guard ha trovato un caso concreto: un reader
GET locale omonimo poteva sostituire quello importato. Il confronto di
identità fra simboli del TypeScript checker e i mutanti con `const`, funzione
e destructuring chiudono il rilievo. La review del file finale non ha
rilievi bloccanti. Un candidato intermedio ha ricevuto SIGKILL con log vuoto
mentre l'asserzione confrontava direttamente oggetti Symbol; il confronto
booleano conserva la stessa identità ed evita di formattare i grafi AST
nel messaggio di errore. I 12 test della versione finale sono passati.

Queste review storiche sono limitate al guard e all'helper locale e non
sostituiscono la review indipendente di auth, chiavi, scritture e audit
dell'intera head finale. Lo steering `s20261018merge` affida ora a Pro
review mediante un revisore distinto dagli autori, verifica CI e merge
ordinario; Codex osserva. La disposizione finale è pubblicata sulla PR.

## Ripristino dell'ambiente e riproduzione

Ambiente osservato: Ubuntu 24.04.3/Linux x64, Node 24.19.0, TypeScript 5.9.3,
Rust 1.98.1 e SQLite CLI 3.45.1. Le dipendenze del repository non cambiano.
Nel runtime recuperato erano assenti `sqlite3`, l'oggetto Git congelato
`90fa7771fc0822475611c9affb9c22e212939399` usato dal code explorer e Cargo
nel PATH. SQLite è stato estratto in una directory temporanea, l'oggetto
pubblico è stato recuperato senza muovere branch e la toolchain Rust già
installata è stata selezionata tramite il suo ambiente.

Il primo giro portabile nel sandbox ristretto aveva errori EPERM; il giro
con permessi corretti aveva 41 ricette riuscite e cinque nonzero. Quattro
dipendevano da SQLite/oggetto Git mancanti. Il test di uscita del processo
account sintetico attende 200 ms, mentre il supervisore del container può
raccogliere i processi terminati in un giro successivo. Il PID del primo
fallimento non era registrato: non se ne afferma retroattivamente lo stato.

La ripetizione completa ha usato
[`local-subreaper.py`](../../experiments/gpui-patient-pilot/comparison/local-subreaper.py),
un helper Linux di riproduzione esterno ai gate. Chiama
[`PR_SET_CHILD_SUBREAPER`](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html)
e raccoglie con `waitpid` solo figli propri già terminati. Non invia segnali,
non modifica argv o condizioni dei test e conserva l'exit effettivo del
comando principale. La semantica di
[`kill(pid, 0)`](https://man7.org/linux/man-pages/man2/kill.2.html) può ancora
rilevare un processo terminato non raccolto.

Nel giro valido: comando canonico exit 0, un figlio adottato con wait status 9
(terminato da SIGKILL), **zero segnali inviati dall'helper e nessun figlio
residuo**. Un controllo negativo separato ha conservato l'exit 7 del comando.
Il primo tentativo dell'helper, basato su un percorso `/proc` non disponibile,
è un errore del wrapper e non una prova positiva. Nessun comando precedente
risultava ancora attivo prima della ripetizione valida.

Da un checkout della revisione pubblicata, con `npm ci`, Node 24, Rust/Cargo,
SQLite CLI e gli oggetti Git delle fixture disponibili:

```bash
node scripts/patient-soft-delete.test.mjs
node scripts/run-portable-local-tests.mjs local:test:patient-soft-delete
node node_modules/eslint/bin/eslint.js scripts/patient-soft-delete.test.mjs
npm run test:portable-local
npm run test:fixture-generators
npm run test:research-boundary
git diff --check
```

Solo su un container Linux con raccolta tardiva degli orfani, il quarto
comando può essere eseguito così, lasciando invariata la suite:

```bash
python3 experiments/gpui-patient-pilot/comparison/local-subreaper.py \
  /tmp/mediflow-portable-reaping.json npm run test:portable-local
```

I runner canonici creano e rimuovono le proprie directory temporanee e
disabilitano la copia di archivi precedenti. Le prove usano repository e
dati sintetici. Il gruppo research stampa anche tempi esplorativi e una
stringa di limite storica riferita a macOS: questa nuova esecuzione è Linux
e viene usata come verifica del codec, non come qualifica Mac o misura del
prodotto installato. L'annotazione `PropertyDescriptorMap` resta invariata;
non giustifica una nuova qualifica Mac. I test portabili degli helper Mac
non equivalgono a quella qualifica.

## Handoff per la prossima Pro

**Punto di partenza:** dopo la review indipendente e il merge ordinario di Pro,
rileggere `origin/main` integrato, PR #558 e WUL-574/582/706/714. Verificare
che il merge includa la head finale di questa tranche e gli aggiornamenti
#560–562; registrare lo SHA realmente integrato. Se la PR è ancora aperta,
resta un candidato e non va descritta come `main` integrato. Non duplicare
un turno ancora attivo, non ricostruire file da ricordi e non riattribuire
prove precedenti a byte nuovi.

### Implementazione affidabile da riusare

La [porta comune del profilo](./2026-10-17-patient-profile-port.md) riusa
`updatePatientOperation`, la transazione IMMEDIATE, il controllo di versione,
membership e audit. Il confronto cifrato old/new e i 119 casi precedenti
conservano la propria provenienza; questa tranche qualifica il nuovo guard
senza rieseguire o rinominare quelle prove. Il client GPUI collegato, i
canoni UI e le evidenze originali restano quelli dei rispettivi verbali.

### Prossimo incremento sostanziale

Completare **WUL-582 sulla verticale profilo/sole note**, quindi qualificare
la lettura condivisa WUL-575, riusando `patient-profile-service` e togliendo
responsabilità duplicate agli adattatori. Mappare autore, ruolo, paziente,
scopo, scope, attualità, chiavi ed emittente del commit su simboli e chiamanti
reali. Rendere esplicita l'ammissione della lettura e distinguere la vista
interna dal tipo ORM `typeof patients.$inferSelect`, conservando i contratti
HTTP. Identificare il punto fidato di canonicalizzazione **prima della
cifratura**: il normalizzatore attuale riceve già valori ENC.

La destinazione di Swift opzionale è una decisione ancora aperta.
[`makeClient`](../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift)
può scegliere
[`LocalPatientsDataSource`](../../native/MediFlowMac/Sources/MediFlowAppleShared/LocalPatientsDataSource.swift).
Le letture paziente possono arrivare a SQLite anche senza scope; gli
aggiornamenti usano SQLite con scope non vuoto e HTTP altrimenti. Il commento
della factory che limita il percorso locale alle letture è arretrato.
Le scritture locali non passano dall'audit obbligatorio Node. Prima di
dichiarare un solo writer occorre scegliere e provare **convergenza/ritiro
del percorso locale oppure garanzie autonome esplicitamente qualificate**.
La prima opzione riduce l'autorità duplicata della verticale; la seconda
richiede prove proprie e non permette di chiamare unico il writer Node
su tutte le superfici. La scelta non viene simulata da un flag o da test HTTP.

Riutilizzare i registri esistenti senza attribuire loro un'operatività
inesistente: [`lib/headless/application-operation-registry.ts`](../../lib/headless/application-operation-registry.ts)
è un catalogo statico `denied/unavailable`, con `operationId` e
`applicationServiceRef` null. La separazione dei registri e il contratto
clinico operativo di WUL-582 restano da qualificare.

Seguire la sequenza del pilota WUL-573:
**574 → 582 → 575 → 583 → 576 → 584 → 577 → 585 → 578 → 579 → 580 → accettazione 573**.
Le decisioni IPC/FFI e la migrazione del writer Rust seguono quei confini,
con prova sullo stesso archivio sintetico, un invio per mutazione, rifiuti
prima degli effetti, audit atomico e recupero dopo un esito incerto.

**Client GPUI collegato, core Rust e prodotto installato sono risultati
distinti.** ADR0145 resta Proposed. Parità delle superfici ancora mancanti,
IME/accessibilità, piattaforme native reali, mobile, firma/aggiornamento,
installer e misure del prodotto installato mantengono i propri gate.
WUL-573/580/736 e i GO riservati non sono dichiarati conclusi.
La PNG 09 già respinta rimane esclusa dalla pubblicazione.
