# ADR 0179: Identità del paziente senza codice fiscale

Data: 2026-11-05. Stato: Accepted. Estende ADR 0177.

MediFlow registra anche persone assenti dai registri nazionali e installazioni
`core` fuori dall’Italia. L’identificativo corrente ha tipo `cf`, `stp`, `eni`,
`passport`, `other` o `none`. Nome e cognome sono necessari; con `none` serve
anche data esatta o anno di nascita stimato. Il tipo non prova l’identità civile.

Lo schema SQLite passa da 7 a 8 attraverso l’apertura versionata di ADR 0080,
con originale verificato e transazione IMMEDIATE. Le colonne sono additive:
`identifier_type`, `birth_date_precision`, `birth_year`, `identifier_history`.
I valori esistenti restano identici: prefisso STP o ENI seguito da 13 cifre
assegna il tipo corrispondente, gli altri valori non vuoti diventano CF e
quelli vuoti diventano `none`. Una nascita presente diventa
esatta, altrimenti sconosciuta. Non si rivalidano o cancellano valori storici.
`tax_code` resta NOT NULL: per `none` contiene la stringa vuota, che significa
assenza di identificativo e permette ai vecchi client di leggere una stringa.

Le scritture con `identifierType` dichiarato validano formato, giorno e controllo del CF, omocodia inclusa;
STP ed ENI richiedono il prefisso e 13 cifre. Documento estero e altro
identificativo accettano al massimo 128 caratteri, senza controlli invisibili.
La nascita è esatta, stimata al solo anno oppure sconosciuta. L’età dalla data
esatta considera il compleanno; anno dichiarato e CF valido producono una
stima esplicita. STP, ENI e documenti non producono mai un’età dal codice.
La scelta del secolo nel CF resta una stima, non una data attestata.

Il cambio identificativo usa la stessa scheda, versione attesa e audit delle
altre modifiche. Lo storico locale `identifier_history` conserva tipo e valore
precedente e successivo, versione, istante e autore nella stessa transazione.
L’audit redatto collega la modifica mediante `identifier-history:<versione>`:
non contiene il valore identificativo. Lo storico ha la stessa protezione a
riposo dell’anagrafica attuale, in chiaro nel database locale; non è esposto
nelle proiezioni paired. Non si introduce una garanzia di cifratura del DB.
I duplicati confrontano tipo e valore negli ambulatori condivisi. CF, STP ed
ENI sono normalizzati in maiuscolo; documenti e altri valori conservano le
maiuscole dichiarate. `none` non partecipa al controllo.

OpenAPI v1 passa da 1.54.0 a 1.55.0 con campi facoltativi additivi
`identifierType`, `birthDatePrecision`, `birthYear`. `taxCode` resta una stringa
presente, anche quando vuota. I client precedenti ignorano i campi nuovi;
una risposta vecchia è decodificabile dai modelli Apple aggiornati.

Le richieste senza `identifierType` conservano il contratto precedente di
`taxCode`, senza aggiungere la validazione per tipo. Il server conserva la
stringa ricevuta e inferisce STP o ENI soltanto dal prefisso seguito da
esattamente 13 cifre; altrimenti assegna `cf`. Il writer paired mantiene
anche il controllo precedente di stringa non vuota. I form e i CSV legacy
conservano il controllo precedente di 16 caratteri alfanumerici ASCII.
Un CSV senza tipo compilato non invia come dichiarato il tipo inferito.

Una modifica che lascia invariati tipo e valore salvati non applica la nuova
validazione all’identificativo storico, anche quando il client li rimanda.
Il form confronta l’identificativo con il proprio snapshot iniziale, così
la modifica delle note resta salvabile anche con un CF storico errato.
Un cambio effettivo con tipo dichiarato applica la validazione per tipo;
un cambio senza tipo conserva il contratto legacy e aggiorna il tipo inferito.
CAS, controllo dei duplicati, storico e audit atomico restano applicati.
La compatibilità non rende valido un CF errato e non consente di ricavarne l’età.

FHIR R4 usa `urn:oid:2.16.840.1.113883.2.9.4.3.2` per il CF e i seguenti
namespace applicativi, dichiarati qui senza rivendicare profili nazionali:
`urn:mediflow:identifier:stp`, `urn:mediflow:identifier:eni`,
`urn:mediflow:identifier:foreign-document`, `urn:mediflow:identifier:other`.
Il documento estero non dichiara un paese emittente non disponibile.
Con `none` non si emette `Patient.identifier`. La sola nascita stimata usa la
precisione annuale di `Patient.birthDate`, senza inventare giorno e mese.
SISS ammette contesto identificato solo con CF, STP o ENI; il menu generale
resta disponibile. Questo non attesta interoperabilità con servizi regionali.
La redazione AI copre STP/ENI e valori noti di tutti i tipi; il gate di uscita
resta chiuso secondo ADR 0033 e 0077.

Il CSV mantiene le sei colonne storiche; può aggiungere, in coda e insieme,
`tipo_identificativo`, `precisione_nascita`, `anno_nascita_stimato`.
Tipi e precisioni usano i valori API. Una riga `none` lascia vuoto
`codice_fiscale` e compila la data oppure l’anno stimato.
