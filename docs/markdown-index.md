---
summary: "Complete tracked Markdown index for MediFlow with quick purpose and consultation hints."
read_when:
  - "Finding where a MediFlow topic is documented."
  - "Adding, removing, or renaming Markdown files in the repo."
---

# Indice Completo Markdown (Repo)

> [!NOTE]
> GitHub mostra in alto solo alcuni file speciali (`README`, `CONTRIBUTING`, `SECURITY`, ecc.).
> Questo file elenca invece **tutti** i `.md` tracciati nella repository con una sintesi rapida d'uso.

Ultimo aggiornamento: 2026-07-29

## 📚 Come usare questo indice

- Se devi capire **quali file sono canonici**, parti da [docs/README.md](./README.md).
- Se devi trovare **dove sta un tema specifico**, usa le tabelle qui sotto.
- Se aggiungi/rimuovi/rinomini un `.md`, aggiorna subito questo file e [docs/README.md](./README.md).

## ⚙️ Orchestrazione e governance (consultazione sempre)

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Regole operative: boot sequence, repository pubblica canonica, privacy, branch/worktree e verifica. | Sempre, prima di iniziare un task. |
| [README.md](../README.md) | Onboarding generale progetto e punti di accesso documentazione. | Sempre, in fase di avvio. |
| [PRODUCT.md](../PRODUCT.md) | Contratto prodotto: purpose, audience, task, ruoli piattaforma, confini, anti-goal e direzione post-0.8. | Per decisioni prodotto, release narrative e separazione tra stato corrente e aspirazione. |
| [DESIGN.md](../DESIGN.md) | Contratto design multipiattaforma: Lume, gerarchia, stati, adattamenti nativi/web, accessibilità ed eccezioni. | Prima di progettare o verificare una superficie utente. |
| [docs/README.md](./README.md) | Mappa canonica della documentazione (fonte autorevole per tema). | Sempre, per decidere precedenze. |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Lettura completa dello stato corrente: prodotto, runtime, dati, AI/document intelligence, OCR macOS-only fallback, home-base, SISS/FSE, Apple clients e governance della repository pubblica. | Sempre, quando serve una vista unica e aggiornata senza ricostruire il quadro da piu documenti. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Visione architetturale stabile, confini e non-obiettivi. | Sempre, per cambi tecnici non banali. |
| [SECURITY.md](../SECURITY.md) | Policy sicurezza, threat model e regole redazione/logging. | Sempre, per qualunque cambio dati/API. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow contributivo e Definition of Done. | Sempre, prima di chiudere un task. |
| [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | Intended purpose e guard `check:claims` contro overclaim su AI, SISS/FSE, cloud, diagnosi, triage, prescrizione e automazione. | Quando si tocca copy prodotto, UI/help, README, materiale pubblico o confini AI/SISS/FSE. |
| [docs/adr/0072-voice-visit-capture-fluid-boundary.md](./adr/0072-voice-visit-capture-fluid-boundary.md) | Boundary proposto `WUL-419` per visite registrabili Fluid-style: no raw audio/schema/API/UI runtime nella prima slice, transcript/draft PHI e provider esterni solo tramite decisione opt-in. | Quando si lavora su visite registrabili, trascrizione visita, UI web recording-aware, benchmark transcript o sidecar macOS audio. |
| [CHANGELOG.md](../CHANGELOG.md) | Storico release e cambiamenti rilevanti. | Al bisogno, per contesto versioni. |
| [CREDITS.md](../CREDITS.md) | Attribuzioni per ispirazioni, modelli, librerie e runtime usati dal progetto. | Quando si verifica provenienza, licenze o uso corretto di contributi esterni. |

## 🧱 Architettura, flussi e parity

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/walkthrough.md](./walkthrough.md) | Walkthrough canonico end-to-end (web + native + servizi locali), con stato reale di `home-base`, document intelligence, fallback OCR macOS-only e shell locale. | Per capire flussi completi e integrazione moduli. |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Stato canonico complessivo del sistema, pensato come lettura unica per onboarding profondo e review trasversale. | Quando devi capire cosa esiste davvero oggi, cosa e direzione e quali confini non vanno superati. |
| [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | Topologia dati, trust boundaries, cifratura e percorsi digitali, inclusi artifact documentali cifrati e boundary `network-home-base`. | Per analisi data flow e impatti sicurezza. |
| [docs/repository-topology.md](./repository-topology.md) | Fonte canonica per repository operativa, confine Git/fuori-Git e aree top-level: runtime clinico, publication/site e tooling. | Quando devi scegliere repository, branch o collocazione di codice, asset e artefatti locali. |
| [docs/parity-matrix.md](./parity-matrix.md) | Stato canonico corrente tra localhost e client Apple, 64 capability con conteggi 30/13/21 e gate P6 residuo in `WUL-481`. | Per steering parity, click-map P6 e release readiness Apple. |
| [docs/known-limitations.md](./known-limitations.md) | Limiti noti della candidata sorgente 0.8, inclusi VoiceOver mobile, tooling di sviluppo e claim non autorizzati. | Per release readiness, note pubbliche, security posture e claim di accessibilità. |
| [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | Deep dive tecnico esteso dell'architettura MediFlow. | Per approfondimenti implementativi. |
| [docs/system_architecture.md](./system_architecture.md) | Sintesi rapida dell'architettura operativa aggiornata al `main` corrente: Clinical Workbench unico, home-base, document intelligence, OCR platform boundary, SISS/FSE e guardrail locali. | Per overview veloce in onboarding/review. |
| [drizzle/README.md](../drizzle/README.md) | Ruolo storico delle migrazioni Drizzle e relazione con le schema guard runtime. | Quando si modifica schema, indice o controllo di drift SQLite. |

## 🍎 Native, setup e testing

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/NATIVE.md](./NATIVE.md) | Guida canonica della family Apple attiva: bundle macOS packaged/home-base, client iPhone/iPad paired e core Swift condiviso. | Per struttura, build, boundary di sicurezza/parity e verifiche native correnti. |
| [native/README.md](../native/README.md) | Layout, toolchain e comandi della universal app Apple e del package Swift condiviso. | Per build, test e orientamento nel subtree `native/`. |
| [native/contracts/README.md](../native/contracts/README.md) | Oracoli byte-exact del core cross-platform, inclusi i vettori crittografici congelati. | Quando si modifica crittografia, portabilità del core o test golden. |
| [native/MediFlowMac/Sources/MediFlowSQLiteC/README.md](../native/MediFlowMac/Sources/MediFlowSQLiteC/README.md) | Provenienza e regole di aggiornamento della SQLite amalgamation inclusa nel package nativo. | Quando si aggiorna SQLite vendorizzata o la build C multipiattaforma. |
| [docs/native-setup.md](./native-setup.md) | Setup automatico ambiente client nativo. | Prima di avviare sviluppo/test native. |
| [docs/native-launch.md](./native-launch.md) | Avvio rapido app macOS via script/launcher. | Per esecuzione operativa locale. |
| [docs/local-api-tls.md](./local-api-tls.md) | TLS proxy locale e trasporto sicuro per native API. | Per debug networking/certificate pinning. |
| [docs/native-testing.md](./native-testing.md) | Strategia canonica test macOS (SwiftPM/XCTest/Xcode). | Per piani test e parity sweep. |
| [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | Runbook P6 del bundle macOS home-base: tooling di base consegnato da `WUL-401`/PR #21, prerequisiti operativi e verbale residui governati da `WUL-481`. | Per promuovere capability macOS da partial a full parity senza usare dati reali. |
| [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | Runbook del verify loop `home-base`: gate headless sintetici sul boundary di rete e smoke iPhone/iPad opzionale contro database reale. | Per modifiche a `/api/v1/network/*` o verifiche mobili `home-base` paired su simulatori Apple. |
| [docs/icd-local-setup.md](./icd-local-setup.md) | Setup locale container ICD-11. | Quando si lavora su diagnostica ICD. |

## 🩺 Prodotto, compliance e contesto clinico

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/ROADMAP.md](./ROADMAP.md) | Roadmap prodotto canonica. | Per direzione prodotto/release narrative. |
| [docs/product_roadmap.md](./product_roadmap.md) | Roadmap storica (deprecata). | Solo per contesto storico. |
| [docs/FAQ.md](./FAQ.md) | FAQ sintetiche pubbliche: stato attuale del prodotto, boundary dichiarati e orientamento rapido. | Per onboarding rapido o lettura pubblica del progetto. |
| [docs/COMPLIANCE.md](./COMPLIANCE.md) | Quadro compliance GDPR/FHIR e interoperabilità. | Per requisiti normativi e policy operative. |
| [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | Roadmap codifiche cliniche FSE/EDS. | Per sviluppo terminologie e export documentale. |
| [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | Matrice di allineamento tra baseline ufficiale GTW/FSE e stato MediFlow. | Per gap analysis ministeriale, priorità FSE e anti-drift tecnico. |
| [docs/siss-baseline.md](./siss-baseline.md) | Baseline canonica SISS: stato attuale, fonti ufficiali, matrice del prototipo contestuale, gap e sequenza di consegna. | Quando si lavora su `WUL-43`, `WUL-44`, `WUL-45`, `WUL-178` e `WUL-180`. |
| [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) | Mappa canonica di fattibilità ufficiale oltre il `portal-handoff`: separa ciò che il SISS rende tecnicamente possibile da ciò che MediFlow può fare davvero solo dopo `SSI`, scenari approvati e onboarding regionale. | Quando si lavora su `WUL-180` o si valuta prescrittivo/FSE/SGDT/Anagrafe oltre l'handoff attuale. |
| [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md) | Nota canonica `WUL-181` sul Modulo Prescrittivo Regionale e sul percorso PRREG osservato sotto `/prescrittivoRegionale`: fissa il boundary tra richiamo della webapp ufficiale, possibile supporto WS/API e re-implementazione UI non ancora dimostrata. | Quando si lavora sul prescrittivo regionale oltre il launcher attuale. |
| [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md) | Nota canonica su FSE consultazione e consenso: fissa il boundary tra launcher ufficiale, consenso, ruoli/audit, SEB/eventi e viewer/feed embedded non ancora dimostrato. | Quando si valuta la consultazione FSE contestuale oltre il launcher attuale. |
| [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md) | Blueprint canonico NAR / Anagrafe Regionale read-only: capability matrix, contract locale, failure taxonomy e data-minimization per assistiti, eligibility, esenzioni, medici prescrittori e ricettari. | Quando si valuta NAR oltre il launcher Gaia e prima di qualunque runtime custom o sync anagrafica. |
| [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md) | Nota canonica su SGDT/PAI e COT per MMG/SSI: restringe SGDT ai casi PAI/CE-MMG e COT/transizioni documentati e separa quel perimetro da launcher generici, feed PAI o dispatch COT non dimostrati. | Quando si valuta SGDT oltre il boundary SISS/FSE attuale. |
| [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md) | Nota canonica sui Certificati di malattia: separa Web Application / handoff governato da UI custom o backend-first non ancora dimostrati. | Quando si valuta il dominio certificati oltre il boundary SISS attuale. |
| [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md) | Runbook canonico del corpus documentale locale SISS/FSE: manifest sorgenti, fetch/sync fuori Git, placeholder `manual-import` e report di freshness. | Quando si lavora su `WUL-176`, `WUL-179` o sulla base documentale delle integrazioni regionali. |
| [docs/treatment-reasoning-athena-integration.md](./treatment-reasoning-athena-integration.md) | Mappa operativa per la lane `treatment_reasoning` ATHENA-style: ADR boundary, contratto, pannello review-only, ATHENA-R1 MLX locale, smoke live DB redatto, benchmark Q4/BF16 e crediti ATHENA. | Quando si valuta gestione trattamenti, ragionamento terapeutico su contesto paziente, runtime ATHENA locale o sidecar ATHENA/ToolUniverse senza promuovere prescrizione automatica. |
| [docs/mlx-operational-parity.md](./mlx-operational-parity.md) | Matrice operativa `WUL-165` che rende MLX benchmark-visible e diagnosticabile senza promuoverlo a runtime clinico. | Quando serve distinguere parity di visibilita/guardrail MLX da promozione runtime o dal boundary OCR primario Ollama/DeepSeek con fallback Apple Vision solo macOS. |
| [docs/ai-runtime-serving-matrix.md](./ai-runtime-serving-matrix.md) | Matrice canonica post-0.8 di task, modelli, runtime, stati e serving gate. | Quando si valuta un modello o provider e serve distinguere fitting, benchmark, shadow e serving. |
| [docs/MANUALE.md](./MANUALE.md) | Manuale utente medico. | Per supporto operativo lato clinico. |

## 🧑‍💻 Tracciabilità agent e metadoc

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/analysis/2026-07-17-baseline-performance.md](./analysis/2026-07-17-baseline-performance.md) | Baseline riproducibile delle route list principali su 200 e 2000 pazienti sintetici, con payload, tempi HTTP, costo di decifratura simulato e campioni grezzi JSON. | Quando si misura o confronta una modifica a query list, paginazione, allegati o decifratura client. |
| [docs/analysis/2026-07-27-parity-0.8-recovery-run.md](./analysis/2026-07-27-parity-0.8-recovery-run.md) | Run record CoS della recovery UI/parity 0.8, con ledger Claude, candidata locale, contratti, prove e blocker. | Quando si valuta il candidato locale 0.8 o si ricostruisce l'ownership del lavoro UI recente. |
| [docs/analysis/2026-07-28-provider-program-post-0.8-run.md](./analysis/2026-07-28-provider-program-post-0.8-run.md) | Run record CoS del programma provider intelligenti post-0.8, con stato reale, trust boundary, matrice superfici, auth, packet e gate. | Quando si pianificano provider AI, egress, credenziali o parity intelligente senza ampliare la release 0.8. |
| [docs/analysis/2026-07-26-openminis-intelligent-scaffold-audit.md](./analysis/2026-07-26-openminis-intelligent-scaffold-audit.md) | Audit clean-room dei pattern OpenMinis per lo scaffold intelligente, con confini di riuso e divieti di importazione. | Quando si progetta lo scaffold provider o si valuta il riuso di pattern esterni senza importarne autorità o egress. |
| [docs/analysis/2026-07-05-audit-esterno-v2-triage.md](./analysis/2026-07-05-audit-esterno-v2-triage.md) | Triage secondario dell'audit esterno V2, collegato a `WUL-470` e figlie `WUL-471`..`WUL-475`, con separazione tra obiezioni misframed e residui azionabili su PIN, FHIR, MDR, sync futuro e drift ADR. | Quando si rivedono le issue nate dall'audit esterno V2 o serve recuperare il razionale completo dietro il tracker Linear. |
| [docs/analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md](./analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md) | Closeout secondario di provider scaffold, control-flow, attese locali e roadmap dello stack intelligente, riallineato alla verita di `main`. | Quando si pianifica una nuova slice AI/euristica o si verifica cosa resta oltre le PR #39, #41, #42 e #43. |
| [docs/analysis/2026-07-17-installabilita-v0-scope.md](./analysis/2026-07-17-installabilita-v0-scope.md) | Scope e proof macOS per WUL-455: confronto bundle Node, Tauri sidecar ed Electron, raccomandazione v0, build riproducibile e limiti non provati. | Quando si pianifica l'installabilita o si verifica la proof macOS avviabile senza Node installato sulla macchina di esecuzione. |
| [docs/analysis/2026-07-26-apple-intelligence-dettatura-e-sintesi-on-device.md](./analysis/2026-07-26-apple-intelligence-dettatura-e-sintesi-on-device.md) | Mappa read-only delle API Apple on-device per dettatura e sintesi, senza decisione o funzione attivata. | Quando si valuta una futura capacità Apple Intelligence o il relativo confine privacy. |
| [docs/analysis/2026-07-26-handover-interfaccia-apple.md](./analysis/2026-07-26-handover-interfaccia-apple.md) | Handover storico della prima armonizzazione UI Apple universale, con rettifiche e prove disponibili. | Quando si ricostruisce la provenienza del lavoro UI Apple precedente alla candidata 0.8. |
| [docs/analysis/2026-07-27-parita-funzioni-quattro-superfici.md](./analysis/2026-07-27-parita-funzioni-quattro-superfici.md) | Inventario storico di 186 azioni e dei divari tra web, iPhone, iPad e macOS. | Quando si confronta la matrice canonica corrente con il rilevamento iniziale dei divari. |
| [docs/markdown-index.md](./markdown-index.md) | Indice completo markdown con sintesi. | Per navigazione completa e controllo copertura doc. |
| [docs/openapi/README.md](./openapi/README.md) | Runbook operativo per manutenzione della spec OpenAPI `/api/v1`. | Quando si cambia il contratto client-facing o si fa review di drift. |
| [docs/design/2026-07-26-agenda-clinica-e-scadenze.md](./design/2026-07-26-agenda-clinica-e-scadenze.md) | Intento di prodotto post-0.8 per un'agenda centrata su scadenze cliniche e terapeutiche. | Quando si pianifica l'evoluzione dell'agenda senza confonderla con lo stato consegnato. |
| [docs/design/2026-07-26-cosa-mutuare-analisi-esterna.md](./design/2026-07-26-cosa-mutuare-analisi-esterna.md) | Confronto critico con studi e prodotti esterni per ridurre attrito senza impoverire l'informazione clinica. | Quando si valutano scelte di gerarchia, carico cognitivo o consolidamento dei flussi. |
| [docs/design/vetro-clinico/README.md](./design/vetro-clinico/README.md) | Ingresso della baseline storica e transitoria Vetro Clinico: glossario, ordine di lettura, regole redazionali e precedenza. | Quando serve riconciliare una superficie transitoria senza usarla come destinazione attiva. |
| [docs/design/vetro-clinico/01-fondamenta.md](./design/vetro-clinico/01-fondamenta.md) | Principi, audit onesto della baseline Vetro Clinico e decisioni vincolanti di transizione. | Quando serve distinguere stato rilevato, debito e direzione di design separata. |
| [docs/design/vetro-clinico/02-token.md](./design/vetro-clinico/02-token.md) | Architettura token a tre livelli, palette semantica, tipografia, geometria, motion e azioni di consolidamento. | Quando si valuta una modifica a colore, corpo testo, raggio, ombra, blur o durata. |
| [docs/design/vetro-clinico/03-materiali.md](./design/vetro-clinico/03-materiali.md) | Baseline dei materiali: vetro strutturale, carta clinica, vetro transitorio, leggibilità e degrado controllato. | Quando si classifica una regione UI o un materiale. |
| [docs/design/vetro-clinico/04-interazione.md](./design/vetro-clinico/04-interazione.md) | Grammatica di feedback, motion, tastiera, form clinici e stati onesti. | Quando si rivede un comportamento interattivo. |
| [docs/design/vetro-clinico/05-responsivita.md](./design/vetro-clinico/05-responsivita.md) | Ruoli dei breakpoint, modello a due densità, touch, puntatore e finestre. | Quando si valuta un layout tra dimensioni o densità. |
| [docs/design/vetro-clinico/06-accessibilita.md](./design/vetro-clinico/06-accessibilita.md) | Contratto WCAG 2.2 AA e gap di accessibilità per piattaforma. | Quando si rivede accessibilità, traslucenza o motion. |
| [docs/design/vetro-clinico/07-piattaforme/web.md](./design/vetro-clinico/07-piattaforme/web.md) | Guida web della baseline Vetro Clinico: mappa superficie-materiale e budget visivo. | Quando si valuta UI in `app/` o `components/`. |
| [docs/design/vetro-clinico/07-piattaforme/apple.md](./design/vetro-clinico/07-piattaforme/apple.md) | Guida Apple transitoria: mappa HIG/Liquid Glass, limiti e gap nativi. | Quando si valuta UI nativa Apple o parity di design. |
| [docs/design/vetro-clinico/07-piattaforme/windows.md](./design/vetro-clinico/07-piattaforme/windows.md) | Guida Windows previsionale: mapping Fluent 2 e confine shell nativa/canvas web. | Quando si pianifica il client Windows. |
| [docs/design/vetro-clinico/07-piattaforme/linux.md](./design/vetro-clinico/07-piattaforme/linux.md) | Guida Linux previsionale: adattamento GNOME/libadwaita e degrado piatto. | Quando si pianifica il client Linux. |
| [docs/design/vetro-clinico/08-esplorazioni.md](./design/vetro-clinico/08-esplorazioni.md) | Quattro esplorazioni con ricetta, costo e verdetto. | Quando si consulta l'evoluzione storica della baseline. |
| [docs/design/vetro-clinico/09-roadmap.md](./design/vetro-clinico/09-roadmap.md) | Corsie DS della baseline Vetro Clinico, con gate e debito da consolidare. | Quando si consulta la sequenza storica di consolidamento. |
| [docs/design/lume/README.md](./design/lume/README.md) | Lume, lingua di design attiva adottata da ADR 0078: manifesto, token DTCG, canone e limiti della candidata locale v0.8. | Quando si implementa Lume o si verifica un claim di design della candidata. |
| [docs/design/lume/01-lingua.md](./design/lume/01-lingua.md) | Specifica Lume: modello focale (fuoco/penombra/buio operativo), materia e registri di luce, il filo, due voci tipografiche, profondità semantica, grammatica dell'attenzione, motion. | Quando si prototipa o implementa una superficie Lume. |
| [docs/design/lume/02-derivazione.md](./design/lume/02-derivazione.md) | La ricerca di mercato dietro Lume (tre lane GPT-5.6 con fonti: premium 2026, frontiera clinica, frontiera estetica), le opzioni scartate e la motivazione di ogni scelta. | Quando si mette in dubbio una scelta di Lume o si rifà la ricerca. |
| [docs/design/lume/03-migrazione.md](./design/lume/03-migrazione.md) | Percorso di migrazione da Vetro Clinico a Lume: mappa dei token, fasi L0-L6 con gate, rischi, cosa sopravvive. | Quando si pianifica o verifica l'adozione progressiva di Lume. |
| [docs/design/lume/04-perlustrazione.md](./design/lume/04-perlustrazione.md) | Perlustrazione EHR/provider dietro la grammatica dell'attenzione: tre lane GPT-5.6 (applicativi USA, gestionali GP, design system sanitari aperti), 12 integrazioni normative, rifiuti, spazio bianco competitivo. | Quando si raffina worklist, provenienza, sicurezza o si studia il mercato dei gestionali. |
| [docs/design/lume/05-app-native.md](./design/lume/05-app-native.md) | Lume nelle app native: mappa SwiftUI, grammatica compatta iPhone e note tri-OS prospettiche, con macOS come priorita operativa. | Quando si implementa Lume sui client Apple; non apre una lane Windows/Linux. |
| [docs/design/lume/06-macos-apple-contract.md](./design/lume/06-macos-apple-contract.md) | Contratto Lume per l'app macOS reale e la futura superficie nativa primaria: card clinica opaca consegnata, componenti interni e gate ancora parziali. | Prima di progettare o implementare una superficie Lume su macOS. |
| [docs/design/lume/07-gesto-e-movimento.md](./design/lume/07-gesto-e-movimento.md) | Grammatica Lume per gesto, movimento, focus, stato e continuità, con reduced motion per costruzione. | Quando si implementano o verificano animazioni, transizioni e feedback di interazione. |
| [docs/design/lume/08-matrice-viste.md](./design/lume/08-matrice-viste.md) | Matrice vista-per-vista, criteri golden e ordine di migrazione delle superfici Lume. | Quando si pianifica una slice Lume o si definiscono screenshot e contratti AX. |
| [docs/design/lume/09-icona.md](./design/lume/09-icona.md) | Specifica dell'icona MediFlow per macOS, iOS e web, con asset approvati e criteri di integrazione. | Quando si cablano o si verificano le icone dell'app e del web. |
| [docs/design/lume/10-superficie-e-materiale.md](./design/lume/10-superficie-e-materiale.md) | Proposta misurata per la convergenza tra superfici Lume e materiali Apple. | Quando si valuta materiale, contrasto o gerarchia delle superfici; non trattarla come canone adottato. |
| [docs/design/wul-271-kree8-visual-translation.md](./design/wul-271-kree8-visual-translation.md) | Traduzione visiva Kree8 → MediFlow per PIN gate, root entry live `/`, first real-patient cockpit slice e alias review `/mockups/kree8` (WUL-271/WUL-272/WUL-273/WUL-274). | Quando si rivede la nuova linea visuale Kree8, si verifica la root live con dati reali o si pianifica la migrazione delle superfici legacy. |

## 🧱 ADR (decisioni architetturali)

| File | Tema |
| --- | --- |
| [docs/adr/README.md](./adr/README.md) | Regole operative ADR (quando, come, stati). |
| [docs/adr/0000-template.md](./adr/0000-template.md) | Template standard ADR. |
| [docs/adr/0001-native-macos-client.md](./adr/0001-native-macos-client.md) | Prototipo client macOS su API locale versionata. |
| [docs/adr/0002-native-security-and-modules.md](./adr/0002-native-security-and-modules.md) | Sicurezza native (PIN/crypto) + moduli clinici minimi. |
| [docs/adr/0003-native-write-clinical-ai.md](./adr/0003-native-write-clinical-ai.md) | Write operation native via `/api/v1` + strumenti clinici. |
| [docs/adr/0004-exemptions-catalog.md](./adr/0004-exemptions-catalog.md) | Catalogo esenzioni locale e mapping su paziente. |
| [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md) | Parity web/native su contratto API condiviso. |
| [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md) | Plugin terminologie unificato + profili FSE/EDS. |
| [docs/adr/0007-strict-web-native-parity-gate.md](./adr/0007-strict-web-native-parity-gate.md) | Gate parity stretta (poi superseded). |
| [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md) | Modello operativo web-first + parity sweep. |
| [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md) | Strategia test macOS con XCTest/Xcode separata dal web runner. |
| [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md) | Strategia spec-first OpenAPI e governance/versioning del contratto `/api/v1`. |
| [docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md](./adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md) | Pipeline OCR-first con Qwen text-only e autofill prudente delle diagnosi ICD esplicite; la scelta del default modello e aggiornata da ADR 0013. |
| [docs/adr/0084-document-diagnoses-review-only.md](./adr/0084-document-diagnoses-review-only.md) | Sostituisce l'autofill delle diagnosi da documento con proposte review-only e un gate fail-closed sugli envelope ambigui. |
| [docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md) | Propone lo scaffold model-agnostic, il chiarimento fail-closed e l'automazione graduata; non aggiunge inbox conversazionale o runtime esterni alla 0.8. |
| [docs/adr/0087-registro-proposte-diagnostiche-documentali.md](./adr/0087-registro-proposte-diagnostiche-documentali.md) | Foundation persistente locale delle proposte, separata dalle diagnosi cliniche; backup/restore e purge la includono, mentre writer, route, UI, transizioni e applicazione restano assenti. |
| [docs/adr/0088-limite-digest-bound-readiness-ai-locale.md](./adr/0088-limite-digest-bound-readiness-ai-locale.md) | ADR accettato: annotazione distinta da `runtime`, bracket digest best-effort e qualified readiness bloccata. |
| [docs/adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md) | Contratto fabric: routing per capability, venue esplicite, profili egress versionati, policy immutabile e ricevute che non autorizzano consumer. |
| [docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md](./adr/0012-operator-reviewed-smart-import-from-patient-context.md) | Smart import reviewable da note, diario e documenti verso diagnosi ICD-11 e terapie nel profilo paziente. |
| [docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md](./adr/0013-qwen35-default-text-only-medgemma-specialist.md) | Aggiorna il default text-only a `qwen3.5:35b-a3b` e mantiene MedGemma come opzione specialistica non-default. |
| [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | Policy canonica lockout auth: `5` tentativi, finestra `15m`, blocco `15m`, codici `401/423` e messaggi coerenti web/macOS. |
| [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | Budget persistenti e configurabili per `AI Patient Insight`, limitati a settings web + context builder + generation runtime. |
| [docs/adr/0019-native-patient-insight-markdown-contract.md](./adr/0019-native-patient-insight-markdown-contract.md) | Il client macOS genera e salva `AI Patient Insight` in markdown con citazioni locali, compatibile col parser web attuale. |
| [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md) | Formalizza la gerarchia delle fonti cliniche e le regole di conflitto/fallback gia applicate dal builder corrente di `AI Patient Insight`. |
| [docs/adr/0021-terminology-registry-in-settings-json.md](./adr/0021-terminology-registry-in-settings-json.md) | Registry locale terminologie persistito in `settings` JSON, letto da `systems/search/resolve` e aggiornabile senza nuove tabelle o migrazioni. |
| [docs/adr/0022-nightly-backup-via-macos-launchd.md](./adr/0022-nightly-backup-via-macos-launchd.md) | Backup automatico notturno via `launchd` su macOS home-base, con runner headless locale e stato persistito in `settings`. |
| [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | Retention automatica dei backup scheduler-owned con policy `keep-last-N`, preview dry-run e cleanup tracciato in `settings`. |
| [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | Fissa la sequenza di stabilizzazione web/core prima del prossimo version bump, con helper condivisi, `typecheck` canonico e split incrementale dei god files. |
| [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | Introduce il foundation layer locale SISS con azioni tipizzate, error taxonomy stabile, retry sui transienti e metadata audit PHI-safe. |
| [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | Fissa il boundary ufficiale del filone `WUL-180`: oltre il `portal-handoff`, la vera integrazione nativa SISS/FSE richiede scenari approvati e un percorso coerente con `SSI` qualificata/provisioning ARIA. |
| [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | Fissa la decisione `WUL-181`: il primo step credibile sul prescrittivo regionale oltre l'handoff e `webapp-assisted`, non la riscrittura della UI prescrittiva dentro MediFlow. |
| [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | Decisione storica `WUL-196`: Graphite come shell unica; superata per la root entry da ADR 0060, ma conserva il principio no-selector. |
| [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md) | Fissa `WUL-272`: la root web `/` mostra il cockpit Kree8 direttamente da `Start_MediFlow.command`, mantenendo sicurezza runtime e nessun selector visuale. |
| [docs/adr/0061-clinical-agenda-bridge-zimbra-icloud.md](./adr/0061-clinical-agenda-bridge-zimbra-icloud.md) | Fissa `WUL-275`: lettura locale read-only delle cache evento Zimbra/iCloud come candidati clinici/FBF reviewable nella cockpit Kree8, senza import cieco o scritture cliniche. |
| [docs/adr/0062-service-prescriptions-domain.md](./adr/0062-service-prescriptions-domain.md) | Fissa `WUL-277`: prescrizioni di visite, esami, imaging, riabilitazione e screening in dominio dedicato, distinto da terapia farmacologica e protesica. |
| [docs/adr/0064-service-prescription-itemization-and-catalog-matching.md](./adr/0064-service-prescription-itemization-and-catalog-matching.md) | Fissa `WUL-278`: contenitore prescrizione + item figli codificabili per esami/prestazioni e scaffold repertorio locale matchabile. |
| [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | Fissa `WUL-279`: intended purpose, claim consentiti/esclusi e guard repo-local `check:claims` contro overclaim clinico/regolatorio. |
| [docs/adr/0066-patient-soft-delete-lifecycle.md](./adr/0066-patient-soft-delete-lifecycle.md) | Fissa `WUL-306`: DELETE paziente come tombstone soft-delete version-guarded, cascade canonica `PATIENT_CHILD_TABLES` con guardia anti-drift, purge admin audited (`patient.purged`) e clear test-container per membership (WUL-322). |
| [docs/adr/0068-cross-platform-runtime-windows-linux.md](./adr/0068-cross-platform-runtime-windows-linux.md) | Fissa `WUL-375`: runtime cross-platform Windows/Linux con adapter scheduler backup, gating MLX/PM2 a macOS, launcher sottili per OS e contratto unico Node 24/ABI nativa per installazione, build e avvio. |
| [docs/adr/0070-in-house-first-for-buildable-logic.md](./adr/0070-in-house-first-for-buildable-logic.md) | Fissa l'approccio in-house-first per logica integrabile, dati ICD e moduli locali senza dipendenze opzionali obbligatorie. |
| [docs/adr/0071-tri-os-reversed-flow-shared-core.md](./adr/0071-tri-os-reversed-flow-shared-core.md) | Definisce la direzione tri-OS a flusso invertito e i gate per un core nativo condiviso; non descrive la runtime 0.8 corrente. |
| [docs/adr/0072-voice-visit-capture-fluid-boundary.md](./adr/0072-voice-visit-capture-fluid-boundary.md) | Propone `WUL-419`: boundary local-first per visite registrabili Fluid-style, transcript/draft PHI, provider esterni solo tramite opt-in e no runtime audio nella prima slice. |
| [docs/adr/0073-treatment-reasoning-athena-boundary.md](./adr/0073-treatment-reasoning-athena-boundary.md) | Fissa la boundary `mediflow.treatment_reasoning.v1`: runtime locale ATHENA/MLX review-only con kill switch fail-closed, report/trace ATHENA-style e suggested actions solo review/form-prefill senza auto-write clinici. |
| [docs/adr/0074-network-cross-patient-read-boundary.md](./adr/0074-network-cross-patient-read-boundary.md) | Fissa le letture network cross-paziente: scope obbligatorio per membership, capability dedicate, filtri plaintext, ciphertext opaco e limit con cap. |
| [docs/adr/0075-paired-account-operations-and-pin-rotation.md](./adr/0075-paired-account-operations-and-pin-rotation.md) | Fissa le operazioni account paired sulla famiglia auth condivisa, la rotazione PIN client-of-origin con KDF v2 e le esclusioni di reset e re-wrap lazy nativo. |
| [docs/adr/0076-paired-document-domain-write-policy.md](./adr/0076-paired-document-domain-write-policy.md) | Classifica le scritture del dominio documentale paired in cinque classi: contenuto manuale e compute deterministici consentiti, artefatti document-derived e invocazione AI esclusi, stato kill switch leggibile. |
| [docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md) | Accetta il boundary provider/egress: adapter Ollama e gate fail-closed consegnati, registry e provider alternativi pendenti. |
| [docs/adr/0078-lume-lingua-di-design-di-destinazione.md](./adr/0078-lume-lingua-di-design-di-destinazione.md) | Decisione `Accepted`: adotta Lume come lingua di destinazione multipiattaforma, con Vetro Clinico transitorio e migrazione L0-L6 ancora parziale. |
| [docs/adr/0079-local-open-loops-and-result-link.md](./adr/0079-local-open-loops-and-result-link.md) | Accetta le attese locali deterministiche: prima slice web consegnata, salvataggio esplicito e nessuna estensione paired. |
| [docs/adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md](./adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md) | Propone di serializzare le schema guard SQLite al bootstrap per rendere deterministici build e avvii multiprocesso. |
| [docs/adr/0081-fhir-r4-export-v0-contract.md](./adr/0081-fhir-r4-export-v0-contract.md) | Decisione `Accepted`: fissa copertura, parità web/native, validazione locale e nessun claim FSE per l'export FHIR R4 v0. |
| [docs/adr/0082-persistent-expectations-register-v0.md](./adr/0082-persistent-expectations-register-v0.md) | Decisione `Accepted`: definisce un registro persistente host-only delle attese con provenienza univoca, matching fail-closed e conferma esplicita della chiusura. |
| [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | Fissa `WUL-199`: i preview profiles funzionali vengono ritirati da `main`, con AI e Smart Import gia live e il contesto paziente SISS promosso a parte stabile della scheda paziente. |
| [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | Formalizza `WUL-188`: family Apple ricostruita con core Swift condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come `home-base` autorevole e mobile paired senza accesso diretto a SQLite. |
| [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | Formalizza `WUL-176`: corpus documentale locale SISS/FSE con manifest versionato, fetch/sync fuori Git e futuro MCP ammesso solo sopra un corpus approvato. |
| [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | Definisce la rotazione zero-knowledge del PIN tramite re-wrap client-side della master key, senza ricifrare i dati clinici. |
| [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md) | Formalizza `WUL-117`: `local-only` resta il default, `network home-base` diventa una modalita esplicita su LAN fidata con nodo paired autorevole e thin slice iniziale read-only prima di replica, sync e identity model. |
| [docs/adr/0035-network-replica-thin-slice-snapshot-mirror.md](./adr/0035-network-replica-thin-slice-snapshot-mirror.md) | Formalizza `WUL-120`: la replica iniziale `network home-base` resta uno snapshot mirror governato con fallback locale, stato deferred e manual review prima di qualsiasi sync record-level. |
| [docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md) | Formalizza `WUL-122`: pairing device e credenziali operatore restano separati, il nodo dichiara il login minimo richiesto e lo scope clinico `network` viene risolto in modo esplicito come contesto sessione o default ambulatoriale del nodo. |
| [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md) | Formalizza `WUL-150`: bootstrap pairing PHI-safe senza token locale, conferma esplicita sul nodo, credenziale dedicata del device paired e primo data plane read-only che richiede paired client + sessione operatore. |
| [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | Formalizza il create-flow `Nuova Anagrafica` da documento con review esplicita, matching locale ICD/AIFA e persistenza strutturata solo delle terapie sufficientemente confermate. |
| [docs/adr/0051-patient-import-decision-contract-between-review-and-persistence.md](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md) | Formalizza la thin slice `WUL-167`: contratto `patient import decision` tra review documentale e persistenza prudente, con target `create/merge/review` e distinzione esplicita tra write strutturate e note-only. |
| [docs/adr/0052-network-patient-profile-write-boundary.md](./adr/0052-network-patient-profile-write-boundary.md) | Formalizza la prima slice write paired: `PUT /api/v1/network/patients/{id}` con paired client, sessione operatore, scope ambulatoriale e `version`, lasciando fuori delete remoto, child CRUD, sync e campi AI/documentali. |
| [docs/adr/0053-network-diary-entry-write-boundary.md](./adr/0053-network-diary-entry-write-boundary.md) | Formalizza la slice write paired del diario: read/create/update/soft-delete su `/api/v1/network/patients/{id}/entries*` con `entries.version`, capability dedicate, audit PHI-safe e hard delete/attachment/AI fuori scope. |
| [docs/adr/0054-network-therapy-write-boundary.md](./adr/0054-network-therapy-write-boundary.md) | Formalizza la slice write paired delle terapie: read/create/update/soft-delete su `/api/v1/network/patients/{id}/therapies*` con `therapies.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0055-network-checkup-write-boundary.md](./adr/0055-network-checkup-write-boundary.md) | Formalizza la slice write paired dei checkup: read/create/update/soft-delete su `/api/v1/network/patients/{id}/checkups*` con `checkups.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0056-network-observation-write-boundary.md](./adr/0056-network-observation-write-boundary.md) | Formalizza la slice write paired delle osservazioni: read/create/update/soft-delete su `/api/v1/network/patients/{id}/observations*` con `observations.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0057-local-evidence-absorption-layer.md](./adr/0057-local-evidence-absorption-layer.md) | Proposed ADR `WUL-213`: local evidence absorption layer per rendere allegati e diario fonti citabili/retrieval sopra un contract versionato, senza training, cloud runtime o auto-write clinici. |
| [docs/adr/0058-manual-evidence-reabsorb-affordance.md](./adr/0058-manual-evidence-reabsorb-affordance.md) | Proposed ADR `WUL-220`: futura affordance manuale e auditabile per riassorbire una fonte evidence invalidated/superseded, con stati espliciti, motivi PHI-safe e nessuna scrittura clinica strutturata. |
| [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md) | Formalizza il fallback OCR Apple Vision solo macOS: DeepSeek/Ollama resta OCR primario locale, Windows/Linux non hanno fallback platform-specific equivalente dichiarato, Smart Import resta reviewable. |

## ✅ Checklist manutenzione indice

1. Verifica inventario file: `rg --files -g '*.md' | sort`.
2. Assicurati che ogni file appaia in questo indice con una descrizione.
3. Aggiorna data "Ultimo aggiornamento".
4. Se cambiano priorità o fonti autorevoli, aggiorna anche [docs/README.md](./README.md).
