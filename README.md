# MediFlow

<img src="./docs/design/punto-inchiostro/icona/punto-giorno.svg" width="100" alt="Icona di MediFlow">

MediFlow è una cartella clinica gratuita e a codice aperto per l'ambulatorio e la medicina territoriale. Tiene l'archivio sul tuo computer e funziona anche senza intelligenza artificiale.

[![Release](https://img.shields.io/github/v/release/Wulfgardr/mediflow?label=release)](https://github.com/Wulfgardr/mediflow/releases/latest) [![Licenza MIT](https://img.shields.io/badge/licenza-MIT-2ea043)](./LICENSE) [![CI](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml/badge.svg)](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml)

## Stato della versione

Sto preparando la 0.9.1. È lei che racconto qui. Oggi la versione pubblicata è la 0.9.0.

Pubblicare il codice è un inizio. Per l’uso clinico, il professionista o l’organizzazione responsabile deve valutare l’installazione e i flussi. Il pulsante «pubblica» non fa quella valutazione.

## Cosa fa

Faccio partire il lavoro dalla scheda. Ci trovi identità ed allergie, oltre al diario con autore e storico delle voci. Da lì segui terapie, controlli e prescrizioni, con i loro stati e le modifiche. Puoi importare una cartella di documenti, controllare la copertura e rivedere l’identità. Anche i documenti contano.

Ho previsto agenda e moduli territoriali per organizzare l’attività. Il modulo Lombardia serve per SISS, portali e PRREG. La dettatura usa whisper sul computer, con modello installabile dalle Impostazioni. Le mani possono riposare.

Per leggere la cartella puoi chiedere un quadro del paziente oppure una sintesi dei documenti. C’è anche l’import assistito. Tutte e tre preparano proposte con fonti e ricevuta, previo consenso. Puoi aprire funzioni MediFlow da Claude e Codex. Oppure scegliere ChatGPT, con consenso e controlli sui dati. Le copie complete comprendono documenti incorporati ed allegati. Se manca già un originale conservato fuori, la copia non lo recupera. Una copia non fa magie.

### Perché esiste MediFlow

Nasce dal mio lavoro di medico di distretto. Inizialmente per me. Poi, se viene bene, per chiunque voglia uno strumento per gestire la propria attività clinica.

## Cosa non fa

Il medico sei tu. Diagnosi, prescrizione e triage non sono attività autonome di MediFlow. Le funzioni intelligenti preparano proposte e non scrivono da sole nella cartella.

Ho misurato le tre funzioni intelligenti locali su dati sintetici. Non sono qualificate. Fra le tre, l’import assistito è l’unica ad essere rientrata nei limiti previsti di tempo e memoria. Il [registro della 0.9.1](./docs/quality/intelligence/registro-0.9.1.json) racconta le misure.

Per il Web ho previsto Mac, Windows e Linux. Sul MacBook Pro M5 Max ho installato il client e ne ho controllato l’host. L’interfaccia non è stata ancora collaudata. Sugli altri Mac non ho prove di compatibilità.

## Dove stanno i dati

Ho scelto il computer che ospita MediFlow come sede dell’archivio. Prima della scrittura, i campi sensibili vengono cifrati lato client. MediFlow cifra alcuni campi, non il database.

L’uso parte dal computer. Un invio al cloud è previsto solo per una funzione sviluppata e documentata esplicitamente. I dettagli sono in [Sicurezza e dati](./SECURITY.md). Vale la pena leggerli.

## Provalo

Per partire servono Git e Node.js 24.x. Prima gli strumenti.

```sh
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
nvm use
npm ci
npm run prepare:dependencies
```

Il comando di avvio è `node scripts/mediflow.mjs --scegli`. Se usi nvm, `nvm use` seleziona la versione prevista. Altrimenti seleziona Node 24 con il tuo gestore.

Per la versione pubblicata, la 0.9.0, segui il [README del tag](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/README.md). Se decidi di aggiornare, tieni pronti backup, kit e chiave di recupero. Meglio averli prima.

Il manuale spiega come [aggiornare il catalogo farmaci AIFA](./docs/MANUALE.md#catalogo-farmaci-aifa) e [gestire le fonti personali della protesica](./docs/MANUALE.md#fonti-personali-della-protesica).

## Per chi sviluppa

[Contribuire](./CONTRIBUTING.md) · [Architettura](./ARCHITECTURE.md) · [Documentazione](./docs/README.md)

## Sviluppo assistito

Progetto MediFlow e ne seguo la direzione personalmente. Gran parte del codice la scrivono gli agenti Codex e Claude Code, su mie istruzioni. Intento, pianificazione, architettura, prove richieste e merge sono miei. Ho riconosciuto nei [crediti](./CREDITS.md) le fonti esterne.

Ho pubblicato una [dashboard dei consumi](./docs/development-usage.md), ma copre solo una parte del lavoro. Contare token non dice quanto sia costato il lavoro o quanto sia riuscito. Niente pagelle in token.

## Licenza

MediFlow è gratuito e distribuito con [licenza MIT](./LICENSE). Hardware, modelli e servizi di terzi possono costare. Le fonti utilizzate sono riconosciute in [CREDITS](./CREDITS.md). Anche questo va considerato.
