# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per una lettura completa parti da [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
> Per i confini canonici valgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## MediFlow è cloud?

No, di default no.

Il progetto nasce `local-first`: database locale, AI locale, servizi locali. Se esistono lane di confronto o shadow evaluation, restano opt-in, separate e non fanno parte del runtime clinico ordinario.

## Che cosa è cambiato in `v0.6`?

`v0.6` rende MediFlow più concreto come sistema locale multi-superficie:

- storage e sicurezza più solidi;
- contratto locale `/api/v1` più chiaro;
- backup, audit e guardrail più espliciti;
- import documentale e AI più reviewable;
- Mac `home-base` packaged e primi client Apple paired;
- document intelligence `artifact-first` con fonti e conflitti più espliciti;
- prescrizioni di prestazione separate dalle terapie farmacologiche;
- root web Kree8 live, senza selector di shell su `main`;
- boundary SISS/FSE raccontati senza scorciatoie narrative.

`v0.4` resta una tappa tecnica importante e `v0.5` il consolidamento AI/UI;
`v0.6` è la baseline più chiara per capire lo stato attuale del progetto.

Per il quadro dettagliato, inclusi runtime reale, home-base, document
intelligence, AI locale, SISS/FSE, Apple clients e split pubblico/privato, vedi
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).

## Posso usarlo su Mac, iPad o iPhone?

Oggi la superficie primaria resta la web app sul Mac.

Il bundle macOS home-base è la nuova base packaged del nodo locale. La shell
macOS clinica storica esiste ancora come snapshot/parity, ma non è il ramo su
cui continuare a stratificare feature. La direzione attiva è:

- **Mac** come nodo `home-base`;
- **iPadOS / iOS** come client paired sullo stesso boundary locale;
- perimetro **read-only-first** nel disegno generale, con write remoti solo
  dove sono espliciti, versionati e documentati; non c'e ancora sync automatico.

## Che cos'è `home-base`?

È il modello in cui il Mac tiene il database autorevole e può esporre, quando l'operatore lo attiva, una superficie locale `/api/v1/network/*` verso client trusted sulla stessa rete.

Oggi questo perimetro è:

- opt-in;
- paired;
- protetto da credenziale device + sessione operatore;
- ancora `read-only-first`, con write limitati a profilo/status paziente,
  diario clinico, terapie, checkup e osservazioni versionati.

## Ci sono ancora Preview Profiles?

No, non su `main`.

Oggi esiste una sola direzione live: la root web locale apre il cockpit Kree8,
senza selector Graphite/Kree8 e senza preview profiles persistiti. Le superfici
già mature vivono direttamente nel runtime ufficiale:

- stack AI locale;
- Smart Import reviewable;
- contesto paziente SISS/FSE.

Le sperimentazioni future devono arrivare in modo esplicito e verificabile, non come selector persistiti nelle `Impostazioni`.

## Cosa vuol dire integrazione SISS in MediFlow, oggi?

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

## L'AI manda dati paziente fuori dal computer?

Non nel path di default.

OCR e sintesi usano runtime locali. Se esistono lane separate di benchmark o comparazione, sono esplicitamente distinte dal runtime clinico e non vanno lette come comportamento standard del prodotto.
