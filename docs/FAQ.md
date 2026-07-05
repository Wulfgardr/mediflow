# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per una lettura completa parti da [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
> Per i confini canonici valgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## 🔒 MediFlow è cloud?

No, di default no.

Il progetto nasce `local-first`: database locale, AI locale, servizi locali. Se esistono lane di confronto o shadow evaluation, restano opt-in, separate e non fanno parte del runtime clinico ordinario.

## 🧭 Che cosa porta `v0.7.1`?

`v0.7.1` consolida MediFlow come sistema locale multi-superficie:

- storage e sicurezza più solidi;
- contratto locale `/api/v1` più chiaro;
- backup, audit e guardrail più espliciti;
- import documentale e AI più reviewable;
- Mac `home-base` packaged e app Apple/native molto più concreta su macOS;
- core Swift condiviso costruito e testato anche su Linux e Windows;
- document intelligence `artifact-first` con fonti e conflitti più espliciti;
- prescrizioni di prestazione separate dalle terapie farmacologiche;
- root web sul cockpit Kree8 live, senza selector di shell su `main`;
- boundary SISS/FSE raccontati senza scorciatoie narrative.

La differenza principale rispetto alla 0.7.0 e il consolidamento Apple/native:
macOS e il fronte piu maturo, iPhone/iPad restano client paired, mentre
Windows/Linux provano oggi portabilita del core e CI, non parity applicativa
completa.

Per il quadro dettagliato, inclusi runtime reale, home-base, document
intelligence, AI locale, SISS/FSE, Apple clients e split pubblico/privato, vedi
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).

## 🍎 Posso usarlo su Mac, iPad o iPhone?

Oggi la superficie primaria resta la web app sul Mac.

Il bundle macOS home-base è la nuova base packaged del nodo locale e la parte
native più avanzata. La direzione attiva è:

- **Mac** come nodo `home-base`;
- **iPadOS / iOS** come client paired sullo stesso boundary locale;
- perimetro **read-only-first** nel disegno generale, con write remoti solo
  dove sono espliciti, versionati e documentati; non c'e ancora sync automatico.

## 🖥️ E Windows/Linux?

`v0.7.1` aggiunge una prova importante: il core Swift condiviso viene costruito
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

OCR e sintesi usano runtime locali. Se esistono lane separate di benchmark o comparazione, sono esplicitamente distinte dal runtime clinico e non vanno lette come comportamento standard del prodotto.
