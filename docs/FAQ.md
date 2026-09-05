# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per una lettura completa parti da [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
> Per i confini canonici valgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## 🔒 MediFlow è cloud?

No, di default no.

Il progetto nasce `local-first`: database locale, AI locale, servizi locali. Se esistono lane di confronto o shadow evaluation, restano opt-in, separate e non fanno parte del runtime clinico ordinario.

## 🧭 Che cosa porta `v0.8.5`?

La patch `0.8.5` consolida un sistema locale ibrido e mantiene review e
autorità clinica fuori dai modelli:

- Intelligence Fabric review-only per Patient Insight, Smart Import, Document
  Synthesis e Treatment Reasoning;
- estrazione AnyDoc locale e fallback Apple Vision sulle sole pagine PDF
  `needsOcr`; DeepSeek-OCR 2/CUDA resta fuori scope non bloccante;
- Supervisor portabile e MCP `stdio` con operazioni bounded, lease, revoca e
  audit host-owned; Mini resta una foundation CLI fail-closed senza binding
  production al Supervisor;
- preview F10 via MCP e commit checkup soltanto nella UI Web trusted, dopo
  rilettura, step-up e gesto del medico;
- semantic planner read-only, limitato a due operazioni allowlisted;
- cattura e trascrizione italiana Apple on-device su macOS 26+, con consenso,
  audio bounded in RAM e review del transcript;
- provider v2 e adapter ufficiali OpenAI/Anthropic integrati ma `default OFF`,
  verificati con transport fake e senza credenziali o rete live.

Per il quadro dettagliato, inclusi runtime reale, home-base, document
intelligence, AI locale, SISS/FSE e Apple clients, vedi
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).

## ✨ Cosa resta aperto dopo `v0.8.5`?

- **Lume**: componenti interni, filo, tipografia, Settings scene e QA manuale
  completa non sono ancora chiusi.
- **Apple**: VoiceOver reale mobile, device fisici, App Store readiness e
  parity UI completa non sono dichiarati.
- **AI esterna**: i provider remoti restano disabilitati salvo opt-in; account,
  retention, egress live e qualità clinica restano fuori dalle prove sorgente.
- **Headless**: installer, onboarding e compatibilità con host MCP esterni
  richiedono prove separate.
- **Recording**: microfono reale e validazione clinica non fanno parte del
  claim; nessun writer clinico è automatico.
- **Client paired**: offline, click-map UI e superfici derivate dai documenti
  restano parziali o host-only.

## 🍎 Posso usarlo su Mac, iPad o iPhone?

Oggi la superficie primaria resta la web app sul Mac.

Il bundle macOS home-base è la nuova base packaged del nodo locale e la parte
native più avanzata. La direzione attiva è:

- **Mac** come nodo `home-base`;
- **iPadOS / iOS** come client paired sullo stesso boundary locale;
- perimetro **read-only-first** nel disegno generale, con write remoti solo
  dove sono espliciti, versionati e documentati; non c'e ancora sync automatico.

## 🖥️ E Windows/Linux?

Una prova importante: il core Swift condiviso viene costruito
e testato anche su Linux e Windows in CI. Questo e un passo di portabilita reale,
ma non significa che esistano gia app Windows/Linux complete.

La lettura corretta e tripartita:

- macOS: fronte app piu avanzato;
- iPhone/iPad: client paired sul Mac `home-base`;
- Linux/Windows: core e distribuzione ancora in slice iniziali.

## 🏠 Che cos'è `home-base`?

È il modello in cui il Mac tiene il database autorevole e può esporre, quando l'operatore lo attiva, una superficie locale `/api/v1/network/*` verso client trusted sulla stessa rete.

Oggi questo perimetro è:

- opt-in;
- paired;
- protetto da credenziale device + sessione operatore;
- ancora `read-only-first`, con write limitati a profilo/status paziente,
  diario clinico, terapie, checkup e osservazioni versionati.

## 🖥️ Ci sono ancora Preview Profiles?

No, non su `main`.

Oggi esiste una sola direzione live: la root web locale apre il cockpit Kree8,
senza selector Graphite/Kree8 e senza preview profiles persistiti. Le superfici
già mature vivono direttamente nel runtime ufficiale:

- stack AI locale;
- Smart Import reviewable;
- contesto paziente SISS/FSE.

Le sperimentazioni future devono arrivare in modo esplicito e verificabile, non come selector persistiti nelle `Impostazioni`.

## 🏛️ Cosa vuol dire integrazione SISS in MediFlow, oggi?

Vuol dire una cosa precisa: MediFlow può preparare il contesto paziente e richiamare i percorsi ufficiali già percorribili, mantenendo il boundary dichiarato.

In pratica:

- handoff contestuale paziente;
- percorso prescrittivo `webapp-assisted`;
- pre-check locali dove sensati;
- dominio locale per prescrizioni di prestazione, separato dalle terapie
  farmacologiche e utile alla review/documentazione del paziente.

Non vuol dire ancora:

- integrazione regionale certificata nativa;
- consumo arbitrario di REST/WS regionali come se fossero già disponibili;
- UI prescrittiva custom che sostituisce il modulo ufficiale;
- generazione NRE, invio prescrittivo regionale o writeback FSE/SISS da
  MediFlow.

## 🤖 L'AI manda dati paziente fuori dal computer?

Non nel path di default.

AnyDoc, Apple Vision, Ollama e ATHENA/MLX operano localmente nei rispettivi
confini. Gli adapter OpenAI/Anthropic esistono, ma sono `default OFF`: la probe
è amministrativa, exact-intent e review-only; richiede opt-in host, secret
reference e policy egress/retention esplicite. Il tree usa transport fake e non
include credenziali né prova invii live. Nessuna preview Fabric autorizza una
scrittura clinica.

## 🤖 Che cosa può fare un agente tramite MCP?

Può usare un catalogo bounded, cercare terminologia, leggere Open Loops nello
scope paziente concesso, preparare una proposta follow-up e interrogare il
planner read-only. Per F10 può produrre soltanto una preview di transizione:
il commit resta nella UI Web trusted e richiede il gesto del medico. MCP non
riceve proof, non importa SQLite e non possiede autorità generale.
