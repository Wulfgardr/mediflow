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
anche la colonna v10, conservando le impronte canoniche già pubblicate.
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
