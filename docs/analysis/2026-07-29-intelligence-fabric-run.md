---
summary: "Run record CoS del programma Intelligence Fabric WUL-522: consolidamento stack provider, contratto ADR 0089, scaffold multipiattaforma e verifica."
read_when:
  - "Si riprende o si verifica il programma Intelligence Fabric post-0.8."
  - "Si valuta lo scaffold fabric, le venue o i profili egress dopo MediFlow 0.8."
---

# Intelligence Fabric MediFlow post-0.8

Stato documento: `SECONDARY / RUN RECORD`

Run ID: `MFP-IF-COS-20260729-01`

Data: 2026-07-29

Controller: CoS Claude Fable 5 + UltraCode; lane delegate GPT-5.6 (Sol/Terra/Luna)

Baseline immutabile: `v0.8.0` (`0cef4f4ae`), branch manager
`codex/WUL-522-intelligence-fabric`

Questo run e' solo post-0.8: non modifica, promuove o pubblica la release 0.8.
Nessun push, PR, merge remoto, tag o mutazione Linear. Dati solo sintetici.

## 1. Riconciliazione packet (G0)

| Packet | Stato trovato | Azione |
| --- | --- | --- |
| WUL-269 locality Ollama | Branch verificato `GO` dal run `MFP-AI-COS-20260728-01` | Consolidato via merge dello stack |
| WUL-418 matrice serving | Idem, impilato su WUL-269 | Consolidato |
| WUL-502 registry locale | Testa dello stack `c1feb7616`, include slice C0a-C0c di ADR 0088 | Merge in branch manager (`1bf13b166`) |
| WUL-499 ADR scaffold | ADR 0086 gia' accettato sulla linea consolidata; branch con audit OpenMinis e sezione resolver non confluite | Audit assorbito (`d9f29545b`); sezione resolver assorbita in ADR 0089, non retro-innestata nell'ADR 0086 accettato |

Linear non era raggiungibile da questa sessione (nessun connettore attivo):
la deduplica usa il run record precedente e i branch locali come fonte. Nessuna
issue nuova e' necessaria.

## 2. Verifica del consolidamento (Wave 0)

Eseguita realmente su `d9f29545b` + toolchain Node 24.18.0:

| Prova | Esito |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (exit 0) |
| `npm run check:claims` | PASS (481 file, 0 claim ad alto rischio) |
| `npm run check:never-regress` | PASS |
| Test mirati AI (`lib/ai-providers/*`, egress, contracts) | 113/113 PASS |
| Suite `test:unit` completa | 915/915 PASS (dopo build del binding nativo better-sqlite3) |

Nota di metodo: una prima esecuzione della suite senza `set -o pipefail`
mascherava 69 fallimenti dovuti al binding nativo mancante
(`npm ci --ignore-scripts`). Il binding e' stato compilato e la suite ripetuta:
i 69 fallimenti erano tutti attribuibili alla toolchain, non al merge.

## 3. Architettura implementata (Wave 1)

- ADR 0089 `Accepted`: contratto fabric con routing per capability, venue
  esplicite (`local_process`, `home_base`, `on_device`, `cloud`), profili
  egress versionati (`mediflow.ai.egress-profile.v1`) chiusi per costruzione,
  policy di esecuzione immutabile, ricevute che non autorizzano consumer,
  classi di credenziale dichiarative e provenienza obbligatoria.
- Contratto congelato: `lib/ai-providers/fabric/contract.ts` (commit
  `81aa62297`), 5 capability generative + 11 deterministiche.
- Il finding A3 resta `observed_not_causal`; qualified readiness resta `HOLD`
  (ADR 0088 invariato).

## 4. DAG del programma

| Wave | Contenuto | Lane | Stato |
| --- | --- | --- | --- |
| W0 | Consolidamento stack 269/418/502 + audit WUL-499 + verifica | manager | DONE |
| W1 | ADR 0089 + contratto congelato | manager (Fable) | DONE |
| W2a | F1 resolver + catalogo generativo | Sol high, worktree `mediflow-if-f1-wt` | DONE (integrata in `e3ccf2514`) |
| W2a | F2 catalogo deterministico | Terra high, worktree `mediflow-if-f2-wt` | DONE (integrata via ff a `175b565cf`) |
| W2b | F3 catalogo unificato + route stato `/api/ai/fabric/status` | Terra high, worktree `mediflow-if-f3-wt` | DONE (integrata via ff a `76225116c`) |
| W3 | Docs di programma + battery completa su branch manager | manager | IN CORSO |
| W4 | Verifica terminale indipendente | Sol xhigh, contesto fresco | TODO |

## 5. Ledger lane

| Lane | Modello/effort | Esito | Note |
| --- | --- | --- | --- |
| R1 inventario deterministico | Luna low, read-only | OK | 11 capability reali; registro attese ADR 0082 ASSENTE come runtime |
| R2 inventario superfici | Luna low, read-only | OK | Auth: `requireSession`/`requireSessionOrLocalToken`; client paired senza adapter provider |
| F1 resolver | Sol high | OK dopo sblocco | Implementazione completa e prove verdi (7/7, typecheck, lint, riverificate dal controller); la lane si e' fermata senza commit per un glob errato nella spec di prova del controller e ha rifiutato correttamente di modificare un quinto file; commit eseguito dal controller |
| F2 catalogo deterministico | Terra high | OK | 5/5 test riverificati dal controller; deviazione dichiarata e accettata: entryPoint AIFA corretto a `lib/aifa-catalog.ts` dove vive lo schema letterale |
| F3 catalogo unificato + stato | Terra high | OK | 17/17 test fabric riverificati dal controller; route sottile su `requireSessionOrLocalToken` come `/api/ai/models`; snapshot con allowlist congelata senza endpoint o impostazioni; edge dichiarato: nessun test HTTP di integrazione della route |

## 6. Decision audit (aggiornato in corso d'opera)

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Consolidare lo stack 269/418/502 via merge (non rebase) preservando gli SHA verificati | Accettata | Un conflitto risolto che cambi semantica verificata |
| Risolvere il conflitto STATE_OF_THE_SYSTEM combinando "contratto accettato" + "fabric in costruzione" | Accettata | Un claim di funzione completa nella 0.8 |
| Assorbire la sezione resolver WUL-499 in ADR 0089 invece di modificare l'ADR 0086 accettato | Accettata | Contenuto normativo perso rispetto alla versione WUL-499 |
| Non registrare il registro attese ADR 0082 come capability (runtime assente) | Accettata | Una tabella `expectations` reale nel tree |
| dataClass 'clinical' conservativa per tutte le capability correnti | Accettata | Una capability che tratti solo metadati modello |
| Route stato fabric su `requireSessionOrLocalToken` come `/api/ai/models` | Accettata | Un consumer paired che richieda il data plane `network` |
| Nessuna modifica ai client nativi in questo programma | Accettata | Un requisito di parity che imponga adozione Swift immediata |
| Meter Fable non esposto in sessione | Registrata `CAPACITY_UNKNOWN` solo per eventuali lane Fable aggiuntive; nessuna avviata | |

## 7. Rischi residui e ledger errori

| Evento | Contenimento |
| --- | --- |
| Pipeline senza `pipefail` ha mascherato 69 fallimenti | Ripetuto con `set -o pipefail`; regola di metodo registrata |
| Binding nativo assente nei worktree lane | Le prove lane usano test puri senza db; la battery completa gira sul branch manager |
| Glob `fabric/*.test.ts` nella spec F1 non supportato dal runner (espande solo `/**/`) | Errore di spec del controller; la lane si e' fermata invece di deviare; forma corretta `fabric/**/*.test.ts` propagata alle spec successive |
| Il resolver accetta il descriptor dal chiamante | Nessun descriptor artigianale puo' aprire egress o cloud (test avversariale dedicato); la fonte canonica dei descriptor diventa il catalogo unificato in W2b; una ricevuta non autorizza consumer per contratto |
| `never-regress` NR-EGRESS su fixture negativa `https://example.test` in `resolver.test.ts` | Trovato dalla battery W3; fixture ricostruita a pezzi con `join('')` come il pattern di `registry.test.ts`; guard e test fabric riverificati verdi |

## 8. Next permitted action

Aggiornato a fine run.
