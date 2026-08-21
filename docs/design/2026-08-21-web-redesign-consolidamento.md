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

- **Testata unica**: `PatientSynopticSheet` diventa l'unico header della vista;
  il Quadro parallelo (`real-patient-area`) viene assorbito ed eliminato. I dati
  duplicati (latestEntry in metrics e nextRows) collassano in una fonte.
- **Rail raggruppata**: 13 sezioni → **4 gruppi clinici** (Quadro e decisioni ·
  Terapie e prescrizioni · Documenti e prove · Diario e follow-up), espansione
  progressiva, sezione attiva sempre visibile. Oggi: `modules/page.tsx:507-521`.
- **Un solo diario**: la river clinica assorbe la lista Diario duplicata;
  i filtri sostituiscono la doppia visualizzazione. Oggi:
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

## 4. Fasi e verifica

| Fase | Contenuto | Accettazione |
| --- | --- | --- |
| **P0** | Tastiera + palette; testata unica Scheda; recovery degli stati | e2e smoke verde su `:3100`; nessun errore senza azione; shortcut documentati in `?` |
| **P1** | Rail 4 gruppi; fusione Diario/Timeline; touch coarse 44pt; heading disclosure; focus gap | matrice viste aggiornata; detector pulito sulle viste toccate; contrasto AA |
| **P2** | Debito CSS (dialetti, shadow literal, `!important`); settings unica; rotte orfane | nessun uso residuo di `.graphite-chip` nelle viste migrate; nav completa |

Verifica obbligatoria su `scripts/e2e-smoke.sh` (`:3100`, DB sintetico — mai
sul dev server personale `:3000`), detector impeccable sulle viste toccate,
screenshot golden per registro × viewport (320/390/768/1440 + zoom 200%).

## 5. Cosa non cambia

Registri giorno/grafite/guardia; modello focale fuoco/penombra/buio operativo;
il Filo; palette semantica desaturata riservata allo stato clinico; Inter +
IBM Plex Mono; zero vetro strutturale; onestà degli stati come firma. Il canone
(`docs/design/lume/canon/`) resta il riferimento.
