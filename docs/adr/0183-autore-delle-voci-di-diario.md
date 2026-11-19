# ADR 0183: Autore delle voci di diario

Data: 2026-11-07. Stato: Accepted.

Le voci ordinarie devono mostrare chi le ha registrate. I metadati clinici
possono contenere un autore dichiarato, ma non attestano l'operatore che ha
salvato la voce. L'audit conserva il riferimento dell'attore, senza il nome
visualizzato nel momento della scrittura.

`entries.recorded_by TEXT` è nullable. Il writer ordinario comune a Web,
API locale v1 e paired legge `users.displayName` dell'attore autenticato nella
transazione IMMEDIATE che salva voce ed audit. Se il nome è vuoto usa lo
username. Il dato resta in chiaro, come `users.display_name` e `users.username`:
è un dato del profilo operativo, non un contenuto clinico cifrato. Nessun nome
entra nei metadati dell'audit. Un attore di sistema resta senza autore.

Lo schema passa da 9 a 10 nell'apertura versionata di ADR 0080, con originale
verificato, DDL nullable e stamp atomico. La riapertura dello schema corrente
valida senza DDL. Nessun backfill: voci storiche, nomi e versioni cliniche
rimangono invariati. Le ricostruzioni dei predecessori v4, v5 e v6 escludono
anche la colonna v10, conservando le impronte canoniche già pubblicate. Il recupero cifrato ammette
anche il predecessore v9 canonico, con una nuova impronta: i backup creati
prima di questo aggiornamento restano recuperabili.
`drizzle/0039_entry_recorded_by.sql` documenta il DDL, senza replay runtime.

Le allowlist delle richieste POST e PUT rifiutano `recordedBy`. Il nome nasce
soltanto sul server, resta immutabile durante modifiche, eliminazione,
ripristino e retry idempotenti e non cambia se cambia il profilo. `createdAt`
resta l'orario di registrazione assegnato dal normalizzatore server, distinto
da `date`, che è la data clinica.

Il writer SOAP headless, i suoi metadati cifrati, snapshot, digest e ricevute
rimangono invariati. Non passa dal writer ordinario e lascia `recorded_by`
null. Anche il ripristino conserva i valori salvati senza attribuire all'utente
che importa le voci precedenti. Le proposte intelligenti restano soggette alla
revisione ed alla registrazione esplicita nei percorsi già previsti.

OpenAPI 1.57.0 aggiunge `recordedBy`, facoltativo, nullable e di sola lettura,
a `EntryDetail`. Le letture Web e v1, comprese liste e dettaglio paired,
espongono lo snapshot. Il contratto `native/contracts/entry-recording.v1.json`
comprende nome, null e campo assente. I DTO Swift e Rust lo leggono senza
obbligare i vecchi host ad inviarlo. Swift lo conserva dopo la decifratura.
La resa delle GUI native e la lettura SQLite diretta Apple restano fuori
da questa PR: devono usare `recordedBy` e `createdAt` dei DTO HTTP.

Nel diario Web lo stato registrato mostra il punto asciutto e
«Registrata da <nome> il <data> alle <ora>». Senza nome mostra soltanto
«Registrata il <data> alle <ora>». Un orario assente resta assente, senza
sostituirlo con la data clinica. Bozze, firme, metadati illeggibili e stati
sconosciuti conservano le rispettive distinzioni. La provenienza dichiarata
nei metadati non diventa il nome dell'operatore. Lo stesso testo alimenta
il diario globale.

La PR #862 modifica lo stesso blocco `twin.registration` in
`components/timeline-entry-card.tsx`. Nel conflitto va conservata la chiamata
a `patientDiaryRegistration(entry)` per lo stato registrato, mantenendo gli
altri cambiamenti di composizione della #862. Il banco sintetico verifica
l'autore restituito dal server per ogni voce di riferimento appena creata.
Le fixture precedenti restano storiche e non ricevono nomi aggiunti dopo.

## Rettifiche dalla 0.9.1

Il writer del diario salva, nella stessa transazione della modifica e dell'audit,
il titolo e il testo sostituiti delle voci diverse dalle scale. Ogni riga ha per
identità l'evento di audit e per chiave univoca la coppia nota e versione
sostituita. Ora e nome dell'operatore provengono dal server. La data clinica e
l'autore della prima registrazione restano proprietà della nota. Una modifica
del solo stato di cestino lascia lo storico com'è. Un conflitto di versione
lascia invariati nota, audit e storico.

La versione SQLite 17 crea `entry_revisions` vuota. Il primo testo conservabile
è quello presente quando avviene la prima rettifica dopo l'aggiornamento.
Versioni già sovrascritte prima dell'aggiornamento sono indisponibili. Per un
campo legacy in chiaro si conserva il solo riferimento alla rettifica. I campi
protetti vengono copiati come buste cifrate e aperti dai client con la chiave
già usata per la nota corrente.

La scheda Web locale e GPUI Mac su loopback espongono lo storico su richiesta
per un singolo paziente e una singola nota attiva. GPUI usa il normale ambito
ambulatoriale della sessione paired. Le liste, i report, FHIR, gli agenti e il
diario via LAN continuano a leggere i contratti correnti. Nello storico
l'operatore e l'ora su una versione precedente indicano la rettifica che l'ha
sostituita. La versione vigente riporta l'ultima rettifica del testo.

Lo storico è sospeso alla cancellazione logica e riappare al ripristino della
nota o del paziente. La cancellazione definitiva della nota elimina le
versioni tramite la relazione SQLite. Il backup portabile v1 aggiunge la
collezione `entryRevisions`, con gli stessi campi cifrati e i relativi eventi
nell'audit. Il formato resta v1. Le edizioni precedenti del lettore rifiutano la
nuova collezione, mentre il nuovo lettore accetta backup precedenti con storico
vuoto. Il kit di recupero conserva il database v17 intero e ammette il
predecessore v16, che viene migrato. Il ritorno a un runtime precedente richiede
l'originale pre-migrazione. Le rettifiche posteriori a quella copia richiedono
un runtime compatibile con v17.
