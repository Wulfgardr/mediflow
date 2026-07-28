---
summary: "Matrice canonica post-0.8 dei task AI, dei modelli locali, delle runtime e dei gate necessari prima della promozione."
read_when:
  - "Si valuta un modello o provider per un task MediFlow."
  - "Serve distinguere fitting, benchmark, shadow e serving clinico."
  - "Si modifica registry, fallback, kill switch o readiness AI."
---

# Matrice task × modello × runtime

Stato al 28 luglio 2026. Issue di riferimento: `WUL-418`.

Questo documento governa il pacchetto post-0.8. Non modifica né promuove la
candidata 0.8.

## 1. Regola principale

Un modello che si carica è **fitting**. Un nuovo modello o provider è
promuovibile in **serving** solo quando supera i gate del task reale.

Lo stato operativo corrente e la readiness WUL-418 sono due dimensioni
distinte. `runtime` descrive un call path già presente sotto i boundary
esistenti. Non prova da solo che la lane sia stata ricertificata contro tutti i
gate nuovi di questo documento.

Nessun task eredita provider, credenziali, consenso, fallback o grant di un
altro task. Nessuna riga autorizza egress o scrittura clinica automatica.

## 2. Stati ammessi

| Stato | Significato | Uso consentito |
| --- | --- | --- |
| `runtime` | Call path applicativo presente sotto i boundary esistenti | Output assistivo review-first; nessuna nuova promozione senza ricertificazione |
| `shadow` | Esecuzione separata dal risultato clinico operativo | Confronto con dati sintetici o redatti |
| `benchmark_only` | Harness o prova tecnica senza consumer clinico | Misura ripetibile |
| `hold` | Capability proposta, incompleta o non attestata | Nessuna invocazione clinica |

Una UI, un ADR, un modello installato o un test isolato non cambiano lo stato.

## 3. Matrice corrente

`revalidation_required` significa che il call path esistente può restare
review-first, ma nessun cambio di modello, provider o claim è promuovibile prima
di una nuova verifica completa.

| Task | Binding corrente | Runtime | Stato | Readiness WUL-418 | Fallback | Gate e prova presenti | Limite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `patient_insight` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `revalidation_required` | Nessuno automatico | Kill switch, contratto JSON, locality gate, review esplicita | Nessuna verità o write clinica automatica |
| `smart_import` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `revalidation_required` | Nessuno automatico | Kill switch, envelope tipizzato, review prima dell'applicazione | Nessun import silenzioso |
| `document_synthesis` | `reasoning` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `revalidation_required` | Nessuno automatico | Kill switch, normalizzazione input, envelope e source boundary | La sintesi non diventa un fatto clinico |
| OCR documentale | `ocr` → Ollama → `deepseek-ocr` | HTTP loopback | `runtime` | `revalidation_required` | Apple Vision solo su host macOS e solo dopo output low-signal | Kill switch server-side, endpoint locale, fallback dichiarato | Nessuna parity del fallback su Windows/Linux |
| `treatment_reasoning` | ATHENA-R1-Qwen3-8B | MLX-LM locale su Apple Silicon | `runtime` review-only | `revalidation_required` | Nessuno automatico | Kill switch, route autenticata, schema, source-ref validation, smoke redatto | Nessuna prescrizione o terapia automatica |
| Redaction PII neurale | OpenMed / challenger NER | Sidecar locale | `benchmark_only` | `blocked` | Layer deterministico resta obbligatorio | Benchmark esistente; leak proibiti non chiusi | Non abilita egress |
| Apple Foundation Models | Nessun binding | On-device Apple | `hold` | `blocked` | Nessuno | Nessuna implementazione nel tree corrente | Richiede spike WUL-417 e gate per task |
| Challenger MLX generici | Nessun binding operativo | MLX locale | `benchmark_only` | `blocked` | Nessuno | Diagnostica benchmark-visible | Non sostituiscono Ollama |
| Comparator cloud | Nessun binding | Remoto | `hold` | `blocked` | Nessuno | Egress chiuso | Vietato prima di deidentificazione, consenso e retention |

### Lettura della matrice

- `runtime` indica un percorso review-first osservato, non autonomia clinica né
  ricertificazione WUL-418 completa.
- Il fallback Apple Vision appartiene solo all'OCR e non diventa fallback di
  Patient Insight, Smart Import o sintesi.
- Il percorso ATHENA MLX è una lane separata. Non eredita il registry Ollama.
- `benchmark_only` e `hold` non sono opzioni selezionabili dal prodotto.
- iPhone e iPad non invocano direttamente questi provider. I client paired
  restano non-AI e non accedono a SQLite o al filesystem host.

## 4. Capability richieste per task

| Task | Capability minima | Evidenza richiesta |
| --- | --- | --- |
| `patient_insight` | output JSON e contesto sufficiente | Envelope valido e benchmark lane-specific |
| `smart_import` | output JSON strutturato | Envelope valido, source evidence e review |
| `document_synthesis` | output JSON e contesto documentale | Envelope valido, retention del contesto e source boundary |
| OCR | vision e output strutturato | Capability attestata dal modello e corpus OCR sintetico/pubblico |
| `treatment_reasoning` | JSON, source refs e contesto bounded | Contratto, source-ref validation e benchmark dedicato |
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
| Binding task | `lib/ai-service.ts` |
| Patient Insight | `lib/ai-summary-service.ts` |
| Smart Import | `lib/domain/documents/patient-smart-import-service.ts` |
| Sintesi documentale | `lib/domain/documents/document-synthesis-service.ts` |
| OCR | `lib/domain/documents/ocr-service.ts`, `app/api/ocr/extract/route.ts` |
| ATHENA MLX | `docs/treatment-reasoning-athena-integration.md` |
| OpenMed e redaction | `docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md`, `scripts/benchmark-openmed-redaction.mjs` |
| Challenger MLX | `docs/mlx-operational-parity.md` |
| Apple Foundation Models | WUL-417 e ricerca negativa nel tree corrente |
| Client Apple paired non-AI | `docs/parity-matrix.md`, `docs/apple-parity-matrix.json` |
| Provider ed egress | `docs/adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md` |
| Scaffold post-0.8 | `docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md` |
| Run record | `docs/analysis/2026-07-28-provider-program-post-0.8-run.md` |

## 8. Decisioni aperte

- definire l'attestazione delle capability specifiche del modello;
- fissare benchmark e budget lane-specific aggiornati;
- decidere il profilo degradato OCR multipiattaforma in WUL-466;
- verificare Apple Foundation Models in WUL-417 senza promozione implicita;
- mantenere i provider remoti in `hold` fino ai gate egress completi.

Queste decisioni non bloccano l'uso locale review-first già osservato come
`runtime` sotto i boundary esistenti. Bloccano la ricertificazione WUL-418,
nuovi modelli, nuovi provider e claim di parity.
