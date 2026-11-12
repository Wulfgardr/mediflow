# WUL-832: protocollo decisivo v2

Congelato prima delle nuove inferenze. Corpus SHA-256: `469f876ca016c377b4ca89cf0cc0a543b405a0c7a845a6286f18eef03b985ca9`. I documenti ed i cinque concetti attesi sono identici alla calibrazione v1. Cambiano i semi: base `1672000`, piu indice del paziente per 1000, giro per 10 ed indice del tentativo (indici da zero). Venti richieste per paziente e braccio. La prima corsa di main, con base dei semi 832000, resta conservata come calibrazione e non decide la PR.

## Perche si riparte

La definizione v1 trattava una diagnosi gia in scheda come fonte sbagliata quando il suo nome non compariva nella fonte citata. Il controesempio reale e «Ipercolesterolemia pura», con excerpt letterale «colesterolo LDL 162 mg/dL.» e la fonte che contiene esattamente quel testo. La provenienza dell excerpt e corretta. La v1 ha prodotto 77 segnali nelle proposte accettate, di cui 47 con excerpt letterale nella fonte citata: quei segnali sovrastimano gli errori. Non si usa il risultato v1 per scegliere. Il test del controesempio e rosso con il classificatore v1 e verde con v2.

## Definizioni congelate

**Diagnosi nuova attesa e proposta valida:** come v1, un concetto positivo del corpus, assente da `currentDiagnoses`, riconosciuto dai pattern di `label` o `icdQuery`, contato al massimo una volta per richiesta nella proposta finale accettata dall host. Le richieste rifiutate valgono zero. Denominatore: 20 per paziente, 100 totali. Le altre diagnosi sono elencate separatamente. Una proposta riuscita ha stato `available`, proposta non nulla, `writesPerformed: 0`, `apply: denied`. Non si applica nulla all archivio.

**Fonte sbagliata:** un oggetto di diagnosi, terapia, prestazione o item annidato con almeno una delle seguenti condizioni:

1. `sourceId` inesistente nelle fonti di quel prompt.
2. Excerpt normalizzato che compare letteralmente in un altra fonte ma non in quella citata.
3. Excerpt composto: una sequenza di tre parole/token consecutivi compare in un altra fonte ed almeno un suo numero intero non compare fra i token della fonte citata. Per esempio «150/95 mmHg» con fonte che riporta 150/94, mentre il valore 150/95 e in un altra fonte. Si cercano solo token numerici interi dopo la normalizzazione: questo criterio puo perdere errori, non interpreta unita o equivalenze cliniche.
4. Excerpt che ripete la descrizione esatta o il codice di una diagnosi in scheda, assenti nella fonte citata. Si guarda `evidence`, non il solo nome della diagnosi proposta. Se l excerpt e gia letterale nella fonte citata, questa condizione non si applica.
5. Diagnosi nuova attesa attribuita ad una fonte diversa da quelle fissate nel corpus per quel concetto.

Ogni oggetto conta una volta anche con piu condizioni. Si normalizzano Unicode, accenti, maiuscole, punteggiatura e spazi, senza sostituire parole o numeri. Un excerpt letterale resta una provenienza verificata anche quando il nome della diagnosi non e ripetuto nel documento, salvo la condizione 5 sulle diagnosi attese. La correttezza clinica delle diagnosi, oltre i riferimenti positivi congelati, non e misurata.

**Evidenza non risolta:** ogni excerpt non letterale che non ricade nei casi sopra. Non si dichiara giusto ne sbagliato. La misura delle fonti sbagliate riguarda violazioni di tracciabilita dimostrate con questi controlli, senza trasformare le parafrasi in errori automatici. Si riportano separatamente i non risolti e gli errori grezzi/finali.

## Regola di decisione

Resta la regola di Leonardo: fonti sbagliate in diminuzione e perdita non superiore ad un terzo delle diagnosi nuove. Si usano le 100 nuove richieste per braccio. Sono richiesti meno errori grezzi per 100 richieste e meno errori nelle proposte finali se main ne ha, oppure zero se main e gia a zero. Per le diagnosi si verifica esattamente `3 * nuove_ramo >= 2 * nuove_main`, senza arrotondamenti. Nessun errore del provider e nessuna corsa incompleta puo dare un PASS. I fallimenti dell host restano nel denominatore. Un peggioramento dei non risolti e un limite da rendere visibile, non una prova di fedelta.

## Banco e verifiche

Stesso host capability reale, adapter, router e controllo della v1, con dipendenze sintetiche per consenso/broker/readiness. Stessi documenti e semi corrispondenti nei due bracci. Ollama 0.40.6 su 64812, modello e digest invariati, temperatura 0.4, thinking disattivato. Runtime MLX e PID in `runtime.json`. Nessuna suite completa in parallelo. Le ripetizioni non sono byte per byte deterministiche anche con payload e semi uguali: limite verificato nel confronto secco/main v1. Non si misura UI, GPUI, applicazione o persistenza clinica.

Il classificatore porta controlli positivi e negativi per fonte inventata, fonte scambiata, excerpt composto e citazione corretta di una diagnosi gia in scheda. Il rigioco riusa il precedente script dell import, adattato agli id sintetici di P3-P5. I grezzi v1 e v2 restano distinti e conservati.
