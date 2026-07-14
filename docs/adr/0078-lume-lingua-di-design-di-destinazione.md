# ADR 0078: Lume come lingua di design di destinazione multipiattaforma

Date: 2026-07-12 (ledger aggiornato 2026-07-15)
Status: Accepted (decisione di prodotto di Leonardo registrata il 2026-07-12; canone mergiato su main con PR #45); implementazione in corso lungo le fasi L0-L6 di migrazione (ledger in fondo)

---

## Problema

MediFlow ha una direzione visiva nata per traduzioni successive (Graphite, poi
Kree8/Liquid Glass) ma mai formalizzata come sistema: token consolidati a meta,
tre stili paralleli nel CSS, due sistemi di card sia web sia nativi, nessun
documento canonico che dica quale materiale spetta a quale superficie. Con la
lane tri-OS (ADR 0068, ADR 0071) in arrivo, senza un canone ogni piattaforma
reinterpreterebbe lo stile a modo suo.

Inoltre il paradigma "vetro" mostra limiti strutturali documentati: la
leggibilita del testo su superfici traslucide e fragile, il costo di
compositing e reale, e la stessa piattaforma che lo ha lanciato ne ha ridotto
l'intensita nel ciclo successivo.

## Contesto

- La review di design 2026-07-11/12 ha prodotto due corpora su branch
  `docs/design-review-vetro-clinico`:
  `docs/design/vetro-clinico/` (canone consolidato dello stato attuale) e
  `docs/design/lume/` (lingua nuova proposta, con dimostratore).
- Lume deriva da ricerca di mercato su tre lane GPT-5.6 con fonti
  (`docs/design/lume/02-derivazione.md`) e sintesi progettuale Fable.
- Vincoli invarianti: ADR 0047 (nessun selettore di stile UI persistito),
  ADR 0060 (cockpit alla root), ADR 0065 (claims guard), regole redazionali
  (niente trattino lungo, niente meta-testo, stati vuoti onesti), contratto
  WCAG 2.2 AA.
- Decisioni gia registrate nella review: direzione visiva unica su tutte le
  piattaforme; direzione calda/carta "Referto" per la UI respinta (2026-06).

## Opzioni

1. Consolidare Vetro Clinico e fermarsi: il vetro resta il paradigma.
2. Adottare Lume come lingua di destinazione, con Vetro Clinico come canone
   transitorio e il consolidamento come prerequisito tecnico.
3. Reinventare da zero per piattaforma (nessuna lingua unica).

## Trade-off

- Opzione 1: costo minimo, ma conserva i limiti del vetro (leggibilita,
  compositing, degrado su Linux) e non da a MediFlow una identita propria.
- Opzione 2: costo di migrazione reale (fasi L0-L6) ma identita distintiva
  (filo, due voci, modello focale), degrado multipiattaforma migliore per
  costruzione (Lume e opaca), accessibilita piu semplice da garantire.
- Opzione 3: parity di design impossibile da mantenere, contraria alla
  decisione di direzione unica.

## Decisione

Si adotta l'opzione 2:

1. **Lume** (`docs/design/lume/`) e la lingua di design di destinazione di
   MediFlow su tutte le piattaforme: modello focale (fuoco, penombra, buio
   operativo), materia opaca con registri di luce (giorno, grafite, guardia),
   tre portatori con ruoli distinti: la luce porta il fuoco, l'inchiostro porta
   lo stato epistemico e il filo continuo collega solo elementi realmente
   connessi nel tempo o nella provenienza. Le due voci tipografiche sono Voce e
   Registro; la grammatica dell'attenzione governa la priorita.
2. **Vetro Clinico** (`docs/design/vetro-clinico/`) resta il canone operativo
   transitorio delle superfici non migrate. Le corsie DS sono prerequisiti
   applicati per piattaforma e superficie, non un blocco globale: DS-1 governa
   i consumatori web coinvolti, DS-2 le slice strutturali native e DS-3 i flussi
   di feedback toccati. Le prime slice web hanno chiuso la parte necessaria del
   proprio perimetro; questo non dichiara DS-1..DS-3 complete in tutta l'app.
3. La migrazione segue `docs/design/lume/03-migrazione.md` (fasi L0-L6 con
   gate); il marker fisso `data-lume="true"` segnala la convivenza, ma non
   governa la cascata e non e un selettore utente: ADR 0047 resta pienamente in
   vigore. La condizione di uscita da quella convivenza e formalizzata qui
   sotto.
4. I segnali clinici e le leggi cliniche (colore = semantica, stati onesti,
   tastiera, AA) sono invarianti tra le due lingue.

## Conseguenze

- Ogni PR di design dichiara quale documento applica; le deviazioni si
  scrivono negli documenti di piattaforma, non si improvvisano.
- Il vetro strutturale e destinato al ritiro; gli investimenti su token,
  componenti di feedback e accessibilita si trasferiscono integralmente.
- Servira una decisione di dettaglio in fase L0/L4: scelta e bundling dei
  font della Voce e del Registro (candidati open con licenza OFL; su Apple
  restano SF Pro e SF Mono).
- La perlustrazione dei gestionali GP e degli applicativi provider USA
  (lane GPT-5.6, 2026-07-12) alimenta il raffinamento della grammatica
  dell'attenzione prima della fase L2.

## Condizione di uscita dalla convivenza `data-lume`

Il marker `data-lume` e la convivenza dei due vocabolari di token sono temporanei.
Ora che L1b ha introdotto il marker nel runtime web, questa condizione resta il
criterio per chiudere la convivenza. Non e legata a una data di calendario ma al
raggiungimento congiunto di questi cancelli:

1. Tutti i consumatori previsti delle fasi L2-L5 (cockpit, Scheda, filo, voci,
   overlay e motion) sono migrati a Lume: non resta superficie in produzione
   che dipenda dal vocabolario di token legacy.
2. Il guard runtime a vocabolario-zero passa, cioe nessun riferimento residuo ai
   token o alle classi legacy compare nel runtime.
3. I cancelli visivi e di accessibilita richiesti passano: smoke sui tre
   registri e le coppie di contrasto misurate restano sopra soglia dopo la
   migrazione.

Quando i tre cancelli sono verdi insieme, si rimuovono il marker di migrazione
`data-lume` e gli alias dei vecchi token: la convivenza finisce e Lume resta
l'unico vocabolario. Finche anche uno solo e rosso, la convivenza prosegue e il
marker resta evidenza tecnica della migrazione (ADR 0047).

## Ledger di implementazione

Il canone e Accepted; la migrazione resta in corso. Questo ledger distingue le
tranche gia atterrate su `main`, quelle consegnate sul branch nativo
`feat/lume-apple` in attesa di integrazione e quelle ancora aperte. Ogni riga
consegnata cita l'evidenza; il resto e lavoro dichiarato, non stato raggiunto.

Consegnate:

- **L0, canone e ADR**: questo documento e i contratti di piattaforma, mergiati
  (PR #45). PR #44 conserva Vetro Clinico come corpus storico e transitorio.
- **L1a, contratto token**: registri giorno/grafite/guardia nel sorgente DTCG
  (`docs/design/lume/tokens/lume.tokens.json`), con le trenta coppie
  testo/superficie misurate da `scripts/check-lume-tokens.mjs` (PR #47).
- **L1b, convivenza runtime web**: mirror CSS `app/lume-tokens.css` importato da
  `app/layout.tsx`; l'HTML espone il marker fisso `data-lume="true"`, mentre gli
  alias attivi mappano giorno su `:root` e grafite su `.dark`, con verifica di
  allineamento al sorgente e test runtime (PR #48). Il marker non e un gate ne
  un selettore utente. La guardia resta nel sorgente ma non e un tema attivo.
- **Prime superfici Lume (web)**: cockpit (PR #49), shell del workspace clinico
  con fuoco focale via `data-lume-focus` e scrollspy (PR #52) e lock screen
  (PR #53), con smoke E2E.
- **Thin slice nativa (macOS)**: la card clinica diventa opaca su ogni OS
  (`clinicalCardStyle()`, alias `cardStyle()`, `GlassCard` deprecata e resa
  opaca) con test sintetico light/dark (`ClinicalCardStyleTests`) e build del
  bundle (PR #46).
- **Spacchettamento workspace nativo, branch `feat/lume-apple`**: il workspace
  pazienti condiviso e separato in viste coese senza modificare
  `PairedPatientsWorkspaceModel`, `MediFlowCore` o le API pubbliche.
- **LumeKit nativo, Wave N2, branch `feat/lume-apple`**: `LumePalette` code-first con registri
  giorno/grafite/guardia e parita fail-closed rispetto al JSON, superfici
  opache `LumeSurface`/`LumeCard`, connettore reale `Filo`, `RigaLista`,
  `.registro()`, `.lumeInchiostro(bozza:)` e chrome `lumeGlass`, mantenendo gli
  alias Vetro per i consumatori non ancora migrati.
- **Adozione L2-L4 nativa, branch `feat/lume-apple`**: worklist, Scheda,
  diario e impostazioni del client accoppiato adottano le primitive Lume. Il
  diario usa una sola spina continua nel contenitore; testata, metriche e righe
  cliniche degradano in verticale alle categorie Dynamic Type accessibility;
  il Registro resta confinato ai valori e l'inchiostro alla bozza generata.
  `StatusBadge` e opaco. Il CF e abbreviato nelle liste e nella testata, mentre
  il valore completo resta nel dettaglio protetto dal privacy shield.
- **Grammatica del gesto e del movimento (canone e dimostratori)**:
  `07-gesto-e-movimento.md` distilla il livello di interazione e motion con una
  resa rivista del filo (la luce marca il fuoco, l'inchiostro porta lo stato, il
  filo resta connettore come geometria SVG), con cinque dimostratori interattivi
  in `mockups/`. Revisiona la resa descritta in `01-lingua.md` par. 3 e 7. La
  specifica non implica adozione completa: la tranche nativa sopra applica il
  contratto alle superfici dichiarate, mentre gli altri consumatori restano da
  migrare.

Aperte:

- Componenti interni e viste web non ancora migrati: Vetro Clinico resta il
  canone operativo transitorio delle superfici non toccate.
- Attivazione contestuale del registro guardia nelle viste, tipografia bundle
  della Voce, completamento del Registro oltre gli atomi adottati e motion
  nelle viste. Guardia resta soltanto un raffinamento ambientale del dark, non
  un tema utente.
- Coda dell'attenzione, trigger contestuale della guardia, snapshot parity
  completi e un target XCUITest macOS dedicato restano aperti.
- Il glifo allergie della testata compatta non e mostrato: il modello paired
  non espone un dato strutturato affidabile e la UI non lo inferisce.
- Le prove iOS includono build, suite UI e catture Dynamic Type; VoiceOver e la
  QA manuale macOS end-to-end restano gate separati.
