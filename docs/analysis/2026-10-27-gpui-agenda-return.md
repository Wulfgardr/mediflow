# Agenda → scheda → ritorno (G-7b, verticale)

Aprire una scheda dall'Agenda deve consentire di tornare alla stessa riga,
con intervallo di date, ricerca, selezione, scroll e focus conservati.
La lettura dell'Agenda e quella dei nomi dei pazienti restano indipendenti:
un errore nel secondo elenco non deve diventare «nessun controllo».

## Modello degli stati

- Agenda: inattiva → caricamento → risultati oppure vuoto, errore,
  indisponibile, accesso negato o dato illeggibile. Dopo cinque secondi la
  lettura mostra l'attesa lunga. Una lettura ritirata non resta in caricamento.
- Apertura della scheda: conserva il contesto Agenda e ritira le richieste
  precedenti; scheda e sezioni mantengono i rispettivi stati tipizzati.
- Ritorno: ritira le letture della scheda e ripristina il contesto Agenda.
  I risultati conservati sono indicati come obsoleti, senza attribuire loro
  una conferma di attualità; la rilettura è esplicita e conserva il contesto.
- Cambio ambulatorio, blocco e uscita dalla verticale ritirano il contesto.
  Una bozza aperta impedisce il ritorno secondo la protezione esistente.

## Sottrazione

Si elimina per questa verticale la conversione precoce degli errori in stringhe,
il reset indiscriminato della ricerca e dello scroll al ritorno, e il focus
anonimo delle righe. Si riusano ReadLoad, i controlli di autorità e ScrollTarget.
Non si aggiungono cache su disco, API, writer o autorità di navigazione parallele.

Questa unità non chiude G-7: Diario globale, Repertori, Analisi e gli altri
residui restano nel rispettivo perimetro del contratto 0.9.1.
