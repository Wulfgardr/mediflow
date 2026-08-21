---
summary: "Programma di consolidamento UI/UX web («un fuoco, una risposta»): risolve i P0–P1 della critique del 2026-08-21 dentro il canone Lume — una domanda una superficie, delta prima dei conteggi, ogni stato azionabile, tastiera prima classe, un solo dialetto CSS."
read_when:
  - "Pianificando o revisionando le superfici localhost del cockpit web."
  - "Prima di toccare navigazione, stati, tastiera o il dialetto CSS delle viste kree8."
---

# Web: un fuoco, una risposta

## 0. Premessa e baseline

Lume resta la lingua ([ADR 0078](../adr/0078-lume-lingua-di-design-di-destinazione.md)):
questo programma **non cambia mondo**, cambia composizione, architettura
informativa, stati e velocità. Baseline misurata: critique `app/patients`
**23/40** (snapshot in `.impeccable/critique/2026-08-21T13-49-09Z__app-patients.md`),
audit tecnico con 10 finding deterministici (7 file), contrasto token base AA
tranne i segnali raw su grafite.

Diagnosi in una riga: **la lingua è giusta e riconoscibile; l'architettura
informativa la tradisce** — due superfici rispondono alla stessa domanda, gli
stati non sanno agire, il medico esperto non ha vie rapide.

## 1. Cinque principi del redesign

1. **Una domanda, una superficie.** «Chi è e cosa faccio ora» ha un solo luogo.
2. **Delta prima dei conteggi.** «Cosa è cambiato dall'ultima volta» batte
   «quante voci ci sono». Ogni metrica mostra la variazione o scompare.
3. **Ogni stato ha un'azione.** Contratto PRODUCT.md: loading, errore, offline,
   stale dichiarano cosa è successo e cosa si può fare adesso.
4. **La tastiera è un cittadino, non un accessorio.** Chi apre 40 pazienti al
   giorno non paga tassa per click.
5. **Un solo dialetto CSS.** Le pill sono pill Lume; `.apple-*`, `.graphite-*`
   e l'adattatore `!important` hanno una data di pensionamento.

## 2. Interventi per vista

### 2A. Incarico (`/` area pazienti)

- **Case lens**: da 5 azioni simultanee a 1 primaria + menu overflow (≤4 opzioni
  visibili per decisione). Oggi: `incarico-area.tsx:369-390`.
- **Recenti**: fascia «visti di recente» sopra la lista — riconoscimento invece
  di memoria; alimenta anche la palette comandi.
- **Tastiera**: `/` focus ricerca, `↑/↓` naviga le righe virtualizzate, `Invio`
  apre, `n` nuova voce. Il meccanismo esiste già
  (`patientSearchFocusSignal`); manca il modello completo.

### 2B. Scheda (`/patients/[id]/modules`)

- **Quadro e Scheda non sono sinonimi**: il Quadro nel cockpit resta la lente
  rapida «stato + prossima azione» e apre la Scheda. La Scheda è il workspace
  completo con testata unica e sezioni cliniche. Il Quadro non replica più
  terapie, documenti e azioni di dettaglio della Scheda.
- **Rail raggruppata**: 13 sezioni → **4 gruppi clinici** (Quadro e decisioni ·
  Terapie e prescrizioni · Documenti e prove · Diario e follow-up), espansione
  progressiva, sezione attiva sempre visibile. Oggi: `modules/page.tsx:507-521`.
- **Un solo diario**: la river clinica assorbe la lista Diario duplicata;
  `Diario` è la capability e `Timeline` la sua rappresentazione cronologica;
  l'anchor storico `#timeline` resta alias compatibile. Oggi:
  `modules/page.tsx:721-743`.
- **Disclosure corretta**: `<h2><button aria-expanded>` al posto di `<span>`
  dentro bottone (`collapsible-section.tsx:85-88`); `<h1>` sulla pagina.

### 2C. Stati

- Skeleton ovunque: `SkeletonLines` già esistono
  (`patient-synoptic-sheet.tsx:69-77`) e sostituiscono i tile testuali
  «in attesa» (`real-patient-area.tsx:269-286`).
- «Riprova» cablato al refetch su ogni errore fetch, primo di tutti l'errore
  lista (`incarico-area.tsx:230-233`).
- Badge stale/offline sui dati clinici: la freschezza è informazione clinica.

### 2D. Impostazioni e rotte orfane

- Una sola superficie impostazioni: l'area governance del cockpit rimanda a
  `/settings/**` senza duplicare contenuti (`live-governance-area.tsx:31-79`).
- `/analytics` e `/scales` entrano nella navigazione o vengono archiviate come
  non raggiungibili: oggi esistono ma nessuna UI le linka.

## 3. Sistema trasversale

| Area | Intervento |
| --- | --- |
| Tastiera | Modello unico: `/` cerca, `⌘K` palette, `j/k` lista, `Esc` chiude, `?` aiuto contestuale |
| Touch | `@media (pointer: coarse) { min-height: 44px }` su chip, quietAction, sub-tab, header/back button |
| Focus | `:focus-visible` dedicato su `.catalogRow`, `.stageBtn`, `.launcherTile`; alpha accent focus da 40% a piena opacità sul ring |
| Temi | Un solo ThemeToggle (oggi doppio render: `kree8-clinical-cockpit.tsx:435-471`) |
| CSS | Pensionamento programmato di `.apple-*`/`.graphite-*` verso pill Lume; `--lume-shadow-focal` al posto dei ~15 literal duplicati; budget per PR per smontare l'adattatore `!important` (`globals.css:1674-1784`) |
| Icone | Vocabolario minimo condiviso (≈24 glifi, stroke coerente): oggi i pulsanti standard sono l'unico punto senza carattere |
| Messaggi | `patientNavMeta = '!'` sostituito da messaggio Voce onesto (`kree8-clinical-cockpit.tsx:407`) |

## 4. Inventario capability Web

Questa tabella è l'inventario umano canonico del lato Web. È un input per
WUL-557 e per i consumer Mini/native futuri: **non è il contratto
machine-readable e non dichiara parity**. Gli stati `draft` indicano evidence
reviewabile non ancora promossa su `main`.

| Capability ID | Entrata Web | Azione osservabile | Stati/degradazione | Evidence Web |
| --- | --- | --- | --- | --- |
| `web.session.unlock` | `/unlock` | Sblocca la sessione locale con PIN | errore esplicito; nessun fallback cloud | `app/unlock/page.tsx`, main |
| `web.patient.list` | `/`, area Pazienti | Legge la worklist locale | loading, error/riprova, stale e offline azionabili | WUL-559, draft PR #186 |
| `web.patient.search` | `/`, ricerca Pazienti | Filtra la worklist; `/` porta il focus | lista vuota onesta | WUL-560, draft PR #189 |
| `web.patient.open` | worklist | Frecce/j/k/Home/End/Page e Invio aprono il paziente | selezione resta nell'indice virtuale completo | WUL-560, draft PR #189 |
| `web.patient.create` | `/patients/new` | Crea una nuova anagrafica con review esplicita | validazione inline; nessun auto-write da documento | `app/patients/new/page.tsx`, main |
| `web.patient.quadro` | cockpit, area Quadro | Mostra stato, segnali e prossima azione; apre Scheda | caricamento locale dichiarato | WUL-561, draft |
| `web.patient.scheda` | `/patients/[id]/modules` | Apre il workspace clinico completo | testata invariabile e rail a quattro gruppi | WUL-561, draft |
| `web.diary.read` | Scheda `#diario` | Legge voci, controlli e referti nella Timeline unica | vuoto/caricamento dichiarati dalle fonti | WUL-561, draft |
| `web.diary.write` | `/patients/[id]/entries/new` | Crea e firma una voce del Diario | bozza/review prima del commit | `app/patients/[id]/entries/new/page.tsx`, main |
| `web.therapy.manage` | Scheda `#terapie` | Legge e gestisce le terapie locali | vuoto e validazione espliciti | `components/therapy-manager.tsx`, main |
| `web.documents.review` | Scheda `#documenti` / area Revisione | Carica e rivede evidenze prima di applicarle | loading/empty/error; nessun auto-write clinico | `components/document-insights-panel.tsx`, main |
| `web.followup.manage` | Scheda `#follow-up` | Legge e pianifica follow-up | suggerimenti read-only finché non confermati | `components/followup-suggestions.tsx`, main |
| `web.handoff.prepare` | cockpit, area Handoff / Scheda SISS-FSE | Prepara il passaggio esterno senza simularne l'esito | offline può ritardare l'handoff; nessun claim di invio | `components/kree8/areas/live-handoff-area.tsx`, main |
| `web.settings.governance` | `/settings` | Modifica impostazioni locali e kill switch | controlli reversibili e locali | `app/settings/page.tsx`, main |
| `web.command.help` | cockpit | `Cmd/Ctrl+K` apre comandi; `?` apre aiuto | focus trap, Escape e ripristino focus | WUL-560, draft PR #189 |

Il consumer contract resta bloccato finché WUL-557 non pubblica e verifica la
forma machine-readable. WUL-564 resta il gate di verifica finale.

## 5. Carta senza colore vintage

`Carta` descrive continuità documentale, densità editoriale e poca decorazione;
non produce un colore. Il Web usa i token neutri correnti:
Giorno `#eef0f2`, `#f4f6f8`, `#fbfcfe`, `#e6e8eb`; Grafite `#121417`,
`#191c21`, `#22252b`, `#0e1013`. Guardia e Strumento non aggiungono tinte.
I precedenti `#f5f5f4` e `#fbfaf7` sono ritirati da runtime, mockup e asset Web.
Termini come `Paperclip`, `clinical-paper` o «cartaceo» possono descrivere
icone o dominio e sono falsi positivi finché non governano una superficie.

## 6. Fasi e verifica

| Fase | Contenuto | Accettazione |
| --- | --- | --- |
| **P0** | Tastiera + palette; testata unica Scheda; recovery degli stati | e2e smoke verde su `:3100`; nessun errore senza azione; shortcut documentati in `?` |
| **P1** | Rail 4 gruppi; fusione Diario/Timeline; touch coarse 44pt; heading disclosure; focus gap | matrice viste aggiornata; detector pulito sulle viste toccate; contrasto AA |
| **P2** | Debito CSS (dialetti, shadow literal, `!important`); settings unica; rotte orfane | nessun uso residuo di `.graphite-chip` nelle viste migrate; nav completa |

Verifica obbligatoria su `scripts/e2e-smoke.sh` (`:3100`, DB sintetico — mai
sul dev server personale `:3000`), detector impeccable sulle viste toccate,
screenshot golden per registro × viewport (320/390/768/1440 + zoom 200%).

## 7. Cosa non cambia

Registri giorno/grafite/guardia; modello focale fuoco/penombra/buio operativo;
il Filo; palette semantica desaturata riservata allo stato clinico; Inter +
IBM Plex Mono; zero vetro strutturale; onestà degli stati come firma. Il canone
(`docs/design/lume/canon/`) resta il riferimento.
