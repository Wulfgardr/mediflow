---
summary: "Matrice canonica 0.8.5 dei task intelligenti, dei provider locali, delle runtime e dei gate necessari prima di una promozione."
read_when:
  - "Si valuta un modello o provider per un task MediFlow."
  - "Serve distinguere fitting, benchmark, shadow e serving clinico."
  - "Si modifica registry, fallback, kill switch o readiness AI."
---

# Matrice task × modello × runtime

**Fotografia del 1 settembre 2026**, riferita a `WUL-418` e al candidato
sorgente locale 0.8.5. Le classificazioni qui conservate descrivono quel
perimetro: non sono una prova di release, tag, deployment o CI remota.
La pubblicazione sorgente 0.8.6 del 20 settembre 2026 non ricertifica
retroattivamente queste righe e non ne rimuove le condizioni di promozione.

## 1. Regola principale

Un modello che riesce a caricarsi ha superato una prova di compatibilità con
l’ambiente, il **fitting**. Per affidargli un compito nel percorso applicativo,
il **serving**, occorre invece verificare proprio quel compito e le condizioni
in cui verrà eseguito. La modularità serve a scegliere strumenti adeguati per
funzione, non a trasferire a tutti la prova ottenuta da uno solo.

Lo stato operativo e la readiness WUL-418 sono dimensioni diverse. `runtime`
indica un percorso già presente nei confini esistenti; non prova che sia stato
ricertificato contro tutti i controlli di questa matrice. Nessun task eredita
provider, ciclo di vita, credenziali, consenso, fallback o autorizzazioni di
un altro. Nessuna riga autorizza invio di dati o scrittura clinica automatica.

### Limite della readiness locale

Per Ollama, ADR 0092 usa l’annotazione `available_unqualified`: descrive il
limite dell’evidenza, non un nuovo stato operativo. Non sostituisce `runtime`
e non modifica gli stati ammessi.

Nel comportamento documentato di Ollama 0.32.x il digest compare in `/api/tags`
e `/api/ps`, non nella risposta di inferenza. Controllarlo prima e dopo rileva
alcuni cambiamenti, ma non esclude uno scambio ABA `X → Y → X`. Un nuovo
pacchetto di evidenze può quindi proporre `digest_bracketed_best_effort`;
A3 resta `observed_not_causal` e la qualified readiness rimane `HOLD`.

Una ricevuta, il tipo, la località o l’identità del provider non autorizzano
un consumer. [ADR 0092](./adr/0092-limite-digest-bound-readiness-ai-locale.md)
conserva decisione e limite tecnico. Anche un endpoint loopback non dimostra
`egress=none`: un futuro controllo local-only deve verificare modello locale,
cloud disabilitato, strumenti, rete e processo.

Il limite mobile osservato non è un divieto permanente. Funzioni Apple sul
dispositivo o delega AI alla home-base richiedono una decisione separata.

### Rapporto con il contratto Intelligence Fabric

La Fabric organizza l’accesso alle funzioni, ma non decide da sola se un
modello abbia prove sufficienti per servirle.
[ADR 0089](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md)
definisce capability, sedi esplicite di esecuzione, profili di uscita versionati
e ricevute. Questa matrice conserva l’autorità sugli stati di serving:
registrare una capability non promuove alcun percorso e non sostituisce i
controlli qui richiesti.

[ADR 0090](./adr/0090-giunture-fabric-trust-onboarding-routing-interazione.md)
regola fiducia, configurazione iniziale, scelta osservabile del percorso e
revisione; [ADR 0094](./adr/0094-intelligence-fabric-headless-contract-085.md)
individua i quattro percorsi generativi. La capability `ocr` della Fabric
rimane `unavailable`; l’estrazione documentale separata continua soltanto le
pagine PDF `needsOcr` con Apple Vision sul Mac. DeepSeek-OCR 2/CUDA conserva
contratto e punti di raccordo sintetici, nello stato
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.

Nella 0.8.5 Patient Insight, Smart Import, Document Synthesis e Treatment
Reasoning attraversano la Fabric end-to-end. Il production root dell’host
risolve provider, modello, endpoint, sede, prompt e fallback: il chiamante
non può fornirli o sovrascriverli liberamente e non può richiedere applicazione
clinica. Ogni preview espone ricevuta, provenienza e attualità del contesto.
Le successive preferenze ADR0129 introducono soltanto opzioni opache del
catalogo corrente, non una scelta arbitraria né una promozione nella matrice.

Ollama serve i primi tre percorsi quando configurato; ATHENA su MLX soltanto
Treatment Reasoning. I cicli di vita restano separati e non contengono segreti.
I provider esterni sono disabilitati per default. Il perimetro paired della
matrice rimane `status_only`, senza invocazione AI dai client mobili.

ATHENA richiede runner e modello locali configurati.
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN` ammette solo un eseguibile assoluto
`mlx_lm.generate`, senza argomenti o shell. Il launcher `uvx` predefinito resta
offline e si blocca in assenza della cache già preparata. Nessuno dei percorsi
attesta disponibilità universale o promuove MLX generico.

Provider v2 separa tipo, istanza, autenticazione, modello, capability, gruppi,
binding e allowlist delle funzioni; distingue `local_model`, `api_key`,
`provider_oauth` ufficiale e `host_subscription`. Gli adapter HTTPS ufficiali
OpenAI/Anthropic e la prova Document Synthesis da rivedere restano `default OFF`.
Le prove di questo perimetro usano trasporti simulati, non credenziali o rete
live. Login consumer e abbonamento non autorizzano inferenza API. Il canale
ChatGPT successivo mantiene condizioni proprie di consenso, catalogo e
oscuramento dei dati identificativi: non modifica le righe storiche e non porta una nuova attestazione
live consumer sul candidato finale 0.8.6.

Questa matrice descrive soprattutto **provider dentro MediFlow**. Nell’altra
modalità, **MediFlow dentro un host intelligente**, Supervisor e MCP `stdio`
raggiungono Application Services governati. Mini nella 0.8.5 condivideva
catalogo e base CLI, ma non aveva un callsite di produzione del Supervisor e
negava l’operazione senza parent AIP. Il raccordo successivo WUL-696 va letto
nelle proprie evidenze: la 0.8.5 non provava installer, onboarding,
compatibilità con host MCP esterni o un runtime headless generale.

## 2. Stati ammessi

| Stato | Significato | Uso consentito |
| --- | --- | --- |
| `runtime` | Percorso applicativo presente entro i confini esistenti | Risultati assistivi da rivedere; nessuna nuova promozione senza ricertificazione |
| `shadow` | Esecuzione separata dal risultato clinico operativo | Confronto con dati sintetici o redatti |
| `benchmark_only` | Harness o prova tecnica senza consumer clinico | Misura ripetibile |
| `hold` | Funzione proposta, incompleta o non attestata | Nessuna invocazione clinica |
| `unavailable` | Funzione classificata ma senza runtime corrente | Nessuna invocazione finché un nuovo gate non produce contratto ed evidenza |

Un’interfaccia, un ADR, un modello installato o un test isolato non cambiano
lo stato. Occorrono le condizioni previste per la transizione.

## 3. Matrice corrente

«Corrente» in questa tabella si riferisce alla fotografia 0.8.5 del
1 settembre 2026, non a una nuova qualifica del 20 settembre.
`revalidation_required` permette di conservare il percorso esistente da
rivedere, ma impedisce di promuovere un cambio di modello, provider o
un’affermazione più ampia prima di una verifica completa.

| Task | Binding host-owned | Runtime | Stato | Disposition | Scope 0.8.5 | Readiness WUL-418 | Fallback | Limite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `patient_insight` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessun risultato assunto come verità o scrittura clinica automatica |
| `smart_import` | `clinical` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessuna importazione silenziosa; l’applicazione resta separata |
| `document_synthesis` | `reasoning` → Ollama → `qwen3.5:35b-a3b` | HTTP loopback | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | La sintesi non diventa un fatto clinico |
| `treatment_reasoning` | ATHENA-R1-Qwen3-8B | processo MLX-LM locale su Apple Silicon | `runtime` | `proposal_only` | `INCLUDED` | `revalidation_required` | Nessuno | Nessuna prescrizione, terapia o modifica automatica |
| `ocr` Fabric | Nessuno | Nessuna | `unavailable` | `unavailable` | `INCLUDED` come denial fail-closed/`410` autenticato | non applicabile | Nessuno attivo | Nessuna invocazione generativa nel runtime corrente |
| Estrazione allegati | AnyDoc + Apple Vision su macOS | processi locali bounded | `runtime` deterministico | review-only | `INCLUDED` | non applicabile | Nessuno invisibile | Apple Vision riceve solo pagine PDF `needsOcr`; gli input non supportati vengono negati |
| DeepSeek-OCR 2 selettivo | Nessun binding | seam sintetiche | `hold` | `synthetic_contract_only` | `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING` | `not_verified` | Nessuno | Nessun adapter runtime, E2E, benchmark italiano o soglia qualificata |
| Redaction PII neurale | OpenMed / challenger NER | sidecar locale | `benchmark_only` | non client-facing | `INCLUDED` benchmark-only | `blocked` | Layer deterministico obbligatorio | Non abilita egress |
| Apple Foundation Models | Nessun binding | Nessuna | `hold` | nessuna | `RELEASE_SCOPE_EXCLUDED` | `blocked` | Nessuno | Richiede decisione e gate per task |
| MLX generico | Nessun binding applicativo | runtime MLX amministrativo/diagnostico | `benchmark_only` | non client-facing | `INCLUDED` benchmark-only | `blocked` | Nessuno | Non è la lane ATHENA e non sostituisce Ollama |
| OpenAI / Anthropic | Profili provider v2 host-owned | adapter HTTPS ufficiali | `hold` | `probe_only / default_off` | `INCLUDED` | `not_verified` | Nessuno | Prova da rivedere con trasporti simulati; nessuna credenziale, rete live o disponibilità cloud attestata |

### Lettura della matrice

`runtime` indica un percorso osservato con revisione, non autonomia clinica o
ricertificazione WUL-418 completa. La capability Fabric `ocr` non dispone di
un ingresso eseguibile: AnyDoc e Apple Vision sono un percorso separato per
le sole pagine PDF `needsOcr` supportate. DeepSeek-OCR 2 resta contrattuale e
di test, non è un fallback di Apple Vision e non blocca la 0.8.5.

ATHENA/MLX ha governo e ciclo di vita propri, senza ereditare il registry
Ollama; MLX generico resta benchmark-only e non ne dimostra la readiness.
`benchmark_only` e `hold` non sono scelte selezionabili dal prodotto. Nel
perimetro paired qui registrato, iPhone e iPad non invocano direttamente i
provider, non accedono a SQLite o al filesystem dell’host e restano non-AI.

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

Il manifest del provider descrive la capacità di trasporto, non quella del
modello. Quest’ultima deve essere attestata durante l’esecuzione o da un
artifact firmato e verificabile: il nome commerciale non costituisce una prova.

## 5. Serving gate minimo

Prima di promuovere un modello o un provider occorre un pacchetto di evidenze
che soddisfi tutti i controlli seguenti. Le condizioni di arresto restano
vincolanti anche quando il risultato prodotto sembri plausibile.

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

Non esiste una soglia universale di qualità, latenza o memoria. Ogni percorso
deve dichiarare il proprio budget prima del benchmark; per l’oscuramento dei dati identificativi il
vincolo `forbiddenLeakRate = 0` non è negoziabile.

## 6. Transizioni

```text
hold → benchmark_only → shadow → runtime
```


Una transizione richiede evidenza del livello corrente, esecuzione delle prove
capaci di smentirne l’idoneità, revisione indipendente, rollback o fallback
dichiarato e aggiornamento di questa matrice. Se cambiano uscita dei dati,
conservazione, schema o autonomia, occorre nuova autorità.

Una regressione di località, qualità, privacy o kill-switch riporta il percorso
a `hold`. Non esiste promozione automatica.

## 7. Mappa delle prove

I percorsi seguenti individuano codice, contratti e registrazioni pertinenti
alla matrice. Il riferimento a un file non ne estende l’evidenza oltre la
revisione verificata.

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

Prima di riesaminare la qualified readiness in `HOLD` occorre una prova causale
adeguata, insieme a benchmark e budget aggiornati per ciascun percorso.
Un adapter DeepSeek-OCR 2 richiede prima un benchmark sintetico italiano e
soglie dichiarate, mantenendo AnyDoc come primo passaggio e ogni dato nel
processo locale. Apple Foundation Models va verificato in WUL-417 senza
promozioni implicite.

Provider esterni richiedono verifiche separate di credenziali, rete,
politiche dell’account e conservazione. Ogni nuovo modello o provider deve
essere ricertificato prima di modificare il binding dell’host; MLX generico
resta `benchmark_only` e non può essere usato come prova per ATHENA.

Sul percorso post-0.8 risultano invece chiuse le slice C0a-C0c di ADR 0092
(WUL-502), e il contratto Fabric è definito in
[ADR 0089](./adr/0089-contratto-intelligence-fabric-e-venue-esecutive.md).
ADR 0090 e ADR 0091 fissano il confine del candidato locale: paired solo
stato, fallback negato, nessun invio e nessuna scrittura clinica autonoma.
ADR 0094 e il crosswalk 0.8.5 collegano i quattro percorsi ai production root
dell’host. ADR 0107 assegna ad AnyDoc il primo passaggio documentale; il
candidato continua solo le pagine PDF `needsOcr` con Apple Vision sul Mac.
`ocr` Fabric resta non eseguibile e DeepSeek-OCR 2/CUDA conserva
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING` finché manchino adapter, E2E, benchmark,
soglie, ricomposizione e confini di uscita verificati.

Queste decisioni non bloccano l’uso locale con revisione già osservato come
`runtime` entro i confini esistenti. Bloccano la ricertificazione WUL-418,
nuovi modelli, nuovi provider e affermazioni di parità non sostenute dalle prove.
