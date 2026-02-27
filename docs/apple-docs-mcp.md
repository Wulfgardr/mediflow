<!-- Codex: created 2026-02-26 -->
# Apple Docs MCP (tooling sviluppo native)

> [!NOTE]
> **Stato documento: SECONDARY (tooling operativo).**
> Le decisioni permanenti restano in [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [PLANS.md](../PLANS.md) e negli [ADR](./adr/README.md).

Questa guida integra `apple-docs-mcp` come tool di sviluppo per il lavoro su SwiftUI/macOS/iOS/iPadOS in MediFlow.

Repository ufficiale: [kimsungwhee/apple-docs-mcp](https://github.com/kimsungwhee/apple-docs-mcp)  
Package npm: [@kimsungwhee/apple-docs-mcp](https://www.npmjs.com/package/@kimsungwhee/apple-docs-mcp)

---

## Scopo

- Dare a agent/editor accesso rapido alla documentazione Apple ufficiale durante sviluppo e review native.
- Ridurre errori su availability, deprecazioni, API usage e pattern consigliati.
- Migliorare la qualita delle decisioni tecniche prima di toccare codice Swift.

## Non-obiettivi

- Nessuna dipendenza runtime nel prodotto MediFlow.
- Nessuna modifica ai flussi dati clinici.
- Nessuna egress di dati paziente: usare solo query tecniche generiche.

---

## Versione pin consigliata

Per ridurre drift, usare un pin esplicito:

```bash
@kimsungwhee/apple-docs-mcp@1.0.23
```

Smoke check locale:

```bash
npm run mcp:apple-docs:test
```

---

## Configurazione MCP (snippet)

Inserire nel file di configurazione MCP del client usato (Cursor/Claude Desktop/altri compatibili):

```json
{
  "mcpServers": {
    "apple-docs": {
      "command": "npx",
      "args": ["-y", "@kimsungwhee/apple-docs-mcp@1.0.23"]
    }
  }
}
```

## Setup rapido Codex (consigliato)

Per integrare il server direttamente in Codex (CLI/Desktop):

```bash
codex mcp add apple-docs -- npx -y @kimsungwhee/apple-docs-mcp@1.0.23
```

Verifica configurazione:

```bash
codex mcp list
codex mcp get apple-docs
```

Rimozione (se serve):

```bash
codex mcp remove apple-docs
```

Nota operativa:
- Se compare `ENOTFOUND registry.npmjs.org` durante i test, e un problema di rete/proxy locale, non di MediFlow.

---

## Guardrail sicurezza (obbligatori)

- Non includere mai PHI/PII nelle query MCP.
- Usare sempre esempi sintetici, mai payload reali paziente.
- Trattare MCP come strumento di consultazione documentale, non come canale dati.
- Se una decisione architetturale cambia, registrarla in ADR prima dell'implementazione.

Riferimenti policy:
- [SECURITY.md](../SECURITY.md)
- [AGENTS.md](../AGENTS.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## Workflow consigliato per MediFlow

1. Definire il task native (es. SwiftUI, Network.framework, sandbox, XCTest).
2. Fare query MCP su:
   - availability by platform/version
   - API deprecations/migration notes
   - sample code pattern ufficiali
3. Implementare il thin slice locale.
4. Aggiornare documentazione/ADR se emergono decisioni persistenti.
5. Eseguire verify loop locale (`lint`, `build`, test native se rilevanti).

---

## Query utili (template)

- "Show Network.framework APIs for Bonjour service discovery on macOS/iOS and minimum OS availability."
- "Explain security-scoped bookmarks for App Sandbox and persistent folder access in macOS apps."
- "Show URLSession certificate/public key pinning approaches for local HTTPS endpoints."
- "Show XCTest patterns for SwiftUI view model behavior tests."
