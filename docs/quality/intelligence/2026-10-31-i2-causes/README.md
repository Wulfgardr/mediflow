# Cause e nuova misura I-2 del 31 ottobre 2026

Patient Insight, Smart Import e Document Synthesis hanno restituito una proposta disponibile, HTTP 200, con una sola inferenza per cella. Il monitor RSS ereditato non ha osservato le prime due celle e ha coperto solo la coda della terza: la misura delle risorse resta incompleta. Nessuna qualifica, ammissione clinica o accettazione semantica.

Base origin/main `d3e6ee265dcf1954d62f2f431f0ea993a8eb54d1`, Node 24.22.0. Riferimenti: #741, WUL-790, misura del secondo giro del 30 ottobre. Il diff non modifica runtime, contratto o guard. Non è richiesta la suite unitaria perché non cambia `lib/`.

## Cause provate e correzioni del banco

Nel banco Next dev a route fredde la selezione restituisce 200, poi Smart Import ingest restituisce 409 `stale_selection` e Document Synthesis capture restituisce 503 `operation_unavailable`. I corpi sono stati acquisiti nella nuova riproduzione, senza inferenza. Il vecchio listener osservava soltanto preview e perdeva questi dinieghi.

Con lo stesso codice, modello e testo, preparando le route prima della selezione, Smart Import ingest e Document Synthesis capture restituiscono 200. La variabile che risolve entrambi è la preparazione delle route: la compilazione a richiesta del banco di sviluppo invalida lo stato in memoria tra selezione e consumo. È un difetto del banco usato come misura stabile. Non dimostra un difetto della distribuzione production, che qui non è stata eseguita. Non si modifica la durata delle lease, non si rinnova una selezione negata e non si indeboliscono le verifiche di contesto.

La preparazione usa richieste prive di handle valido, prima della selezione reale: GET selection, POST ingest Smart Import, capture/ingest Document Synthesis e le tre preview con `{}`. I loro 400/403 sono intenzionali e non inferenze. Nella diagnosi le preview erano inoltre intercettate con `diagnostic_no_inference`. Il banco reale non intercetta le preview.

Dopo capture 200, il vecchio `.txt` incontra 409 `unsupported_local_extraction`: manca un formato supportato dal percorso AnyDoc. Il banco ora carica un PDF testuale locale con lo stesso testo sintetico, senza OCR o modifiche del contenuto. Capture e ingest arrivano a 200. È un prerequisito del banco, non una ragione per allargare i formati del prodotto. Hash del testo e del PDF in `misura.json`; la citazione S1 restituisce l'intero testo originale. L'ipotesi iniziale di membership mancante è smentita dalla selezione riuscita: la creazione legacy assegna l'ambulatorio predefinito.

L'ammissione del provider precarica il modello. Il vecchio controllo immediato `/api/ps == []` falliva per questo. Il banco ora scarica dalla memoria soltanto il modello sul proprio server dedicato prima di misurare. Nessun pull o rimozione di file.

## Misure

| Funzione | Preparazione reale | Preview | Tempo banco | Inferenze | Scritture dichiarate |
| --- | --- | --- | ---: | ---: | ---: |
| Patient Insight | contesto disponibile | 200, available | 16,888 s | 1 | 0 |
| Smart Import | ingest 200 | 200, available | 12,829 s | 1 | 0 |
| Document Synthesis | capture 200, ingest 200 | 200, available | 15,757 s | 1 | 0 |

I tempi comprendono preparazione delle route e generazione, senza login e caricamento iniziale della pagina; non sono token/s né prestazioni esclusive. Il log Ollama conserva esattamente tre POST `/api/chat`. Patient Insight produce una proposta minima con riferimento S1; Smart Import e Document Synthesis restituiscono proposte con provenienza. La revisione semantica resta a Leonardo. Non si deduce correttezza clinica da HTTP 200 o dalla presenza delle fonti. Annullamento durante inferenza, revoca fisica anticipata, GPUI, chat e headless non osservati.

## Limiti e rossi

Solo `qwen3.5:35b-a3b`, digest `3460ffeede5453ead027dbd2f821b12ad0aa3de54630971993babdb2165221f7`, già installato. Ollama.app 0.40.6 su 127.0.0.1:11435, modelli protetti da scritture, cloud disabilitato, sandbox con sola rete loopback e sonda EPERM verso destinazione esterna. Il server di Leonardo su 11434, PID 39854, non è stato fermato o modificato. Una generazione alla volta, nessun download, nessun retry generativo. Tutte le tre durate entro 10 minuti. Disco minimo 30,519 GiB, sopra 25 GiB.

Il monitor precedente filtrava `ollama runner`; il binario reale è `llama-server`. I campioni vuoti non valgono zero memoria. Patient Insight e Smart Import non hanno misura RSS; Document Synthesis ha solo 8 campioni finali, picco parziale 22,427 GiB. La conformità completa al tetto di 30 GiB non è dimostrata. Il monitor corretto segue i discendenti del PID del server posseduto e arresta soltanto quel gruppo se supera il limite. Nessun nuovo run per colmare il difetto di osservazione. Memoria GPU e picco continuo non misurati.

Restano conservati: primo tentativo diagnostico fallito per precaricamento; riavvio fallito sull'archivio sintetico con stato di manutenzione residuo sotto sandbox; un conflitto di porta causato da due lanci sovrapposti del banco, entrambi fermati; riproduzione fredda con due test rossi; diagnosi calda con Smart Import eseguito solo fino alla preview intercettata e Document Synthesis rosso sul TXT. Questi errori non sono trasformati in successi. I successivi lanci usano directory sintetiche nuove. Nessuna inferenza in quei tentativi diagnostici. Il banco reale termina 3 test superati, con il limite RSS sopra.

22 test mirati dei controller e adapter HTTP, 2 test del registro, never-regress, database import boundary e selezione test superati. Nessuna modifica al contratto: contractSha256 invariato. Nessuna prova I-5/I-6. Treatment Reasoning e ATHENA rimangono rinviate oltre 0.9.1 e non sono state invocate. Claim su cifratura e zero-knowledge invariati.

Dossier esterno: `/Users/leonardopegollo/Antigravity/mf-coord-091/fix-i2-causes-evidence-20261031`. Contiene banco, ricevute, risposte, screenshot, log, campioni e manifest SHA-256. Testo generato e archivi sintetici restano fuori da Git. Server dedicati e figli posseduti terminati, `/api/ps` finale vuoto. Nessun merge e nessuna attesa della CI.

Sviluppo assistito: GPT 6.1 Sol, effort high, senza delega. Rilavorazioni del solo banco descritte sopra; consumi non attribuibili.
