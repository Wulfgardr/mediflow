# Indice Completo Markdown (Repo)

> [!NOTE]
> GitHub mostra in alto solo alcuni file speciali (`README`, `CONTRIBUTING`, `SECURITY`, ecc.).
> Questo file elenca invece **tutti** i `.md` tracciati nella repository con una sintesi rapida d'uso.

Ultimo aggiornamento: 2026-02-20

## Come usare questo indice

- Se devi capire **quali file sono canonici**, parti da [docs/README.md](./README.md).
- Se devi trovare **dove sta un tema specifico**, usa le tabelle qui sotto.
- Se aggiungi/rimuovi/rinomini un `.md`, aggiorna subito questo file e [docs/README.md](./README.md).

## Orchestrazione e governance (consultazione sempre)

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Regole globali per agent, vincoli e processo decisionale. | Sempre, prima di qualsiasi task. |
| [README.md](../README.md) | Onboarding generale progetto e punti di accesso documentazione. | Sempre, in fase di avvio. |
| [docs/README.md](./README.md) | Mappa canonica della documentazione (fonte autorevole per tema). | Sempre, per decidere precedenze. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Visione architetturale stabile, confini e non-obiettivi. | Sempre, per cambi tecnici non banali. |
| [SECURITY.md](../SECURITY.md) | Policy sicurezza, threat model e regole redazione/logging. | Sempre, per qualunque cambio dati/API. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow contributivo e Definition of Done. | Sempre, prima di chiudere un task. |
| [PLANS.md](../PLANS.md) | Piano engineering operativo (2-6 settimane). | Sempre, per allineare priorità correnti. |
| [CHANGELOG.md](../CHANGELOG.md) | Storico release e cambiamenti rilevanti. | Al bisogno, per contesto versioni. |

## Architettura, flussi e parity

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/walkthrough.md](./walkthrough.md) | Walkthrough canonico end-to-end (web + native + servizi locali). | Per capire flussi completi e integrazione moduli. |
| [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | Topologia dati, trust boundaries, cifratura e percorsi digitali. | Per analisi data flow e impatti sicurezza. |
| [docs/parity-matrix.md](./parity-matrix.md) | Stato parity web/macOS su moduli core e gap operativi. | Per steering parity e release readiness. |
| [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | Deep dive tecnico esteso dell'architettura MediFlow. | Per approfondimenti implementativi. |
| [docs/system_architecture.md](./system_architecture.md) | Sintesi rapida dell'architettura operativa. | Per overview veloce in onboarding/review. |

## Native, setup e testing

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/NATIVE.md](./NATIVE.md) | Guida tecnica principale client macOS SwiftUI. | Per sviluppo funzionale native. |
| [docs/native-setup.md](./native-setup.md) | Setup automatico ambiente client nativo. | Prima di avviare sviluppo/test native. |
| [docs/native-launch.md](./native-launch.md) | Avvio rapido app macOS via script/launcher. | Per esecuzione operativa locale. |
| [docs/local-api-tls.md](./local-api-tls.md) | TLS proxy locale e trasporto sicuro per native API. | Per debug networking/certificate pinning. |
| [docs/native-testing.md](./native-testing.md) | Strategia canonica test macOS (SwiftPM/XCTest/Xcode). | Per piani test e parity sweep. |
| [docs/e2e-smoke.md](./e2e-smoke.md) | Harness smoke test web Playwright in ambiente isolato. | Per verifica rapida web in CI/VM. |
| [docs/icd-local-setup.md](./icd-local-setup.md) | Setup locale container ICD-11. | Quando si lavora su diagnostica ICD. |

## Prodotto, compliance e contesto clinico

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/ROADMAP.md](./ROADMAP.md) | Roadmap prodotto canonica. | Per direzione prodotto/release narrative. |
| [docs/product_roadmap.md](./product_roadmap.md) | Roadmap storica (deprecata). | Solo per contesto storico. |
| [docs/COMPLIANCE.md](./COMPLIANCE.md) | Quadro compliance GDPR/FHIR e interoperabilità. | Per requisiti normativi e policy operative. |
| [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | Roadmap codifiche cliniche FSE/EDS. | Per sviluppo terminologie e export documentale. |
| [docs/MANUALE.md](./MANUALE.md) | Manuale utente medico. | Per supporto operativo lato clinico. |
| [oss-assets/README.md](../oss-assets/README.md) | Presentazione OSS e posizionamento progetto. | Per contesto pubblico/comunicazione. |

## Tracciabilità agent e metadoc

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/agent-attribution.md](./agent-attribution.md) | Registro contributi agent (Codex, altri). | Quando si aggiungono cambi non banali da agent. |
| [docs/markdown-index.md](./markdown-index.md) | Indice completo markdown con sintesi. | Per navigazione completa e controllo copertura doc. |

## ADR (decisioni architetturali)

| File | Tema |
| --- | --- |
| [docs/adr/README.md](./adr/README.md) | Regole operative ADR (quando, come, stati). |
| [docs/adr/0000-template.md](./adr/0000-template.md) | Template standard ADR. |
| [docs/adr/0001-native-macos-client.md](./adr/0001-native-macos-client.md) | Prototipo client macOS su API locale versionata. |
| [docs/adr/0002-native-security-and-modules.md](./adr/0002-native-security-and-modules.md) | Sicurezza native (PIN/crypto) + moduli clinici minimi. |
| [docs/adr/0003-native-write-clinical-ai.md](./adr/0003-native-write-clinical-ai.md) | Write operation native via `/api/v1` + strumenti clinici. |
| [docs/adr/0004-exemptions-catalog.md](./adr/0004-exemptions-catalog.md) | Catalogo esenzioni locale e mapping su paziente. |
| [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md) | Parity web/native su contratto API condiviso. |
| [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md) | Plugin terminologie unificato + profili FSE/EDS. |
| [docs/adr/0007-strict-web-native-parity-gate.md](./adr/0007-strict-web-native-parity-gate.md) | Gate parity stretta (poi superseded). |
| [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md) | Modello operativo web-first + parity sweep. |
| [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md) | Strategia test macOS con XCTest/Xcode separata dal web runner. |

## Checklist manutenzione indice

1. Verifica inventario file: `rg --files -g '*.md' | sort`.
2. Assicurati che ogni file appaia in questo indice con una descrizione.
3. Aggiorna data "Ultimo aggiornamento".
4. Se cambiano priorità o fonti autorevoli, aggiorna anche [docs/README.md](./README.md).
