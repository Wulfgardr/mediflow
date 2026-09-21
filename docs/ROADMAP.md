---
summary: "Canonical MediFlow product roadmap and current delivery horizons."
read_when:
  - "Changing product direction, release narrative, or Apple parity priorities."
  - "Separating shipped capabilities from future or policy-gated work."
---

# 🧭 Roadmap MediFlow

> **Il percorso del prodotto, dalle basi locali alle direzioni ancora aperte.**
> La fotografia della linea v0.8.5 descritta sotto consolida il runtime locale,
> senza dichiarare pubblicazione App Store o parità completa. Data della
> fotografia storica: 2026-09-03.
> Questa è la roadmap canonica del prodotto. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) ne descrive lo stato corrente completo; [docs/README.md](./README.md) orienta tra i documenti.

> [!NOTE]

## Roadmap vigente — 21 settembre 2026

Il [registro incrementale su Linear](https://linear.app/wulfgardr/document/mediflow-incremental-release-ledger-090-to-10-ee0392f27b72)
governa sequenza e destinazione del lavoro; le descrizioni delle issue ne
contengono i risultati e i criteri di accettazione. Questa mappa riporta la
decisione del 21 settembre e prevale sui precedenti rinvii generici alla 1.0.
Le sezioni storiche sotto conservano le prove e i limiti delle singole versioni.

| Tappa | Risultato previsto | Coordinamento e accettazione |
| --- | --- | --- |
| 0.9.0 | Consolidare le funzioni esistenti: scritture coerenti, protezione dei dati, recupero, test attendibili e semplificazione misurata. Nessuna migrazione di linguaggio. | [WUL-717](https://linear.app/wulfgardr/issue/WUL-717); ingresso [WUL-705](https://linear.app/wulfgardr/issue/WUL-705), verifica finale [WUL-735](https://linear.app/wulfgardr/issue/WUL-735). |
| 0.9.1 | Una prima operazione di lettura e scrittura condizionata attraverso servizi applicativi condivisi, con autorità, audit e recupero definiti. | [WUL-573](https://linear.app/wulfgardr/issue/WUL-573)–585. |
| 0.9.2 | Una migrazione Rust circoscritta, misurata e reversibile dietro il contratto già provato. Non una riscrittura dell'app. | [WUL-736](https://linear.app/wulfgardr/issue/WUL-736). |
| 0.9.3 | Coerenza dei flussi clinici tra Web, API e accesso agentico, con revisione delle proposte e migrazione di gruppi di operazioni dichiarati. | [WUL-586](https://linear.app/wulfgardr/issue/WUL-586), [WUL-591](https://linear.app/wulfgardr/issue/WUL-591), [WUL-592](https://linear.app/wulfgardr/issue/WUL-592). |
| 0.9.4 | Percorsi senza AI e con modelli locali, due integrazioni API remote esplicite e verifica della qualità dei risultati collegati alle fonti. | [WUL-602](https://linear.app/wulfgardr/issue/WUL-602), [WUL-743](https://linear.app/wulfgardr/issue/WUL-743). |
| 0.9.5 | Scambio FHIR R4 da qualificare: esportazione fedele, importazione in sola lettura e riconciliazione, SMART e prove sui profili dichiarati. | [WUL-618](https://linear.app/wulfgardr/issue/WUL-618), [WUL-624](https://linear.app/wulfgardr/issue/WUL-624). |
| 0.9.6 | Client nativi e mobili, Mini e distribuzione verificati sui singoli sistemi: installazione, aggiornamento, recupero e rimozione. | [WUL-632](https://linear.app/wulfgardr/issue/WUL-632); piattaforme [WUL-694](https://linear.app/wulfgardr/issue/WUL-694), Mini [WUL-696](https://linear.app/wulfgardr/issue/WUL-696). |
| 0.9.7 | Sperimentazioni avanzate di interoperabilità: CDS Hooks, Bulk Data e una sola transizione FHIR Task condizionata e rivista. | [WUL-737](https://linear.app/wulfgardr/issue/WUL-737), con [WUL-597](https://linear.app/wulfgardr/issue/WUL-597) prima delle scritture esterne. |
| 1.0 | Qualifica cumulativa del prodotto e degli artefatti dichiarati, prove dei flussi clinici, supporto sostenibile e decisione esplicita di rilascio. | [WUL-598](https://linear.app/wulfgardr/issue/WUL-598)–601, [WUL-746](https://linear.app/wulfgardr/issue/WUL-746). |

Le versioni indicano tappe, non date promesse. La 0.9.0 conserva i suoi venti
risultati e il coordinamento: le funzionalità future non diventano nuovi
prerequisiti del consolidamento. Le direzioni di ricerca accettate dall'utente
restano soggette a prove e decisioni sul loro perimetro. Backlog, codice
conservato e pianificazione non attestano implementazione o qualifica.

### Raccordo dei branch storici

I contributi già entrati in main non richiedono un secondo merge. I residui
non qualificati delle vecchie catene di PR vanno confrontati con il codice
corrente e recuperati selettivamente nel ticket pertinente, conservando SHA,
diff locali e prove. Non ripristinare vecchi adapter OCR, percorsi di autorità
o interfacce per il solo fatto che Git consenta il merge.

Per il consolidamento, il censimento [WUL-705](https://linear.app/wulfgardr/issue/WUL-705)
raccorda i residui: autenticazione e proiezioni in [WUL-725](https://linear.app/wulfgardr/issue/WUL-725),
documenti e orchestrazione AI in [WUL-726](https://linear.app/wulfgardr/issue/WUL-726),
verifiche in [WUL-729](https://linear.app/wulfgardr/issue/WUL-729), flussi e stati
esistenti in [WUL-732](https://linear.app/wulfgardr/issue/WUL-732), contratti e
claim in [WUL-734](https://linear.app/wulfgardr/issue/WUL-734).
Nuove capacità, trasporti opzionali, distribuzione nativa e Mini seguono invece
le tappe future sopra. Archiviare un ref o chiudere una PR superata non chiude
l'obbligo funzionale della relativa issue.

## 0.8.6 — release sorgente e preparazione storica

Il 7 settembre il requisito di consegna è stato esteso per rendere più
comprensibili configurazione e scelte operative: impostazioni guidate,
connessione ChatGPT ufficiale, scelta locale/online per funzione, WHO
operativo, aggiornamento AIFA, import esenzioni/protesica e parità funzionale
desktop, con Mini e headless entro i rispettivi confini. Il
[piano operativo](./analysis/2026-09-07-086-guided-configuration-plan.md) organizza
il lavoro in sei fasi, con dipendenze e prove di accettazione. iOS/iPadOS erano
separati da quella tranche; la precedente dichiarazione di sviluppo concluso
non copriva i nuovi requisiti.

La release 0.8.6, pubblicata il 20 settembre 2026, distribuisce archivi sorgente
per il runtime locale/headless su Mac con interfaccia browser localhost.
Il seguito nativo rimane distinto: la pubblicazione non attesta parità desktop
completa, installer firmati o notarizzati, né disponibilità di app complete
Windows/Linux/iOS/iPadOS. Anche l'ammissione a un deployment clinico resta una
decisione separata. L'integrazione ChatGPT è facoltativa; la scelta dei modelli
rimane vincolata al catalogo e all'autorità dell'host, con provider esterni
spenti per impostazione predefinita e risultati da rivedere.

### Preparazione storica

La [mini roadmap 0.8.6](./roadmap-086-consolidamento.md) conserva la preparazione
del lavoro: OCR con ripiego locale funzionante, accesso a ICD-11 WHO,
impostazioni più semplici, revisione della scheda paziente localhost,
configurazione iniziale assistita, revisione complessiva della qualità dei
testi e analisi GDPR/AI Act con applicabilità e prove. Contiene modelli di
lavoro, criteri di accettazione, alternative visive e una selezione preliminare
dei branch locali da riesaminare. Al 5 settembre 2026 risultavano creati il
progetto Linear, 20 issue e sei milestone; quella fotografia non attestava
consegne runtime né conformità.

## ✅ Fatto (v0.3.0)

La v0.3.0 ha costruito le prime basi operative locali, distinguendo dati, protezione e strumenti di supporto.

* **Database solido**: migrazione a SQLite autorevole con cifratura lato client
  dei campi clinici sensibili; il file non è cifrato integralmente.
* **Privacy locale**: cifratura locale dei dati clinici sensibili e assenza di cloud per impostazione predefinita; le affermazioni forti di zero-knowledge sono oggetto del successivo riallineamento `WUL-342`/`WUL-354`.
* **AI locale della versione**: integrazione di Qwen text-only per sintesi/insight e di DeepSeek OCR via Ollama. Questo è il percorso storico, non il catalogo AI delle versioni successive.
* **ICD-11**: resolver OMS locale opzionale e diagnosi strutturate codificabili;
  i problemi free-text restano reviewable.
* **Multi-ambulatorio**: gestione sedi con identificazione visiva rapida.

---

## ✅ Fatto (v0.4.0)

La v0.4.0 ha reso più espliciti i passaggi documentali e i contratti locali,
perché importare un contenuto o collegare un client non introducesse percorsi
impliciti di modifica dei dati.

* **API locale più governata**: baseline OpenAPI `/api/v1`, guard anti-drift e concorrenza ottimistica sui pazienti.
* **Import clinico più utile**: pipeline OCR-first strutturata e smart import reviewable verso diagnosi ICD-11 e terapie.
* **Archivio intelligente più operabile**: pulizia per singolo documento o completa, persistenza farmaci estratti e riallineamento dell'insight AI.
* **Sicurezza e continuità operative**: audit append-only, lockout auth, cambio PIN tramite re-wrap client-side della master key, backup artifact/preflight, scheduler notturno e retention automatica.
* **Compliance locale più esplicita**: terminology registry locale, baseline GTW/FSE, baseline SISS e pannello prescrizione con handoff controllato.
* **Stabilizzazione web/core**: `typecheck` canonico, normalizzazione condivisa dei payload paziente e riduzione del carico nei file più densi.

> Nota storica: dopo `v0.4.0` il vecchio filone `macOS/parity` è entrato in
> **riscrittura controllata**. Le Wave 1-5 successive lavorano sul nuovo client
> universale Apple/home-base, non sullo snapshot legacy.

---

## ✅ Fatto (v0.5.0)

`v0.5.0` consolida lo snapshot allora usato dal vivo: rende più leggibile la UI
web e più governato l'insieme degli strumenti AI locali. È un passaggio
successivo a `v0.4.0`, non una riscrittura retroattiva di quella versione.

* **Interfaccia clinica web più coerente**: scheda paziente, lista, form e shell impostazioni convergono verso una gerarchia visiva più leggibile e più orientata all'azione.
* **Governance AI locale più esplicita**: task contract condiviso, benchmark headless, registro candidati locali e separazione netta tra runtime operativo e lane `benchmark-only`.
* **Release hygiene ripristinata**: `lint` torna confinato ai sorgenti e i benchmark CLI generativi tornano eseguibili su `main`.
* **Narrativa prodotto riallineata**: `v0.4.0` resta la baseline storica, `v0.5.0` chiude il consolidamento AI/UI e il ciclo successivo si sposta su home-base e client native.
* **Boundary più chiari**: SISS/FSE, multi-device e stack AI vengono raccontati per quello che sono davvero, senza attribuire a MediFlow integrazioni o automatismi non ancora dimostrati.

> [!NOTE]
> Le lane `benchmark-only` (`OpenMed redaction`, `clinical_entities`, challenger generativi non promossi) restano fuori dal runtime operativo e dal claim principale della release.

---

## ✅ Fatto (v0.6.0)

Con `v0.6.0` si chiude il ciclo successivo a `v0.5`: il Mac `home-base` e i
client Apple associati danno forma al sistema locale, mentre l'elaborazione
documentale parte dagli artefatti verificabili. Le integrazioni regionali
rimangono entro confini espliciti, perché preparare un contesto non equivale
a disporre dell'autorità per inviarlo a un servizio regionale.

* **Mac come home-base concreto**: pairing esplicito, capability discovery,
  data plane pazienti e primi write versionati sono su `main`; il bundle macOS
  può avviare/fermare backend production e proxy TLS e mostra health read-only
  dei servizi locali opzionali.
* **Family Apple paired non-AI**: iPhone/iPad entrano nel disegno con core
  condiviso, cache mobile cifrata degradabile e primi workflow online
  versionati su profilo/status, diario, terapie, checkup e osservazioni.
* **Document intelligence artifact-first**: `parse/evidence` cifrato sugli
  allegati, `sectionMap`, ancore fonte e conflitti reviewable diventano la base
  runtime prudente per `Patient Insight` e create-flow documentale.
* **SISS/FSE più maturo ma onesto**: corpus locale con sync/freshness,
  scenario notes per prescrittivo, FSE, NAR, SGDT/PAI/COT e certificati, e
  boundary `webapp-assisted` finché non esiste una qualifica `SSI/A2A`.
* **AI governance più netta**: safety gate con kill-switch su `patient-insight`,
  `smart-import` e `document-synthesis`, più model governance delle decisioni
  documentali (`WUL-355`, `WUL-358`); MLX resta benchmark-visible e
  diagnosticabile ma non runtime clinico; le lane OpenMed/NER/TurboQuant/comparator
  restano benchmark-only o shadow.
* **Cancellazione paziente reversibile**: soft-delete con tombstone
  (`deletedAt`/`deletionReason`) e version guard (ADR 0066, `WUL-306`), che non
  orfana i figli clinici e lascia il contratto API invariato; lato admin
  `purge-patient` (erasure GDPR con dry-run) e `restore-patient`, entrambi audited.
  La coda post-review, indicata come azzerata in quel closeout, risulta di nuovo
  attiva dal 2026-06-13/16 tramite `WUL-341`, `WUL-356` e la proposta `WUL-373`.

> [!WARNING]
> `v0.6.0` non dichiara sync completo, multi-master, attachment remoti, cataloghi remoti, prescribing SISS nativo o AI cloud di default. Questi restano esplicitamente fuori dal claim di release.

---

## ✅ Fatto (v0.7.0)

`v0.7.0` consolida la linea principale successiva a `v0.6.0`. Il lavoro di
revisione rafforza i controlli sui dati clinici e sulle funzioni AI, rende più
leggibile l'interfaccia Kree8 e riallinea la documentazione pubblica e OSS a
ciò che il prodotto offre, senza trasformare le direzioni future in capacità
presenti.

* **Stabilizzazione dati e API**: soft-delete paziente, ciclo di vita uniforme
  delle sotto-risorse cliniche, token paired inerti a modalità rete spenta e
  controlli più stretti su allegati, checkup, impostazioni e repair DB.
* **Esperienza più leggibile**: cockpit, scheda paziente e impostazioni hanno
  copy più asciutto, dark mode completa, palette semantica più chiara e flusso
  a un clic verso la Scheda.
* **AI/document intelligence governate**: kill-switch e readiness storage più
  robusti per Patient Insight, Smart Import e document synthesis, senza
  promuovere lane benchmark-only nel runtime clinico.
* **Pubblicazione più onesta**: README, FAQ, roadmap, stato sistema e facciata
  OSS raccontano lo stato corrente senza overclaim su SISS/FSE, cloud, AI o
  automazione clinica.

> [!NOTE]
> Lo snapshot macOS precedente a `v0.4.0` resta storico. La base prodotto da
> estendere e il bundle Apple/home-base universale; i gap residui sono tracciati
> dalla matrice parity e dalle issue dedicate, non dal vecchio filone congelato.

---

## ✅ Fatto (v0.7.1)

`v0.7.1` rende visibile il lavoro Apple/nativo senza confonderlo con la
portabilità ancora iniziale. La direzione verificabile è una web app locale,
un fronte nativo più avanzato su macOS, iPhone/iPad come client associati e un
core Swift testato anche su Linux/Windows. Da questi risultati non discendono
tre app complete.

* **macOS avanti nel percorso native**: shell Apple/home-base, workspace
  paziente condiviso, design Vetro Clinico/Liquid Glass, privacy shield,
  runtime panel e slice cliniche non-AI portate dentro un artifact Xcode
  verificabile.
* **Core Swift condiviso**: `MediFlowCore` porta fuori dalla UI logica
  clinica, filtri, contratti, cifratura, conflict handling, clinical scales e
  store SQLite locale.
* **Gate tri-OS**: Linux, macOS e Windows costruiscono e testano il core
  condiviso in CI. Questo prova la direzione di portabilità, ma non equivale a
  parity applicativa Windows/Linux.
* **Convergenza pubblica completata**: questo punto storico sull'export OSS e
  superato da `WUL-477`; la repository pubblica e ora l'unica fonte operativa,
  mentre materiali sensibili e artifact temporanei restano fuori da Git.

---

## ✅ Consegnato nella linea v0.7.3

La linea v0.7.3 consegna le prime superfici Lume, una struttura AI locale
modulare, il flusso documentale subordinato alla revisione, controlli più
robusti su runtime e dati, il controllo pubblico delle affermazioni e gli
strumenti P6 sintetici. Non comprende la migrazione Lume completa né il verbale
manuale di `WUL-481`, che restano lavoro successivo.

Questa roadmap conserva il percorso del prodotto;
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) mette invece in relazione
lo stato operativo di runtime, confini, elaborazione documentale, home-base,
client Apple e gestione della repository pubblica.

## ✅ v0.8.5: integrazioni e gate

Il tree `0.8.5` riunisce i controlli documentali rafforzati, le superfici web
Lume e le correzioni Apple presenti in quella revisione locale. Non cambia la
destinazione d'uso dichiarata, o intended purpose. La tabella distingue ciò
che era integrato dalle conclusioni che quelle evidenze non autorizzano.

| Area | Evidenza locale | Non dichiarato |
| --- | --- | --- |
| Lume | Token DTCG, mirror CSS e consumatori web sono attivi. | Parity estetica completa o redesign concluso. |
| Documenti | Stati accessibili e registro separato delle proposte sono integrati. | Diagnosi auto-applicate o nuova inbox. |
| Apple | Fallback OCR Apple Vision, recording on-device review-first e core condiviso sono nel tree; le prove exact-SHA restano nel closeout separato. | VoiceOver mobile provato, conformità o App Store readiness. |
| AI | Fabric review-only, provider v2 `default OFF`, Headless/MCP, F10 preview-only e planner read-only sono integrati. | Egress live, credenziali, autorità agentica generale o automazione clinica. |

La deroga VoiceOver mobile conserva il valore di precedente storico: non
aggiunge una prova alla 0.8.5 e non rende audit AX o test UI equivalenti a
VoiceOver reale. Ogni altro gate rosso o indeterminato rimane bloccante.
Le sottosezioni seguenti descrivono il perimetro e i seguiti della linea 0.8.5;
non estendono per implicazione la consegna sorgente 0.8.6 descritta sopra.

<a id="modalita-network-home-base"></a>

### Modalità network home-base

* **Nodo centrale locale**: pairing esplicito, capability discovery, lifecycle paziente, moduli clinici non-AI, prestazioni/protesica, cataloghi read-only e create documentale manuale sono su `main`; restano da chiudere UX, offline e superfici policy-gated senza rompere il boundary.
* **Replica e fallback offline**: continuità operativa tra dispositivi con riconciliazione esplicita ancora da promuovere oltre il mirror/snapshot governato.
* **Runtime AI centralizzabile**: opzione locale di studio per client meno potenti, senza egress cloud e ancora separata dal data plane clinico.

### Document intelligence prudente

* **Artifact `parse/evidence` su allegati**: la prima slice runtime del `document evidence ledger` è già su `main`, con `patients.documentInsights` mantenuto come projection compatibile.
* **Decisioni separate dall'estrazione**: il seguito del lavoro rafforza governo delle fonti, loro attualità, esclusioni e possibilità di revisione, senza introdurre importazioni silenziose o riscritture in blocco.
* **Safety gate AI**: kill-switch per `patient-insight`, `smart-import` e `document-synthesis` e model governance delle decisioni documentali sono già su `main` (`WUL-355`, `WUL-358`); l'AI locale resta review-first, senza scrittura clinica automatica.
* **Control-flow documentale**: il router usa `shadow` come default e può
  evitare il modello solo per route eleggibili ad alta confidenza, conservando
  sempre review e salvataggio espliciti.

### Stack intelligente locale

* **Intelligence Fabric review-only**: la struttura organizza funzioni
  facoltative, non impone l'uso dell'AI. Patient Insight, Smart Import,
  Document Synthesis e Treatment Reasoning mantengono ingressi e punti di
  esecuzione distinti; ricevute, provenienza e validità del contesto sono
  visibili, ma non autorizzano l'applicazione dei risultati.
* **Provider capability-specific**: Ollama serve le capability locali ammesse;
  ATHENA/MLX è limitato a Treatment Reasoning. Non esiste fallback generico.
* **Provider v2 `default OFF`**: secret broker, adapter ufficiali
  OpenAI/Anthropic e probe amministrativa exact-intent sono integrati. Le prove
  usano transport fake: credenziali, rete live e retention account non sono
  dichiarate.
* **OCR model-agnostic**: AnyDoc resta il primo passaggio e Apple Vision il
  fallback locale per le sole pagine PDF `needsOcr`. DeepSeek-OCR 2/CUDA è
  `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.
* **Headless governato**: il Supervisor Node portabile isola Web standalone e
  MCP `stdio`, possiede lease, revoca, contesto e audit. Mini conserva catalogo
  e foundation CLI ma non ha binding production al Supervisor; installer e
  onboarding su host esterni restano prove separate.
* **F10 e planner**: MCP prepara soltanto la preview F10; il commit richiede la
  UI Web trusted, step-up e gesto medico. Il planner resta read-only e compone
  al massimo due operazioni allowlisted senza SQL libero.
* **Attese locali**: la prima slice web collega prestazione attesa e risultato;
  non estende il workflow ai client paired e non introduce scritture autonome.
* **Automazione graduata futura**: proposta, anteprima, finestra di
  annullamento, ripristino e pannello audit richiedono pacchetti di lavoro e
  policy dedicati. Non sono un'estensione implicita delle funzioni presenti:
  diagnosi, prescrizioni e identità paziente non sono applicabili
  automaticamente per impostazione predefinita.
* **Inbox conversazionale fuori dalla 0.8**: le route conversazionali esistenti
  non equivalgono a una inbox intelligente. Chiarimento guidato, buffer locale
  temporaneo e conversione confermata restano roadmap.

### Esperienza nativa

* **Apple/native su mainline**: macOS resta il fronte nativo più avanzato;
  iPhone/iPad proseguono come client paired sopra contratti locali versionati.
* **Wave 6 / closeout parity**: `WUL-479` governa la matrice canonica. PR #21 e
  `WUL-401`, ora completata, hanno consegnato bundle, fixture, probe AX e
  runbook P6 di base; `WUL-481` conserva i prerequisiti operativi bloccati e il
  gate manuale sul Mac sbloccato. `WUL-403` resta la corsia per l'offline
  degradato, mentre il workflow documentale nativo resta condizionato da ADR
  0076 e dagli spike `WUL-417`/`WUL-383`.
* **Stack voice visit**: il target macOS 26+ integra cattura e trascrizione
  italiana Apple on-device con consenso, audio bounded in RAM e transcript
  review-first. Microfono reale, validazione clinica e writer automatici
  restano fuori dal claim.
* **Windows/Linux oltre il core**: i launcher sorgente 0.8.5 sono presenti;
  procedere per slice piccole su floor hardware, packaging e distribuzione
  tri-OS, senza promettere parity applicativa prima delle prove.
* **Provider locali Apple**: `WUL-417` e `WUL-418` restano benchmark-first, con
  kill-switch, test e decisioni esplicite prima di qualunque promozione runtime.

### Shell ufficiale e sperimentazioni controllate

* **Shell web ufficiale**: il cockpit Kree8 e la root live `/` supportata su `main` (ADR 0060); Graphite resta storico solo per il principio di shell unica/no selector.
* **Niente preview profiles su `main`**: AI, Smart Import e contesto paziente SISS/FSE vivono direttamente nella shell ufficiale quando sono maturi.
* **Sperimentazioni esplicite**: nuove fette AI, import o SISS entrano solo dopo verifica dedicata, non come selector runtime persistito.
* **Guardrail locali**: revision fingerprint, `/api/system/revision` e reset `.next` source-aware riducono il rischio di testare una shell stale.
* **Lume progressiva**: ADR 0078 e `Accepted`; canone L0, token L1a,
  convivenza web L1b, cockpit, workspace e lock screen sono su `main`. Sul
  nativo e consegnata la card clinica opaca; il resto della migrazione L0-L6 e
  la QA manuale completa rimangono aperti.

### SISS/FSE e base documentale regionale

* **Boundary attuale**: MediFlow prepara il contesto e richiama percorsi ufficiali; il prescrittivo resta `webapp-assisted` e non una UI regionale custom dentro MediFlow.
* **Prescrizioni di prestazione**: dominio locale separato dalle terapie farmacologiche per visite, esami, imaging, riabilitazione e screening, con item codificabili e matching sul repertorio locale; niente generazione NRE ne invio prescrittivo regionale.
* **Corpus locale SISS/FSE**: manifest sorgenti, fetch/sync incrementale e report di freschezza sono già su `main` come base di lavoro documentale, fuori dal runtime clinico; l'accesso MCP resta read-only sopra il corpus approvato.
* **Integrazione più profonda**: prima di codice runtime servono scenari approvati, qualifica/provisioning coerenti con `SSI/A2A` e documentazione scenario-specific verificabile.

### Interazione vocale

* **Dettatura**: estendere la cattura Apple on-device oltre il percorso macOS
  corrente soltanto con prove dedicate e mantenendo review e consenso.
* **Chat**: una direzione di interazione è chiedere al sistema, per esempio,
  *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*. L'esempio
  descrive un obiettivo, non un comando già consegnato.

---

## 🧭 Visione (v1.0.0)

La direzione è un ecosistema clinico open source e locale, che un medico possa
installare e usare senza dover costruire un'infrastruttura complessa. Renderlo
affidabile significa far crescere insieme funzioni, controlli e prove, senza
scambiare questa visione per uno stato già raggiunto.

Hai idee o critiche? Apri una issue su GitHub.
