---
summary: "Censimento G-0 della 0.9.1: parità Web/GPUI, specifica, writer, rinvii e unità PR sul solo Mac U0."
read_when:
  - "Delimitando o accettando le unità G-1–9 della 0.9.1."
  - "Distinguendo sorgente GPUI, pilota installato e prove mancanti."
---

# Censimento GPUI per MediFlow 0.9.1

Data: **23 ottobre 2026**. Owner: [WUL-771](https://linear.app/wulfgardr/issue/WUL-771).
Contributo **G-0**, solo analisi e documentazione. Contratto: [U0, §G](../releases/0.9.1-contract.md#g--gpui-e-prodotto-installato).

**Le dieci unità G-0–9 restano sufficienti come outcome, ma non sono dieci PR di prodotto.**
Questo censimento articola G-1–9 in **40 unità PR nominate**, più la PR G-0.
Non aggiunge una nuova autorità dati e non concede esclusioni funzionali.
I rinvii Web restano residui delle rispettive unità; le vecchie classificazioni
Apple `host-only` non escludono funzioni dal target GPUI sul Mac autorevole.
I contratti delle porte host vanno definiti prima delle relative UI.

La copertura è un'assegnazione verificabile del lavoro, **non parità già raggiunta**.
La scomposizione operativa è una proposta da accettare nel coordinamento;
U0 rimane il contratto approvato. Un eventuale ritiro di una riga richiede
un emendamento esplicito, non il semplice rinvio al Web.

## Base, metodo e limiti

- Web e GPUI analizzati: **`0a1980f323d62b4a7c2e1f01e0950a3ac5da218f`**, coincidente con `origin/main` al fetch del censimento.
- Fonti di copertura: [matrice narrativa](../parity-matrix.md), **66 righe** del [contratto Apple JSON](../apple-parity-matrix.json), tutti i `app/**/page.tsx`, [specifica](../design/punto-inchiostro/01-specifica.md), [addendum](../design/punto-inchiostro/02-addendum-composizione.md), [piattaforme](../design/punto-inchiostro/02-piattaforme-e-schermate.md), [ascolto](../design/punto-inchiostro/03-ascolto-della-visita.md) e [README del dossier](../design/punto-inchiostro/README.md).
- Target: il Mac U0, Mac16,5/M4 Max/36 GB/macOS 27.2 `26B118`; GPUI Windows/Linux e mobile restano esclusi dalla 0.9.1 per decisione U0. Il minimo nativo è **390 px**, non 320 px.
- Lettura del codice e dei metadati del bundle; **nessuna compilazione, avvio GPUI, connessione a un host clinico o apertura di database** in G-0. Le prove nominate sotto sono da eseguire nelle unità indicate, salvo esplicita indicazione contraria.
- Toolchain in repository: [workspace Cargo](../../experiments/gpui-patient-pilot/Cargo.toml), [pin Rust](../../experiments/gpui-patient-pilot/rust-toolchain.toml), [CI GPUI](../../.github/workflows/rust-gpui-pilot.yml): Rust 1.98.1, GPUI `56934ec0560bce8929025497411de7f5322fb6ca`. La feature locale `gpui_platform/runtime_shaders` permette la compilazione degli shader a runtime; non richiede modifiche al manifest. Eventuali prove future usano target Cargo privato della worktree e archivio sintetico temporaneo. Nessuna build condivisa viene assunta come prova di questo SHA.

### Installato e sorgente sono diversi

L'ispezione in sola lettura di `MediFlow GPUI Pilot.app` ha rilevato:

| Dato | Valore osservato |
| --- | --- |
| Identità | `dev.mediflow.gpui-pilot`, `MediFlowPilotOnly=true` |
| Versione/build | `0.1.0` / `20261018.3` |
| Revisione dichiarata | `16be6c02f5ca3536bc5ce4f1b743cb13c8b2147c` |
| Albero GPUI dichiarato | `74eab7d1a205c032579a75b2d0cc5e10d7d78039`, uguale all'oggetto Git GPUI di quella revisione |
| SHA-256 eseguibile | `305e21b96cf85dd5f0fbc12ab43c3cd09d7815ab7d35217478e062fc4b9b5c75` |
| Dimensione eseguibile | 68.626.544 byte |
| Minimo dichiarato nel bundle | macOS `26.0`; il target di accettazione 0.9.1 resta quello U0 |

Questa è identità osservata più provenienza **dichiarata dai metadati**, non una
ricostruzione riproducibile del binario né una prova di funzionamento. La
verifica G-9 deve legare binario, sorgente, host e ricevuta di build. Il bundle
Apple `MediFlow.app` è un prodotto distinto: i suoi successi non qualificano
GPUI. Le prove storiche del [client collegato](./2026-10-17-rust-gpui-connected-client.md)
e della [tastiera](./2026-10-17-rust-gpui-keyboard-recovery.md) conservano SHA,
piattaforma e limiti originali.

## Come leggere le matrici

Le colonne **L/S** distinguono letture e scritture effettivamente collegate.
`Assente` significa nessun percorso GPUI individuato nel dispatcher e nel
trasporto corrente, non assenza della funzione Web. `Parziale` nomina il
sottoinsieme presente. `Rinvio` significa apertura del browser senza passare
credenziali nell'URL; non è una prova nativa.

Fonti GPUI abbreviate, tutte relative a [app/src](../../experiments/gpui-patient-pilot/app/src):

| Sigla | Fonte e significato |
| --- | --- |
| SH | [shell.rs](../../experiments/gpui-patient-pilot/app/src/shell.rs): `area_view`, `profile_view`, `confirm_form`, `run`, `open_current` |
| NAV | [navigation.rs](../../experiments/gpui-patient-pilot/app/src/navigation.rs): sette aree, sei sezioni paziente, layout |
| TR | [transport/session.rs](../../experiments/gpui-patient-pilot/transport/src/session.rs): metodi HTTP nominati, capability, scope, ricevute di lettura |
| VS | [shell/view_state.rs](../../experiments/gpui-patient-pilot/app/src/shell/view_state.rs): letture tipizzate di scheda, diario, terapie, parametri, controlli, profilo |
| ED | [editing.rs](../../experiments/gpui-patient-pilot/app/src/editing.rs), [patient_forms.rs](../../experiments/gpui-patient-pilot/app/src/patient_forms.rs): form e confronto della rilettura |
| DOC | [documents.rs](../../experiments/gpui-patient-pilot/app/src/documents.rs), [shell/document_details.rs](../../experiments/gpui-patient-pilot/app/src/shell/document_details.rs): file espliciti, fonte e sintesi salvate |
| AI | [shell/ai_preferences.rs](../../experiments/gpui-patient-pilot/app/src/shell/ai_preferences.rs), [shell/ai_status.rs](../../experiments/gpui-patient-pilot/app/src/shell/ai_status.rs): preferenze e stato, non inferenza |
| ACC | [shell/account_profile.rs](../../experiments/gpui-patient-pilot/app/src/shell/account_profile.rs): profilo account condizionale |
| SCALE | [shell/scales.rs](../../experiments/gpui-patient-pilot/app/src/shell/scales.rs), [transport/scales.rs](../../experiments/gpui-patient-pilot/transport/src/scales.rs): catalogo, preparazione host e registrazione |
| REF | [references.rs](../../experiments/gpui-patient-pilot/app/src/references.rs), [shell/who_lookup.rs](../../experiments/gpui-patient-pilot/app/src/shell/who_lookup.rs), [shell/therapy_picker.rs](../../experiments/gpui-patient-pilot/app/src/shell/therapy_picker.rs) |
| ANA | [shell/analytics.rs](../../experiments/gpui-patient-pilot/app/src/shell/analytics.rs): lettura demografica popolazione |

Stati attuali usati nelle righe:

| Sigla | Stato nel sorgente e limite |
| --- | --- |
| R0 | `Load`: Idle/Loading/Ready/Failed(String). Vuoto dopo risposta; tassonomia, copia offline, obsolescenza e recupero non equivalgono a R1. |
| R1 | `ReadLoad` e `ViewState`: lettura, attesa >5 s, vuoto, errore, non in linea, negato, illeggibile, archivio sostituito, obsolescenza/conflitto con evidenza. Ora/autore non inventati; interrompere richiede un trasporto cancellabile. |
| F | Form Draft/Review/Saving/Conflict/Uncertain/Rejected; successo soltanto dopo rilettura. Recupero conservativo completo delle note e percorso scale dedicato; gli altri form non ereditano tale prova. |
| A | Profilo account: snapshot/versione, bozza, conflitto, rilettura, esito non confermato; generazione distinta dall'epoch di navigazione. |
| M | Preferenze AI: lettura, bozza, preview, applicazione, riconciliazione e revisione catalogo. Stato runtime letto separatamente, non prontezza misurata del modello. |
| D | Documento: file annullato/non leggibile/troppo grande, campi cifrati illeggibili, fonte mancante/invalida/non supportata/di altro allegato. Snapshot non attesta originalità corrente né accettazione. |
| Ø | Vista/azione nativa assente: nessuno stato GPUI da dichiarare riuscito. |

Prove richieste, da applicare **a ciascuna riga**, senza un PASS collettivo:

| Sigla | Prova di accettazione |
| --- | --- |
| QL | Web/GPUI sullo stesso corpus logico sintetico: zero/uno/molti, scope e cifrato, filtri/paginazione, vuoto/errore/negato/offline/obsoleto; tardiva dopo cambio paziente/lock non applicata. |
| QS | Preview → gesto appropriato → writer autorevole → audit e rilettura; CAS, ruolo/scope/paziente/versione errati, doppio invio, risposta persa, annullamento e riavvio; nessun successo parziale. |
| QD | File multipli, 10 MiB e oltre limite dichiarato, duplicati, assenza, cifrato illeggibile, fonte corrente/storica, cancellazione, ritorno e operazione annullata; nessun file/record residuo non dichiarato. |
| QI | Cella I-0 esatta, proposta a matita/fonti/ricevuta, consenso, generazione reale sintetica, output invalido, indisponibilità/revoca/annullamento; nessun apply o cambio venue implicito. |
| QA | Tastiera e AccessKit, VoiceOver nativo sul Mac, Giorno/Grafite, 390/768/1440 px e testo 100/200/400%, finestra bassa, focus/bozza, preferenze di accessibilità del sistema. |
| QH | Autorità host: preview e permesso nominati, step-up ove richiesto, annullamento, crash, replay, `ARCHIVE_REPLACED`, conservazione record/chiavi/audit/allegati e ricevuta. |
| QP | Bundle/hash/toolchain/runtime, firma dichiarata, installazione, avvio, compito utile, aggiornamento e recupero sul solo target U0. |

Tutte le righe richiedono anche QA quando hanno una vista. I test presenti
in VS, ED, SCALE, ACC, AI, DOC e nel trasporto sono **fonti di prova da riusare
per rischio e SHA**, non esecuzioni effettuate in G-0. Il [roster writer](../clinical-write-roster.md)
e il suo [CSV](../clinical-write-surfaces.csv) restano l'autorità degli ingressi
clinici; questo documento censisce i consumatori GPUI.

## Matrice funzionale: tutte le 66 righe di parità

P01–P66 sono gli indici **1-based nell'ordine del JSON** alla base fissata.
I nomi FSE della matrice storica indicano qui soltanto pre-check locali:
non certificazione, invio regionale o writeback. La colonna G identifica
consegne del registro chiuso sotto; G-7 e G-8 restano trasversali.

| Riga / funzione della parità | Route/funzione Web | Vista GPUI corrente | L/S effettive e residuo | Stati | Prova richiesta | Unità |
| --- | --- | --- | --- | --- | --- | --- |
| P01 — Anagrafica paziente: lista, ricerca, view, create, update | `/`, `/patients/new`, `/patients/{id}/edit` — `app/page.tsx`, `patient-form.tsx` | Parziale: SH directory/preview/profile, ED anagrafica | L elenco/profilo; S create e update campi anagrafici; bulk senza UI Web non aggiunto | R0/R1/F | QL/QS | G-6a,G-8b |
| P02 — Archivia / soft-delete / ripristina paziente (stato scheda) | `/` e scheda — lifecycle in `lib/db.ts` | Filtro archiviati; nessuna azione completa archivia/cestino/restore | L attivi/archiviati; S lifecycle assente | R0/Ø | QL/QS | G-6a |
| P03 — Diario clinico: view/list, create, update, soft-delete+restore, filtri | `/patients/{id}/modules#diario` — `timeline.tsx`, `timeline-entry-card.tsx` | SH diary_view + ED Entry | L voci; S create/update; soft-delete/restore e filtri completi residui | R1/F | QL/QS | G-6b |
| P04 — Nuova voce clinica avanzata (S/O/A/P, allegati OCR, sessione visita, elabora bozza AI) | `/patients/{id}/entries/new` — compositore clinico | Form Entry semplice; no sessione visita/SOAP/allegati nel form | L contesto; S voce singola; pipeline avanzata assente | F/Ø | QS/QD/QI | G-6b,G-6j,G-1d |
| P05 — Editor rich-text clinico (formattazione S/O/A/P) | Compositore — `clinical-rich-text-editor.tsx` | `clinical_text` legge strutture; ED protegge HTML ricco, non editor equivalente | L formattata; S testo semplice; formattazione annidata non editabile allo stesso modo | F | QL/QS | G-6b |
| P06 — Somministrazione scale cliniche (runner + salvataggio come voce diario) | `/patients/{id}/scales/{scaleId}` | SCALE: catalogo, risposte, preparazione e soglia | L catalogo/prepare; S voce scala e rilettura per attempt | F dedicato | QL/QS | G-6f |
| P07 — Libreria/catalogo scale standalone con storico e scorciatoie | `/scales`, `/patients/{id}/scales` | SCALE; biblioteca e percorso collegato, storico da riconciliare | L catalogo e voci; S come P06 | R0/F | QL/QS | G-6f |
| P08 — Gestione terapie farmacologiche (CRUD + stato + collegamento diagnosi) | `/patients/{id}/modules#terapie` — `therapy-manager.tsx` | SH therapies_view, ED Therapy, REF picker AIFA | L terapie; S create/update; status, lifecycle e diagnosi da completare | R1/F | QL/QS | G-6c |
| P09 — Ragionamento terapeutico AI (Treatment Reasoning, review-only) | Scheda, `treatment-reasoning-panel.tsx` | Assente; AI legge kill switch soltanto | L stato; S proposta/applicazione assenti | R0/Ø | QI/QS | G-5d,G-6j |
| P10 — Controlli/checkup follow-up (CRUD + stato) | `#follow-up` — `app/patients/[id]/modules/page.tsx`, `followup-suggestions.tsx` | SH checkups_view, ED Checkup | L controlli; S create/update e stato; completare lifecycle e campi | R1/F | QL/QS | G-6e |
| P11 — Suggerimenti follow-up proiettati da documenti | `#follow-up` — proiezione `lib/patient-followup-projection.ts` | Controlli registrati; nessun percorso completo candidato documentale | L checkup; proiezione/revisione deduplicata residua | R1/Ø | QL/QD/QS | G-6e,G-4b |
| P12 — Osservazioni/parametri clinici (CRUD LOINC/UCUM + trend/sparkline) | `#parametri` — `observation-manager.tsx` | SH observations_view, ED Observation | L misure; S create/update; trend, lifecycle e legame prestazione residui | R1/F | QL/QS | G-6d |
| P13 — Prestazioni prescritte (Service Prescriptions, CRUD ricco + stato) | `#prestazioni` — `service-prescription-manager.tsx` | Assente | L/S native assenti; SP host e paired esistenti | Ø | QL/QS | G-6g |
| P14 — Diario ausili e prescrizioni protesiche (CRUD + collaudo) | `#protesica` — `prosthetic-prescription-manager.tsx` | Assente | L/S native assenti; prescrizione/collaudo da portare | Ø | QL/QS | G-6h |
| P15 — Upload documenti + OCR + sintesi clinica (Archivio documenti) | `#documenti` — `document-upload.tsx`, `document-viewer.tsx` | SH documents_view + DOC; upload singolo e download | L elenco/dettaglio; S allegato; OCR, multipli e originale inline residui | R0/D/F | QD/QS/QI | G-4a,G-4b,G-5b |
| P16 — Archivio Intelligente / Document Insights (view estrazioni + delete) | `#documenti` — `document-insights-panel.tsx` | DOC mostra snapshot, non intero archivio insight | L sintesi/fonte salvata; S curation/delete assenti | D/Ø | QD/QS | G-4b |
| P17 — Smart Import (candidati diagnosi/terapie da documenti, applica in scheda) | Scheda/nuova scheda — `patient-smart-import-fabric-preview-card.tsx` | Assente | Nessuna generazione/apply nativa; apply legacy ritirato, non da riattivare | Ø | QI/QS | G-5c,G-4d,G-6j |
| P18 — Referti recenti (Evidence Stack tile, view sintesi) | Scheda — `app/patients/[id]/modules/page.tsx`, `document-insights-panel.tsx` | DOC nel dettaglio; niente tile equivalenti di referti recenti | L snapshot; nessuna S all'apertura | D | QL/QD | G-4b,G-8b |
| P19 — AI Patient Insight (sintesi/follow-up/alert generati) | Scheda — `ai-patient-insight.tsx` | Assente come generazione/revisione | L configurazione AI; S proiezione assistita assente | R0/Ø | QI/QS | G-5a,G-6j |
| P20 — Foglio sinottico / Identity Lens / Review Queue (viste sintetiche cockpit) | `/patients/{id}/modules` — sinottico, identity lens, review queue, timeline | SH overview, sei sezioni; composizione parziale | L profilo/risorse; niente nuova autorità; attenzione/timeline da comporre | R1 | QL/QA | G-8b,G-6b,G-6e |
| P21 — Export FHIR paziente (pre-check locale) | Scheda/edit — export FHIR e `/api/fse/validate-patient` | Assente | L dati/export/pre-check locali assenti; nessun invio istituzionale | Ø | QL/QD | G-6i |
| P22 — Report PDF paziente | Scheda — `lib/report-service.ts` | Assente | L aggregato e file PDF da generare/salvare esplicitamente | Ø | QL/QD | G-6i |
| P23 — Esenzioni paziente (selezione/gestione codici cifrati) | Edit — `exemption-selector.tsx` | REF lookup; nessun editor esenzioni paziente completo | L catalogo; S codici cifrati nella scheda assente | R0/Ø | QL/QS | G-6a |
| P24 — Catalogo farmaci AIFA (ricerca/validazione prontuario) | Repertori/terapie — `drug-autocomplete.tsx` | REF repertorio e terapia con identità completa | L drugs; S scelta nel draft, poi writer terapia | R0/F | QL/QS | G-6c,G-7b |
| P25 — Ricerca ICD in-app per codifica diagnosi | Edit — `icd-autocomplete.tsx` | REF WHO/terminologia; diagnosi visualizzate nel Quadro | L catalogo/profilo; S codifica nella scheda completa assente | R0/R1 | QL/QS | G-6a,G-7b |
| P26 — Ricerca terminologica generale (ICD/systems oltre in-app) | Repertori — `/api/terminology/*` | REF sistemi/ricerca/risoluzione/WHO | L nomenclature dall'host, nessun provider diretto | R0 e stato WHO | QL | G-7b |
| P27 — Selezione scope ambulatorio attivo | Shell — selezione ambulatorio | SH load_ambulatories/change_scope | L scope ammessi; cambio contesto, nessuna mutazione clinica | R0 | QL/QH | G-1a,G-2c |
| P28 — Gestione anagrafica ambulatori (create/update/predefinita/svuota/elimina) | `/settings/ambulatories` | Solo selezione, no gestione sedi | L elenco; S create/update/default/clear/delete assenti | R0/Ø | QS/QH | G-2c,G-3d |
| P29 — Cruscotto analytics locale (popolazione, età, diagnosi, ADI) | `/analytics` | ANA demografia host, non intero cruscotto diagnosi/ADI | L aggregato filtrato per età/fuso; nessuna S | Macchina ANA | QL | G-7b |
| P30 — Pannello audit operativo locale | `/analytics#audit` — `/api/system/audit` | Assente | L audit admin assente; nessuna S da introdurre | Ø | QL/QH | G-2g,G-7b |
| P31 — Apertura portali regionali SISS/FSE (context panel + handoff diary) | `#siss` — `siss-patient-context-panel.tsx`, `siss-handoff-diary.tsx` | Assente | L/S diario handoff locale e apertura esplicita da portare; nessuna connessione istituzionale promessa | Ø | QS/QH | G-6i |
| P32 — Cockpit shell / rail navigazione globale + toolbar + deep-link | Shell — cockpit/rail/toolbar/deep-link | NAV sette aree; niente router OS completo | L contesto; navigazione e rinvii Web; no seconda sessione implicita | R0/R1 | QL/QA/QP | G-1c,G-8b |
| P33 — Agenda di oggi / turno + bridge candidati agenda clinica | `/?area=turno` — agenda/candidati | SH agenda_view, intervallo e paziente | L aggregate; modifica via scheda; bridge calendario/candidati residuo | R0 | QL/QS | G-7b,G-6e |
| P34 — Diario clinico globale cross-paziente (ultime 50 voci) | `/diary` | SH global_diary_view con filtri e apertura paziente | L aggregate; S nella scheda, non nel feed | R0 | QL | G-7b,G-6b |
| P35 — Cruscotto repertori clinici (AIFA/esenzioni/ICD freschezza) | `/?area=repertori` — `kree8/areas/repertori-area.tsx` | REF lookup/contatori, link al Web | L stato/cataloghi; import e panoramica completa da allineare | R0 | QL/QH | G-7b,G-2f |
| P36 — Wizard nuova scheda da documento (PdfImporter + review + form) | `/patients/new` — `pdf-importer.tsx`, revisione/form | Solo anagrafica manuale | L estrazione/revisione e S composto da documento assenti | Ø/F | QD/QI/QS | G-4d,G-5c,G-6a |
| P37 — Pairing + login operatore + PIN (deriva master key) | Lock/onboarding — `lock-screen.tsx`, accesso v3 | SH login_view/TR; pairing già predisposto e passphrase | L auth/capability; S sessione; Touch ID/PIN e onboarding host non equivalenti | Stati login | QH/QA | G-1a,G-1b |
| P38 — Cambio PIN / gestione ciclo di vita chiave (rewrap/reset) | `/settings/accesso` — `recovery-kit.tsx` | Rinvio indice Settings | S cambio passphrase/PIN, rewrap/recupero assenti | Ø | QH | G-2a,G-1b |
| P39 — Blocco sessione immediato / stato sessione | Shell — blocco/stato sessione | SH request_discard(Lock)/disconnect, TR lock/logout | Ritiro locale immediato e logout remoto; nessun salvataggio automatico | Stati login/F | QH/QA | G-1a,G-1b |
| P40 — Profilo medico/ambulatorio (nome mostrato su documenti) | `/settings/profilo` | ACC nome medico/ambulatorio; profilo lavoro completo residuo | L/S profilo account condizionale | A | QS | G-2a |
| P41 — Preferenze UI: tema light/dark/system, riduci movimento | `/settings/aspetto` | SH temi Sistema/Giorno/Grafite, scala testo, contrasto | Stato locale finestra; persistenza/preferenze OS da completare | Selezioni UI | QA | G-2b,G-8c |
| P42 — Modalità Privacy / redazione dati | Shell/aspetto — `privacy-mode-toggle.tsx` | Assente come modalità riservata; lock distinto | L/S preferenza e mascheramento da collegare, non redazione d'egresso | Ø | QA/QH | G-2b |
| P43 — Conversazioni AI e messaggi | `/api/conversations`, `/api/messages` | Nessuna UI GPUI individuata; API storiche non provano consumer Web attivo | L/S storico applicativo da verificare con I-0, non nuova chat generica | Ø | QL/QI/QS | G-5e |
| P44 — Configurazione/invocazione runtime AI (Ollama/modelli/kill switch) | `/settings/ai/modelli`, funzioni — runtime Ollama | AI stato letto e preferenze; nessun runtime manager/inferenza | L stato; S sole preferenze, non provider/kill switch | R0/M | QH/QI | G-2d,G-5a,G-5b,G-5c |
| P45 — Cache pazienti cifrata offline (consultazione degradata) | Cache mobile; Web online | Nessuna cache persistente offline GPUI | Copia mobile fuori target U0; GPUI deve dichiarare nessuna copia e bloccare scritture offline | R0/R1 | QL | G-7a,G-1a |
| P46 — Backup: schedulazione automatica + ripristino manuale | `/settings/backup` | Rinvio generico `/settings` | L/S backup e schedule/restore assenti | Ø | QH/QP | G-3b,G-3c |
| P47 — Diagnostica: architettura servizi + Diagnostic Hub + service health | `/settings/diagnostica` | Rinvio generico | L service health/diagnostica assente | Ø | QL/QH | G-2g |
| P48 — Update Awareness (aggiornamenti software) | `/settings/diagnostica` — update-awareness | Assente | L stato versione/canale; aggiornamento e recupero da qualificare | Ø | QP | G-9a,G-2g |
| P49 — Repertori: import CSV AIFA + gestione DB esenzioni | `/settings/repertori` | REF lookup, rinvio panoramica Web | S import/clear AIFA/esenzioni/protesica/WHO assenti | R0/Ø | QL/QH | G-2f |
| P50 — Modelli AI: pull modello Ollama + profilo hardware | `/settings/ai/modelli` — pull/profilo hardware | Preferenze modello ≠ gestione modello | L catalogo opaco; S installazione/pull/profilo hardware assenti | M/Ø | QH/QI | G-2d |
| P51 — Kill switch funzioni AI (stato read-only rilevante al client) | `/settings/ai/funzioni` | AI ai_status_view, quattro kill switch osservati | L configurazione; S accensione/spegnimento assente | R0 | QL/QH/QI | G-2d |
| P52 — Network Operating Mode (gestione modalità boundary) | Configurazione rete host, `/api/settings/network` | Pairing e origine; nessuna amministrazione operating mode | L identità/capability; S modo host assente | Stati login/Ø | QH | G-3a,G-1a |
| P53 — Zona pericolo: reset onboarding + sviluppo (seeder, apri app nativa, DB repair/purge) | `/settings/zona-pericolo`, `/settings/sviluppo` | Assente | S reset/seeder/repair/purge/avvio nativo assenti; distinguere test e clinico | Ø | QH | G-3d,G-2g |
| P54 — Hub Impostazioni / governance (dashboard navigazione settings) | `/settings`, area governo — `live-governance-area.tsx` | SH settings_view parziale | L profilo/stato; niente hub amministrativo completo | A/R0 | QL/QA | G-2a,G-2g |
| P55 — POST/GET /api/context (imposta/legge ambulatory_id come cookie di sessione) | `/api/context` — cookie ambulatorio Web | SH change_scope; TR scope esplicito atteso | Cambio selezione e header scope; non scrive cookie browser | R0 | QL/QH | G-1a,G-2c |
| P56 — Pre-check locale documento (profilo→payload) via v1 | `/api/v1/fse/validate-document` | Assente; distinto dal pre-check paziente | L controlli locali del payload; nessun invio istituzionale | Ø | QL | G-6i |
| P57 — GET /api/service-catalog (catalogo prestazioni) + famiglie distinte /api/service-prescriptions e /api/service-prescription-items | `/api/service-catalog`, prescrizioni e item | Assente | L catalogo; S SP/item, tre famiglie da mantenere distinte | Ø | QL/QS | G-6g |
| P58 — POST /api/proxy/ollama/chat e POST /api/proxy/ollama/generate (proxy invocazione modello AI locale via Ollama), distinti da /api/conversations e /api/messages (CRUD storico) | `/api/proxy/ollama/chat`, `/generate` | Nessun invocatore GPUI generico | Solo servizi nominati del catalogo I-0; proxy non è grant di generazione né UI promessa | Ø | QI/QH | G-5e,G-1a |
| P59 — GET /api/system/mlx (stato/gestione generico runtime MLX via PM2, admin-only, solo macOS), distinto da /api/system/treatment-reasoning/athena-mlx (generazione ragionamento terapeutico specifico, kill-switch dedicato) | `/api/system/mlx`, distinto da `treatment-reasoning/athena-mlx` | Assente | L/S gestione runtime admin; generazione ATHENA separata | Ø | QH/QI | G-2d,G-5d |
| P60 — GET /api/system/redaction (stato/health provider OpenMed per redazione PII) | `/api/system/redaction` | Assente | L health redazione; non attesta broker C-B né assenza di identificativi | Ø | QL/QI | G-2g,G-5e |
| P61 — GET /api/system/revision (fingerprint/branch/revisione build corrente, usato per rilevare mismatch versione) | `/api/system/revision` | Protocollo/capability TR; nessuna schermata equivalente di fingerprint distribuito | L revisione host da collegare al ledger G-9 | Stati protocollo | QH/QP | G-1a,G-9a |
| P62 — POST/GET /api/system/fix-orphans (conteggio+riparazione righe cliniche orfane, admin-only) e POST /api/system/migrate-m2m (migrazione relazione paziente-ambulatorio da 1:1 a many-to-many, admin-only) — DISTINTI dal generico /api/system/migrate (setup ambulatorio di default) e da repair-db/purge | `/api/system/fix-orphans`, `/migrate-m2m` | Assente | L preview/snapshot; S manutenzione admin host, non normale update paziente | Ø | QH | G-3d |
| P63 — GET /api/v1/network/capabilities, /api/v1/network/identity, /api/v1/network/node (negoziazione capability host, identità di rete, sommario nodo) — famiglie boundary distinte da pairing-intents/confirm e session | `/api/v1/network/capabilities`, `/identity`, `/node` | TR negoziazione e binding scope; nodo non pagina completa | L capability/identità; pairing e login distinti | Stati protocollo | QH | G-1a,G-1b |
| P64 — /settings/ai (hub) — redirect al registro Fabric, vista reale in sola lettura | `/settings/ai` → `/settings/ai/fabric` | Nessun redirect GPUI equivalente | L registro host da collegare senza generazione | Ø | QL | G-2e |
| P65 — Registro Intelligence Fabric: 16 capability, 4 venue osservate e profili egress | `/settings/ai/fabric` | Assente; AI status non è registro Fabric | L capability/venue/egress, nessun enable implicito | Ø | QL/QI | G-2e |
| P66 — Governance AI: parliament dei modelli e prontezza al rollout | `/settings/ai/governance` | Assente | L/S controlli governance/readiness secondo servizi esistenti | Ø | QL/QH/QI | G-2e |

## Route Web e destinazioni paziente

Inventario ripetibile dei **36 file pagina** alla base. Le API non sono contate come pagine: le loro famiglie funzionali sono P01–P66 e il roster writer.

| Route / file fonte | Vista GPUI o disposizione |
| --- | --- |
| [/analytics](../../app/analytics/page.tsx) | ANA parziale → P29/P30; G-7b/G-2g. |
| [/diary](../../app/diary/page.tsx) | SH globale → P34; G-7b. |
| [/mockups/choices](../../app/mockups/choices/page.tsx) | Banco/confronto Web, nessuna funzione dati da migrare; riferimento G-8a/b. G-1c verifica che esposizione/deep-link non aggirino le route ordinarie; non conteggiato come schermata clinica pronta. |
| [/mockups/commands](../../app/mockups/commands/page.tsx) | Banco/confronto Web, nessuna funzione dati da migrare; riferimento G-8a/b. G-1c verifica che esposizione/deep-link non aggirino le route ordinarie; non conteggiato come schermata clinica pronta. |
| [/mockups/kree8](../../app/mockups/kree8/page.tsx) | Banco/confronto Web, nessuna funzione dati da migrare; riferimento G-8a/b. G-1c verifica che esposizione/deep-link non aggirino le route ordinarie; non conteggiato come schermata clinica pronta. |
| [/mockups/scheda](../../app/mockups/scheda/page.tsx) | Banco/confronto Web, nessuna funzione dati da migrare; riferimento G-8a/b. G-1c verifica che esposizione/deep-link non aggirino le route ordinarie; non conteggiato come schermata clinica pronta. |
| [/](../../app/page.tsx) | Sette aree NAV; `area=incarico/turno/repertori` → P01/P20/P32–35/P54; G-1c/G-7b/G-8b. |
| [/patients/[id]/edit](../../app/patients/[id]/edit/page.tsx) | ED PatientProfile parziale → P01/P23/P25; G-6a. |
| [/patients/[id]/entries/new](../../app/patients/[id]/entries/new/page.tsx) | SH Form Entry → P03–05; G-6b/G-1d. |
| [/patients/[id]/modules](../../app/patients/[id]/modules/page.tsx) | Sei sezioni GPUI contro quindici anchor: tabella sotto → G-6/G-8b. |
| [/patients/[id]/notes-review](../../app/patients/[id]/notes-review/page.tsx) | Web `PatientProfileNotesReview mode=commit`; GPUI Notes via servizio, non stessa UI di revisione → G-6b/G-6j, C-5b/C-8. |
| [/patients/[id]](../../app/patients/[id]/page.tsx) | Redirect Web a `modules`; GPUI apre profilo senza seconda vista → P01/P32; G-1c. |
| [/patients/[id]/review-pilot](../../app/patients/[id]/review-pilot/page.tsx) | Route soltanto development (`notFound` fuori sviluppo); confronto/review di riferimento → G-6j; non un nuovo percorso clinico in produzione. |
| [/patients/[id]/scales/[scaleId]](../../app/patients/[id]/scales/[scaleId]/page.tsx) | SCALE runner → P06; G-6f. |
| [/patients/[id]/scales](../../app/patients/[id]/scales/page.tsx) | SCALE area collegata → P06/P07; G-6f. |
| [/patients/import](../../app/patients/import/page.tsx) | CSV assente → G-4c/G-6a. |
| [/patients/new](../../app/patients/new/page.tsx) | ED manuale, nessun wizard documentale → P01/P36; G-6a/G-4d. |
| [/plugin-local-ui](../../app/plugin-local-ui/page.tsx) | UI navigazione/plugin separata, non incorporata nella shell GPUI; G-1a/c/G-6j raccordo con P-1/P-2 e C-3/C-8; prova nel proprio host. |
| [/scales](../../app/scales/page.tsx) | SCALE → P06/P07; G-6f. |
| [/settings/accesso](../../app/settings/accesso/page.tsx) | Inventario Impostazioni: Accesso → G-2a/G-1b; W-19a. |
| [/settings/ai/chatgpt](../../app/settings/ai/chatgpt/page.tsx) | Inventario Impostazioni: ChatGPT → G-2d; W-19j. |
| [/settings/ai/fabric](../../app/settings/ai/fabric/page.tsx) | Inventario Impostazioni: Fabric → G-2e; W-19k. |
| [/settings/ai/funzioni](../../app/settings/ai/funzioni/page.tsx) | Inventario Impostazioni: Funzioni AI → G-2d; W-19i. |
| [/settings/ai/governance](../../app/settings/ai/governance/page.tsx) | Inventario Impostazioni: Governance → G-2e; W-19l. |
| [/settings/ai/modelli](../../app/settings/ai/modelli/page.tsx) | Inventario Impostazioni: Modelli → G-2d; W-18b. |
| [/settings/ai](../../app/settings/ai/page.tsx) | Inventario Impostazioni: Redirect AI → G-2e; W-19k. |
| [/settings/ambulatories](../../app/settings/ambulatories/page.tsx) | Inventario Impostazioni: Ambulatori → G-2c/G-3d; W-19d. |
| [/settings/aspetto](../../app/settings/aspetto/page.tsx) | Inventario Impostazioni: Aspetto → G-2b/G-8c; W-19c. |
| [/settings/backup](../../app/settings/backup/page.tsx) | Inventario Impostazioni: Backup → G-3b/G-3c; W-18a. |
| [/settings/compliance](../../app/settings/compliance/page.tsx) | Inventario Impostazioni: Conformità → G-2g; W-19e. |
| [/settings/diagnostica](../../app/settings/diagnostica/page.tsx) | Inventario Impostazioni: Diagnostica → G-2g/G-9a; W-19f. |
| [/settings](../../app/settings/page.tsx) | Inventario Impostazioni: Indice → G-2a; W-17. |
| [/settings/profilo](../../app/settings/profilo/page.tsx) | Inventario Impostazioni: Profilo → G-2a; W-19b. |
| [/settings/repertori](../../app/settings/repertori/page.tsx) | Inventario Impostazioni: Repertori amministrazione → G-2f; W-18c. |
| [/settings/sviluppo](../../app/settings/sviluppo/page.tsx) | Inventario Impostazioni: Sviluppo → G-2g/G-3d; W-19g. |
| [/settings/zona-pericolo](../../app/settings/zona-pericolo/page.tsx) | Inventario Impostazioni: Zona pericolo → G-3d; W-19h. |

### Le quindici destinazioni della scheda

Fonte: [`modules/page.tsx`, `sectionAnchors`](../../app/patients/[id]/modules/page.tsx).
NAV ne espone sei: non si può dedurre la copertura delle altre dal solo Riepilogo.

| Anchor Web | GPUI corrente | Copertura finita |
| --- | --- | --- |
| `quadro` | `overview`, tabelle parziali | G-8b; P20, W-9 |
| `attenzione` | Nessuna destinazione dedicata | G-5a, G-6e, G-8b; P11/P19/P20 |
| `identita` | Testata e modifica anagrafica | G-6a, G-8b; P01 |
| `clinica` | Diagnosi lette nel Quadro; editing completo via Web | G-6a; P25 |
| `amministrazione` | Nessuna sezione completa esenzioni/report | G-6a/G-6i; P21–23 |
| `parametri` | `observations_view` | G-6d; P12 |
| `terapie` | `therapies_view` | G-6c/G-5d; P08–09 |
| `prestazioni` | Assente | G-6g; P13/P57 |
| `protesica` | Assente | G-6h; P14 |
| `scale` | Area Scale separata, percorso paziente collegato | G-6f/G-8b; P06–07 |
| `documenti` | `documents_view` | G-4a/b/G-5b/c; P15–18 |
| `siss` | Assente | G-6i; P31/P56, sola UI locale esistente |
| `timeline` | Nessuna timeline composita | G-6b; P03/P20 |
| `diario` | `diary_view`, form separato | G-6b/G-8b; P03–05 |
| `follow-up` | `checkups_view`, non intera proiezione da documenti | G-6e; P10–11 |

### Rinvii realmente collegati

`SH::open_current` aggiunge un path chiuso all'origine del servizio e apre
il browser; può essere necessario autenticarsi di nuovo. Non passa la
sessione nativa né assicura che il browser abbia lo stesso ambulatorio.
La verifica di contesto dopo il rinvio appartiene a G-1c.

| Controllo nativo | URL Web effettivo | Residuo |
| --- | --- | --- |
| Diagnosi/anagrafica completa nel Quadro | `/patients/{id}/edit` | G-6a |
| Diario, percorso completo | `/patients/{id}/modules#diario` | G-6b |
| Terapie, gestione completa | `/patients/{id}/modules#terapie` | G-6c |
| Parametri, gestione completa | `/patients/{id}/modules#parametri` | G-6d |
| Anteprima originale e gestione documenti | `/patients/{id}/modules#documenti` | G-4a/b |
| Account, dispositivi e archivio | `/settings` **solo indice**, non link diretto alle singole sottoviste | G-2/G-3 |
| Agenda / Diario globale, interfaccia corrente | `/?area=turno` / `/diary` | G-7b |
| Amministrazione repertori / WHO | `/?area=repertori` | G-2f/G-7b |

Il testo fallback in `area_view` per Agenda, Diario e Repertori è preceduto
dai return verso le vere viste: **non sono placeholder**. Viceversa non
esiste un rinvio dedicato per ogni funzione assente (CSV, Prestazioni,
Protesica, FHIR/PDF, SISS, ascolto): aprire genericamente il Web non colma
queste righe.

## Inventario Impostazioni, archivi e writer

**17 route**: indice + 15 sottoviste effettive + redirect AI. W-19 ne conta 12; Backup/Modelli/Repertori sono W-18. Il solo rinvio nativo è `/settings`: i path sotto sono destinazioni Web esplicite di confronto, non link GPUI già implementati.

| Route Web / fonte | Vista nativa | L/S e residuo | Stati | Unità G / W e prova |
| --- | --- | --- | --- | --- |
| [/settings](../../app/settings/page.tsx) | Profilo, aspetto, stato AI e rinvio Web; hub parziale | L profilo/stato; S solo percorsi ACC/AI | A/R0/M | G-2a; W-17; QL/QA/QS/QH |
| [/settings/accesso](../../app/settings/accesso/page.tsx) | Solo blocco/login; cambio credenziali e dispositivi via Web | L/S account, recovery e permessi mancanti | Ø | G-2a/G-1b; W-19a; QL/QA/QS/QH |
| [/settings/profilo](../../app/settings/profilo/page.tsx) | Nome medico e ambulatorio ACC; profilo lavoro da completare | L/S condizionali account; nessun nuovo writer paziente | A | G-2a; W-19b; QL/QA/QS/QH |
| [/settings/aspetto](../../app/settings/aspetto/page.tsx) | Tema, testo e contrasto di finestra; privacy e OS mancanti | Preferenze locali e persistenza da allineare | Selezioni | G-2b/G-8c; W-19c; QL/QA |
| [/settings/ambulatories](../../app/settings/ambulatories/page.tsx) | Selezione scope; nessuna gestione sedi | L elenco; S CRUD/default/clear/delete da collegare | R0/Ø | G-2c/G-3d; W-19d; QL/QA/QS/QH |
| [/settings/backup](../../app/settings/backup/page.tsx) | Assente | L/S export, schedule e restore host | Ø | G-3b/G-3c; W-18a; QL/QA/QS/QH |
| [/settings/repertori](../../app/settings/repertori/page.tsx) | Lookup altrove; nessuna gestione | L/S import/aggiornamento/clear AIFA/esenzioni/protesica/WHO | R0/Ø | G-2f; W-18c; QL/QA/QS/QH |
| [/settings/compliance](../../app/settings/compliance/page.tsx) | Assente | L informazioni/limiti, azioni documentate; no nuovi claim | Ø | G-2g; W-19e; QL/QA |
| [/settings/diagnostica](../../app/settings/diagnostica/page.tsx) | Assente | L servizi/revisione/update-awareness; azioni host autorizzate | Ø | G-2g/G-9a; W-19f; QL/QA |
| [/settings/sviluppo](../../app/settings/sviluppo/page.tsx) | Assente | L/S seeder e avvio nativo; fixture isolate, no accesso arbitrario a dati | Ø | G-2g/G-3d; W-19g; QL/QA/QS/QH |
| [/settings/zona-pericolo](../../app/settings/zona-pericolo/page.tsx) | Assente | L preview; S reset/repair/purge secondo porta host | Ø | G-3d; W-19h; QL/QA/QS/QH |
| [/settings/ai](../../app/settings/ai/page.tsx) | Nessun omologo necessario come pagina separata | Redirect Web a Fabric; verificare destinazione nativa | Ø | G-2e; W-19k; QL/QA |
| [/settings/ai/funzioni](../../app/settings/ai/funzioni/page.tsx) | Preferenze AI e stato quattro switch; non gestione completa | L preferenze/catalogo/stato; S preview/apply preferenze | M/R0 | G-2d; W-19i; QL/QA/QS/QH |
| [/settings/ai/modelli](../../app/settings/ai/modelli/page.tsx) | Solo scelta modello opaco nelle preferenze | L catalogo; S pull, profilo hardware e setup mancanti | M/Ø | G-2d; W-18b; QL/QA/QS/QH |
| [/settings/ai/chatgpt](../../app/settings/ai/chatgpt/page.tsx) | Assente | L/S account/custodia/consenso; generazione in G-5 separata | Ø | G-2d; W-19j; QL/QA/QS/QH |
| [/settings/ai/fabric](../../app/settings/ai/fabric/page.tsx) | Assente; stato AI non sostituisce registro | L capability/venue/egress; azioni soltanto ammesse dall’host | Ø | G-2e; W-19k; QL/QA |
| [/settings/ai/governance](../../app/settings/ai/governance/page.tsx) | Assente | L/S parliament/readiness/policy secondo contratto | Ø | G-2e; W-19l; QL/QA/QS/QH |

### Archivi e documenti

Nel client corrente «Archivio collegato» è l'origine del servizio. Cambiare
abbinamento non seleziona un file SQLite; scegliere l'ambulatorio non cambia
archivio. Il client non apre SQLite e non deve acquisire un writer alternativo.

| Oggetto | Esiste nel client | Consegna e prova mancanti |
| --- | --- | --- |
| Origine, pin TLS, dispositivo, sessione | Collegamento esplicito, v3 e blocco in memoria | G-1a/b: onboarding host, Touch ID/PIN, lifecycle; QH/QA |
| Archivio attivo e sua generazione | Scope e letture vincolati al servizio; `ArchiveReplaced` nel trasporto | G-3a/c: scelta/creazione/riapertura con autorità nominata; niente trasferimento di bozze dopo restore |
| Backup manuale e automatico | Nessuna UI/porta GPUI | G-3b, `/settings/backup`: file, destinazione, pianificazione, errori e annullamento |
| Ripristino e manutenzione | Nessun percorso GPUI | G-3c/d: preview, conferma forte, ricevuta, storico e chiavi, incompatibile/corrotto negati |
| Allegati manuali | Picker singolo, 10 MiB, upload cifrato, elenco, download esplicito senza apertura | G-4a: multipli, originale inline e stato per file; QD/QS |
| Fonte, estratto e sintesi salvata | DOC distingue mancante, illeggibile, formato ignoto e fonte diversa | G-4b: gestione e currentness; G-5b: nuova generazione separata |
| OCR e insight | Stato OCR letto; nessuna esecuzione/curation nativa | G-4b/G-5b/c tramite servizio host; non esporre il vecchio apply ritirato |
| CSV e paziente da documento | Assenti in GPUI | G-4c/d: righe proposte, duplicati, revisione e creazione senza merge implicito |
| Audio visita | Nessuna pipeline GPUI | G-1d con runtime Apple locale; C-9a condivide il servizio, non la prova di rendering |

### Writer collegati e writer mancanti

`FormKind` contiene **9 tipi**; Entry/Therapy/Observation/Checkup hanno anche
la variante di modifica in ED. Profilo account e preferenze AI sono altri
due percorsi mutanti fuori dal form clinico. La scelta tema/testo/contrasto
è stato locale di finestra, non un writer clinico. Il download scrive sul
filesystem scelto: è un effetto da verificare, pur senza mutazione della scheda.

| Ingresso GPUI | Lettura e scrittura attuali | Autorità / residuo / unità |
| --- | --- | --- |
| Notes | `open_patient_profile` → `update_patient_notes` → rilettura; versione osservata | Servizio profilo host, famiglia P; G-6b. Recupero note preserva bozza e richiede nuova conferma |
| PatientNew / PatientProfile | `create_patient` / `update_patient_profile`, verifica campi dopo risposta | Famiglia P, ingresso paired; G-6a. Estendere lifecycle e campi senza riscrivere dati non modificati |
| Entry create/update | `create_entry` / `update_entry`, ID/versione e rilettura | Famiglia E; G-6b. Mancano editor ricco completo, allegati compositore, lifecycle e revisione avanzata |
| Therapy create/update | `create_therapy` / `update_therapy`, picker identità AIFA e rilettura | Famiglia T; G-6c. Completare stati/ritiro/restore e raccordare C-5; il PUT paired non è DELETE |
| Observation create/update | `create_observation` / `update_observation` | Famiglia O; G-6d. Collegamento a prestazione Web non ammesso dal paired corrente: porta da definire |
| Checkup create/update | `create_checkup` / `update_checkup` | Famiglia C del roster, **distinta dal filone chat C**; G-6e. Transizione trusted headless ha contratto proprio |
| Document create | `create_attachment` → `read_attachment`, confronto nome/MIME/dimensione/byte | Famiglia D; G-4a. Nessun PUT/DELETE paired del dettaglio; gestione passa da porta host G-1a |
| Scale | catalogo → `prepare_scale` → `seal_scale_entry` → `create_scale_entry` / `read_scale_entry` | Voce diario preparata dall'host, non calcolo clinico locale; G-6f. Non generalizzare l'idempotenza scale agli altri create |
| AccountProfile | `read_account_profile` → `update_account_profile` condizionale | Profilo account, non scheda paziente; G-2a. Nome medico/ambulatorio ≠ gestione sedi o profilo di lavoro completo |
| AiPreferences | `read_ai_preferences` → `preview_ai_preferences` → `apply_ai_preferences` | Preferenze host, revisioni catalogo/preferenze; G-2d. Non abilita inferenza né configura segreti/provider |
| Download | `read_attachment` → `documents::write_download`, `create_new`, modalità Unix 0600 | Export esplicito, nessun overwrite; G-4a, gate SEC-2 sotto |
| Pazienti archivia/cestino/restore, diagnosi/esenzioni | Non collegati in GPUI | Famiglia P/M; G-6a. Bulk assign/unassign/move/duplicate senza UI Web non diventano funzioni native implicite |
| Diario/terapie/misure/checkup, ritiro e restore | Non esposti come percorsi completi GPUI | Famiglie E/T/O/C; G-6b–e. Usare semantica lifecycle esistente, non inventare DELETE paired |
| Prestazioni/item e protesica | Nessun writer GPUI | SP/PR; G-6g/h. DELETE protesica host ha CAS; nessun DELETE paired; scelte cliniche e collaudo distinti |
| Handoff SISS e report/export | Nessuna UI GPUI completa | Famiglia S per diario locale SISS; G-6i. Export non equivale a invio o ammissione istituzionale |
| Import CSV/documento e proposta agente | Nessun compositore equivalente | Caller composti X e servizi trusted; G-4c/d/G-6j. Il commit unico non si ottiene concatenando HTTP |
| Ambulatori, repertori e manutenzione | Solo letture di scope/cataloghi; mutazioni mancanti | A/M e amministrazione host; G-2c/f/G-3d. Preview/CAS/audit secondo ciascun ingresso |
| Backup/restore, credenziali, provider e modelli | Nessun writer nativo equivalente | Custodia, chiavi, generazione archivio e servizi amministrativi; G-1/2/3. Non ricondurli artificialmente al writer clinico ordinario |

Riferimenti per le scritture complesse: [roster, caller composti e confini](../clinical-write-roster.md#caller-composti-e-percorsi-senza-commit),
[ADR 0076](../adr/0076-paired-document-domain-write-policy.md),
[ADR 0142](../adr/0142-sqlite-maintenance-admission.md),
[ADR 0145](../adr/0145-rust-gpui-connected-client.md).
La revisione di una proposta non crea da sola l'autorità di applicarla:
Smart Import legacy resta `410`; un apply futuro richiede il contratto
esplicito di G-6j e dei servizi I/C pertinenti.

## Copertura della specifica Punto d'inchiostro

Il [crosswalk delle singole righe](./2026-10-23-gpui-spec-coverage.csv) enumera
le **205 righe dati** delle tabelle nei cinque documenti del dossier, con file,
riga alla base, contenuto completo, unità G, prova e disposizione delle
colonne non target. Le regole in prosa sono ricondotte qui senza trattare
il banco HTML come implementazione o come test nativo.

| Requisito in prosa o gruppo | Stato osservato / residuo | Unità e prova |
| --- | --- | --- |
| Colore, forma/parola, contrasto | Token Giorno/Grafite e `WritingInk` presenti; contrasto effettivo dei controlli e preferenze OS da verificare | G-8a/c, QA; G-2b |
| Tipografia, undici ruoli, font locali, numeri inline, prosa ≤64 caratteri | `TypeRole`, font inclusi, numeri con significato presenti. Tracking 0,05 em soltanto metadata nel pin GPUI; non dichiararlo renderizzato | G-8a/c, QA; correzione o decisione esplicita sul solo tracking |
| Matita e tratteggio | Bordo di blocco, non sottolineatura di ogni riga: approssimazione già accettata nella specifica. Provenienza prima di applicazione | G-8a, G-4b/G-5, QA/QI |
| Griglia, misure, adattamento, soglia entro il piano | NAV ha 700/1000 e scala fino a 4×; main minimo 390×640. I test geometrici non sono VoiceOver | G-8a/c, QA; target U0 supera il minimo macOS 14 del dossier storico |
| Stati di lettura, 5 s, dati parziali, errori tipizzati | R1 solo per oggetti VS; altri R0 o macchine dedicate. No copia offline inventata, no retry su diniego | G-7a/b, QL; G-1a per cancellazione reale |
| Soglia, livelli 1/2/3, autore/ora, esito incerto | `FormKind` ordinari passano tutti per Review; livelli graduati e conferma forte per distruttive da completare. Mai promettere atomicità di più richieste | G-6a–j/G-3/G-4, QS/QH |
| Conflitto e rilettura senza perdere bozza | Note e scale hanno recupero dedicato; altri form passano ancora per scarto/rilettura. Le note non certificano gli altri writer | G-6/G-7a, QS; gate SEC-1 |
| Provenienza documento, fonte di altro allegato, OCR storico, estratto abbreviato | DOC implementa stati salvati; DTO non attesta autore generativo, data sintesi né currentness originale | G-4b/G-5b, QD/QI |
| Navigazione, testata, elenco, anteprima, identità/allergia | Sette aree/sei sezioni GPUI contro quindici destinazioni Web; usare soltanto dati esistenti, dipendenza WUL-789 per dati strutturati | G-8b/G-6a, QA/QL |
| Quadro e Diario affiancati, voce viva, form e soglia | `overview` e sezioni presenti; diario non composto simultaneamente come D9/D16 e voce viva da allineare | G-8b/G-6b, W-9/W-15/W-16, QA/QS |
| D1–D5: principale, testata, aperture, campo scelta, creazione | Ruoli/geometry/disclosure comuni del Web non equivalgono a `button(primary: bool)` GPUI | G-8a/b e G-2d; QA/QS; riuso ricette Web 2–6 |
| D6–D7: collocazione proposte e riga modello | Inferenza non collegata; preferenze non sono pannello proposta | G-5a–e/G-2d, W-8/W-12/W-13, QI |
| D8–D10: destinazioni stabili, quattro tabelle, titolo unico | Sei sezioni non coprono i quindici anchor; contatori e zero/uno/molti da allineare | G-8b/G-7a, W-9/W-21c, QA/QL |
| D11–D12: panoramica repertori, stato di chi legge | Lookup reale; amministrazione Web distinta; R0/R1 da uniformare per singola vista | G-2f/G-7b, W-18c/W-20c, QL |
| D13–D16: azioni quiete, funzione spenta/bloccata, titolo shell, Diario principale | Non ereditare dal Web i menu e la gerarchia già corretti; AI status non misura disponibilità | G-8a/b/G-5/G-7b, W-7/8/15/20/21, QA/QI |
| Tastiera e controlli, ordine di lettura, focus dopo transizione | Binding per modificatore locale, input e recupero presenti; ascolto e menu macOS completi mancanti | G-8c/G-1c/d, QA |
| Movimento, trasparenza, contrasto e dimensione OS | Tema segue appearance; testo e contrasto sono controlli applicativi. Non trovati binding alle quattro preferenze OS; mancato movimento non prova il supporto a quelle animate future | G-2b/G-8c, QA; gate AX-3 |
| Ascolto: disclosure, asset italiani, 90 min/256 KiB, stati, niente audio persistito | Assente nel GPUI, runtime Swift esistente. Tutti gli stati della tabella ascolto sono assegnati nel CSV | G-1d/G-6b/G-8c; C-9a, QI/QS/QA; nessuna esclusione automatica del Mac |
| Mini/headless e superfici chat | Prove delle rispettive UI in C/P/Q; GPUI condivide servizi, non rendering o grant agentici | G-1a/G-6j/G-9a per raccordo; C-3–10 |
| Icona, installer e sito | Icona accettata secondo README del dossier; nota «candidata» in piattaforme è storica. Sito esterno alla repo, non una vista GPUI | G-9a verifica asset/corrispondenza; U0 non aggiunge rifacimento sito |
| Divieti della specifica e testi | Niente colore unico, dati inventati, mono per valori, successo parziale, blu decorativo, nuova cornice per record; parole di stato/verbi da verificare per ogni riga | G-7/G-8, QA/QS; tutte le righe Testi incluse nel CSV |

### Confini approvati, senza nuove esclusioni

U0 esclude GPUI Windows/Linux/mobile e nuove ammissioni/invii istituzionali.
La matrice delle piattaforme resta un riferimento storico: le colonne diverse
dal Mac non sono prove da produrre in G. Il sito è già separato dal repository
nel dossier; mockup e banco sono riferimenti G-8, non nuove schermate cliniche.
Le funzioni Mini e plugin hanno owner C/P e gate Q, mentre G copre il loro
raccordo all'autorità e all'UI nativa. Il contratto offline non ammette una
coda di scrittura; G-7 deve dichiarare la reale assenza di copia consultabile.

Non si propongono come escluse AI host, backup, diagnostica, protesica,
prestazioni, ascolto Mac o importazione: sono tutte assegnate. La limitazione
paired di ADR 0076 resta operativa finché G-1a non definisce una porta host
ammessa; l'inaccessibilità odierna non è un'esclusione approvata.

## Registro chiuso delle 40 unità PR G-1–9

| Unità PR | Risultato chiuso | Accettazione e confine | Dipendenze G, W, C e I | Prova |
| --- | --- | --- | --- | --- |
| G-1a | Porte, autorità e lifecycle | Roster porte cliniche/admin/provider/file, negoziazione revisioni e scope, cancellazione reale, revoca/restore; risolvere SEC-2/3 sul confine. Nessun SQLite nel client | Nessuna W bloccante; con C-4/C-5/C-8 condividere contratti, non grant; G-0 | QL/QS/QH |
| G-1b | Accesso e primo avvio Mac | Archivio predisposto e primo avvio, account v3, Touch ID/PIN nativi, passphrase/recupero, lockout e revoca. Nessun segreto in URL o log | G-1a; W-19a; C-4 condivide accesso ma ha prove host proprie | QH/QA |
| G-1c | Shell e decisione di adozione | Sette aree, menu Mac/deep-link, contesto dei rinvii, confronto old/new ripetibile su avvio/memoria/pacchetto/accessibilità e ADR di adozione sul Mac U0 | G-1a/b; W-17/W-20/W-21 e Web 1–6 come riferimenti; raccordo C-3/C-8 | QL/QA/QP |
| G-1d | Ascolto locale nella voce | Porta al runtime Apple, disclosure/permesso/assets italiani, tutti gli stati ADR 0113, 90 min/256 KiB, no audio persistito, binding paziente e bozza | G-1a; G-6b; W-16 per composizione; C-9a condivide runtime e corpus | QI/QS/QA |
| G-2a | Indice, profilo e accesso account | Hub e profilo lavoro completo, nome medico/ambulatorio, sicurezza account/dispositivi e ritorno con bozza; conflitto profilo riletto | G-1a/b; W-17/W-19a/b; raccordo C-4 | QL/QS/QH/QA |
| G-2b | Aspetto e modalità riservata | Persistenza preferenze, tema/sistema, testo/contrasto OS e privacy; differenza fra nascondere dati e redigerli per uscita | W-19c; G-8a; nessuna C bloccante, C-3b non sostituito | QA/QH |
| G-2c | Gestione ambulatori | Selezione ammessa, CRUD/default/albero sedi; clear/delete con G-3d; no default silenzioso dopo perdita scope | G-1a; W-19d; C-9b consumer successivo | QL/QS/QH |
| G-2d | Modelli, funzioni e account ChatGPT | Catalogo e scelta opaca, preferenze, switch, setup/pull/profilo hardware, account/quote/consenso. Sezioni distinte; non generazione a seguito del login | G-1a; W-18b/W-19i/j; I-0/4/5/6; C-7 riusa configurazione | QL/QH/QI/QA |
| G-2e | Fabric e governance | Registro capability/venue/egress, redirect AI, parliament/readiness; modelli/versioni da I-0, nessuna capability per sola presenza nel registro | G-1a; W-19k/l; I-0, C-7/C-8 allineano catalogo | QL/QH/QI |
| G-2f | Repertori amministrativi | AIFA/esenzioni/protesica/WHO: import/aggiornamento/clear, provenienza e freschezza; distinta dalla panoramica di consultazione | G-1a; W-18c/W-20c; nessuna C bloccante, C-8 riusa lookup | QL/QH |
| G-2g | Compliance, diagnostica e sviluppo | Pagine W-19e/f/g, stato servizi/revisioni/update, audit operativo/health redazione. Seeder e comandi distruttivi rinviati alla porta G-3d, senza claim ulteriori | G-1a; W-19e/f/g e W-21a per audit; C-B/C-10a per provenienza health/policy | QL/QH/QA |
| G-3a | Scelta/creazione archivio e modo host | Origine/pairing/scope/archivio distinti; apertura/creazione, network mode, cambio generazione e riapertura senza riuso di autorità | G-1a/b; W-19a; C-4 deve invalidare i grant sul cambio archivio | QH |
| G-3b | Backup ed esecuzione programmata | Export cifrato e schedule con destinazione, progresso, annullamento e file verificabile; errori espliciti | G-1a/G-3a; W-18a; nessuna C bloccante | QH/QD |
| G-3c | Ripristino archivio | Preview, soglia forte, versione incompatibile/corruzione, crash, ricevuta e rilettura; conservare record/chiavi/allegati/audit e invalidare sessioni | G-3b/G-1a; W-18a; C-4/C-5 devono osservare ARCHIVE_REPLACED | QH/QP |
| G-3d | Zona pericolo e manutenzione | Reset/repair/purge/fix-orphans/migrate-m2m e clear test sedi/seeder: inventario esatto, preview/snapshot, parole di conferma e annullamento; no azioni admin paired generiche | G-1a/G-3a; W-19d/g/h; nessuna C nuova autorità | QH/QS |
| G-4a | Allegati e originale | Picker multiplo, upload/readback, elenco/dettaglio/originale, download, ritorno/duplicato/assenza/illeggibile e punto di revoca SEC-2; esiti per file | G-1a; W-12; C-6 riusa file/estrazione, non il renderer GPUI | QD/QS/QA |
| G-4b | Archivio documentale e fonti | Insight, fonte/pagina, OCR storico, currentness, dettaglio/curation/delete tramite porte ammesse; separare sintesi salvata da proposta nuova | G-1a/G-4a; W-12; C-6/C-7 riusano provenienza; I-0 | QD/QS |
| G-4c | Import CSV | Mapping/anteprima per riga, duplicati, conferma, esiti parziali dichiarati e lista aggiornata senza perdere selezione | G-6a/G-1a; W-21c; C-8 catalogo eventuale, nessuna dipendenza da C-6 documentale | QD/QS |
| G-4d | Nuova scheda da documento | Estrazione → proposta → revisione → creazione; identità multiple/CF duplicato/OCR errato, istruzioni ostili, annullamento/crash; no record parziale come successo | G-4a/b/G-5c/G-6a/j; W-13b/W-16; C-6 servizio condiviso | QD/QI/QS |
| G-5a | Patient Insight | Generazione delle celle ammesse, fonti/ricevuta/consenso, collocazione in sezione, revisione; azioni sul risultato solo col writer G-6j | G-1a/G-2d/e; W-13a; I-0 e I pertinenti; C-7 stesso servizio, UI propria | QI/QS |
| G-5b | Document Synthesis | Generazione nuova dalle fonti correnti, stato/annullamento/revoca, risultato a matita e conservazione distinta dallo snapshot storico | G-4a/b/G-2d/e; W-12; I-0 e I pertinenti; C-7 | QI/QD |
| G-5c | Smart Import | Preview/estrazione con provenienza e revisione; no riattivazione apply legacy; scrittura derivata soltanto dopo contratto G-6j | G-4a/b/G-2d/e; W-13b; I-0 e I pertinenti; C-6/C-7 | QI/QS |
| G-5d | Treatment Reasoning | ATHENA/MLX locale con proposta/fonti/revisione; venue remote solo dopo I-3b e I-7. Inattivo/pronto/in corso/errore separati | G-2d/e/G-6c; W-8; I-3 e I-3b condizionale; C-7 | QI/QS |
| G-5e | Storico e capacità AI residue | P43/P58/P60: verificare consumer, storico conversazioni/messaggi e diagnostica redazione contro I-0. Servizi nominati, no proxy generico nuovo né modello libero; assenza consumer registrata senza inventare UI | G-1a/G-2e/g; I-0; W-19k/l per registro, C-B/C-7/C-8 per catalogo e uscita | QL/QI/QH |
| G-6a | Pazienti, diagnosi, esenzioni e lifecycle | Anagrafica manuale/campi mancanti, diagnosi/codici/esenzioni, archivia/cestino/restore; no bulk orfani. Preservare campi non modificati, audit e scope | G-1a; W-21c e Web testata/nav già integrati; C-8 consumer | QL/QS |
| G-6b | Note, Diario, editor e Timeline | Testo ricco/SOAP/allegati composti, note, create/edit/ritiro/restore, filtri storico, bozza e recupero dopo conflitto/risposta persa; SEC-1/4 | G-1a/G-4a per allegati; W-15a/b/W-16; C-5/C-8 stessi servizi, C-9a porta trascrizione | QL/QS/QA |
| G-6c | Terapie e stato | CRUD/stato/lifecycle/diagnosi, AIFA completo e manuale, livelli di soglia; comando/ricevuta durevole per stato terapia condivisi con chat | G-1a; W-7; contratto comune prima di C-5a/b, non dipendenza inversa | QL/QS |
| G-6d | Misure | CRUD/lifecycle, LOINC/UCUM, trend, precisione/stringhe qualificate e legame prestazione tramite porta ammessa; recupero bozza | G-1a; W-11; C-8 consumer dopo writer | QL/QS |
| G-6e | Controlli e Follow-up | CRUD/lifecycle, date/fuso, proiezione da documenti e deduplica, agenda e ponte candidati; transizione trusted distinta dal form ordinario | G-1a/G-4b per fonti; W-10/W-20a; C-9b/C-8 consumer, contratto trusted C-5 riusabile | QL/QS |
| G-6f | Scale | Catalogo/storico/percorso completo, risposta preparata da host, attempt/ricevuta, rilettura e accessibilità; non usare massimi inventati | G-1a; W-21b; C-8 consumer solo dopo servizio/catalogo | QL/QS/QA |
| G-6g | Prestazioni e item | Catalogo, prescrizione, item/stato e collegamenti alle misure; tre famiglie distinte e audit transazionale | G-1a; W-14a; C-8 consumer | QL/QS |
| G-6h | Protesica | Catalogo, CRUD, prescrizione/ausilio/collaudo; delete soltanto porta ammessa, soglia e CAS | G-1a/G-2f; W-14b; C-8 consumer | QL/QS |
| G-6i | Report, FHIR e UI SISS esistente | PDF/FHIR e pre-check locali, selezione/salvataggio espliciti; portali e diario handoff locale, senza nuovi adapter o invii istituzionali | G-1a; W-14c; C-8 soltanto capacità ammesse; vincoli Moduli conservati | QL/QD/QS |
| G-6j | Revisione agentica e scritture composte | Preview, consenso/step-up, paziente/payload/versione congelati, comando/ricevuta durevole e writer comune; niente atomicità simulata concatenando richieste | G-1a e writer relativo; W-16/W-13b; C-5a/b prima dell'uso chat, C-6/C-8 consumer; I per proposte | QS/QH |
| G-7a | Stati paziente e recupero | Tutte le sezioni/azioni P01–26: R1 coerente, parziali, 5 s/cancellazione vera, negato/illeggibile/stale/restore; SEC-1/3/4 per ciascun form | G-1a e writer/vista pertinente; W-10 e W della sezione; C-5/C-8 prove di race condivise, renderer distinto | QL/QS |
| G-7b | Viste globali e stati residui | Agenda, Diario globale, Repertori, Analisi completa e audit, liste/filtri/date/limiti, Impostazioni e documenti non ancora R1; nessuna casella R0 esclusa per omissione | G-1a; W-18/19/20a/b/c/W-21a/c; C-8/C-9b allineano dati | QL/QA |
| G-8a | Primitivi e grammatica visiva | Ruoli comandi/disclosure/menu/select/combobox, undici ruoli tipografici, inchiostri e scala spazi, QA di contrasto e tracking; tutte le righe del CSV pertinenti | Web 2–6 come ricetta, W-17/19c; nessuna C bloccante | QA |
| G-8b | Composizione scheda ed elenco | Quindici destinazioni, D1–D16, Quadro quattro tabelle, Diario principale, voce viva e soglia; dati presenti soltanto e conteggi stabili | G-8a e viste relative; W-7–16/W-21c, Web 3/4; C-8 conserva semantica, non layout | QL/QS/QA |
| G-8c | Accessibilità nativa e preferenze OS | Tutti i controlli/visti censiti: AccessKit/VoiceOver, menu/tastiera, focus, resize/testo 400%, contrasto/trasparenza/movimento; chiudere AX-1/2/3 e QUAL-1 | G-8a/b e ogni vista; W solo per confronto semantico; C-3/C-8 non sostituiscono prova nativa | QA |
| G-9a | Bundle installato, aggiornamento e recupero | Identità/hash/payload/firma, target e toolchain/runtime, installazione pulita sintetica, avvio/compito, upgrade/recupero; confronto del distribuito e gate immediati chiusi | Tutte le altre G accettate; I pertinente; W/C/P completi per Q integrata; C-10b pacchetto distinto | QP/QH/QA |

Le unità G-1a e G-8a possono partire dalla base corrente. I gate immediati
sotto precedono la promozione di qualsiasi nuovo bundle. Poi si procede per
verticali: porta → vista/writer → stati/accessibilità → installazione.
Non serve aspettare tutte le W per sviluppare le porte; serve la ricetta W
pertinente per accettare la composizione equivalente. C-5a/b dipendono dal
writer comune e da W-7: **G-6c non dipende dalla conclusione di C-5**.
C-6/C-7/C-8/C-9 consumano servizi comuni e hanno prove autonome per host.
G-9a accetta soltanto il candidato che riunisce le evidenze delle 39 unità
precedenti e la matrice I ammessa, con Q-1–9; non pubblica da solo la release.

## Gate immediati: distribuito, main e prova mancante

I rilievi qui sotto derivano da codice e metadati. Non è stata eseguita una
nuova sessione VoiceOver o una riproduzione con il binario installato.
«Nel distribuito» indica il **sorgente dichiarato dal bundle identificato**;
prima del giudizio finale G-9 deve verificarne la corrispondenza binaria.
Non si attribuisce al client GPUI un incidente su dati reali.

| ID | Evidenza e impatto | Stato rispetto a main | Gate, unità e condizione di chiusura |
| --- | --- | --- | --- |
| AX-1 | Il vecchio `threshold` accumula domanda, dettaglio e comandi senza la misura del piano oggi usata. A 390 px/testo 400% i comandi di recupero possono uscire dall'area utile; il diff successivo introduce modalità Compact/FullPlane, misura e budget etichetta | Correzioni presenti in main (`54b2fbe7a`, `a82ddbcd2`, `e399abcf0`); non presenti nella revisione del bundle | G-8c/G-9a: riprodurre i casi della suite `threshold_*` e interagire nel bundle nuovo a 390×640 e 400%; comandi leggibili, raggiungibili e focus visibile |
| AX-2 | Righe diagnosi/terapie/controlli e risultati senza identificatori accessibili stabili nel vecchio sorgente; rischio di nodi confusi o persi quando liste cambiano. Scala e righe hanno correzioni distinte | `dbc25bbd9` e `005e178e8` in main; catalogo Scale nuovo rispetto al bundle | G-8c: verificare identità/nome/ordine e attivazione con AccessKit e VoiceOver, anche dopo filtro e duplicati; non basta l'ID in un test |
| AX-3 | `text_scale=1`, `increased_contrast=false`; rendering usa questi valori e `window.appearance()`. I controlli manuali non sono un raccordo alla dimensione testo/contrasto del sistema. Nessun binding app individuato per riduzione movimento/trasparenza | Residuo anche in main; animazioni e materiali non presenti non sono difetti visivi osservati, ma manca la prova delle preferenze previste | G-2b/G-8c: modificare davvero le preferenze macOS, riaprire/variare finestra e verificare testo, colori, movimento/materiali pertinenti. Non promettere supporto OS prima della prova |
| SEC-1 | Nel vecchio `request_discard(Reload)` ogni form, incluse note dopo conflitto/esito incerto, passa per `Scarta e rileggi`; `finish_discard` ritira il form. Recupero che richiede perdita della bozza; dopo esito incerto manca la riconciliazione conservativa delle note | Note corrette da `08e416f54` e `35e5256e0`; main conserva percorsi di scarto/rilettura per altri form. Nessuna fusione automatica va introdotta | G-6a–f/G-7a/G-9a: conflitto e risposta persa per ciascun writer, bozza conservata e un solo effetto. Per create incerti identificativo/ricevuta durevoli o blocco esplicito fino a verifica; copia/scarto non valgono come riconciliazione |
| SEC-2 | `download_document` esegue lavoro in background: verifica `session.is_locked()` e poi `write_download`. `run` scarta soltanto il risultato UI di epoch vecchi; non cancella l'effetto filesystem. Cambio paziente/area non è lock. Resta inoltre un intervallo fra ultimo controllo lock e apertura/scrittura del file | Stesso schema nel distribuito e in main. Interleaving individuato staticamente, **non exploit riprodotto**; destinazione inizialmente scelta dall'utente | G-1a/G-4a: prova sintetica deterministica con barriera tra controllo e scrittura, cambio selezione/lock/chiusura; dichiarare e implementare il punto di non ritorno. Nessuna copia tardiva non annunciata dopo revoca; niente secondo salvataggio automatico |
| SEC-3 | `ArchiveReplaced` non è `is_auth_failure`; `run` non ritira universalmente il contesto per questo errore. `save_error` ha ramo speciale solo per Notes. VS mostra il caso, ma mostrare il testo non prova invalidazione di tutti i form/effetti | Recupero note coperto da test specifici; profilo account e scale hanno logiche proprie. Non è dimostrato un bypass del writer host | G-1a/G-3c/G-6/G-7: restore durante ogni lettura/scrittura/download, ritiro di bozze e autorità, nessuna vecchia richiesta accettata; rilettura su nuovo archivio soltanto dopo riapertura |
| SEC-4 | Più create ordinari conservano bozza dopo esito incerto, ma l'ID/ricevuta non è esposto in un journal durevole comune. `created_id` è previsto per PatientNew dopo risposta riconosciuta; Scale ha attempt dedicato. Riavvio/nuova creazione non ereditano una deduplicazione comune | Residuo di copertura in main e nel sorgente del bundle; non prova una duplicazione realmente avvenuta | G-6/G-4/C-5a: crash prima/dopo commit con risposta persa, query ricevuta autorevole e rifiuto del replay. Non risolvere con retry client né contando due risposte come due operazioni |
| QUAL-1 | Nessuna ricevuta corrente di VoiceOver/avvio/upgrade del binario identificato contro main; `TestPlatform` e test di nodi non sono il lettore nativo | Lacuna di qualifica, non difetto AccessKit automaticamente dimostrato | G-8c/G-9a, QA/QP. Gate sulla promozione del bundle; build e screenshot Linux storici non lo chiudono |

Ancore di verifica statica: main `shell.rs:791` (`next_epoch`), `:809`
(`run`), `:1610` (`request_discard`), `:1775` (`finish_discard`), `:2320`
(`save_error`), `:6618` (`download_document`), `:5828` (appearance),
`documents.rs:206` (`write_download`); vecchio sorgente `shell.rs:1370`,
`:1399`, `:5154`. I numeri si riferiscono alle revisioni dichiarate, non
alla futura head di prodotto. I test delle note sono in
[notes_recovery_tests.rs](../../experiments/gpui-patient-pilot/app/src/shell/notes_recovery_tests.rs).

Non sono difetti correnti: mancata lettura di un campo cifrato presentata
come vuoto (VS/DOC già la distinguono), pin TLS deliberato trattato come
disattivazione TLS, rinvio Web esplicitamente dichiarato, o assenza di una
coda offline vietata. Non si riaprono correzioni già integrate senza una
nuova evidenza: si porta il candidato corretto sul Mac e se ne verifica l'uso.

## Decisioni riservate e consegna G-0

1. **Adozione sul solo target U0:** G-1c deve presentare confronto e limiti;
   Leonardo accetta la shell installata, senza decidere qui gli altri target.
2. **Porte host:** G-1a propone il contratto per amministrazione, document-derived,
   voce e provider. Un semplice token paired non diventa grant amministrativo
   o consenso all'uscita. Se una funzione obbligatoria non è portabile entro
   il mandato, la decisione è un emendamento nominato, non un'esclusione tacita.
3. **Articolazione in PR:** confermare le 40 unità operative sotto i nove
   outcome di implementazione, oppure accorpare solo dove restano distinguibili
   accettazione e dipendenze. Nessuna nuova unità G-10 richiesta dal censimento.
4. **Tracking tipografico:** G-8a deve prima valutare il pin/API disponibili;
   se il requisito 0,05 em resta impossibile, chiedere una deroga limitata e
   documentata. Non è già approvata dal limite storico della toolchain.
5. **Decisioni U0 ancora aperte:** build Codex/Claude, policy e retention,
   grant/budget, account/provider/spesa, canale di distribuzione e revisori
   restano D1–D5/D-I1 e relativi owner. G-0 non le prende e non autorizza dati reali.

Nessuna esclusione funzionale nuova è richiesta per rendere completa questa
mappa: ogni riga ha un owner G oppure il confine U0 già approvato. Restano
aperte le prove e le decisioni di accettazione, non un residuo «tutto il resto».

### Verifica documentale

Eseguita nella worktree G-0, con Node **24.22.0**:

- `git diff --check`: riuscito.
- `rg --files -g '*.md' | sort`: inventario di **321 file**, nuovo documento inserito nell'indice.
- `node scripts/check-claims-guard.mjs`: **786 file**, nessun rilievo.
- `node scripts/check-claims-guard.mjs --self-test`: **25 violazioni sintetiche e 11 regressioni di mascheramento** intercettate.
- Il guard standard non comprende ogni file di `docs/analysis/`: le **stesse regole** sono state eseguite anche sul solo nuovo censimento, tramite copia temporanea fuori repository con root esplicita; **1 file, nessun rilievo**. Nessuna modifica al guard di prodotto.
- Riconciliazione documentale indipendente: **66 ID parità univoci**, **36 route pagina**, **17 route Impostazioni**, **205 righe della specifica** confrontate con testo e numero di riga originali, **40 unità PR univoche**, nessun riferimento a unità sconosciuta e collegamenti locali del censimento esistenti. Il CSV comprende 18 righe README, 112 della specifica, 29 dell'addendum, 35 di piattaforme/schermate e 11 dell'ascolto.
- Diff limitato a documentazione e crosswalk CSV. Nessun test runtime rieseguito e nessun PASS clinico/nativo attribuito a G-0. Gli esiti CI e la review del contributo restano nella PR; non sono anticipati da questo verbale.

## Delta del 30 ottobre 2026 — Impostazioni e documenti Mac

La tranche `codex/gpui-g2-g4`, da `dad877af34028b579894e301e1d69ff947263c1a`,
non chiude G-2 o G-4 e non introduce esclusioni approvate. Le righe originarie
restano il censimento della base del 23 ottobre; questa tabella ne registra il delta.

| Righe | Delta nativo | Residuo aperto |
| --- | --- | --- |
| P40/P41/P42/P54, G-2a/b | Indice con Profilo, Aspetto, Ambulatori, Modelli e Funzioni AI; modalità di navigazione esclusiva. Profilo e scelte locali mantengono gli editor esistenti. Ritorno all'indice con fuoco sul comando di apertura. | Il profilo non comprende la sicurezza account. Preferenze del sistema operativo e qualificazione completa G-8 restano distinte. |
| P38/P44/P50/P51/P64–66, G-2a/d/e | Stato dei modelli e preferenze già disponibili raggiungibili da pagine native distinte. Nessun rinvio al Web è contato come implementazione. | Cambio PIN/dispositivi, installazione/pull, hardware, interruttori, account ChatGPT, Fabric e governance non implementati. Le porte amministrative non esposte non sono un'esclusione dalla release. |
| G-2f/g | L'indice dichiara l'assenza delle pagine amministrative native. | Repertori amministrativi, compliance, diagnostica e sviluppo restano aperti; distruttive e archivi appartengono a G-3. |
| P15/P16/P18, G-4a/b | File vuoto respinto. Prima della revisione e della conferma, lettura dell'elenco corrente e confronto dei byte dei candidati di pari formato/dimensione. Duplicato anche con nome diverso: nessun nuovo invio. Fonte candidata assente/illeggibile/estranea: controllo fallito, nessun invio. Fasi di scelta/verifica/copia distinte nel tipo. | Controllo preventivo, non deduplicazione atomica fra client concorrenti. Import multiplo, originale inline, curation e cancellazione con precondizioni host restano aperti. Il rinvio Web precedente è sostituito dall'indicazione esplicita delle funzioni non disponibili. |
| G-4c/d | Nessun cambiamento. | Import CSV e nuova scheda da documento restano aperti, insieme ai servizi G-5/G-6 necessari. |
| G-7 pertinente | Le pagine riusano gli stati account/AI/documenti esistenti; bozza profilo conservata tra sottopagine, ritiro al blocco e ritorno del fuoco verificati. | Non è qualificata l'intera matrice degli stati G-0, né un'installazione o una sessione clinica sul candidato. |

Le catture comparative usano il renderer e finestre GPUI macOS reali con
stati sintetici predisposti da un harness temporaneo esterno al prodotto.
Non sono una prova di picker, trasporto, autorizzazioni, audit o cancellazione
contro l'host reale. Il writer e i contratti host restano invariati.
