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
