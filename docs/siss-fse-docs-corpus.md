<!-- Codex: created 2026-04-14 -->
# Corpus documentale SISS / FSE 2.0

> Stato documento: `CANONICAL`

Questa nota governa il primo thin slice `WUL-176`: catalogo sorgenti,
fetch locale, import manuale controllato e preparazione del futuro MCP
documentale.

Riferimenti canonici:

- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md)
- [SECURITY.md](../SECURITY.md)

## Obiettivo

Mettere MediFlow nelle condizioni di consultare e mantenere una base tecnica
locale per:

- Menu SISS e moduli regionali
- autenticazione/SSO/credenziali operatore
- prescrittivo regionale
- anagrafe/gestione assistiti
- FSE regionale e FSE 2.0 nazionale
- certificati di malattia, SGDT e servizi adiacenti

## Principi

1. Il repository contiene il catalogo delle fonti e il tooling, non il corpus
   completo scaricato.
2. Gli snapshot reali vengono scritti in `tmp/siss-docs-corpus/`, fuori Git.
3. I documenti riservati o autenticati entrano solo come `manual-import`.
4. Nessun dato paziente o payload clinico reale deve comparire nel corpus.
5. Il futuro MCP legge il corpus locale; non sostituisce il corpus.
6. La freschezza del corpus dipende da un motore di sync locale con change
   detection, non dal solo layer MCP.

## Manifest sorgenti

Il manifest iniziale e in:

`scripts/siss-docs-corpus-sources.json`

Ogni voce dichiara almeno:

- `id`
- `title`
- `area`
- `url`
- `access`
- `captureStrategy`
- `tags`

Valori operativi:

- `access = public`: sorgente fetchabile automaticamente
- `access = auth-gated`: sorgente nota ma non fetchata senza credenziali
- `access = manual-import`: placeholder per documenti da import locale guidato

- `captureStrategy = snapshot-html`: salva la risposta testuale/HTML
- `captureStrategy = snapshot-github-html`: salva la pagina GitHub come snapshot
- `captureStrategy = manual-placeholder`: registra solo metadati/placeholder
- `refreshHours = N`: cadenza suggerita di refresh per la sorgente

## Comandi

Validazione del manifest:

```bash
npm run docs:siss-corpus:validate
```

Fetch del corpus pubblico nel path default ignorato da Git:

```bash
npm run docs:siss-corpus:fetch
```

Sync incrementale con memoria delle versioni viste:

```bash
npm run docs:siss-corpus:sync
```

Report di freschezza del corpus sincronizzato:

```bash
npm run docs:siss-corpus:report
```

Fetch limitato a un sottoinsieme:

```bash
npm run docs:siss-corpus:fetch -- --only siss-modalita-accesso,fse-support-readme
```

Output alternativo:

```bash
npm run docs:siss-corpus:fetch -- --output-dir tmp/siss-docs-corpus-smoke
```

## Struttura output

Per ogni sorgente fetchata il tool scrive:

- `body.<ext>` con lo snapshot grezzo
- `metadata.json` con URL finale, status, hash, content-type, dimensione e data
  fetch

In radice scrive inoltre:

- `index.json` con il riepilogo dell intero fetch

Nel caso di `sync`, l indice contiene anche:

- `changeState = new|updated|unchanged`
- `firstFetchedAt`
- `lastSeenAt`
- `lastChangedAt`
- `nextSuggestedFetchAt`

## Import manuale

I documenti `auth-gated` o `manual-import` non vengono forzati via scraping.

Flusso previsto:

1. scarico umano da portale/area riservata autorizzata
2. collocazione locale fuori Git
3. arricchimento del placeholder con versione, owner, note di licenza/uso
4. eventuale indicizzazione nel corpus locale successivo

## Relazione con il futuro MCP

Il futuro MCP locale (`WUL-177`) dovra offrire solo:

- ricerca nel manifest/corpus locale
- fetch di documenti gia acquisiti
- navigazione per area/tag/fonte/versione

Non dovra essere il meccanismo con cui si dipende da fetch live dei portali
regionali.

## Nota operativa su WUL-179

Il thin slice `WUL-179` non introduce ancora un daemon sempre attivo o una
schedulazione `launchd`. Introduce pero il nucleo che serve davvero:

- policy di refresh per sorgente
- sync incrementale
- change detection
- report locale di freschezza

La schedulazione periodica potra essere aggiunta sopra questo nucleo senza
riscrivere la semantica del corpus.
