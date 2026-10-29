# Lettera ad ARIA

**BOZZA NON INVIATA**, 29 ottobre 2026. Nessuna richiesta di attivazione,
credenziale, adesione o ambiente di prova. Destinatari da verificare da
Leonardo prima di qualsiasi invio. Questa bozza raccoglie i punti ancora
aperti e non attesta un nuovo contatto o una risposta istituzionale.

Oggetto: MediFlow, chiarimenti sui percorsi Ente e Software House per PRREG e certificati di malattia

Buongiorno,

stiamo preparando la valutazione documentale delle possibili integrazioni
SISS di MediFlow, con priorità prescrizioni e certificati di malattia.
Al momento manteniamo il solo passaggio manuale al portale regionale e
lavoriamo su contratti sintetici. Non abbiamo scelto se procedere come Ente
o Software House e non chiediamo l'attivazione di servizi.

Per valutare entrambe le strade chiediamo i seguenti chiarimenti e i
riferimenti ai documenti applicabili.

1. Quali adesioni, accordi e passaggi di qualificazione sono previsti nelle
   due vesti? Una Software House senza Ente aderente può registrare e
   qualificare il prodotto? Chi firma e chi autorizza gli scenari?
2. Per ciascuna veste, quali identità, certificati e subscription servono per
   PRREG e GCM? Come si rende disponibile a una Software House senza Ente
   un operatore virtuale di ruolo 56? Quali componenti client sono richiesti,
   e l'Helper è supportato anche su iPhone e iPad?
3. Per un MMG in studio singolo quale `idStruttura` è previsto? Come si censisce
   e abilita `appl`? Per il ruolo 6 quali varianti del passaggio GUI sono
   ammesse, compresa quella con invio dei dati completi senza schermate di
   compilazione? Manteniamo fermo il divieto documentato di `mod=WS` per
   MMG/PLS: chiediamo di precisare il percorso GUI consentito.
4. Potete indicare gli schemi correnti PRREG e l'elenco completo degli stati
   di elaborazione, con scadenze, correlazione e regole per esito incerto?
   Per la versione 1.5, come vanno serializzati i nuovi flag e il codice ASL
   del titolare? Quale fonte prevale per `FlagStampaIniziali`, previsto in
   PRSC 2026 e indicato come non usato in GSSC 8.16 p. 59?
5. Per GCM, quali identità, subscription/scope, XSD e versioni di metodo sono
   applicabili oggi tramite API Manager? Qual è il circuito attuale di prova
   per certificato ordinario, rettifica e annullo, con quali identità
   sintetiche e collegamento ai controlli nazionali? Quali regole correnti
   disciplinano titolarità, finestre temporali e riconciliazione dei protocolli?
6. Quali piani e verbali di collaudo, criteri di ammissione alla produzione,
   condizioni per aggiornamenti, assistenza ed escalation valgono nelle due
   vesti? Chi comunica sospensioni e revoche e quali effetti hanno su
   credenziali, versioni già qualificate e pratiche dall'esito incerto?
7. Come possibile servizio successivo valutiamo SIAP: come si assegna
   `idSender`, quali tracciati correnti vanno adottati e quali circuiti di
   prova e riscontri finali sono disponibili a Ente e Software House?

Dalla lettura dell'API Manager abbiamo già acquisito il flusso OAuth con
codice dopo autenticazione dell'operatore, il percorso `/oauth2/` e il fatto
che i due nomi di integrazione identificano lo stesso ambiente. Non chiediamo
di riaprire questi chiarimenti; restano da definire gli accessi effettivamente
ammissibili per i servizi e i soggetti indicati.

Sono sufficienti indicazioni e riferimenti alle procedure: eventuali richieste
formali o attivazioni saranno oggetto di una decisione successiva.

Cordiali saluti,

Leonardo

## Riferimenti della bozza

Domande e fonti per codice, versione, data e pagina sono nella
[matrice dei prerequisiti](lombardia-services-and-prerequisites.md).
WUL-760 registra il contatto precedente e il sollecito del 28 ottobre;
questa bozza non ripete né prova un invio. Nessun originale regionale allegato.
