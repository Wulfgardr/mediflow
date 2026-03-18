# Documentazione MediFlow — Indice Canonico

Questo file è il punto di ingresso unico: dove leggere, cosa aggiornare e quale documento prevale.

Ultimo aggiornamento: 2026-03-18

## Policy di consultazione (agent)

Documenti da consultare **sempre**:

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/README.md](./README.md) (questo file)
4. [ARCHITECTURE.md](../ARCHITECTURE.md)
5. [SECURITY.md](../SECURITY.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)
7. [PLANS.md](../PLANS.md) (se presente)
8. [docs/adr/](./adr/README.md) (partendo dai più recenti)

Documenti da consultare **al bisogno**:

- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- Playbook orchestrazione lavoro con Linear/Codex: [docs/linear-codex-playbook.md](./linear-codex-playbook.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Contratto OpenAPI `/api/v1`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md)
- Setup/testing nativo: [docs/NATIVE.md](./NATIVE.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/native-testing.md](./native-testing.md), [docs/parity-smoke.md](./parity-smoke.md), [docs/parity-click-map-macos.md](./parity-click-map-macos.md)
- Test concorrenza cross-client sui pazienti: [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md)
- Tooling documentale Apple (MCP): [docs/apple-docs-mcp.md](./apple-docs-mcp.md)
- Compliance e roadmap: [docs/COMPLIANCE.md](./COMPLIANCE.md), [docs/ROADMAP.md](./ROADMAP.md), [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md)

## Ordine di lettura consigliato

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [ARCHITECTURE.md](../ARCHITECTURE.md)
4. [SECURITY.md](../SECURITY.md)
5. [CONTRIBUTING.md](../CONTRIBUTING.md)
6. [docs/adr/](./adr/README.md) (partendo dai più recenti)
7. [PLANS.md](../PLANS.md)
8. [docs/walkthrough.md](./walkthrough.md)
9. [docs/markdown-index.md](./markdown-index.md)

## Convenzione stato documenti

- `CANONICAL`: fonte di verità da aggiornare quando cambia un tema.
- `SECONDARY`: approfondimento o sintesi; utile, ma non prevale se in conflitto.
- `LEGACY`: materiale storico/visuale; consultabile, non decisionale.

## Fonte autorevole per tema

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Regole agent e vincoli | [AGENTS.md](../AGENTS.md) | `CANONICAL` | Fonte primaria per processi e limiti operativi. |
| Onboarding progetto | [README.md](../README.md) | `CANONICAL` | Punto di ingresso generale. |
| Visione architetturale stabile | [ARCHITECTURE.md](../ARCHITECTURE.md) | `CANONICAL` | Confini e principi che cambiano raramente. |
| Sicurezza e redazione dati | [SECURITY.md](../SECURITY.md) | `CANONICAL` | Policy di sicurezza, threat model, logging rules. |
| Workflow di contribuzione | [CONTRIBUTING.md](../CONTRIBUTING.md) | `CANONICAL` | Definition of Done e routine verifica. |
| Orchestrazione delivery Linear + Codex | [docs/linear-codex-playbook.md](./linear-codex-playbook.md) | `CANONICAL` | Workflow operativo planning -> coding -> audit trail con issue linking e convenzioni branch/PR. |
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Contratto API locale `/api/v1` | [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml) | `CANONICAL` | Spec OpenAPI client-facing; processo/versioning governati da ADR 0010. |
| Runbook manutenzione OpenAPI | [docs/openapi/README.md](./openapi/README.md) | `SECONDARY` | Workflow operativo per mantenere aggiornata la spec durante lo sviluppo. |
| Piano engineering a breve termine | [PLANS.md](../PLANS.md) | `CANONICAL` | 2-6 settimane, operativo. |
| Matrice parity web/macOS | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Gate capability-by-capability (funzioni/campi/flessibilita/autonomia). |
| Roadmap prodotto | [docs/ROADMAP.md](./ROADMAP.md) | `CANONICAL` | Direzione prodotto/versioni, separata da `PLANS.md`. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Mappa operativa web + native + servizi locali. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries). |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Elenco navigabile e descrittivo di tutti i `.md` tracciati nel repository. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Smoke test interattivi | [docs/e2e-smoke.md](./e2e-smoke.md) | `SECONDARY` | Harness operativo per run E2E isolati e uso in VM. |
| Test concorrenza pazienti cross-client | [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md) | `SECONDARY` | Runner isolato web + `/api/v1` per conflitti `version` sui pazienti. |
| Parity smoke harness | [docs/parity-smoke.md](./parity-smoke.md) | `SECONDARY` | Runner unico web+native con report artifact e gating configurabile. |
| Click-map parity macOS | [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | `SECONDARY` | Checklist manuale dei click-path macOS durante i parity sweep. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Versione compatta/rapida. |
| Setup client macOS e TLS locale | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL` | Materiale operativo nativo. |
| Compliance/GDPR/FHIR | [docs/COMPLIANCE.md](./COMPLIANCE.md) | `CANONICAL` | Quadro compliance e interoperabilità. |
| Manuale utente medico | [docs/MANUALE.md](./MANUALE.md) | `CANONICAL` | Uso prodotto lato clinico. |
| ADR native token bootstrap secure-first | [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | `CANONICAL` | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| ADR audit taxonomy minima | [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | `CANONICAL` | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| ADR backup artifact v1 manifest/preflight | [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | `CANONICAL` | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| ADR policy lockout auth | [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | `CANONICAL` | Policy lockout condivisa tra web e macOS: soglia, finestra, durata e contratto errori `401/423`. |
| ADR AI Patient Insight full-auto/manual Pro | [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | `CANONICAL` | Budget configurabili e persistenti per AI Patient Insight, con thin slice limitata a settings UI + runtime builder/generation. |

## File sovrapposti o secondari

- [docs/product_roadmap.md](./product_roadmap.md): alias storico della roadmap prodotto, da considerare **deprecato**. La fonte attiva è [docs/ROADMAP.md](./ROADMAP.md).
- `docs/index.html`: pagina visuale legacy utile per consultazione rapida, ma non fonte di verità per decisioni architetturali.
- `docs/private/openhospital-alignment/*`: workspace operativo privato locale. Le decisioni persistenti vanno riallineate su [PLANS.md](../PLANS.md) e/o ADR pubblici.

## Regole rapide di mantenimento

1. Una decisione duratura deve finire in ADR.
2. Un cambio di priorità a breve finisce in [PLANS.md](../PLANS.md).
3. Un cambio di direzione prodotto finisce in [docs/ROADMAP.md](./ROADMAP.md).
4. Se un `.md` viene aggiunto/rimosso/rinominato, aggiorna [docs/markdown-index.md](./markdown-index.md).
5. Se cambia la fonte autorevole di un tema, aggiorna questa mappa.
6. Se due file dicono cose diverse, prevale la fonte canonica indicata sopra.
