# Metodo ATHENA: ricostruzione e prima separazione dal runner

Data: 2026-10-26. Ambito: prima tranche I-3b,
[WUL-790](https://linear.app/wulfgardr/issue/WUL-790).
Baseline MediFlow: `08ccf32a7d408bab30cbae610a4d6fea05d48803`.
[ADR 0166](../adr/0166-athena-method-runner-boundary.md): **Proposed**.

## Risultato e perimetro

Il metodo Fabric esistente è ora un builder puro nominato, condiviso dai due
executor locali già presenti. La sua estrazione conserva esattamente i byte
su entrambi i casi del corpus sintetico. Prompt legacy, parser, schema,
ammissione del modello, runner e policy di esecuzione restano quelli della
baseline. Nessuna nuova venue remota è abilitata.

Questo prova la conservazione del comportamento del refactor, non il
completamento I-3b/I-7. Una inferenza reale con il prompt Fabric ha prodotto
JSON fuori contratto, correttamente negato prima e dopo l'estrazione. Il
preflight storico con un diverso prompt legacy non prova una proposta Fabric
valida. Non sono stati usati archivi clinici, DB reali o UI.

## Fonti e metodo di ricostruzione

| Fonte | Identità e osservazione |
| --- | --- |
| Sorgenti MediFlow | Contratto/prompt legacy, execution/output V2 Fabric, production root/operation e adapter MLX alla baseline indicata. Letti come sorgente; test e inferenza sono prove distinte. |
| REA | Analisi statica inerte su sette file selezionati: `treatment-reasoning-contract.ts`, `athena-mlx-runtime.ts`, `athena-mlx-launcher-config.ts`, `treatment-reasoning-athena-execution.ts`, `treatment-reasoning-production-root.ts`, `treatment-reasoning-production-operation.ts`, `treatment-reasoning-athena-output-contract-v2.ts`. Sette file analizzati, zero parse failure. |
| Upstream | [ATHENA commit d5bbccb](https://github.com/mims-harvard/ATHENA/tree/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc): README, LICENSE, `_prompts.py`, `_core.py`, `_report.py`, `agent.py`, `tool_processors.py`, requirements. Acquisiti soltanto questi testi pubblici, senza installare/eseguire il progetto. |
| Modello locale | Config, tokenizer, chat template, generation config, index e header safetensors letti in sola lettura; checksum dei pesi ricalcolato. Questi file non identificano da soli la ricetta di conversione o l'esatto snapshot upstream. |
| Runner installato | Wrapper `mlx_lm.generate`, `mlx_lm/generate.py` e versioni della distribuzione Python locale. Le versioni osservate differiscono dal pin storico uvx: non sono intercambiabili per inferenza o qualità. |
| Preflight WUL602 | Ricevuta e risposta sintetica locale del 26 ottobre, revisione `2c0c0028fcda66eb30b7dc582d92688331ab68e9`. Riutilizzate senza rieseguire il caso già provato. |

REA parent Evidence:
`ev_0e60dad8712fad9d10f4dcd01a6b177fa3420031337a3c8c88879f1fc28941da`;
vista summary:
`ev_d0b1c7ef03b3eadff8fecea0de61669eaac0bb5b16202474d2c14ab99a7f29f7`;
vista dei due moduli execution/runtime, 50 record esaminati:
`ev_26d9ebf0c052b99a20239483dcdafc34e08d45733b273868f2adc240655eb932`.
L'identità dell'inventario analizzato è
`30f6d38bb3f149faeb667ab99ccbdfc87e44f001f5a968f262b33b099a0ee230`.

**Limite REA:** copertura applicativa e semantica parziale; 2831 file fuori
selezione, import TypeScript senza estensione in parte irrisolti. Le relazioni
statiche non attestano esecuzione, raggiungibilità o isolamento di rete.
L'inventario non è il tree Git. Evidence completa e manifest dei testi
pubblici sono conservati nel run locale, fuori da Git.

## Che cosa è il metodo, e che cosa esegue il runner

L'[upstream](https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/src/athena_r1/agent.py)
separa il ragionamento iterativo con tool dal report finale opzionale.
Il core prepara conversazione e catalogo, invoca il modello, esegue i tool,
aggiorna l'evidenza e termina tramite `Finish` o budget. Il prompt dipende
dal backend; il report usa un digest e fonti ammesse propri. Non è una
pipeline copiata da MediFlow. La [model card](https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B)
e il [paper](https://arxiv.org/abs/2606.28692) descrivono un artefatto di
ricerca: i loro risultati non qualificano l'integrazione MediFlow.

MediFlow usa invece questi passaggi osservabili:

1. L'owner acquisisce contesto e fonti, minimizza e valida la projection;
   il broker la lega a sessione, selezione, paziente e revisione correnti.
2. Fabric risolve la capability e verifica kill switch, lifecycle e runtime.
3. Il metodo serializza una domanda fissa e le sole fonti host: id, tipo,
   etichetta, estratto e data. Le fonti sono dati, mai istruzioni.
4. Il runner locale compie una generazione; non esegue tool o ricerca.
5. Il contratto V2 controlla JSON rigoroso e source binding. L'host può
   pubblicare la proposta solo se la lease viene confermata corrente.

| Profilo esistente | Istruzione e validazione |
| --- | --- |
| Legacy/preflight | `buildTreatmentReasoningPrompt`: domanda del caso, contesto, liste e JSON shape esplicita; parser normalizzante `parseTreatmentReasoningResponse`. Rimuove/limita testi e degrada policy sconosciute a revisione. Non è il validatore production V2. |
| Fabric locale | `buildAthenaTreatmentReasoningInstruction`: domanda fissa, `sourceRevision`, riferimenti ordinati, `source_payload_json`, nome schema e richiesta source binding. Non contiene l'intera JSON shape. MLX e portable ricevono gli stessi byte di metodo; attestazioni/runtime restano distinti. |
| ChatGPT esistente | Builder di contenuto, task profile e servizio nominati separati. La loro presenza non ammette la quarta cella remota: I-3b e I-7 restano gate del contratto. Questa tranche non li collega né li modifica. |

**Inferenza progettuale:** rendere esplicito il builder Fabric è il delta
minimo riutilizzabile. Unificare ora i tre profili o introdurre ToolUniverse
cambierebbe il metodo da confrontare. Il nuovo modulo riceve contenuto già
validato, non lo acquisisce e non crea autorità.

## Artefatti e runtime osservati

| Componente | Identità |
| --- | --- |
| Pesi locali MLX Q4 | `model.safetensors`, SHA256 `e27c0b3dd5f05a738d1317197951caedebe39dcf890efad8e807bb3993e7bdea`; header formato `mlx`, 907 tensor. Config Qwen3, quantizzazione affine 4 bit, group size 64. |
| Config | SHA256 `bd164a7916d15d985f2a494e44ff21642bb90f7a8e4e6da9bca9d63461f1395d`. |
| Tokenizer | `tokenizer.json` SHA256 `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4`; `tokenizer_config.json` SHA256 `443bfa629eb16387a12edbf92a76f6a6f10b2af3b53d87ba1550adfcf45f7fa0`. |
| Chat template | SHA256 `6547303363c1356aee846c1c395a3044f914f41ee8c790eb304edc5ce6ad1a38`. |
| Esecuzione osservata | Homebrew `mlx-lm` 0.32.2, MLX 0.32.4, Transformers 5.20.0, Python 3.15.0; Mac16,5 M4 Max/36 GB, macOS 27.2/26B118. |

Il wrapper passa al `main` MLX. Il runner legge il prompt da stdin, applica il
chat template del tokenizer come messaggio utente e tokenizza; MediFlow passa
`enable_thinking=false`, temperatura 0, top-p 1, seed 7 e 1600 token.
Quindi i byte del prompt applicativo non esauriscono il metodo effettivo:
tokenizer, template, decoding e pesi fanno parte della baseline di confronto.
Non è stata dimostrata equivalenza con BF16, altri runner o altre venue.

Il resolver storico `uvx` richiede offline `mlx-lm==0.29.1`, Transformers
4.56.2 e Python 3.12; il runner diretto installato è quello realmente provato.
I flag offline non sono una sandbox del sistema operativo. Il probe di questa
tranche è stato eseguito sotto `sandbox-exec` con `deny network*`.

## Prove e risultato

Soglie fissate **prima** dell'estrazione: zero byte cambiati nell'istruzione
Fabric e nel prompt legacy, zero differenze nel risultato del parser legacy.
La fixture `scripts/fixtures/athena-method-baseline.json` conserva gli hash
ottenuti alla baseline su tutti i **due** casi sintetici esistenti; il test
attraversa anche l'executor reale con il solo provider simulato.

- Entrambi i casi: istruzione Fabric, prompt legacy e parser identici.
- Suite mirata execution/output V2/production: 23/23; suite Treatment Reasoning
  esistente: 18/18; crosswalk: 19/19. Typecheck, lint, selezione completa dei
  test, never-regress, claims e gate scritture AI superati.
- Preflight WUL602: hash prompt del primo caso
  `bd4382885ec83974df9d3a28020c99b12f2fe211d0a52dae2193805efb9a77e4`;
  risposta registrata ancora valida per JSON/task/riferimenti legacy.
- Nuovo probe reale Fabric, stesso caso: 13,08 s, 1600 token massimi,
  hash istruzione
  `06ddb69d57f57a3d27102b4d43b4ecf16be56d69df84105700fdbef2e271f42d`.
  Output JSON con sola chiave `review`, privo dell'envelope e dei source binding
  richiesti. SHA256 risposta
  `359e26aa35bbb6805a6a6fece8a0f80972d9eed54f893064a01851223efafb77`.
  Replay della stessa risposta nei veri executor pre/post estrazione:
  **`denied/provider_invalid` identico**, nessuna publication.

I test esistenti verificano output malformato, riferimenti fuori insieme,
metadata falsi, timeout, risposta tardiva e commit di contesto superato. Non
sono prove di arresto fisico del runner: il percorso MLX ricontrolla la scelta
prima/dopo l'inferenza, ma non riceve un AbortSignal del processo; il segnale
dell'execution è consultato dal root. La revoca della publication e la fine
del processo richiedono evidenze distinte. Portable ha un lifecycle separato.

## Questioni aperte per la tranche successiva

Occorre correggere e qualificare il profilo Fabric che il probe ha negato,
fissando prima una nuova baseline e soglie I-7, senza sostituire il validatore
rigoroso con quello legacy. Il corpus va rivisto da Leonardo e ampliato per
fonte/pagina, negazione, incertezza, soggetto, tempo e revoca. Nessuna qualità
clinica è dedotta da hash uguali o da un rifiuto corretto.

Restano aperti: ricetta/provenienza immutabile della conversione Q4 e licenze
complete dell'artifact locale; qualifica operativa portable; arresto MLX su
revoca; confronto per venue e superfici; ADR accettato e broker/controllo
d'egresso per eventuali celle remote. I-3b non è conclusa e I-3 non viene
qualificata dalla presente estrazione.
