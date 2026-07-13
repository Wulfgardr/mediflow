# Changelog

Questo file raccoglie i cambiamenti rilevanti di MediFlow.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
e questo progetto aderisce al [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.3] - 2026-07-13

> Nota release: la `0.7.3` consolida la linea local-first con un'adozione
> progressiva di Lume, uno stack AI locale più modulare e nuovi gate sui claim
> pubblici. La migrazione Lume completa e il verbale manuale P6 sul Mac
> sbloccato restano fuori da questa release.

### Aggiunto

- **Lume, adozione progressiva**: ADR 0078 `Accepted`, token condivisi e prime
  superfici web su cockpit, workspace clinico e lock screen; sul client nativo
  è presente la card clinica opaca. Settings, componenti interni e QA manuale
  completa restano aperti.
- **Stack AI locale modulare**: `OllamaAdapter`, `AIService`, contratti di task
  e router documentale `shadow` preparano provider e control-flow separati.
  Ollama resta l'unico provider operativo e il gate egress resta chiuso in
  attesa della redaction lane.
- **Claims guard pubblico**: controllo automatico di README, documentazione,
  UI, client nativo, asset OSS e white paper contro claim non dimostrati su AI,
  FHIR, GDPR, cifratura, cloud e integrazioni regionali.
- **Tooling P6 ripetibile**: bundle, fixture sintetiche, probe di accessibilità
  e runbook per la verifica packaged. Il verbale manuale sul Mac sbloccato
  resta governato da `WUL-481` e non è sostituito dai test sintetici.

### Migliorato

- **Affidabilità locale**: hardening di backup, cifratura, rollback delle
  transazioni, ricerca farmaci, campi nativi bloccati, dipendenze di produzione
  e runtime PM2, con test di regressione dedicati.
- **Flussi review-first**: il control-flow documentale può evitare il modello
  solo per casi eleggibili ad alta confidenza; attese e salvataggi clinici
  restano espliciti e revisionabili.
- **White paper**: nuova direzione Lume opaca, copy riallineato allo stato reale
  e metadata aggiornati alla linea `0.7.3`.
- **Topologia repository**: `Wulfgardr/mediflow` pubblica è l'unica fonte
  operativa per sviluppo, issue, branch, tag e release.

### Confini

- Lume è parzialmente implementato: nessun claim di parity UI completa.
- FHIR resta una mappatura export-only v0; non è dichiarata conformità completa
  né ingestione garantita da sistemi terzi.
- Il percorso SISS/FSE resta contestuale e `webapp-assisted`, senza
  sincronizzazione, writeback o invio prescrittivo diretto certificati.
- Nessun cloud o provider AI remoto è attivo di default; nessuna scrittura
  clinica viene applicata senza revisione esplicita.

## [0.7.2] - 2026-07-09

> Nota release: la `0.7.2` chiude la parità del boundary paired per il client
> Apple. Il client nativo raggiunge la web app sul ciclo di vita del paziente e
> sulle famiglie cliniche mancanti, sempre entro i confini local-first e senza
> hard delete remoto.

### Aggiunto

- **Ciclo di vita paziente sul boundary paired**: creazione via wire, cestino
  con soft-delete e motivazione cifrata, ripristino, tutti con concorrenza
  ottimistica e capability dedicata. Il client Apple crea e gestisce lo stato
  del paziente senza accesso diretto al database.
- **Prestazioni e protesica sul boundary**: nuove famiglie
  `/api/v1/network/service-prescriptions`, `service-prescription-items`,
  `service-catalog` e `prosthetic-prescriptions`, con concorrenza ottimistica
  (nuova colonna `version`) e superfici native corrispondenti. Nessun hard
  delete remoto.
- **Export FHIR del paziente lato client**: il bundle FHIR viene generato sul
  dispositivo dai dati già decifrati, con pre-check di validazione FSE che
  blocca gli errori e chiede conferma sui warning. Il server non vede mai il
  contenuto in chiaro, e un contratto golden garantisce l'equivalenza tra la
  generazione web e quella nativa.
- **Discovery e guardia di revisione paired**: `capabilities`, `identity` e
  `node` accettano l'autenticazione del client paired oltre al token locale, e
  una nuova rotta di revisione espone solo l'impronta pubblica della build per
  rilevare disallineamenti di versione dopo un aggiornamento.
- **Terminologia nativa**: autocomplete LOINC e UCUM nel form osservazioni del
  client Apple, appoggiato al boundary di terminologia.
- **Visita review-first da transcript sintetico**: boundary ADR 0072, workspace
  web per bozza visita manuale o dettata, endpoint interno
  `POST /api/visit-session/draft` e test deterministico su transcript sintetico.
  Nessuna acquisizione di audio reale, nessun raw audio persistito e nessuna
  scrittura clinica senza revisione esplicita.

### Migliorato

- **Concorrenza ottimistica generalizzata**: contratto `VERSION_CONFLICT`
  condiviso e PHI-safe esteso alle famiglie prestazioni e protesica, con le
  cancellazioni host protette dalla versione.

### Crediti

- Aggiunta la pagina [CREDITS.md](./CREDITS.md) con le attribuzioni in chiaro di
  ogni fonte di ispirazione, modello, libreria e runtime, con URL e licenze.

## [0.7.1] - 2026-07-03

> Nota release: `v0.7.1` consolida il grande ramo Apple/native e lo prepara al
> mainline: macOS diventa il fronte piu avanzato dell'app nativa, iPhone/iPad
> restano client paired sul modello `home-base`, e Linux/Windows entrano come
> gate di portabilita del core condiviso, non come promessa di app complete.

### Aggiunto

- **App Apple/native Fase 0 avanzata**: nuova shell Apple/home-base, design kit
  Vetro Clinico/Liquid Glass, workspace paziente condiviso, privacy shield,
  pannello runtime e flussi clinici nativi piu vicini alla web app.
- **Core Swift condiviso tri-OS**: `MediFlowCore` concentra logica portabile,
  filtri, contratti, cifratura, conflict handling, clinical scales, SQLite
  vendorizzato e test dedicati eseguibili su macOS, Linux e Windows.
- **Store locale native**: prime superfici read/write verso SQLite locale con
  vettori crypto, store pazienti, store clinico, concorrenza ottimistica e
  idempotenza dei create clinici.
- **Contratto ambulatori paired**: `GET /api/v1/network/ambulatories` entra nel
  contratto OpenAPI e nella documentazione della superficie `/api/v1`.

### Migliorato

- **CI native e tri-OS**: workflow GitHub separati per Apple native e core
  Linux/macOS/Windows; la gate Windows usa Swift corrente e SDK compatibile.
- **OSS export piu pulito**: artefatti temporanei, analisi interne e materiali
  di coordinamento/sviluppo restano fuori dall'export pubblico.
- **Narrativa pubblica piu aggiornata**: README, FAQ, roadmap e facciata OSS
  descrivono `0.7.1` senza il vecchio paragone con `0.3`, distinguendo web app,
  app Apple/native e core tri-OS.

### Confini

- macOS e il fronte nativo piu maturo; Windows e Linux dimostrano oggi
  portabilita del core e della CI, non parity applicativa completa.
- La release non introduce sync automatico, multi-master, hard delete remoto,
  integrazione SISS/FSE certificata, prescrizione regionale nativa o AI cloud
  di default.
- La 0.7.1 richiede CI verde su `main` dopo il merge della PR Apple/native
  prima di tag o pubblicazione.

## [0.7.0] - 2026-06-16

> ⚠️ Nota di compatibilità: l'unificazione del ciclo di vita delle sotto-risorse cliniche su `/api/v1` (`WUL-308`) è una breaking change per il client nativo macOS storico. L'adeguamento resta tracciato in `WUL-333`; la release `0.7.0` pubblica il mainline web/home-base, documentazione e facciata OSS aggiornate, mantenendo il limite nativo esplicito.

### 🔒 Sicurezza dati

- **Dati cifrati mai sovrascritti dal placeholder (`WUL-323`)**: se la decifratura di un campo fallisce, il valore cifrato originale viene preservato; la dicitura `[LOCKED DATA]` è solo di presentazione e non può più essere salvata al posto del dato reale.
- **Date dei backup pianificati coerenti (`WUL-319`)**: gli artifact di backup serializzano le date come stringhe ISO e il ripristino riconosce anche i valori numerici legacy, evitando date corrotte dopo un restore.
- **Soft-delete paziente (ADR 0066, `WUL-306`)**: l'eliminazione di un paziente scrive un tombstone reversibile (`deletedAt`/`deletionReason`) con version guard invece di cancellare la riga, senza orfanare i dati clinici figli e con contratto API invariato; nuovi strumenti admin `purge-patient` (erasure GDPR esplicita con dry-run, audit `patient.purged`) e `restore-patient` (audit `patient.restored`), più bonifica degli orfani storici in `fix-orphans` dietro flag esplicito. Rollback sicuro: il codice precedente ignora le nuove colonne.
- **Token di rete inerti a modalità spenta (`WUL-307`)**: con la modalità `network-home-base` disattivata i token dei client paired non possono più leggere o scrivere dati (`403 NETWORK_MODE_DISABLED`); i pairing restano conservati e tornano operativi alla riattivazione.
- **Scritture cliniche legacy più robuste (`WUL-345`)**: le scritture legacy su diario e profilo passano da version guard coerente, allineate al ciclo di vita `/api/v1`, riducendo i conflitti silenziosi.

### 🔌 API v1

- ⚠️ **Ciclo di vita unificato delle sotto-risorse cliniche (`WUL-308`)**: diario, terapie, checkup e osservazioni su `/api/v1` condividono ora version guard con `409` sulle scritture, liste che escludono i record soft-deleted (opt-in `includeDeleted`), soft delete su tutte le `DELETE` e audit che distingue eliminazione da aggiornamento. Breaking per il client nativo macOS, adeguamento tracciato in `WUL-333`.
- **Ambulatorio principale senza perdita di appartenenze (`WUL-309`)**: impostare l'ambulatorio dal profilo paziente aggiorna solo l'ambulatorio principale e non cancella più le altre appartenenze multi-ambulatorio, sia sul percorso `/api/v1` sia su quello di rete.
- **Hardening allegati, checkup e impostazioni (`WUL-326`)**: limite di dimensione sugli allegati (configurabile, default 25 MiB, risposta `413`), accettazione degli envelope cifrati lato client, verifica dell'esistenza del paziente, validazione input sulla creazione checkup (`400`), normalizzazione condivisa dei valori impostazioni, errori generici da `fix-orphans` e `update-awareness` protetto da sessione, mantenendo minimale il probe di revisione usato da launcher e lock screen.

### 🤖 AI/Documenti

- **Coda OCR per documenti senza testo (`WUL-237`)**: i documenti senza testo leggibile entrano in una coda visibile (pannello `Coda OCR`) con stati e motivi in italiano; dopo l'OCR il documento viene rielaborato in modo idempotente e nessuna proposta clinica viene generata finché il testo non è sufficiente.
- **Estrazione identità documentale più prudente (`WUL-324`)**: la data di nascita non viene più dedotta da una data qualsiasi del documento (meglio assente che sbagliata), le date non slittano più di un giorno per fuso orario e il riconoscimento del codice fiscale gestisce le omocodie.
- **Errori AI visibili e OCR con timeout (`WUL-325`)**: gli errori durante il download dei modelli Ollama vengono mostrati invece di apparire come successi, la generazione OCR ha ora un timeout configurabile e la redazione OpenMed non altera più il testo in ingresso, mantenendo corretti gli offset delle entità.
- **Safety gate AI più solidi (`WUL-358`)**: kill-switch induriti per Patient Insight, Smart Import e document synthesis, con model governance delle decisioni documentali; quando una lane è disattivata non può essere aggirata.
- **Readiness rollout AI consolidata (`WUL-355`)**: artifact e storage di readiness delle lane AI più robusti e verificabili prima di qualunque promozione prudente.

### 🖥️ Interfaccia

- **Meta-testo ripulito su tutta la superficie**: oltre cento stringhe di contorno rimosse o riscritte su cockpit, workspace, impostazioni, onboarding e modali (qualificatori `locale` ridondanti, istruzioni di navigazione dentro slot clinici, caption autoevidenti, duplicazioni come `Mac principale locale` + `Dati in locale` nel rail); gli stati vuoti dichiarano ora l'assenza del dato invece di suggerire dove cliccare.
- **Flusso paziente a un clic verso la Scheda**: `Apri scheda paziente` è l'azione primaria ovunque, la riga della lista ha un'azione diretta alla scheda, `Quadro` resta come vista in-cockpit senza rimontare la rotta, l'anteprima caso offre anche `Nuova voce` e `Documenti` (due clic per i task più frequenti) e i ritorni da diario, anagrafica e scale convergono tutti su `/patients/[id]/modules`.
- **Armonia visiva e dark mode completa**: palette semantica sobria con coppie dark dedicate (verde, ambra, blu, violetto e corallo reali al posto dello slate uniforme), scala tipografica normalizzata da 15 a 8 corpi, raggi e densità su token condivisi tra cockpit e workspace shell, gradiente AI sancito dal contratto ripristinato in forma desaturata; risolti i resti light in dark mode su nav impostazioni, righe agenda, toggle, sweep SISS e sfondo ambientale.
- **Accento blu sobrio (`WUL-232`)**: brand mark di cockpit, workspace e lock screen in blu, con focus ring, tinta del marchio e hover hairline accent nel workspace shell; le azioni primarie restano ink e il gradiente resta confinato al bottone AI.
- **Impostazioni riorganizzate (`WUL-297`)**: da pagina monolitica a sezioni con sidebar (Generale, Sicurezza e Dati, Intelligenza Artificiale, Avanzate), `/settings` come dashboard `Stato sistema` con redirect dei vecchi anchor, ricerca rapida CMD+K, toggle Privacy Mode sempre disponibile nell'header e conferme digitate (`RIPRISTINA`/`RESET`) per le azioni distruttive.
- **`Cosa rivedere adesso` in scheda paziente (`WUL-262`)**: riepilogo unico di ciò che attende revisione (insight, evidenze, smart import, archivio) con link diretti e motivi di blocco visibili, senza alcuna scrittura automatica.
- **Motivo dello stato non più perso (`WUL-310`)**: il form di modifica paziente salva di nuovo il campo `statusReason`.
- **Autocomplete ICD senza risultati obsoleti (`WUL-311`)**: i suggerimenti diagnostici scartano le risposte arrivate fuori ordine e usano un debounce, evitando liste incoerenti durante la digitazione.
- **Autocomplete ICD più leggibile (`WUL-339`)**: i suggerimenti diagnostici restano visibili e coerenti durante la digitazione (complementare al debounce/ordine di `WUL-311`).
- **Rifiniture impostazioni e cockpit (`WUL-340`)**: overview impostazioni e righe del cockpit più pulite e coerenti con la palette semantica.

### 🧰 Manutenzione

- **Riparazione database a prova di crash (`WUL-321`)**: `repair-db` usa il backup online di SQLite con checkpoint WAL, sostituzione atomica per rinomina, lock per percorso (una seconda riparazione concorrente riceve `409`) e recupero automatico al riavvio dei file residui, con fallback legacy `VACUUM INTO` al boot.
- **Svuota contenitore test più sicuro (`WUL-322`)**: la pulizia seleziona i pazienti per appartenenza effettiva al contenitore test, esclude chi ha appartenenze attive altrove e applica un soft delete dedicato (motivo `test-container-clear`) in un'unica transazione, con audit per paziente.
- **Contesto di build Docker più stretto (`WUL-320`)**: `.dockerignore` e igiene dei test rich-text riducono il contesto inviato al build.

## [0.6.0] - 2026-05-02

> Nota release: `v0.6.0` formalizza il ciclo post-`v0.5.0`: MediFlow non e piu
> soltanto web app locale + AI governata, ma un sistema local-first con Mac
> `home-base`, primi client Apple paired, document intelligence artifact-first,
> scope sync completo, hard delete remoto, attachment remoti, cataloghi remoti,
> runtime AI remoto di default e integrazione regionale nativa certificata.

### ✨ Aggiunto

- **Update awareness locale**: pannello Impostazioni per confrontare versione installata e versione disponibile dichiarata da runtime/manifest locale, con changelog minimo e azione `Piu tardi` senza egress automatico.
- **Home-base read-only eseguibile**: modalita `network-home-base`, overview Settings, pairing PHI-safe e primo data plane `/api/v1/network/patients*` protetto da `paired client + sessione operatore`.
- **Mac home-base packaged**: il bundle macOS usa la shell Apple/home-base come entrypoint, gestisce esplicitamente backend web production e proxy TLS con stop bounded/escalation, e mantiene Ollama/Docker-ICD come diagnostica read-only non app-managed.
- **Client iPhone/iPad paired non-AI**: lista/dettaglio pazienti, cache mobile cifrata con stato offline degradato e primi workflow online versionati sui moduli core tramite `/api/v1/network/*`, senza accesso diretto a SQLite.
- **Write paired profilo e diario**: boundary `/api/v1/network/patients/{id}` e `/api/v1/network/patients/{id}/entries*` con capability dedicate, `version`, conflitti `409` PHI-safe e soft delete del diario.
- **Write paired terapie**: boundary `/api/v1/network/patients/{id}/therapies*` con capability dedicate, `therapies.version`, soft delete e niente prescribing SISS o campi AI/document-derived.
- **Write paired osservazioni**: boundary `/api/v1/network/patients/{id}/observations*` con capability dedicate, `observations.version`, soft delete, `409` PHI-safe e audit, senza hard delete remoto o campi AI/document-derived.
- **Write paired checkup**: boundary `/api/v1/network/patients/{id}/checkups*` con capability dedicate, `checkups.version`, soft delete, `409` PHI-safe e audit, senza hard delete remoto o campi AI/document-derived.
- **Document intelligence piu esplicita**: first slice runtime del `document evidence ledger` con artifact `parse/evidence` cifrato sugli allegati e primo consumer artifact-first in `AI Patient Insight`.
- **Parse/evidence section-aware**: artifact documentali con `sectionMap`, ancore `page/section/snippet` e conflitti terapeutici reviewable senza migrazione DB o auto-write.
- **Nuova anagrafica document-driven reviewable**: create-flow da documento con review esplicita, riconciliazione locale ICD/AIFA e persistenza prudente delle terapie confermate.
- **Clinical Workbench unico su `main`**: preview profiles runtime ritirati; AI, Smart Import e contesto paziente SISS/FSE vivono nella shell ufficiale.
- **Corpus SISS/FSE locale**: manifest sorgenti, sync incrementale e report di freschezza preparano le integrazioni regionali future senza entrare nel runtime clinico.
- **Lane AI opt-in e shadow-only piu disciplinate**: comparator cloud `gpt-5.4` per engineering interno e adapter OpenMed `redaction.v1` separato dal runtime clinico.
- **MLX parity benchmark-visible**: MLX e visibile in benchmark, registry comparativo e diagnostica home-base read-only, con guard dedicato; Ollama resta runtime clinico standard e OCR resta Ollama-only.

### 🧪 Migliorato

- **Smart Import piu prudente**: normalizzazione therapy-state, guard su terapie `manual-only` o senza posologia sufficiente e soppressione dei duplicati referral-only quando la fonte non introduce novita clinica.
- **Input documentali piu robusti**: normalizzazione condivisa per PDF/CDA/CCD e riuso della stessa recovery path nei consumer documentali principali.
- **Resolver clinici benchmarkabili**: runner dedicati WHO ICD-11 e AIFA per misurare recall, latenza e mismatch reali sul catalogo locale.
- **Parity legacy chiusa**: i tracker web/macOS storici sono stati rolluppati, con click-map e manifest Apple-wide a distinguere evidenza coperta da gap futuri.

### 🔒 Hardening

- **Shell locale piu resiliente ai drift di revisione**: fingerprint di sorgente, endpoint `/api/system/revision`, reload soft delle tab attive e reset `.next` source-aware nello start script.
- **Boundary paired piu espliciti**: profilo, diario, terapie, checkup e osservazioni hanno capability e ADR dedicate, con hard delete remoto, sync, cataloghi e campi AI/documentali fuori scope.
- **Standalone runtime guard**: il bundle home-base blocca artefatti locali, database, tmp e documenti privati prima di copiare il backend production nel `.app`.

### 📚 Documentazione

- **Lettura completa dello stato sistema**: aggiunto `docs/STATE_OF_THE_SYSTEM.md` come punto canonico unico per prodotto, runtime, dati, sicurezza, AI/document intelligence, home-base, SISS/FSE e Apple clients; il riferimento allora presente allo split private/OSS è stato poi superato da `WUL-477`.
- **Repo/GitHub riallineati al runtime reale**: README, piani, walkthrough, topologia dati, roadmap e sintesi architetturale descrivono ora `home-base` read-only, artifact `parse/evidence`, comparator/shadow lane e guard di revisione della shell locale.
- **Narrativa `v0.6` piu chiara**: README, FAQ, roadmap, architettura e mappe documentali raccontano lo stato corrente senza confronti interni, con Clinical Workbench unico, boundary SISS attuale, `home-base` packaged e client Apple paired.
- **Sweep WUL-203**: riferimento, supporto e overview docs riallineati allo stato corrente di `main`, con rimozione dei residui che presentavano i preview profiles come runtime disponibile.
- **Copy pubblico piu armonico**: le superfici GitHub privilegiano prodotto, architettura e uso reale, senza rimandi a processi interni o screenshot non piu rappresentativi.
- **Release narrative `v0.6.0`**: documentazione privata e OSS riallineata per presentare home-base, Apple paired, document intelligence artifact-first e governance chiusa come release corrente.

## [0.5.0] - 2026-03-29

> Nota release: `v0.5.0` consolida il lavoro UI/AI entrato su `main` dopo `v0.4.0`. La shell macOS storica resta fuori scope e continua la **riscrittura controllata**; restano invarianti il contratto locale `/api/v1`, il trasporto TLS e i vincoli security/local-first.

### ✨ Aggiunto

- **Governance AI locale più esplicita**: envelope condiviso `mediflow.ai.extract.v1`, benchmark headless sui task contract, benchmark `smart import` e registro candidati locali con artifact versionabili.
- **Lane benchmark-only separate per toolkit clinici esterni**: benchmark `redaction.v1` e `clinical_entities.v1` con adapter locali `OpenMed`/`HUMADEX`, runbook dedicati e stop-rules esplicite senza toccare il runtime applicativo.

### 🧪 Migliorato

- **Interfaccia clinica web**: scheda paziente, lista, form e shell impostazioni convergono verso una gerarchia visiva più leggibile, con linguaggio `liquid glass` più disciplinato e first fold più operativo.
- **Coerenza operativa web/native**: attribuzione audit per i client native preservata sul mainline e refresh auth/preview più affidabile dopo sblocco o bootstrap locale.

### 🐛 Risolto

- **Verify loop locale**: `eslint` torna confinato ai sorgenti e non attraversa più gli artifact generati locali in `tmp/**` e `.venv_openmed/**`.
- **Benchmark CLI generativi**: i runner TypeScript usati con `node --experimental-strip-types` risolvono di nuovo correttamente i moduli relativi, evitando il fail immediato in module resolution.

### 📚 Documentazione

- **Narrativa release riallineata**: README, roadmap, piano engineering e mappa documentale canonica raccontano ora `v0.5.0` come release corrente, lasciando `v0.4.0` come baseline storica e spostando home-base/native rebuild nel `post-v0.5`.

## [0.4.0] - 2026-03-19

> Nota release: dopo `v0.4.0` il filone `macOS/parity` viene sospeso e spostato in **riscrittura controllata** della shell nativa. Restano fonte di verita il contratto locale `/api/v1`, il trasporto TLS e i vincoli security/local-first; la delivery native sul vecchio client non continua oltre questo snapshot.

### ✨ Aggiunto

- **Smart import reviewable nel profilo paziente**: suggerimenti locali e confermabili per diagnosi ICD-11 e terapie a partire da note, diario clinico e documenti già analizzati.
- **Pipeline documentale OCR-first strutturata**: archivio intelligente con sintesi, qualità documento e autofill prudente delle sole diagnosi ICD esplicite.
- **Contratto `/api/v1` esplicito e conflict-aware**: baseline OpenAPI versionata, guard anti-drift, `version` ottimistico sui pazienti e risposta `409 VERSION_CONFLICT` coerente tra web e superfici condivise.
- **AI Patient Insight spiegabile**: citazioni claim-level, sezione `Fonti usate per i claim`, limiti noti espliciti, esclusione di note narrative contaminate e guardrail su output deboli o inconsistenti.
- **AI Patient Insight configurabile**: nuovi mode `full-auto` / `pro`, preset hardware e tuning locale dalle impostazioni senza dipendenze cloud.
- **Lifecycle backup v1 completo**: artifact con manifest e preflight restore, scheduler notturno locale via `launchd` e retention `keep-last-N` con anteprima dry-run/apply.
- **Cambio PIN zero-knowledge**: rotazione delle credenziali con re-wrap client-side della master key, senza ricifrare il dato clinico lato server.
- **Terminology registry locale**: versione attiva dei sistemi terminologici persistita in `settings` e letta dalle route `/api/v1/terminology/*`.
- **Integrazione SISS foundation**: baseline canonica, adapter locale con error taxonomy/correlation ID e handoff controllato dal pannello prescrizione.
- **Audit trail operativo**: writer append-only PHI-safe, attribuzione attore coerente e primo riepilogo analytics da eventi audit.

### 🧪 Migliorato

- **Operabilità documentale**: l'Archivio Intelligente può essere ripulito per singolo documento o completamente, con refresh coerente di `AI Patient Insight`, e ora persiste anche le terapie estratte dai documenti in `documentInsights`.
- **Patient PDF report**: report esteso con sezioni cliniche più complete e copertura automatica sulle sezioni generate.
- **Clinical facts benchmark**: introdotto il corpus sintetico per osservazioni `LOINC/UCUM`, con decisione `hybrid` di default e fallback `rules` tracciato.
- **Stabilizzazione web/core pre-version-bump**: normalizzazione condivisa dei payload paziente, parsing condiviso dei campi strutturati, gate `typecheck` stabile e scomposizione incrementale dei file più densi (`SecurityProvider`, `SettingsPage`).
- **Tooling di progetto**: strumenti di manutenzione piu ordinati, import backlog automatizzato e controllo piu esplicito della pubblicazione.

### 🐛 Risolto

- **Header diagnosi ICD in scheda paziente**: i campi JSON del paziente vengono di nuovo deserializzati correttamente lato web e l'intestazione mostra chip ICD leggibili con stato vuoto esplicito.
- **OCR smart su immagini e input localmente supportabili**: upload, import e diario condividono ora la stessa detection documentale; immagini comuni passano nel flusso OCR senza rifiuti ambigui.
- **Import da impegnativa più prudente**: nome e cognome non vengono più popolati con placeholder template come `NOME` e `COGNOME` quando il dato reale non è affidabile.
- **Warning build `pdfjs-dist/canvas`**: caricamento server-side differito per eliminare il rumore in `next build` senza introdurre dipendenze extra.
- **Restore backup artifact**: ripristino reso sincrono e protetto da un gate preflight esplicito prima della fase distruttiva.
- **Drift di review/stato**: riallineati branch, worktree e issue principali per ridurre falsi `In Review` o `Done` non supportati da `main`.

### 🔒 Hardening

- **Contract checks** su `/api/v1` per prevenire modifiche non documentate o breaking change silenziosi.
- **Integrity guardrails** su write path paziente con semantica conflict-aware e payload PHI-safe.
- **Never-regress policy eseguibile**: check automatici contro credenziali di default, egress non voluto, telemetria e regressioni zero-knowledge.
- **Policy auth più robuste**: lockout persistito sui tentativi falliti e bootstrap secure-first per i token locali.

### 📚 Documentazione

- **Walkthrough e mappe canoniche aggiornate** per flusso OCR-first, smart import reviewable, backup scheduler/retention, parity sweep e governance OpenAPI.
- **Baseline e matrici canoniche** aggiunte per GTW/FSE, SISS certificato, benchmark clinical facts e stabilizzazione web/core pre-release.
- **Freeze esplicito del filone macOS**: patch notes, roadmap e guide native chiariscono che la parity macOS entra in rebuild controllato dopo `v0.4.0`, senza bloccare l'evoluzione web/core.
- **Indice markdown e playbook operativi** estesi per rendere ricostruibile il lavoro tra repository, documentazione e verifiche.

## [0.3.1] - 2026-02-18

### ✨ Aggiunto

- **Terminology v1 (thin slice)**: endpoint versionati `/api/v1/terminology` (`systems`, `search`, `resolve`) per codifiche cliniche estendibili.
- **Osservazioni cliniche (LOINC + UCUM)**: Primo percorso verticale completo su schema, API web/v1 e contratti client native.
- **Pre-check export FSE**: Validazione documentale pre-export con semantica `error` (bloccante) e `warning` (confermabile).
- **Export FHIR più visibile**: CTA esplicita in scheda paziente e labeling utente più chiaro.

### 🧪 Migliorato

- **Terapie first-class AIC + ATC**: allineamento su schema, API web, API v1 e client native.
- **Live query più efficienti**: ottimizzato refresh e caricamento su percorsi ad alta frequenza di update.
- **Coerenza UX FHIR/FSE**: nomenclatura e percorso export resi espliciti in UI.

### 🔒 Hardening

- **Validazione payload più stretta** su ambulatori e operazioni bulk pazienti (`assign`, `unassign`, `move`, `duplicate`).
- **Status normalization + 404 coerenti** su route item (`entries`, `therapies`, `checkups`) in superficie web e v1.
- **Regole ambulatori più robuste**: vincolo single-default e protezioni su cancellazione con pazienti collegati.

### 📚 Documentazione

- **Mappa canonica documentazione** (`docs/README.md`) con ordine fonti e responsabilità per tema.
- **Classificazione documenti** con stato `CANONICAL`, `SECONDARY`, `LEGACY`.
- **Allineamento release docs**: intestazioni versione, roadmap e metadati documentali.

### 🙏 Tributo OpenHospital

- Questo rilascio è anche un tributo a OpenHospital: non una copia 1:1, ma un percorso di apprendimento e adattamento di pratiche mature (guardrail, integrità dati, contratti API espliciti, auditabilità) al modello local-first/zero-knowledge di MediFlow.
- La traiettoria di allineamento resta esplicita e incrementale, con evidenza operativa mantenuta separata dal racconto di prodotto.

### 🗓 Timeline (ieri e oggi)

- **2026-02-17**: snapshot di sicurezza pre-riordino (`0fb40c1`) per congelare lo stato prima degli interventi strutturali.
- **2026-02-18**: delivery di thin slice terminologie/FSE, hardening API, ottimizzazioni live query, UX export FHIR/FSE e riordino documentazione strategica.

## [0.3.0] - 2026-01-21

### ✨ Aggiunto

- **Onboarding Wizard**: Nuova procedura guidata al primo avvio per la configurazione del Profilo Utente (Nome Medico, Clinica) e consenso Privacy.
- **Profilo Utente Dinamico**: La Sidebar e l'intestazione ora mostrano i dati configurati dall'utente invece di placeholder statici.
- **Backup & Restore**:
  - Esportazione completa del database e delle chiavi di sicurezza in formato JSON cifrato (`.mediflow`).
  - Procedura di ripristino (distruttiva) per recuperare i dati su una nuova installazione.
- **Tabella Impostazioni**: Nuova tabella `settings` nel database IndexedDB per gestire le preferenze utente.
- **GDPR Compliance**:
  - Aggiunto disclaimer chiaro nel README sullo stato "Best Effort" della compliance.
  - Implementato "Privacy by Design" tramite crittografia locale.

### 🔒 Sicurezza

- **App Lock**: Sistema di blocco automatico con PIN.
- **Encryption at Rest**: Tutti i dati sensibili (note, diario, contatti) sono cifrati con AES-GCM-256 prima di essere salvati su disco.
- **Zero Knowledge**: Le chiavi di cifratura sono derivate dal PIN utente e non lasciano mai il dispositivo.

### 🐛 Risolto

- **Fix Duplicati Cursore**: Corretto un bug critico in `lib/db.ts` che causava loop infiniti e duplicati visivi nelle liste paginated quando il cursore raggiungeva la fine (EOF).
- **Fix Build Types**: Risolti errori TypeScript relativi all'interfaccia `DBCoreMutateRequest` e `AppSetting`.

### 📦 Infrastruttura

- **Docker All-in-One**: Nuovo `docker-compose.yml` che avvia App (Next.js), ICD-API e Ollama.
- **Script di Avvio**: `Start_MediFlow.command` semplificato per macOS ("Click & Run").
