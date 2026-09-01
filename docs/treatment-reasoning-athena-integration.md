# Treatment Reasoning con ATHENA e Intelligence Fabric

Status: candidato sorgente locale `0.8.5`, review-only

Primary ADR: [ADR 0073](./adr/0073-treatment-reasoning-athena-boundary.md)

Program boundary:
[ADR 0109](./adr/0109-confini-programma-intelligence-fabric-headless-085.md)

## Stato corrente

Treatment Reasoning produce un'anteprima locale da rivedere. Il percorso
corrente attraversa Intelligence Fabric e usa ATHENA-R1-Qwen3-8B tramite MLX
quando modello e runner sono preprovisioned. Senza questa configurazione
fallisce chiuso. Non usa il precedente endpoint di esecuzione scelto dal
browser.

Il risultato massimo è una proposta:

- `stage=preview`;
- `review=required`;
- `writesPerformed=0`;
- `applyPolicy=none`.

La proposta non prescrive, non modifica terapie, non aggiorna diagnosi e non
autorizza un form precompilato. Le azioni suggerite conservano soltanto le
policy `no_write`, `review_only` o `form_prefill_only` definite dal contratto.

Questo stato è un'integrazione nel tree locale. Non prova disponibilità del
modello sulla macchina di destinazione, qualità clinica, release readiness,
deployment o release.

## Percorso di produzione

```text
components/treatment-reasoning-panel.tsx
  -> treatment-reasoning-browser-controller
  -> context proposal + selezione paziente confermata
  -> POST /api/ai/treatment-reasoning/ingest
  -> handle opaco monouso
  -> POST /api/ai/treatment-reasoning/preview
  -> projection broker + currentness host-owned
  -> resolver Intelligence Fabric
  -> ATHENA-R1-Qwen3-8B su MLX locale
  -> validazione output e source binding
  -> receipt + provenienza + anteprima review-only
```

### UI e controller

Il pannello `components/treatment-reasoning-panel.tsx` raccoglie il contesto
già disponibile nella scheda paziente: profilo, diario, terapie, osservazioni e
allegati. L'utente avvia manualmente **Genera bozza**.

`lib/ai-providers/fabric/treatment-reasoning-browser-controller.ts`:

1. acquisisce una context proposal host-owned;
2. inizializza e conferma la selezione del paziente;
3. costruisce una projection minimizzata e versionata;
4. invia la projection all'ingest autenticato;
5. usa l'handle opaco restituito per richiedere la preview;
6. accetta soltanto una publication con la stessa revisione sorgente, lo stesso
   timestamp di cattura e riferimenti compresi nel set di evidenze ammesso.

Il controller invalida l'operazione se cambia paziente, selezione o generazione
del pannello. Non invia provider, modello, endpoint, prompt o flag di apply.

### Ingest e preview autenticati

Le route correnti sono:

- `app/api/ai/treatment-reasoning/ingest/route.ts`;
- `app/api/ai/treatment-reasoning/preview/route.ts`.

Entrambe acquisiscono l'autorità della sessione prima di leggere il body.
L'ingest accetta una projection e un request ID; restituisce soltanto un handle
opaco. La preview accetta l'handle e un nuovo request ID.

Il broker server-side verifica sessione, selezione, paziente attivo, versione e
currentness. Replay, handle assente, cambio selezione, projection stantia o
lease non corrente negano senza invocare il provider.

### Risoluzione Fabric e runtime ATHENA

`lib/ai-providers/fabric/treatment-reasoning-production-root.ts` compone:

- projection broker autenticato;
- kill switch server-side;
- lifecycle dedicato `athena_mlx`;
- resolver Fabric host-owned;
- invocazione MLX locale;
- commit finale della currentness.

`lib/ai-providers/fabric/treatment-reasoning-production-operation.ts` fissa:

- capability `treatment_reasoning`;
- venue `local_process`;
- egress `none`;
- fallback `none`;
- provider `athena_mlx`;
- stadio massimo `preview`;
- zero scritture.

Il runtime usa `lib/athena-mlx-runtime.ts`. Il modello atteso è
`mims-harvard/ATHENA-R1-Qwen3-8B`, conservato fuori da Git. La disponibilità
del file modello è un prerequisito locale; non costituisce qualified readiness.

Un'installazione inclusa deve preprovisionare sia il modello sia il runner
locale. `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` può indicare soltanto un path
assoluto, eseguibile e host-owned denominato `mlx_lm.generate`. Il chiamante
non può aggiungere argomenti, frammenti shell o risoluzione pacchetti. Se
modello o runner non sono disponibili, il percorso nega in modo fail-closed.

Il lifecycle ATHENA è distinto dal lifecycle Ollama. Patient Insight, Smart
Import e Document Synthesis non ereditano stato, grant o fallback da ATHENA.

### Evidenza operativa del tree corrente

Il checkpoint `2574cf5fc` registra il runner offline configurabile. Sullo
stesso tree sono stati registrati:

- 6/6 test mirati verdi;
- typecheck ed ESLint verdi;
- uno smoke del percorso di produzione con modello BF16 locale, prompt
  sintetico, 64 token, output di 211 caratteri e latenza di 10,6 secondi.

Lo smoke non ha stampato l'output grezzo. Questa evidenza dimostra la seam
locale sulla macchina verificata; non sostituisce gli E2E dei quattro percorsi,
una prova prestazionale bounded sulla macchina di destinazione o una
promozione di release. La configurazione di default senza modello e runner
preprovisioned resta non disponibile e fallisce chiusa.

### Publication e revisione

La publication `mediflow.ai.treatment-reasoning-publication.v1` include:

- output `mediflow.treatment_reasoning.v1`;
- recommendation e summary;
- evidenze chiave e passaggi di ragionamento;
- caveat e safety flag;
- azioni suggerite con policy non mutanti;
- source binding per ogni claim;
- attestazione locale ATHENA;
- receipt Fabric e provenienza;
- `sourceRevision`, `capturedAt`, `writesPerformed=0` e `applyPolicy=none`.

Il parser browser rifiuta chiavi extra, riferimenti sconosciuti, receipt e
provenienza divergenti, output con write o apply e publication non legate
all'esatta projection corrente.

## Route storica ritirata

`POST /api/system/treatment-reasoning/athena-mlx` è un confine di compatibilità
terminale. La route verifica prima la sessione, poi restituisce
`410 legacy_route_retired`.

La route non legge prompt, provider, modello o budget dal chiamante e non
invoca ATHENA. `lib/treatment-reasoning-service.ts` non è l'entrypoint del
pannello corrente.

Non esiste fallback Ollama per Treatment Reasoning nel percorso di produzione.
Una lane ATHENA non disponibile, disabilitata, degradata o stantia nega in modo
fail-closed.

## Confini clinici e di sicurezza

- I dati reali non entrano in repository, fixture, log o benchmark pubblici.
- Prompt e risposta provider grezzi non sono receipt e non vengono esposti
  dalla publication.
- I source ref devono appartenere alla projection host-owned corrente.
- Il provider non riceve accesso diretto a SQLite, cookie, token o chiavi.
- Il chiamante non può chiedere apply o scegliere il runtime.
- Il client paired resta `status_only` e non invoca Treatment Reasoning.
- ToolUniverse e vLLM non fanno parte del patient data plane corrente.
- Un endpoint loopback non prova da solo assenza di egress; il contratto
  richiede anche policy e resolver host-owned.

## Mappa dei file correnti

| Responsabilità | File |
| --- | --- |
| Pannello review-only | `components/treatment-reasoning-panel.tsx` |
| Controller browser e parser publication | `lib/ai-providers/fabric/treatment-reasoning-browser-controller.ts` |
| Projection minimizzata | `lib/ai-providers/fabric/treatment-reasoning-projection.ts` |
| Route ingest | `app/api/ai/treatment-reasoning/ingest/route.ts` |
| Route preview | `app/api/ai/treatment-reasoning/preview/route.ts` |
| Boundary HTTP auth-first | `lib/ai-providers/fabric/treatment-reasoning-production-http.ts` |
| Production root | `lib/ai-providers/fabric/treatment-reasoning-production-root.ts` |
| Resolver, lifecycle e publication | `lib/ai-providers/fabric/treatment-reasoning-production-operation.ts` |
| Validazione output ATHENA | `lib/ai-providers/fabric/treatment-reasoning-athena-execution.ts` |
| Runtime MLX locale | `lib/athena-mlx-runtime.ts` |
| Route legacy terminale | `app/api/system/treatment-reasoning/athena-mlx/route.ts` |
| Crosswalk runtime | `docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json` |

## Evidenza storica del 7 luglio 2026

I risultati seguenti appartengono al checkpoint precedente del 7 luglio 2026.
Restano utili come confronto, ma non sono una prova del tree 0.8.5 corrente,
della sua integrazione Fabric o di release readiness.

| Check storico | Artifact | Risultato registrato |
| --- | --- | --- |
| Runner MLX sintetico, 2 casi, 128 token | Q4 convertito | Media 2,49 s wall time, 75,7 token/s, picco 5,36 GB. |
| Smoke DB redatto, 3 casi, 1600 token | Q4 convertito | Contratto 3/3, evidence ref 3/3, latenze 25,5 s, 31,0 s e 27,8 s. |
| Smoke DB redatto, 1 caso, 1600 token | BF16 shard | Contratto 1/1, evidence ref 1/1, latenza 63,4 s. |
| Smoke dopo hardening pin/offline, 1 caso | Q4 convertito | Contratto 1/1, evidence ref 1/1, latenza 27,8 s. |

Anche gli esperimenti con server MLX caldo, KV cache quantizzata e prompt cache
restano storici e non promossi. Non costituiscono fallback o runtime alternativo
del candidato.

## Fonti e attribuzione

Le fonti upstream registrate nel checkpoint storico sono:

- [repository ATHENA](https://github.com/mims-harvard/ATHENA);
- [paper ATHENA](https://arxiv.org/abs/2606.28692);
- [model card ATHENA-R1-Qwen3-8B](https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B);
- [licenza Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE);
- [MLX-LM](https://github.com/ml-explore/mlx-lm).

MediFlow usa il modello locale come componente di supporto alla revisione. Non
dichiara ATHENA o Treatment Reasoning come dispositivo medico, prescrittore o
decisore autonomo.

## Verifica mirata

I controlli repository disponibili includono:

```bash
npm run test:treatment-reasoning
npm run check:fabric-generative-runtime-crosswalk
npm run test:fabric-generative-runtime-crosswalk
npm run check:mlx-operational-parity
npm run check:ai-clinical-writes
npm run check:claims
```

Il live DB smoke è un controllo separato e potenzialmente sensibile. Non è una
verifica predefinita del candidato e non va eseguito con dati reali per
produrre artifact, log o prove destinate a Git.

## Claim ceiling

Il claim massimo è: **percorso Treatment Reasoning integrato nel candidato
sorgente locale 0.8.5 attraverso UI, controller, ingest/preview autenticati,
currentness host-owned, Intelligence Fabric e ATHENA su MLX, con publication
review-only e zero scritture**.

Non prova qualità clinica, disponibilità del modello, prescrizione, apply,
fallback, AI paired, ToolUniverse/vLLM operativo, egress, deployment, release,
certificazione o conformità legale.
