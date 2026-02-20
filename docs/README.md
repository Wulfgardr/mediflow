# Documentazione MediFlow — Indice Canonico

Questo file è il punto di ingresso unico: dove leggere, cosa aggiornare e quale documento prevale.

Ultimo aggiornamento: 2026-02-20

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
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Setup/testing nativo: [docs/NATIVE.md](./NATIVE.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/native-testing.md](./native-testing.md), [docs/parity-smoke.md](./parity-smoke.md), [docs/parity-click-map-macos.md](./parity-click-map-macos.md)
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
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Piano engineering a breve termine | [PLANS.md](../PLANS.md) | `CANONICAL` | 2-6 settimane, operativo. |
| Matrice parity web/macOS | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Gate capability-by-capability (funzioni/campi/flessibilita/autonomia). |
| Roadmap prodotto | [docs/ROADMAP.md](./ROADMAP.md) | `CANONICAL` | Direzione prodotto/versioni, separata da `PLANS.md`. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Mappa operativa web + native + servizi locali. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries). |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Elenco navigabile e descrittivo di tutti i `.md` tracciati nel repository. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Smoke test interattivi | [docs/e2e-smoke.md](./e2e-smoke.md) | `SECONDARY` | Harness operativo per run E2E isolati e uso in VM. |
| Parity smoke harness | [docs/parity-smoke.md](./parity-smoke.md) | `SECONDARY` | Runner unico web+native con report artifact e gating configurabile. |
| Click-map parity macOS | [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | `SECONDARY` | Checklist manuale dei click-path macOS durante i parity sweep. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Versione compatta/rapida. |
| Setup client macOS e TLS locale | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL` | Materiale operativo nativo. |
| Compliance/GDPR/FHIR | [docs/COMPLIANCE.md](./COMPLIANCE.md) | `CANONICAL` | Quadro compliance e interoperabilità. |
| Manuale utente medico | [docs/MANUALE.md](./MANUALE.md) | `CANONICAL` | Uso prodotto lato clinico. |

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
