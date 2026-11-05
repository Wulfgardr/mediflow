# ADR 0181: Sign in with ChatGPT come venue del Fabric

Data: 2026-11-05. Stato: **Proposed** (direzione decisa da Leonardo il 5
novembre 2026; l'ammissione dipende dalle prove elencate sotto).
Integra [ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md),
[ADR 0112](./0112-provider-v2-secret-broker-and-official-cloud-adapters.md),
[ADR 0126](./0126-chatgpt-account-control-plane.md) e
[ADR 0134](./0134-chatgpt-subscription-synthesis-execution.md).
Nessun impatto sul contratto `/api/v1`.

## Contesto

Leonardo vuole che l'Intelligence Fabric possa usare l'abbonamento ChatGPT del
medico. Oggi MediFlow ha due pezzi:

- ADR 0126: login ChatGPT tramite Codex app-server, solo per account,
  catalogo e limiti; `inferenceEnabled: false`.
- ADR 0134: sintesi tramite lo stesso app-server in un processo confinato,
  con ammissione sospesa. Il confine è pesante perché Codex è un agente con
  strumenti: va chiuso tutto ciò che il processo potrebbe leggere o fare.
  Richiede inoltre un binario Codex configurato dall'host
  (`MEDIFLOW_CHATGPT_CODEX_BIN`).

OpenAI ha pubblicato **Sign in with ChatGPT** (SIWC) per applicazioni terze,
consultato il 5 novembre 2026:

- l'utente si autentica presso OpenAI e vede i permessi chiesti; gli scope di
  identità non danno accesso alle conversazioni né alle risorse API
  ([quickstart](https://developers.openai.com/siwc/quickstart));
- con scope e consenso separati, un'app open source può usare il piano
  ChatGPT dell'utente per richieste Responses idonee
  ([percorso open source](https://developers.openai.com/siwc/token-sharing-open-source));
- per le app open source locali la registrazione è dinamica al primo accesso,
  OAuth con PKCE e callback su loopback, senza chiave API del partner né
  client secret ([registrazione](https://developers.openai.com/siwc/token-sharing-open-source/sign-in));
- access token di un'ora, refresh token di 30 giorni con rotazione
  ([token](https://developers.openai.com/siwc/token-sharing-open-source/token-reference));
- chiamata a `https://api.openai.com/v1/responses` con il token come bearer,
  `store: false` e `stream: true`; file search, Code Interpreter, MCP ospitati
  e input audio o video non sono supportati
  ([modelli e inferenza](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
  [limiti della preview](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations));
- il consumo è quello del piano Plus o Pro dell'utente, che può fissare limiti
  per app e scollegarla;
- esiste anche una variante che passa lo stesso token a Codex app-server
  ([guida](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)).

Il modulo di interesse sul sito OpenAI è rivolto ai partner commerciali e
rimanda gli sviluppatori open source alla documentazione: per MediFlow non è
il percorso di accesso.

## Decisione proposta

**Chiamata diretta a Responses con il token SIWC, dietro il gate di egress.**
È la via raccomandata per l'inferenza del Fabric con l'abbonamento ChatGPT.

- **Nessun binario Codex per l'inferenza.** MediFlow resta installabile ovunque
  con un solo pacchetto; il medico non configura un percorso host.
- **Il confine diventa piccolo e verificabile.** Una richiesta HTTPS senza
  strumenti, con `store: false`, al posto di un agente da confinare. Gli
  strumenti ospitati non si chiedono mai; una risposta che li invochi viene
  rifiutata.
- **Un solo punto d'uscita.** Ogni richiesta passa dal gate di ADR 0077: layer
  1 deterministico, GLiNER2-PII governato, pseudonimi coerenti nella sola
  sessione in RAM, ricomposizione locale del risultato, audit con soli hash.
  Senza preparazione verificata la richiesta non parte.
- **Credenziali nel secret broker di ADR 0112.** Token mai in DTO, log, export
  o fixture; logout MediFlow, lock e revoca invalidano subito la sessione SIWC.
- **Proposte, mai scritture.** Il binding Fabric resta `proposal_only` con fonti
  verificabili, come in ADR 0134.

ADR 0126 resta valido per le installazioni che già lo usano, finché la via SIWC
non è provata. La variante con app-server resta un ripiego, se la chiamata
diretta non risultasse idonea per MediFlow.

## Prove che chiudono l'ammissione

1. Registrazione dinamica e login con un account reale di Leonardo, con la
   lettura degli scope concessi.
2. Una richiesta su fixture sintetica: modello dal catalogo corrente, stream
   letto fino a `response.completed`, nessun dato personale nel payload
   (verificato sul payload uscito, non sul prompt).
3. Rinnovo e rotazione del token, revoca dal lato utente e logout MediFlow
   che negano anche le risposte tardive.
4. Quota esaurita, timeout, annullamento: nessun output parziale accettato e
   nessun ripiego automatico su un altro provider.
5. Disponibilità del servizio fuori dagli Stati Uniti, a partire dall'Italia;
   le pagine consultate non elencano i Paesi.
6. Condizioni d'uso e trattamento dei dati compatibili con l'uso clinico
   pseudonimizzato.

Fino all'esito di queste prove nessuna funzione Fabric usa SIWC su dati
clinici reali.
