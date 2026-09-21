---
summary: "Canonical MediFlow documentation entrypoint and precedence map."
read_when:
  - "Starting any MediFlow task and deciding which docs are authoritative."
  - "Updating documentation structure, canonical indices, or repository governance."
---

# Documentazione MediFlow: Indice Canonico

Chi arriva dal prodotto cerca di capire a che cosa serva MediFlow; chi deve
modificarlo deve anche sapere quali decisioni lo vincolino. Questo indice
collega le due esigenze: orienta la lettura, indica il documento da aggiornare
per ciascun tema e chiarisce quale riferimento prevalga in caso di divergenza.
L’[indice completo](./markdown-index.md) serve invece a trovare i singoli file.

La mappa precedente era aggiornata al 2026-09-08. Questa revisione editoriale
è del 2026-09-20; le date, le revisioni e gli esiti contenuti nei verbali
restano quelli delle prove originarie.

<!-- reconciliation-20260912 -->
La candidatura ricostruita il 12 settembre 2026 non era ancora una release.
In quel piano Windows, Linux, Mini, iPhone e iPad erano rinviati alla 1.0, con
ATHENA opzionale: era l’indicazione di quella fase, non una nuova scadenza
o una qualifica delle piattaforme.
**Oggi la 0.8.6 è pubblicata come codice sorgente**, per runtime locale/headless
sul Mac e browser localhost. Il percorso nativo è separato; gli archivi ZIP e
TAR.GZ non attestano installer firmati o notarizzati né app complete su altri
sistemi. Le prove storiche Windows/Linux e il raccordo Mini WUL-696 non sono
cancellati da questa delimitazione, ma nemmeno diventano qualifiche generali.

Le sezioni sulla `0.8.5` descrivono i propri sorgenti e le proprie prove.
La pubblicazione corrente è ricostruita nello
[stato del sistema](./STATE_OF_THE_SYSTEM.md) e lo storico delle versioni nel
[CHANGELOG](../CHANGELOG.md). La valutazione del deployment clinico resta aperta in
WUL-688 e il coordinamento generale in [WUL-669](https://linear.app/wulfgardr/issue/WUL-669): una release sorgente
non chiude l’intero programma né qualifica servizi solo configurati.

<!-- @Codex -->
## Pianificazione corrente

La [roadmap prodotto](./ROADMAP.md#roadmap-vigente--21-settembre-2026) riporta
le tappe 0.9.0–1.0 definite nel
[registro incrementale Linear](https://linear.app/wulfgardr/document/mediflow-incremental-release-ledger-090-to-10-ee0392f27b72).
La 0.9.0 consolida il prodotto attuale; servizi condivisi, Rust,
interoperabilità e distribuzione nativa hanno tappe successive distinte.
I precedenti rinvii generici alla 1.0 restano storia, non il piano corrente.

## Percorsi di lettura

Per una prima visita, [Inizia qui](./start-here.md) e il [README del progetto](../README.md) spiegano
il bisogno, il lavoro senza AI e le ragioni della modularità. Quando la
domanda riguarda dati e responsabilità, partire da
[privacy, GDPR e governance AI](./privacy-and-ai-governance.md) e proseguire nelle policy e nei contratti
richiamati: l’introduzione non sostituisce quei vincoli.

Per valutare la candidatura 0.8.5, [readiness e canali Apple](./release-085-readiness.md) conserva le
prove e i gate aperti di quella revisione. Per contribuire ai sorgenti,
servono [topologia repository](./repository-topology.md), [architettura](../ARCHITECTURE.md) e poi il contratto del
componente. [Get MediFlow e linea editoriale](./getmediflow-editorial-proposal.md) riguarda il racconto
pubblico, mentre il [gemello web navigabile e confronto visuale](./design/2026-09-05-086-runtime-twin.md) conserva
le prove sintetiche WUL-676 precedenti alla promozione UI: nessuno dei due
sostituisce il runtime.

## Preferenze modello per esperienza

La scelta utile non è «quale AI per tutto», ma quale strumento ammesso usare
per una funzione, oppure se lasciarla spenta. [ADR 0129](./adr/0129-function-model-catalog-preferences.md) definisce il
contratto WUL-691: catalogo dell’host, preferenze e preset con controllo CAS,
override per la singola preview. Il catalogo limita la scelta e l’host ne
conserva l’autorità; una preferenza non abilita da sola un provider.

Il contributo backend, il picker, una prova sintetica e un’inferenza remota
sono risultati diversi. Il collegamento ChatGPT mantiene separati controllo
account, tentativo di esecuzione, consenso e ammissione dei dati: né il
catalogo informativo né il login attestano una funzione pronta.

## Consegna 0.8.6

La pubblicazione sorgente del 20 settembre 2026 e la CI sul commit
`46296266c0a8ff4d4ab19216af7e761cddec7d78` sono descritte nello Stato del
sistema. Su main risultano sei workflow e sette controlli richiesti
completati senza bypass o rerun dei workflow; Playwright conta 159 passati e
51 skip previsti, senza flaky, fallimenti o retry. Nella PR353 due casi erano
passati al retry automatico: l’assenza di retry su main non ne dimostra la
causa risolta. L’harness ChatGPT conta 26 passati, compresi 10 casi di
conformance, senza una nuova qualifica live consumer del candidato finale.

La [Verifica di rilascio 0.8.6](./analysis/2026-09-07-086-release-verification.md) conserva SHA, ricevute, correzioni
PIN/allegati, test e limiti delle candidature. Registrava assenza di finding
reportabili residui nel perimetro sorgente, autorizzazione del pacchetto e
attesa di CI e pubblicazione, insieme a una suite completa con un fallimento.
Questa attesa è storica: non descrive più lo stato della release.

Il [Verbale integrato](./analysis/2026-09-06-086-integrated-closeout.md) conserva prove e decisioni con le rispettive
disposizioni. La [Review Daybreak](./analysis/2026-09-07-086-daybreak-security-review.md) mantiene il report inglese storico e
gli addenda sanitizzati: firma di produzione non attestata e RBAC per
operatore fuori scope non vanno reinterpretati come capacità consegnate.

La [Promozione della UI web](./adr/0123-official-web-ui-navigation-compositions.md) stabilisce B predefinita e A selezionabile,
separando il confronto sintetico. La [Verifica della UI integrata](./analysis/2026-09-06-086-integrated-ui-verification.md)
riporta build standalone e percorsi browser senza flag, distinguendo prove
reali, simulate e limiti. La [Verifica della cartella Apple](./analysis/2026-09-06-086-apple-ui-verification.md) documenta
build locali, bozze e navigazione su Mac e simulatori; la
[Nuova proposta macOS](./design/2026-09-06-086-macos-redesign.md) riguarda il successivo redesign con barra delle
aree, una lista laterale e cartella documentale. L’accettazione estetica
resta un giudizio distinto.

Il [Candidato funzionale locale](./analysis/2026-09-06-086-functional-closeout.md) fotografa la base precedente alla
promozione UI di ADR 0123, con prove e incidente conservati. Le integrazioni
successive non riscrivono quella evidenza. [Stato funzioni](./adr/0121-function-status-projection.md) e
[setup host Ollama](./adr/0122-local-provider-host-setup.md) distinguono configurazione, ammissione e singola
esecuzione; [Inventario codice](./analysis/2026-09-06-086-code-inventory.md) e [matrice regolatoria](./analysis/2026-09-06-086-regulatory-evidence.md) raccolgono
copertura, controlli e gap, senza certificare conformità o adozione
organizzativa.

Per i documenti, [ADR 0119](./adr/0119-anydoc-apple-vision-current-source.md) separa AnyDoc e fallback PDF Apple Vision
dal catalogo Fabric. [ADR 0128](./adr/0128-local-desktop-ocr.md) descrive il candidato Tesseract WASM e i
profili renderer Windows/Linux; la qualifica dei target resta distinta.
La [Prima verifica OCR](./analysis/2026-09-05-086-ocr-verification.md) conserva preview, matrice browser sintetica e
gate allora aperti. Per WHO, la [Decisione WHO WUL-672](./analysis/2026-09-05-086-who-decision.md) registra la
scelta del sidecar locale; [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md) e [setup](./icd-who-setup.md) governano Search
locale opt-in, con provisioning e prova sul target non attestati dal solo
contratto. Lookup e cross-check restano fuori dal candidato.

La [Baseline operativa WUL-670](./analysis/2026-09-05-mediflow-086-baseline.md) conserva base, prove sintetiche, recuperi
prioritari e ordine di sviluppo. Il
[Piano operativo configurazione e parità desktop](./analysis/2026-09-07-086-guided-configuration-plan.md) articola in sei fasi
la richiesta del 7 settembre e i contratti e gate da completare: è un piano,
non una prova della consegna di ogni voce. La
[Mini roadmap di consolidamento](./roadmap-086-consolidamento.md) raccoglie OCR, ICD-11, impostazioni,
scheda paziente, onboarding assistito, deslop, GDPR/AI Act, recupero selettivo
dei branch, design arena e collegamenti Linear. Non cambia i contratti del
runtime o il design attivo.

## Candidato Web 0.8.5: editor e analytics

[Snapshot/CAS del modulo, recupero dei salvataggi parziali e conteggio Schede](./web-patient-edit-and-analytics-085.md)
conserva il contratto `mf085-fix-a-web-20260904`, le regressioni e i limiti di
quella candidatura sorgente. Non è una ricevuta di rilascio.

## 📚 Policy di consultazione (agent)

Per un agente, orientarsi significa anzitutto individuare chi governi il
lavoro richiesto. La sequenza seguente collega presentazione, regole
operative, stato, architettura, sicurezza e contributi. Le ADR vanno scelte
per pertinenza, verificando stato e successione degli emendamenti: la data
più recente, da sola, non rende una decisione applicabile a ogni tema.

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/README.md](./README.md) (questo file)
4. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
5. [ARCHITECTURE.md](../ARCHITECTURE.md)
6. [SECURITY.md](../SECURITY.md)
7. [CONTRIBUTING.md](../CONTRIBUTING.md)
8. [docs/repository-topology.md](./repository-topology.md)
9. [docs/adr/](./adr/README.md) (pertinenti al tema, con i successivi emendamenti)

Gli approfondimenti seguenti mantengono nomi e riferimenti tecnici per
rendere reperibili i contratti. «Proposto», «candidato» e «storico» qualificano
il documento o la prova nominati, non l’intero prodotto.

<!-- @Codex MF085-002/003 -->
- Scale cliniche source-bound e invio completo: [ADR 0118](./adr/0118-tinetti-poma28-source-bound-submission.md) (candidato; storico preservato, nessuna classificazione automatica del rischio per la nuova Tinetti).

- Contratto prodotto: [PRODUCT.md](../PRODUCT.md)
- Contratto design multipiattaforma: [DESIGN.md](../DESIGN.md)
- Riferimenti per le proposte Apple: [Breccia, criteri e adattamenti](./design/2026-09-06-breccia-apple-reference.md), con fonti, copertura e limiti distinti dai contratti.
- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- Governance repository e topologia runtime/publication: [docs/repository-topology.md](./repository-topology.md)
- Vetro Clinico, baseline storica e transitoria di design: [docs/design/vetro-clinico/README.md](./design/vetro-clinico/README.md)
- Lume, lingua di design attiva con token DTCG nella release sorgente v0.8; i gate di parity restano separati: [docs/design/lume/README.md](./design/lume/README.md)
- Lettura completa dello stato corrente: [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
- FAQ pubbliche e stato sintetico del prodotto: [docs/FAQ.md](./FAQ.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity localhost/Apple: [docs/parity-matrix.md](./parity-matrix.md), [docs/apple-parity-matrix.json](./apple-parity-matrix.json) e [docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json)
- Limiti noti della 0.8.5: [docs/known-limitations.md](./known-limitations.md)
- Verbale finale locale 0.8.5: [docs/analysis/2026-09-01-mediflow-0.8.5-final-verification.md](./analysis/2026-09-01-mediflow-0.8.5-final-verification.md)
- Ledger operativo del programma 0.8.5 riaperto: [docs/analysis/2026-09-01-mediflow-0.8.5-reopened-program-ledger.md](./analysis/2026-09-01-mediflow-0.8.5-reopened-program-ledger.md)
- Run record recovery UI/parity 0.8: [docs/analysis/2026-07-27-parity-0.8-recovery-run.md](./analysis/2026-07-27-parity-0.8-recovery-run.md)
- Contratto OpenAPI `/api/v1`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md), [docs/adr/0052-network-patient-profile-write-boundary.md](./adr/0052-network-patient-profile-write-boundary.md), [docs/adr/0053-network-diary-entry-write-boundary.md](./adr/0053-network-diary-entry-write-boundary.md), [docs/adr/0054-network-therapy-write-boundary.md](./adr/0054-network-therapy-write-boundary.md), [docs/adr/0055-network-checkup-write-boundary.md](./adr/0055-network-checkup-write-boundary.md), [docs/adr/0056-network-observation-write-boundary.md](./adr/0056-network-observation-write-boundary.md)
- Limiti JSON native/network e risposta 413: [ADR 0124](./adr/0124-bounded-native-network-json.md).
- Aggiornamento AIFA con un clic, proposta da implementare e verificare: [ADR 0125](./adr/0125-explicit-aifa-catalog-download.md).
- Import locale esenzioni, contratto candidato WUL-690: [ADR 0127](./adr/0127-atomic-local-exemption-import.md).
- Repertorio protesica locale, contratto candidato WUL-693: [ADR 0133](./adr/0133-local-prosthetics-catalog-import.md).
- Corpus documentale SISS/FSE 2.0: [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- Integrazione ATHENA-style Treatment Reasoning: [docs/treatment-reasoning-athena-integration.md](./treatment-reasoning-athena-integration.md), [docs/adr/0073-treatment-reasoning-athena-boundary.md](./adr/0073-treatment-reasoning-athena-boundary.md)
- Astrazione provider AI e boundary egress: [ADR 0077](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md)
- Matrice task, modelli e serving gate post-0.8: [docs/ai-runtime-serving-matrix.md](./ai-runtime-serving-matrix.md)
- Contratto export FHIR R4 v0: [ADR 0081](./adr/0081-fhir-r4-export-v0-contract.md)
- Correzione indipendente lifecycle nativo MF085-004: [candidato e test](./fhir-lifecycle-fix.md); non attiva FHIR v2.
- Registro persistente delle attese v0: [ADR 0082](./adr/0082-persistent-expectations-register-v0.md)
- Diagnosi da documento review-only: [ADR 0084](./adr/0084-document-diagnoses-review-only.md)
- Scaffold intelligente e automazione graduata: [ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md)
- Foundation persistente delle proposte diagnostiche documentali: [ADR 0087](./adr/0087-registro-proposte-diagnostiche-documentali.md)
- Routing PDF deterministico per pagina: [ADR 0088](./adr/0088-deterministic-pdf-page-router.md)
- Limite digest-bound della readiness AI locale: [ADR 0092](./adr/0092-limite-digest-bound-readiness-ai-locale.md)
- Lifecycle Web P3 per logout, PIN e setup: [ADR 0106](./adr/0106-web-auth-logout-pin-setup-lifecycle.md)
- Piano canonico Headless read-only 0.8.5: [ADR 0108](./adr/0108-piano-canonico-headless-read-only-085.md)
- Assunzione di integrita del processo per l'auth web H1a: [ADR 0105](./adr/0105-web-auth-process-integrity-assumption.md)
- Fence di revoca Web lock e trasporto credenziali: [ADR 0104](./adr/0104-web-lock-revocation-fence-and-credential-transport.md)
- Scrittura SOAP Headless autorizzata dal medico: [ADR 0103](./adr/0103-headless-clinician-authorized-soap-entry-write.md)
- Piani Fabric e Headless semantico: [ADR 0100](./adr/0100-fabric-vs-headless-semantic-plane.md)
- Confini del programma Fabric/Headless 0.8.5: [ADR 0109](./adr/0109-confini-programma-intelligence-fabric-headless-085.md)
- Riapertura governata del programma intelligente 0.8.5: [ADR 0110](./adr/0110-riapertura-governata-programma-intelligente-085.md)
- Routing OCR selettivo DeepSeek-OCR 2: [ADR 0111](./adr/0111-deepseek-ocr2-selective-page-routing.md)
- Provider v2, secret broker e adapter OpenAI/Anthropic: [ADR 0112](./adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md)
- Recording visita e trascrizione locale Apple: [ADR 0113](./adr/0113-recording-visita-trascrizione-locale-085.md)
- Isolamento Intelligent Host, AIP e MCP: [ADR 0114](./adr/0114-intelligent-host-aip-mcp-isolation.md)
- Adapter ICD-11 verso sidecar WHO locale opt-in: [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md)
- Configurazione ICD-11 WHO e readiness governata: [setup WHO](./icd-who-setup.md)
- Transizione agentica governata dello stato checkup: [ADR 0116](./adr/0116-agentic-checkup-status-transition.md)
- Headless portabile agent-first e Fabric capability-first: [ADR 0117](./adr/0117-headless-portable-agent-first-and-capability-first-fabric.md)
- Contratto Intelligence Fabric e headless 0.8.5, con quattro smart path generativi e capability Fabric `ocr=unavailable` distinta dal fallback AnyDoc: [ADR 0094](./adr/0094-intelligence-fabric-headless-contract-085.md)
- Crosswalk runtime Fabric del candidato 0.8.5: [docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json)
- Receipt storica Fabric non integrata: [docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json](./capability-mapping/fabric-product-crosswalk-receipt.v1.json)
- Broker di projection e servizi host per capability: [ADR 0095](./adr/0095-broker-projection-e-servizi-host-per-capability.md)
- Owner di sessione, selezione e lifetime del broker: [ADR 0096](./adr/0096-owner-sessione-selezione-e-lifetime-broker.md)
- Autorita per la decisione terminale di review medica: [ADR 0098](./adr/0098-physician-terminal-review-authority.md)
- Autorita della sorgente per Document Synthesis: [ADR 0102](./adr/0102-document-synthesis-source-authority.md)
- Locator storico OCR e currentness della sorgente documentale: [ADR 0099](./adr/0099-ocr-document-locator-and-source-currentness.md)
- Estrazione locale unica degli allegati con AnyDoc, prevalente sul runtime OCR: [ADR 0107](./adr/0107-anydoc-local-attachment-extraction.md)
- Closeout secondario dello stack intelligente: [docs/analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md](./analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md)
- Triage audit esterno V2: [docs/analysis/2026-07-05-audit-esterno-v2-triage.md](./analysis/2026-07-05-audit-esterno-v2-triage.md)

## 🧭 Ordine di lettura consigliato

Per una lettura completa, questo ordine porta dal motivo del progetto al
suo funzionamento e infine all’inventario. Per un intervento circoscritto
restano sufficienti i contratti pertinenti, secondo AGENTS.md.

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
4. [ARCHITECTURE.md](../ARCHITECTURE.md)
5. [SECURITY.md](../SECURITY.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)
7. [docs/repository-topology.md](./repository-topology.md)
8. [docs/adr/](./adr/README.md) (pertinenti al tema, con i successivi emendamenti)
9. [docs/walkthrough.md](./walkthrough.md)
10. [docs/markdown-index.md](./markdown-index.md)

## 🧱 Convenzione stato documenti

`CANONICAL` indica il documento di riferimento da aggiornare quando cambia
il tema; `SECONDARY` un approfondimento utile che non prevale in caso di
conflitto. `LEGACY` conserva storia o riferimenti visuali, non una decisione
corrente. Lo stato del documento non certifica l’implementazione che descrive.

`CANDIDATE LOCAL` significa integrato nei sorgenti locali, senza attestare
release, tag o promozione. `RELEASE_SCOPE_EXCLUDED` identifica un componente
non pronto escluso dalla patch: non è una funzione consegnata, un requisito
implicito o una voce di roadmap già realizzata.

## 📚 Fonte autorevole per tema

La tabella indica dove cercare una decisione e dove aggiornarla. Le voci
riferite a una prima slice o a una versione precedente ne conservano
l’ambito; prima di dedurne lo stato corrente occorre leggere gli emendamenti
e le prove pertinenti. Né `CANONICAL` né `ACCEPTED` sono sinonimi di
installato, clinicamente qualificato o pubblicato.

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Onboarding progetto | [README.md](../README.md) | `CANONICAL` | Presenta il lavoro ambulatoriale, l’uso senza AI e le scelte che tengono insieme dati, documenti e attività. |
| Contratto prodotto | [PRODUCT.md](../PRODUCT.md) | `CANONICAL` | Definisce finalità, destinatari, compiti e ruoli delle piattaforme; separa limiti, anti-goal e direzione successiva alla 0.8. |
| Contratto design | [DESIGN.md](../DESIGN.md) | `CANONICAL` | Principi Lume condivisi, adattamenti per piattaforma, stati, accessibilità ed eccezioni intenzionali. |
| Regole operative per agent | [AGENTS.md](../AGENTS.md) | `CANONICAL` | Stabilisce come iniziare il lavoro, scegliere repository e worktree, tutelare i dati e verificare la consegna. |
| Governance e topologia repository | [docs/repository-topology.md](./repository-topology.md) | `CANONICAL` | Indica l’unica repository pubblica operativa e separa runtime, sito di presentazione e artefatti locali che devono restare fuori da Git. |
| Stato completo del sistema | [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | `CANONICAL` | Distingue la release sorgente 0.8.6 pubblicata, i contratti implementativi e le prove storiche con i propri SHA; mantiene aperta la decisione sul deployment clinico. |
| Visione architetturale stabile | [ARCHITECTURE.md](../ARCHITECTURE.md) | `CANONICAL` | Spiega perché dati, interfacce e funzioni intelligenti abbiano responsabilità separate, fissando i principi stabili. |
| Sicurezza e oscuramento dei dati | [SECURITY.md](../SECURITY.md) | `CANONICAL` | Definisce minacce considerate, protezione dei dati, oscuramento degli identificativi e limiti di log e audit. |
| Lifecycle Web P3 per logout, PIN e setup | [docs/adr/0106-web-auth-logout-pin-setup-lifecycle.md](./adr/0106-web-auth-logout-pin-setup-lifecycle.md) | `CANONICAL / ACCEPTED` | Prevale sul lifecycle P3 incompatibile: logout esatto senza mutare cookie, retirement user-scoped dopo CAS PIN e setup commit-last; non prova runtime o reset PIN. |
| Piano canonico Headless read-only 0.8.5 | [docs/adr/0108-piano-canonico-headless-read-only-085.md](./adr/0108-piano-canonico-headless-read-only-085.md) | `CANONICAL / ACCEPTED` | Interpreta `66/66` come 66 esiti terminali fail-closed; i 32 GET network restano evidence candidate e non operation grant. |
| Integrita del processo per l'auth web H1a | [docs/adr/0105-web-auth-process-integrity-assumption.md](./adr/0105-web-auth-process-integrity-assumption.md) | `CANONICAL / ACCEPTED` | Fissa l'assunzione process-global, il residuo di disponibilita e i gate H1b/security; non prova la catena auth completa. |
| Intended purpose e claims guard clinico | [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | `CANONICAL` | Fissa `WUL-279`: claim consentiti/esclusi su AI, SISS/FSE, cloud, diagnosi, triage, prescrizione e automazione, con guard `check:claims`. |
| Voice visit capture Fluid-style | [docs/adr/0072-voice-visit-capture-fluid-boundary.md](./adr/0072-voice-visit-capture-fluid-boundary.md) | `CANONICAL / PROPOSED` | Conserva il boundary storico. Il percorso corrente è governato da ADR 0113 e integra Apple on-device review-first; microfono reale e validazione clinica restano fuori dal claim. |
| Workflow di contribuzione | [CONTRIBUTING.md](../CONTRIBUTING.md) | `CANONICAL` | Definisce il lavoro contributivo, le verifiche richieste e la Definition of Done. |
| Audit esterno V2: triage e residuo azionabile | [docs/analysis/2026-07-05-audit-esterno-v2-triage.md](./analysis/2026-07-05-audit-esterno-v2-triage.md) | `SECONDARY / REVIEW TRIAGE` | Dossier di supporto collegato a `WUL-470` e figlie `WUL-471`..`WUL-475`: separa obiezioni misframed da residui reali su PIN, FHIR, MDR, sync futuro e drift ADR. Non prevale su `SECURITY.md`, `ARCHITECTURE.md`, ADR o issue Linear. |
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Contratto API locale `/api/v1` | [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml) | `CANONICAL` | Spec OpenAPI client-facing; processo/versioning governati da ADR 0010. |
| Primo write paired profilo paziente | [docs/adr/0052-network-patient-profile-write-boundary.md](./adr/0052-network-patient-profile-write-boundary.md) | `CANONICAL` | Slice per `PUT /api/v1/network/patients/{id}` con paired client, sessione operatore, scope ambulatoriale e `version`; esclude delete remoto, child CRUD, sync e campi AI/documentali. |
| Write paired diario clinico | [docs/adr/0053-network-diary-entry-write-boundary.md](./adr/0053-network-diary-entry-write-boundary.md) | `CANONICAL` | Slice per read/create/update/soft-delete diario su `/api/v1/network/patients/{id}/entries*` con `entries.version`, capability dedicate, audit PHI-safe e hard delete/attachment/AI fuori scope. |
| Write paired terapie | [docs/adr/0054-network-therapy-write-boundary.md](./adr/0054-network-therapy-write-boundary.md) | `CANONICAL` | Slice per read/create/update/soft-delete terapie su `/api/v1/network/patients/{id}/therapies*` con `therapies.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| Write paired checkup | [docs/adr/0055-network-checkup-write-boundary.md](./adr/0055-network-checkup-write-boundary.md) | `CANONICAL` | Slice per read/create/update/soft-delete checkup su `/api/v1/network/patients/{id}/checkups*` con `checkups.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| Write paired osservazioni | [docs/adr/0056-network-observation-write-boundary.md](./adr/0056-network-observation-write-boundary.md) | `CANONICAL` | Slice per read/create/update/soft-delete osservazioni su `/api/v1/network/patients/{id}/observations*` con `observations.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| Runbook manutenzione OpenAPI | [docs/openapi/README.md](./openapi/README.md) | `SECONDARY` | Workflow operativo per mantenere aggiornata la spec durante lo sviluppo. |
| Parity localhost/client Apple | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Fotografia corrente di 66 capability (30 full, 13 partial, 23 host-only), manifest QA e gate P6 residuo in `WUL-481`. |
| Recovery UI/parity 0.8 | [docs/analysis/2026-07-27-parity-0.8-recovery-run.md](./analysis/2026-07-27-parity-0.8-recovery-run.md) | `SECONDARY / RUN RECORD` | Registra recovery Claude, candidata locale, ownership, prove eseguite e blocker. Non sostituisce la matrice canonica. |
| Provider intelligenti post-0.8 | [docs/analysis/2026-07-28-provider-program-post-0.8-run.md](./analysis/2026-07-28-provider-program-post-0.8-run.md) | `SECONDARY / RUN RECORD` | Registra stato reale, trust boundary, locality Ollama, auth provider, DAG e gate del programma separato dalla release 0.8. |
| Intelligence Fabric post-0.8 | [docs/analysis/2026-07-29-intelligence-fabric-run.md](./analysis/2026-07-29-intelligence-fabric-run.md) | `SECONDARY / RUN RECORD` | Registra nucleo, giunture, prove, limiti, packet e stato del candidato locale WUL-522. |
| Matrice runtime AI post-0.8 | [docs/ai-runtime-serving-matrix.md](./ai-runtime-serving-matrix.md) | `CANONICAL / POST-0.8 GOVERNANCE` | Distingue compatibilità tecnica, benchmark, osservazione shadow e ammissione all’esecuzione per compito, modello e runtime. |
| Limite digest-bound della readiness AI locale | [docs/adr/0092-limite-digest-bound-readiness-ai-locale.md](./adr/0092-limite-digest-bound-readiness-ai-locale.md) | `CANONICAL / ACCEPTED` | Mantiene bloccata la qualified readiness e classifica il bracket come detection best-effort. |
| Contratto Intelligence Fabric | [docs/adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md) | `CANONICAL / ACCEPTED` | Definisce quali funzioni possa servire la Fabric, dove possano essere eseguite e con quali policy di uscita; ricevute e provenienza rendono osservabile la scelta senza concedere permessi. |
| Onboarding Ollama esplicito | [ADR 0136](./adr/0136-explicit-web-local-provider-onboarding.md) | `CANONICAL / CANDIDATE` | Estende ADR 0122 con verifica e attivazione Ollama da comando Web autenticato, ricevuta, CAS e revoca terminale; non autorizza download, generazione o qualifica implicita. |
| Giunture Intelligence Fabric | [docs/adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md](./adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md) | `CANONICAL / ACCEPTED` | Collega fiducia e revoca dei dispositivi paired, ammissione dei provider, decisioni di instradamento osservabili e review clinica. |
| Candidato locale Intelligence Fabric | [docs/adr/0091-candidato-locale-fabric-admissione-continuita-status.md](./adr/0091-candidato-locale-fabric-admissione-continuita-status.md) | `CANONICAL / ACCEPTED` | Limita admissione, continuita, stato paired e harness locale senza AI paired, cloud o scritture cliniche. |
| Crosswalk runtime Fabric 0.8.5 | [docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json) | `CANDIDATE LOCAL / MACHINE-READABLE` | Lega i quattro percorsi `proposal_only` a entrypoint, production root, route, receipt, provenienza e UI. `ocr=unavailable` riguarda la capability Fabric; il fallback Apple Vision vive nella composizione AnyDoc separata. Non prova release o apply. |
| Receipt storica Fabric non integrata | [docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json](./capability-mapping/fabric-product-crosswalk-receipt.v1.json) | `HISTORICAL EVIDENCE` | Resta immutabile con stato `candidate_not_integrated`. Non descrive e non sostituisce il crosswalk runtime corrente. |
| Fence di revoca Web lock e trasporto credenziali | [docs/adr/0104-web-lock-revocation-fence-and-credential-transport.md](./adr/0104-web-lock-revocation-fence-and-credential-transport.md) | `CANONICAL / ACCEPTED` | Fissa control process-local, binding esatto con il bearer Web fisso e revoca lock fail-closed; runtime e native restano esclusi. |
| Scrittura SOAP Headless autorizzata dal medico | [docs/adr/0103-headless-clinician-authorized-soap-entry-write.md](./adr/0103-headless-clinician-authorized-soap-entry-write.md) | `CANONICAL / ACCEPTED` | Governa la specifica operazione locale e monouso di append SOAP. Lo stato H1-H10 corrente vive nello Stato del sistema; non abilita Headless generale, Mini, apply generale o authority Fabric e non trasferisce autorità a F10. |
| Ruolo attivo e step-up SOAP Headless | [docs/adr/0097-active-role-session-and-step-up-authorization.md](./adr/0097-active-role-session-and-step-up-authorization.md) | `CANONICAL / ACCEPTED` | Prerequisito host-owned, inattivo per default, physician-only e limitato alla sola SOAP; non consegna sessione runtime, proof o write. |
| Piani Fabric e Headless semantico | [docs/adr/0100-fabric-vs-headless-semantic-plane.md](./adr/0100-fabric-vs-headless-semantic-plane.md) | `CANONICAL / PROPOSED` | Separa Fabric governato dall'host e Headless semantico, con inventari e gate SHA distinti; non abilita runtime, cloud o apply. |
| Confini del programma Fabric e Headless 0.8.5 | [docs/adr/0109-confini-programma-intelligence-fabric-headless-085.md](./adr/0109-confini-programma-intelligence-fabric-headless-085.md) | `CANONICAL / ACCEPTED` | Separa i quattro percorsi Fabric, l'append SOAP, Headless generale, MCP, AnyDoc e funzioni future. F10 usa una policy e un'autorità distinte governate dagli ADR successivi; gli esiti correnti sono registrati nello Stato del sistema e nelle limitazioni note. |
| Riapertura governata del programma intelligente 0.8.5 | [docs/adr/0110-riapertura-governata-programma-intelligente-085.md](./adr/0110-riapertura-governata-programma-intelligente-085.md) | `CANONICAL / ACCEPTED` | Prevale sulle sole esclusioni incompatibili di ADR 0107-0109 e governa il nuovo split OCR, provider, MCP, agent operations, recording e planner senza promuoverne lo stato di delivery. |
| Routing OCR selettivo DeepSeek-OCR 2 | [docs/adr/0111-deepseek-ocr2-selective-page-routing.md](./adr/0111-deepseek-ocr2-selective-page-routing.md) | `CANONICAL / ACCEPTED / OPTIONAL ADAPTER` | Conserva il contratto selettivo per le pagine `needsOcr`. DeepSeek-OCR 2/CUDA ha stato `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`; la 0.8.5 usa Apple Vision locale nella composizione AnyDoc. |
| Provider v2, secret broker e adapter cloud ufficiali | [docs/adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md](./adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md) | `CANONICAL / ACCEPTED` | Separa lifecycle, secret reference, policy e receipt. La 0.8.5 integra una probe amministrativa exact-intent OpenAI/Anthropic `default OFF`, verificata con transport fake e senza credenziali o rete live. |
| Recording visita e trascrizione locale Apple | [docs/adr/0113-recording-visita-trascrizione-locale-085.md](./adr/0113-recording-visita-trascrizione-locale-085.md) | `CANONICAL / ACCEPTED` | La 0.8.5 integra il percorso macOS 26+ con consenso esplicito, raw audio bounded solo in RAM e transcript review-first senza writer clinico. Microfono reale e validazione clinica non sono provati. |
| Isolamento Intelligent Host, AIP e MCP | [docs/adr/0114-intelligent-host-aip-mcp-isolation.md](./adr/0114-intelligent-host-aip-mcp-isolation.md) | `CANONICAL / ACCEPTED` | Resta autorevole per isolamento, AIP, lease, revoca e hardening del trasporto. Il runtime corrente usa il Supervisor Node portabile di ADR 0117; il packet macOS #330 non è un requisito aperto della 0.8.5. |
| Adapter ICD-11 WHO locale | [docs/adr/0115-icd11-who-reference-data-adapter.md](./adr/0115-icd11-who-reference-data-adapter.md) | `CANONICAL / ACCEPTED` | Emendamento 2026-09-06: candidato Search su sidecar loopback fisso, opt-in server, senza OAuth o fallback remoto; DTO versionato e cache legata al dataset. Provisioning manuale e prova sul target restano distinti dai test sintetici. |
| Transizione agentica governata dello stato checkup | [docs/adr/0116-agentic-checkup-status-transition.md](./adr/0116-agentic-checkup-status-transition.md) | `CANONICAL / ACCEPTED` | Limita il write alla transizione `pending -> completed\|cancelled`. La 0.8.5 collega preview solo MCP e commit Web trusted con rilettura, step-up, gesto, CAS, idempotenza, audit e receipt; l'agente non riceve proof né esegue il commit. |
| Headless portabile agent-first e Fabric capability-first | [docs/adr/0117-headless-portable-agent-first-and-capability-first-fabric.md](./adr/0117-headless-portable-agent-first-and-capability-first-fabric.md) | `CANONICAL / ACCEPTED` | Nella 0.8.5 collega Supervisor Node, Web standalone, MCP su IPC ereditato e planner in lettura. L’addendum 0.8.6 WUL-696 aggiunge Mini con gli stessi comandi CLI, non nuove capability; installer, onboarding e host MCP esterni richiedono prove distinte. |
| Intelligence Fabric e controllo headless 0.8.5 | [docs/adr/0094-intelligence-fabric-headless-contract-085.md](./adr/0094-intelligence-fabric-headless-contract-085.md) | `CANONICAL / ACCEPTED` | Definisce Application Services, Fabric e AIP e registra la baseline Fabric `ocr=unavailable`. Il fallback Apple Vision appartiene alla composizione AnyDoc separata; nessuna fonte autorizza apply. |
| Broker projection e servizi host per capability | [docs/adr/0095-broker-projection-e-servizi-host-per-capability.md](./adr/0095-broker-projection-e-servizi-host-per-capability.md) | `CANONICAL / ACCEPTED` | Fissa lifecycle post-onboarding, broker plaintext minimizzato e servizi capability-specific senza autorizzare runtime o apply. |
| Owner di sessione, selezione e lifetime del broker | [docs/adr/0096-owner-sessione-selezione-e-lifetime-broker.md](./adr/0096-owner-sessione-selezione-e-lifetime-broker.md) | `CANONICAL / ACCEPTED` | Fissa una selezione canonica per sessione medica server, owner volatile e broker per lease senza autorizzare runtime. |
| Autorita per la decisione terminale di review medica | [docs/adr/0098-physician-terminal-review-authority.md](./adr/0098-physician-terminal-review-authority.md) | `CANONICAL / PROPOSED` | Propone una capability locale stretta, con attestazione, gesto monouso e route non registrata fino a otto gate indipendenti. |
| Autorita della sorgente per Document Synthesis | [docs/adr/0102-document-synthesis-source-authority.md](./adr/0102-document-synthesis-source-authority.md) | `CANONICAL / ACCEPTED` | Fissa source-set host-owned, citazioni con locator validato e receipt finale review-only; non autorizza runtime o persistenza. |
| Locator OCR e currentness della sorgente documentale | [docs/adr/0099-ocr-document-locator-and-source-currentness.md](./adr/0099-ocr-document-locator-and-source-currentness.md) | `CANONICAL / ACCEPTED` | Accetta `documentSourceRef`, revision ed epoch monotoni e il contratto di currentness riusato dalla nuova estrazione; non autorizza runtime OCR o apply. |
| Estrazione locale unica degli allegati con AnyDoc | [docs/adr/0107-anydoc-local-attachment-extraction.md](./adr/0107-anydoc-local-attachment-extraction.md) | `CANONICAL / ACCEPTED` | Governa il primo passaggio deterministico locale. La 0.8.5 continua soltanto le pagine PDF `needsOcr` con Apple Vision locale, provenienza e fail-closed; `ocr=unavailable` resta lo stato della capability Fabric separata. |
| FAQ pubbliche | [docs/FAQ.md](./FAQ.md) | `SECONDARY` | Risponde alle domande iniziali su prodotto, AI facoltativa, distribuzione e limiti senza sostituire i contratti. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Matrice baseline ufficiale GTW/FSE | [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | `CANONICAL` | Gap analysis versionata tra artifact ministeriali `it-fse-support` e stato reale MediFlow. |
| Baseline SISS | [docs/siss-baseline.md](./siss-baseline.md) | `CANONICAL` | Stato attuale, fonti ufficiali, matrice del prototipo contestuale e sequenza `WUL-43` -> `WUL-45` -> `WUL-44` -> `WUL-178` -> `WUL-180` per l'integrazione SISS. |
| Fattibilita SSI/A2A SISS oltre `portal-handoff` | [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) | `CANONICAL` | Boundary ufficiale del filone `WUL-180`: cosa e integrabile davvero con `SSI`, `A2A`, `webapp` e onboarding regionale, e cosa non e ancora dimostrabile con sole fonti pubbliche. |
| Modulo Prescrittivo Regionale | [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md) | `CANONICAL` | Nota scenario-specific `WUL-181`: chiarisce per il prescrittivo il boundary tra handoff, richiamo della webapp ufficiale, uso di WS/API e UI custom non ancora dimostrata. |
| FSE consultazione e consenso | [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md) | `CANONICAL` | Nota scenario-specific che chiarisce per FSE il boundary tra launcher ufficiale, consenso, ruoli/audit, SEB/eventi e viewer/feed embedded non ancora dimostrato. |
| NAR / Anagrafe Regionale read-only | [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md) | `CANONICAL` | Blueprint scenario-specific per lookup assistito, eligibility, esenzioni, medici prescrittori e ricettari in modalita read-only, senza sync o write regionali. |
| SGDT/PAI e COT per MMG/SSI | [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md) | `CANONICAL` | Nota scenario-specific che restringe SGDT ai casi PAI/CE-MMG e COT/transizioni documentati, distinguendoli da launcher generici, feed PAI o dispatch COT non dimostrati. |
| Certificati di malattia | [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md) | `CANONICAL` | Nota scenario-specific che separa Web Application / handoff governato da una UI custom o backend-first non ancora dimostrati. |
| Corpus documentale SISS/FSE | [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md) | `CANONICAL` | Governa `WUL-176` e `WUL-179`: catalogo sorgenti, fetch/sync locale fuori Git, placeholder `manual-import` e report di freshness come base documentale delle integrazioni regionali. |
| Integrazione ATHENA-style Treatment Reasoning | [docs/treatment-reasoning-athena-integration.md](./treatment-reasoning-athena-integration.md) | `SECONDARY / REVIEW-ONLY` | Mappa il percorso locale UI-controller-Fabric-ATHENA/MLX, il runner pre-provisioned, lo smoke sintetico registrato, receipt, provenienza, zero write e limiti di qualita/readiness. |
| Parity operativa MLX benchmark-visible | [docs/mlx-operational-parity.md](./mlx-operational-parity.md) | `SECONDARY / HISTORICAL` | Conserva la baseline `WUL-165` per MLX generico. Nella 0.8.5 la sola eccezione runtime e ATHENA/MLX capability-specific per Treatment Reasoning, come registra il crosswalk corrente. |
| Limitazioni note 0.8.5 | [docs/known-limitations.md](./known-limitations.md) | `CANONICAL` | Registra claim ceiling e residui: rete cloud live, host MCP esterni, microfono reale o validazione clinica. Distingue il fallback AnyDoc dal Fabric `ocr=unavailable` e le evidenze sorgente da quelle di pubblicazione. |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Segue web, native e servizi locali dal dato alla proposta: `home-base` read-only-first con scritture versionate circoscritte, artefatti documentali e guard di revisione shell. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries), inclusi artifact documentali cifrati e boundary `network-home-base`. |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Permette di trovare i `.md` tracciati per argomento e capire quando consultarli; non certifica il runtime. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Contratto design Lume macOS | [docs/design/lume/06-macos-apple-contract.md](./design/lume/06-macos-apple-contract.md) | `CANONICAL` | Contratto Lume per l'app macOS reale e la sua evoluzione in superficie nativa primaria: oggi la card clinica opaca e consegnata, mentre componenti interni e gate visuali restano parziali. La feature parity resta governata dai documenti dedicati. |
| Verify loop e smoke paired mobile home-base | [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | `SECONDARY` | Runbook operativo: gate headless sintetici obbligatori sul boundary di rete e smoke iPhone/iPad opzionale contro `home-base` reale. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondisce componenti, dipendenze e percorsi tecnici, senza prevalere sui contratti canonici. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Offre una sintesi di Clinical Workbench, home-base, documenti, SISS/FSE e presidi locali, separando fotografia 0.8.5 e quadro di pubblicazione 0.8.6. |
| Setup client macOS, TLS locale e click-map | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/parity-click-map-macos.md](./parity-click-map-macos.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL + RUNBOOK` | Materiale operativo nativo. PR #21/`WUL-401` hanno consegnato il tooling P6 di base; prerequisiti operativi e verbale manuale restano in `WUL-481`. |
| Compliance/GDPR/FHIR | [docs/COMPLIANCE.md](./COMPLIANCE.md) | `CANONICAL` | Quadro documentale dei requisiti GDPR/FHIR e delle condizioni di scambio. |
| Manuale utente medico | [docs/MANUALE.md](./MANUALE.md) | `CANONICAL` | Descrive l’uso dal punto di vista del medico, entro le condizioni di impiego del prodotto. |
| ADR native token bootstrap secure-first | [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | `CANONICAL` | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| ADR audit taxonomy minima | [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | `CANONICAL` | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| ADR backup artifact v1 manifest/preflight | [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | `CANONICAL` | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| ADR backup notturno via `launchd` | [docs/adr/0022-nightly-backup-via-macos-launchd.md](./adr/0022-nightly-backup-via-macos-launchd.md) | `CANONICAL` | Thin slice `WUL-30`: schedulazione notturna macOS via LaunchAgent utente e runner headless locale. |
| ADR retention backup keep-last-N | [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | `CANONICAL` | Thin slice `WUL-31`: retention automatica limitata ai backup scheduler-owned con preview dry-run e cleanup tracciato. |
| ADR policy lockout auth | [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | `CANONICAL` | Policy lockout condivisa tra web e macOS: soglia, finestra, durata e contratto errori `401/423`. |
| ADR AI Patient Insight full-auto/manual Pro | [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | `CANONICAL` | Budget configurabili e persistenti per AI Patient Insight, con thin slice limitata a settings UI + runtime builder/generation. |
| ADR native patient insight markdown contract | [docs/adr/0019-native-patient-insight-markdown-contract.md](./adr/0019-native-patient-insight-markdown-contract.md) | `CANONICAL` | Il client macOS salva `aiSummary` in markdown con citazioni, mantenendo compatibilita col consumer web attuale e rinviando l'envelope raw persistito. |
| ADR AI insight source hierarchy and conflict rules | [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md) | `CANONICAL` | Formalizza la gerarchia delle fonti cliniche e le regole di conflitto/fallback per `AI Patient Insight`, gia applicate dal builder corrente. |
| ADR terminology registry locale in settings JSON | [docs/adr/0021-terminology-registry-in-settings-json.md](./adr/0021-terminology-registry-in-settings-json.md) | `CANONICAL` | Registry locale terminologie versionato in `settings`, senza migrazioni, con update admin auditabile e read-path usato da `systems/search/resolve`. |
| ADR web/core stabilization before next version bump | [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | `CANONICAL` | Sequenza di consolidamento web/core prima del prossimo version bump: helper condivisi per patient payload/structured fields, `typecheck` canonico e split incrementale dei god files. |
| ADR SISS local adapter contract and error taxonomy | [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | `CANONICAL` | Foundation locale del filone SISS: azioni tipizzate, error taxonomy stabile, retry transiente e metadata audit redatti prima dell'integrazione UI. |
| ADR boundary integrazione nativa SISS oltre `portal-handoff` | [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | `CANONICAL` | Fissa il boundary `WUL-180`: la vera integrazione nativa SISS/FSE richiede scenari approvati, qualifica/provisioning coerenti col contesto `SSI`, e non puo essere trattata come semplice consumo libero del backend regionale. |
| ADR first slice prescrittivo regionale `webapp-assisted` | [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | `CANONICAL` | Fissa la decisione `WUL-181`: il primo step oltre l'handoff per il prescrittivo usa il percorso ufficiale della webapp regionale e non una UI custom MediFlow. |
| ADR Graphite workbench come unica shell web ufficiale | [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | `CANONICAL` | Decisione storica `WUL-196`, ora superata per la root entry da ADR 0060; resta utile per il principio no-selector. |
| ADR Kree8 cockpit live root entry | [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md) | `CANONICAL` | Fissa `WUL-272`: la root web `/` mostra il cockpit Kree8 direttamente da `Start_MediFlow.command`, senza selector visuale e mantenendo la sicurezza runtime. |
| ADR clinical agenda bridge Zimbra/iCloud | [docs/adr/0061-clinical-agenda-bridge-zimbra-icloud.md](./adr/0061-clinical-agenda-bridge-zimbra-icloud.md) | `CANONICAL` | Fissa `WUL-275`: la cockpit Kree8 puo leggere solo cache evento locali Zimbra/iCloud e mostrare candidati clinici/FBF reviewable, senza import cieco, mail scan o scritture cliniche. |
| ADR dominio prescrizioni prestazioni | [docs/adr/0062-service-prescriptions-domain.md](./adr/0062-service-prescriptions-domain.md) | `CANONICAL` | Fissa `WUL-277`: visite, esami, imaging, riabilitazione e screening prescritti hanno un dominio separato da terapie farmacologiche e protesica. |
| ADR itemizzazione prestazioni e matching repertorio | [docs/adr/0064-service-prescription-itemization-and-catalog-matching.md](./adr/0064-service-prescription-itemization-and-catalog-matching.md) | `CANONICAL` | Fissa `WUL-278`: le prescrizioni di prestazione restano contenitori documentali ma possono avere item figli codificabili e matchabili contro un repertorio locale importato. |
| ADR intended purpose e claims guard clinico | [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md) | `CANONICAL` | Fissa `WUL-279`: registra intended purpose, claim consentiti/esclusi e guard repo-local `check:claims` per prevenire overclaim su AI, SISS/FSE, cloud, diagnosi, triage, prescrizione e automazione. |
| ADR voice visit capture Fluid-style | [docs/adr/0072-voice-visit-capture-fluid-boundary.md](./adr/0072-voice-visit-capture-fluid-boundary.md) | `CANONICAL / PROPOSED` | Conserva il confine storico local-first. La 0.8.5 usa l'implementazione Apple on-device review-first governata da ADR 0113, senza writer clinico automatico. |
| ADR treatment reasoning ATHENA-style | [docs/adr/0073-treatment-reasoning-athena-boundary.md](./adr/0073-treatment-reasoning-athena-boundary.md) | `CANONICAL` | Fissa la lane `mediflow.treatment_reasoning.v1` separata da Smart Import: runtime locale ATHENA/MLX review-only con kill switch fail-closed, trace/report ATHENA-style e zero auto-write clinici. |
| ADR astrazione provider AI e boundary egress | [docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md) | `CANONICAL` | Mantiene il confine tra provider e uscita dei dati. Nella 0.8.5 adapter e probe amministrativa exact-intent OpenAI/Anthropic sono `default OFF` e verificati con transport fake, senza prova di credenziali, rete live o retention. |
| ADR scaffold intelligente e automazione graduata | [docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md) | `CANONICAL` | Decisione `Accepted` post-0.8: separa pipeline locale, proposta, chiarimento, anteprima, autorizzazione e scrittura applicativa registrata. Non modifica il candidato 0.8; inbox conversazionale e automazione graduata restano roadmap. |
| ADR registro delle proposte diagnostiche documentali | [docs/adr/0087-registro-proposte-diagnostiche-documentali.md](./adr/0087-registro-proposte-diagnostiche-documentali.md) | `CANONICAL` | Decisione `Accepted`: schema, migrazione, bootstrap, backup/restore e purge includono la foundation locale separata dalle diagnosi cliniche. Writer, route, UI, transizioni e applicazione restano assenti. |
| ADR router PDF deterministico per pagina | [docs/adr/0088-deterministic-pdf-page-router.md](./adr/0088-deterministic-pdf-page-router.md) | `CANONICAL / SUPERSEDED FOR ATTACHMENT EXTRACTION` | Conserva la decisione storica del router per pagina; ADR 0107 governa il percorso automatico incluso e non autorizza da solo un runtime OCR. |
| ADR limite digest-bound della readiness AI locale | [docs/adr/0092-limite-digest-bound-readiness-ai-locale.md](./adr/0092-limite-digest-bound-readiness-ai-locale.md) | `CANONICAL / ACCEPTED` | Definisce un'annotazione di readiness distinta dallo stato `runtime`; il bracket resta detection best-effort. |
| ADR Lume lingua di design di destinazione | [docs/adr/0078-lume-lingua-di-design-di-destinazione.md](./adr/0078-lume-lingua-di-design-di-destinazione.md) | `CANONICAL` | Decisione `Accepted`: Lume e il canone di destinazione; l'adozione su web e native e progressiva e non equivale alla chiusura L0-L6. |
| ADR attese locali e collegamento prestazione-risultato | [docs/adr/0079-local-open-loops-and-result-link.md](./adr/0079-local-open-loops-and-result-link.md) | `CANONICAL` | Decisione accettata e prima slice web locale consegnata; il registro persistente resta una decisione distinta. |
| ADR contratto export FHIR R4 v0 | [docs/adr/0081-fhir-r4-export-v0-contract.md](./adr/0081-fhir-r4-export-v0-contract.md) | `CANONICAL` | Decisione `Accepted`: fissa matrice di copertura, parità web/native e gate locale esterno per l'export-only v0. Non introduce claim FSE. |
| ADR registro persistente delle attese v0 | [docs/adr/0082-persistent-expectations-register-v0.md](./adr/0082-persistent-expectations-register-v0.md) | `CANONICAL` | Decisione `Accepted`: definisce un registro host-only con provenienza univoca, matching fail-closed e chiusura confermata. Non dichiara runtime consegnato. |
| Closeout evoluzione stack intelligente | [docs/analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md](./analysis/2026-07-12-evoluzione-stack-intelligente-euristiche-scaffold-roadmap.md) | `SECONDARY` | Ricostruisce il consolidamento di scaffold, flusso di controllo, attese e roadmap rispetto a `main` alla data del verbale; non prevale sulle ADR o attesta revisioni successive. |
| ADR ritiro preview profiles funzionali su `main` | [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | `CANONICAL` | Fissa `WUL-199`: il workbench ufficiale non espone piu preview profiles runtime; AI e Smart Import restano live e il contesto paziente SISS diventa stabile nella scheda paziente. |
| ADR architettura shared Apple client e runtime `home-base` packaged | [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | `CANONICAL` | Governa `WUL-188`: core Apple condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come nodo `home-base` autorevole, client mobili paired senza accesso diretto a SQLite e parity non-AI estesa via `/api/v1/network/*`. |
| ADR corpus documentale SISS/FSE locale | [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | `CANONICAL` | Fissa `WUL-176`: prima corpus locale/versionato e fetch/sync controllato, poi eventuale MCP solo sopra un corpus approvato, non scraping live come sorgente primaria. |
| ADR PIN rotation via client-side rewrap | [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | `CANONICAL` | Cambio PIN zero-knowledge: il client riavvolge la stessa master key con un nuovo KEK derivato dal nuovo PIN, senza ricifrare i dati clinici. |
| ADR local-only default e network home-base opt-in | [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md) | `CANONICAL` | Governa `WUL-117`: `local-only` resta il default, `network home-base` diventa una modalita esplicita su LAN fidata, il nodo paired e autorevole solo in modalita network e la first thin slice resta read-only prima di replica/sync. |
| ADR thin slice replica network home-base come snapshot mirror | [docs/adr/0035-network-replica-thin-slice-snapshot-mirror.md](./adr/0035-network-replica-thin-slice-snapshot-mirror.md) | `CANONICAL` | Governa `WUL-120`: la first thin slice di replica resta uno snapshot mirror governato con fallback locale esplicito e manual review, senza introdurre ancora sync record-level o multi-master. |
| ADR thin slice identity network con credenziali nodo e scope esplicito | [docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md) | `CANONICAL` | Governa `WUL-122`: pairing device e login operatore restano separati, l'identita minima riusa i `users` locali del nodo e lo scope clinico `network` viene risolto come `session-context-else-node-default`. |
| ADR boundary auth del primo data plane network read-only | [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md) | `CANONICAL` | Governa `WUL-150`: bootstrap pairing PHI-safe, conferma locale esplicita, credenziale dedicata del device paired e primo accesso read-only ai pazienti che richiede sempre paired client + sessione operatore. |
| ADR nuova anagrafica da documento reviewable | [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | `CANONICAL` | Fissa il create-flow document-driven della nuova anagrafica: review esplicita prima del salvataggio, riconciliazione locale ICD/AIFA e persistenza strutturata solo per le terapie abbastanza confermate. |
| ADR patient import decision contract | [docs/adr/0051-patient-import-decision-contract-between-review-and-persistence.md](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md) | `CANONICAL` | Formalizza la thin slice `WUL-167`: contratto `patient import decision` tra review documentale e apply prudente, distinguendo target `create/merge/review` e write strutturate vs note-only. |
| ADR fallback OCR Apple Vision macOS-only | [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md) | `CANONICAL / SUPERSEDED FOR ATTACHMENT EXTRACTION` | Conserva la pipeline storica, sostituita da AnyDoc come primo passaggio. La 0.8.5 integra Apple Vision localmente sulle sole pagine PDF `needsOcr`; non promuove dati clinici e non dichiara parity OCR multipiattaforma. |
| ADR local evidence absorption layer | [docs/adr/0057-local-evidence-absorption-layer.md](./adr/0057-local-evidence-absorption-layer.md) | `CANONICAL` | Proposed ADR per `WUL-213`: introduce il layer locale di assorbimento/retrieval sopra allegati e diario, senza training, cloud runtime, PHI in repo o auto-write clinici da testo libero. |
| ADR manual evidence reabsorb affordance | [docs/adr/0058-manual-evidence-reabsorb-affordance.md](./adr/0058-manual-evidence-reabsorb-affordance.md) | `CANONICAL` | Proposed ADR per `WUL-220`: definisce una futura affordance manuale e auditabile per riassorbire singole fonti invalidated/superseded senza job opachi, PHI nei log o scritture cliniche strutturate. |

## 🗂️ File sovrapposti o secondari

[docs/product_roadmap.md](./product_roadmap.md) è l’alias storico, **deprecato**, della roadmap;
il riferimento attivo è [docs/ROADMAP.md](./ROADMAP.md). `docs/index.html` rimane una
pagina visuale legacy per consultazione rapida, non il documento su cui
fondare decisioni architetturali.

## ⚙️ Regole rapide di mantenimento

Le decisioni durature appartengono alle ADR e i cambi di direzione prodotto
alla [docs/ROADMAP.md](./ROADMAP.md). Quando un `.md` viene aggiunto, rimosso o
rinominato, va aggiornato l’[docs/markdown-index.md](./markdown-index.md); se cambia il
riferimento autorevole di un tema, va aggiornata questa mappa. In caso di
contrasto prevale il documento canonico indicato, nel proprio ambito.

Per ChatGPT, [ADR 0126](./adr/0126-chatgpt-account-control-plane.md) governa il controllo account senza inferenza e
[ADR 0134](./adr/0134-chatgpt-subscription-synthesis-execution.md) il percorso di esecuzione distinto, con decisioni candidate
e gate di ammissione: le sue prove vanno lette per data e revisione.
[ADR 0135](./adr/0135-native-ai-configuration-authority.md) riguarda configurazione AI nativa e grant dell’host, non
un’autorizzazione implicita derivata dall’account.

## Isolamento del launcher dei test Node

[ADR 0130](./adr/0130-node-test-data-dir-preflight.md) stabilisce il preflight MEDIFLOW_DATA_DIR per
scripts/run-strip-types.mjs --test e attribuisce la responsabilità del
cleanup delle fixture. La separazione del percorso di test evita di
confondere i suoi dati con quelli dell’applicazione.
