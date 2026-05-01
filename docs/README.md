# Documentazione MediFlow — Indice Canonico

Questo file è il punto di ingresso unico: dove leggere, cosa aggiornare e quale documento prevale.

Ultimo aggiornamento: 2026-05-01

## Percorso di lettura consigliato

Per orientarti rapidamente:

1. [README.md](../README.md)
2. [docs/README.md](./README.md) (questo file)
3. [ARCHITECTURE.md](../ARCHITECTURE.md)
4. [SECURITY.md](../SECURITY.md)
5. [CONTRIBUTING.md](../CONTRIBUTING.md)
6. [docs/ROADMAP.md](./ROADMAP.md)
7. [docs/walkthrough.md](./walkthrough.md)
8. [docs/adr/](./adr/README.md) (partendo dai più recenti)

Approfondimenti utili:

- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- FAQ pubbliche e stato sintetico del prodotto: [docs/FAQ.md](./FAQ.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Contratto OpenAPI `/api/v1`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md)

## Convenzione stato documenti

- `CANONICAL`: fonte di verità da aggiornare quando cambia un tema.
- `SECONDARY`: approfondimento o sintesi; utile, ma non prevale se in conflitto.
- `LEGACY`: materiale storico/visuale; consultabile, non decisionale.

## Fonte autorevole per tema

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Onboarding progetto | [README.md](../README.md) | `CANONICAL` | Punto di ingresso generale. |
| Stato completo del sistema | [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | `CANONICAL` | Lettura unificata corrente: prodotto, runtime, boundary, AI/document intelligence, Apple clients e split private/OSS. |
| Visione architetturale stabile | [ARCHITECTURE.md](../ARCHITECTURE.md) | `CANONICAL` | Confini e principi che cambiano raramente. |
| Sicurezza e redazione dati | [SECURITY.md](../SECURITY.md) | `CANONICAL` | Policy di sicurezza, threat model, logging rules. |
| Workflow di contribuzione | [CONTRIBUTING.md](../CONTRIBUTING.md) | `CANONICAL` | Definition of Done e routine verifica. |
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Contratto API locale `/api/v1` | [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml) | `CANONICAL` | Spec OpenAPI client-facing; processo/versioning governati da ADR 0010. |
| Runbook manutenzione OpenAPI | [docs/openapi/README.md](./openapi/README.md) | `SECONDARY` | Workflow operativo per mantenere aggiornata la spec durante lo sviluppo. |
| Matrice parity web/macOS | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Gate capability-by-capability (funzioni/campi/flessibilita/autonomia). |
| FAQ pubbliche | [docs/FAQ.md](./FAQ.md) | `SECONDARY` | Sintesi rapida per capire cosa fa oggi MediFlow, quali sono i boundary dichiarati e come orientarsi nel progetto. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Matrice baseline ufficiale GTW/FSE | [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | `CANONICAL` | Gap analysis versionata tra artifact ministeriali `it-fse-support` e stato reale MediFlow. |
| Baseline SISS | [docs/siss-baseline.md](./siss-baseline.md) | `CANONICAL` | Stato attuale, fonti ufficiali, matrice del prototipo contestuale e sequenza `WUL-43` -> `WUL-45` -> `WUL-44` -> `WUL-178` -> `WUL-180` per l'integrazione SISS. |
| Fattibilita SSI/A2A SISS oltre `portal-handoff` | [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) | `CANONICAL` | Boundary ufficiale del filone `WUL-180`: cosa e integrabile davvero con `SSI`, `A2A`, `webapp` e onboarding regionale, e cosa non e ancora dimostrabile con sole fonti pubbliche. |
| Modulo Prescrittivo Regionale | [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md) | `CANONICAL` | Nota scenario-specific `WUL-181`: chiarisce per il prescrittivo il boundary tra handoff, richiamo della webapp ufficiale, uso di WS/API e UI custom non ancora dimostrata. |
| Corpus documentale SISS/FSE | [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md) | `CANONICAL` | Governa `WUL-176` e `WUL-179`: catalogo sorgenti, fetch/sync locale fuori Git, placeholder `manual-import` e report di freshness come base documentale delle integrazioni regionali. |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Mappa operativa web + native + servizi locali, inclusi `home-base` read-only, document intelligence artifact-first e guard di revisione shell. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries), inclusi artifact documentali cifrati e boundary `network-home-base`. |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Elenco navigabile e descrittivo di tutti i `.md` tracciati nel repository. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Smoke paired mobile home-base | [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | `SECONDARY` | Runbook operativo per smoke iPhone/iPad contro `home-base` reale con pairing temporaneo e sessione operatore. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Versione compatta/rapida del sistema reale su `main`, con overview su Clinical Workbench, home-base, document intelligence, SISS/FSE e guardrail locali. |
| Setup client macOS e TLS locale | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL` | Materiale operativo nativo. Dopo `v0.5.0` descrive lo snapshot corrente e i vincoli da preservare durante il rebuild controllato della shell macOS. |
| Compliance/GDPR/FHIR | [docs/COMPLIANCE.md](./COMPLIANCE.md) | `CANONICAL` | Quadro compliance e interoperabilità. |
| Manuale utente medico | [docs/MANUALE.md](./MANUALE.md) | `CANONICAL` | Uso prodotto lato clinico. |
| ADR native token bootstrap secure-first | [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | `CANONICAL` | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| ADR audit taxonomy minima | [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | `CANONICAL` | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| ADR backup artifact v1 manifest/preflight | [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | `CANONICAL` | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| ADR backup notturno via `launchd` | [docs/adr/0022-nightly-backup-via-macos-launchd.md](./adr/0022-nightly-backup-via-macos-launchd.md) | `CANONICAL` | Thin slice `WUL-30`: schedulazione notturna macOS via LaunchAgent utente e runner headless locale. |
| ADR retention backup keep-last-N | [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | `CANONICAL` | Thin slice `WUL-31`: retention automatica limitata ai backup scheduler-owned con preview dry-run e cleanup tracciato. |
| ADR policy lockout auth | [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | `CANONICAL` | Policy lockout condivisa tra web e macOS: soglia, finestra, durata e contratto errori `401/423`. |
| ADR AI Patient Insight full-auto/manual Pro | [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | `CANONICAL` | Budget configurabili e persistenti per AI Patient Insight, con thin slice limitata a settings UI + runtime builder/generation. |
| ADR native patient insight markdown contract | [docs/adr/0019-native-patient-insight-markdown-contract.md](./adr/0019-native-patient-insight-markdown-contract.md) | `CANONICAL` | Il client macOS salva `aiSummary` in markdown con citazioni, mantenendo compatibilita col consumer web attuale e rinviando l'envelope raw persistito. |
| ADR AI insight source hierarchy and conflict rules | [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md) | `CANONICAL` | Formalizza la gerarchia delle fonti cliniche e le regole di conflitto/fallback per `AI Patient Insight`, gia applicate dal builder corrente. |
| ADR terminology registry locale in settings JSON | [docs/adr/0021-terminology-registry-in-settings-json.md](./adr/0021-terminology-registry-in-settings-json.md) | `CANONICAL` | Registry locale terminologie versionato in `settings`, senza migrazioni, con update admin auditabile e read-path usato da `systems/search/resolve`. |
| ADR web/core stabilization before next version bump | [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | `CANONICAL` | Sequenza di consolidamento web/core prima del prossimo version bump: helper condivisi per patient payload/structured fields, `typecheck` canonico e split incrementale dei god files. |
| ADR SISS local adapter contract and error taxonomy | [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | `CANONICAL` | Foundation locale del filone SISS: azioni tipizzate, error taxonomy stabile, retry transiente e metadata audit redatti prima dell'integrazione UI. |
| ADR boundary integrazione nativa SISS oltre `portal-handoff` | [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | `CANONICAL` | Fissa il boundary `WUL-180`: la vera integrazione nativa SISS/FSE richiede scenari approvati, qualifica/provisioning coerenti col contesto `SSI`, e non puo essere trattata come semplice consumo libero del backend regionale. |
| ADR first slice prescrittivo regionale `webapp-assisted` | [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | `CANONICAL` | Fissa la decisione `WUL-181`: il primo step oltre l'handoff per il prescrittivo usa il percorso ufficiale della webapp regionale e non una UI custom MediFlow. |
| ADR Graphite workbench come unica shell web ufficiale | [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | `CANONICAL` | Fissa `WUL-196`: la shell Graphite/Clinical Workbench diventa il solo runtime UI supportato su `main`, senza chooser visuale persistito o shell concorrenti. |
| ADR ritiro preview profiles funzionali su `main` | [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | `CANONICAL` | Fissa `WUL-199`: il workbench ufficiale non espone piu preview profiles runtime; AI e Smart Import restano live e il contesto paziente SISS diventa stabile nella scheda paziente. |
| ADR architettura shared Apple client e runtime `home-base` packaged | [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | `CANONICAL` | Governa `WUL-188`: core Apple condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come nodo `home-base` autorevole, client mobili paired senza accesso diretto a SQLite e parity non-AI estesa via `/api/v1/network/*`. |
| ADR corpus documentale SISS/FSE locale | [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | `CANONICAL` | Fissa `WUL-176`: prima corpus locale/versionato e fetch/sync controllato, poi eventuale MCP solo sopra un corpus approvato, non scraping live come sorgente primaria. |
| ADR PIN rotation via client-side rewrap | [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | `CANONICAL` | Cambio PIN zero-knowledge: il client riavvolge la stessa master key con un nuovo KEK derivato dal nuovo PIN, senza ricifrare i dati clinici. |
| ADR local-only default e network home-base opt-in | [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md) | `CANONICAL` | Governa `WUL-117`: `local-only` resta il default, `network home-base` diventa una modalita esplicita su LAN fidata, il nodo paired e autorevole solo in modalita network e la first thin slice resta read-only prima di replica/sync. |
| ADR thin slice replica network home-base come snapshot mirror | [docs/adr/0035-network-replica-thin-slice-snapshot-mirror.md](./adr/0035-network-replica-thin-slice-snapshot-mirror.md) | `CANONICAL` | Governa `WUL-120`: la first thin slice di replica resta uno snapshot mirror governato con fallback locale esplicito e manual review, senza introdurre ancora sync record-level o multi-master. |
| ADR thin slice identity network con credenziali nodo e scope esplicito | [docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md) | `CANONICAL` | Governa `WUL-122`: pairing device e login operatore restano separati, l'identita minima riusa i `users` locali del nodo e lo scope clinico `network` viene risolto come `session-context-else-node-default`. |
| ADR boundary auth del primo data plane network read-only | [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md) | `CANONICAL` | Governa `WUL-150`: bootstrap pairing PHI-safe, conferma locale esplicita, credenziale dedicata del device paired e primo accesso read-only ai pazienti che richiede sempre paired client + sessione operatore. |
| ADR nuova anagrafica da documento reviewable | [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | `CANONICAL` | Fissa il create-flow document-driven della nuova anagrafica: review esplicita prima del salvataggio, riconciliazione locale ICD/AIFA e persistenza strutturata solo per le terapie abbastanza confermate. |

## File sovrapposti o secondari

- [docs/product_roadmap.md](./product_roadmap.md): alias storico della roadmap prodotto, da considerare **deprecato**. La fonte attiva è [docs/ROADMAP.md](./ROADMAP.md).
- `docs/index.html`: pagina visuale legacy utile per consultazione rapida, ma non fonte di verità per decisioni architetturali.

## Regole rapide di mantenimento

1. Una decisione duratura deve finire in ADR.
3. Un cambio di direzione prodotto finisce in [docs/ROADMAP.md](./ROADMAP.md).
4. Se un `.md` viene aggiunto/rimosso/rinominato, aggiorna [docs/markdown-index.md](./markdown-index.md).
5. Se cambia la fonte autorevole di un tema, aggiorna questa mappa.
6. Se due file dicono cose diverse, prevale la fonte canonica indicata sopra.
