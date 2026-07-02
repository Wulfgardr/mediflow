# Revisione UI/UX: come la webapp serve contenuti, viste e liste cliniche

Data: 2026-07-02
Autore: agente di engineering (Claude), su richiesta di Leonardo.
Metodo: workflow multi-agente con 8 corsie di ricognizione sul codice attuale (Scheda, ematici, farmaci, viste generali, navigazione, accessibilita, stati, token), verifica adversariale per corsia riaprendo ogni file citato, poi 6 proposte di design indipendenti (3 per il pattern lista, 3 per la sinottica paziente) giudicate da 4 giudici con lenti diverse (flusso clinico reale vs implementabilita a minore energia). Esito: 80 finding, 72 CONFIRMED, 8 ADJUSTED su dettagli, 0 respinti. Le affermazioni piu pesanti (variante dark scollegata, bug Agenda, catalogo LOINC a 7 codici) sono state ri-verificate a mano in questa sessione.

Nota di stile: questo documento evita il trattino lungo per convenzione di progetto.

---

## Parte 0: sintesi esecutiva

La domanda era: come serviamo contenuti, viste e interazioni, e come miglioriamo accessibilita, funzionalita e immediatezza, in particolare sulle liste affollate (ematici, farmaci) e sulla vista primaria del paziente.

La risposta corta, in cinque punti:

1. **Il lavoro di giugno e atterrato davvero ma si e fermato a meta strada.** L'observation-manager e una lista densa raggruppata con sparkline e skeleton; la Scheda ha la strip di segnali e due sezioni collassabili; il cockpit ha macchine a stati oneste e ricerca pazienti vera. Pero il pattern denso non e mai arrivato alle terapie, la progressive disclosure non e mai arrivata ai 6 manager pesanti della colonna primaria (il punto era gia annotato come "NEXT" a giugno), e i dialoghi nativi sono rimasti 71 (erano 72).
2. **Il collo di bottiglia degli ematici non e la resa, e il modello.** Il catalogo LOINC ha 7 codici (vitali piu glucosio): un emocromo non si puo proprio registrare. L'inserimento e una misura alla volta con reset della data a "adesso" dopo ogni salvataggio, l'unita non e legata al parametro (si puo salvare "Glucose 90 mm[Hg]"), lo schema non ha refLow/refHigh quindi il badge Alto/Basso e codice morto per costruzione. Ogni redesign estetico che ignora questi quattro fatti e cosmesi.
3. **La lista terapie e il paziente polifarmaco sono il debito piu visibile.** Card sempre espanse alte 5-7 righe con 4 bottoni ciascuna, ordinate per data di inserimento, senza conteggi, senza stato a colpo d'occhio, senza durata (startDate mai mostrata, endDate mai scritta), con flash di "Nessuna terapia attiva" durante il load e salvataggio che fallisce in silenzio senza protezione doppio submit.
4. **La direzione di redesign e decisa e giudicata**: per le liste vince il pattern "riga maestra + cascata" (una riga densa per entita, espansione in place, azioni solo nella cascata), con innesti clinici dalla flowsheet (vista "Per data" per leggere un prelievo intero, range di riferimento trascritti dal referto, catalogo esteso con nomi italiani e unita di default). Per la Scheda vince un percorso a due stadi: prima la cascata evolutiva (prop embedded sui manager + CollapsibleSection + riordino), poi il "Foglio clinico" sinottico che sostituisce la strip di conteggi con contenuto clinico vero (terapie con posologia, ultima misura con delta, problema guida) in una schermata senza scroll.
5. **Tre fondamenta trasversali vanno messe prima o insieme, perche ogni superficie ci sbatte contro**: (a) la variante dark: di Tailwind e scollegata dal toggle tema in-app (manca @custom-variant dark su Tailwind v4: fix di una riga); (b) useLiveQuery inghiotte gli errori e meta delle superfici mostra vuoti falsi durante il load; (c) 23 confirm, 47 alert e 1 prompt nativi su azioni cliniche, quando il dialogo accessibile giusto (patient-action-modal) e il combobox giusto (settings-search) esistono gia in repo e vanno solo estratti e riusati.

---

## Parte 1: cosa e migliorato da giugno (verificato sul codice attuale)

Prima i crediti, perche la fotografia di giugno non e piu quella attuale:

- **Ematici**: observation-manager riscritto per davvero (gruppi per codice, sparkline 12 punti, trend, skeleton distinto dal vuoto, virgola decimale accettata, aria-label sui delete, niente flag inventati per scelta documentata).
- **Scheda**: strip patient-clinical-signals sopra la piega, CollapsibleSection con auto-apertura su hash e figli montati solo da aperti, scrollspy con aria-current sulla rail, guard di load a pagina intera.
- **Cockpit**: la migrazione live e molto avanzata; macchine a stati esplicite idle/loading/ready/error; ricerca pazienti con normalizzazione diacritici; river-timeline bonificata dal meta-testo con footer onesto "ultimi N di M"; Quadro live (RealPatientArea) che e una vera sinossi e non una pila di card demo.
- **Accessibilita**: patient-action-modal e un dialogo completo (role, aria-modal, Escape, focus trap, restore); settings-search e un combobox ARIA completo (WUL-297); prefers-reduced-motion coperto globalmente con opt-in manuali; focus-visible molto piu esteso (17 regole in globals piu l'anello condiviso del cockpit); backup-restore ha sostituito confirm() con conferma a parola digitata.
- **Token**: e atterrato un vero tier system Liquid Glass tokenizzato (specular/vitreous/crystalline) con fallback per reduce-transparency, contrasto e stampa; le classi fantasma .input-field e .ui-btn-secondary ora esistono.

Cosa invece NON si e mosso: terapie e prestazioni (nessun intervento strutturale dal purge meta-testo), i 6 manager sempre espansi nella Scheda, i dialoghi nativi (71 occorrenze in 25 file, contate oggi), i tre autocomplete clinici senza tastiera, patient-list.tsx ancora orfano che ora trascina con se patient-agenda-worklist, e il catalogo LOINC fermo a 7 codici.

---

## Parte 2: i finding verificati, per superficie

Ogni finding e stato verificato da un secondo agente riaprendo il file citato; dove il verdetto e ADJUSTED la correzione e annotata. Qui i piu importanti; severita: A alta, M media, B bassa.

### 2.1 Scheda paziente (vista primaria)

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | Progressive disclosure mai estesa ai manager pesanti: Terapie, Prestazioni, Parametri, Protesica e SISS sempre espansi (~4.000 righe di componenti montati); il pattern swap vive solo nel mockup /mockups/scheda | modules/page.tsx:354-388 | prop `embedded` sui 6 manager (salta wrapper e header propri) + wrap in CollapsibleSection con count/summary; therapyCount e observationCount gia interrogati dalla pagina |
| A | Il Diario sta sotto quattro manager operativi, molto sotto la piega | modules/page.tsx:366 | riordino JSX: #diario subito dopo #timeline, nav aggiornata |
| M | Chip "N voci attive" non corrisponde: Timeline riceve anche le voci scala | modules/page.tsx:375-377 | passare entries filtrate su type !== 'scale' |
| M | Coda di revisione sempre aperta con 4 righe anche a zero punti di attenzione, spinge la clinica sotto la piega | patient-review-queue-summary.tsx:92-96 | CollapsibleSection con defaultOpen={attentionCount > 0} |
| M | La strip segnali e un elenco di conteggi: toni quasi inerti, "Parametri" mostra il totale storico, label a 10px | modules/page.tsx:181-201 | hint clinici veri (ultima misura, primi nomi farmaco, referti da rivedere con tone warning), label a 11-12px |
| M | Identity lens filtra solo ICD-11: paziente con soli ICD-9/10 apre una Scheda senza diagnosi visibili | patient-identity-lens.tsx:39-41 | fallback alle prime diagnosi di qualunque sistema con etichetta del sistema |
| M | Export FSE su alert/confirm nativi pur avendo PatientActionModal nello stesso flusso | modules/page.tsx:224-253 | variante conferma/esito generica di PatientActionModal |
| M | Protesica irraggiungibile dalla rail: nessuna ancora, nessuna voce nav | modules/page.tsx:364 | anchorStack #protesica + voce in workspaceNavItems |
| B | Form Parametri (6 campi) sempre aperto prima dei dati | observation-manager.tsx:205 | form dietro bottone "Registra parametro" |

### 2.2 Esami ematici / osservazioni

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | Catalogo LOINC pilota di 7 codici: un emocromo, elettroliti, funzione renale o epatica non si possono registrare; il form blocca codici fuori select | lib/terminology.ts:41-49 | estendere LOINC_PILOT con subset ematologia/chimica validato in-app (ADR 0070); oltre ~15 voci, combobox filtrabile |
| A | Inserimento una misura alla volta e observedAt resettata a "adesso" dopo ogni salvataggio: un referto da 15 analiti = 15 giri col rischio di timestamp sbagliati | observation-manager.tsx:156, 173 | conservare observedAt dopo il salvataggio, svuotare solo valore e note, focus sul select Parametro |
| A | Unita scollegata dal parametro: si salva "Glucose 90 mm[Hg]" senza errori, e il dato viaggia in PDF, cockpit e contesto AI | observation-manager.tsx:84-85, 208-269 | mappa LOINC->UCUM di default nel catalogo, autoset in onChange, modificabile |
| M | Range di riferimento: infrastruttura presente ma inerte, e lo schema non ha refLow/refHigh quindi non c'e dove trascrivere i range del referto | lib/db.ts:817-830 | refLow/refHigh opzionali su Observation + due input "Rif. min/max (dal referto)"; il badge Alto/Basso gia scritto si accende da solo, senza inventare nulla |
| M | Nessun collasso per analita: ogni gruppo renderizza l'intera storia, non regge anni di misure | observation-manager.tsx:360-421 | default ultime 3 misure + "Mostra tutte le N" |
| M | Confronto a pannello impossibile: un prelievo e frammentato in N gruppi con ordine instabile (recency) | observation-manager.tsx:107-134 | toggle vista "Per parametro / Per data" (stesso giorno = stesso referto in pratica) |
| M | Report PDF: il valore 0 diventa "-" (observation.value || '-') | lib/report-service.ts:284 | nullish coalescing ?? |
| M | Nel Quadro le osservazioni sono una riga di testo: observationsCount calcolato ma mai mostrato, nessun link a #parametri | kree8-clinical-cockpit.tsx:2017-2036 | pill con conteggio + link "Vai ai parametri" |
| B | Etichette LOINC in inglese come testo primario ovunque | lib/terminology.ts:42-48 | displayIt sulle voci, inglese retrocesso a metadata |
| B | Esempio di validazione "36.5" col punto mentre il codice accetta la virgola | observation-manager.tsx:146 | "ad esempio 36,5" |

### 2.3 Terapie e farmaci

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | La lista non scala sul polifarmaco: card sempre espanse con 4 azioni visibili, ordinamento per createdAt, nessun raggruppamento ne vista compatta | therapy-manager.tsx:47-49, 344-411 | pattern riga densa (vedi Parte 3) |
| A | DrugAutocomplete scarica l'intero catalogo AIFA a ogni ricerca digitata (db.drugs.toArray() nel debounce), ignorando la ricerca ?q= con LIMIT che il server gia espone | drug-autocomplete.tsx:36 | usare l'endpoint con query, o cache di modulo alla prima apertura |
| A* | Salvataggio terapia: errore silenzioso (solo console.error) e nessuna protezione doppio submit (doppio click = terapia duplicata) | therapy-manager.tsx:97-153, 326 | isSaving + disabled + feedback nel catch (pattern gia in observation-manager) |
| M | Flash di "Nessuna terapia attiva registrata" durante il load su un paziente in terapia (therapies \|\| []) | therapy-manager.tsx:59, 335-340 | ramo esplicito undefined con skeleton |
| M | Stato non evidente: niente badge "Attiva", niente conteggi in testata; su Prestazioni chip tutti neutri e "document-backed" in inglese | therapy-manager.tsx:167-187 | chip conteggio in testata, pallino di stato token-compliant piu parola |
| M | Durata invisibile: startDate mai mostrata, endDate mai scritta, "Conclusa il" usa updatedAt (mente) | therapy-manager.tsx:155-157, 459 | scrivere endDate su Concludi, mostrare "dal dd/MM/yyyy", leggere endDate ?? updatedAt |
| M | Modifica terapia AIFA: il campo Farmaco appare vuoto (defaultValue mai passato), il nome vive solo nell'hidden input | therapy-manager.tsx:253 | passare drugName come defaultValue reale |
| M | DrugAutocomplete senza semantica combobox ne tastiera (zero onKeyDown nel file) | drug-autocomplete.tsx:103-110 | copiare il pattern di settings-search (gia scritto e testato in-app) |
| M | Form Nuova prestazione: 18 controlli sempre visibili, incluse date di esecuzione e referto alla prescrizione | service-prescription-manager.tsx:401-595 | i sottotitoli esistenti diventano toggle, esito collassato di default |
| M | "Riattiva" visibile solo su hover (focus tastiera su bottone invisibile); cestino protesica senza nome accessibile | therapy-manager.tsx:462; prosthetic:334-336 | group-focus-within + aria-label |
| B | SissPrescriptionPanel orfano (mai montato) e fuori palette | siss-prescription-panel.tsx | montarlo nello stack #siss o rimuoverlo |

(* finding emerso nella corsia stati, collocato qui per pertinenza.)

### 2.4 Viste generali e cockpit

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | "Agenda di oggi" mostra i 6 checkup piu vecchi di sempre (filtro solo cancelled, sort ascendente, slice(0,6) su tutto il DB); "Appuntamenti oggi" resta quasi sempre a 0 | kree8-clinical-cockpit.tsx:880-895, 1423, 1485 | escludere completed e date passate, slice dopo il filtro, todayVisitCount sul set filtrato |
| A | Lista pazienti senza alcun ordinamento ne controllo di sort: ~193 pazienti in ordine di inserimento IndexedDB; lastTouch senza anno | kree8-clinical-cockpit.tsx:4243-4245, 4339 | sort updatedAt desc di default + chip "Nome A-Z / Recenti" + anno quando diverso dal corrente |
| M | Filtri ambito "Rete locale" e "Tutti gli ambulatori" morti in live: scope hardcoded 'ambulatorio' | kree8-clinical-cockpit.tsx:826 | nascondere i chip in live finche lo scope non e reale |
| M | KPI strip del Turno con 2 card su 4 fisse a "-" in live, una con freccia di trend simulata | kree8-clinical-cockpit.tsx:1436-1443 | collegare a conteggi reali o sostituire con card Diario alimentata |
| M | Diario globale: voce eliminata segnalata solo dal colore del pill (WCAG 1.4.1), 50 card pesanti senza filtri | kree8-clinical-cockpit.tsx:2994 | pill testuale "Eliminata" + filtro per tipo + una sola azione per riga |
| M | timeline.tsx: prompt() per la motivazione di eliminazione clinica, alert di fallback, palette indigo legacy; montato nella Scheda, non e orfano | timeline.tsx:16-42 | migrare al pattern modale accessibile; almeno lo swap colori subito |
| M | Analytics: palette K8_TONES in esadecimale fisso senza variante dark | analytics/page.tsx:58-79 | spostare i 4 toni in variabili --k8-tone-* con valori dark |
| M | Orfani: dashboard-insights (copy celebrativo bandito) e patient-list, che trascina patient-agenda-worklist | components/ | eliminare o spostare sotto mockups/; decidere il destino della worklist (unica delle tre a norma) |
| B | Doppio stato vuoto sovrapposto in load/errore nella lista pazienti | kree8-clinical-cockpit.tsx:1764-1781 | catena if/else unica |
| B | Bottone Documenti con stile e icona AI (Sparkles) che apre una demo statica; campanella inerte nel rail | kree8-clinical-cockpit.tsx:1239-1242, 4385 | icona FileSearch + classe standard; rimuovere la Bell |

### 2.5 Navigazione e architettura informativa

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | Stato del cockpit (area, paziente) non riflesso nell'URL: refresh e back perdono il contesto; la navigazione interna non aggiorna mai la URL (solo /diary e un deep-link parziale) | kree8-clinical-cockpit.tsx:4212 | sincronizzare ?area=&paziente= con history.replaceState e leggerli in app/page.tsx (props initialArea/initialPatientId gia esistenti) |
| A | Nelle sotto-aree Quadro/Documenti/SISS il rail dichiara "Pazienti": niente where-am-i ne back persistente | kree8-clinical-cockpit.tsx:235-243 | riga di tab contestuale persistente (Quadro · Documenti · SISS) sotto la Toolbar, con aria-current e nome paziente |
| A | Sidebar e MobileShellChrome sono chrome morto (nessuna route li renderizza) ma restano un secondo sistema di navigazione divergente, con dentro l'unico cambio sede rapido | root-runtime-shell.tsx:74 | invertire il default (fullscreen sempre), ricollocare il cambio sede, eliminare i due file |
| M | Fallback silenzioso al primo paziente del DB: azioni contestuali su un paziente mai scelto | kree8-clinical-cockpit.tsx:4237 | niente fallback, bottoni contestuali con nome paziente nell'etichetta |
| M | "Torna ai pazienti" porta a "/" che apre l'Agenda | settings/layout.tsx:19 e altri | backHref a /?area=incarico insieme al fix URL |
| M | Rail della Scheda non riflette l'ordine reale a colonna singola (#documenti prima di #siss, Protesica e Archivio assenti) | modules/page.tsx:202-213 | riordino dell'array + voci mancanti |
| M | Quadro vs Scheda: distinzione affidata a due bottoni giustapposti senza spiegazione | kree8-clinical-cockpit.tsx:1862-1869 | title/aria-label stabili ("Quadro: sintesi rapida", "Scheda: cartella completa") coerenti nelle 4 superfici |
| B | .backButton e .sectionLink senza :focus-visible dedicato; tre valori diversi di scroll-margin sotto lo stesso header sticky; tag statico "Mac principale" nel rail footer senza stato reale | workspace-shell.module.css | regola focus condivisa; variabile --k8-anchor-offset unica; nome sede reale o rimozione |

### 2.6 Accessibilita trasversale

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | 23 confirm(), 47 alert(), 1 prompt() su azioni cliniche reali; il peggiore: motivazione di eliminazione obbligatoria raccolta con prompt() nativo | timeline.tsx:16 e 25 file | estrarre da patient-action-modal un ConfirmDialog condiviso (Escape, trap, restore gia scritti); migrare prima timeline.tsx |
| A | I tre autocomplete clinici (farmaci, ICD, esenzioni) senza pattern combobox ne tastiera, mentre settings-search ha il pattern completo gia scritto (WUL-297) | drug/icd/exemption | copiare il pattern in-repo: combobox, listbox, frecce, Enter, Escape |
| A | Tutti i modali tranne due senza role=dialog, aria-modal, Escape, focus trap (new-visit-modal, move-modal, add-ambulatory-modal) | new-visit-modal.tsx:10 | hook condiviso useDialogA11y estratto da patient-action-modal |
| M | Righe popover: drug-autocomplete rimuove l'outline con sostituto quasi invisibile; .mf-popover-row senza :focus-visible | drug-autocomplete.tsx:16; globals:1776-1800 | regola .mf-popover-row:focus-visible col ring esistente |
| M | Ricerca pazienti del cockpit: outline azzerato senza alcun indicatore sostitutivo | cockpit.module.css:1478-1487 | :focus-within col token focus |
| M | Icon-button title-only (6 bottoni tra document-upload e timeline-entry-card) | document-upload.tsx:410+ | aria-label speculari con nome file/voce |
| M | Micro-testo 10px con rgba sub-muted sotto AA nel popover farmaci (3.0:1 e 2.2:1 calcolati) | drug-autocomplete.tsx:14, 157 | var(--mf-muted) + 11-12px |
| B | document-upload su palette legacy; doppio h1 (brand sidebar vs contenuto); schermate security/auth-health su palette legacy con alert nativi nel flusso PIN | vari | rimappare su token; declassare il brand a div; messaggi inline role=alert |

### 2.7 Stati: caricamento, vuoto, errore, feedback

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | useLiveQuery inghiotte gli errori: load infinito indistinguibile da errore in tutte le 28 superfici che lo usano | lib/live-query.ts:46-51 | export affiancato useLiveQueryState { data, error }, adozione graduale |
| A | patient-list flasha "Nessun paziente / Aggiungi primo paziente" durante il load (nessun ramo undefined nel file) | patient-list.tsx:160, 615, 661 | guard undefined con righe pulse (pattern observation-manager) |
| M | Nessun sistema toast: 54 alert() contati, incluse conferme di successo | tutta l'app | mf-toast con role=status aria-live=polite + useToast; migrare prima successi ed errori di salvataggio della Scheda |
| M | Pattern "dati \|\| []" maschera il load anche in case-lens e sezioni Scheda | vari | rami espliciti undefined |
| M | Scheda con id inesistente: "Caricamento scheda paziente..." per sempre (stesso schema in edit e scales/[scaleId]) | modules/page.tsx:113-125 | get(id) ?? null e stato onesto "Paziente non trovato" |
| M | Archivia/elimina paziente fallita: modal aperto, bottone riattivo, nessun messaggio | patient-action-modal.tsx:84-99 | useState error + paragrafo role=alert nel catch |
| M | aria-live/aria-busy quasi assenti (4 punti in tutta l'app, zero aria-busy) | vari | aria-busy sui contenitori skeleton/contenuto, role=status sui vuoti |
| B | 6 soli animate-pulse e copy di load non uniforme | vari | classe .mf-skeleton + SkeletonRows + formula unica "Caricamento [oggetto]..." |

### 2.8 Sistema visivo e token

| Sev | Finding | Dove | Fix a minore energia |
|---|---|---|---|
| A | La variante dark: di Tailwind e scollegata dal toggle in-app: Tailwind v4 CSS-first senza @custom-variant dark, tailwind.config.ts (darkMode 'class') mai caricato senza @config; le utility dark: (53 file) seguono l'OS, i token :root.dark seguono il toggle | globals.css:1-4; theme-provider.tsx:40 | UNA riga dopo gli import: `@custom-variant dark (&:where(.dark, .dark *));` poi ridurre/eliminare tailwind.config.ts |
| A | Colori semantici clinici triplicati con filosofie opposte: Scheda light neutralizzata (success=warning=info identici), Scheda dark colorata, cockpit saturo; il medico che passa da Quadro a Scheda perde il codice colore | globals:980-996, 1815-1831; cockpit:23-34 | eleggere --mf-critical/warning/success unica fonte; mappare chip e alert light sulle tinte gia usate in dark; alias k8/cockpit sugli stessi token |
| M | Quattro sistemi di token convivono (mf/glass/paper/ui globale, apple-* morto, k8-*, cockpit senza prefisso) con duplicazioni byte-identiche e derive (critical #9a3412 vs #a33a2f) | shell:4-47; cockpit:4-64 | kree8-tokens.css condiviso; cancellare i token apple-* orfani |
| M | Il blanket override sugli input del workspace shell persiste (raffinato ma con !important): .mf-input perde raggio 16px, glass e focus ring dentro la Scheda | shell.module.css:422-431 | ridefinire solo le custom property dentro .shell, o escludere .mf-input/.input-field dal selettore |
| M | Blu #2563eb ancora hardcoded nel mondo kree8 e due colori di focus ring sulla stessa pagina (blu k8 vs slate globale) | shell:26-29; cockpit:18, 39, 55 | puntare --k8-focus/accent ai valori slate, o promuovere il blu a token globale consumato ovunque |
| M | Dark mode a tre temperature (freddo globale, residui warm "Referto", slate puro kree8) | globals:127-163 vs 631-641 e altri | sweep find-replace dei 4 valori warm ricorrenti sugli slate equivalenti |
| M | Tipografia cockpit collassata su 10-13px (68 dichiarazioni su 75) con salto quasi diretto a 22-26px | cockpit.module.css | +1px su rowTitle/fieldValue/patientName (14px), meta a 12px, 10px solo per i kicker |
| M | var(--ui-btn-primary-fg) usata ma mai definita: CTA tono warning puo perdere il testo bianco (latente) | globals:2035 | cancellare la riga o definire la variabile |
| B | Adapter neutro WUL-273 a [class*=] + !important senza classe di esenzione; stack font incoerente body vs kree8 (con feature OpenType solo nel cockpit) | globals:2269-2379; globals:112 | guardia :not(.mf-chroma-keep); token --mf-font-sans unico |

---

## Parte 3: il redesign delle liste cliniche, "riga maestra + cascata"

Sei proposte sono state giudicate da 4 giudici. Sulla traccia liste: la lente clinica ha premiato la flowsheet tabellare (8/10) per la lettura per prelievo; la lente implementabilita ha premiato la riga maestra + cascata (9/10) come unica proposta la cui prima fetta e una ridisposizione verificabile di markup esistente. I due verdetti convergono pero sugli stessi innesti, quindi la sintesi e netta.

### Il pattern (base: proposta "riga maestra + cascata")

Ogni entita clinica (un analita, un farmaco) e UNA riga densa di ~44px che risponde in un secondo: nome, ultimo valore o posologia, stato, micro-trend, meta. La riga e un unico `<button>` (mai bottoni annidati) che si espande in place:

```
[nome]                    [valore/posologia]  [trend]   [meta]      [chevron]
Creatinina                1,12 mg/dL          +0,08 ~   9 mis.         v
Furosemide 25 mg          1 cp ore 8:00       * Attiva  dal 03/24      v
```

- **Livello 1, riga maestra**: nome semibold var(--mf-ink), valore tabular-nums, stato = pallino colorato PIU parola (mai solo colore), sparkline esistente riusata, separatori hairline, niente card.
- **Livello 2, cascata**: fondo leggermente arretrato; per un analita le ultime 5 misure (righe gia scritte in observation-manager), metadata LOINC mono, azioni "Registra nuova misura" e "Mostra tutte le N"; per un farmaco principio attivo, chip diagnosi, motivazione, ATC/AIC, "In corso dal", e le 4 azioni che ESCONO dalla riga ed entrano qui (la lista si sfoltisce, sparisce il rischio button-in-button, un'espansione accidentale non e mai distruttiva).
- **Livello 3, drill**: storia completa in place; per i farmaci le concluse diventano righe collassate.
- **ARIA**: disclosure per riga (button aria-expanded + region aria-labelledby, stesso schema di CollapsibleSection ma senza il componente: 30 righe non devono essere 30 listener hashchange e vetro-nel-vetro).
- **Stati**: skeleton al posto di therapies || []; vuoti onesti con le stringhe gia approvate; scritture con errore inline role=alert, niente alert().
- **Classe condivisa** `.mf-listrow` in globals.css con :focus-visible sul ring esistente (senza replicare il difetto di .mf-popover-row che ne e privo).

### Gli innesti obbligatori dai giudici

1. **Catalogo PRIMA della UI** (dalla proposta pannelli, entrambe le lenti): estendere LOINC_PILOT con `displayIt` (nomi italiani) e `defaultUnit` (mappa LOINC->UCUM autoimpostata nell'onChange). Senza questo, il pattern serve solo i vitali: e il vero sblocco degli "esami ematici". Il subset clinico va validato da Leonardo prima del merge, ma displayIt+defaultUnit sulle 7 voci attuali e una fetta indipendente immediata.
2. **Range di riferimento trascritti dal referto** (dalla flowsheet): refLow/refHigh opzionali per-osservazione nello schema + due input opzionali nel form. Nessun dato inventato: il range arriva dal referto cartaceo, e il badge Alto/Basso gia scritto si accende in modo onesto.
3. **Vista "Per data"** (dalla flowsheet): toggle "Per parametro / Per data" dove la vista per data raggruppa per observedAt e mostra il prelievo intero (l'emocromo a colpo d'occhio) ricavandolo DAI DATI, senza tabelle di mapping da validare. Con l'innesto "celle non registrate cliccabili" (dai pannelli): il click precompila code+unit+data nel form, e l'emocromo incompleto diventa una checklist di trascrizione.
4. **Micro-gesto di trascrizione** (gia nella base): "Registra nuova misura" precompila il form e porta il focus sul Valore; combinato col fix observedAt conservata, trascrivere un referto diventa: espandi analita, registra, analita successivo, stessa data.
5. **endDate scritta su Concludi** (tutte le lenti): il campo esiste gia nello schema; oggi "Conclusa il" mente usando updatedAt.
6. **Righe multiple aperte insieme** (Set, non openId singolo) almeno sui parametri: l'accordion esclusivo impedirebbe il confronto tra due analiti, gesto costante in polifarmaco.
7. **Tagli decisi dai giudici**: NIENTE roving tabindex in v1 (Tab nativo + aria-expanded bastano per una disclosure list; le frecce arrivano solo se l'uso reale le chiede); NIENTE utility dark: nel codice nuovo (vedi finding variante dark: nelle superfici nuove si usano token :root.dark espliciti); NIENTE riuso semanticamente sbagliato di is-recent/is-stale per gli stati terapia; NIENTE pannelli clinici curati finche la vista Per data non dimostra di non bastare.

### Fette di consegna (ognuna spedibile da sola)

1. Fondamenta CSS: .mf-listrow + .mf-skeleton in globals.css.
2. Micro-fix indipendenti: observedAt conservata, "36,5", defaultUnit+displayIt sulle 7 voci, endDate su Concludi, value ?? '-' nel PDF, defaultValue in edit AIFA, isSaving su onSubmit terapie.
3. Parametri collassabili: header gruppo diventa riga maestra, corpo diventa cascata con slice(0,5); si chiude "nessun collasso per analita".
4. Terapie a riga densa: card -> righe, azioni in cascata, sort per principio attivo, conteggi in testata, skeleton anti-flash, "dal dd/MM/yyyy".
5. Vista "Per data" + refLow/refHigh (schema + form).
6. Catalogo esteso validato + combobox filtrabile; poi propagazione del pattern a prestazioni e diario cockpit.

Verifica obbligatoria in fetta 3: rendering dentro il workspace kree8 (il blanket !important su input non tocca i button di riga, ma va confermato a occhio prima di propagare).

---

## Parte 4: il redesign della Scheda, sinottica a cascata in due stadi

Sulla traccia sinottica i giudici si sono divisi nello stesso modo: la lente clinica premia il "Foglio clinico a due livelli" (8/10, unica proposta che ottimizza i secondi-alla-comprensione), la lente energia premia l'evolutiva (9/10, quasi ogni citazione di riga esatta, zero componenti nuovi). Ma il giudice clinico stesso prescrive di spedire le fette della cascata PRIMA del foglio: quindi il percorso e sequenziale, non alternativo.

### Stadio 1, la cascata evolutiva (subito)

1. **Prop `embedded`** su TherapyManager, ServicePrescriptionManager, ObservationManager, ProstheticPrescriptionManager, SissPatientContextPanel, SissHandoffDiary: salta il wrapper section e l'header auto-intestato (6 diff piccoli). Attenzione all'id="prestazioni" interno al manager: in modalita embedded non va emesso (l'ancora la mette la pagina).
2. **Wrap in CollapsibleSection** in modules/page.tsx con count e summary oneste; per il primo giro bastano i conteggi gia interrogati dalla pagina. La composizione target e gia dimostrata e validata in /mockups/scheda.
3. **Riordino clinico**: #diario subito dopo #timeline; rail riordinata sull'ordine reale a colonna singola con voci Protesica e Archivio; ancora #protesica creata.
4. **Summary vere nelle card collassate** (secondo giro): "Ramipril 5 mg 1 cp, Furosemide 25 mg 1 cp e altre 5" CON posologia (la posologia e il dato, non il nome: debolezza capitale rilevata dal giudice clinico su summary di soli nomi), "Ultimo: PA 148/92 il 28/06".
5. **Protezioni**: `keepMounted` opt-in SOLO sui manager con form (una prescrizione a meta non si deve perdere collassando), non generalizzato (contraddirebbe il lazy mount che tiene la pagina leggera); disciplina undefined vs 0 (mai "Nessuna terapia" durante il load); fix Timeline (entries senza scale); coda di revisione collassata quando attentionCount e 0.

### Stadio 2, il Foglio clinico sinottico (la destinazione)

Il primo blocco della Scheda diventa un Foglio unico che sta in una schermata (target <= 520px di contenuto): non una griglia di card che urlano ma un foglio con hairline, tre pesi tipografici (600 solo per nome, problema guida e numeri; 500 per le micro-label; 400 il resto) e molto respiro.

- **A. Identita compatta** (una riga, non un hero): nome 17px semibold in PrivacyBlur, CF mono, eta, StatusGlyph.
- **B. Problema guida**: pill codice + descrizione 15px semibold; prima diagnosi di QUALUNQUE sistema (il foglio non eredita il filtro solo-ICD-11); ancora "+N problemi".
- **C. 3-5 segnali di contesto** in dl orizzontale: terapie attive, referti da rivedere (tone warning quando > 0), esenzioni, voci diario. Numeri onesti: niente "fuori range" senza range in archivio.
- **D. Terapie attive, una riga ciascuna**: drugName + dosage, cap a 6 + "+N altre"; e il gesto di inizio visita del medico col polifarmaco, in zero click.
- **F. Ultima misura con delta**: display + valore + data + variazione; ATTENZIONE (bug di progetto rilevato dal giudice): il delta va calcolato DENTRO il gruppo per codice come fa observation-manager, mai tra le ultime 2 osservazioni globali (confronterebbe PA di oggi con creatinina di ieri); guardia esplicita su value string ("120/80").
- **G. Prossimo follow-up** + **E. actionsDock** esistente ricollocato.
- Ogni riga del foglio e un `<a href="#sezione">` nativo: la CollapsibleSection sotto si apre gia da sola su hashchange. Zero stato nuovo, zero listener nuovi.
- Il foglio SOSTITUISCE la strip di conteggi (mai due sinottiche insieme); la identity lens completa scende sotto come livello 2.

### L'innesto architetturale (dalla proposta cockpit-first)

I numeri di Quadro e Scheda devono diventare identici per costruzione, o il medico smette di fidarsi (oggi "Parametri" in Scheda conta tutto lo storico mentre il cockpit conta le recenti). Percorso a due passi: subito, esporre toReviewCount da lib/patient-review-queue-summary (oggi e una variabile interna: 2 righe) e riusare i conteggi gia interrogati; in seconda battuta, estrarre buildPatientWorkspace dal cockpit in lib/patient-workspace.ts e alimentare il Foglio da li. L'estrazione NON e un move puro (classifyCheckupPill e formatWorkspaceDate vivono altrove nel file da 4.466 righe e servono anche all'agenda): e la fetta a maggior rischio, va fatta dopo, non come prerequisito.

### Chiarimento di ruolo Quadro vs Scheda

Con il Foglio, i ruoli si dichiarano da soli e vanno esplicitati anche nella UI (title/aria-label stabili sui bottoni): il Quadro e la sinossi operativa DENTRO il cockpit (triage, cosa fare ora), la Scheda e la cartella completa che si apre sul Foglio sinottico e scende a cascata nel dettaglio. Nessuna delle due duplica l'altra: il Quadro punta alle ancore della Scheda per ogni approfondimento.

---

## Parte 5: fondamenta trasversali (da fare presto, tutto il resto ci poggia)

1. **Dark mode coerente con UNA riga**: `@custom-variant dark (&:where(.dark, .dark *));` in globals.css dopo gli import. Poi, con calma, sweep dei residui warm e unificazione dei semantici clinici. Senza questa riga, meta delle utility dark: dell'app segue l'OS invece del toggle.
2. **Canale errori**: useLiveQueryState affiancato all'hook attuale; adozione su patient-list e Scheda per prime.
3. **Feedback civile**: mf-toast (role=status, aria-live=polite) + ConfirmDialog estratto da patient-action-modal + combobox pattern copiato da settings-search nei tre autocomplete clinici. Tutti e tre i "pezzi giusti" esistono gia in repo: il lavoro e estrazione e riuso, non invenzione.
4. **Skeleton unificato**: .mf-skeleton + guard undefined nelle superfici col pattern dati || [].
5. **Igiene navigazione**: stato cockpit nell'URL, tab contestuale nelle sotto-aree, rimozione del chrome morto (sidebar, mobile-shell-chrome, patient-list, dashboard-insights, siss-prescription-panel: decidere il destino, poi potare).

---

## Parte 6: roadmap consigliata

Ordinata per resa/sforzo, con le dipendenze esplicite:

| Fase | Contenuto | Sforzo |
|---|---|---|
| 0. Micro-fix del ciclo corrente | @custom-variant dark; observedAt conservata; defaultUnit+displayIt (7 voci); endDate su Concludi; isSaving terapie; value ?? '-' PDF; "36,5"; defaultValue edit AIFA; fix chip Diario/Timeline scale; guard undefined terapie e patient-list; sort lista pazienti; fix Agenda di oggi; aria-label e focus-visible puntuali (2.6) | piccolo, tutti diff da poche righe indipendenti |
| 1. Cascata della Scheda (stadio 1) | prop embedded sui 6 manager + CollapsibleSection + riordino + coda di revisione collassata; validare in /mockups/scheda | medio |
| 2. Liste a riga maestra | .mf-listrow; parametri collassabili; terapie a riga densa; conteggi in testata | medio |
| 3. Ematici veri | vista Per data; refLow/refHigh dal referto; catalogo esteso validato + combobox | medio, con gate di validazione clinica sul subset LOINC |
| 4. Foglio clinico sinottico (stadio 2) | patient-synoptic-sheet al posto della strip; toReviewCount esposto; delta per-codice | medio-alto |
| 5. Fondamenta feedback | ConfirmDialog condiviso (prima timeline.tsx), mf-toast, combobox nei tre autocomplete, useLiveQueryState | medio |
| 6. Navigazione e igiene | URL del cockpit, tab sotto-aree, chrome morto rimosso, unificazione semantici clinici e token k8 | medio |
| 7. Coerenza dati Quadro/Scheda | estrazione buildPatientWorkspace in lib (dopo il Foglio, non prima) | alto |

Le fasi 1 e 2 sono indipendenti e parallelizzabili. La fase 3 e il vero sblocco funzionale degli "esami ematici" e puo partire dalla fetta schema+form senza aspettare il catalogo validato.

---

## Appendice: metodo e limiti

- 8 corsie di ricognizione sul codice attuale (non sull'audit di giugno: ogni corsia ha prima verificato cosa era gia risolto), 10 finding max per corsia, ogni finding con file:riga riaperti da un verificatore adversariale istruito a cercare attivamente smentite nel repo. 8 finding su 80 sono stati corretti nel dettaglio (ADJUSTED), nessuno respinto.
- 6 proposte di design generate in parallelo con angoli imposti diversi (flowsheet, riga+cascata, pannelli; evolutiva, cockpit-first, foglio), giudicate da 4 giudici (2 lenti x 2 tracce) che hanno a loro volta riaperto il codice per verificare le affermazioni delle proposte; i verdetti citati in Parte 3 e 4 includono le imprecisioni trovate nelle proposte stesse (es. il bug del delta globale nel Foglio, il claim errato su toReviewCount "gia calcolato").
- Non coperto in questa tornata: la superficie nativa Apple (fuori scope, vedi review 2026-06-28), le pagine settings nel dettaglio, il flusso onboarding, e la verifica live a schermo (i finding sono tutti da codice; il banco /mockups/scheda resta il punto dove validare visivamente le fasi 1 e 4).
- Questo documento non modifica nessun claim congelato (wording zero-knowledge invariato) e non introduce dipendenze nuove in nessuna proposta.
