# Evoluzione dello stack intelligente: euristiche, scaffold provider, roadmap

Data: 2026-07-12. Metodo: tre lane di censimento GPT-5.6 Terra in sola lettura
(euristiche vs LLM, scaffold runtime, delta rispetto alla revisione del
2026-07-02) piu lettura diretta di ADR, governance e codice runtime. Ogni claim
di stato porta un riferimento file:riga verificato sul codice, non sui
documenti. Documento gemello architetturale:
[ADR 0074](../adr/0074-ai-provider-abstraction-and-egress-anonymization-boundary.md).

Documenti correlati, non duplicati qui: la revisione operativa dello stack
(docs/analysis/2026-07-02-revisione-stack-intelligente-documentale-e-serving.md),
l'orizzonte di prodotto 1/2/5 anni
(docs/analysis/2026-07-02-orizzonte-mediflow-1-2-5-anni.md), il boundary
treatment reasoning (docs/adr/0073-treatment-reasoning-athena-boundary.md).

---

## Parte 0: sintesi esecutiva

1. **Lo stack ha gia tre piani distinti e funzionanti**: euristiche
   deterministiche (oltre venti regole censite, dal router di classe al
   ranking ICD/AIFA), lane LLM locali governate (sei call-site, cinque con
   kill switch), governance benchmark-first (parliament, readiness, guard).
   Il problema non e l'assenza di struttura: e che i tre piani non si parlano
   dove dovrebbero.
2. **Il router deterministico e ancora un consulente, non un decisore**: la
   sintesi chiama il modello prima di consultare il router
   (document-synthesis-service.ts:99-104). Il 55-60% dei documenti reali,
   gia classificabile senza AI, paga ancora il costo del modello.
3. **Ollama non e piu l'unico runtime, ma lo scaffold finge di si**: con
   ATHENA (ADR 0073) un secondo runtime MLX e entrato nel runtime clinico
   come adapter su misura; `AIProvider = 'ollama'` resta un tipo a un solo
   valore e `aiProvider` una chiave semimorta che la UI non legge ne scrive
   (use-ai-settings-controller.ts fissa 'ollama'). L'astrazione provider non
   e piu un lusso: e il riconoscimento di uno stato di fatto.
4. **La governance ha due buchi concreti**: il ruolo `ocr` e fuori dal
   rollout guard e senza kill switch (unica lane LLM scoperta); il kill
   switch del treatment reasoning esiste ma manca dal registry di
   write-policy e dal readiness endpoint.
5. **Il confine cloud oggi e ideologico, domani deve essere strutturale**:
   il comparatore shadow (ADR 0039) resta l'unico contatto col cloud, fuori
   runtime. La strada onesta per un assist cloud opzionale passa da un
   egress gate fail-closed con redazione a due layer; il layer neurale non
   ha ancora un modello promosso (OpenMed resta benchmark-only con leak
   rate email/mailbox alto; GLiNER2-PII e il candidato da misurare).
6. **Le euristiche fantasma della revisione di luglio restano quasi tutte da
   costruire**: parser ricetta SSN, parser referto lab, fact kind
   `lab_result`, AcroForm, merge OCR per pagina. Nel frattempo getMetadata e
   il decision plan dell'autofill sono stati chiusi: il dossier del 2 luglio
   e superato su quei punti.
7. **La robustezza runtime ha quattro aperture note e piccole**: niente
   `num_ctx`, riparazione JSON silenziosa senza flag di troncatura,
   JSON.parse non protetto sull'artifact parliament, proxy senza streaming.
8. **La direzione lunga e la distillazione**: il ciclo gia scritto in ADR
   0039 (osserva il modello migliore, astrai il pattern, scrivi euristica o
   benchmark locale) e il seme del punto di arrivo a dieci anni, dove
   l'intelligenza si sposta a tempo di build e il runtime resta
   deterministico e verificabile.
9. **L'intelligenza che manca di piu non e un modello: e la chiusura degli
   anelli di lavoro**. Una prescrizione di esami non puo oggi ricevere i
   suoi risultati (nessun collegamento in schema tra
   service_prescription_items e observations, verificato); una serie di
   osservazioni interrotta non genera nessun richiamo. Sono proiezioni
   deterministiche sui dati gia strutturati, gradino 1-2 della scala, zero
   LLM: la Parte 2.1 le tratta come filone a pieno titolo.

---

## Parte 1: la fotografia di oggi

### 1.1 Il piano deterministico

Il censimento completo conta oltre venti famiglie di regole. Le portanti:

| Area | Regola | Evidenza | Fragilita principale |
|---|---|---|---|
| Router classe documento | filename, poi Producer, poi testata; sempre una classe con confidence e rationale | document-class-router.ts:46-218 | tabelle compilate, corpus lombardo, non configurabili |
| Identity resolution | CF con checksum, ruolo per prossimita a label | document-identity-resolution.ts:25-163 | solo pattern italiani, finestra 90 char fissa |
| Low-signal OCR | soglia 24 char, burst whitespace | ocr-service.ts:99-115 e duplicati | soglia replicata in 3 moduli |
| Selezione pagine OCR | scoring lunghezza + keyword clinica | pdf-service.ts:398-435 | pesi e limite 6 pagine non tracciati in provenance |
| Decision layer | blocchi su OCR pendente, identity ambigua, evidence mancante | document-decision.ts:492-688 | il migliore della casa: reason code e provenance esemplari |
| Ranking ICD/AIFA | cutoff 8 e 7, bonus dose/nome | patient-smart-import-matching.ts:253-603 | soglie senza calibrazione dichiarata |
| Evidence pack | fact tipizzati, soppressioni negazione/storico | document-evidence-pack.ts:91-435 | priorita e limiti hardcoded |
| Contratti AI | riparazione JSON, marker modello, confidence default | ai-task-contracts.ts:142-830 | ripara in silenzio, default `medium` |

La lezione trasversale: le euristiche buone ci sono, ma vivono come costanti
TypeScript. Manca il passo che le renda dati configurabili con provenance,
cosi da non ripetere il pattern "regole solo italiane" quando il corpus si
allarghera.

### 1.2 Il piano LLM

Sei call-site, tutti local-first:

| Lane | Ruolo | Kill switch | Fallback deterministico |
|---|---|---|---|
| Patient Insight | clinical | si | skip su hash contesto invariato, markdown fallback |
| Smart Import | clinical | si | post-processing ICD/AIFA deterministico |
| Document Synthesis | reasoning | si | degradazione output, nessun bypass per classe |
| OCR | ocr | **no** | low-signal, parser regex a valle |
| Treatment Reasoning | ATHENA MLX + fallback reasoning | si (doppio) | fail-closed su envelope vuoto, review-only |

Due osservazioni che valgono piu del censimento stesso. La prima: il punto
dove il confine euristica/AI e gia disegnato bene e Smart Import, dove il
modello estrae dal narrativo e il ranking deterministico decide il match
(patient-smart-import-matching.ts:253-274): il LLM propone, la regola
promuove. La seconda: il punto dove il confine e invertito e l'anagrafica
PDF, dove si tenta prima l'AI e poi le regex (pdf-service.ts:531-628),
quando CF e data di nascita sono esattamente il caso in cui la regex deve
correre prima e l'AI riempire i buchi.

### 1.3 Il piano di governance

Parliament, rollout readiness, kill switch fail-closed con factory condivisa,
claims guard in CI. E l'asset piu distintivo dello stack: nessun modello e
nessuna lane si promuove per intuizione. I buchi attuali sono di copertura,
non di disegno: ruolo `ocr` fuori dal guard (ai-rollout-model-guard.ts:26),
OCR senza kill switch, `aiTreatmentReasoningKillSwitch` assente dal registry
write-policy (settings-write-policy.ts:45) e dal readiness endpoint, guard
parity MLX rotto (check-mlx-operational-parity.mjs richiede un file Swift
assente; un fix affine e in volo su wul-478).

---

## Parte 2: dove serve euristica, dove serve AI

La regola di casa, resa esplicita come scala a cinque gradini. Si sale di
gradino solo quando quello sotto fallisce in modo misurato, e ogni gradino
porta provenance e reversibilita:

1. **Parser deterministico** quando la struttura e nota (template FOP,
   tabelle lab, AcroForm, MRZ): output citabile, costo zero, nessuna
   allucinazione possibile.
2. **Euristica configurabile** quando serve giudizio locale su segnali
   (router di classe, low-signal, ranking): regole come DATI con soglie
   dichiarate, non costanti sparse.
3. **Modello piccolo locale** quando il testo e narrativo ma il task e
   chiuso (NER PII, classificazione, estrazione contrattuale compatta): il
   fine-tune in-house su corpus distillati e la traiettoria (S11).
4. **Modello grande locale** quando serve comprensione trasversale
   (sintesi, insight, reasoning terapeutico): sempre dietro contratto,
   kill switch e review-first.
5. **Cloud dietro egress gate** solo per i casi che il gradino 4 fallisce e
   che il medico sceglie esplicitamente di elevare: mai default, mai
   silenzioso, mai senza redazione promossa (ADR 0074).

Applicata al censimento, la scala produce tre correzioni di rotta immediate:

- **Promuovere il router a decisore** (S3 control-flow): le classi a
  estraibilita deterministica saltano il gradino 4 invece di pagarlo sempre.
- **Invertire l'ordine sull'anagrafica PDF**: regex prima, AI a completare.
- **Dare corpo ai gradini 1 mancanti**: parser ricetta SSN e referto lab con
  fact kind `lab_result`, che oggi collassa in prosa cio che dovrebbe
  diventare osservazioni strutturate con range.

E una correzione di metodo: le euristiche promosse dal gradino 2 in su
devono lasciare traccia in UI. Il censimento elenca decisioni oggi mute
(classe senza rationale nel pannello, pagine OCR scelte senza trace, hint di
normalizzazione non persistiti): ogni decisione silenziosa e debito di
fiducia verso il medico.

### 2.1 La micro-intelligenza dei flussi: gli anelli da chiudere

L'intelligenza percepita dal medico non coincide con i modelli: spesso e la
capacita dell'applicazione di conoscere la forma del lavoro clinico e di non
lasciare anelli aperti. Il principio: **ogni artefatto clinico crea
un'attesa; l'attesa ha una finestra; il sistema mostra le attese aperte e
chiede i dati che mancano**. Sono proiezioni deterministiche sui dati gia
strutturati (gradino 1-2 della scala), review-first e citabili, senza alcun
modello di mezzo.

Gli anelli concreti, in ordine di leva:

1. **Prescrizione esami, poi risultati collegati**. Il dominio prescrizioni
   di prestazione esiste con item codificabili (ADR 0062/0064,
   service_prescription_items in lib/schema.ts:232-235), le osservazioni
   esistono con range e trend; ma NON esiste alcun collegamento tra i due
   (verificato: nessun observationId/prescriptionId incrociato in schema).
   L'anello minimo: dall'item prescritto una CTA "inserisci risultati" che
   apre il form osservazioni precompilato e collega le misure all'item; il
   match item-osservazione e deterministico quando l'item e codificato
   (stesso pattern del catalog matching ADR 0064), sempre con conferma
   dell'operatore (ADR 0057).
2. **Serie interrotta, richiamo proattivo**. Se un parametro ha una
   traiettoria (2+ misure) e la cadenza osservata si interrompe, la Scheda
   mostra una riga "ultima misura X, attesa da Y" con CTA di inserimento.
   La cadenza attesa si deriva dai dati (intervallo mediano osservato) o
   dalla prescrizione che l'ha generata; mai un giudizio clinico inventato,
   solo un fatto verificabile sul calendario.
3. **Prescrizione scaduta senza esito**. Item prescritto oltre la finestra
   senza risultati collegati: riga nella coda di revisione, "prescritto il
   GG/MM, nessun risultato inserito". E il gemello amministrativo
   dell'anello 1.
4. **Follow-up documentati** (gia in campo con S6:
   lib/patient-followup-projection.ts) e **riconciliazione farmaci
   documenti-terapie** (in roadmap): stessi principi, stessa superficie.

Architettura proposta, volutamente minima: un **registro delle attese**
tipizzato (sorgente, tipo, finestra, stato, riferimento all'artefatto che
l'ha creata), alimentato dai domini esistenti e proiettato in Scheda e
cockpit con provenance esplicita. Nessuna tabella di conoscenza clinica
cablata: le attese nascono solo da cio che il medico ha gia inserito
(prescrizioni, serie, documenti), quindi il sistema chiede, non suggerisce
terapia. Il registro e anche il punto dove, a tendere, le lane AI potranno
depositare attese proposte (sempre marcate come tali), senza cambiare la
superficie.

## Parte 3: lo scaffold provider

La decisione architetturale completa e in ADR 0074. Qui il perche in tre
fatti verificati:

1. `AIProvider = 'ollama'` e un tipo a un solo valore (ai-service.ts:4), ma
   il runtime reale e gia eterogeneo: ATHENA MLX serve il treatment
   reasoning via route server (athena-mlx-runtime.ts), Apple Vision copre
   l'OCR su macOS, e i benchmark hanno gia un adapter Ollama/MLX
   (scripts/local-chat-runtime.ts:43-69) che distingue i due protocolli.
2. La chiave `aiProvider` e semimorta: la legge solo la migrazione modelli e
   il summary di rete; la UI la fissa a 'ollama' senza leggerla.
3. Le assunzioni Ollama sono sparse in almeno quattro strati (servizio,
   proxy, contratti, tipi di rete), con euristiche URL duplicate e proxy
   gemelli ad auth incoerente.

Lo scaffold (ProviderAdapter con kind local/lan/cloud, registry nelle
impostazioni, binding per ruolo) non aggiunge una feature: riconosce e
ordina uno stato di fatto, e apre tre porte gia richieste dalla visione:
runtime openai-compatible locali per i profili hardware bassi e la parita
Windows/Linux, il runtime LAN di ADR 0037, e l'assist cloud opzionale
dietro il gate della Parte 4.

## Parte 4: anonimizzazione ed egress

Lo stato reale, senza wishful thinking:

- L'unico contatto col cloud e il comparatore shadow fuori runtime
  (scripts/cloud-comparator-shadow-eval.ts, `store:false`, gate privacy a
  quattro flag, case pack fuori Git). La sua domanda guida resta giusta:
  non "come portiamo il cloud dentro", ma "cosa impariamo per lo stack
  locale".
- La redazione neurale non ha un modello promosso: OpenMed misurato e fermo
  a benchmark-only (leak rate email/mailbox 0.556-0.833 sui corpora
  sintetici); GLiNER2-PII e il candidato successivo, non ancora misurato.
- Esiste gia una lane runtime OpenMed opzionale (lib/openmed-redaction.ts,
  /api/system/redaction) ma senza layer regex deterministico davanti.

L'architettura decisa (ADR 0074): egress gate unico fail-closed, layer 1
deterministico in-house obbligatorio (CF, NRE, TEAM, nosologico etichettato,
contatti, nomi noti dall'anagrafica locale), layer 2 neurale vincolato ai gate ADR
0033, pseudonimizzazione coerente con mappa di reidratazione solo in RAM,
minimizzazione per envelope, audit locale append-only senza contenuti.
Finche il layer 2 non e promosso, il gate e chiuso per costruzione: il
local-first smette di essere difeso dall'assenza di alternative e viene
difeso da un confine verificabile.

---

## Parte 5: roadmap

### Oggi (questa settimana, in gran parte in questa PR)

| # | Intervento | Stato |
|---|---|---|
| O1 | ADR 0074 + questo documento | in questa PR |
| O2 | Scaffold slice 1: OllamaAdapter estratto, facade invariata, OCR dentro la factory, URL heuristics unificate, test | in questa PR |
| O3 | Governance: guard esteso a `ocr`, kill switch OCR, treatment reasoning registrato in write-policy e readiness | in questa PR |
| O4 | Egress gate scheletro: layer 1 deterministico + stato `closed_pending_redaction_lane` + audit, senza alcun provider cloud | in questa PR |
| O5 | Igiene: ai-engine.ts e ai-prompts.ts orfani rimossi, proxy generico senza caller rimosso, num_ctx governato, flag troncatura JSON, parse artifact protetto | in questa PR |
| O6 | Benchmark GLiNER2-PII sul corpus redaction esistente | fuori sessione, richiede download modello |

Non in questa PR, gia in volo altrove: split prompt contratti (wul-491),
parity guard MLX (wul-478), superfici demo cockpit.

### Domani (1-3 mesi)

1. **S3 control-flow**: il router decide; le classi deterministiche saltano
   il modello; AcroForm a field-map; merge OCR per pagina con motivo coda
   `mixed_text_and_scan`. Da verificare con preview su documenti reali.
2. **Parser gradino 1**: ricetta SSN e referto lab, fact kind `lab_result`
   agganciato ai range Observation gia in schema.
3. **Adapter openai-compatible locale**: promozione del pattern benchmark a
   runtime; unifica MLX/ATHENA, LM Studio, llama.cpp; primo passo concreto
   dei profili hardware per la parita tri-OS.
4. **Redaction lane a due layer**: regex layer 1 subito davanti alla lane
   OpenMed esistente; GLiNER2-PII a benchmark e, se passa, shadow.
5. **Settings provider**: registry visibile in Modelli, binding per ruolo,
   capability-based (pull solo dove esiste).
6. **Streaming e coda job AI**: streaming prima sulla lane che ne beneficia
   di piu (dettatura quando arriva, insight poi); coda in-process per i job
   pesanti co-residenti.
7. **Anello prescrizione-risultato + registro attese v0** (Parte 2.1):
   collegamento item prescritto-osservazioni con conferma, riga "risultati
   da inserire" in Scheda, richiamo sulle serie interrotte. Zero LLM, tutto
   dominio: e il filone dove l'intelligenza percepita cresce piu in fretta
   per sforzo speso.

### Un anno

1. **Fine-tune compatto in-house** (S11): distillazione dal vault ADR 0032
   redatto verso un estrattore 1.7-4B per smart_import e classificazione;
   sblocca i profili hardware bassi con qualita misurata, non promessa.
2. **Profili hardware dichiarati**: lite (regole + OCR + modello piccolo),
   medio (3-8B), alto (35B MoE); ogni profilo dice cosa perde, in UI.
3. **Assist cloud opzionale operativo**, solo se la redaction e promossa:
   per-caso, review-first, badge di provenienza, audit; il medico eleva il
   singolo documento difficile, mai il flusso.
4. **Voice/STT** come da filone dedicato (dettatura review-first, lane
   benchmark con WER su farmaci e dosaggi), dentro lo scaffold provider
   (ruolo `stt`).
5. **Il corpus come prodotto interno**: vault permanente, benchmark di
   router e parser con label dal filename, `_DA_TRIAGE` come suite e2e
   dell'ingestion, phiSafety reale al posto dei tre `false` hardcoded.
6. **Estrazione ancorata FHIR**: i fact dell'evidence layer mappabili su
   risorse FHIR R4 (Condition, MedicationStatement, Observation), cosi
   l'export interoperabile (frontiera F3) nasce dai dati gia strutturati.

### Dieci anni

Qui si sogna, ma con la traiettoria gia visibile nel codice di oggi.

1. **Il modello diventa commodity, lo scaffold resta**: se la traiettoria
   hardware/modelli regge, un laptop economico fara girare localmente
   qualita da frontier di oggi. A quel punto il valore difendibile di
   MediFlow non e il modello: sono i contratti, i benchmark, il corpus, i
   guardrail e la provenance. Ogni ora spesa oggi su questi asset e un
   investimento che nessun salto di modello svaluta.
2. **L'intelligenza si sposta a tempo di build**: il ciclo di distillazione
   (ADR 0039) portato alle conseguenze: i modelli migliori, anche cloud,
   lavorano offline per proporre regole, parser e casi di benchmark; la
   governance li valida; il runtime clinico esegue soprattutto artefatti
   deterministici verificabili. L'AI scrive euristiche, il runtime esegue
   euristiche. E la risposta strutturale al problema della fiducia.
3. **Il collega instancabile**: modello longitudinale del paziente calcolato
   on-device, richiami proattivi (follow-up scaduti, interazioni, derive
   dai range) serviti come proiezioni del layer evidenze, sempre citabili e
   review-first. La proattivita e una vista sui dati, non un agente che
   agisce.
4. **Federazione di conoscenza, non di dati**: ambulatori che condividono
   regole, benchmark, pesi distillati e pattern anonimi di validazione, mai
   record. I dati non viaggiano; viaggia cio che si e imparato, verificato
   dalla stessa governance benchmark-first.
5. **Infrastruttura civica**: la frontiera F6 dell'orizzonte resta quella
   decisiva: governance che sopravvive al fondatore, localizzazione come
   missione, distribuzione resiliente offline. A dieci anni il successo non
   e una feature: e un medico che non abbiamo mai conosciuto, su hardware
   che non abbiamo mai testato, che si fida dello stack perche ogni
   decisione mostra la sua fonte.

Anti-obiettivi invariati a ogni orizzonte: mai motore diagnostico autonomo,
mai cloud obbligatorio, mai promozione senza benchmark, mai claim oltre
l'evidenza (ADR 0065 e per sempre).

---

## Appendice: metodo e limiti

- Censimento eseguito da tre lane GPT-5.6 Terra in sola lettura sul
  worktree principale; durante l'audit il worktree condiviso e passato dal
  branch main a docs/design-review-vetro-clinico (delta solo docs/design),
  quindi l'evidenza su lib/ e app/ resta valida per main a 6a8a3e7fd.
- Le tabelle di questo documento sintetizzano i report di lane; i claim
  file:riga sono stati verificati dalle lane leggendo il codice. Le righe
  possono derivare con i prossimi merge: fa fede il codice.
- Non verificato in questa sessione: benchmark GLiNER2-PII (richiede
  download modello), stato Linear dei filoni voice, numeri del corpus
  privato (vault fuori Git per policy ADR 0032).
