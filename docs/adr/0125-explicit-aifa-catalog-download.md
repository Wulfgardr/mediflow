# ADR 0125: aggiornamento esplicito del catalogo AIFA

Data: 2026-09-07. Stato: Proposed, per l'implementazione locale richiesta nella
0.8.6. L'approvazione della release richiede le verifiche elencate sotto.

## Problema

MediFlow importa già un CSV AIFA in una transazione, ma richiede selezione del
file e metadati manuali. L'utente chiede un aggiornamento con un clic, usando
la fonte ufficiale. Una preferenza di avvio o una visita alle impostazioni non
devono scaricare dati né sostituire un catalogo.

## Decisione

Aggiungere un'azione esplicita «Aggiorna da AIFA» nella pagina Repertori. Il
server autenticato scarica esclusivamente
`https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv`, collegato dalla
[pagina ufficiale delle liste](https://www.aifa.gov.it/liste-dei-farmaci).
Questo file contiene confezioni, denominazioni, principi attivi in forma
compatta e codici ATC. AIC identifica la confezione; ATC è la classificazione.
Il primo incremento conserva lo schema `drugs` attuale: non dichiara di aver
importato le tabelle separate dei principi attivi o delle descrizioni ATC.

L'azione è un POST locale dedicato, sotto la stessa autenticazione e protezione
delle scritture catalogo esistenti. Non accetta URL, credenziali, intestazioni
o percorsi dal chiamante. La richiesta esterna è un GET HTTPS senza cookie,
auth, query paziente o dati del database. Nessun redirect automatico, proxy
configurabile dalla UI, telemetria o aggiornamento periodico.

Il download ha un limite di 100 MiB effettivamente letti, una scadenza di
180 secondi e cancellazione collegata alla richiesta. Rifiuta status diversi
da 200, body assente, dati vuoti, contenuto non CSV, encoding UTF-8 non valido
e CSV non conforme. Il limite non dipende dal solo Content-Length. Un solo
download per processo può essere attivo; richieste aggiuntive ricevono uno
stato esplicito di operazione in corso.

Prima del download si rileva lo stato del catalogo. Prima della sostituzione
si ricontrollano sessione, cancellazione e lo stesso stato all'interno della
transazione. Una modifica concorrente del catalogo impedisce il rimpiazzo
con risposta 409; non viene risolta automaticamente. Il controllo include
anche cataloghi legacy senza manifest, attraverso un'impronta deterministica
dei record e del manifest, senza nuovi campi paziente o migrazioni.

Il parser e il writer sono quelli dell'importazione AIFA. Per il download
automatico, righe invalide impediscono la sostituzione; non si presenta come
completo un catalogo importato parzialmente. Restano le regole esistenti di
normalizzazione e deduplicazione AIC. Il catalogo e il manifest sono scritti
nella stessa transazione. Errore, interruzione, scadenza, perdita della sessione
o conflitto lasciano intatti i dati precedenti. Il caricamento manuale rimane
disponibile e mantiene il proprio contratto.

Il manifest conserva URL effettivo fisso, data di acquisizione osservata,
SHA-256 dell'intero file, numero di record e data di importazione. La versione
è un identificativo locale di acquisizione, basato sulla data e sull'impronta;
non inventa una versione ufficiale. Last-Modified, se mostrato, è soltanto
metadato dichiarato dal server. Nessuna copia del CSV entra nel repository.

La UI distingue scaricamento, verifica e catalogo disponibile; dopo il successo
rilegge lo stato e mostra fonte, data, conteggio, versione e collegamento alle
[condizioni AIFA](https://www.aifa.gov.it/copyright). I dati delle liste sono
descrittivi e provvisori secondo AIFA: la presenza di una confezione non
certifica disponibilità, rimborsabilità o appropriatezza prescrittiva.

## Alternative

- Mantenere solo il file manuale: non soddisfa il percorso richiesto.
- Accettare un URL libero: amplia inutilmente il confine di rete.
- Scaricare a ogni avvio: rende impliciti rete e sostituzione dei dati.
- Integrare subito tre feed: richiede un modello dati aggiuntivo non necessario
  per rendere ricercabili i campi AIC, ATC e principio attivo già supportati.

## Verifiche obbligatorie

Fixture sintetiche: importazione e ricerca AIC/ATC/principio attivo, metadati
coerenti; errori di rete/formato/dimensione, cancellazione, sessione scaduta,
conflitto concorrente e rollback di una scrittura fallita; nessuna chiamata
esterna senza autenticazione o su sola lettura. Il trasporto nei test unitari
usa risposte sintetiche e non modifica i limiti della produzione.

Poi un'acquisizione reale dalla fonte fissa in un database di prova isolato,
con hash completo e ricerca dopo riavvio. Il risultato non viene trasferito
alle altre piattaforme: macOS, Windows e Linux richiedono la propria prova
del percorso condiviso. Nessuna pubblicazione prima di review e CI.

## Emendamento 2026-10

Decisione di Leonardo del 15 ottobre 2026: controllo remoto e applicazione con
un clic, senza sostituzioni automatiche. Sostituisce il precedente divieto di
controlli periodici, limitatamente ai metadati del catalogo pubblico AIFA.

Il gate AI per il testo clinico resta chiuso e non viene riutilizzato per i
repertori. `network.mode` governa la LAN e non autorizza Internet. Non esiste
un consenso generale per il download dei repertori: `aifaNetworkAccess` è
quindi un opt-in dedicato, disattivato quando assente o diverso da `enabled`.
È modificabile dalle impostazioni autenticate; `MEDIFLOW_NETWORK_DISABLED`
lo blocca quando presente con valore diverso da `0`. Una disabilitazione è
ricontrollata prima della richiesta e durante download e sostituzione.

All'apertura di Repertori o delle impostazioni Repertori, un endpoint locale
autenticato verifica soltanto l'URL fisso con HEAD. Timeout: 8 secondi;
redirect rifiutati, nessun fallback GET. La visita non scarica il CSV. Nessun
cookie, credenziale, ricerca o dato clinico viene inviato ad AIFA. Il controllo
non è un job in background: occorre aprire una delle due aree. Verifica,
download e importazione manuale condividono un'esclusione per processo.

`aifaCatalogRemoteState`, separato dal manifest, conserva ETag, Last-Modified,
Content-Length, checkedAt ed esito della verifica. La prenotazione del tentativo
avviene con transazione IMMEDIATE: anche errori e riavvii conservano il limite
di una richiesta ogni 24 ore per archivio. Un'operazione già in corso non
consuma il tentativo. Un processo terminato durante HEAD può lasciare la
verifica non disponibile fino alla scadenza delle 24 ore. I metadati mancanti
o non confrontabili non sono dichiarati «nessuna variazione».

Il manifest v1 accetta tre campi HTTP opzionali, compatibili con i manifest
preesistenti senza migrazione SQL. Il confronto privilegia ETag, poi
Last-Modified; Content-Length da solo non identifica una versione. Un catalogo
senza tali metadati può essere aggiornato esplicitamente per acquisirli. La
data di scarico locale è distinta dalla data pubblicata da AIFA.

«Aggiorna ora» riusa il POST esistente. Se disponibili, i validatori del file
locale alimentano If-None-Match e If-Modified-Since. Un 304 legato a tali
validatori conserva il catalogo, verifica lo snapshot e registra l'esito.
Il progresso è una lettura locale dei byte ricevuti e del Content-Length,
non una stima del completamento della validazione. Il limite di 100 MiB e
la scadenza di 180 secondi restano validi; una dimensione finale diversa da
Content-Length rifiuta il file.

Per importazione remota e manuale sono richieste le colonne AIC,
denominazione, ATC e principi attivi. I valori non presenti nella singola riga
restano null. La fixture sintetica segue le 15 colonne della fonte osservata.
FORNITURA e STATO_AMMINISTRATIVO non sono conservati nello schema attuale;
il feed non contiene fascia e prezzo, che rimangono null. Non si promettono
copertura di rimborsabilità, disponibilità o appropriatezza.

Un catalogo con meno del 90% degli AIC unici correnti viene rifiutato nella
transazione, prima della cancellazione. Una conferma esplicita può superare
solo questo controllo. La conferma è legata a SHA-256 del file e snapshot
locale: un file differente o una modifica concorrente richiedono una nuova
conferma. Per il download viene riacquisito il CSV; non si conserva una copia
temporanea fuori dal database. Non vengono superati i controlli di struttura,
colonne, dimensione, sessione o audit.

L'evento `reference_data.aifa.updated` segue ADR 0015. Per le sostituzioni
riuscite conserva attore, superficie, modalità remota/manuale, manifest prima
e dopo ed eventuale riduzione confermata nella stessa transazione IMMEDIATE.
Un audit mancante o ignorato annulla catalogo e manifest. I rifiuti delle route
sono tracciati separatamente senza testi clinici o eccezioni di rete grezze.
La pulizia e il caricamento legacy non sono nuovi percorsi di acquisizione
AIFA e restano fuori da questa estensione dell'audit.

Le prove sono sintetiche: HEAD 200/304, scadenza, redirect, metadati assenti,
egress negato, debounce persistente, CSV reale nelle intestazioni, troncamento,
riduzione e rollback audit. Non attestano un aggiornamento live del catalogo
AIFA o l'installazione su una postazione clinica.
