# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per una lettura completa parti da [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
> Per i confini canonici valgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## 🔒 MediFlow è cloud?

No, di default no.

Il progetto nasce `local-first`: database locale, AI locale, servizi locali. Se esistono lane di confronto o shadow evaluation, restano opt-in, separate e non fanno parte del runtime clinico ordinario.

## 🧭 Che cosa porta `v0.7.3`?

`v0.7.3` consolida la base multi-superficie senza ampliare i claim oltre le
prove disponibili:

- adozione progressiva di Lume su prime superfici web e card clinica nativa;
- stack AI locale più modulare, con Ollama come unico provider operativo e gate
  egress ancora chiuso;
- control-flow documentale `shadow` e attese locali sempre review-first;
- hardening di backup, cifratura, transazioni, ricerca farmaci, campi nativi
  bloccati, dipendenze di produzione e runtime PM2;
- claims guard esteso al white paper e alle altre superfici pubbliche;
- tooling packaged P6 con fixture sintetiche, probe e runbook;
- repository pubblica unica come fonte di sviluppo e rilascio.

Restano le capacità paired della `0.7.2`: ciclo di vita paziente, prestazioni,
protesica ed export FHIR dal client Apple, entro contratti locali versionati.

Per il quadro dettagliato, inclusi runtime reale, home-base, document
intelligence, AI locale, SISS/FSE e Apple clients, vedi
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).

## ✨ Cosa resta aperto dopo `v0.7.3`?

- **Lume**: componenti interni, filo, tipografia, Settings scene e QA manuale
  completa non sono ancora chiusi.
- **P6 / `WUL-481`**: il tooling sintetico non sostituisce il verbale manuale
  sul bundle macOS con macchina sbloccata; nessuna parity UI piena è dichiarata.
- **AI e cloud**: registry, provider alternativi, redaction lane e consenso
  cloud non sono consegnati. Nessun provider remoto è attivo di default.
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

OCR e sintesi usano runtime locali. `OllamaAdapter` e `AIService` preparano un
boundary provider piu modulare, ma oggi Ollama resta l'unico provider operativo:
il gate egress e `closed_pending_redaction_lane` e non esistono provider cloud o
impostazioni di consenso consegnati. Le lane separate di benchmark o
comparazione non sono comportamento standard del prodotto.
