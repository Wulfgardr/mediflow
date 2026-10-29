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

## Emendamento proposto: profilo produttore MLX claim+refs

La prova successiva alla prima tranche ha negato tutti e quattro i risultati
Fabric dei due tentativi diagnostici: il modello duplicava i claim nei
`sourceBindings` e non manteneva i binding per ogni reasoning/caveat aggiunto.
Il diniego V2 era corretto. Ridurre le cardinalità o allentare il validatore
non risolve il contratto fra produttore e host.

La sola diagnostica MLX può nominare il profilo interno
`mediflow.treatment-reasoning.claims.v1`. Istruzione e decoder vivono nella
stessa coppia privata versionata, senza selezione dal chiamante. Il produttore
restituisce root esatta `schemaVersion, task, summary, data`; summary,
recommendation e ogni reasoning/caveat sono `{claim,evidenceRefs}`. Gli altri
campi conservano le forme V2, incluso trace obbligatorio con `toolsUsed: []`:
nessun tool è stato eseguito. Il decoder specifico nega ogni lista non vuota,
senza modificare V2 condiviso. Mancanti, extra,
metadati di autorità e vecchi formati sono negati, senza autodetection.

Il mapper copia ogni testo e lista di riferimenti e costruisce soltanto i
percorsi `summary`, `data.recommendation`, `data.reasoning.i` e
`data.caveats.i`. Nessuna deduzione di fonte, aggiunta, deduplicazione,
normalizzazione, repair o secondo tentativo. Dopo la costruzione esegue il
medesimo validatore V2, poi richiede uguaglianza strutturale completa tra
contenuti/binding mappati e normalizzati: anche statement, label, rationale e
limitations che richiederebbero pulizia sono negati. I claim hanno limite
effettivo400, imposto dai binding V2; reasoning/caveats conservano8+8 voci e
fino18 binding. Riferimenti duplicati nella stessa lista sono negati; lo
stesso riferimento su claim diversi è ammesso. Un riferimento esistente non
prova supporto semantico della conclusione: resta il gate qualità I-7.

Questo è un cambiamento dell'ABI privata del produttore, non equivalenza del
prompt647. Il profilo non è ammesso nella corsia ordinaria: executor e root
production conservano prompt direttoV2, parser e runner precedenti, anche
quando il kill switch sia già attivo. Una risposta claims strutturalmente
valida non viene pubblicata dalla corsia ordinaria. La diagnostica non emette
publication e non abilita nuove venue; l'ammissione richiede qualifica I-7
e una decisione esplicita successiva.
Il percorso portable mantiene l'istruzione direttaV2 originale;
legacy e venue remote mantengono prompt e parser propri. Le API, publication,
attestazioni host, revisione, lease/CAS e zero scritture restano invariati.
Condivisa è soltanto la primitiva di singola invocazione e timeout, senza
rinnovo, retry o fallback.

Il profilo richiede una stringa stdout integra, al massimo64000 unità di
stringa JavaScript (non byteUTF8), prima di `scanJsonObject`. Lo scanner copre
l'intero input, chiavi duplicate anche escaped, profondità/nodi e numeri
finiti. Solo dopo viene interpretato il JSON, con prototipi ordinari come
richiesto daV2. Oggetti preinterpretati, proxy e getter non entrano nel decoder.
Non si estraggono sottostringhe da markdown o `<think>`.

La sola diagnostica del profilo usa il runner nominato
`generateWithAthenaMlxClaims`, che conserva tutti i byte UTF8 decodificati di
stdout, comprese righe inattese di deprecazione. Il runner legacy conserva
il filtro precedente. Argomenti, artifact, decoding, attesa, timeout,
attestazione e verifiche di scelta restano gli stessi. La validazione non
attesta l'arresto fisico di un processo già in corso dopo revoca.

Le prove storiche distinguono il corpus diagnostico dai due casi tecnici
fissati prima del nuovo profilo. Il candidato è stato congelato prima della
loro esecuzione: un solo run per caso, senza retry selettivi.
Questi due casi tecnici sono stati esposti prima dell'esecuzione e non sono
una verifica cieca né sono riutilizzabili come holdout I-7. Gli output
diagnostici hanno mostrato conclusioni terapeutiche non sostenute dalle fonti;
la qualità resta non accettata. Un eventuale parserPASS non chiude I-7,
non accetta questo ADR e non ammette alcuna nuova venue remota. I tentativi
falliti restano conservati fuori da Git.

## Banco sintetico proposto I-3b/I-7

Il [banco locale](../quality/athena/README.md) versiona corpus, hash e soglie
ancora proposte e confronta metodo V2 diretto e servizio Fabric con runner MLX
locale. La misura reale richiede prima la revisione del corpus e l'approvazione
delle soglie da parte di Leonardo; l'autoverifica deterministica non è prova
di equivalenza MLX o qualità clinica. Il banco nega nel codice ogni venue
remota e non cambia lo stato Proposed di questo ADR.
