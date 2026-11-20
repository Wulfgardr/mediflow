---
summary: "Complete tracked Markdown index for MediFlow with quick purpose and consultation hints."
read_when:
  - "Finding where a MediFlow topic is documented."
  - "Adding, removing, or renaming Markdown files in the repo."
---

# Indice Completo Markdown (Repo)

La repository contiene presentazione, contratti, guide operative, studi e
verbali di prova. Questo inventario permette di trovare un tema senza dare
lo stesso peso a documenti che hanno funzioni diverse. I file speciali che
GitHub mette in evidenza (`README`, `CONTRIBUTING`, `SECURITY`, ecc.) sono
soltanto alcuni degli ingressi; qui sono censiti i `.md` tracciati, con una
breve indicazione d’uso.

La mappa precedente era aggiornata al 2026-09-08. Revisione editoriale:
2026-10-17; aggiunta ADR 0160: 2026-10-22; contratto 0.9.1 e proposta CU: 2026-10-23.
I verbali di luglio e le proposte
superate rimossi dall’albero
restano consultabili nell’[indice del tag v0.9.0](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/docs/markdown-index.md).
Le voci storiche conservano date, conteggi, revisioni e limiti:
la data di questo indice non rinnova le prove cui rimandano.

## Preparazione indipendente delle future 0.9.x

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [ADR 0196](./adr/0196-document-child-platform-boundary.md) | Controlli dei processi che elaborano i documenti nel runtime Web. | Per verificare estrazione del testo e lettura dei PDF su ciascuna piattaforma. |
| [Contratto 0.9.1](./releases/0.9.1-contract.md) | U0 approvato il 23 ottobre 2026: unità chiuse, target M5 Max/48 GB dal 9 novembre, tranche intelligente e GO/NO-GO. | Per accettare W/G/C/P/I/Q e seguire le decisioni ancora aperte; non attesta rilascio o ammissione clinica. |
| [Analisi CU](./analysis/2026-10-23-computer-use-procedures.md) | Delta, alternative privacy, dipendenze e unità del filone computer use locale. | Per valutare la proposta aggiunta in coda alla 0.9.1 e le sole decisioni sostanziali. |
| [Contratti CU](./analysis/2026-10-23-computer-use-procedure-contracts.md) | Specialistica, farmaceutica, protesica, esenzioni e introduttivo INPS. | Per implementare simulatori e adapter senza dedurre atti o campi non autorizzati. |
| [Fonti CU](./analysis/2026-10-23-computer-use-sources.md) | Fonti privacy, client e procedure, con data/versione/stato e limiti. | Per distinguere normativa, consultazioni, conoscenza procedurale e prove runtime. |
| [ADR 0162](./adr/0162-local-computer-use-executor.md) | Proposed: esecutore locale, capability, uscite, intervento medico e riconciliazione. | Prima di sviluppare CU; non attesta un runtime o una qualifica istituzionale. |
| [ADR 0166](./adr/0166-athena-method-runner-boundary.md) | Proposed: builder ATHENA puro, runner separato e gate per future venue. | Prima di riusare il metodo tramite Fabric; nessuna nuova venue remota abilitata. |
| [Censimento GPUI G-0](./analysis/2026-10-23-gpui-census.md) | Matrice di 66 funzioni, 36 route Web, 17 route Impostazioni e crosswalk CSV delle 205 righe della specifica; 40 unità PR proposte sotto G-1–9. | Per assegnare residui e prove, verificare writer e porte host, distinguere sorgente e pilota installato e chiudere i gate immediati. |

## Ingresso progressivo e candidatura

Il primo percorso spiega il lavoro senza AI e le ragioni delle scelte.
Le candidature e gli studi visuali servono dopo, quando occorra valutare una
versione o risalire alla provenienza di un’interfaccia.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [experiments/gpui-patient-pilot/evidence/connected-review.md](https://github.com/Wulfgardr/mediflow/blob/ec4be829929f5c26e39a45676a9faf603931095e/experiments/gpui-patient-pilot/evidence/connected-review.md) | Review del trasporto, UI e delta host; regressioni, TLS e provenienza dell'issuer. | Per riesaminare protezioni, test osservati e limiti residui della connessione nativa. |
| [experiments/gpui-patient-pilot/evidence/connected/release-v0.9.0-ui/README.md](https://github.com/Wulfgardr/mediflow/blob/ec4be829929f5c26e39a45676a9faf603931095e/experiments/gpui-patient-pilot/evidence/connected/release-v0.9.0-ui/README.md) | Schermate originali release, origine CI e equivalenza del tree Git. | Per confrontare geometrie e famiglia visuale senza attribuire al vecchio run prove della nuova UI. |
| [adr/0145-rust-gpui-connected-client.md](./adr/0145-rust-gpui-connected-client.md) | Client Rust/GPUI paired v3, roster desktop, contratto visivo e confronto old/new. | Per riesaminare l'integrazione e distinguere shell, writer e qualifica mobile. |
| [adr/0146-patient-profile-query-application-boundary.md](./adr/0146-patient-profile-query-application-boundary.md) | BT-01/S1: ammissione host, vista profilo scoped, handle revocabili e budget condiviso di 32 KiB. | Per verificare autorità Web/token locale/paired/FSE, grant headless esplicito, assenza di effetti della query e rollback. |
| [adr/0147-canonical-patient-profile-update-dispatch.md](./adr/0147-canonical-patient-profile-update-dispatch.md) | BT-04: comando profilo host, dispatch unico legacy-node e deduplicazione volatile per esecuzione. | Per verificare il confine di aggiornamento, le precedenze HTTP e i limiti rispetto a idempotenza durevole, prova umana e writer Rust. |
| [adr/0148-profile-notes-review-dry-run.md](./adr/0148-profile-notes-review-dry-run.md) | WUL-584: revisione umana delle note dal comando ENC, owner correnti, PIN fresco e consumo monouso senza writer. | Per verificare la composizione reale e i confini della prova Web di sviluppo rispetto alla futura operazione clinica. |
| [adr/0149-reviewed-profile-notes-commit.md](./adr/0149-reviewed-profile-notes-commit.md) | WUL-577/585: salvataggio riveduto delle sole note nel writer esistente, con CAS, audit e ricevuta atomici. | Per verificare il permesso aggiuntivo, il recupero dopo riavvio e i confini delle superfici ammesse. |
| [adr/0150-patient-profile-pilot-recovery.md](./adr/0150-patient-profile-pilot-recovery.md) | WUL-579/BT-06: backup C15 prima/dopo il pilota e identità durevole della ricevuta separata dalla generazione corrente. | Per verificare ripristino fedele, diniego delle vecchie autorità e continuità del percorso ordinario. |
| [adr/0151-profile-contract-package-topology.md](./adr/0151-profile-contract-package-topology.md) | BT-07: contratti del profilo in un pacchetto puro, owner Node e ruolo distinto dei client Swift/Rust. | Per verificare conformità, dipendenze e ritorno in-process senza trasformare dati. |
| [adr/0152-profile-contract-platform-boundary.md](./adr/0152-profile-contract-platform-boundary.md) | BT-08: grafo dei contratti privo di dipendenze OS/framework, route delegate e typecheck senza DOM. | Per distinguere portabilità dei contratti dalla qualifica delle applicazioni installate. |
| [adr/0153-paired-scale-preparation-and-diary-currentness.md](./adr/0153-paired-scale-preparation-and-diary-currentness.md) | WUL-771: catalogo/preparazione Scale in TypeScript e guard corrente del diario paired. | Per verificare capacità, selezione, bozza keyless e delega al writer esistente. |
| [adr/0154-population-demographics-read-boundary.md](./adr/0154-population-demographics-read-boundary.md) | WUL-771: proposta di lettura demografica della popolazione paired con TS canonico e calendario client esplicito. | Prima di collegare Analisi GPUI, per riesaminare ammissione, membership, cifratura e adattatore date-fns. |
| [adr/0155-account-profile-read-and-conditional-update.md](./adr/0155-account-profile-read-and-conditional-update.md) | WUL-771: lettura del profilo dell'account e PUT condizionale con versione derivata dal contenuto. | Prima di collegare il profilo nel client GPUI o modificare i consumer Web/Apple e la compatibilità della PUT condizionale. |
| [adr/0157-hl7-conformance-at-clinical-boundaries.md](./adr/0157-hl7-conformance-at-clinical-boundaries.md) | WUL-784: conformità HL7 ai confini clinici, profili e artefatti versionati. | Prima di implementare validazione HL7 o dichiarare conformità e accettazione FSE. |
| [adr/0158-territorial-packs.md](./adr/0158-territorial-packs.md) | WUL-785: nucleo internazionale e pacchetti territoriali governati dall’host. | Prima di separare capacità Italia/Lombardia o modificare migrazione e conservazione dello storico. |
| [adr/0160-mediflow-in-desktop-chat.md](./adr/0160-mediflow-in-desktop-chat.md) | WUL-788: secondo round Proposed; canali per host, importazione, Fabric, viste, budget e pubblicazione. | Prima di implementare broker, accesso, scritture o distribuzione; non attesta ammissione clinica. |
| [start-here.md](./start-here.md) | Esigenza ambulatoriale, uso senza AI e tre livelli di approfondimento. | Primo accesso al progetto. |
| [clinical-write-roster.md](./clinical-write-roster.md) | Operazioni cliniche per superficie, garanzie e residui C05. | Prima di modificare una scrittura, il suo parser o la sua prova. |
| [data-at-rest-matrix.md](./data-at-rest-matrix.md) | Matrice versionata di ciò che resta in chiaro o cifrato a riposo, custodia delle chiavi ed esposizioni aperte C06. | Prima di cambiare schema, contratto dei campi cifrati, backup, export o un testo sulla protezione dei dati. |
| [backup-restore-drill.md](./backup-restore-drill.md) | Istruzioni per eseguire la prova sintetica di ripristino e leggerne l'esito. | Prima di affidarsi a un backup, o dopo aver cambiato backup e ripristino. |

## 📚 Come usare questo indice

Per stabilire quale documento prevalga, consultare [docs/README.md](./README.md).
Per trovare il tema, usare le tabelle: «Scopo» descrive il documento e «Quando
consultarlo» la decisione che aiuta a prendere. Un contratto accettato, una
candidatura e una prova storica non sono tre modi per dire «funzione pronta».
Quando si aggiunge, rimuove o rinomina un `.md`, questo inventario e
[docs/README.md](./README.md) vanno aggiornati insieme.

## Audit di sicurezza pubblici

I rapporti seguenti sono evidenze sanitizzate legate a revisioni esatte.
`SECURITY.md` resta la policy canonica; un `FIX_VERIFIED` non implica merge,
distribuzione o sicurezza generale.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |

## Consegna 0.8.6

La 0.8.6 è stata pubblicata come sorgente il 20 settembre 2026 per runtime
locale/headless sul Mac e browser localhost. La pubblicazione non comprende
installer nativi firmati o notarizzati, non qualifica app complete per altri
sistemi e non chiude l’ammissione al deployment clinico WUL-688. Il quadro
corrente è nello [Stato del sistema](./STATE_OF_THE_SYSTEM.md); le voci qui
raccolte consentono di ricostruire come si sia arrivati alla consegna.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [ADR 0123](./adr/0123-official-web-ui-navigation-compositions.md) | UI web ufficiale B/A con confronto sintetico separato. | Per promuovere il design scelto senza flag di anteprima nel prodotto. |
| [ADR 0124](./adr/0124-bounded-native-network-json.md) | Limiti byte per JSON native/network e risposta 413. | Per valutare budget, compatibilità e confini del lettore. |
| [ADR 0144](./adr/0144-archive-generation.md) | Decisione C15: una generazione dell'archivio che cambia a ogni ripristino o scambio di file, lega sessioni e grant e viene confrontata dentro ogni scrittura clinica. | Prima di collegare il lifecycle Web a ripristino e repair, o di cambiare che cosa resta valido dopo un ripristino. |
| [ADR 0143](./adr/0143-strong-unlock-credential.md) | Decisione C07: passphrase, verificatore senza segreto, chiave solo in memoria, PIN di conferma, kit di recupero e migrazione dai PIN, con misure e ordine di consegna. | Prima di cambiare sblocco, derivazione, involucro della master key o recupero. |
| [ADR 0186](./adr/0186-punto-inchiostro.md) | Evoluzione di Lume: Punto d'inchiostro, caratteri locali, piano unico, inchiostri e confini funzionali. | Modificando le superfici e i token condivisi. |
| [ADR 0142](./adr/0142-sqlite-maintenance-admission.md) | Ammissione SQLite condivisa e drain del writer scheduler prima della manutenzione. | Per verificare lease/intento, rifiuti sicuri e residuo HOLD del lifecycle Web; non qualifica il repair online. |
| [ADR 0126](./adr/0126-chatgpt-account-control-plane.md) | Controllo account ChatGPT isolato, senza inferenza. | Contratti API, sessione, cleanup e limiti WUL-689. |
| [ADR 0134](./adr/0134-chatgpt-subscription-synthesis-execution.md) | Contratto di esecuzione ChatGPT confinata, distinto dall’account, con successive decisioni candidate per le quattro funzioni ordinarie. | Confine OS, fonti, lifecycle e gate sintetico separati dall'account. |
| [ADR 0128](./adr/0128-local-desktop-ocr.md) | OCR locale desktop Tesseract WASM e renderer per piattaforma. | Per prerequisiti, digest e limiti della candidatura Windows/Linux. |
| [ADR 0125](./adr/0125-explicit-aifa-catalog-download.md) | Proposta di aggiornamento esplicito dalla fonte ufficiale AIFA. | Per implementare download limitato, conflitti e sostituzione atomica. |
| [ADR 0127](./adr/0127-atomic-local-exemption-import.md) | Import esenzioni locale con anteprima, subset esplicito, CAS e commit atomico. | Per implementare o verificare WUL-690. |
| [ADR 0133](./adr/0133-local-prosthetics-catalog-import.md) | Contratto candidato WUL-693: CSV protesica, import atomico, provenienza e backup. | Per importare un repertorio locale dichiarato. |
| [Matrice regolatoria 0.8.6](./analysis/2026-09-06-086-regulatory-evidence.md) | Fonti correnti, applicabilità condizionale, controlli e gap. | Revisione competente GDPR/AI Act; non certificazione. |
| [ADR 0120](./adr/0120-local-work-profile-onboarding.md) | Raccomandazione locale e cambio reversibile del profilo. | Per onboarding, persistenza e rollback. |
| [ADR 0121](./adr/0121-function-status-projection.md) | Lettura autenticata dello stato delle funzioni. | Per modificare prerequisiti, errori e stati osservati. |
| [ADR 0136](./adr/0136-explicit-web-local-provider-onboarding.md) | Verifica e attivazione Ollama con consenso Web esplicito e owner canonico. | Per onboarding locale, CAS, revoca e recupero. |
| [ADR 0122](./adr/0122-local-provider-host-setup.md) | Ammissione esplicita Ollama nel processo host. | Per la CLI host; ADR 0136 governa il comando Web dedicato. |
| [ADR 0129](./adr/0129-function-model-catalog-preferences.md) | Preferenze per esperienza e override da catalogo host sigillato. | Per CAS, preset e dispatch senza ammissione UI. |
| [ADR 0130](./adr/0130-node-test-data-dir-preflight.md) | Data-dir esplicito per i test Node. | Per preflight, subprocess e cleanup delle fixture. |
| [ADR 0138](./adr/0138-explicit-data-directory-bootstrap.md) | Nessuna adozione legacy implicita nella cartella dati scelta. | Per bootstrap, isolamento dei nuovi archivi e primo avvio nativo. |

## OCR locale 0.8.6

Il percorso parte dall’estrazione deterministica; il riconoscimento delle
pagine che lo richiedano è un passaggio distinto. Le prove del singolo target
non autorizzano a dichiarare un OCR disponibile su ogni piattaforma.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/adr/0119-anydoc-apple-vision-current-source.md](./adr/0119-anydoc-apple-vision-current-source.md) | Precedenza AnyDoc e Apple Vision, matrice e preview OCR. | Per il percorso documentale; prevale sulle formulazioni incompatibili di ADR 0107/0111/0117. |

## ⚙️ Orchestrazione e governance (consultazione sempre)

Questi documenti definiscono scopo, responsabilità e regole del contributo.
La documentazione di prodotto spiega perché il sistema abbia questa forma;
le regole operative stabiliscono come intervenirvi senza oltrepassarne i
limiti.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [README.md](../README.md) | Onboarding generale progetto e punti di accesso documentazione. | Sempre, in fase di avvio. |
| [PRODUCT.md](../PRODUCT.md) | Contratto prodotto: purpose, audience, task, ruoli piattaforma, confini, anti-goal e direzione post-0.8. | Per decisioni prodotto, release narrative e separazione tra stato corrente e aspirazione. |
| [DESIGN.md](../DESIGN.md) | Contratto design multipiattaforma: Lume, gerarchia, stati, adattamenti nativi/web, accessibilità ed eccezioni. | Prima di progettare o verificare una superficie utente. |
| [docs/README.md](./README.md) | Mappa canonica della documentazione (fonte autorevole per tema). | Sempre, per decidere precedenze. |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Lettura completa del sistema; per il percorso AnyDoc e il fallback PDF Apple Vision consultare ADR 0119. | Sempre, quando serve una vista unica del sistema, verificando le decisioni successive per i confini aggiornati. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Visione architetturale stabile, confini e non-obiettivi. | Sempre, per cambi tecnici non banali. |
| [SECURITY.md](../SECURITY.md) | Regole di sicurezza, minacce considerate, oscuramento dei dati identificativi e registrazione degli eventi. | Sempre, per qualunque cambio dati/API. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow contributivo e Definition of Done. | Sempre, prima di chiudere un task. |
| [Modello di PR](../.github/pull_request_template.md) | Problema, modifica, prove, non verificato, fonti esterne, modello e strumento. | Ogni volta che si apre una PR. |
| [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | Intended purpose e guard `check:claims` contro overclaim su AI, SISS/FSE, cloud, diagnosi, triage, prescrizione e automazione. | Quando si tocca copy prodotto, UI/help, README, materiale pubblico o confini AI/SISS/FSE. |
| [CHANGELOG.md](../CHANGELOG.md) | Storico release e cambiamenti rilevanti. | Al bisogno, per contesto versioni. |
| [CREDITS.md](../CREDITS.md) | Attribuzioni per ispirazioni, modelli, librerie e runtime usati dal progetto. | Quando si verifica provenienza, licenze o uso corretto di contributi esterni. |
| [Sviluppo assistito e consumi](./development-usage.md) | Chi fa che cosa nello sviluppo assistito, principi dell'autore, attribuzione, storico token e limiti delle fonti. | Per leggere o riprodurre grafici, aggregati e conteggi per provider, modello ed effort. |

## 🧱 Architettura, flussi e parity

Per capire il sistema, partire dai flussi e dalle responsabilità. Le matrici
di parità misurano poi quanto ciascuna superficie copra quei compiti: non
sono certificati di equivalenza delle app o ricevute di distribuzione.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Quadro corrente della release sorgente, contenuto implementativo e ricostruzione storica con date, SHA e limiti distinti. | Per distinguere disponibilità, intenzione progettuale e prove, prima di pianificare o dichiarare una capacità. |
| [docs/repository-topology.md](./repository-topology.md) | Fonte canonica per repository operativa, confine Git/fuori-Git e aree top-level: runtime clinico, publication/site e tooling. | Quando devi scegliere repository, branch o collocazione di codice, asset e artefatti locali. |
| [Deposito della visita da un client agente](./agent-visit.md) | Abbinamento, deposito cifrato e ripresa dell’invio secondo ADR 0190. | Per usare la CLI o il trasporto MCP con il dossier preparato. |
| [docs/parity-matrix.md](./parity-matrix.md) | Matrice localhost/Apple con 66 capability e conteggi 30/13/23; il gate P6 residuo è in `WUL-481` e le prove conservano la propria revisione. | Per steering parity, click-map P6 e release readiness Apple. |
| [docs/known-limitations.md](./known-limitations.md) | Limiti noti della candidata sorgente 0.8, inclusi VoiceOver mobile, tooling di sviluppo e claim non autorizzati. | Per release readiness, note pubbliche, security posture e claim di accessibilità. |

## 🍎 Native, setup e testing

Le guide native riguardano sorgenti, toolchain, trasporto e verifiche della
famiglia Apple. Il core condiviso e un test superato non implicano un’app
completa pubblicata su ogni sistema; il nativo resta un seguito separato
dalla release sorgente 0.8.6.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [native/README.md](../native/README.md) | Layout, toolchain e comandi della universal app Apple e del package Swift condiviso. | Per build, test e orientamento nel subtree `native/`. |
| [native/contracts/README.md](../native/contracts/README.md) | Oracoli byte-exact del core cross-platform, inclusi i vettori crittografici congelati. | Quando si modifica crittografia, portabilità del core o test golden. |
| [native/MediFlowMac/Sources/MediFlowSQLiteC/README.md](../native/MediFlowMac/Sources/MediFlowSQLiteC/README.md) | Provenienza e regole di aggiornamento della SQLite amalgamation inclusa nel package nativo. | Quando si aggiorna SQLite vendorizzata o la build C multipiattaforma. |
| [docs/native-setup.md](./native-setup.md) | Setup automatico ambiente client nativo. | Prima di avviare sviluppo/test native. |
| [docs/native-testing.md](./native-testing.md) | Strategia canonica test macOS (SwiftPM/XCTest/Xcode). | Per piani test e parity sweep. |
| [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | Runbook P6 del bundle macOS home-base: tooling di base consegnato da `WUL-401`/PR #21, prerequisiti operativi e verbale residui governati da `WUL-481`. | Per promuovere capability macOS da partial a full parity senza usare dati reali. |
| [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | Runbook del verify loop `home-base`: gate headless sintetici sul boundary di rete e smoke iPhone/iPad opzionale contro database reale. | Per modifiche a `/api/v1/network/*` o verifiche mobili `home-base` paired su simulatori Apple. |
| [docs/icd-who-setup.md](./icd-who-setup.md) | Candidato WHO locale: configurazione server, stato e provisioning manuale con manifesto bloccato. | Prerequisiti e limiti prima di attivare Search; nessun installer o prova sul target. |

## 🩺 Prodotto, compliance e contesto clinico

Roadmap, uso previsto e requisiti descrivono piani diversi. In particolare,
uno studio SISS/FSE può chiarire un percorso ufficiale senza dimostrare che
MediFlow sia già qualificata a usarlo. Le decisioni applicabili restano nei
contratti e nella valutazione competente del deployment.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/COMPLIANCE.md](./COMPLIANCE.md) | Quadro compliance GDPR/FHIR e interoperabilità. | Per requisiti normativi e policy operative. |
| [docs/MANUALE.md](./MANUALE.md) | Manuale utente medico. | Per supporto operativo lato clinico. |

## 🧑‍💻 Evidenze tecniche e documentazione

I verbali permettono di risalire a sorgenti, decisioni e prove di un lavoro.
Vanno letti con la loro data e con gli eventuali addenda: un esito positivo
non si trasferisce a una revisione successiva e una proposta non diventa
implementata perché è stata recuperata nell’inventario.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/capability-mapping/mediflow-0.8.5-crosswalk.md](./capability-mapping/mediflow-0.8.5-crosswalk.md) | Vista derivata del mapping WUL-522, con provenance congelata, copertura, conflitti residui e claim ceiling candidate-only. | Quando si verifica il mapping 0.8.5 senza trasformare inventari o gap in parity. |
| [docs/ui-cli.md](./ui-cli.md) | Collaudo sintetico guidato da terminale. | Per riprodurre un percorso Web o GPUI. |
| [docs/markdown-index.md](./markdown-index.md) | Indice completo markdown con sintesi. | Per navigazione completa e controllo copertura doc. |
| [docs/design/punto-inchiostro/02-addendum-composizione.md](./design/punto-inchiostro/02-addendum-composizione.md) | Regole compositive D1–D16, stati di form, vuoto, proposta e overflow, sequenza delle unità Web. | Per applicare l'addendum alla specifica Punto d'inchiostro senza cambiare flussi clinici o capacità dei servizi. |

## 🧱 ADR (decisioni architetturali)

Le ADR conservano decisioni, alternative, limiti e successive modifiche.
Le descrizioni seguenti identificano il contenuto di ciascuna, comprese le
prime slice e le proposte storiche. Prima di ricavarne una capacità corrente,
verificare gli emendamenti pertinenti e le prove: uno stato accettato non è
un’autorizzazione aggiuntiva né un’attestazione di runtime.

| File | Tema |
| --- | --- |
| [docs/adr/README.md](./adr/README.md) | Regole operative ADR (quando, come, stati). |
| [docs/adr/0000-template.md](./adr/0000-template.md) | Template standard ADR. |
| [docs/adr/0004-exemptions-catalog.md](./adr/0004-exemptions-catalog.md) | Catalogo esenzioni locale e mapping su paziente. |
| [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md) | Parity web/native su contratto API condiviso. |
| [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md) | Plugin terminologie unificato + profili FSE/EDS. |
| [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md) | Modello operativo web-first + parity sweep. |
| [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md) | Strategia test macOS con XCTest/Xcode separata dal web runner. |
| [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md) | Strategia spec-first OpenAPI e governance/versioning del contratto `/api/v1`. |
| [docs/adr/0084-document-diagnoses-review-only.md](./adr/0084-document-diagnoses-review-only.md) | Sostituisce l'autofill delle diagnosi da documento con proposte review-only e un gate fail-closed sugli envelope ambigui. |
| [docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md) | Decisione accettata sul supporto indipendente dal modello, chiarimento fail-closed e automazione graduata; non aggiunge inbox conversazionale o runtime esterni alla 0.8. |
| [docs/adr/0087-registro-proposte-diagnostiche-documentali.md](./adr/0087-registro-proposte-diagnostiche-documentali.md) | Foundation persistente locale delle proposte, separata dalle diagnosi cliniche; backup/restore e purge la includono, mentre writer, route, UI, transizioni e applicazione restano assenti. |
| [docs/adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md) | Contratto fabric: routing per capability, venue esplicite, profili egress versionati, policy immutabile e ricevute che non autorizzano consumer. |
| [docs/adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md](./adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md) | Giunture fabric: ciclo di vita trust paired con revoca host-side, onboarding provider fail-closed per classe di credenziale, decisioni di routing osservabili con fallback negato e contratto di interazione clinica. |
| [docs/adr/0091-candidato-locale-fabric-admissione-continuita-status.md](./adr/0091-candidato-locale-fabric-admissione-continuita-status.md) | Candidato locale Fabric: admissione provider, continuita fail-closed, stato paired read-only e harness sintetico senza egress o scritture cliniche. |
| [docs/adr/0092-limite-digest-bound-readiness-ai-locale.md](./adr/0092-limite-digest-bound-readiness-ai-locale.md) | ADR accettato: annotazione distinta da `runtime`, bracket digest best-effort e qualified readiness bloccata. |
| [docs/adr/0106-web-auth-logout-pin-setup-lifecycle.md](./adr/0106-web-auth-logout-pin-setup-lifecycle.md) | ADR accettata: lifecycle Web P3 per logout esatto senza mutare cookie, retirement user-scoped dopo CAS PIN e setup commit-last; runtime e reset PIN restano esclusi. |
| [docs/adr/0105-web-auth-process-integrity-assumption.md](./adr/0105-web-auth-process-integrity-assumption.md) | ADR accettata: assunzione process-global per H1a, residuo di disponibilita e gate H1b/security senza claim auth completo. |
| [docs/adr/0104-web-lock-revocation-fence-and-credential-transport.md](./adr/0104-web-lock-revocation-fence-and-credential-transport.md) | ADR accettata: fence process-local per Web lock, binding control/session e revoca fail-closed; runtime e native restano non implementati. |
| [docs/adr/0103-headless-clinician-authorized-soap-entry-write.md](./adr/0103-headless-clinician-authorized-soap-entry-write.md) | ADR accettata: una sola append SOAP locale con conferma clinica monouso; runtime, apply generale e authority Fabric restano esclusi. |
| [docs/adr/0097-active-role-session-and-step-up-authorization.md](./adr/0097-active-role-session-and-step-up-authorization.md) | ADR accettata: prerequisito host-owned, inattivo per default, physician-only e limitato alla sola SOAP; non consegna sessione runtime, proof o write. |
| [docs/adr/0100-fabric-vs-headless-semantic-plane.md](./adr/0100-fabric-vs-headless-semantic-plane.md) | ADR proposta: separa Fabric host-governed e Headless semantico, con inventari e gate SHA distinti; non abilita runtime, cloud o apply. |
| [docs/adr/0094-intelligence-fabric-headless-contract-085.md](./adr/0094-intelligence-fabric-headless-contract-085.md) | ADR accettata 0.8.5 per Application Service Layer, quattro smart path generativi proposal-only e capability `ocr` non disponibile nel runtime della patch. |
| [docs/adr/0095-broker-projection-e-servizi-host-per-capability.md](./adr/0095-broker-projection-e-servizi-host-per-capability.md) | ADR accettata per lifecycle post-onboarding, broker di projection minimizzate e servizi host capability-specific. |
| [docs/adr/0096-owner-sessione-selezione-e-lifetime-broker.md](./adr/0096-owner-sessione-selezione-e-lifetime-broker.md) | ADR accettata per owner session-scoped, selezione canonica, invalidazione e broker per lease. |
| [docs/adr/0102-document-synthesis-source-authority.md](./adr/0102-document-synthesis-source-authority.md) | ADR accettata per source-set host-owned, citazioni validate, digest distinti e receipt Document Synthesis review-only. |
| [docs/adr/0099-ocr-document-locator-and-source-currentness.md](./adr/0099-ocr-document-locator-and-source-currentness.md) | ADR accettato per currentness e locator monouso volatile; ADR 0107 riusa il confine della sorgente senza autorizzare runtime OCR o apply. |
| [docs/adr/0107-anydoc-local-attachment-extraction.md](./adr/0107-anydoc-local-attachment-extraction.md) | AnyDoc è il primo passaggio deterministico locale, distinto da OCR; ADR 0117 governa il routing `needsOcr` e ADR 0119 precisa la composizione con Apple Vision. |
| [docs/adr/0108-piano-canonico-headless-read-only-085.md](./adr/0108-piano-canonico-headless-read-only-085.md) | ADR accettato: `66/66` indica 66 esiti Headless terminali; i GET network restano evidence read candidate e non operation grant. |
| [docs/adr/0109-confini-programma-intelligence-fabric-headless-085.md](./adr/0109-confini-programma-intelligence-fabric-headless-085.md) | ADR accettato: delimita Fabric review-only, foundation Headless e sola eccezione SOAP H1-H10; registra F6 DeepSeek-OCR 2 e F7 OpenAI/Anthropic runtime come `RELEASE_SCOPE_EXCLUDED` e governa le direzioni future. |
| [docs/adr/0110-riapertura-governata-programma-intelligente-085.md](./adr/0110-riapertura-governata-programma-intelligente-085.md) | ADR accettato: riapre il programma 0.8.5 a OCR selettivo, provider cloud ufficiali, MCP/intelligent host, agent operations, recording e planner; nessuna lane diventa consegnata senza packet e gate propri. |
| [docs/adr/0111-deepseek-ocr2-selective-page-routing.md](./adr/0111-deepseek-ocr2-selective-page-routing.md) | ADR accettato per routing PDF e adapter DeepSeek-OCR 2 pin-by-digest; ADR 0117 rende l'adapter opzionale nel contratto OCR model-agnostic. |
| [docs/adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md](./adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md) | ADR accettato per provider v2, secret broker a lease effimero e trasporti ufficiali OpenAI/Anthropic; provider remoti disattivati per impostazione predefinita, nessun fallback e prima esecuzione limitata a dati sintetici non clinici. |
| [docs/adr/0113-recording-visita-trascrizione-locale-085.md](./adr/0113-recording-visita-trascrizione-locale-085.md) | ADR accettato per recording e trascrizione Apple on-device nel target macOS, con consenso esplicito, raw audio bounded in RAM e transcript effimero separato dal writer clinico. |
| [docs/adr/0114-intelligent-host-aip-mcp-isolation.md](./adr/0114-intelligent-host-aip-mcp-isolation.md) | ADR accettato per isolamento MCP `stdio` modern-only, broker AIP locale, lease/revoca/audit e import boundary; la prima slice resta non-PHI e senza sessione clinica. |
| [docs/adr/0115-icd11-who-reference-data-adapter.md](./adr/0115-icd11-who-reference-data-adapter.md) | ADR con emendamento locale 2026-09-06: Search loopback fisso, opt-in, niente OAuth/remoto, DTO compatibili e cache legata agli artefatti; provisioning e prova sul target ancora da eseguire. |
| [docs/adr/0116-agentic-checkup-status-transition.md](./adr/0116-agentic-checkup-status-transition.md) | ADR accettato per il primo write agentico non-SOAP: sola transizione `pending -> completed\|cancelled`, proposta AIP, conferma UI operation-specific, CAS, idempotenza e receipt PHI-safe; nessun runtime nel packet. |
| [docs/adr/0117-headless-portable-agent-first-and-capability-first-fabric.md](./adr/0117-headless-portable-agent-first-and-capability-first-fabric.md) | Decisione accettata per Headless/CLI/MCP portabili e governati nella 0.8.5 e per OCR indipendente dal modello, con DeepSeek opzionale. L’addendum 0.8.6 WUL-696 raccorda Mini agli stessi comandi senza nuove capability. |
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
| [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | Retention automatica dei backup scheduler-owned con policy `keep-last-N`, preview dry-run e cleanup tracciato in `settings`. |
| [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | Fissa la sequenza di stabilizzazione web/core prima del prossimo version bump, con helper condivisi, `typecheck` canonico e split incrementale dei god files. |
| [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | Introduce il foundation layer locale SISS con azioni tipizzate, error taxonomy stabile, retry sui transienti e metadata audit PHI-safe. |
| [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | Fissa il boundary ufficiale del filone `WUL-180`: oltre il `portal-handoff`, la vera integrazione nativa SISS/FSE richiede scenari approvati e un percorso coerente con `SSI` qualificata/provisioning ARIA. |
| [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | Fissa la decisione `WUL-181`: il primo step credibile sul prescrittivo regionale oltre l'handoff e `webapp-assisted`, non la riscrittura della UI prescrittiva dentro MediFlow. |
| [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | Decisione storica `WUL-196`: Graphite come shell unica; superata per la root entry da ADR 0060, ma conserva il principio no-selector. |
| [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md) | Fissa `WUL-272`: la root web `/` mostra il cockpit Kree8 direttamente dal lanciatore locale, mantenendo sicurezza runtime e nessun selector visuale. |
| [docs/adr/0061-clinical-agenda-bridge-zimbra-icloud.md](./adr/0061-clinical-agenda-bridge-zimbra-icloud.md) | Fissa `WUL-275`: lettura locale read-only delle cache evento Zimbra/iCloud come candidati clinici/FBF reviewable nella cockpit Kree8, senza import cieco o scritture cliniche. |
| [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | Fissa `WUL-279`: intended purpose, claim consentiti/esclusi e guard repo-local `check:claims` contro overclaim clinico/regolatorio. |
| [docs/adr/0066-patient-soft-delete-lifecycle.md](./adr/0066-patient-soft-delete-lifecycle.md) | Fissa `WUL-306`: DELETE paziente come tombstone soft-delete version-guarded, cascade canonica `PATIENT_CHILD_TABLES` con guardia anti-drift, purge admin audited (`patient.purged`) e clear test-container per membership (WUL-322). |
| [docs/adr/0068-cross-platform-runtime-windows-linux.md](./adr/0068-cross-platform-runtime-windows-linux.md) | Fissa `WUL-375`: runtime cross-platform Windows/Linux con adapter scheduler backup, gating MLX/PM2 a macOS, launcher sottili per OS e contratto unico Node 24/ABI nativa per installazione, build e avvio. |
| [docs/adr/0070-in-house-first-for-buildable-logic.md](./adr/0070-in-house-first-for-buildable-logic.md) | Fissa l'approccio in-house-first per logica integrabile, dati ICD e moduli locali senza dipendenze opzionali obbligatorie. |
| [docs/adr/0071-tri-os-reversed-flow-shared-core.md](./adr/0071-tri-os-reversed-flow-shared-core.md) | Definisce la direzione tri-OS a flusso invertito e i gate per un core nativo condiviso; non descrive la runtime 0.8 corrente. |
| [docs/adr/0074-network-cross-patient-read-boundary.md](./adr/0074-network-cross-patient-read-boundary.md) | Fissa le letture network cross-paziente: scope obbligatorio per membership, capability dedicate, filtri plaintext, ciphertext opaco e limit con cap. |
| [docs/adr/0075-paired-account-operations-and-pin-rotation.md](./adr/0075-paired-account-operations-and-pin-rotation.md) | Fissa le operazioni account paired sulla famiglia auth condivisa, la rotazione PIN client-of-origin con KDF v2 e le esclusioni di reset e re-wrap lazy nativo. |
| [docs/adr/0076-paired-document-domain-write-policy.md](./adr/0076-paired-document-domain-write-policy.md) | Classifica le scritture del dominio documentale paired in cinque classi: contenuto manuale e compute deterministici consentiti, artefatti document-derived e invocazione AI esclusi, stato kill switch leggibile. |
| [docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md) | Definisce il limite provider/egress. La 0.8.5 include anche adapter ufficiali e probe amministrativa OpenAI/Anthropic `default OFF`, con transport fake, senza prova live, credenziali o retention. |
| [docs/adr/0078-lume-lingua-di-design-di-destinazione.md](./adr/0078-lume-lingua-di-design-di-destinazione.md) | Decisione `Accepted`: adotta Lume come lingua di destinazione multipiattaforma, con Vetro Clinico transitorio e migrazione L0-L6 ancora parziale. |
| [docs/adr/0079-local-open-loops-and-result-link.md](./adr/0079-local-open-loops-and-result-link.md) | Accetta le attese locali deterministiche: prima slice web consegnata, salvataggio esplicito e nessuna estensione paired. |
| [docs/adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md](./adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md) | Propone di serializzare le schema guard SQLite al bootstrap per rendere deterministici build e avvii multiprocesso. |
| [docs/adr/0081-fhir-r4-export-v0-contract.md](./adr/0081-fhir-r4-export-v0-contract.md) | Decisione `Accepted`: fissa copertura, parità web/native, validazione locale e nessun claim FSE per l'export FHIR R4 v0. |
| [docs/adr/0082-persistent-expectations-register-v0.md](./adr/0082-persistent-expectations-register-v0.md) | Decisione `Accepted`: definisce un registro persistente host-only delle attese con provenienza univoca, matching fail-closed e conferma esplicita della chiusura. |
| [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | Fissa `WUL-199`: i preview profiles funzionali vengono ritirati da `main`, con AI e Smart Import gia live e il contesto paziente SISS promosso a parte stabile della scheda paziente. |
| [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | Formalizza `WUL-188`: family Apple ricostruita con core Swift condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come `home-base` autorevole e mobile paired senza accesso diretto a SQLite. |
| [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | Formalizza `WUL-176`: corpus documentale locale SISS/FSE con manifest versionato, fetch/sync fuori Git e futuro MCP ammesso solo sopra un corpus approvato. |
| [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | Definisce la rotazione zero-knowledge del PIN tramite re-wrap client-side della master key, senza ricifrare i dati clinici. |
| [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | Formalizza il create-flow `Nuova Anagrafica` da documento con review esplicita, matching locale ICD/AIFA e persistenza strutturata solo delle terapie sufficientemente confermate. |
| [docs/adr/0051-patient-import-decision-contract-between-review-and-persistence.md](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md) | Formalizza la thin slice `WUL-167`: contratto `patient import decision` tra review documentale e persistenza prudente, con target `create/merge/review` e distinzione esplicita tra write strutturate e note-only. |
| [docs/adr/0052-network-patient-profile-write-boundary.md](./adr/0052-network-patient-profile-write-boundary.md) | Formalizza la prima slice write paired: `PUT /api/v1/network/patients/{id}` con paired client, sessione operatore, scope ambulatoriale e `version`, lasciando fuori delete remoto, child CRUD, sync e campi AI/documentali. |
| [docs/adr/0053-network-diary-entry-write-boundary.md](./adr/0053-network-diary-entry-write-boundary.md) | Formalizza la slice write paired del diario: read/create/update/soft-delete su `/api/v1/network/patients/{id}/entries*` con `entries.version`, capability dedicate, audit PHI-safe e hard delete/attachment/AI fuori scope. |
| [docs/adr/0054-network-therapy-write-boundary.md](./adr/0054-network-therapy-write-boundary.md) | Formalizza la slice write paired delle terapie: read/create/update/soft-delete su `/api/v1/network/patients/{id}/therapies*` con `therapies.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0055-network-checkup-write-boundary.md](./adr/0055-network-checkup-write-boundary.md) | Formalizza la slice write paired dei checkup: read/create/update/soft-delete su `/api/v1/network/patients/{id}/checkups*` con `checkups.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0056-network-observation-write-boundary.md](./adr/0056-network-observation-write-boundary.md) | Formalizza la slice write paired delle osservazioni: read/create/update/soft-delete su `/api/v1/network/patients/{id}/observations*` con `observations.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |


## ✅ Checklist manutenzione indice

| File | Scopo |
| --- | --- |
| [ADR 0140](./adr/0140-synthetic-plugin-feasibility.md) | WUL-756: plugin isolato con fixture inventate, contesto esplicito e gate clinici/distribuzione distinti. |
| [Skill synthetic-review](../plugins/mediflow-synthetic/skills/synthetic-review/SKILL.md) | Workflow medico limitato a esempi inventati, senza accesso a cartelle cliniche o applicazione. |

Il confronto con `rg --files -g '*.md' | sort` permette di verificare
l’inventario. Ogni file deve comparire con una descrizione, la data «Ultimo
aggiornamento» va riallineata e [docs/README.md](./README.md) deve seguire i
cambi di priorità o di riferimento autorevole.

[ADR 0135](./adr/0135-native-ai-configuration-authority.md) descrive grant nativo esplicito, preferenze AI e preset,
componenti, fixture sintetiche, comandi e limiti: non sostituisce la verifica
applicativa sulla revisione da integrare.

## Proposte recuperate nella riconciliazione del 12 settembre 2026

Il recupero rende consultabili questi contributi, non ne attesta accettazione,
integrazione o qualifica. La verifica successiva deve rispettare il contratto
di ciascuna proposta e il limite di autorità dell’host.

| File | Scopo | Quando consultarlo |
| --- | --- | --- |

## Verifica formale circoscritta

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [Cambio stato terapia](./formal/therapy-status/README.md) | Statechart, modello finito TLC, controesempi, comando e collegamento ai test reali. | Quando cambia il controller Web, il registro dei tentativi o la CAS terapia. |

- `docs/adr/0159-plugin-local-ui-navigation.md`
- `plugins/mediflow-local-ui/README.md`
- `plugins/mediflow-local-ui/skills/local-ui/SKILL.md`


[ADR 0165 — Canale di accesso della chat alla sessione GPUI](adr/0165-native-chat-access-channel.md): protocollo C4a senza contenuti clinici, proposta e prove richieste.

- [ADR0169](adr/0169-gpui-ambulatory-destructive-commands.md): doppia autorità e snapshot per due comandi amministrativi nominati.

## Punti di innesto territoriali, proposta del 29 ottobre 2026

- [adr/0170-territorial-service-extension-points.md](./adr/0170-territorial-service-extension-points.md): ADR Proposed: nove punti di innesto e manifesto dei servizi, estensione di 0158.
- [territorial/lombardia-services-and-prerequisites.md](./territorial/lombardia-services-and-prerequisites.md): Dodici servizi, priorità PRREG/GCM e prerequisiti Ente/Software House ancora aperti.

- `docs/analysis/2026-10-31-chat-catalog-fabric/catalogo-operativo.md`: raccordo generato tra capacità Fabric, servizi, controlli di accesso, consumatori e test; limiti delle prove sorgente.
