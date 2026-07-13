---
summary: "Secondary closeout of the July 2026 intelligent-stack review, with delivered slices, remaining boundaries, and a bounded roadmap."
read_when:
  - "Reviewing what the provider scaffold, document control-flow, and local open-loop slices actually delivered."
  - "Planning the next AI or deterministic-document-intelligence slice without reopening superseded branches."
---

# Evoluzione dello stack intelligente: closeout e roadmap

Data dell'analisi originaria: 2026-07-12. Stato verificato su `main`:
2026-07-13. Questo documento e `SECONDARY`: descrive il lavoro consegnato e le
prospettive, ma non prevale su ADR, `SECURITY.md`, `ARCHITECTURE.md` o
`docs/STATE_OF_THE_SYSTEM.md`.

Fonti canoniche principali:

- [ADR 0065](../adr/0065-intended-purpose-and-claims-guard.md): intended purpose e claims guard;
- [ADR 0070](../adr/0070-in-house-first-for-buildable-logic.md): logica costruibile in-house;
- [ADR 0077](../adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md): provider ed egress;
- [ADR 0079](../adr/0079-local-open-loops-and-result-link.md): attese locali e collegamento risultato-item.

## Tesi operativa

L'intelligenza utile non coincide con un modello piu grande. MediFlow usa una
scala in cui ogni gradino deve dimostrare che quello precedente non basta:

1. parser deterministico per strutture note;
2. euristica configurabile per segnali locali;
3. modello piccolo locale per task narrativi chiusi;
4. modello grande locale per sintesi e ragionamento review-first;
5. egress opzionale solo dietro redazione promossa, consenso e audit.

Ogni risultato deve conservare provenance, reversibilita e un fallback onesto.
Nessun gradino autorizza scritture cliniche automatiche.

## Stato consegnato

### Scaffold provider e confine egress

La prima estrazione del runtime e su `main`:

- `lib/ai-providers/ollama.ts` incapsula il trasporto Ollama;
- `lib/ai-service.ts` resta la facciata dei consumer esistenti;
- OCR e Treatment Reasoning hanno copertura kill switch/readiness local-control;
  l'associazione modello del rollout guard e estesa solo a OCR;
- `lib/ai-egress-gate.ts` applica il layer deterministico e resta chiuso con
  stato `closed_pending_redaction_lane`;
- l'audit egress registra metadati e hash, non contenuto clinico.

Il limite e intenzionale: `AIProvider` ammette ancora solo `ollama`. Non esiste
un adapter cloud operativo, il gate non puo aprirsi e nessuna impostazione
abilita egress clinico.

### Control-flow documentale

Il router deterministico non e piu soltanto informativo. La modalita
`off | shadow | active` e disponibile, con `shadow` come default. In `active`
lo skip del modello e limitato alle route esplicitamente eleggibili e ad alta
confidenza; il fallback resta `yellow`, citabile e senza auto-write su diagnosi,
terapie o altre entita cliniche strutturate.

L'audit del control-flow e PHI-safe e fuori dal percorso critico. Il risultato
non equivale a un parser strutturato completo per ricette o referti: evita una
chiamata al modello solo quando il contratto corrente lo consente.

### Attese locali

La prima micro-intelligenza dei flussi e consegnata nel solo perimetro web
locale:

- un'osservazione puo collegarsi a un item di prestazione dello stesso paziente;
- un item senza referto o osservazione collegata diventa attesa dopo 14 giorni;
- una serie con almeno tre date distinte puo risultare interrotta in base alla
  mediana degli intervalli e al fattore dichiarato;
- la Scheda mostra provenance e precompila il form, ma il salvataggio resta un
  gesto esplicito dell'operatore.

Il boundary `/api/v1` paired non trasporta il collegamento. Non esiste ancora
un registro generale persistente delle attese o un motore di reminder.

### Convergenza dei guard

Il guard MLX descrive MLX come benchmark-visible e diagnostica read-only,
mentre il runtime clinico resta Ollama. I report degli smoke paired sono
separati per test eseguito e il triage audit preservato e secondario. Queste
correzioni sono gia su `main`; non richiedono il recupero dei vecchi branch di
convergenza.

## Residui reali

| Priorita | Residuo | Stop rule |
| --- | --- | --- |
| P1 | Registry provider e binding `ruolo -> provider + modello` | Nessuna migrazione silenziosa delle chiavi o cambio del default Ollama. |
| P1 | Adapter locale OpenAI-compatible | Solo loopback o LAN paired dichiarata; benchmark e failure mode prima della UI. |
| P1 | Redaction layer 2 | Il gate egress resta chiuso finche una lane non raggiunge almeno `shadow-ready` con leak proibiti a zero. |
| P2 | Parser strutturati per ricetta SSN e referto laboratorio | Nessun fact clinico persistito senza ancore fonte e review. |
| P2 | Registro tipizzato delle attese | La prima slice non deve inventare cadenze o priorita cliniche. |
| P2 | Streaming e coda job locale | Nessuna nuova dipendenza o persistenza opaca senza boundary dedicato. |

## Sequenza consigliata

### Prossime slice

1. Registry provider locale con migrazione leggibile e default invariato.
2. Adapter OpenAI-compatible locale, prima in benchmark e poi in runtime
   dietro capability dichiarate.
3. Layer 1 davanti alla lane di redazione e benchmark del candidato neurale;
   nessun provider cloud finche il gate resta chiuso.
4. Parser deterministico di un solo formato documentale con corpus sintetico,
   reason code e benchmark di regressione.
5. Generalizzazione delle attese solo dopo avere misurato la prima slice
   risultato-item e serie interrotta.

### Orizzonte successivo

- profili hardware espliciti che dichiarano capability e degradazioni;
- distillazione verso modelli locali compatti su corpus governati;
- fact documentali ancorati e mappabili verso risorse interoperabili;
- regole e benchmark condivisibili senza condividere record clinici.

## Confini invarianti

- local-first e nessun cloud di default;
- AI assistiva e review-first, mai motore diagnostico o prescrittivo autonomo;
- nessuna PHI/PII in Git, benchmark o log;
- nessuna promozione di modello, provider o euristica senza prove ripetibili;
- stato consegnato, direzione e ipotesi restano distinti.

## Provenienza del closeout

Il dossier originario viveva su un branch divergente e usava il numero ADR
0074, poi assegnato a un'altra decisione. Questo closeout conserva soltanto la
tesi prospettica ancora valida, la riallinea agli ADR 0077 e 0079 e registra
come consegnate le slice confluite nelle PR pubbliche #39, #41, #42 e #43.
