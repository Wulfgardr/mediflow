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
| W3 | Docs di programma + battery completa su branch manager | manager | DONE |
| W4 | Verifica terminale indipendente | Sol xhigh/high, 5 passaggi a contesto fresco | DONE: `GO` al quinto passaggio su `4f17232b8` |

## 5. Ledger lane

| Lane | Modello/effort | Esito | Note |
| --- | --- | --- | --- |
| R1 inventario deterministico | Luna low, read-only | OK | 11 capability reali; registro attese ADR 0082 ASSENTE come runtime |
| R2 inventario superfici | Luna low, read-only | OK | Auth: `requireSession`/`requireSessionOrLocalToken`; client paired senza adapter provider |
| F1 resolver | Sol high | OK dopo sblocco | Implementazione completa e prove verdi (7/7, typecheck, lint, riverificate dal controller); la lane si e' fermata senza commit per un glob errato nella spec di prova del controller e ha rifiutato correttamente di modificare un quinto file; commit eseguito dal controller |
| F2 catalogo deterministico | Terra high | OK | 5/5 test riverificati dal controller; deviazione dichiarata e accettata: entryPoint AIFA corretto a `lib/aifa-catalog.ts` dove vive lo schema letterale |
| F3 catalogo unificato + stato | Terra high | OK | 17/17 test fabric riverificati dal controller; route sottile su `requireSessionOrLocalToken` come `/api/ai/models`; snapshot con allowlist congelata senza endpoint o impostazioni; edge dichiarato: nessun test HTTP di integrazione della route |
| W4 verifica terminale | Sol xhigh, contesto fresco | HOLD_FIX al primo passaggio | Battery tutta verde (932/932); falsificatori contrattuali reali: descriptor fabbricato accettato (P1), ricevuta `treatment_reasoning` con provider discordante da `athena_mlx` (P1), etichette provenance non validate (P2), overclaim docs conseguente (P2), matrice con decisioni gia' chiuse (P3) |
| W4 secondo passaggio | Sol xhigh, contesto fresco | HOLD_FIX | P1 confermati chiusi dai falsificatori; residui: policy non validata integralmente a runtime (P2: `retention`/`consentRef`/`allowedVenues`), pattern snake_case aggirabile con semantica clinica (P2: `diagnosi_diabete_tipo_2`), riga rischi stale (P3), eccezione ATHENA non documentata in ADR (P3) |
| W4 terzo passaggio | Sol high, contesto fresco, focalizzato | HOLD_FIX | Correzioni A-D confermate chiuse dai falsificatori; battery verde (935/935); nuovi P2 dalla caccia avversariale: vocabolario `as const` non congelato a runtime (mutabile prima del load del resolver) e array sparso che aggira `every()` su `allowedVenues` |
| W4 quarto passaggio | Sol high, contesto fresco, focalizzato | HOLD_FIX | Congelamento e fix sparse-array confermati chiusi; battery verde (936/936); nuovi P2 classe TOCTOU: `includes` ridefinito dal chiamante amplia le venue; doppia iterazione della provenance permette a un iteratore stateful di cambiare valori tra check e uso |
| W4 quinto passaggio | Sol high, contesto fresco, terminale | GO | Falsificatori TOCTOU chiusi (snapshot-unico confermato); 21/21 fabric, 936/936 unit, typecheck/claims/never-regress PASS; nessun P1/P2; 3 residui P3 fuori dal threat model dichiarato (getter stateful su `request.venue` e `resolution.receipt`, RegExp esportata non congelata usata solo nei test) |

## 6. Decision audit (aggiornato in corso d'opera)

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Consolidare lo stack 269/418/502 via merge (non rebase) preservando gli SHA verificati | Accettata | Un conflitto risolto che cambi semantica verificata |
| Risolvere il conflitto STATE_OF_THE_SYSTEM combinando "contratto accettato" + "fabric in costruzione" | Accettata | Un claim di funzione completa nella 0.8 |
| Assorbire la sezione resolver WUL-499 in ADR 0089 invece di modificare l'ADR 0086 accettato | Accettata | Contenuto normativo perso rispetto alla versione WUL-499 |
| Non registrare il registro attese ADR 0082 come capability (runtime assente) | Accettata | Una tabella `expectations` reale nel tree |
| dataClass 'clinical' conservativa per tutte le capability correnti | Accettata | Una capability che tratti solo metadati modello |
| Route stato fabric su `requireSessionOrLocalToken` come `/api/ai/models` | Accettata | Un consumer paired che richieda il data plane `network` |
| Mappare `treatment_reasoning` sul registry Ollama task `reasoning` | Corretta dopo W4: la lane reale e' ATHENA MLX; ora capability autogestita con provider `athena_mlx` in ricevuta, senza binding registry | Un call-site che risolva treatment reasoning via registry |
| Resolver che si fida del descriptor passato dal chiamante | Corretta dopo W4: enforcement di identita' canonica contro il catalogo unificato; un clone a valori identici viene respinto | Un descriptor non canonico che produca una ricevuta |
| Etichette provenance come stringhe libere | Corretta due volte: prima pattern snake_case (aggirabile con semantica clinica), poi vocabolario CHIUSO `FABRIC_PREPROCESSING_LABELS` nel contratto; ogni etichetta fuori vocabolario respinta | Un'etichetta fuori vocabolario che entri in un record |
| Validazione policy delegata ai tipi TypeScript | Corretta dopo il secondo passaggio W4: `retention`, `consentRef` e `allowedVenues` convalidati a runtime (i tipi non sono enforcement) | Un valore runtime fuori contratto che produca una ricevuta |
| Costanti array del contratto solo `as const` | Corretta dopo il terzo passaggio W4: `Object.freeze` su vocabolario, venue e id capability; test che la mutazione lancia `TypeError` | Una costante esportata mutabile che avveleni i `Set` derivati |
| `every()` su array del chiamante | Corretta dopo il terzo passaggio W4: normalizzazione con `Array.from` (i buchi diventano `undefined` e falliscono la validazione) | Un array sparso che produca una ricevuta |
| Metodi e iteratori del chiamante tra check e uso (TOCTOU) | Corretta dopo il quarto passaggio W4: pattern snapshot-unico; validazione e membership/materializzazione usano la STESSA copia reale interna, mai metodi o iteratori dell'oggetto originale | Un oggetto del chiamante che menta tra validazione e uso producendo ricevuta o record difformi |
| Nessuna modifica ai client nativi in questo programma | Accettata | Un requisito di parity che imponga adozione Swift immediata |
| Meter Fable non esposto in sessione | Registrata `CAPACITY_UNKNOWN` solo per eventuali lane Fable aggiuntive; nessuna avviata | |

## 7. Rischi residui e ledger errori

| Evento | Contenimento |
| --- | --- |
| Pipeline senza `pipefail` ha mascherato 69 fallimenti | Ripetuto con `set -o pipefail`; regola di metodo registrata |
| Binding nativo assente nei worktree lane | Le prove lane usano test puri senza db; la battery completa gira sul branch manager |
| Glob `fabric/*.test.ts` nella spec F1 non supportato dal runner (espande solo `/**/`) | Errore di spec del controller; la lane si e' fermata invece di deviare; forma corretta `fabric/**/*.test.ts` propagata alle spec successive |
| Descriptor dal chiamante (rischio del primo passaggio W4) | CHIUSO: il resolver impone l'identita' canonica contro il catalogo unificato; un clone a valori identici viene respinto con `capability_unknown` (test dedicato) |
| `never-regress` NR-EGRESS su fixture negativa `https://example.test` in `resolver.test.ts` | Trovato dalla battery W3; fixture ricostruita a pezzi con `join('')` come il pattern di `registry.test.ts`; guard e test fabric riverificati verdi |

## 8. Fase 2: giunture cliniche e multipiattaforma (2026-07-29)

Aperta dopo il GO del nucleo. Contratto: ADR 0090 (`aac129164`). Nucleo ADR
0089 accettato e non ridisegnato.

| Wave | Contenuto | Lane | Stato |
| --- | --- | --- | --- |
| S0 | Ricognizione R3 (pairing/trust) e R4 (incertezza/review) | 2x Luna high read-only | DONE |
| S1 | ADR 0090: semantica, invarianti, falsificatori, DAG, ownership | manager (Fable) | DONE |
| S2 | P1 trust+revoca, P2 onboarding, P3 routing osservabile, P4 interazione clinica | Sol/Terra/Sol/Sol high, worktree f1-f4 | DONE: tutte integrate (`a8b38d29a`) |
| S3 | Integrazione + docs + battery | manager | IN CORSO |
| S4 | Verifica terminale indipendente | lane fresca | TODO |

Ledger lane fase 2:

| Lane | Esito | Note |
| --- | --- | --- |
| P2 onboarding (Terra high) | OK | 28/28 riverificati dal controller; gate egress reale consultato a `attest_local` e `enable`; nessuna stringa `verified`/`ready`/`qualified` |
| P4 interazione clinica (Sol high) | OK + hardening | 29/29 riverificati; gap auto-dichiarato (ref provenienza vuoto) chiuso dal controller in `f814a3204` insieme all'attore fuori vocabolario; deroga LOC dichiarata e accettata |
| P3 routing osservabile (Sol high) | OK | 29/29 riverificati; sonda solo su base loopback validata con `redirect: 'error'` e timeout 1500ms; deroga LOC dichiarata e accettata |
| P1 trust+revoca (Sol high) | OK con deviazione fattuale accettata | 30/30 riverificati; il gate di modalita si applica anche alla discovery (verificato dal controller su `network-discovery-auth.ts:52`); ADR 0090 corretto di conseguenza; revoca host-side con prova negativa post-revoca |

Decisioni di fase (aggiunte):

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Accettare la deviazione discovery/mode-gate della lane P1 e correggere l'ADR invece del codice | Accettata | Un sorgente che mostri la discovery servita in modalita `local-only` |
| Ref di provenienza: stringa vuota respinta a creazione e accettazione | Corretta (hardening controller) | Un accept con ref di soli spazi |
| Persistenza revoca via upsert locale alla route (helper di salvataggio privato, fuori ownership) | Accettata come workaround bounded | Una seconda via di scrittura dello stato pairing che diverga |

Fatti chiave dalla ricognizione (dettaglio in ADR 0090): revoca host-side
assente nel runtime attuale; 401 indistinto tra non autenticato e revocato;
reset admin non elimina lo stato pairing; tabella ADR 0087 presente senza
vocabolario di stati; confidence degradata a `low` non distinguibile da
dichiarata; `[LOCKED DATA]` web e `lockedFields` nativo distinguono
l'illeggibile dal vuoto ma alcune vie secondarie degradano in silenzio.

## 9. Verdetto terminale e promotion packet (fase nucleo)

Verdetto del programma: `LOCAL_IMPLEMENTATION_READY / HOLD_PROMOTION`.

HEAD verificata dalla lane terminale: `4f17232b8` (il commit di closeout
documentale successivo non tocca codice). Branch manager:
`codex/WUL-522-intelligence-fabric`.

### Contenuto consegnato

- Stack provider post-0.8 consolidato (WUL-269/418/502) sulla baseline `v0.8.0`.
- ADR 0089 accettato e scaffold Intelligence Fabric completo:
  `lib/ai-providers/fabric/` (contratto, cataloghi generativo e
  deterministico, catalogo unificato, resolver fail-closed, stato) piu la
  route read-only `/api/ai/fabric/status`.
- Audit OpenMinis assorbito; matrice serving, stato di sistema, roadmap,
  changelog e indice allineati senza overclaim.

### Rischi residui dichiarati

- 3 P3 fuori dal threat model dichiarato (codice ostile same-process):
  getter stateful su `request.venue` e su `resolution.receipt`; RegExp
  esportata non congelata usata solo nei test.
- Nessun test HTTP end-to-end della route di stato (auth verificata sul
  call path sorgente; snapshot puro testato).
- Adozione nativa Apple dello stato fabric non eseguita (nessun file
  `native/` toccato, per ownership delle lane UI attive).
- Registro attese persistente di ADR 0082 assente come runtime (fatto
  preesistente, non regressione).
- A3 resta `observed_not_causal`; qualified readiness `HOLD`.

### Next permitted action

Una sola azione permessa: push della branch
`codex/WUL-522-intelligence-fabric` e apertura PR verso `main` su
`Wulfgardr/mediflow` (autorita di Leonardo; questo run non esegue azioni
remote). Dopo la promozione: pulizia dei worktree lane
(`mediflow-if-f1-wt`, `-f2-wt`, `-f3-wt`, `-verify-wt`) e dei branch lane
gia integrati; i packet successivi del DAG storico restano WUL-466
(profili degradati OCR) e l'esposizione dello stato fabric sul data plane
`network` per i client paired.
