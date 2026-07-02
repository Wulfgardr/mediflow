# Revisione stack intelligente: documentale, serving schede, modelli locali, audio

Data: 2026-07-02. Metodo: workflow multi-agente (7 mappe parallele sui sottosistemi, 4 analisi incrociate, 4 verifiche avversariali con lettura del codice e ricerca web). Il corpus reale `01_Sanita_Personale` (389 PDF, 897 pagine, 125 cartelle paziente) e stato censito localmente con `pdfinfo`/`pdftotext` piu 17 PDF letti pagina per pagina. Nessun identificativo personale del corpus e riportato qui: solo aggregati e pattern. Le correzioni emerse in verifica sono gia integrate nel testo; i claim non verificabili sono dichiarati in appendice.

Documenti correlati (non duplicati qui): revisione UI/UX viste e liste (docs/analysis/2026-07-02-revisione-ui-ux-viste-liste-sinottica.md), review a minore energia + parity Apple (docs/analysis/2026-06-28-review-a-minore-energia-e-parity-apple.md).

---

## Parte 0: sintesi esecutiva

Le dieci osservazioni che contano, in ordine di leva:

1. **Il corpus dice che il 55-60% dei documenti reali non ha bisogno di LLM.** Ricette SSN (classe piu numerosa, template Apache FOP con NRE in chiaro), referti di laboratorio tabellari, certificati INPS, protesica con ICD-9: tutto estraibile con parser deterministici. L'intervento a maggiore leva dell'intera revisione e un router di classe pre-AI (filename + metadato Producer + testata), non un modello migliore.
2. **Il singolo bug di serving piu grave e deterministico**: `components/patient-identity-lens.tsx:35` filtra solo ICD-11, e il resolver import emette solo ICD-11; un paziente con soli ICD-9/10 apre una Scheda "senza diagnosi" mentre liste e cockpit le mostrano.
3. **L'insight non ha ciclo di vita**: `patient.aiSummary` e una stringa nuda (lib/db.ts:103), senza `generatedAt` ne hash del contesto. Nessuna staleness in UI, nessuna cache dei trigger, rigenerazioni ripetute su upload multipli.
4. **Il layer evidenze e infrastruttura sprecata**: fatti tipizzati, citabili, con temporalita e fonte (document-evidence-pack, evidence-queue-contract) alimentano solo i prompt (insight e Smart Import), mai una superficie UI. I fact `followup` estratti dai referti non arrivano da nessuna parte.
5. **Esistono due sistemi decisionali paralleli non integrati**: l'autofill diagnosi della sintesi (`lib/document-synthesis-service.ts:216-221`, unico auto-write clinico, anche con quality yellow) bypassa i guardrail del decision layer (`lib/document-decision.ts`). Da chiudere prima di aumentare il volume di ingestion.
6. **Modelli: baseline confermata, gap altrove.** `qwen3.5:35b-a3b` regge i gate interni e nessun candidato pubblico la batte sulle metriche MediFlow. Il gap colmabile e la lane redaction (GLiNER2-PII 307M, Apache 2.0, italiano dichiarato) dopo i fallimenti OpenMed/HUMADEX. Il ruolo `reasoning` e configurabile ma nessuna lane lo consuma; il ruolo `ocr` non e coperto dal rollout guard.
7. **Audio: il lavoro esiste gia in volo.** Branch `codex/wul-419-voice-visit-capture` (ADR 0070 "voice visit capture con boundary Fluid-style", Proposed), `wul-420` (UI sessione visita web), `wul-421` (backend transcript). Le raccomandazioni di questa revisione (dettatura review-first, audio RAM-only, lane benchmark-first con WER su farmaci e dosaggi) vanno riconciliate li, non aperte come filone nuovo.
8. **Runtime locale: robustezza prima di nuovi carichi.** `AIService.chat` senza timeout, opzioni Ollama senza `num_ctx`/`keep_alive`, launcher con `sleep 3` senza probe, `mlx_lm.server` in bind `0.0.0.0` contro la policy loopback-only dichiarata.
9. **UI dello stack AI: buone fondamenta, attriti concreti.** Kill switch coerenti e provenienza esemplare in Smart Import, ma alert/confirm nativi, `window.location.reload()` post-generazione, glossario inglese crudo (high/medium, green/red), superfici AI demo nel cockpit accanto a superfici reali.
10. **Il corpus va formalizzato come vault benchmark permanente** (ADR 0032, ancora Proposed): il campo classe nel filename (71% dei file) e la tassonomia delle sottocartelle (90% dei pazienti) sono ground truth quasi gratuita per classificatore, router e case pack.

---

## Parte 1: che cosa dice la base documentale

Censimento del corpus (aggregati):

- 389 PDF, 897 pagine, media 2,3 pagine per documento; 93% con layer testuale nativo, 7% pura scansione (29 file zero-text piu 11 jpg).
- Naming a 3 campi `DATA__classe__descrizione` nel 71% dei file; data ISO in testa nel 73%; il campo centrale e un vocabolario controllato di classe (ricetta 94, referto 52, laboratorio 21, verbale_ps 20, imaging 19, certificato_malattia 12, lettera_dimissione 11, e cosi via).
- 125 cartelle paziente nominate con CF valido; 112 con sottocartelle tematiche curate (Ricette, Referti, Lab, Imaging, Verbali_PS...). Indice per nome con 94 symlink.
- Il metadato PDF Producer e fortemente predittivo della classe: Apache FOP = ricetta SSN, AEM/LiveCycle = form INPS, OpenPDF = lettera dimissione, JasperReports = referti lab, img2pdf/Quartz/Xerox/RICOH = scansioni, pdf-lib/pypdf/iLovePDF = post-processing (classe da contenuto).
- Formati speciali: 17 AcroForm INPS invalidita (campi form leggibili senza OCR), 1 `.p7m` da sbustare, 4 `.zip` di ricette, 4 `.docx`/`.doc`, moduli DIOP compilati a mano.
- Ripartizione per difficolta di estrazione: FACILE ~55-60% (template + tabelle, zero OCR e zero LLM), MEDIO ~30% (narrativo: verbali PS, dimissioni, referti specialistici, dove il LLM serve davvero), DIFFICILE ~7-10% (OCR o form understanding). Le classi `relazione_clinica` (27% scansione) e `imaging` (30%) concentrano il fabbisogno OCR.
- Identity resolution: il CF e chiave primaria universale; chiavi secondarie utili e oggi ignorate: codice regionale / tessera TEAM, coerenza nome-CF derivabile dalle triplette consonantiche.

Implicazione strategica: la priorita non e "un modello migliore" ma instradare ogni classe verso il percorso giusto (parser deterministico, field-map, OCR, LLM) e usare il naming e i metadati come segnali gratuiti.

Attenzione operativa: il censimento per-file (`pdf_census.tsv`) contiene percorsi reali con dati personali e NON va mai committato; va salvato nel vault privato fuori Git (ADR 0032) come manifest del benchmark.

---

## Parte 2: gap tra corpus e pipeline documentale

Verificato sul codice: nessuna gestione di barcode, AcroForm, p7m, docx in lib/components/app; `lib/pdf-service.ts` non chiama mai `getMetadata`; `lib/ai/file-parsers.ts` ha il ramo PDF placeholder.

### 2.1 Classi coperte male pur essendo il cuore del corpus

- **Ricetta SSN / promemoria** (classe piu numerosa): solo keyword `ricetta` nel classificatore grezzo (`lib/ocr-service.ts:267-275`); passa dal LLM generico invece che da un parser su template FOP. NRE e codici nomenclatore sono in chiaro nel text layer: niente decodifica barcode necessaria in v1. Il quesito diagnostico (testo clinicamente ricco) e correttamente bloccato come diagnosi dal guardrail ma mai valorizzato come hint.
- **Referto di laboratorio** (estraibilita ALTA, 93% nativi): nessun parser tabellare `Determinazione / Risultato / Unita / Range`; soprattutto, l'evidence pack non ha un fact kind `lab_result` (conosce solo problem, medication, followup, care_setting, functional_status): valori, range e flag fuori range collassano in prosa e non alimentano mai osservazioni strutturate.
- **Cartella clinica ibrida** (pagine digitali + scansionate nello stesso PDF): la decisione OCR e a livello documento (`lib/document-ocr-queue.ts:96-111`) e `combinedText = pdfText || ocrText` (`lib/pdf-service.ts:580`) scarta l'OCR se esiste un text layer parziale; le pagine oltre la sesta (`OCR_PAGE_LIMIT = 6`) sono invisibili. Rischio clinico silenzioso, non solo tecnico.

### 2.2 Classi non coperte affatto

AcroForm INPS (pdfjs c'e gia, `getFieldObjects` mai chiamato: la pipeline rende BASSA un'estraibilita che sarebbe ALTA), `.p7m` (probabile esito `corrupted_pdf`, non testato), `.zip`, `.docx`/`.doc`, carta d'identita (niente percorso MRZ), moduli manoscritti (nessuna classe `handwritten_form`, finiscono in `manual_review` senza etichetta utile), documenti del medico stesso (nessun filtro anti-contaminazione sul CF dell'operatore).

### 2.3 Proposta portante: router deterministico di classe pre-LLM

Nuovo `lib/document-class-router.ts` che combina 3 segnali a costo zero e produce una `DocumentDecision.classification` motivata: (a) campo classe del filename mappato sui 14 tipi di `lib/document-decision.ts:13-27`; (b) `pdf.getMetadata()` Producer/Creator con tabella configurabile (non if hardcoded, per non ripetere il pattern "euristiche solo italiane"); (c) primi ~2000 char del text layer (testata emittente + keyword). Consumatori: `document-ocr-decision` e `document-synthesis-service`. Zero dipendenze nuove.

Instradamento per classe (sintesi; dettaglio nella tabella dell'analisi di origine):

| Classe | Percorso | LLM |
|---|---|---|
| Ricetta SSN | nuovo `lib/ssn-prescription-parser.ts` (regex su template FOP) | no (opzionale solo per riformulare il quesito come hint) |
| Referto lab | nuovo `lib/lab-report-parser.ts` (tabellare) + fact kind `lab_result` | no |
| Verbale PS, dimissione, relazioni digitali | `normalizeDocumentInput` esteso (TRIAGE, APR, ESAME OBIETTIVO, TERAPIA DOMICILIARE, PARAMETRI VITALI) + chunking per sezione al posto del taglio cieco a 12000 char | si (`clinical`) |
| Protesica, certificato malattia | form parser regex (ICD-9, PUC, codice ISO) con passthrough ICD-9-CM esplicito nel resolver (oggi forza ICD-11, `lib/patient-document-import-service.ts:1284`) | no |
| Invalidita INPS | `pdf.getFieldObjects()` + field map dichiarativa; MAI OCR | no |
| Cartella ibrida | valutazione text layer PER PAGINA, merge `pdfText[i] || ocrText[i]`, nuovo motivo coda `mixed_text_and_scan` | si sulle sezioni |
| Scansioni pure | OCR (DeepSeek-OCR primario, Apple Vision fallback macOS) con priorita alle classi relazione_clinica e imaging | si a valle |
| p7m / zip / docx | nuovi unwrap in-house (`lib/p7m-unwrap.ts`, `DecompressionStream`, parse `word/document.xml`) | come da classe risultante |
| Moduli manoscritti | classe esplicita `handwritten_form` verso `manual_review` con etichetta onesta | no |

### 2.4 Identity resolution e normalizzazione

1. Uppercase del testo prima del match CF + checksum CF in-house (~30 righe) in `lib/document-identity-resolution.ts:25,137`: regex oggi solo maiuscole senza flag `i`, recall perso su OCR lowercase; il checksum permette confidence `high` solo su CF validi (impatto alto, sforzo S).
2. Parser del filename in ingestion (nuovo `lib/document-filename-hints.ts`): data ISO come `documentDate` candidata, classe come hint del router, marcatori `_signed/_compressed/_vN` come provenienza (alto, S).
3. Fix finestra pivot anni a 2 cifre in `lib/document-input-normalization.ts:309`: oggi `58` diventa sempre `2058`, ogni data di nascita abbreviata e corrotta (medio, S).
4. Codice regionale / tessera TEAM come chiave secondaria con confidence `medium`, mai merge automatico (coerente con ADR 0051) (medio, S).
5. Coerenza nome-CF via triplette consonantiche derivate dal CF (disambigua `COGNOME NOME` vs `NOME COGNOME`) (medio, S).
6. Filtro anti-contaminazione: CF dell'operatore in settings; se il `patient_cf` risolto coincide, degrada ad `administrative` + `review_identity` (basso, S).

### 2.5 Corpus come benchmark permanente

- Promuovere ADR 0032 ad Accepted; layout vault `MEDIFLOW_DATA_DIR/ai/document-vault/<classe>/` con manifest derivato dal censimento (fuori Git).
- Nuovo `scripts/benchmark-document-router.ts` sul pattern dei benchmark esistenti: precision/recall di classificazione contro le label filename/cartella, artifact PHI-safe in rollout-readiness.
- Allineare `DOCUMENT_INTELLIGENCE_ARCHETYPES` (`lib/document-intelligence-case-pack.ts`, oggi 7 archetipi) al corpus reale: mancano proprio ricetta SSN (la classe piu numerosa), lab, certificato malattia, protesica, AcroForm, cartella ibrida, scan-only. Gemelli sintetici in repo per ciascuno (distillazione ADR 0039).
- `_DA_TRIAGE` come suite e2e permanente dell'ingestion: ogni release dichiara quanti dei 10 item passa senza intervento manuale.
- Prerequisito trasversale: rendere reale il check `phiSafety` di `lib/local-absorption-telemetry.ts:116-120` (oggi tre `false` hardcoded) prima di scrivere artifact derivati dal vault.

Rischi: autofill amplificato (chiudere il doppio sistema decisionale prima di aumentare il volume); bulk import client-side impraticabile su 389 PDF (loop sequenziale nel browser, max 10 file per batch, timeout 120s per generazione in `lib/ocr-service.ts:46`); overfitting sul corpus di un solo studio lombardo (tabelle producer/classe come dati configurabili).

---

## Parte 3: serving nelle schede riassuntive e strutturazione smart

### 3.1 Cosa manca al colpo d'occhio (verificato)

1. **Terapie come contenuto, non conteggio** (alto, sforzo basso): la strip mostra "Terapie attive: N" ma non QUALI; `ClinicalSignal` supporta gia `hint` e `tone` per cella (`components/patient-clinical-signals.tsx:11-17`) e Therapy ha `drugName/dosage/status`: servire i primi 2 principi attivi con posologia nel campo `hint`, `tone: warning` se c'e una sospensione recente. Solo il builder in `modules/page.tsx`.
2. **Ultima misura con delta invece del totale storico** (alto, medio): "Parametri: 47" e il numero meno utile; estrarre `lib/patient-vitals-summary.ts` puro (pattern `patient-review-queue-summary.ts`) riusabile da Scheda e cockpit, chiudendo anche la divergenza numerica tra le due viste.
3. **Fix identity lens multi-sistema ICD** (alto, minimo): mostrare tutte le diagnosi codificate con badge del sistema (ICD-9/10/11).
4. **Freschezza del contatto**: cella "ultima voce diario X giorni fa" con `tone warning` oltre soglia (medio, basso).
5. **Alert dell'insight sopra la piega**: `parsePatientInsight` gia esporta `alerts[]` e `gaps[]`; una riga "N attenzioni AI" cliccabile verso `#insight`, solo se l'insight non e declassato a fallback (medio, basso).

Rumore da togliere: coda di revisione sempre espansa ad attenzioni zero; "Referti: N" che conta `documentInsights` cappato a 3 per costruzione (sostituire con "Documenti senza sintesi: N", gia calcolato); `dashboard-insights.tsx` orfano con copy motivazionale e "Fake Usage Index".

### 3.2 Strutturazione smart: proiettare il layer evidenze in UI

Il layer evidenze alimenta oggi solo i prompt (insight e Smart Import via `renderDocumentEvidencePackContext`); il medico lo vede solo dopo un passaggio dal modello, in prosa. Tre proiezioni dirette:

1. **Follow-up documentati** (alto): i fact `followup` con `temporality: 'planned'` (es. "controllo cardiologico a 3 mesi" da una dimissione) come righe read-only "Suggerito dal documento X del GG/MM" accanto ai checkup, con CTA che apre il form precompilato (write solo dopo conferma, ADR 0057). Nessun componente UI consuma oggi i fact followup (grep verificato).
2. **Range di riferimento sulle Observation** (alto): aggiungere `refLow/refHigh` (tabella range LOINC locale in-house) a `lib/db.ts`; doppio beneficio: strip e futuro Foglio clinico colorano i fuori range in modo deterministico (rimuovendo il limite dichiarato in `modules/page.tsx:178-180`) e il contesto AI puo dichiarare "fuori range" nel prompt, migliorando le Attenzioni alla radice. Si aggancia al parser lab della Parte 2.
3. **Riconciliazione farmaci documenti vs terapie** (medio-alto): confrontare i fact `medication` con `db.therapies` e servire "2 farmaci citati nei documenti non presenti in terapia" che apre Smart Import filtrato. Dipende dall'apply del backfill evidenze (stato WUL-202 da verificare su Linear).

Regola di design proposta: sopra la piega solo proiezioni del layer evidenze e dati strutturati (deterministici, citabili, confrontabili); la prosa AI vive solo in superfici marcate come AI.

### 3.3 Ciclo di vita del Patient Insight

1. **Staleness** (alto, l'intervento con piu leva): `aiSummaryGeneratedAt` + `aiSummaryContextHash` persistiti alla scrittura (`ai-summary-service.ts:174-178`). Sblocca: "Generato il GG/MM" in UI, stato "non aggiornato rispetto ai dati" nella review queue, skip dei trigger a contesto invariato (cache gratuita contro le rigenerazioni ripetute da upload multiplo), copertura dei path che oggi non triggherano nulla (terapia a mano, edit anagrafica).
2. **Un parser, tre consumer** (alto): unificare `parsePatientInsight`, `coerceInsightToReadable` (ai-patient-insight.tsx:104) e `extractReadableClinicalText` (cockpit:703) in `lib/patient-insight-view-model.ts` con stato `ready|unreadable|degraded|absent`. Chiude la contraddizione review queue ("disponibile") vs pannello ("unreadable"), il rischio che un insight declassato finisca come "Sintesi del caso" nel cockpit e in Case Lens, e prepara il contratto unico per il client Swift (Tema 8 della review 2026-06-28).
3. **Coalescing dei trigger** (medio): debounce per patientId (15-30 s) sopra la Map inflight; reason `already-running` nel tipo di ritorno di `refreshPatientSummaryIfEnabled`. I call-site sono 6 in 5 file (document-upload ne ha due).
4. **Eliminare `window.location.reload()`** post-generazione (ai-patient-insight.tsx:264-266): la pagina e interamente useLiveQuery, la scrittura su db.patients gia invalida le query.
5. **Fallimenti AI visibili**: esito "ultima generazione fallita, GG/MM" nella review queue invece di console.warn e alert.

### 3.4 Provenienza, confidenza, freschezza in Vetro Clinico

- `ProvenanceBadge` a 3 valori: Struttura (dato Dexie), Documento (fatto del ledger, con data fonte), AI (output modello, con data generazione). Palette neutra ink/slate. Applicato a Sintesi del caso nel Quadro (oggi indistinguibile da notes), righe follow-up documentati, pannello insight.
- Freschezza come data, mai come aggettivo: "Generato il 28/06", "Fonte: lettera dimissione 12/06"; stato stale con bordo warning e riga "Dati clinici modificati dopo la generazione" (fatto verificabile, non avviso vago).
- Glossario italiano unico `lib/ai-labels.ts` per high/medium/low, green/yellow/red, catalog/manual/none, matchType: oggi 4 superfici mostrano valori crudi in inglese.
- Citazioni [Sx] da `<details>` collassato a chip inline cliccabili con excerpt della fonte, allineando l'insight allo standard di trasparenza gia raggiunto da Smart Import.
- Spegnere le superfici AI demo del cockpit ("Coda decisioni AI · 7 casi" hardcoded, toggle `aiInsight` non persistito): ogni badge di provenienza perde credibilita accanto a dati finti.

---

## Parte 4: modelli locali, stato dell'arte e instradamento

### 4.1 Valutazione dello stack attuale (con correzioni di verifica)

- **Estrazione e sintesi: baseline `qwen3.5:35b-a3b` confermata.** Regge i gate parliament (diagnosis recall 0.9-1.0, citation 1.0, forbiddenLeak 0); nessun candidato pubblico la batte sui gate MediFlow. Correzione di verifica sul challenger Qwen3.6: la bocciatura del round 2026-05-28 NON era solo il thinking (avg 482 s); includeva anche forbiddenLeakRate 0.167 (gate hard = 0) e recall smart-import sotto baseline. Il retest no-thinking resta legittimo ma senza aspettative di promozione facile.
- **Trend rilevante per la roadmap**: la letteratura 2026 su NLP clinico italiano (arXiv 2602.17475, verificato) mostra un Qwen3-1.7B fine-tuned che supera di +9.2 punti il 32B della stessa famiglia su 20 task clinici italiani. Convalida la strada ADR 0039 (distillazione da case pack privati) verso un estrattore compatto in-house per smart_import, che sbloccherebbe i profili hardware low/medium (oggi su famiglia stale qwen2.5:7b/14b).
- **NER/redaction e il gap piu colmabile**: OpenMed PII e HUMADEX falliti sui gate. Candidato solido: GLiNER2-PII (`fastino/gliner2-privacy-filter-PII-multi`, 307M, Apache 2.0, italiano tra le 7 lingue dichiarate, arXiv 2605.09973), con `urchade/gliner_multi_pii-v1` come secondo votante. Architettura a due layer: regex deterministiche in-app per CF/NRE/TEAM/nosologico (layer 1 obbligatorio), NER neurale solo per nomi/indirizzi/contatti nel narrativo. Sbloccare la redaction sblocca a cascata i case pack ADR 0039 e la de-identificazione dei corpora per il fine-tune.
- **OCR: il problema e il routing, non il modello.** Solo il 7% del corpus e pura scansione. `deepseek-ocr` resta adeguato; DeepSeek-OCR-2 (Apache 2.0, OmniDocBench 91.09, reading order molto migliore) e la sostituzione drop-in appena su tag Ollama stabile; Qwen3-VL-8B (Apache 2.0, disponibile su Ollama `qwen3-vl:8b`, ~6 GB) come secondo modello del ruolo ocr per il ramo difficile (moduli manoscritti, foto storte, jpg). Buco di governance: il ruolo `ocr` non e coperto dal rollout guard (roleId limitato a clinical|reasoning) e non esiste lane ocr in readiness storage.
- **Challenger di sintesi documentale**: correzione di verifica: "MedGemma 1.5 27B" NON esiste (la 1.5 e solo 4B multimodale, che ha gia fallito il contratto a 0.222 su smart-import MLX); l'eventuale challenger e MedGemma 1.0 27B text, licenza HAI-DEF gated da vagliare prima di qualunque uso (precedente: bioBIT `license_blocked`).
- **STT italiano**: Whisper large-v3-turbo (MIT, 809M, maturo su whisper.cpp/mlx-whisper), Parakeet TDT 0.6B v3 (CC-BY-4.0, italiano tra 25 lingue, throughput altissimo, ideale dettatura live), Voxtral Mini 3B (Apache 2.0, trascrive e capisce il contenuto). Correzione di verifica: il context biasing e feature della piattaforma API Voxtral Transcribe 2, non del modello open-weights, ed e ottimizzato per l'inglese: non contarci per il lessico AIFA in locale; per Whisper si usa l'initial_prompt con le terapie attive del paziente. MedASR (Google) solo watchlist: English-only.

### 4.2 Matrice di instradamento proposta

| Superficie | Ruolo settings | Primario | Challenger (shadow) | Fallback |
|---|---|---|---|---|
| patient_insight | `aiModel_clinical` | qwen3.5:35b-a3b, think:false | Qwen3.6 no-think | `sanitizeInsightMarkdown` (esiste) |
| smart_import | `aiModel_clinical` | qwen3.5:35b-a3b | Qwen3.6 no-think; a tendere fine-tune compatto | boundary deterministico + conferma operatore |
| document_synthesis | `aiModel_reasoning` (nuovo binding, default = clinical) | qwen3.5:35b-a3b | MedGemma 1.0 27B text (se licenza ok) | `buildDocumentFallbackSummary` (esiste) |
| Router documentale pre-AI (nuovo) | nessun LLM | filename + producer + regex CF + field-map AcroForm | n/a | coda triage manuale |
| ocr | `aiModel_ocr` | deepseek-ocr, poi DeepSeek-OCR-2 | Qwen3-VL-8B per il ramo difficile | Apple Vision su macOS |
| redaction (lane) | nessun ruolo LLM | regex IT + GLiNER2-PII 307M | gliner_multi_pii-v1 secondo votante | fail-closed |
| stt (lane nuova) | futuro `aiModel_stt` | Parakeet TDT 0.6B v3 (live) | Voxtral Mini 3B (batch) | whisper-large-v3-turbo; degradazione: input manuale |

Budget memoria a regime su M4 Max 36 GB: 35B MoE Q4 (~20 GB) + OCR 3B (~4 GB) + GLiNER2 (~1 GB) + STT piccolo (~2 GB) = ~27 GB, con Qwen3-VL-8B on-demand solo sul ramo difficile. Stime Q4 da validare col sizing reale (pattern `sizing_pending_on_m4_max_36gb` gia in uso).

Dare un corpo al ruolo `reasoning` (sforzo S): `lib/document-synthesis-service.ts:143` passa a `AIService.create('reasoning')` con default risolto su clinical: zero cambi per l'utente, ma abilita l'instradamento differenziato e il guard smette di governare un ruolo fantasma.

### 4.3 Validazione con l'impianto esistente

Registry candidates con `promotionStatus: benchmark_only` prima di tutto; round parliament con le soglie esistenti (contract >= 0.95, forbiddenLeak = 0); rollout readiness per lane con gli stessi gate su cui i predecessori sono falliti (confronto 1:1); estensione del guard a `ocr` (e in prospettiva `stt`) e fattorizzazione dei kill switch triplicati in un modulo parametrico (ogni nuova lane oggi costa un clone); case pack dal corpus reale previa redaction (P1 e prerequisito di tutto); pin della versione Ollama durante i round; colmare gli stati ADR 0033 mancanti nel codice (`shadow-active`, `active-with-fallback`) prima della prima promozione reale.

### 4.4 Cosa NON cambiare

Ollama unico provider runtime e policy loopback-only; boundary MLX benchmark-only; la baseline qwen3.5 per clinical; l'envelope `mediflow.ai.extract.v1` coi suoi limiti hard (e l'asset che ha gia scartato correttamente medgemma-4b, phi4, deepseek-r1); kill switch fail-closed e soglie parliament (forbiddenLeakRate = 0 non negoziabile); deepseek-ocr come default nel breve; l'eccezione Apple Vision; il comparatore cloud gpt-5.4 come sola shadow eval opt-in.

---

## Parte 5: registrazione audio delle visite

Stato su main: SOLO pianificato, zero codice (verificato in modo esaustivo: nessun getUserMedia/MediaRecorder/AVAudioEngine/whisper in app, components, lib, native). Unica specifica: "Dettatura: Whisper (locale)" in docs/ROADMAP.md:156-159.

**Fatto nuovo emerso in verifica**: il lavoro voice e GIA in volo su tre branch: `codex/wul-419-voice-visit-capture` con `docs/adr/0070-voice-visit-capture-fluid-boundary.md` (Proposed, boundary Fluid-style: FluidVoice come riferimento UX, FluidAudio SDK Apache 2.0, vincoli local-first e review-first), `codex/wul-420-web-visit-session-ui`, `codex/wul-421-visit-transcript-backend`. Nota di igiene: la numerazione ADR 0070 e in collisione tra due branch (voice capture su wul-419, in-house-first su feat/apple-universal-fase0): da riconciliare al merge.

Raccomandazioni di questa revisione da portare dentro quel filone (non filone nuovo):

1. **Scope slice 1 = dettatura del medico, non ambient scribe**: evita il gap consenso (nessun documento lo copre) e resta dentro ADR 0065 (bozza rivedibile). L'ambient con diarizzazione resta bloccato dietro un ADR consenso dedicato (informativa, revoca, retention).
2. **Audio RAM-only di default**: il Blob muore con la request; se il runtime richiede file temporaneo, `MEDIFLOW_DATA_DIR/tmp` con unlink in `finally`, mai negli attachment. Presidio: test che fallisce se il servizio STT scrive fuori dal tmp. Nessun nuovo claim di cifratura (freeze WUL-342/354).
3. **Punto d'innesto UI**: `app/patients/[id]/entries/new/page.tsx` sezione `#resoconto` (righe 284-299, editor con placeholder SOAP); NON `new-visit-modal.tsx` (solo picker) e NON il cockpit come riuso di scrittura (il cockpit legge soltanto db.entries, verificato).
4. **Valore a valle gratis**: la entry salvata e gia sorgente citabile `diary_entry` nel layer di assorbimento (`lib/evidence-queue-contract.ts:14`) e viene consumata da Patient Insight senza alcun lavoro nuovo. E l'argomento piu forte per la slice minima.
5. **Lane benchmark-first**: lane `dettatura` in readiness storage e registry come benchmark_only; `scripts/benchmark-stt-dettatura.ts` via launcher run-strip-types con metriche WER globale, `criticalTermRecall` su nomi farmaco e dosaggi numerici (il vero rischio clinico), `dosageDigitErrorRate`, e clip di solo rumore con output atteso vuoto (allucinazioni di Whisper sul silenzio, analogo dei negativeCaseLeakRate).
6. **Runtime STT fuori Ollama** (che non serve ASR): whisper.cpp come processo locale orchestrato dall'app (precedente architetturale: Ollama stesso), porta dedicata (non 8080, redirette dall'euristica anti-MLX; non 11435, usata per build Ollama HEAD), mai su `mlx_lm.server` (boundary benchmark-only da preservare). Versione e hash modello pinnati nel registry.
7. **Sequenza**: S0 governance (ADR + lane + factory kill switch generica), S1 benchmark STT offline (decide il modello sul vincolo 36 GB con Qwen residente), S2 dettatura in UI dietro kill switch fail-closed, S3 robustezza runtime condivisa (parallelizzabile), S4 estrazione strutturata `visit_note_structuring` nell'envelope con review-first, S5 parity nativa Apple (AVAudioEngine + NSMicrophoneUsageDescription + endpoint via local token dal client paired).

---

## Parte 6: robustezza e performance del runtime locale

Interventi che servono oggi ai task documentali e domani allo STT, in ordine di impatto:

1. **Timeout in `AIService.chat`** (S): il fetch (`lib/ai-service.ts:159-164`) ha solo il signal esterno opzionale; una Ollama appesa blocca insight, smart import e domani la trascrizione. `AbortSignal.any([signal, AbortSignal.timeout(perTaskMs)])` con budget per task.
2. **Readiness reale all'avvio** (S): `Start_MediFlow.command:124-126` fa `ollama serve &` + `sleep 3` senza probe; sostituire con poll su `GET /api/tags` (gia usato da getHealth) con backoff, e probe analogo per il container ICD su 8888.
3. **Opzioni Ollama governate** (S): aggiungere `num_ctx` e `keep_alive` (`lib/ai-service.ts:142-146`): evita il ricarico a freddo dopo unload idle e la truncation sui contesti lunghi; diventa critico con 2-3 modelli co-residenti.
4. **Bind MLX loopback** (S, sicurezza): `scripts/start-mlx.sh:29` fa `--host 0.0.0.0` contro `targetPolicy: 'loopback-only'`; portare a 127.0.0.1 e aggiungere il check al guard `check-mlx-operational-parity`.
5. **Coda locale per job AI pesanti** (M): oggi l'unica serializzazione e il dedup inflight per paziente; un `lib/ai-job-queue.ts` in-process (concorrenza 1 per famiglia generativa, STT prioritario perche interattivo) evita la contesa di memoria unificata.
6. **Flag di troncatura in `extractJsonObject`** (S): oggi chiude brace mancanti in silenzio (`lib/ai-task-contracts.ts:614-624`); un JSON tagliato dal budget token passa come valido con dati parziali. Propagare `truncated: true` come warning del contratto.
7. **Streaming** (M): chat e proxy bufferizzano tutto; introdurre lo streaming prima nello STT (il medico vede il testo apparire), poi retrofit sull'insight.
8. Minori: `PM2Manager.start` dipende da `process.cwd()`; `readAiModelParliamentArtifact` fa JSON.parse senza try/catch (un latest.json corrotto produce 500, a differenza del gemello readiness); retry/resume sul pull NDJSON.

Debito di piattaforma AI collegato (dalla mappa core, verificato): codice morto (`lib/ai-engine.ts` deprecato che importa ancora openai, `lib/ai-prompts.ts` orfano, route `proxy/ai/chat` senza caller); auth incoerente tra proxy gemelli (il client paired con local token non puo usare il proxy chat effettivo); euristica URL anti-8080 duplicata con default divergenti; marker specifici del modello (`<unused94>`, `<think>`) cablati nel layer contratti anziche provider; filtro low-signal triplicato con soglia 24 char duplicata in 3 moduli.

---

## Parte 7: UI/UX dello stack intelligente

Fondamenta buone: pattern kill switch uniforme con doppio stato disabled, degradazione coerente post WUL-358, provenienza esemplare in Smart Import (fonte + excerpt + resolver trace con score), nessun em dash nelle stringhe controllate.

Attriti principali (tutti con riferimento nel dossier UI):

1. Alert/confirm nativi fuori dal linguaggio Vetro Clinico in 4 superfici (model selector, settings controller, archivio intelligente, upload).
2. `window.location.reload()` post-generazione insight (perdita scroll e stato su pagina live-query).
3. Salvataggio config AI senza feedback di successo; stato hook per pagina: modifiche perse navigando tra Modelli e Funzioni; toggle `role="switch"` con effetto solo al salvataggio (rischio: il medico crede di aver spento una funzione senza averla salvata).
4. Glossario inglese crudo (confidence, matchType, quality) in 4 superfici; genere incoerente ("Disabilitata" su Smart Import maschile); fallback colore qualita divergente (blu vs amber).
5. "Evidenze cliccabili" senza handler nel decision review card: promessa non mantenuta, di fatto meta-testo.
6. Analisi Smart Import non persistita (un refresh cancella suggerimenti e selezioni); pannello che ritorna `null` a zero fonti senza stato vuoto onesto.
7. Footer archivio con nomi modello hardcoded ("DeepSeek OCR 2 + Qwen 3.5 35B A3B") che ignora la config reale.
8. Comandi npm di governance mostrati nella UI Impostazioni; copy "CPU alta? Riavvia Ollama" con backtick non renderizzati.
9. Superfici AI demo nel cockpit (coda decisioni statica, toggle non persistito) accanto a superfici reali.
10. Sintesi documentale fallita silenziosa nell'import nuovo paziente (errori solo in console).

---

## Parte 8: roadmap consolidata

### Quick win (giorni)

| # | Intervento | Moduli |
|---|---|---|
| Q1 | Fix identity lens multi-sistema ICD | `components/patient-identity-lens.tsx:35` |
| Q2 | Rimozione reload post-generazione | `components/ai-patient-insight.tsx:264-266` |
| Q3 | Uppercase + checksum CF, pivot anni 2 cifre | `lib/document-identity-resolution.ts`, `lib/document-input-normalization.ts` |
| Q4 | Strip segnali con contenuto (posologie, ultimo contatto, "senza sintesi: N") | builder in `modules/page.tsx` |
| Q5 | Glossario `lib/ai-labels.ts` + fix superfici demo cockpit | 5 componenti |
| Q6 | Timeout AIService + probe readiness launcher + bind MLX loopback | `lib/ai-service.ts`, `Start_MediFlow.command`, `scripts/start-mlx.sh` |
| Q7 | Binding ruolo reasoning su document_synthesis (default invariato) | `lib/document-synthesis-service.ts:143` |
| Q8 | Debounce trigger insight + reason already-running | `lib/ai-summary-service.ts` |

### Interventi strutturali (in ordine di dipendenza)

| # | Intervento | Dipende da |
|---|---|---|
| S1 | Staleness insight (`aiSummaryGeneratedAt` + `aiSummaryContextHash`) | nulla; sblocca freschezza UI, cache trigger, stato stale |
| S2 | View model unico insight (`lib/patient-insight-view-model.ts`) | nulla; prepara parity Swift |
| S3 | Router deterministico di classe + parser ricetta SSN e lab + fact kind `lab_result` | nulla; e la leva principale della pipeline |
| S4 | Integrare l'autofill sintesi nei guardrail del decision layer (chiudere il doppio sistema) | prima di aumentare il volume di ingestion |
| S5 | Vault ADR 0032 + benchmark router con label da filename + archetipi case pack allineati al corpus | S3; check `phiSafety` reale |
| S6 | Range di riferimento Observation + proiezioni evidenze in UI (follow-up, riconciliazione farmaci) | S3 (parser lab); stato WUL-202 |
| S7 | Lane redaction con GLiNER2-PII (2 layer: regex + neurale) | nulla; sblocca case pack e fine-tune |
| S8 | AcroForm INPS, p7m, zip, docx; OCR per pagina (cartelle ibride) | S3 |
| S9 | Retest Qwen3.6 no-think + estensione guard a ruolo ocr + factory kill switch parametrica | Q6 |
| S10 | Riconciliazione col filone voice WUL-419/420/421 (benchmark STT, audio RAM-only, review-first) | governance del filone esistente |
| S11 | Fine-tune compatto in-house per smart_import (base Qwen3 1.7-4B su corpora distillati) | S7 (de-identificazione), S5 (case pack) |
| S12 | Coda job AI locale + streaming STT/insight | S10 |

---

## Appendice: metodo, correzioni e limiti

- **Correzioni integrate dai verificatori** (gia riflesse sopra): il loop bulk import e il timeout OCR vivono in punti diversi da quelli citati in prima battuta; l'evidence pack alimenta anche Smart Import, non solo l'insight; i call-site del refresh guard sono 6 in 5 file; `documentInsights` mostra max 3 referti; "MedGemma 1.5 27B" non esiste (solo 1.0 27B); la bocciatura Qwen3.6 includeva fallimenti di qualita oltre alla latenza; il context biasing Voxtral e feature API English-first; il cockpit kree8 legge soltanto db.entries; l'ADR 0070 in-house-first vive solo su feat/apple-universal-fase0 e collide nella numerazione con l'ADR 0070 voice su wul-419.
- **Non verificabile dal repo**: tutte le statistiche del corpus (censimento locale eseguito in sessione, artefatto per-file da conservare nel vault privato, MAI in Git perche contiene percorsi con dati personali); lo stato reale dell'apply backfill WUL-202 (su Linear); l'incidente auto-upgrade Ollama citato negli artefatti benchmark di tmp/.
- **Affidabilita dei dossier di origine**: gap corpus ALTO, serving schede ALTO, audio/runtime ALTO, modelli candidati MEDIO-ALTO (dopo le correzioni sopra).
- Artefatti di lavoro della sessione (fuori repo): 15 dossier + censimento PDF nello scratchpad di sessione.

---

## Parte 9: stato di esecuzione (branch feat/stack-intelligente-fixes)

Eseguito in questa sessione sul branch `feat/stack-intelligente-fixes`. Ogni batch ha typecheck, lint ed eventuali test dedicati verdi (81 test nelle suite toccate). La verifica visiva con dati paziente seed non era disponibile in sessione: la copertura poggia su typecheck + lint + unit test.

### Fatto (committato e testato)

| Item | Stato | Commit |
|---|---|---|
| Q1 Identity lens multi-sistema ICD | fatto | c1492dfb8 |
| Q2 Rimozione reload post-generazione | fatto | c1492dfb8 |
| Q3 Uppercase + checksum CF, pivot anni 2 cifre | fatto + test | c1492dfb8 |
| Q6 Timeout AIService, keep_alive, probe readiness launcher, bind MLX loopback | fatto | c1492dfb8 |
| Q7 think:false clinical+reasoning, sintesi su ruolo reasoning | fatto | c1492dfb8 |
| Q4 Strip segnali con contenuto (posologie, ultima misura, ultimo contatto, doc senza sintesi) | fatto | c617fda35 |
| Q5 Glossario IT `lib/ai-labels.ts` su 5 superfici + footer modelli reali | fatto | c617fda35 |
| Q8 Trailing rerun + reason already-running | fatto | c1492dfb8 (unione con S1) |
| S1 Staleness insight (generatedAt + contextHash, cache skip-if-unchanged, riga review queue, badge pannello) | fatto + test | 4bdfc2f7a |
| S2 View model unico insight (`patient-insight-view-model.ts`), queue e pannello concordano | fatto + test | 907b1616e |
| S9 (parte) Factory kill-switch condivisa, rimossa la triplicazione | fatto + test | 0d117a1d8 |
| S3 (core) Router deterministico di classe (`document-class-router.ts`) | fatto + test, NON ancora wired | 4105c85c1 |

### Non fatto in sessione (motivo esplicito)

- **S3 wiring**: il router e completo e testato ma non ancora chiamato dalla pipeline. Serve prima aggiungere `pdf.getMetadata()` in `lib/pdf-service.ts` (oggi mai chiamato) e integrarlo in `lib/document-synthesis-service.ts`/`document-ocr-decision.ts`. E' un cambio sul flusso PDF client-side che va verificato con un preview su documenti reali: rimandato per non introdurlo alla cieca.
- **S3 parser deterministici** (`ssn-prescription-parser`, `lab-report-parser`) e **fact kind `lab_result`**: nuovi moduli ampi con estrazione tabellare; da fare dopo il wiring del router, con case pack dal vault.
- **S4 Integrare l'autofill sintesi nei guardrail del decision layer**: chiude il doppio sistema decisionale ma tocca l'unico auto-write clinico; richiede test di non-regressione mirati prima di modificarlo.
- **S5 Vault ADR 0032 + benchmark router**: la promozione ADR e il manifest sono doc/script; il benchmark ha bisogno del corpus nel vault privato (fuori sessione).
- **S6 Range di riferimento Observation + proiezioni evidenze in UI**: schema change + backfill + nuove superfici; dipende anche dallo stato reale di WUL-202.
- **S7 Lane redaction GLiNER2-PII**, **S9 retest Qwen3.6 / guard ruolo ocr**, **S11 fine-tune compatto**: dipendono da download modelli, adapter e benchmark su hardware, quindi fuori dallo scope di una sessione di codice.
- **S8 AcroForm/p7m/zip/docx + OCR per pagina**: piu handler di formato, ampio.
- **S10 Riconciliazione col filone voice** (WUL-419/420/421) e **S12 coda job AI + streaming**: coordinamento con branch in volo / lavoro ampio.

Il guard ruolo `ocr` (parte di S9) non e stato aggiunto perche senza una lane di benchmark OCR popolata non avrebbe effetto reale: va fatto insieme a S7.
