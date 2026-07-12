# ADR 0078: Lume come lingua di design di destinazione multipiattaforma

Date: 2026-07-12
Status: Proposed (decisione di prodotto di Leonardo registrata il 2026-07-12; da marcare Accepted al merge del branch); implementazione gated dalle fasi L0-L6 di migrazione

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
   il filo come firma grafica con tratto = stato epistemico, due voci
   tipografiche (Voce e Registro), grammatica dell'attenzione.
2. **Vetro Clinico** (`docs/design/vetro-clinico/`) resta il canone operativo
   transitorio: ogni lavoro UI corrente lo segue, e le sue corsie di
   consolidamento DS-1..DS-3 sono prerequisito tecnico della migrazione.
3. La migrazione segue `docs/design/lume/03-migrazione.md` (fasi L0-L6 con
   gate); il flag di convivenza `data-lume` e strumento di sviluppo, non un
   selettore utente: ADR 0047 resta pienamente in vigore. La condizione di
   uscita da quella convivenza e formalizzata qui sotto prima che L1b la
   introduca.
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

Il flag `data-lume` e la convivenza dei due vocabolari di token sono temporanei.
Questa condizione di uscita e definita prima che L1b introduca il flag, cosi la
convivenza nasce gia con la sua fine scritta. Non e legata a una data di
calendario ma al raggiungimento congiunto di questi cancelli:

1. Tutti i consumatori previsti delle fasi L2-L5 (cockpit, Scheda, filo, voci,
   overlay e motion) sono migrati a Lume: non resta superficie in produzione
   che dipenda dal vocabolario di token legacy.
2. Il guard runtime a vocabolario-zero passa, cioe nessun riferimento residuo ai
   token o alle classi legacy compare nel runtime.
3. I cancelli visivi e di accessibilita richiesti passano: smoke sui tre
   registri e le coppie di contrasto misurate restano sopra soglia dopo la
   migrazione.

Quando i tre cancelli sono verdi insieme, si rimuovono il flag di sviluppo
`data-lume` e gli alias dei vecchi token: la convivenza finisce e Lume resta
l'unico vocabolario. Finche anche uno solo e rosso, la convivenza prosegue e il
flag resta strumento di sviluppo (ADR 0047).

## First Thin Slice

Fase L1a di `docs/design/lume/03-migrazione.md`: i tre registri di luce nel
sorgente token DTCG (`docs/design/lume/tokens/lume.tokens.json`) con misura
strumentale del contrasto (`scripts/check-lume-tokens.mjs`), senza toccare
alcuna superficie utente e senza introdurre ancora il flag `data-lume`. Questo
branch (WUL-55) e un candidato L1a, non adozione runtime: non esiste ancora
nessun consumatore. L1 si considera consegnata quando il contratto token e
mergiato e misurato; la convivenza runtime (L1b) arriva in un pacchetto
successivo, dietro la condizione di uscita qui sopra.
