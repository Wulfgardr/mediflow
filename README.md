# MediFlow

<img src="./docs/design/punto-inchiostro/icona/punto-giorno.svg" width="100" alt="Icona di MediFlow">

MediFlow è una cartella clinica gratuita e a codice aperto per l'ambulatorio e la medicina territoriale. Tiene l'archivio sul tuo computer e funziona anche senza intelligenza artificiale.

[![Release](https://img.shields.io/github/v/release/Wulfgardr/mediflow?label=release)](https://github.com/Wulfgardr/mediflow/releases/latest) [![Licenza MIT](https://img.shields.io/badge/licenza-MIT-2ea043)](./LICENSE) [![CI](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml/badge.svg)](https://github.com/Wulfgardr/mediflow/actions/workflows/web-core.yml)

## Stato della versione

Qui descrivo MediFlow 0.9.1. Se vuoi installarlo, nella pagina dell’ultima versione pubblicata trovi il tag da usare, i file disponibili per il tuo sistema e i risultati del collaudo. [Ultima release](https://github.com/Wulfgardr/mediflow/releases/latest)

Pubblicare il codice è un inizio. Per l’uso clinico, il professionista o l’organizzazione responsabile deve valutare l’installazione e i flussi. Il pulsante «pubblica» non fa quella valutazione.

## Cosa fa

Nella scheda trovi identità ed allergie, oltre al diario con autore e storico delle voci. Da lì segui terapie, controlli e prescrizioni, con i loro stati e le modifiche, e puoi importare una cartella di documenti, controllare la copertura e rivedere l’identità.

Ho previsto agenda e moduli territoriali per organizzare l’attività. Il modulo Lombardia serve per SISS, portali e PRREG, mentre la dettatura usa whisper sul computer, con modello installabile dalle Impostazioni.

Per leggere la cartella puoi chiedere un quadro del paziente oppure una sintesi dei documenti. C’è anche l’import assistito: tutte e tre preparano proposte con fonti e ricevuta, con il tuo consenso. Puoi aprire funzioni MediFlow da Claude e Codex oppure scegliere ChatGPT, con consenso e controlli sui dati. Le copie complete comprendono documenti incorporati ed allegati. Se manca già un originale conservato fuori, la copia non lo recupera.

### Perché esiste MediFlow

Nasce dal mio lavoro di medico di distretto. Inizialmente per me. Poi, se viene bene, per chiunque voglia uno strumento per gestire la propria attività clinica.

## Cosa non fa

Il medico sei tu e restano tue le decisioni su diagnosi, prescrizione e triage. Le funzioni intelligenti preparano proposte e non scrivono da sole nella cartella.

Nelle prove del 14 novembre 2026 su dati sintetici, solo l’import assistito è rientrato nei limiti di tempo e memoria. Per ciascuna funzione il registro riporta le misure, il modello e lo stato di qualifica. [Registro della 0.9.1](./docs/quality/intelligence/registro-0.9.1.json)

Per il Web ho previsto Mac, Windows e Linux. Il MacBook Pro M5 Max con 48 GB è il computer scelto per collaudare il client GPUI della 0.9.1. Le note di ogni release indicano architettura, versione del sistema e prove svolte. [Versioni pubblicate](https://github.com/Wulfgardr/mediflow/releases)

## Dove stanno i dati

Ho scelto il computer che ospita MediFlow come sede dell’archivio. Prima della scrittura, i campi sensibili vengono cifrati lato client. MediFlow cifra alcuni campi, non il database.

L’uso parte dal computer. Un invio al cloud è previsto solo per una funzione sviluppata e documentata esplicitamente. I dettagli sono in [sicurezza e dati](./SECURITY.md).

## Provalo

I comandi seguenti avviano il Web dal tag `v0.9.1` e richiedono Git e Node.js 24.x. Il launcher usa la copia Git per verificare la revisione. Per installare la 0.9.0 trovi i suoi comandi nel README del tag. [Istruzioni per la 0.9.0](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/README.md#provalo)

```sh
git clone --branch v0.9.1 --single-branch https://github.com/Wulfgardr/mediflow.git
cd mediflow
node --version
npm ci
npm run prepare:dependencies
node scripts/mediflow.mjs --scegli
```

Prima di `npm ci`, controlla che `node --version` mostri la versione 24. Se usi nvm su Mac o Linux, dalla cartella del progetto puoi selezionarla con `nvm use`. Prima di aggiornare, prepara il backup completo cifrato, il kit e la chiave di recupero.

Il manuale spiega come [aggiornare il catalogo farmaci AIFA](./docs/MANUALE.md#catalogo-farmaci-aifa) e [gestire le fonti personali della protesica](./docs/MANUALE.md#fonti-personali-della-protesica).

## Per chi sviluppa

[Contribuire](./CONTRIBUTING.md) · [Architettura](./ARCHITECTURE.md) · [Documentazione](./docs/README.md)

## Sviluppo assistito

Progetto MediFlow e ne seguo la direzione personalmente. Gran parte del codice la scrivono gli agenti Codex e Claude Code, su mie istruzioni. Intento, pianificazione, architettura, prove richieste e merge sono miei. Ho riconosciuto nei [crediti](./CREDITS.md) le fonti esterne.

Ho pubblicato una [dashboard dei consumi](./docs/development-usage.md), ma copre solo una parte del lavoro. Contare token non dice quanto sia costato il lavoro o quanto sia riuscito.

## Licenza

MediFlow è gratuito e distribuito con [licenza MIT](./LICENSE). Hardware, modelli e servizi di terzi possono costare, mentre le fonti utilizzate sono riconosciute in [CREDITS](./CREDITS.md).
