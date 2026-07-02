# Indagine esplorativa esterna: ecosistema, standard, AI locale, OSS sanitario, sync, sostenibilita

Data: 2026-07-02. Eseguita da Codex gpt-5.5 (reasoning high, ricerca web con citazioni) su mandato di Claude Fable 5,
a supporto di docs/analysis/2026-07-02-orizzonte-mediflow-1-2-5-anni.md. Ogni affermazione e marcata FATTO o STIMA.
Limite dichiarato: nessuna verifica su portali regionali autenticati o stato di produzione FSE oltre fonti pubbliche.

---

**1. Standard E Normativa**
Fatti:
- EHDS e in vigore dal 26 marzo 2025, ma l’applicazione e graduale: atti attuativi entro marzo 2027, patient summary e ePrescription/eDispensation da marzo 2029, immagini/referti/lab/discharge da marzo 2031, terzi paesi per HealthData@EU dal 2035. Questo e FATTO. ([health.ec.europa.eu](https://health.ec.europa.eu/ehealth-digital-health-and-care/european-health-data-space_en))
- EHDS introduce criteri di sicurezza/interoperabilita e self-certification per sistemi EHR immessi sul mercato UE. Questo non significa che ogni tool locale debba diventare subito “certificato”, ma i sistemi EHR commercializzati come tali dovranno rispettare componenti armonizzati. FATTO. ([health.ec.europa.eu](https://health.ec.europa.eu/ehealth-digital-health-and-care/european-health-data-space_en))
- FSE 2.0 Italia e ancora un cantiere tecnico-operativo: il repo pubblico ministeriale `it-fse-support` espone documentazione GTW, validazione CDA, mock pubblicazione, accreditamento, certificati x509, cataloghi e API provisioning. FATTO. ([github.com](https://github.com/ministero-salute/it-fse-support))
- FHIR R4 resta la base piu stabile e adottabile: HL7 lo descrive come R4 v4.0.1, misto normative/STU, mentre R5 v5.0.0 e current published ma ancora STU. FATTO. ([hl7.org](https://hl7.org/fhir/R4/)) ([hl7.org](https://hl7.org/fhir/R5/index.html))
- HL7 Italia e il soggetto nazionale di localizzazione e coordinamento degli standard HL7 nella realta italiana. FATTO. ([hl7.it](https://www.hl7.it/))

Lettura 1/2/5 anni:
- 1 anno: export FHIR R4, CDA/PDF-FSE validation, terminology registry e audit sono piu utili di integrazioni regionali profonde.
- 2 anni: prepararsi agli atti EHDS 2027 e ai profili italiani, ma senza anticipare claim.
- 5 anni: rischio taglio fuori se MediFlow non sa esportare/importare dati base in formato standard europeo o nazionale.

Implicazione per MediFlow:
- Necessario: export/import FHIR R4, bundle documentale CDA/PDF dove richiesto, mapping terminologie, audit, provenance, data portability.
- Evitabile ora: certificazione EHR piena, writeback FSE/SISS, prescribing regionale, canale SSI/A2A proprietario. Coerente con ADR 0065: handoff o webapp-assisted finche non esiste canale qualificato.

**2. Traiettoria AI Locale**
Fatti:
- Apple ha pubblicato un modello on-device di circa 3B parametri, ottimizzato con quantizzazione 2/4 bit e KV-cache su Neural Engine; dichiara circa 30 token/s su iPhone 15 Pro per quel modello. FATTO. ([machinelearning.apple.com](https://machinelearning.apple.com/research/introducing-apple-foundation-models))
- Apple ha introdotto Foundation Models framework per sviluppatori nella generazione successiva di Apple Intelligence. FATTO. ([machinelearning.apple.com](https://machinelearning.apple.com/research/introducing-apple-foundation-models))
- Gemma 3n e progettato per telefoni, laptop e tablet, con input testo, audio e visione; usa PLE caching, MatFormer e parameter skipping, con E2B che puo girare con carico effettivo circa 1.91B parametri. FATTO. ([ai.google.dev](https://ai.google.dev/gemma/docs/gemma-3n))
- Le NPU consumer Windows sono entrate nella soglia Copilot+ 40 TOPS, con generazioni successive pubblicamente descritte fino a 80 TOPS. FATTO ma hardware-specifico e non garanzia di supporto software clinico. ([wired.com](https://www.wired.com/story/what-is-copilot-plus-pc?utm_source=openai)) ([windowscentral.com](https://www.windowscentral.com/hardware/qualcomm/snapdragon-x2-elite-vs-x-elite?utm_source=openai))

Lettura 1/2/5 anni:
- 1 anno: OCR, classificazione documento, estrazione sezioni, riassunto citato e dedup su modelli 1-4B saranno realistici su hardware 500-1500 euro.
- 2 anni: multimodale locale piccolo diventa pratico: PDF immagine, audio breve, visita dettata, triage documentale non diagnostico.
- 5 anni: molte capability oggi cloud-only per documenti ordinari diventeranno locali: extraction, summarization, entity linking, structured draft. Non diventera automaticamente affidabile la decisione clinica autonoma.

Implicazione per MediFlow:
- La linea interna e giusta: AI locale assistiva, evidence-first, review-first.
- Per low-resource: prevedere profili degradati. Hardware vecchio: OCR/testo + regole + modelli 1-2B. Hardware medio: 3-8B per sintesi e import. Hardware Apple moderno: Foundation Models o MLX come provider opzionale, mai default non verificato.

**3. Panorama OSS Sanitario**
Fatti:
- OpenMRS dichiara 8000+ strutture, 70+ paesi e 15 milioni di patient records; ha REST/FHIR API e forte adattabilita locale. FATTO. ([openmrs.org](https://openmrs.org/))
- OpenEMR e open source, ONC certified, copre practice management, e-prescribing, billing, lab integration, clinical decision rules, multilingua e on-premises/cloud. FATTO. ([open-emr.org](https://www.open-emr.org/))
- GNU Health si presenta come ecosistema libero di salute digitale e medicina sociale, con adozioni in paesi diversi e riconoscimenti DPGA/GNU/FSF. FATTO. ([gnuhealth.org](https://www.gnuhealth.org/))
- Bahmni e un EMR/HMIS per low-resource settings, integra OpenMRS, OpenELIS, OpenERP/Odoo, DICOM/PACS, e dichiara 500+ siti in 50+ paesi; puo essere ospitato in ospedale senza dipendenza da Internet. FATTO. ([bahmni.org](https://www.bahmni.org/))
- DHIS2 e una piattaforma open source usata in piu di 80 paesi, con cattura dati anche quando la connettivita e limitata, ma e piu HMIS/programmatic data che cartella clinica individuale da singolo medico. FATTO. ([dhis2.org](https://dhis2.org/))

Lettura 1/2/5 anni:
- 1 anno: nessuno di questi copre perfettamente “singolo medico, zero-infrastruttura, UX moderna, AI locale, single-binary”.
- 2 anni: OpenMRS/Bahmni continueranno forti su programmi e ospedali low-resource; OpenEMR su ambulatorio completo ma piu pesante.
- 5 anni: vinceranno i progetti con governance, formazione, implementatori locali e moduli standard, non solo buon codice.

Implicazione per MediFlow:
- Lacuna reale: “personal clinical workstation” locale, cifrata, installabile da un medico senza server, con document intelligence locale e distribuzione desktop.
- Cosa imparare: community e implementer network contano piu delle feature; i sistemi low-resource vincono quando accettano workflow locali, formazione, traduzioni, hosting semplice e ownership del dato.

**4. Sync E Resilienza Offline**
Fatti:
- Automerge e un sync engine local-first CRDT: offline, merge consistente, storia locale, rete agnostica, backend opzionale. FATTO. ([automerge.org](https://automerge.org/))
- Yjs e un CRDT ad alte prestazioni per app collaborative; e network-agnostic e non richiede una fonte centrale di verita per il merge, anche se scalare backend collaborativi resta non banale. FATTO. ([docs.yjs.dev](https://docs.yjs.dev/))
- Electric e PowerSync puntano piu su sync database-oriented: Electric usa HTTP/JSON e Postgres streams; PowerSync mantiene SQLite client-side, offline-first, con write locali accodati verso backend API. FATTO. ([electric-sql.com](https://electric-sql.com/)) ([powersync.com](https://www.powersync.com/))
- PowerSync e simili non risolvono da soli E2EE clinico, semantica conflitti, audit, consenso, schema migrations e responsabilita medico-legale. Questa e STIMA tecnica basata sui loro contratti pubblici.

Lettura 1/2/5 anni:
- 1 anno: CRDT buoni per note collaborative, drafts, task, evidence annotations. Non per tutto il DB clinico.
- 2 anni: sync SQLite con server locale/home-base sara maturo per cache, read replica e write queue esplicita.
- 5 anni: multi-device cifrato senza server centrale sara possibile, ma richiedera semantica per dominio, non “CRDT ovunque”.

Implicazione per MediFlow:
- La strada giusta e il flusso invertito home-base-first gia deliberato: Mac autorevole, client cache, write versionati, conflitti espliciti.
- CRDT va sperimentato su document annotations, draft visita, task locali. Overengineering se applicato subito a pazienti, terapie, audit o prescrizioni.

**5. Sostenibilita OSS Altruistica**
Fatti:
- OpenMRS mostra modello community + partner + eventi + funding; dichiara che sostenere l’infrastruttura comunitaria richiede risorse significative. FATTO. ([openmrs.org](https://openmrs.org/))
- OpenEMR espone il problema certificazione come campagna di funding, con fondazione e vendor/supporto professionale. FATTO. ([open-emr.org](https://www.open-emr.org/))
- DHIS2 e sostenuto da HISP/Universita di Oslo, rete regionale, academy, capacity building e partner internazionali. FATTO. ([dhis2.org](https://dhis2.org/))
- Automerge cita sponsorship, support contracts, feature funding e fondi filantropici. FATTO. ([automerge.org](https://automerge.org/))

Lettura 1/2/5 anni:
- 1 anno: sostenibilita minima = release ripetibili, docs in italiano/inglese, installer, backup, import/export, issue triage.
- 2 anni: serve una micro-governance: maintainer clinico, contributor guide, security policy, advisory board leggero.
- 5 anni: se MediFlow diventa utile, arriveranno fork commerciali e richieste compliance. Rischio alto di bus factor e scope creep.

Implicazione per MediFlow:
- Non puntare subito a fondazione pesante. Puntare a “bene pubblico installabile”: Homebrew, winget, GitHub Releases firmate, manuale medico, dataset sintetici, traduzioni, grants UE/salute digitale, partner universitari.
- Mantenere MIT e local-first aiuta adozione, ma richiede marchio, governance dei claim e test di export per evitare cattura commerciale opaca.

**Convergenze E Divergenze Con La Visione Interna**
- Convergenza forte: EHDS/FSE spingono interoperabilita, portability, audit e patient access. MediFlow punta gia su OpenAPI, FHIR R4, terminologie, evidence ledger e no cloud default.
- Convergenza forte: AI locale piccola e multimodale sta diventando reale. La strategia “assistiva, locale, review-first” e piu robusta dei claim cloud-first.
- Convergenza forte: low-resource OSS di successo richiede adattabilita, offline, local ownership e community.
- Divergenza/rischio: EHDS potrebbe classificare piu software come EHR system con obblighi di conformita. MediFlow deve chiarire posizionamento: personal workbench local-first, non piattaforma EHR certificata, finche non sceglie quel percorso.
- Divergenza/rischio: Windows/Linux parity non puo dipendere da Apple Vision o Foundation Models. Serve OCR/provider abstraction con fallback espliciti.
- Divergenza/rischio: CRDT completo puo sedurre ma spostare MediFlow da “cartella clinica affidabile” a “sistema distribuito fragile”. Restare domain-versioned.
- Divergenza/rischio: altruismo OSS senza struttura genera bus factor. Servono processi e distribuzione piu di nuove feature.

**Spike Esplorativi Concreti**
1. `FHIR R4 export v0`: esporta Patient, Condition, MedicationStatement, Observation, Encounter da fixture sintetiche.
2. `FSE GTW dry-run`: validazione locale CDA/PDF su esempi ministeriali, senza pubblicazione.
3. `Terminology manifest`: registry locale versionato per ICD-11, AIC/ATC, LOINC/UCUM, SNOMED subset.
4. `Provider AI matrix`: Ollama, MLX, Apple Foundation Models, Gemma 3n, profili 1B/3B/8B con benchmark documenti sintetici.
5. `Low-resource profile`: modalità “PC vecchio” con OCR/text extraction, no model grande, import manuale guidato.
6. `CRDT annotation lab`: Automerge/Yjs solo per note evidenza e draft visita, non DB clinico.
7. `PowerSync/Electric LAN PoC`: replica read-only SQLite-derived con home-base locale, misurando conflitti e cifratura.
8. `OSS installer path`: Homebrew cask + winget manifest + GitHub Release firmata per demo synthetic-only.
9. `OpenMRS/Bahmni bridge memo`: mapping di cosa integrare via FHIR/export e cosa non duplicare.
10. `Governance lite`: CODEOWNERS, security advisory, maintainer policy, trademark/claim policy, roadmap pubblico bilingue.

Verifica: ho letto i documenti repo richiesti e la mappa canonica; non ho modificato file. Non ho verificato portali regionali autenticati o stato reale di produzione FSE oltre fonti web pubbliche.


