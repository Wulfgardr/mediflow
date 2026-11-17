# MediFlow



<img src="./docs/design/punto-inchiostro/icona/punto-giorno.svg" width="100" alt="Icona di MediFlow">

MediFlow è una cartella clinica gratuita e a codice aperto per l'ambulatorio e la medicina territoriale. Tiene l'archivio sul tuo computer e funziona anche senza intelligenza artificiale.

[![Release](https://img.shields.io/github/v/release/Wulfgardr/mediflow?label=release)](https://github.com/Wulfgardr/mediflow/releases/latest) [![Licenza MIT](https://img.shields.io/badge/licenza-MIT-2ea043)](./LICENSE) [![CI](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml/badge.svg)](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml)

## Stato della versione

**Oggi**
> Oggi trovi la 0.9.0. La 0.9.1 è in preparazione e questa pagina la descrive.
> Pubblicare il codice non significa che sia ammesso all’uso clinico. Il professionista o l’organizzazione responsabile deve valutare l’installazione e i suoi flussi.

## Cosa fa

- Tieni nella scheda identità, allergie e diario, con autore e storico delle voci.
- Segui terapie, controlli e prescrizioni, con i loro stati e la traccia delle modifiche.
- Importi una cartella di documenti, ne controlli la copertura e rivedi l’identità.
- Usi l’agenda e i moduli territoriali. Per SISS, portali e PRREG ti serve il modulo Lombardia.
- Detti con whisper sul tuo computer. Puoi installare il modello dalle Impostazioni.
- Se vuoi, chiedi un quadro del paziente, una sintesi dei documenti o un import assistito. Con il tuo consenso ricevi proposte con fonti e ricevuta.
- Puoi aprire funzioni MediFlow da Claude e Codex. Puoi anche scegliere ChatGPT, con consenso e controlli sui dati.
- Salvi una copia completa con documenti incorporati ed allegati. La copia non recupera originali esterni già mancanti.

### Perché esiste MediFlow

[DA SCRIVERE O CONFERMARE: Leonardo] Proposta: MediFlow è pensato per il lavoro del medico in ambulatorio e nella medicina territoriale, anche in Casa di Comunità e a domicilio.

## Cosa non fa

MediFlow non sostituisce il tuo giudizio. Non diagnostica, prescrive o esegue triage da solo. Le funzioni intelligenti preparano proposte, senza scrivere autonomamente nella cartella.

Le tre funzioni intelligenti locali non sono qualificate e, nelle prove su dati sintetici, solo l’import assistito è rimasto entro i tempi e la memoria misurata previsti per la prova: [LINK NOTA DI RILASCIO].

La versione Web è prevista per Mac, Windows e Linux. Il client per Mac è stato installato e controllato su un MacBook Pro M5 Max. L’uso dell’interfaccia resta da collaudare e la compatibilità con gli altri Mac non è provata.

## Dove stanno i dati

Il tuo archivio è sul computer che ospita MediFlow. Prima della scrittura, i campi sensibili vengono cifrati lato client. MediFlow cifra alcuni campi, non il database.

L’uso parte dal tuo computer. Un invio al cloud è previsto solo se la funzione che lo consente è stata sviluppata e documentata in modo esplicito. [Sicurezza e dati](./SECURITY.md)

## Provalo

Per avviare il codice servono Git e Node.js 24.x.

```sh
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
nvm use
npm ci
npm run prepare:dependencies
```

Avvia il programma con `node scripts/mediflow.mjs --scegli`. `nvm use` vale se usi nvm. Con altri gestori seleziona Node 24.

Per la 0.9.0 pubblicata segui il [README del tag](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/README.md). Prima di aggiornare, prepara backup, kit e chiave di recupero.

## Per chi sviluppa

[Contribuire](./CONTRIBUTING.md) · [Architettura](./ARCHITECTURE.md)

## Sviluppo assistito

MediFlow è progettato e diretto da Leonardo Pegollo. Gran parte del codice è scritta dagli agenti Codex e Claude Code su sue istruzioni. Intento, pianificazione, architettura, prove richieste e merge sono suoi. Le fonti esterne sono riconosciute nei [crediti](./CREDITS.md).

La [dashboard dei consumi](./docs/development-usage.md) è parziale. I token non misurano costo o qualità.

## Licenza

MediFlow è gratuito ed è distribuito con [licenza MIT](./LICENSE). Hardware, modelli e servizi di terzi possono avere costi propri. Le fonti esterne sono in [CREDITS](./CREDITS.md).
