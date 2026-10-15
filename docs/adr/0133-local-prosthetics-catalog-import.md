# ADR 0133: Repertorio protesica locale da fonte dichiarata

Date: 2026-09-07
Status: Candidate — WUL-693, revisione del coordinatore richiesta

## Confine

Il servizio nominato `ProstheticsCatalog` gestisce soltanto un repertorio locale,
caricato dall'operatore. Nessun fetch, file privato predefinito, attribuzione ISO,
validazione normativa, eleggibilità o aggiornamento automatico delle prescrizioni.
La fonte deve essere verificata dall'operatore. Il template è interamente sintetico.
Nessuna tabella clinica viene modificata dall'import.

## Contratto CSV v1

UTF-8 rigoroso, BOM iniziale facoltativo, virgola, LF o CRLF, quoting CSV con
virgolette doppie raddoppiate. Vietati newline nelle celle, controlli e spazi
esterni; nessuna normalizzazione silenziosa. Header esatto e ordinato:
`codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine`.
I primi sei campi sono obbligatori; le date possono essere vuote oppure date
calendario `YYYY-MM-DD`, con inizio non successivo alla fine. Non se ne deduce
validità prescrittiva. Limiti: 2 MiB, 20.000 righe, 2.000 caratteri per cella;
metadati e codice massimo 200 caratteri, nome file massimo 200. Catalogo massimo
100.000 voci e 100.000 ricevute, poi nuovi import rifiutati senza cancellazioni.

Un file rappresenta una sola combinazione codice_sistema/versione/fonte/ambito,
identica in tutte le righe. `codice_sistema` è il nome della codifica dichiarato
dalla fonte, non una certificazione ISO. Identità della voce: codice_sistema,
codice, ambito. Qualsiasi duplicato (anche identico) blocca l'intero file.
Versione, descrizione, fonte e date aggiornano solo quella voce. Codici assenti
restano. Anteprima con errori per riga/colonna, conteggi totale/validi/invalidi/
duplicati, inserimenti/aggiornamenti/invariati, campione e SHA-256 dei byte.

## Protocollo e persistenza

Seguire ADR 0127: preview senza scritture, proof HMAC effimero di processo con
scadenza 30 minuti, legato a hash/contratto/revisione/operatore. Commit richiede
stessi byte e consenso esplicito; rivalida, verifica CAS e applica merge più
ricevuta in transazione SQLite IMMEDIATE. Retry idempotente restituisce la
ricevuta originale. Riavvio invalida proof, non catalogo o ricevute: rilettura
status/ricerca e nuova anteprima sono il recupero; una risposta persa non implica
fallimento. Errori e conflitti non alterano il catalogo. La revisione include
righe e ultima operazione, senza confondere replay con stato corrente.

Route web `/api/prosthetics/catalog/{preview,commit,status,search,template}`;
nessun contratto v1/native/MCP nuovo. Sessione web owner-bound, verifica prima e
dopo await/lettura, prima di pubblicare, sotto lock prima delle scritture e
prima del termine della transazione. Body JSON bounded con lettore canonico,
abort richiesta/sessione e deadline 30 secondi. Riuso del lettore bounded e della
resource authority di ADR 0127, senza duplicare il ciclo di vita. Envelope JSON:
preview `{sourceName, base64}`, commit aggiunge `{proof, acceptSubset: true}`;
base64 canonico degli stessi byte, nessun percorso/URL o parametro ulteriore.
`acceptSubset` è il consenso agli otto campi di questo repertorio. Ricerca `q`
massimo 200 caratteri, risultati massimo 50 e indicatore di troncamento;
diagnostica massimo 200 errori con conteggio completo, campione massimo 10.
Tutte le risposte sono `no-store`. Nessun record nei log.

Due tabelle additive nel database principale: `prosthetics_catalog_entries` e
`prosthetics_catalog_receipts`, con schema/migrazione espliciti e bootstrap
allineato. Catalogo e ricevute entrano nel backup JSON v1 web/schedulato e nel
restore atomico esistente. Backup precedenti senza entrambe le collezioni:
checksum originale verificato, poi normalizzazione a liste vuote. Nessun JSON
laterale o database nascosto; rifiutare schema/provenienza non supportati.

## Consumo e UI

Repertori espone template, caricamento, anteprima, conferma e rilettura stato.
Controlli di almeno 44 px e raggi 12 px. Ricerca autenticata bounded, con fonte,
versione, ambito e codifica visibili. La selection view data conserva
`codeSystem`, `code`, `description`, `source` e
`version`. Il form esistente ha `isoCode`: un codice generico non può alimentarlo.
Questa slice consente consultazione con namespace visibile e copia esplicita
della sola descrizione. Nessuna assegnazione paziente, nessun richiamo al writer
e nessuna riscrittura di prescrizioni già salvate. Il raccordo
con il form prescrizione è del coordinatore: questa lane consegna componente e
contratto della selezione senza modificare il writer o il manager esistente.

## Verifiche e promozione

Solo fixture inventate e Node 24 con directory dati temporanea prima degli
import. Parser, duplicati, errori, CAS/retry, rollback intermedio, revoca, reload,
backup storico/corrente e contratto selezione; lint/typecheck mirati. Nessuna
build pesante, sorgente reale, provider o prova normativa. Il candidato locale
richiede verifica e integrazione del coordinatore prima di qualsiasi claim di
release.


Verifica candidata locale del 7 settembre: 19 test della slice e 56 regressioni
backup superati; typecheck, lint mirato, schema-drift, schema-writers,
never-regress, claims e diff-check superati. La prova Chromium usa il componente
e le route reali su SQLite sintetico, con trasporto intercettato e senza listener.
Prova flusso, copia della sola descrizione, target 44 px e raggio 12 px; non
attesta il layout completo Next/Tailwind, il form prescrizione o la distribuzione.

## Emendamento 2026-10: fonti personali e originali

L'identità include ora la fonte. Ogni fonte ha id stabile, nome, ente/ambito,
versione, data facoltativa, hash dell'ultimo file importato e note. La migrazione
deriva una fonte per combinazione fonte/versione/ambito esistente e ricodifica
le identità senza modificare ricevute storiche o prescrizioni.

Il CSV UTF-8 accetta separatore virgola o punto e virgola e mappatura esplicita
per indice delle otto colonne. Il proof lega anche mappatura e metadati fonte.
Nessuna estrazione AI e nessuna dipendenza Excel aggiunta: esportare XLSX in CSV.

Gli originali sono bytes base64 in una tabella SQLite separata dai pazienti,
nel database sotto la data dir. Metadati, hash, dimensione e bytes sono atomici;
i documenti sono immutabili e aggiuntivi, massimo 25 MiB ciascuno e 100 MiB
complessivi. Nessun percorso o URL viene accettato. Il nome segue attachment-path.
Download autenticato, no-store, attachment e nosniff, hash e dimensione verificati
prima della risposta. Catalogo, documenti e snapshot di provenienza restano in
chiaro; le protezioni del database locale non equivalgono a cifratura.

Il writer salva uno snapshot additivo di voce, fonte e riferimenti agli originali
solo su scelta esplicita dell'operatore, verificata nella transazione clinica
contro la revisione attesa. Una scelta obsoleta è un conflitto senza scritture.
Sul writer una precondizione del catalogo fallita risponde 412; i conflitti 409
di versione o identificativo restano invariati per i client esistenti.
La descrizione clinica continua a seguire il percorso cifrato esistente. Lo
snapshot di provenienza è in chiaro e non cambia aggiornando il repertorio.
Il DTO network rimane additivo. Nessun import scrive prescrizioni.

Backup web e schedulato includono fonti, originali e snapshot. Le generazioni
precedenti restano verificabili col checksum originale e sono migrate soltanto
nel restore atomico. Nessuna promessa di validità normativa o completezza.

Il payload standalone del backup schedulato include anche i validatori puri di
mappatura/snapshot e attachment-path, con pin delle sorgenti e tracing Next
espliciti. La chiusura runtime non aggiunge dipendenze ed è provata in un
processo isolato senza accesso al database.
