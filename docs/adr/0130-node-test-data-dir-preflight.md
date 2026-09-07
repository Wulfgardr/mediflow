# ADR 0130: preflight del data-dir nei test Node

Data: 2026-09-07. Stato: accettato per il candidato locale WUL-691.

## Problema e opzioni

Un test con import statico di db-server può inizializzare il database prima
che la fixture imposti MEDIFLOW_DATA_DIR. Il default applicativo non è una
fixture e non deve essere scelto implicitamente dal launcher dei test.

Un temporaneo automatico per invocation evita il default, ma viene condiviso
tra worker concorrenti e test annidati: non garantisce isolamento tra fixture
e introduce ownership e cleanup impliciti. Un guard globale in db-server
estenderebbe il contratto del runtime oltre questa correzione.

## Decisione

scripts/run-strip-types.mjs rifiuta invocation con --test quando
MEDIFLOW_DATA_DIR è assente, vuoto o composto soltanto da spazi. Il preflight
precede discovery/probe del runtime, loader, glob e target. Errore stabile
MEDIFLOW_TEST_DATA_DIR_REQUIRED, exit 2. Non esiste fallback automatico.

Il chiamante fornisce una directory sintetica e ne possiede il cleanup dopo
la fine dei figli. Un valore esplicito non vuoto resta identico nell'ambiente,
anche se relativo; il launcher non lo apre, valida, crea o cancella. I test
annidati ereditano il valore, mentre NODE_TEST* continua a essere rimosso
per consentire al runner figlio di avviare i propri worker. Una fixture può
ancora sostituire il data-dir prima dei propri import dinamici.

## Conseguenze e verifica

Anche suite pure lanciate con --test devono indicare il data-dir. L'assenza
non viene tollerata perché un import transitivo può diventare DB-backed.
La presenza della variabile non certifica che il percorso sia sintetico:
la scelta esplicita rimane responsabilità del chiamante. Le invocation senza
--test e node --test diretto non acquisiscono questa protezione. Il preflight
non è una sandbox contro test che cancellano o sostituiscono l'ambiente.

Test su processi figli verificano mancato probe/import in assenza del valore,
apertura DB soltanto su fixture esplicita, ambiente e codice di uscita
preservati, runner annidato e cleanup posseduto dalla fixture. Nessun database
reale è necessario. Questa prevenzione non chiude incidenti storici.
