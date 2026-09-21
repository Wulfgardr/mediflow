# Corpus documentale SISS / FSE 2.0

> Stato documento: `CANONICAL`

Per lavorare sulle integrazioni regionali serve una base documentale locale
che sia consultabile e aggiornabile senza dipendere, a ogni ricerca, dal
portale remoto. Questa nota governa il primo intervento `WUL-176`: catalogo
delle fonti, acquisizione locale, importazione manuale controllata e
preparazione del futuro MCP documentale.

Riferimenti canonici:

- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md)
- [SECURITY.md](../SECURITY.md)

## Obiettivo

L’obiettivo è poter consultare e mantenere una base tecnica locale per i
seguenti ambiti, senza confondere l’accesso ai documenti con l’abilitazione a
usare i servizi descritti:

- Menu SISS e moduli regionali
- autenticazione/SSO/credenziali operatore
- prescrittivo regionale
- anagrafe/gestione assistiti
- FSE regionale e FSE 2.0 nazionale
- certificati di malattia, SGDT e servizi adiacenti

## Principi

La repository contiene il catalogo delle fonti e gli strumenti, non l’intero
corpus scaricato. Le copie dei documenti vengono scritte in
`tmp/siss-docs-corpus/`, fuori Git; quelle riservate o autenticate entrano
solo come `manual-import`. Nel corpus non deve comparire alcun dato paziente
o payload clinico reale.

Il futuro MCP leggerà questa raccolta, senza sostituirla. A mantenerla
aggiornata deve essere il motore locale di sincronizzazione e rilevamento
delle modifiche: il solo livello MCP non ne garantisce la freschezza.

## Manifest sorgenti

Il manifest iniziale si trova in:

`scripts/siss-docs-corpus-sources.json`

Ogni fonte deve essere descritta almeno dai seguenti campi:

- `id`
- `title`
- `area`
- `url`
- `access`
- `captureStrategy`
- `tags`

Valori operativi:

- `access = public`: fonte acquisibile automaticamente
- `access = auth-gated`: fonte nota, non acquisita senza credenziali
- `access = manual-import`: segnaposto per documenti da importare con procedura locale guidata

- `captureStrategy = snapshot-html`: salva la risposta testuale/HTML
- `captureStrategy = snapshot-github-html`: salva la pagina GitHub come snapshot
- `captureStrategy = manual-placeholder`: registra solo metadati/placeholder
- `refreshHours = N`: cadenza suggerita di refresh per la sorgente

Gli scenari FSE regionali hanno prerequisiti diversi. Il manifest deve quindi
mantenere separati almeno tre segnaposto specifici:

- `DC-SCEN-REF#01`: gestione del Documento Clinico Elettronico presso Enti
  Erogatori e `MMG/PLS`
- `DC-SCEN-ACCO#03`: consenso alla consultazione FSE
- `DC-SEBC_FSE-SIAA#02`: SEB FSE Gestione Eventi

La mappa delle decisioni di prodotto per questi documenti è in
[docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md).

Per SGDT non basta un segnaposto generico. Il caso emerso dalle fonti pubbliche
è `DC-COOP-FHIR_PIC#02`, relativo alla cooperazione applicativa SGDT/PAI con le
Cartelle Elettroniche `MMG/PLS`; lo affiancano i manuali COT/MMG per le richieste
di transizione e attivazione territoriale. La mappa delle decisioni è in
[docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md).

Per i Certificati di malattia il manifest mantiene separati:

- FAQ SISS per integrazione applicativi medico/SISS e boundary `SAR`
- Web Application Certificati di Malattia in sede di ricovero/dimissione

La mappa delle decisioni è in
[docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md).

Per NAR / Anagrafe Regionale il manifest distingue:

- pagina pubblica `Anagrafe Regionale degli assistiti e delle strutture`
- manuali Gaia / gestione anagrafe / iscrizione assistiti
- manuali GAMS / gestione anagrafe medici specialisti

Il progetto di accesso in sola lettura è in
[docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md).

## Comandi

Validazione del manifest:

```bash
npm run docs:siss-corpus:validate
```

Acquisizione del corpus pubblico nel percorso predefinito, ignorato da Git:

```bash
npm run docs:siss-corpus:fetch
```

Sincronizzazione incrementale, conservando memoria delle versioni già viste:

```bash
npm run docs:siss-corpus:sync
```

Report di freschezza del corpus sincronizzato:

```bash
npm run docs:siss-corpus:report
```

Acquisizione limitata a un sottoinsieme di fonti:

```bash
npm run docs:siss-corpus:fetch -- --only siss-modalita-accesso,fse-support-readme
```

Output alternativo:

```bash
npm run docs:siss-corpus:fetch -- --output-dir tmp/siss-docs-corpus-smoke
```

## Struttura output

Per ogni fonte acquisita, lo strumento scrive:

- `body.<ext>` con lo snapshot grezzo
- `metadata.json` con URL finale, stato, hash, content-type, dimensione e data
  di acquisizione

In radice scrive inoltre:

- `index.json` con il riepilogo dell’intera acquisizione

Nel caso di `sync`, l’indice registra anche lo stato delle modifiche e le
date necessarie a ricostruirne la sequenza:

- `changeState = new|updated|unchanged`
- `firstFetchedAt`
- `lastSeenAt`
- `lastChangedAt`
- `nextSuggestedFetchAt`

## Import manuale

Per i documenti `auth-gated` o `manual-import`, lo scraping non deve aggirare
le condizioni di accesso. Il percorso previsto parte dallo scaricamento umano
dal portale o dall’area riservata autorizzata, prosegue con la collocazione
locale fuori Git e con l’aggiunta al segnaposto di versione, responsabile e
note di licenza o uso. Solo successivamente è prevista l’eventuale
indicizzazione nel corpus locale.

## Relazione con il futuro MCP

Il MCP locale (`WUL-177`) ha un ambito limitato: ricerca nel manifest e nel
corpus locale, recupero di documenti già acquisiti e navigazione per area,
tag, fonte o versione. Non serve a rendere ogni consultazione dipendente da
un’acquisizione in diretta dai portali regionali.

Questa nota non indica il riferimento al runbook operativo MCP.

## Nota operativa su WUL-179

L’intervento `WUL-179` non introduce ancora un servizio sempre attivo né una
schedulazione `launchd`. Costruisce invece la base necessaria: regole di
aggiornamento per fonte, sincronizzazione incrementale, rilevamento delle
modifiche e report locale di freschezza.

La schedulazione periodica potrà appoggiarsi a questa base senza cambiare il
significato dei dati del corpus.
