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
