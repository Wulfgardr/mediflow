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
  Parte una sola rilettura collettiva locale nell’intervallo applicato. La copia
  resta visibile con ricerca, selezione, scroll e focus conservati. L’elenco
  annuncia una sola volta «Aggiornamento in corso», anche senza corrispondenze
  al filtro. Da cinque secondi mostra fase e tempo trascorso usando le righe
  del ViewState comune, anche nel nome accessibile dell’elenco, come richiede
  [Punto d’inchiostro, Stati di una vista](../design/punto-inchiostro/01-specifica.md#stati-di-una-vista).
  Se la lettura fallisce o viene ritirata, lo stato resta a livello
  di elenco; «Rileggi» compare solo quando il tentativo è ammesso. Nessun retry
  automatico, nessuna marcatura ripetuta sulle righe.
- Risposta della rilettura: la selezione resta sulla stessa riga, anche se
  l’ordine cambia. Se la riga non è più visibile, si sceglie quella più vicina
  per data e poi per posizione, oppure nessuna se non restano risultati.
  La riconciliazione usa l’id del controllo e, quando la ricerca dipende dai
  nomi, attende entrambe le letture riuscite, in qualunque ordine arrivino.
  Conserva le righe precedenti per scegliere il ripiego solo sul filtro completo.
  L’elenco annuncia il ripiego. Non si inventano orari di aggiornamento.
- I retry di Agenda e nomi riguardano soltanto la lettura interessata e non
  ritirano quella riuscita. I comandi degli stati globali ricevono il focus
  senza sottrarlo agli editor attivi.
- La riga intera apre la scheda con clic o Invio, come dichiara il nome
  accessibile, con bersaglio minimo di 44 punti. A 1200 punti paziente,
  controllo e stato sono sulla stessa riga, con data a destra; a 390 punti
  sono impilati. Non c’è un secondo link «Apri scheda».
- Cambio ambulatorio, blocco e uscita dalla verticale ritirano il contesto.
  Una bozza aperta impedisce il ritorno secondo la protezione esistente.

## Sottrazione

Si elimina per questa verticale la conversione precoce degli errori in stringhe,
il reset indiscriminato della ricerca e dello scroll al ritorno, e il focus
anonimo delle righe. Si riusano ReadLoad, i controlli di autorità e ScrollTarget.
Non si aggiungono cache su disco, API, writer o autorità di navigazione parallele.

Questa unità non chiude G-7: Diario globale, Repertori, Analisi e gli altri
residui restano nel rispettivo perimetro del contratto 0.9.1.
