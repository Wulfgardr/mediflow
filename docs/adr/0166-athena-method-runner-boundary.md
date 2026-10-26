# ADR 0166: metodo ATHENA separato dal runner

Date: 2026-10-26
Status: Proposed

## Problema

[I-3b/WUL-790](https://linear.app/wulfgardr/issue/WUL-790) richiede un metodo
riutilizzabile tramite Intelligence Fabric. Il metodo locale MediFlow non è
l'agente upstream completo: usa i pesi ATHENA per una generazione sulle fonti
già acquisite dall'host, senza ToolUniverse o ricerca esterna. Il
[rapporto](../analysis/2026-10-26-athena-method.md) distingue sorgenti,
artefatti, inferenza osservata e limiti della ricostruzione.

## Alternative e decisione proposta

1. Importare l'agente upstream: aggiungerebbe tool, rete, conversazione e
   report che la corsia locale non esegue né ha qualificato.
2. Unificare subito i prompt legacy, Fabric e ChatGPT: cambierebbe i byte
   inviati al modello e richiederebbe una nuova baseline di qualità.
3. Nominare il metodo Fabric già condiviso da MLX e portable e mantenere
   separati metodo, validazione, autorità e trasporto.

Si propone la terza alternativa. La prima tranche estrae soltanto il builder
puro `buildAthenaTreatmentReasoningInstruction` in
`lib/ai-providers/fabric/treatment-reasoning-athena-method.ts`. Conserva i
byte e i validatori esistenti; non aggiunge un executor generico o un registry.

## Contratto

| Responsabilità | Contratto |
| --- | --- |
| Ingresso metodo | `sourceRevision`, `evidenceRefs` ordinati e `sources` della projection già validata dall'owner: id, tipo, etichetta, estratto e data. Nessuna acquisizione, selezione paziente o autorità nasce dal builder. |
| Istruzione | Domanda fissa di revisione, fonti JSON dichiarate non attendibili come istruzioni, riferimenti ammessi, schema v1, source binding richiesto e divieto di scritture. La serializzazione originale è conservata. |
| Uscita provider | JSON `mediflow.treatment_reasoning.v1` più `sourceBindings`; il contratto V2 rigoroso verifica forma, policy non mutanti e corrispondenza esatta dei claim alle fonti ammesse. Il parser legacy permissivo non lo sostituisce. |
| Provenienza | Receipt, provider, modello, venue, egress e attestazione provengono dall'host; non dal testo del modello. Publication soltanto dopo il commit della lease corrente. |
| Runner | MLX possiede processo, artifact, tokenizer/chat template, decoding e limiti; portable possiede il proprio worker e ammissione. Il metodo non importa filesystem, rete, ambiente, DB o credenziali. |
| Errore | Configurazione, fonti, runtime o risposta invalidi negano la publication. Timeout e risposta tardiva non pubblicano. Nessun retry o ripiego automatico viene aggiunto. |
| Revoca | Resta nell'owner sessione/projection e nel dispatch del modello; la lease deve risultare corrente al commit. Il builder puro non può attestare revoca o arresto del processo. |

Il profilo legacy `buildTreatmentReasoningPrompt`, usato dal preflight e dal
benchmark storico, resta distinto. Il profilo ChatGPT esistente resta distinto
e non viene collegato al metodo estratto: condividere uno schema non prova
equivalenza di istruzione, qualità o autorità.

## Future venue e gate

Un futuro adapter OpenAI Responses API, Anthropic Messages API o ChatGPT
potrà ricevere il contenuto del metodo soltanto dopo acquisizione host,
minimizzazione, consenso, controllo d'egresso/broker e ammissione nominata
della capability. Dovrà conservare fonti, subject/time/negazione/incertezza,
source binding, revoca in corso, revisione e zero scritture. Una credenziale o
un login consumer non concede questa ammissione.

Questo ADR rimane **Proposed**. Nessuna nuova venue remota è abilitata dalla
tranche. Servono accettazione dell'ADR e prova I-7 su corpus rivisto da Leonardo,
con soglie fissate prima dell'esecuzione e confronti per singola cella. I due
casi esistenti e una prova d'inferenza non costituiscono quella qualifica.

## Verifica della prima tranche

Prima dell'estrazione si fissano tolleranze zero per byte dell'istruzione
Fabric, byte del prompt legacy e risultati del parser sui due casi del corpus
sintetico esistente. Le prove d'inferenza/risposta registrata distinguono
equivalenza del refactor da qualità del modello; un diniego identico prima e
dopo non dimostra che la corsia generi una proposta valida.

Resta necessario qualificare separatamente runner, tokenizer, artifact,
isolamento di rete e ciclo di vita sulla destinazione. I flag offline del
runner e l'identità nominale del modello non bastano.
