---
summary: "Matrice canonica 0.8.5 dei task intelligenti, dei provider locali, delle runtime e dei gate necessari prima di una promozione."
read_when:
  - "Si valuta un modello o provider per un task MediFlow."
  - "Serve distinguere fitting, benchmark, shadow e serving clinico."
  - "Si modifica registry, fallback, kill switch o readiness AI."
---

# Matrice task × modello × runtime

Stato al 1 settembre 2026. Issue di riferimento: `WUL-418`.

Questo documento descrive il candidato sorgente locale 0.8.5. Non prova una
release, un tag, un deploy o una verifica CI remota.

## 1. Regola principale

Un modello che si carica è **fitting**. Un nuovo modello o provider è
promuovibile in **serving** solo quando supera i gate del task reale.

Lo stato operativo corrente e la readiness WUL-418 sono due dimensioni
distinte. `runtime` descrive un call path già presente sotto i boundary
esistenti. Non prova da solo che la lane sia stata ricertificata contro tutti i
gate nuovi di questo documento.

Nessun task eredita provider, lifecycle, credenziali, consenso, fallback o
grant di un altro task. Nessuna riga autorizza egress o scrittura clinica
automatica.

### Limite della readiness locale

ADR 0092 definisce l'annotazione `available_unqualified` per i percorsi Ollama
correnti. L'annotazione riguarda readiness ed evidenza.

L'annotazione non è uno stato operativo. Non sostituisce `runtime` e non
modifica la tabella degli stati ammessi.

Ollama 0.32.x espone il digest in `/api/tags` e `/api/ps`, non nella risposta
di inferenza. Il controllo pre/post rileva alcuni cambi, ma non impedisce lo
swap ABA `X → Y → X`.

Un nuovo packet può proporre `digest_bracketed_best_effort`. A3 resta
`observed_not_causal` e la qualified readiness resta `HOLD`.

Nessuna receipt, tipo, località o identità del provider autorizza un consumer.
[ADR 0092](./adr/0092-limite-digest-bound-readiness-ai-locale.md) documenta la
decisione e il limite tecnico.

Un endpoint loopback non dimostra `egress=none`. Un gate local-only futuro deve
verificare modello locale, cloud disabilitato, strumenti, rete e processo.

Lo stato mobile corrente non è un vincolo permanente. Capability Apple
on-device e delega AI home-base richiedono un ADR separato.

### Rapporto con il contratto Intelligence Fabric

[ADR 0089](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md)
definisce capability, venue esplicite, profili egress versionati e ricevute di
risoluzione. Questa matrice resta l'autorita sugli stati di serving dei
modelli: una capability registrata nella fabric non promuove alcuna lane, non
cambia gli stati ammessi e non sostituisce i gate di questo documento.

[ADR 0090](./adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md)
definisce trust, onboarding, routing osservabile e review. [ADR
0094](./adr/0094-intelligence-fabric-headless-contract-085.md) fissa i quattro
smart path generativi. Nel Fabric generativo `ocr` resta `unavailable`; la
composizione documentale separata continua le pagine PDF `needsOcr` con Apple
Vision locale sul Mac. DeepSeek-OCR 2/CUDA conserva soltanto contratto e seam
sintetiche con stato `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.

Nel candidato sorgente locale 0.8.5, Patient Insight, Smart Import, Document
Synthesis e Treatment Reasoning attraversano il Fabric end-to-end. Ogni
production root host-owned risolve provider, modello, endpoint, venue, prompt e
fallback. Il caller non può fornire o sovrascrivere questi valori e non può
richiedere apply. Ogni preview espone receipt, provenienza e currentness.

Quando configurati, Ollama serve le prime tre capability e ATHENA su MLX serve
soltanto Treatment Reasoning. I lifecycle sono separati e non contengono
segreti. I provider cloud restano disabilitati. Lo stato paired resta
`status_only` e non concede invocazione AI ai client mobili.

La lane ATHENA è inclusa soltanto con runner e modello locali configurati.
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN` può indicare un eseguibile assoluto
`mlx_lm.generate`, senza argomenti o shell. Il launcher `uvx` predefinito resta
offline e fallisce chiuso senza cache pre-provisioned. Nessuno dei due percorsi
dimostra readiness universale o promuove il runtime MLX generico.

Il modello provider v2 separa provider type, istanza, autenticazione, modello,
capability, gruppi, binding e function allowlist. Distingue inoltre
`local_model`, `api_key`, `provider_oauth` ufficiale e `host_subscription`.
OpenAI e Anthropic hanno adapter HTTPS ufficiali e una probe Document Synthesis
review-only, ma restano `default OFF`. I test usano transport fake: il tree non
contiene credenziali, prove di rete live o readiness cloud. Login consumer e
subscription non autorizzano inferenza.

La modalità provider-in-MediFlow descrive le righe runtime di questa matrice.
La modalità MediFlow-in-intelligent-host usa il Supervisor locale e MCP `stdio`
sopra Application Services governati. Mini condivide catalogo e foundation CLI
ma non ha un callsite production del Supervisor e fallisce chiuso senza parent
AIP. La 0.8.5 non prova installer, onboarding, compatibilità con host MCP
esterni o runtime Headless generale.

## 2. Stati ammessi

| Stato | Significato | Uso consentito |
| --- | --- | --- |
| `runtime` | Call path applicativo presente sotto i boundary esistenti | Output assistivo review-first; nessuna nuova promozione senza ricertificazione |
| `shadow` | Esecuzione separata dal risultato clinico operativo | Confronto con dati sintetici o redatti |
| `benchmark_only` | Harness o prova tecnica senza consumer clinico | Misura ripetibile |
| `hold` | Capability proposta, incompleta o non attestata | Nessuna invocazione clinica |
| `unavailable` | Capability classificata ma priva di runtime corrente | Nessuna invocazione finché un nuovo gate non produce contratto ed evidenza |

Una UI, un ADR, un modello installato o un test isolato non cambiano lo stato.

## 3. Matrice corrente

`revalidation_required` significa che il call path può restare review-first, ma
nessun cambio di modello, provider o claim è promuovibile prima di una nuova
verifica completa.

| Task | Binding host-owned | Runtime | Stato | Disposition | Scope 0.8.5 | Readiness WUL-418 | Fallback | Limite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `patient_insight` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessuna verità o write clinica automatica |
| `smart_import` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessun import silenzioso; apply resta separato |
| `document_synthesis` | `reasoning` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | La sintesi non diventa un fatto clinico |
| `treatment_reasoning` | ATHENA-R1-Qwen3-8B | processo MLX-LM locale su Apple Silicon | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessuna prescrizione, terapia o modifica automatica |
| `ocr` Fabric | Nessuno | Nessuna | `unavailable` | `unavailable` | `INCLUDED` come denial fail-closed/`410` autenticato | non applicabile | Nessuno attivo | Nessuna invocazione generativa nel runtime corrente |
| Estrazione allegati | AnyDoc + Apple Vision su macOS | processi locali bounded | `runtime` deterministico | review-only | `INCLUDED` | non applicabile | Nessuno invisibile | Apple Vision riceve solo pagine PDF `needsOcr`; input non supportati falliscono chiusi |
| DeepSeek-OCR 2 selettivo | Nessun binding | seam sintetiche | `hold` | `synthetic_contract_only` | `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING` | `not_verified` | Nessuno | Nessun adapter runtime, E2E, benchmark italiano o soglia qualificata |
| Redaction PII neurale | OpenMed / challenger NER | sidecar locale | `benchmark_only` | non client-facing | `INCLUDED` benchmark-only | `blocked` | Layer deterministico obbligatorio | Non abilita egress |
| Apple Foundation Models | Nessun binding | Nessuna | `hold` | nessuna | `RELEASE_SCOPE_EXCLUDED` | `blocked` | Nessuno | Richiede decisione e gate per task |
| MLX generico | Nessun binding applicativo | runtime MLX amministrativo/diagnostico | `benchmark_only` | non client-facing | `INCLUDED` benchmark-only | `blocked` | Nessuno | Non è la lane ATHENA e non sostituisce Ollama |
| OpenAI / Anthropic | Profili provider v2 host-owned | adapter HTTPS ufficiali | `hold` | `probe_only / default_off` | `INCLUDED` | `not_verified` | Nessuno | Probe review-only con transport fake; nessuna credenziale, rete live o readiness cloud |

### Lettura della matrice

- `runtime` indica un percorso review-first osservato, non autonomia clinica né
  ricertificazione WUL-418 completa.
- La capability Fabric `ocr` non ha un entrypoint eseguibile. La composizione
  AnyDoc separata usa Apple Vision sul Mac solo per pagine PDF `needsOcr`.
- DeepSeek-OCR 2 resta contrattuale e test-only; non è un fallback del percorso
  Apple Vision e non blocca la 0.8.5.
- Il percorso ATHENA MLX è una lane governata separata. Non eredita il registry
  o il lifecycle Ollama.
- Il runtime MLX generico resta benchmark-only e non dimostra readiness ATHENA.
- `benchmark_only` e `hold` non sono opzioni selezionabili dal prodotto.
- iPhone e iPad non invocano direttamente questi provider. I client paired
  restano non-AI e non accedono a SQLite o al filesystem host.

## 4. Capability richieste per task

| Task | Capability minima | Evidenza richiesta |
| --- | --- | --- |
| `patient_insight` | output JSON e contesto sufficiente | Envelope valido e benchmark lane-specific |
| `smart_import` | output JSON strutturato | Envelope valido, source evidence e review |
| `document_synthesis` | output JSON e contesto documentale | Envelope valido, retention del contesto e source boundary |
| `treatment_reasoning` | JSON, source refs e contesto bounded | Contratto, source-ref validation e benchmark dedicato |
| `ocr` Fabric corrente | Nessuna: capability non eseguibile | Catalogo senza entrypoint operativo e route autenticate in `410` |
| Estrazione allegati | Conversione locale deterministica e riconoscimento selettivo sul Mac | Guard AnyDoc local-only, limiti bounded, classificazione `needsOcr`, Apple Vision e ricomposizione source-bound |
| DeepSeek-OCR 2 futuro | Vision locale per singola pagina | Adapter, E2E, benchmark sintetico italiano, soglie predefinite, provenance/hash/quality, ricomposizione e prova di località |
| Redaction | rilevazione PII con leak proibiti a zero | Corpus governato e report ripetibile |

Il manifest del provider descrive solo la capability di trasporto. La capability
del modello deve essere attestata a runtime o da un artefatto firmato e
verificabile. Il nome del modello non è una prova.

## 5. Serving gate minimo

Ogni promozione deve produrre un packet con i gate seguenti.

| Gate | Evidenza minima | Stop rule |
| --- | --- | --- |
| Autorità | Issue e ADR quando cambia un boundary | Nessuna autorità o scope ambiguo |
| Dati | Corpus sintetico, pubblico o redatto | PHI/PII reale nel test o nell'artefatto |
| Località | Endpoint, provider, modello e digest attestati | Endpoint non autorizzato o marker remoto |
| Capability | Capability richiesta dal task verificata | Capability dedotta dal nome |
| Qualità | Metrica e soglia lane-specific dichiarate prima del run | Soglia assente o modificata dopo il risultato |
| Prestazioni | TTFT, latenza totale, throughput e picco memoria | Budget host non dichiarato o pressione non controllata |
| Contesto | Retention e stabilità sul contesto massimo dichiarato | Perdita di istruzioni o source refs |
| Repeatability | Corpus, seed/config e run ripetibili | Esito non riproducibile |
| Failure mode | Timeout, abort, provider down e output invalido testati | Fallback implicito o errore con dati sensibili |
| Kill switch | Blocco fail-closed nel call path reale | Kill switch solo UI |
| Fallback | Ordine, trigger e authority plane espliciti | Cambio provider o modello silenzioso |
| Provenance | Receipt senza prompt, credenziali o dati clinici | Receipt mutabile o PHI-bearing |
| Review | Output bozza con conferma umana | Auto-write o claim di verità clinica |
| Superfici | Claim separato per localhost, macOS, iPhone e iPad | Parity dedotta da un solo host |

Non esiste una soglia numerica universale per qualità, latenza o memoria. Ogni
lane deve fissare il proprio budget prima del benchmark. Per la redaction il
vincolo `forbiddenLeakRate = 0` resta non negoziabile.

## 6. Transizioni

```text
hold → benchmark_only → shadow → runtime
```

Una transizione richiede:

1. evidenza del livello corrente;
2. falsificatori eseguiti;
3. review indipendente;
4. rollback o fallback dichiarato;
5. aggiornamento di questa matrice;
6. nuova autorità se cambia egress, retention, schema o autonomia.

Una regressione di località, qualità, privacy o kill switch riporta la lane a
`hold`. Non esiste promozione automatica.

## 7. Mappa delle prove

| Area | Fonte |
| --- | --- |
| Registry locale | `lib/ai-providers/registry.ts` |
| Locality Ollama | `lib/ai-providers/ollama-locality.ts` |
| Limite digest-bound | `docs/adr/0092-limite-digest-bound-readiness-ai-locale.md` |
| Crosswalk runtime 0.8.5 | `docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json` |
| Patient Insight | `app/api/ai/patient-insight/preview/route.ts`, `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` |
| Smart Import | `app/api/ai/smart-import/preview/route.ts`, `lib/security/server-session-authenticated-smart-import-preview-production.ts` |
| Sintesi documentale | `app/api/ai/document-synthesis/preview/route.ts`, `lib/ai-providers/fabric/document-synthesis-production-operation.ts` |
| Treatment Reasoning | `app/api/ai/treatment-reasoning/preview/route.ts`, `lib/ai-providers/fabric/treatment-reasoning-production-root.ts` |
| Lifecycle Ollama e ATHENA | `lib/ai-providers/fabric/provider-lifecycle-service.ts`, `lib/ai-providers/fabric/provider-lifecycle-store.ts` |
| OCR Fabric non eseguibile | `lib/ai-providers/fabric/generative-catalog.ts`, `lib/ocr-production-retirement.test.ts` |
| AnyDoc + Apple Vision local-only | `lib/domain/documents/anydoc-local-extraction-runner.ts`, `lib/domain/documents/anydoc-apple-vision-ocr-composition.ts`, `scripts/check-anydoc-local-only.mjs` |
| Provider v2 OpenAI/Anthropic | `lib/ai-providers/v2/openai-responses-official-transport.ts`, `lib/ai-providers/v2/anthropic-messages-official-transport.ts`, `lib/ai-providers/v2/document-synthesis-cloud-probe-composition.ts` |
| OpenMed e redaction | `docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md`, `scripts/benchmark-openmed-redaction.mjs` |
| Challenger MLX | `docs/mlx-operational-parity.md` |
| Apple Foundation Models | WUL-417 e ricerca negativa nel tree corrente |
| Client Apple paired non-AI | `docs/parity-matrix.md`, `docs/apple-parity-matrix.json` |
| Provider ed egress | `docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md` |
| Scaffold post-0.8 | `docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md` |
| Fabric 0.8.5 | `docs/adr/0094-intelligence-fabric-headless-contract-085.md`, `lib/ai-providers/fabric/generative-catalog.ts` |
| Receipt, provenienza e UI | `docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json` |
| Stato paired `status_only` | `lib/network-ai-runtime-model.ts`, `native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift` |
| Run record | `docs/analysis/2026-07-29-intelligence-fabric-run.md` |

## 8. Decisioni aperte

- definire una prova causale adeguata prima di riesaminare la qualified
  readiness in stato `HOLD`;
- fissare benchmark e budget lane-specific aggiornati;
- definire benchmark sintetico italiano e soglie prima di valutare un adapter
  DeepSeek-OCR 2, mantenendo AnyDoc come primo passaggio e ogni dato nel
  processo locale;
- verificare Apple Foundation Models in WUL-417 senza promozione implicita;
- qualificare separatamente credenziali, rete, account policy e retention prima
  di abilitare un provider esterno;
- ricertificare separatamente ogni modello o provider prima di cambiare il
  binding host-owned;
- mantenere il runtime MLX generico in `benchmark_only` senza usarlo come prova
  della lane ATHENA.

Decisioni gia chiuse sulla linea post-0.8: le slice C0a-C0c di ADR 0092 sono
state eseguite (WUL-502) e il contratto Intelligence Fabric e' definito in
[ADR 0089](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md).
ADR 0090 e ADR 0091 chiudono il confine del candidato locale: paired solo
status, fallback negato, nessun egress e nessuna scrittura clinica autonoma.
ADR 0094 e il crosswalk 0.8.5 collegano i quattro smart path ai production root
host-owned. ADR 0107 rende AnyDoc il primo passaggio documentale; il candidato
continua le sole pagine PDF `needsOcr` con Apple Vision sul Mac. La capability
Fabric `ocr` resta non eseguibile. DeepSeek-OCR 2/CUDA è
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`: una direzione futura non modifica lo
stato senza adapter, E2E, benchmark, soglie, ricomposizione e confini di egress
verificati.

Queste decisioni non bloccano l'uso locale review-first già osservato come
`runtime` sotto i boundary esistenti. Bloccano la ricertificazione WUL-418,
nuovi modelli, nuovi provider e claim di parity.
