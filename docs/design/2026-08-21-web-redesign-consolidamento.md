---
summary: "Programma di consolidamento UI/UX web («un fuoco, una risposta»): risolve i P0–P1 della critique del 2026-08-21 dentro il canone Lume — una domanda una superficie, delta prima dei conteggi, ogni stato azionabile, tastiera prima classe, un solo dialetto CSS."
read_when:
  - "Pianificando o revisionando le superfici localhost del cockpit web."
  - "Prima di toccare navigazione, stati, tastiera o il dialetto CSS delle viste kree8."
---

# Web: un fuoco, una risposta

## 0. Premessa e baseline

Lume resta la lingua di riferimento
([ADR 0078](../adr/0078-lume-lingua-di-design-di-destinazione.md)): il programma
non sostituisce l'identità visiva, ma interviene su composizione, architettura
informativa, stati e velocità. La baseline è la valutazione di `app/patients`,
**23/40**, registrata in
`.impeccable/critique/2026-08-21T13-49-09Z__app-patients.md`, insieme a un
audit tecnico con 10 rilievi deterministici su 7 file. Il contrasto dei token
base è AA, eccetto i segnali raw su grafite.

Il problema non è riconoscere Lume, ma orientarsi nel lavoro: due superfici
rispondono alla stessa domanda, gli stati non offrono un'azione e il medico
esperto non dispone di percorsi rapidi. **La lingua è riconoscibile, ma
l'architettura informativa ne indebolisce l'utilità.**

## 1. Cinque principi del redesign

1. **Una domanda, una superficie.** «Chi è e cosa faccio ora» deve avere
   un solo luogo in cui trovare risposta.
2. **Variazioni prima dei conteggi.** «Che cosa è cambiato dall'ultima volta»
   serve più di «quante voci ci sono»: ogni metrica mostra la variazione
   oppure scompare.
3. **Ogni stato ha un'azione.** Secondo il contratto PRODUCT.md, caricamento,
   errore, offline e dato non più attuale devono dire che cosa è accaduto
   e che cosa si possa fare adesso.
4. **La tastiera è parte del percorso.** Chi apre 40 pazienti al giorno deve
   poter evitare passaggi ripetitivi del puntatore.
5. **Un solo dialetto CSS.** Le pill sono Lume; `.apple-*`, `.graphite-*`
   e l'adattatore `!important` hanno una dismissione programmata.

## 2. Interventi per vista

### 2A. Incarico (`/` area pazienti)

- **Case lens**: passare da 5 azioni simultanee a 1 primaria con menu delle
  altre azioni, mantenendo ≤4 opzioni visibili per decisione. Riferimento
  della baseline: `incarico-area.tsx:369-390`.
- **Recenti**: una fascia «visti di recente» sopra la lista permette di
  riconoscere il paziente anziché ricordarlo e alimenta anche la palette comandi.
- **Tastiera**: `/` porta alla ricerca, `↑/↓` scorre le righe virtualizzate,
  `Invio` apre e `n` crea una nuova voce. Il meccanismo
  `patientSearchFocusSignal` esiste già, ma manca il modello completo.

### 2B. Scheda (`/patients/[id]/modules`)

- **Testata unica**: `PatientSynopticSheet` diventa l'unica testata della vista,
  assorbendo ed eliminando il Quadro parallelo (`real-patient-area`). I dati
  duplicati, latestEntry in metrics e nextRows, confluiscono in un solo riferimento.
- **Navigazione raggruppata**: dalle 13 sezioni si passa a **4 gruppi clinici**
  — Quadro e decisioni, Terapie e prescrizioni, Documenti e prove, Diario e
  follow-up — con espansione progressiva e sezione attiva sempre visibile.
  Riferimento della baseline: `modules/page.tsx:507-521`.
- **Un solo diario**: il flusso clinico assorbe la lista Diario duplicata e
  i filtri sostituiscono la doppia visualizzazione. Riferimento:
  `modules/page.tsx:721-743`.
- **Espansione accessibile**: usare `<h2><button aria-expanded>` al posto
  dello `<span>` nel pulsante (`collapsible-section.tsx:85-88`) e `<h1>`
  sulla pagina.

### 2C. Stati

- Mostrare strutture di caricamento in tutte le viste: `SkeletonLines`,
  già presenti in `patient-synoptic-sheet.tsx:69-77`, sostituiscono i riquadri
  testuali «in attesa» di `real-patient-area.tsx:269-286`.
- Collegare «Riprova» a una nuova lettura per ogni errore di caricamento,
  a partire dalla lista (`incarico-area.tsx:230-233`).
- Segnalare sui dati clinici gli stati stale/offline, perché sapere se
  l'informazione è attuale fa parte della sua lettura clinica.

### 2D. Impostazioni e rotte orfane

- Riunire le impostazioni in una sola superficie: l'area governance del
  cockpit rimanda a `/settings/**` senza duplicarne i contenuti
  (`live-governance-area.tsx:31-79`).
- Portare `/analytics` e `/scales` nella navigazione oppure archiviarle
  come non raggiungibili: nella baseline esistono, ma nessuna UI le collega.

## 3. Sistema trasversale

| Area | Intervento |
| --- | --- |
| Tastiera | Modello unico: `/` cerca, `⌘K` palette, `j/k` lista, `Esc` chiude, `?` aiuto contestuale |
| Touch | `@media (pointer: coarse) { min-height: 44px }` su chip, quietAction, sub-tab, header/back button |
| Focus | `:focus-visible` dedicato su `.catalogRow`, `.stageBtn`, `.launcherTile`; alpha accent focus da 40% a piena opacità sul ring |
| Temi | Un solo ThemeToggle (doppio render osservato: `kree8-clinical-cockpit.tsx:435-471`) |
| CSS | Pensionamento programmato di `.apple-*`/`.graphite-*` verso pill Lume; `--lume-shadow-focal` al posto dei ~15 literal duplicati; budget per PR per smontare l'adattatore `!important` (`globals.css:1674-1784`) |
| Icone | Vocabolario minimo condiviso (≈24 glifi, stroke coerente): nella baseline i pulsanti standard sono l'unico punto senza carattere |
| Messaggi | `patientNavMeta = '!'` sostituito da messaggio Voce onesto (`kree8-clinical-cockpit.tsx:407`) |

## 4. Fasi e verifica

| Fase | Contenuto | Accettazione |
| --- | --- | --- |
| **P0** | Tastiera + palette; testata unica Scheda; recovery degli stati | e2e smoke verde su `:3100`; nessun errore senza azione; shortcut documentati in `?` |
| **P1** | Rail 4 gruppi; fusione Diario/Timeline; touch coarse 44pt; heading disclosure; focus gap | matrice viste aggiornata; detector pulito sulle viste toccate; contrasto AA |
| **P2** | Debito CSS (dialetti, shadow literal, `!important`); settings unica; rotte orfane | nessun uso residuo di `.graphite-chip` nelle viste migrate; nav completa |

La verifica è obbligatoria su `scripts/e2e-smoke.sh`, usando `:3100` e un
DB sintetico, mai il dev server personale `:3000`. Si affiancano il detector
impeccable sulle viste modificate e screenshot golden per registro ×
viewport (320/390/768/1440 + zoom 200%).

## 5. Cosa non cambia

Il consolidamento conserva registri giorno/grafite/guardia, modello focale
fuoco/penombra/buio operativo e Filo. Restano inoltre palette semantica
desaturata riservata allo stato clinico, Inter + IBM Plex Mono, assenza di
vetro strutturale e onestà degli stati. Il canone in `docs/design/lume/canon/`
continua a governare queste scelte.