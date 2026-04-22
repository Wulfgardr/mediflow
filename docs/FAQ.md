# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per i confini canonici valgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## MediFlow è cloud?

No, di default no.

Il progetto nasce `local-first`: database locale, AI locale, servizi locali. Se esistono lane di confronto o shadow evaluation, restano opt-in, separate e non fanno parte del runtime clinico ordinario.

## Qual è il salto tra `v0.3` e `v0.5`?

Il salto è soprattutto di maturità:

- storage e sicurezza più solidi;
- contratto locale `/api/v1` più chiaro;
- backup, audit e guardrail più espliciti;
- import documentale e AI più reviewable;
- direzione multi-device più leggibile;
- boundary SISS/FSE raccontati senza scorciatoie narrative.

`v0.4` resta una tappa tecnica importante, ma il salto pubblico oggi si legge meglio come `0.3 -> 0.5`.

## Posso usarlo su Mac, iPad o iPhone?

Oggi la superficie primaria è la web app sul Mac.

La shell macOS storica esiste ancora come snapshot, ma non è il ramo su cui continuare a stratificare feature. La direzione attiva è:

- **Mac** come nodo `home-base`;
- **iPadOS / iOS** come client paired sullo stesso boundary locale;
- primo perimetro **read-only-first**, senza scrittura remota o sync automatico.

## Che cos'è `home-base`?

È il modello in cui il Mac tiene il database autorevole e può esporre, quando l'operatore lo attiva, una superficie locale `/api/v1/network/*` verso client trusted sulla stessa rete.

Oggi questo perimetro è:

- opt-in;
- paired;
- protetto da credenziale device + sessione operatore;
- ancora `read-only-first`.

## Cosa sono i Preview Profiles?

Sono profili locali di preview disponibili in ambiente non-production per provare alcune fette sperimentali senza cambiare branch o checkout.

Non vanno confusi con `Stile visivo` in `Impostazioni`, che oggi e una preferenza locale persistente separata fra:

- `Clinico`
- `Liquid`

Oggi coprono, in modo separato:

- shell sperimentale `Liquid Glass UI`;
- stack AI;
- review import;
- contesto paziente SISS.

Servono a testare e confrontare fette locali sperimentali. Non sostituiscono il profilo stabile del checkout e non rimpiazzano il selettore di stile visivo persistito.

## Cosa vuol dire integrazione SISS in MediFlow, oggi?

Vuol dire una cosa precisa: MediFlow può preparare il contesto paziente e richiamare i percorsi ufficiali già percorribili, mantenendo il boundary dichiarato.

In pratica:

- handoff contestuale paziente;
- percorso prescrittivo `webapp-assisted`;
- pre-check locali dove sensati.

Non vuol dire ancora:

- integrazione regionale certificata nativa;
- consumo arbitrario di REST/WS regionali come se fossero già disponibili;
- UI prescrittiva custom che sostituisce il modulo ufficiale.

## L'AI manda dati paziente fuori dal computer?

Non nel path di default.

OCR e sintesi usano runtime locali. Se esistono lane separate di benchmark o comparazione, sono esplicitamente distinte dal runtime clinico e non vanno lette come comportamento standard del prodotto.

## Perché nella repo OSS manca qualcosa che esiste nella repo privata?

Per scelta.

La facciata OSS deve esporre il prodotto, l'architettura e i boundary pubblicabili. I materiali interni di orchestrazione, il piano engineering attivo e la documentazione privata restano fuori.
