# WUL-832: #938 supera la regola aggregata

Su cinque pazienti sintetici e 20 richieste per paziente e braccio, #938 riduce le attribuzioni errate rilevate dal criterio congelato: da 50 a 18 nei tentativi grezzi e da 26 a 18 nelle proposte accettate. Le diagnosi nuove attese proposte passano da 84 a 82 su 100 occasioni, una perdita del 2,4%. Le proposte accettate salgono da 96 a 100.

La regola fissata prima della misura richiede meno fonti sbagliate e una perdita non superiore ad un terzo delle diagnosi nuove. È rispettata: servivano almeno 56 diagnosi attese proposte, ne sono arrivate 82. La decisione riguarda questo campione sintetico e questo modello locale. Il merge resta al coordinatore della release, dopo CI e verifiche richieste.

## Misura decisiva

| Caso e diagnosi attesa | Nuove main | Nuove #938 | Fonti errate grezze main → #938 | Fonti errate finali main → #938 | Proposte accettate main → #938 |
| --- | ---: | ---: | ---: | ---: | ---: |
| P1: Ipertrofia ventricolare sinistra | 13/20 | 19/20 | 19 → 18 | 19 → 18 | 20/20 → 20/20 |
| P2: Microalbuminuria | 12/20 | 3/20 | 25 → 0 | 6 → 0 | 17/20 → 20/20 |
| P3: Anemia sideropenica | 20/20 | 20/20 | 2 → 0 | 1 → 0 | 20/20 → 20/20 |
| P4: Bronchiectasie | 19/20 | 20/20 | 4 → 0 | 0 → 0 | 19/20 → 20/20 |
| P5: Fibrillazione atriale | 20/20 | 20/20 | 0 → 0 | 0 → 0 | 20/20 → 20/20 |
| **Totale** | **84/100** | **82/100** | **50 → 18** | **26 → 18** | **96/100 → 100/100** |

Ogni paziente ha una diagnosi nuova attesa. I conteggi delle diagnosi sono occorrenze nelle 20 richieste, non diagnosi distinte. Ogni oggetto con una fonte errata conta una volta, compresi gli item delle prestazioni. Gli errori grezzi includono i tentativi rifiutati dall’host. Gli errori finali sono nelle proposte che l’host ha accettato per la revisione. Non è stata applicata alcuna proposta.

Su P2 la microalbuminuria scende da 12 a 3 proposte su 20, una perdita del 75%. Il miglioramento di P1 e P4 mantiene la perdita aggregata sotto la soglia. I 18 errori finali residui sono tutti su P1: gli excerpt uniscono valori presi da fonti diverse sotto un solo ID, per esempio PA 150/94 e media domiciliare 150/95. La PR riduce questo errore solo da 19 a 18 su P1.

Le evidenze finali non risolte passano da 16 a 33. Per paziente: P1 3 → 21, P2 0 → 0, P3 2 → 3, P4 11 → 9, P5 0 → 0. Sono excerpt non letterali che il controllo meccanico non sa classificare come corretti o sbagliati. Non aumentano il numero delle fonti verificate. La correttezza clinica dei campi, dei codici e delle altre diagnosi proposte non è misurata.

## Metodo e revisioni

Il [protocollo v2](metodo-v2.md) ed il [corpus](corpus.json) sono congelati nel commit `d3b285e20`, prima delle nuove inferenze. La fonte errata viene riconosciuta da ID inesistenti, excerpt di un’altra fonte, valori numerici provenienti da un altro documento, excerpt della scheda citati come documento o diagnosi attese attribuite alla fonte sbagliata. Le parafrasi residue restano non risolte. Le definizioni precise e i controesempi sono nel protocollo.

La calibrazione v1 non decide la PR. Il suo criterio lessicale segnava come errata anche una citazione letterale corretta di una diagnosi già in scheda. Il controesempio è rosso con v1 e verde con v2. I 100 risultati di calibrazione sono conservati separatamente. Il confronto decisivo usa 100 nuove richieste per braccio, con base dei semi 1672000.

- Modello reale: `qwen3.5:35b-a3b`, digest `26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a`.
- Ollama 0.40.6, solo `127.0.0.1:64812`, Node 24.18.0, temperatura 0.4, thinking disattivato.
- Main misurato: `4145a471b0985402f3d01ad81636d917230a3947`, prodotto corrispondente a main `dbf207b14`. La base finale `11cb03ea5` aggiunge correzioni GPUI/Mini e lascia invariato il percorso misurato.
- #938 misurata: `8d466b895e4834c69c96535ddbc5986c21e7d2f7`, dopo l’aggiornamento sulla base finale. Le modifiche successive di questa lane non cambiano il prodotto misurato.
- Corpus SHA-256: `469f876ca016c377b4ca89cf0cc0a543b405a0c7a845a6286f18eef03b985ca9`.

Sono usati la vera capability dell’host, il registro, l’adapter Ollama, il router e i controlli di risposta. Consenso, broker, ciclo di vita e readiness ricevono fixture sintetiche. L’adapter esegue comunque l’attestazione reale del server/modello. La sonda aggiunge soltanto il seme al trasporto. Non apre un archivio clinico. Non misura UI, GPUI, cattura delle fonti, applicazione o persistenza.

I 100 payload di #938 contengono quattro enum corretti. Documenti e semi corrispondono a main. Prompt e schema differiscono solo per le modifiche previste dalla PR. Il rigioco concorda con i risultati dell’host su 100 richieste per braccio. Su main ci sono 108 tentativi, 12 rifiutati per `source_binding_invalid`, nessuna troncatura e nessun errore di schema. Su #938 ci sono 100 tentativi, tutti accettati.

Anche con payload e semi uguali il runtime non restituisce sempre lo stesso testo: cinque ripetizioni del preflight v1 lo dimostrano. I semi delle richieste sono controllati, il risultato non è deterministico byte per byte. Ollama è stato spento fra le suite e riavviato con lo stesso ambiente, versione e digest. Le misure non giravano insieme alle suite complete.

## Strumenti e prove

- [Sonda](run.mjs), [classificatore](analizza.py), [controesempio della citazione](prova-citazione.py), [rigioco derivato dallo script precedente](rigioca-import.mjs), [verifica dei payload](verifica-payload.py).
- [Risultati aggregati e metadati](risultati.json).
- 707 test selezionati verdi dopo l’aggiornamento su main, inclusi prompt, schema, capability e golden. Il test che pretende i quattro enum è rosso sul prodotto main e verde sul ramo.
- Suite unitaria completa: main 9.210 test, 100 fallimenti, 32 saltati. Ramo 9.213 test, 99 fallimenti, 32 saltati. I 99 nomi falliti sul ramo sono tutti presenti anche su main, nessun fallimento nuovo. La prova FHIR sulla terminazione del gruppo del validatore fallisce solo su main. Le suite non sono globalmente verdi.
- `npm run typecheck` e `npm run lint`: verdi. Tutti i 25 comandi di controllo del job `repository-guards` sono verdi, inclusi `never-regress`, il confine di import del database e le prove negative. Dipendenze tramite il symlink consentito, senza eseguire installazione o preparazione sulle dipendenze condivise. La build Next non è stata eseguita in questa lane.

Per ripetere una corsa, da una revisione del prodotto indicata sopra, con questo corpus ed Ollama compatibile già avviato sulla porta del banco:

```bash
MEDIFLOW_DATA_DIR=$(mktemp -d) nice -n 10 node scripts/run-strip-types.mjs docs/verification/smart-import-wul-832/run.mjs main-v2 /tmp/wul832-main-v2 20
python3 docs/verification/smart-import-wul-832/analizza.py /tmp/wul832-main-v2
```

La directory di destinazione deve essere nuova. Il modello e i documenti restano locali. L’ambiente Ollama usato nella misura: `OLLAMA_MODELS=/Volumes/Vision/ollama-models`, `OLLAMA_HOST=127.0.0.1:64812`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_GO_TEMPLATE=true`, `OLLAMA_NO_CLOUD=true`, `MLX_METAL_RESIDENCY_REFRESH_INTERVAL_MS=0`, `MLX_RESIDENCY_SET_MAX_PCT=0`. Server a priorità ordinaria, sonda e suite con `nice -n 10`. Avvio ed arresto del banco sono stati eseguiti dalla lane, sempre per PID.

Refs WUL-832. PR: https://github.com/Wulfgardr/mediflow/pull/938.
