# Risposta libera e estrazione deterministica

Modulo di ricerca opzionale, vietato per la cura diretta dei pazienti.
ADR 0166 resta Proposed. Refs WUL-790, I-3/I-3b/I-7 aperte.

Il candidato è separato in `lib/ai-providers/athena-research/`. Non sostituisce
il metodo V2 ordinario, il profilo claims o il portabile. Non emette una
publication e non entra nel catalogo come configurazione qualificata.
Senza runtime dichiara `research_module_absent`; import e test non cercano
Python, pesi, servizi o download. Il nucleo conserva il proprio percorso.

`original-prompts.ts` conserva i due testi canonici del commit upstream
`d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc`, con licenza MIT affiancata e hash
verificati nei test. `method.ts` inserisce una domanda MediFlow separata nel
template originale e fornisce il prompt di sistema originale come campo
distinto. Non chiede JSON. Le deviazioni sono esplicite: soli dati sintetici,
una risposta libera in italiano sulle fonti congelate, nessun tool, ricerca,
ciclo multi-step o secondo modello. È un adattamento MediFlow con pesi ATHENA,
non l'agente ATHENA originale.

Il port runtime del modulo riceve entrambi i prompt e un segnale di arresto.
Il modulo impone 420 secondi di attesa e nega risposte con fine sconosciuta o
troncata. Il runner MLX storico non attesta il motivo di fine tramite il solo
stdout: un exit 0 non può essere tradotto in `finishReason=stop`. Il candidato
non aggiunge tale attestazione e non include un nuovo comando di inferenza.
Il collegamento live e la prova di arresto fisico non sono consegnati dal replay.

## Sottoinsieme estraibile

`extractor.ts` è conservativo: accetta soltanto contenuto già completamente
esplicito nel contratto V2, anche se l'intera risposta è racchiusa in un unico
blocco Markdown JSON. Non promette una conversione generale della prosa.
Una risposta libera senza campi o associazioni sufficienti è un risultato
negativo, non viene riscritta per renderla accettabile. Non è un nuovo prompt
claims e non chiede al modello questo sottoinsieme.

Lo scanner lessicale copre l'intero contenuto: duplicati, chiavi escaped,
testo esterno, profondità e dimensione sono controllati. Non elimina trace
interna, prefissi o testo successivo. Non ripara JSON, non deduce legami
dall'ordine o dal lessico, non completa array, trace o metadati. Rifiuta tool
dichiarati e tool call, che non vengono eseguiti. Dopo V2 richiede uguaglianza
strutturale integrale per negare anche pulizie o troncamenti impliciti. Ogni
stringa estratta mantiene percorso e intervallo nel grezzo. Il validatore
V2 condiviso non è modificato.

I dinieghi `extraction_*` sono distinti da `provider_invalid`. Il modulo
controlla `research_revoked` e `research_context_lost` prima di estrarre,
anche quando il grezzo è malformato. I test esercitano questi guard con un
runtime simulato; il replay non li esercita e lo dichiara.

## Replay e indicatori

```sh
node scripts/run-strip-types.mjs scripts/athena-quality/replay.ts \
  --source /percorso/primo-giro --source /percorso/secondo-giro \
  --output /percorso/nuovo/replay
```

Il comando non importa un runner e non invoca modelli. Richiede 16 risposte
per giro, combinazioni caso/cella uniche, hash di approvazione del corpus e
delle soglie correnti e identità del payload delle fonti nel prompt storico.
Copia soltanto gli artefatti sintetici nominati con creazione esclusiva,
conserva stdout/stderr integri e hash, affianca fonti, grezzo ed estratto nella
scheda per Leonardo. Non legge database. L'output deve essere assente.

Le nuove diagnostiche sono separate dalle 18 soglie approvate: JSON valido
sull'intero stdout, estratti validi e denominatori per caso/cella/giro e sui
cinque positivi. Ogni grezzo ha una scheda di revisione umana, compresi quelli
rifiutati: claim non sostenuti, fonti inventate, perdite di negazione,
incertezza, soggetto e tempo, omissioni e aggiunte. I conteggi restano `null`
finché la valutazione non è svolta; non diventano zero errori. Un diniego non
è una valutazione semantica del testo. Il replay non pubblica proposte.

Il caso malformato conserva separati grezzo reale e fault injection storica
`{invalid`. Revoca e perdita di contesto sono `not_exercised_by_replay`, senza
attribuire a quei guard un diniego di estrazione. Non si ricalcolano soglie
di qualità su un replay, né si trasformano dinieghi uguali in equivalenza.

## Esito del 30 ottobre 2026

Replay di entrambi i giri conservati dalla PR #741: **0/32 estratti**,
**0/5 positivi estraibili per giro e cella**. Il primo giro ha JSON
sintatticamente valido in 7/8 risposte per cella, 4/5 positivi; il secondo
0/8 per cella, 0/5 positivi. La struttura e i legami espliciti necessari
restano assenti oppure il testo è malformato. Nessun contenuto ricostruito.

Si applica lo stop dell'ADR prima di generare: **0 nuove invocazioni ATHENA;
il solo run autorizzato non è consumato**. Non si afferma che il nuovo prompt
libero fallirebbe: non è stato eseguito. Le precedenti 10 soglie fallite su
18 per giro restano tali. Corpus, soglie e manifest conservano i loro hash.
La revisione semantica dei 32 grezzi è ancora da svolgere da parte di Leonardo.
