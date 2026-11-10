# Verifica dell’identità paziente senza codice fiscale

Data: 5 novembre 2026. Decisione: [ADR 0179](../adr/0179-identita-paziente-senza-codice-fiscale.md).
Base fissata: `fb6c3966d8b4108c60708af50612359ecf082035`, acquisita da `origin/main` prima di creare il ramo `claude/identita-paziente-senza-cf`.
Revisione del codice verificata: `43df67738ab4ffd71ec1e192a5956776cd40afe1`.
Ambiente: macOS arm64, Node **24.22.0**, ABI 137, archivi esclusivamente sintetici.

Il confronto usa lo stesso worktree. I file finali sono stati copiati fuori da Git con un manifesto SHA-256, poi è stato ripristinato temporaneamente il contenuto della base mantenendo i due file di regressione. Dopo le prove sono stati ripristinati tutti i file finali, verificando gli hash e lo stato Git pulito. Non è stato usato stash. Il confronto resta sulla base fissata anche se `main` avanza.

Per i comandi della tabella, `MEDIFLOW_DATA_DIR=/tmp/mfid-base-final` sulla base e `MEDIFLOW_DATA_DIR=/tmp/mfid-proof2` sul ramo. I test di persistenza creano inoltre un proprio archivio sintetico isolato.

| Prova | Comando | Base | Ramo |
| --- | --- | --- | --- |
| a: `none`, nome e cognome, solo anno stimato | `node scripts/run-strip-types.mjs --test lib/patient-identity.test.ts` | Fallisce: identificativo vuoto rifiutato | Passa; rifiuta anche `none` senza data o anno stimato |
| a: scrittura e rilettura SQLite dell’anno stimato | `node scripts/run-strip-types.mjs --test lib/patient-identity-storage.test.ts` | Fallisce: anno e tipo non conservati | Passa: `taxCode=''`, anno 1982, tipo `none`, data nulla |
| b: età da `STP0300010000123` senza nascita | `node scripts/run-strip-types.mjs --test lib/patient-identity.test.ts` | Fallisce: restituisce anno 2000 | Passa: restituisce `null` |
| c: CF con controllo errato e omocodia valida | `node scripts/run-strip-types.mjs --test lib/patient-identity.test.ts` | Fallisce: accetta `RSSMRA80A01H501X` | Passa: rifiuta il controllo errato e accetta `RSSMRA80A01H50MM` |
| d: migrazione CF/STP/ENI, valori e versione | `node scripts/run-strip-types.mjs --test lib/patient-identity-storage.test.ts` | Fallisce: versione ancora 7 | Passa: versione 8, tipi assegnati, valori invariati, precisione iniziale coerente e riapertura idempotente |
| e: STP diventa CF sulla stessa scheda | `node scripts/run-strip-types.mjs --test lib/patient-identity-storage.test.ts` | Fallisce: manca lo storico del precedente identificativo | Passa: stesso ID, versione incrementata, precedente STP nello storico collegato all’audit, retry con versione vecchia e duplicato respinti con 409 |
| f: FHIR, sistema per tipo e nessun identifier per `none` | `node scripts/run-strip-types.mjs --test lib/patient-identity.test.ts` | Fallisce: sistema CF precedente e tipo ignorato | Passa: OID CF e namespace distinti di ADR 0179; `none` omette identifier |
| g: risposta paired v1 e lettore precedente | `node scripts/run-strip-types.mjs --test lib/patient-identity-storage.test.ts` | `taxCode` resta leggibile; fallisce l’asserzione sui nuovi campi assenti | Passa: campi additivi presenti e vecchio lettore `{id,taxCode}` ancora funzionante |

I quattro casi del primo file falliscono sulla base e passano sul ramo. Nel secondo file falliscono sulla base i quattro casi di nuovo comportamento; le due prove aggiuntive di rollback dell’audit passano già sulla base e restano verdi sul ramo. Nel ramo tutte le nuove prove di identità, consumatori e client passano: **19 test**.

Le due prove `e audit ABORT` ed `e audit IGNORE` forzano rispettivamente un errore SQL e un inserimento audit ignorato. Confrontano l’intera riga prima e dopo: identificativo, storico e versione restano invariati, senza un evento dichiarato riuscito. Le prove client forzano un 409 di duplicato nel trasporto reale della facade: distinguono il duplicato dal conflitto di versione, mostrano il messaggio fisso italiano e non espongono un valore sentinella contenuto nella risposta. Questi tre casi erano rossi prima del relativo collegamento nel client.

Ulteriori prove in `lib/patient-identity-consumers.test.ts`: compleanno già avvenuto o futuro nell’anno, stima esplicita, nessuna età da tipi diversi dal CF, CSV esteso con `none` e STP, redazione dei diversi identificativi attraverso il gate e la sessione reale, rifiuto SISS per documento/altro/none e separazione dei tipi nel riconoscimento documentale. Il gate AI rimane chiuso.

| Controllo | Base | Ramo |
| --- | --- | --- |
| `npm run typecheck` | 0 | 0 |
| `npm run lint` | 0 | 0 |
| `npm run check:never-regress` | 0 | 0 |
| `MEDIFLOW_DATA_DIR=/tmp/mfid-base npm run -s test:unit` | 9.794 test; 9.728 passati, 35 falliti, 31 saltati; exit 1 | Vedi comando successivo |
| `MEDIFLOW_DATA_DIR=/tmp/mfid-final3 npm run -s test:unit` | Vedi comando precedente | 9.814 test; 9.755 passati, 28 falliti, 31 saltati; exit 1 |

I 28 fallimenti del run finale sono un sottoinsieme dei 35 fallimenti della base: **nessun nuovo fallimento osservato**. L’[elenco nominativo dei fallimenti](./2026-11-05-identita-paziente-unit-comparison.json) conserva comandi, revisioni, conteggi e differenze.

I fallimenti già presenti sulla base sono stati confrontati per nome e file, non solo per numero:

- 12 casi di `treatment-reasoning-portable-provisioning.test.ts` e 13 di `treatment-reasoning-portable-runtime.test.ts`: il verificatore dell’artefatto restituisce `artifact_tampered`. La causa non è stata isolata; gli stessi fallimenti sono riprodotti sulla base. Non si è modificato il verificatore per ammettere l’artefatto.
- 3 casi di `chatgpt-execution/execution-mac.test.ts`: mancano i sorgenti congelati richiesti da `MEDIFLOW_MAC_PUBLIC_SOURCE_DIR` e `MEDIFLOW_MAC_NATIVE_SOURCE`. Sono prerequisiti locali non presenti nel checkout di prova.
- Sulla prima base sono falliti anche 6 casi OCR Apple Vision e un caso multiprocesso della gerarchia ambulatori. OCR e caso multiprocesso sono passati nel confronto successivo sul ramo; il dato attesta variabilità fra run, non una correzione attribuita a questo contributo.

Nei run intermedi sono comparsi timeout di autenticazione Mini e rifiuti `session_unavailable` dei grant checkup. I medesimi 16 test sono poi passati insieme in isolamento; questi casi erano passati sia sulla base sia nel precedente run completo. I log dei singoli run restano distinti e non vengono sostituiti da un totale cumulativo.

I repository guard derivano dal job `repository-guards` di `.github/workflows/openapi-contract-guard.yml`: selezione test e prove negative, claims e self-test, dashboard consumi, schema writer e self-test, scritture cliniche AI e self-test, confine import database e prove negative, error leak e self-test, never-regress, crosswalk Fabric e test, catalogo operativo e test, manifesto Apple, parità MLX, OpenAPI contro la base e self-test, deriva schema e qualità audit. Tutti i 25 comandi passano. Il catalogo operativo è stato rigenerato con il suo comando, senza modificarlo a mano. Nessuno stato Xcode per utente è tracciato. Le dipendenze sono state clonate con copia APFS dalla destinazione indicata e `npm run prepare:dependencies` ha verificato il prebuild SQLite 12.6.2 per Node 24.

Prove HTTP con server locale e archivi sintetici, tutte passate:

- `MEDIFLOW_CONCURRENCY_DATA_DIR=/tmp/mfid-cas2 E2E_BASE_URL=http://127.0.0.1:38935 npm run test:concurrency:patients`: 5 test.
- `MEDIFLOW_NETWORK_SMOKE_DATA_DIR=/tmp/mfid-net-read2 E2E_BASE_URL=http://127.0.0.1:38936 npm run test:network:home-base-readonly`: 1 test.
- `MEDIFLOW_NETWORK_WRITE_DATA_DIR=/tmp/mfid-net-write2 E2E_BASE_URL=http://127.0.0.1:38937 npm run test:network:home-base-write`: 3 test.
- `MEDIFLOW_NETWORK_WRITE_DATA_DIR=/tmp/mfid-net-diary2 E2E_BASE_URL=http://127.0.0.1:38938 npm run test:network:home-base-diary-write`: 1 test.
- `MEDIFLOW_DATA_DIR=/tmp/mfid-doc-review npm run test:patient-document-import`: passa.

`MEDIFLOW_DATA_DIR=/tmp/mfid-build npm run build`: passa sulla revisione del codice indicata sopra. La prova include il controllo del bundle standalone, Node 24 e ABI 137. Non è una prova di avvio del prodotto installato.

Apple, con `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` e firma disabilitata:

- `xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMacApp -configuration Debug -destination 'platform=macOS' -derivedDataPath /tmp/mfid-apple -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO build`: passa.
- `xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMobileApp -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/mfid-apple-mobile -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO build`: passa.
- `swift test --package-path native/MediFlowMac --scratch-path /tmp/mfid-swift-tests --skip-update --filter 'FHIRBundleGeneratorTests|HomeBaseAttachmentModelsTests/testPatientIdentityDecodesOldAndAdditivePayloads'`: 8 test passati, inclusi decodifica vecchia/nuova, conservazione dei campi attraverso la decifratura, identificatori FHIR per tipo e nascita al solo anno.

Non provati: percorso manuale del form nel browser, avvio delle app compilate, dispositivi fisici, firma/distribuzione e servizi SISS reali. I test FHIR verificano il mapping richiesto e il riferimento condiviso con Apple; non qualificano un profilo nazionale né una connessione regionale. Nessun dato clinico reale è stato letto e nessuna PR è stata unita.

## Correzioni PR #846: inferenza e fixture dossier

Riprodotti su `300a56ff1031cba557475ffd8f0be359bc3f3c42`, aggiungendo prima
le asserzioni e mantenendo il codice iniziale:

- `lib/patient-identity.test.ts`: inferire `STPMRA80A01H501U` restituisce
  `stp` invece di `cf`.
- `lib/patient-identity-storage.test.ts`: la migrazione da schema 7 classifica
  `STPMRA80A01H501U` come `stp` e `ENIXXX80A01H501U` come `eni`,
  mentre il valore vuoto resta `cf` invece di `none`.
- Il test delle 10.000 estrazioni, dopo aver estratto senza modifiche il
  generatore di `e2e/dossier-import.spec.ts` nel supporto condiviso, fallisce
  con `Synthetic tax code unavailable`.

Dopo la correzione passano 19 test nei tre file `patient-identity.test.ts`,
`patient-identity-storage.test.ts`, `patient-identity-consumers.test.ts`.
Il generatore casuale usa giorni 01-28 o 41-68; il validatore resta identico.
La prova esegue 10.000 estrazioni casuali e 10.000 semi del generatore
preesistente, tutti validi. La ricerca in `e2e/` e `lib/` non trova altri
generatori con il difetto del giorno 00-99: il generatore da seme usa 01,
mentre il seeder produce identificativi TEST, fuori da questo formato CF.

La migrazione applicata da `sqlite-schema-open.ts` vive in `sqlite-schema.ts`:
usa prefisso STP o ENI seguito da esattamente 13 cifre, con trim e maiuscole.
CSV, normalizzazione delle scritture e SISS usano l'inferenza comune.
I test dei consumatori verificano CSV, scritture, SISS e riconoscimento
nei documenti con CF validi dai prefissi STP ed ENI. Gli esempi richiesti
con finale U non hanno checksum valido: l'inferenza resta CF, mentre per
esercitare i consumatori si usano i finali corretti Q e W.

`npx playwright test e2e/dossier-import.spec.ts --list` passa e raccoglie
2 test. Questa prova verifica il caricamento, non l'esecuzione E2E.
Il catalogo operativo Fabric viene rigenerato perché il dossier importa ora
il generatore condiviso, anziché il riconoscitore documentale direttamente.

Verifica finale delle correzioni: passano anche tutti i quattro file
`lib/patient-identity*.test.ts` (22 test), `npm run typecheck`, `npm run lint`
e i comandi del job `repository-guards`, inclusi never-regress, confine
import database e prove negative. Il catalogo rigenerato passa il controllo.
`npm run prepare:dependencies` conferma SQLite 12.6.2 per darwin-arm64
con SHA-256 verificato. Non viene ripetuta la build né l'esecuzione E2E completa.
Intervento eseguito da gpt-6.1-sol, effort high, senza deleghe; consumi non
attribuiti. Le prove del raccordo formale sono in
`docs/formal/therapy-status/README.md`.

## Compatibilità delle scritture precedenti, PR #846

Intervento sul checkout assegnato e sul ramo `claude/identita-paziente-senza-cf`,
partendo da `9b34d37f74a9c7844918ee60538aefeb74f3c2c2`. Le prove seguenti
riguardano il diff di questa correzione, con Node 24.22.0, ABI 137, macOS arm64
e soli archivi sintetici. I valori storici non vengono corretti automaticamente.

La presenza di `identifierType` abilita la validazione per tipo. Quando manca,
il server conserva il valore di `taxCode` e il suo contratto precedente:
STP o ENI soltanto con 13 cifre, `cf` altrimenti. La creazione paired mantiene
il controllo precedente di stringa non vuota. Form e CSV senza tipo mantengono
il loro controllo precedente di 16 caratteri alfanumerici ASCII. Il CSV legacy
non trasforma un tipo inferito in una dichiarazione del chiamante.

L’aggiornamento confronta tipo e valore effettivi con quelli salvati dentro
la transazione. Un identificativo invariato non viene rivalidato o normalizzato,
anche se è presente nel payload. Un cambio con tipo dichiarato viene validato;
un cambio senza tipo segue il contratto legacy e aggiorna il tipo inferito.
Il form usa lo snapshot iniziale della sessione di modifica per la stessa
decisione. CAS, duplicati, storico e audit atomico restano attivi. Data di
nascita e calcolo dell’età restano quelli già implementati: nessuna età da CF invalido.

Prima di modificare il runtime sono state aggiunte le asserzioni ai writer reali:

```sh
MEDIFLOW_DATA_DIR=/tmp/mf846-unit-red node scripts/run-strip-types.mjs --test \
  --test-name-pattern='identità compatibile' \
  lib/patient-create-required-audit.test.ts lib/network-patient-write.test.ts
```

Su `9b34d37f7` falliscono quattro test con `400`: creazione web e paired con
`SYN` seguito da UUID, aggiornamento web e paired con CF storico invariato.
Le sole sostituzioni nei test web riguardano autenticazione e cookie; SQLite,
route, normalizzazione, dispatcher, transazione e audit sono quelli reali.
I test paired usano il writer reale con sessione e autorità sintetiche.

| Caso | Risultato dopo la correzione |
| --- | --- |
| POST web senza tipo, `SYN` seguito da UUID | 201, stringa conservata |
| Creazione paired precedente senza campi nuovi | 201, tipo inferito `cf` |
| POST web e paired, tipo `cf` e `RSSMRA80A01H501X` | 400, messaggio italiano, nessun paziente creato |
| PUT web, sole note sul CF storico errato | 200, CF invariato |
| PUT web e paired, note e medesimi tipo/valore espliciti | 200, CF e storico invariati, versione incrementata |
| PUT paired, sole note sul CF storico errato | 200, CF invariato |
| PUT web e paired, nuovo CF errato dichiarato | 400, riga e audit invariati |
| PUT web e paired, nuovo valore `TEST-...` senza tipo | 200, valore conservato e tipo inferito |

Passano **191 test** eseguendo insieme `patient-create-required-audit`,
`network-patient-write`, tutti i file `patient-identity*.test.ts`,
`patient-write-normalization`, `patient-edit-session-schema` e
`patient-bulk-import*.test.ts` tramite `run-strip-types.mjs --test`.
La selezione richiesta `lib/patient-identity*.test.ts` passa anche da sola:
**26 test**. Copre inoltre schema del form, invio delle sole note,
rifiuto di un cambio invalido, CSV legacy, duplicati e conservazione delle stringhe.

Il seed della comparazione passa attraverso gli endpoint ordinari del server
di produzione proprio, sulla porta 38946:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
node experiments/gpui-patient-pilot/comparison/prepare-runtime.mjs candidate \
  /tmp/mediflow-transition-846-delivery/candidate-private.json \
  ~/.t3/worktrees/medical-record-app/t3-1380bddb
```

Il corpus originale non è modificato. SHA-256:
`856df9e282cc803e63d81c45064b2d564fc685381affbba08f4c2d4f65e73b36`.
Ricevuta: 5 pazienti, 2 voci di diario, 1 terapia, 2 osservazioni,
1 controllo e 1 allegato, con adozione della passphrase e pairing completati.
Non è stata eseguita l’intera comparazione JS/Rust: `run.mjs` ammette soltanto
Linux; la fase di seed richiesta è stata eseguita direttamente su macOS.
Non si attribuisce a questa prova equivalenza o prestazione dei due runtime.

E2E dopo `npx next build --webpack` e `npx next start --hostname 127.0.0.1 --port 38945`,
con `MF085_SYNTHETIC_E2E=1`, `MEDIFLOW_DATA_DIR=/tmp/mf846-e2efinal`,
`MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`, `E2E_BASE_URL=http://127.0.0.1:38945`
e `MEDIFLOW_NEXT_DIST_DIR=.next-visual-mf846-delivery`.
Le due variabili `MEDIFLOW_APP_FINGERPRINT` e `MEDIFLOW_APP_SOURCE_FINGERPRINT`
sono fissate a `mf846-compat-local` sia nella build sia nei processi di prova,
per mantenere coerenti HTML prerenderizzato e server mentre si aggiornano i documenti.
Gli spec isolati avviano da soli un nuovo standalone e un archivio vuoto per caso;
sono stati preparati contratto Node e asset public/static della stessa build.
Chromium usa sandbox e rete limitata al loopback. Un worker, zero retry.

| Spec | Passati | Falliti |
| --- | ---: | ---: |
| `e2e/kree8-keyboard.spec.ts` | 2 | 0 |
| `e2e/siss-composition.spec.ts` | 1 | 0 |
| `e2e/patient-bulk-import.spec.ts` | 6 | 0 |
| `e2e/onboarding-experience.spec.ts` | 8 | 0 |
| `e2e/cockpit-navigation.spec.ts` | 3 | 0 |
| `e2e/patient-identity-compatibility.spec.ts` | 1 | 0 |

Sono 20 test richiesti più una nuova regressione, tutti passati. Gli esiti dei
cinque file diversi dal CSV sono in `playwright-final.json`; il CSV finale
è in `playwright-csv-delivery.json`, ripetuto dopo gli aggiornamenti delle sue
sole fixture e asserzioni. Entrambi usano la stessa build del runtime.
Nessun fallimento E2E residuo richiede un confronto con `origin/main`.

La nuova regressione nel browser crea un CF errato attraverso il payload legacy,
lo apre nel form reale, verifica il rifiuto di un nuovo valore errato e salva
le note ripristinando il valore iniziale. La richiesta invia soltanto le note
e la versione; la rilettura conserva CF e tipo, incrementa la versione e mostra
le note cifrate sul trasporto.

Le fixture che compilano il form nuovo scelgono esplicitamente CF e, quando
serve, data esatta, usando CF sintetici validi. Il contenuto CSV importato
resta a sei colonne con `SYNTHETIC0000001` e `SYNTHETIC0000002`; le asserzioni
del download riconoscono il modello esteso a nove colonne e il nuovo testo dei
duplicati. Non sono state indebolite le asserzioni su cifratura, conferma,
destinazione, rilettura o conservazione del paziente preesistente.

Passano `npm run typecheck`, `npm run lint`, tutti i **25 comandi** del job
`repository-guards` corrente, comprese prove negative e OpenAPI contro
`origin/main`, oltre al controllo dell’assenza di stato Xcode per utente.
`npm run verify:therapy-status` passa integralmente: modello corrente con
5.903.794 stati distinti, tre mutanti, sei testimoni raggiungibili, prove del
controller e HTTP, mutanti del codice e del percorso terapia in chat.
`lib/db.ts` non è modificato e non è stato necessario un nuovo raccordo.

Passano anche gli smoke HTTP con server e archivio propri:
`test:network:home-base-readonly` (1 test), `test:network:home-base-write`
(3 test), `test:network:home-base-diary-write` (1 test). Il loro primo avvio
ha rilevato un import senza estensione nel supporto sintetico condiviso,
corretto in `patient-identity.test-support.ts`; i tre run successivi sono verdi.

Log, ricevute e manifesto SHA-256 dei sei file runtime modificati restano
separati sotto `/tmp/mf846-20261105-compat/`, senza sovrascrivere i run precedenti.
La prima selezione E2E ha rilevato metadati incoerenti e asserzioni delle fixture
rimaste al form/modello precedente; le correzioni e le ripetizioni sono registrate
in report distinti. Non si attribuiscono questi errori a `origin/main` senza prova.

Non provati in questo intervento: intera suite E2E, intera suite unit,
test web-core del launcher con browser reale, comparazione completa JS/Rust,
app Apple avviate, dispositivi fisici e servizi SISS regionali.
Intervento di gpt-6.1-sol, effort xhigh, senza deleghe; consumi non attribuibili.
Nessun dato clinico reale letto e nessun merge eseguito.
