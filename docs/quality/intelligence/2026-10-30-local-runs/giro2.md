# Secondo giro I-2 e ATHENA del 30 ottobre 2026

Base ef8bab65bac0c9f5860dd5cc34a6d43af493fc54. Correzione del prompt nel commit 92baba4a9, distinta dalla registrazione delle misure. Solo archivio sintetico e Node 24.18.0. Nessun merge, nessuna accettazione ADR 0166 o equivalenza. Nessuna qualifica clinica.

## Diagnosi ATHENA

Diagnosi (b), verificata sul prompt passato realmente al runner nel primo giro. Il prompt nomina `mediflow.treatment_reasoning.v1` e richiede sourceBindings, senza descrivere root, data, tipi, enumerazioni o associazioni claimPath/claim. Il validatore V2 richiede invece cinque chiavi esatte e binding per ciascuna affermazione. Il diniego a treatment-reasoning-athena-execution.ts:191 segue la normalizzazione, prima del commit. Il banco applica gli indicatori alle sole proposte accettate: i cinque zeri non misurano i testi rifiutati.

Fonte originale verificata: https://github.com/mims-harvard/ATHENA/tree/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc
`src/athena_r1/agent.py`, righe 342-351: prompt canonico Stage 1 per domande aperte e risposta finale libera. `AthenaResult.answer` e README documentano testo libero; Stage 2 map_to_option estrae una lettera per la valutazione MCQ. `_prompts.py` descrive anche i tool call, non un oggetto clinico `review`. Questo non dimostra un addestramento sul formato `review`. Non viene quindi introdotta una mappatura ipotetica di review a V2. La model card identifica i pesi: https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B.

Correzione: descrizione esplicita del formato chiuso nel solo metodo che costruisce il prompt di esecuzione. Nessuna modifica del parser, del modello, del corpus, dei parametri di decoding o delle soglie. Il prompt originale resta come prefisso; il test conserva i suoi hash storici e quelli del parser legacy. Un nuovo test richiede la forma e i binding, fallisce prima e passa dopo la correzione. Il cambiamento tocca l'esecuzione e richiede review. Non prova capacità affidabile di seguire istruzioni né qualità clinica. Un eventuale nuovo errore dopo questa correzione resta osservabile, senza recuperi permissivi o altri tentativi.

Il primo giro e i testi originali restano nella cartella precedente senza alterazioni. Il caso negazione precedente confonde la data della nota con la data dell'evento e ipotizza una sospensione ingiustificata. La correzione di formato non corregge queste affermazioni di sostanza.

Esito del confronto dopo la correzione: i cinque casi positivi restano provider_invalid nei due percorsi. Il primo testo ora riprende schemaVersion/task/summary/data/sourceBindings, ma copia le descrizioni dell'esempio (Sintesi, Motivazione, Segnale), aggiunge binding per flag/azioni e caveat vuoti e termina con una parentesi graffa di troppo. Il validatore non accetta questi output. La carenza (b) del vecchio prompt è dimostrata; nel giro corretto si osserva anche mancato rispetto del formato (c), senza una nuova correzione o un nuovo run. Dieci soglie su diciotto falliscono ancora. Non si può attribuire questo esito al solo precedente difetto del prompt e non si deduce qualità clinica dai cinque zeri.

## Un solo nuovo confronto reale

Picco RSS campionato: 4.634 GiB; disco minimo 39.94 GiB. Carico a un minuto: 23.04 a 80.84. Mac condiviso con altri test: tempi osservati, non prestazioni esclusive. Memoria GPU non attribuita dal campionamento RSS ogni circa 0,5 secondi.

| Caso | Diretta s | Fabric s | Codici | Atteso raggiunto |
| --- | ---: | ---: | --- | --- |
| negazione | 13.532 | 11.715 | provider_invalid / provider_invalid | False |
| familiare | 18.277 | 16.710 | provider_invalid / provider_invalid | False |
| storico | 13.683 | 13.692 | provider_invalid / provider_invalid | False |
| assenza | 0.000 | 0.000 | source_missing / source_missing | True |
| contraddizione | 16.224 | 16.220 | provider_invalid / provider_invalid | False |
| ostile | 12.166 | 11.658 | provider_invalid / provider_invalid | False |
| malformato | 25.892 | 39.566 | provider_invalid / provider_invalid | True |
| revoca | 12.311 | 10.179 | provider_invalid / provider_invalid | False |
| contesto | 16.778 | 15.581 | provider_invalid / provider_invalid | False |

| Cella | Metrica | Primo giro | Secondo giro | Esito |
| --- | --- | ---: | ---: | --- |
| athena-local-direct | sourcePage | 0 | 0 | FAIL |
| athena-local-direct | negation | 0 | 0 | FAIL |
| athena-local-direct | uncertainty | 0 | 0 | FAIL |
| athena-local-direct | subject | 0 | 0 | FAIL |
| athena-local-direct | time | 0 | 0 | FAIL |
| athena-local-direct | inventedSources | 0 | 0 | PASS |
| athena-local-direct | unconfirmedWrites | 0 | 0 | PASS |
| athena-local-direct | unexpectedEgress | 0 | 0 | PASS |
| athena-local-direct | equivalence | 1 | 1 | PASS |
| fabric-local-mlx | sourcePage | 0 | 0 | FAIL |
| fabric-local-mlx | negation | 0 | 0 | FAIL |
| fabric-local-mlx | uncertainty | 0 | 0 | FAIL |
| fabric-local-mlx | subject | 0 | 0 | FAIL |
| fabric-local-mlx | time | 0 | 0 | FAIL |
| fabric-local-mlx | inventedSources | 0 | 0 | PASS |
| fabric-local-mlx | unconfirmedWrites | 0 | 0 | PASS |
| fabric-local-mlx | unexpectedEgress | 0 | 0 | PASS |
| fabric-local-mlx | equivalence | 1 | 1 | PASS |

Le metriche sono quelle del banco originale e non vengono corrette dopo il risultato. Zero nelle prime cinque metriche, se la proposta è rifiutata, significa nessuna proposta accettata e non qualità pessima. inventedSources è fissata a zero dal banco, non misura la correttezza semantica delle citazioni. equivalence confronta valori normalizzati e dinieghi, non è accettata come equivalenza clinica o di testo. Revoca e cambio contesto sono eventi sintetici; la terminazione naturale dei PID non prova annullamento fisico anticipato. Corpus, soglie, pesi e decoding invariati.

## I-2

Binario incluso in Ollama.app 0.40.6, ammesso senza cambiare il contratto. Server dedicato solo su 127.0.0.1:11435, modelli della cartella esistente sotto deny file-write*. Nessun download o pull. Sandbox con rete ammessa solo loopback, cloud disabilitato e una sola inferenza alla volta. Il primo avvio è fallito sul tentativo di pulizia impedito dalla sandbox; riavvio con OLLAMA_NOPRUNE=1. Il server condiviso PID 39854 su 11434 resta estraneo al banco.

Primo tentativo UI prima di qualsiasi inferenza: Patient Insight fallito perché la scheda era ancora in caricamento oltre 10 secondi, Smart Import fallito durante nuova attestazione oltre 30 secondi, Document Synthesis interrotto. Preparazione corretta con attesa della vista e lettura della configurazione già ammessa. Nel tentativo seguente Smart Import si ferma ancora nello sblocco a 5 secondi e Document Synthesis prima della conferma, durante caricamento del contesto. Corrette solo le attese negli helper temporanei: riprese queste due celle prima della loro prima richiesta generativa. Patient Insight non ripetuta. Nessun retry di inferenza o qualità. Il banco resta fuori dalla CI; questi fallimenti dimostrano che la sua preparazione precedente non era sufficiente.


Gli esiti I-2 e i testi integrali restano nel dossier esterno; il riepilogo numerico è in giro2.json.

## Esito finale I-2 e chiusura

| Cella | Inferenze | Risultato | Tempo osservato | Fonti |
| --- | ---: | --- | --- | --- |
| Patient Insight | 1 | HTTP 200, proposta available | 62,765 s dal banco; /api/chat 4,965 s nel log server | Sintesi vuota e una sola frase di follow-up con [S1]; supporto semantico non verificato |
| Smart Import | 0 | HTTP 409 in ingest, preview mai raggiunta | 1,724 s della ingest nel log; poi 350,062 s di sola attesa del banco | Nessuna proposta |
| Document Synthesis | 0 | HTTP 503 in capture, preview mai raggiunta | 1,171 s della capture nel log | Nessuna proposta |

La seconda preparazione delle due celle ancora senza inferenza ha esposto
questi dinieghi prima del modello. Non sono tempi generativi. La risposta
HTTP di ingest/capture non è stata conservata dal listener, che osservava
solo preview: causa interna specifica non stabilita. Sono conservati log,
screenshot e contesto della vista. Interrotta l’attesa inutile della preview
di Document Synthesis dopo il 503, senza interrompere alcuna inferenza.
Nessun ulteriore tentativo dopo questi esiti. I-2 resta parziale.

Picco RSS I-2 campionato: 22.434 GiB. Una sola
inferenza e nessun limite raggiunto. L'annullamento durante inferenza non è
stato osservato: non è stata inviata una seconda richiesta dopo la prima
generazione. Il rilascio con keep_alive=0 ha riportato /api/ps vuoto.
Server dedicato e suoi figli terminati, nessun listener su 11435 o 3741.
PID 39854 verificato ancora attivo come ollama serve. Ricevuta shutdown.json.

## Verifiche finali

24 test mirati, 2 test del registro, never-regress, 45 test della selezione,
crosswalk con 19 test e claims superati. Suite unitaria rossa: 8.964 test,
8.934 pass, 6 fail, 24 skipped. Tre fail richiedono sorgenti native esterne
non configurate; gli altri riguardano admission_busy in SQLite, diniego nella
verticale specialistica e OPERATION_DENIED nella prova Mini. Sono fuori dal
diff, senza baseline che attribuisca ogni errore al carico. Nessun rilancio
integrale. I rossi della misura restano rossi.

Primo giro: hash di 19 file verificati invariati. Scheda esterna con fonti e
testi integrali affiancati: revisione-leonardo.md. La correzione del prompt
richiede review; nessuna equivalenza, nessuna accettazione ADR 0166, nessun
merge. I-2, qualità ATHENA e suite unitaria non consentono un esito verde.
