# MediFlow v0.5.0

> Cartella clinica local-first.
> Privata, veloce, concreta.

MediFlow nasce da un'esigenza semplice: gestire dati clinici, terapie, note e documenti senza dipendere dal cloud per fare il lavoro quotidiano.

Il progetto è pensato prima di tutto per il contesto italiano, ma la struttura resta modulare e leggibile.

![MediFlow Screenshot](screenshot.png)

## Cosa trovi oggi

- **web app locale** come superficie primaria;
- **SQLite cifrato** con approccio zero-knowledge;
- **backup, audit e contratto `/api/v1`** più espliciti;
- **AI locale** per insight e OCR, senza egress di default;
- **import documentale reviewable** e smart import prudente;
- **modalità `home-base` read-only** per client Apple paired;
- **boundary SISS/FSE dichiarato bene**: handoff contestuale e percorso prescrittivo `webapp-assisted`, non integrazione regionale nativa già risolta;
- **preview profiles locali** per verificare fette sperimentali senza sporcare il checkout stabile.

## Il salto da `v0.3` a `v0.5`, in breve

Per chi arriva dalla `v0.3` pubblica, il salto vero è qui:

- più struttura sul dato;
- più chiarezza sui boundary;
- più prudenza sui flussi AI;
- più direzione sul lavoro multi-device;
- meno storytelling ambiguo su ciò che è già pronto e ciò che è ancora in definizione.

## Cose che non stiamo fingendo

- **No cloud obbligatorio**: il default resta locale.
- **No app iPad/iPhone già finite**: la direzione c'è, ma il perimetro operativo è ancora `home-base + paired client`, read-only-first.
- **No integrazione SISS/FSE certificata dichiarata senza prove**: oggi il percorso reale è contestuale e `webapp-assisted` sui canali ufficiali.

## Documentazione

- [FAQ](./docs/FAQ.md)
- [Roadmap](./docs/ROADMAP.md)
- [Compliance](./docs/COMPLIANCE.md)
- [Document map](./docs/README.md)

> La repo OSS pubblica solo il materiale destinato a stare davvero in chiaro.
> I documenti interni di orchestrazione e il piano engineering restano fuori da questa facciata.

## Avvio rapido

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
npm install
./Start_MediFlow.command
```

Apri `http://localhost:3000`.

## Licenza

MIT License.
