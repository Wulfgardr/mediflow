# ADR 0117: Headless portabile agent-first e Fabric capability-first

Date: 2026-09-02
Status: Accepted

Controller: [GitHub #276](https://github.com/Wulfgardr/mediflow/issues/276)
Delivery: [GitHub #281](https://github.com/Wulfgardr/mediflow/issues/281),
[GitHub #285](https://github.com/Wulfgardr/mediflow/issues/285) e
[GitHub #287](https://github.com/Wulfgardr/mediflow/issues/287)
Program line: candidata `0.8.5`
Evidence base: `2b2944eb3e17da033f54e9d1b44f4f84972e65f1`

Related: [ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md),
[ADR 0107](./0107-anydoc-local-attachment-extraction.md),
[ADR 0111](./0111-deepseek-ocr2-selective-page-routing.md),
[ADR 0112](./0112-provider-v2-secret-broker-and-official-cloud-adapters.md) e
[ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md).

## Problema

La prima slice MCP di ADR 0114 prova discovery e stato non-PHI ma dichiara zero
operazioni generali grantable. Non basta come superficie Headless utile. La
topologia macOS descritta dalla stessa ADR, inoltre, non deve rendere XPC,
Apple Vision, MLX, Xcode o una shell nativa prerequisiti del core.

Il programma OCR riaperto ha anche legato troppo strettamente la capability a
DeepSeek-OCR 2/CUDA. Questa scelta non è portabile e confonde il contratto OCR
con un adapter per un particolare modello e acceleratore.

MediFlow deve offrire dopo il clone un percorso agent-first equivalente su
macOS, Windows e Linux. Codex, Claude, ChatGPT o un altro harness devono poter
usare CLI o MCP locale senza ricevere accesso SQL, credenziali cliniche o
autorità implicita. Separatamente, MediFlow può invocare un provider AI dentro
il Fabric soltanto sotto policy egress e credenziali esplicite.

## Decisione

### Due livelli, un solo contratto applicativo

La `0.8.5` distingue:

1. un core Web/Headless Node 24 portabile, installabile e avviabile su macOS,
   Windows e Linux senza dipendenze Apple-only o CUDA;
2. shell e adapter specifici del sistema operativo, che possono aggiungere
   hardening o accelerazione senza cambiare il contratto di capability.

Il primo quickstart pubblico è agent-first: installazione del core, avvio di
MediFlow Headless, collegamento dello harness via MCP `stdio` o CLI, verifica
dello stato e uso delle capability governate. La UI Web localhost resta
disponibile. Le shell macOS, iOS/iPadOS e le future shell Windows/Linux sono
consumer separati e non sono prerequisiti del percorso Headless.

Il processo MCP resta distinto dal broker AIP. Il baseline portabile può usare
un launcher Node trusted che possiede il broker e avvia l'adapter MCP come
processo figlio con ambiente allowlisted e canale IPC ereditato, privato e
revocabile. Non apre un listener TCP. XPC su macOS, named pipe Windows o Unix
domain socket sono adapter opzionali di trasporto: devono conservare gli stessi
denial e non possono introdurre nuove capability.

### Superficie minima utile della 0.8.5

La release non può fermarsi a `headless_status`. L'exact candidate deve esporre
almeno:

- discovery e stato non-PHI;
- catalogo delle capability e del loro stadio massimo;
- autenticazione locale, purpose e risoluzione host-owned del contesto prima di
  qualunque grant;
- un gruppo ristretto di letture cliniche nominate `read_only`, patient-scoped
  e servite da Application Services governati;
- una proposta o draft `proposal_only` realmente producibile e review-first;
- dove il contratto e l'authority root sono già coperti, una sola scrittura
  confermata esplicitamente nel trusted UI con currentness, step-up, CAS, audit
  e receipt.

Gli ID, gli schema input/output, i denial e le receipt sono identici sui tre
sistemi. Un adapter non accede a SQLite, non costruisce SQL e non replica regole
di dominio. Sessione, purpose, capability, scope, currentness, lease, revoca,
budget, CAS, idempotenza, audit e receipt restano posseduti da MediFlow.

Un'operazione non è grantable perché appare nel catalogo. Il broker host-owned
deve emettere un permit opaco e rivalidarlo subito prima di ogni pubblicazione o
commit. Le scritture restano review-first; l'agente non può coniare PIN, gesto,
conferma o proof.

Una installazione soddisfa la Definition of Ship soltanto se un utente può
avviare il core, collegare il proprio harness, scoprire le capability correnti,
completare almeno un flusso utile end-to-end e ricevere un esito verificabile.
Scaffold, soli tipi, catalogo statico o MCP status-only non soddisfano il gate.

### Intelligence Fabric capability-first

Il Fabric espone capability stabili, inizialmente:

- `ocr`;
- `patient_insight`;
- `smart_import`;
- `document_synthesis`;
- `treatment_reasoning`.

Per ogni capability, il binding host-owned registra almeno:

```text
capability
  -> provider o engine
  -> modello, versione e digest
  -> venue
  -> credential reference
  -> policy egress e dati
  -> recipe tecnica versionata
  -> readiness e smoke sintetico
  -> receipt e provenienza
```

Il prompt clinico e lo schema di output restano versionati per capability. Una
recipe bounded può adattare formato prompt, temperatura, context window,
token, image options e parsing al modello selezionato; non diventa un secondo
prompt clinico divergente.

Non esiste fallback silenzioso. Il fallback ammesso è parte del binding
attivo, ha policy esplicita e produce la propria receipt. Readiness assente,
digest diverso, venue incompatibile o egress non autorizzato negano prima
dell'invocazione.

### OCR model-agnostic

AnyDoc resta il primo passaggio per documenti con text layer. Soltanto le
pagine classificate `needsOcr` possono entrare nella lane OCR; errori, formati
ambigui o documenti malformati non vengono convertiti in `needsOcr`.

Gli engine candidabili includono:

- Apple Vision o MLX come adapter macOS/Apple Silicon;
- modelli locali via Ollama come percorso portabile;
- CUDA come adapter per host NVIDIA compatibili;
- provider cloud soltanto con credenziali e policy egress esplicite.

DeepSeek-OCR 2/CUDA è un adapter opzionale. `deepseek-ocr` via Ollama può essere
una raccomandazione compatibile, non un requisito. Nessun nome modello,
acceleratore o benchmark hardware specifico blocca la `0.8.5`.

ADR 0111 conserva valore come contratto dell'adapter DeepSeek selettivo e delle
receipt per pagina. Questa ADR ne sostituisce ogni interpretazione come runtime
obbligatorio o gate generale della capability OCR.

### Configurazione guidata e attivazione atomica

Il selettore esistente evolve per capability. Il percorso guidato:

1. rileva sistema operativo, RAM, disco, acceleratori e runtime disponibili;
2. mostra soltanto engine e modelli compatibili con input e operazione;
3. propone profili leggero, bilanciato e qualità con requisiti dichiarati;
4. chiede conferma prima di ogni download;
5. installa e configura parametri e binding senza esporre segreti;
6. esegue uno smoke interamente sintetico;
7. attiva il nuovo binding in modo atomico solo dopo esito valido;
8. ripristina il binding precedente se setup o smoke falliscono.

La modalità avanzata può ammettere una scelta non raccomandata con avvisi e
denial espliciti. Non deduce supporto immagini, lingua o capability dal solo
nome del modello.

### Harness agente e provider cloud sono modalità distinte

Quando uno harness usa MCP o CLI, MediFlow resta il sistema autorevole e non
concede accesso al database. Questa modalità non richiede che MediFlow invii
dati a un provider cloud.

Quando il Fabric invoca OpenAI, Anthropic o un altro provider, servono
credenziali ufficiali, egress esplicito, policy dati applicabile e consenso
quando richiesto. I provider cloud restano `default OFF`; non sono un fallback
implicito del percorso Headless.

## Import e packaging guard

Il grafo del core Headless e del Web localhost non può avere import obbligatori
verso XPC, Swift, Apple frameworks, Vision, MLX, CUDA o GUI native. Gli adapter
si caricano soltanto dopo rilevazione e scelta host-owned. La loro assenza deve
lasciare avviabili core, discovery, catalogo e capability supportate dal
binding corrente.

Le build Windows/Linux non devono contenere stub che dichiarano successo. Una
capability non disponibile restituisce un denial tipizzato con readiness
osservabile e nessun fallback.

## Gate di release e claim ceiling

P0 per la `0.8.5`:

- installazione e avvio del core Headless senza componenti Apple-only;
- MCP/CLI utili con la superficie minima sopra definita;
- import guard contro DB diretto e dipendenze native obbligatorie;
- test contrattuali del medesimo catalogo, schema e denial su target
  macOS/Windows/Linux;
- quickstart agent-first e documentazione dei confini di authority.

P1, se chiudibile senza riaprire il critical path:

- selector guidato e attivazione atomica;
- Ollama portabile e adapter host-specific rilevati;
- provider cloud soltanto se credenziali, egress e lifecycle sono completi.

Restano rinviabili le GUI native Windows/Linux, ulteriore parity mobile, nuovi
modelli e benchmark su hardware non disponibile.

Al 2026-09-02 Xcode esterno e VM Windows/Linux non sono disponibili. Il
contratto tri-OS è vincolante, ma questa decisione non inventa una prova live.
Evidenza storica vale soltanto per il suo SHA/tree; il claim finale deve
separare test contrattuali exact-tree, CI remota e smoke hardware realmente
eseguiti.

## Conseguenze

- ADR 0114 resta autorevole per isolamento, AIP, lease, revoca e transport
  hardening; il suo tool di solo stato non è più sufficiente come gate di
  delivery della `0.8.5`.
- ADR 0112 resta autorevole per secret broker e cloud `default OFF`.
- Nessun packet DeepSeek, Xcode, CUDA o GUI nativa può trattenere la release se
  il contratto portabile e i gate P0 risultano verdi.
- La release resta bloccata finché la superficie utile, il quickstart e le
  prove exact-candidate non sono integrati. Un ADR accettato non equivale a
  runtime consegnato, release-ready o release pubblicata.
