<!-- Codex: created 2026-05-02 -->
# SISS/FSE Corpus MCP

> Stato documento: `SECONDARY` tooling operativo.

Questa guida descrive il server locale read-only che espone il corpus
documentale SISS/FSE gia sincronizzato. Le decisioni di prodotto e sicurezza
restano in:

- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)
- [SECURITY.md](../SECURITY.md)

## Scopo

Il server `mediflow-siss-fse-corpus` permette ad agent e strumenti compatibili
MCP di interrogare solo il corpus locale gia acquisito:

- manifest sorgenti approvate
- indice `sync` con freshness e change state
- metadata per fonte
- snapshot locali gia presenti su disco

Non esegue fetch live, non accede a dati paziente e non aggira fonti
autenticate o `manual-import`.

Versione server locale: `0.1.0` (`SERVER_VERSION` nello script).

## Comandi

Prima sincronizzare o fetchare il corpus:

```bash
npm run docs:siss-corpus:sync
```

Smoke del server MCP su fixture locale:

```bash
npm run mcp:siss-fse-corpus:test
```

Verifica opzionale della configurazione Codex MCP locale:

```bash
npm run mcp:siss-fse-corpus:validate
```

Avvio manuale:

```bash
node scripts/siss-fse-corpus-mcp.mjs \
  --manifest scripts/siss-docs-corpus-sources.json \
  --corpus-dir tmp/siss-docs-corpus
```

## Configurazione MCP

Snippet generico per client compatibili:

```json
{
  "mcpServers": {
    "siss-fse-corpus": {
      "command": "node",
      "args": [
        "/absolute/path/to/medical-record-app/scripts/siss-fse-corpus-mcp.mjs",
        "--manifest",
        "/absolute/path/to/medical-record-app/scripts/siss-docs-corpus-sources.json",
        "--corpus-dir",
        "/absolute/path/to/medical-record-app/tmp/siss-docs-corpus"
      ]
    }
  }
}
```

Setup rapido Codex:

```bash
codex mcp add siss-fse-corpus -- node "$(pwd)/scripts/siss-fse-corpus-mcp.mjs" \
  --manifest "$(pwd)/scripts/siss-docs-corpus-sources.json" \
  --corpus-dir "$(pwd)/tmp/siss-docs-corpus"
```

## Risorse

- `siss-fse://sources`
- `siss-fse://index`
- `siss-fse://source/<id>`
- `siss-fse://body/<id>`

Le risorse `body/<id>` esistono solo per fonti con snapshot locale. Le fonti
`manual-import` restano leggibili come metadata/placeholder.

## Tool

| Tool | Uso |
| --- | --- |
| `siss_fse_list_sources` | Elenca fonti filtrabili per `area`, `access`, `tag`, `tags`, `freshness`. |
| `siss_fse_search` | Cerca nel manifest e nei body locali senza fetch live. |
| `siss_fse_source` | Restituisce metadata, eventuale versione, data fetch, freshness e stato locale di una fonte. |
| `siss_fse_fetch` | Restituisce il body locale gia acquisito, se disponibile. |

## Guardrail

- Solo corpus locale, niente scraping live.
- Nessun dato paziente o payload clinico nelle query.
- Le fonti `auth-gated` e `manual-import` non vengono recuperate
  automaticamente.
- Il server e uno strumento di consultazione documentale: non abilita, da solo,
  una integrazione SISS/FSE certificata.
