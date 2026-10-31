# ADR 0173: Autorità e provenienza del ripristino portabile

Stato: Proposed. Review indipendente richiesta prima del merge.

Il checksum del formato portabile verifica l'integrità, senza autenticare la
sorgente. Un file di terzi può contenere attestazioni attive, audit e marcatori
che dichiarano un'origine. Nessuna dichiarazione del file conferisce autorità
clinica o determina l'origine delle righe già presenti nella postazione.

Prima della sostituzione, la route Web richiede la credenziale corrente dello
stesso amministratore, con derivazione della passphrase, verificatore, limiti
dei tentativi, generazione e sessione esistenti. La credenziale accompagna
soltanto quella richiesta. Le attestazioni di revisione importate attive
tornano inattive; le revoche locali restano terminali. SOAP mantiene ADR 0097.

## Provenienza assegnata dalla postazione

Lo schema SQLite 7 introduce `portable_import_origins`: chiave composta
`kind, ref`, riferimento all'evento locale d'importazione e divieto di UPDATE
e DELETE. La tabella è autorità locale, non una collezione del portabile.
Il ripristino la scrive nella stessa transazione dei dati, esclusivamente
per gli audit e i comandi terapia nuovi. Un evento o comando già presente e
identico è riusato senza mutarne la provenienza. Collisioni discordanti
continuano a bloccare prima della sostituzione. Non esiste una API per
popolare l'indice dalle dichiarazioni del file.

I tredici campi audit e tutti i campi del ledger restano identici, come
richiesto da Q-5. Gli eventi `backup.portable.imported`, `backup.audit.imported`
e `backup.therapy-command.imported` restano tracce leggibili nello storico.
I loro `eventType`, `subjectRef` e `requestId`, anche se prodotti da un altro
archivio durante un passaggio A → B → A, non sono usati per attribuire origine.
Solo le chiavi dell'indice locale governano le letture. Una ripetizione non
riclassifica una riga già presente.

L'upgrade segue ADR 0080: originale verificato prima della modifica, DDL e
stamp confermati insieme, validazione senza DDL agli avvii successivi. Nessun
backfill dai marcatori storici, perché non autenticano il produttore. Non si
ricostruisce retroattivamente la provenienza di importazioni anteriori a
questo indice. Il recupero completo autenticato conserva l'indice insieme al
resto dello snapshot; il portabile non lo esporta e non può ripristinarlo.
I predecessori canonici 4, 5 e 6 mantengono le proprie impronte immutabili e
sono controllati prima della migrazione di recupero.

## Letture e presentazione

Il read model espone `origin: local | imported`. La lista ordinaria legge i
locali; `origin=imported` legge separatamente gli importati. I marcatori
tecnici non occupano la lista ordinaria, salvo filtro esplicito. Il riepilogo
usa due campioni indipendenti, ciascuno limitato a 200 con troncatura propria:
superfici, attori, esiti e tipi principali riguardano soltanto i locali.

Le ricevute terapia propagano l'origine dell'indice, anche per chiusure e
rifiuti senza audit. Il controller non presenta un risultato importato come
registrazione di questa postazione, neppure quando lo stato attuale coincide.

Web, GPUI e Swift richiedono prima del download conferma delle categorie
leggibili in chiaro e della destinazione protetta. Formato portabile v1 e
claim congelati sulla cifratura restano invariati. Il contenuto clinico del
file continua a sostituire quello attuale dopo la conferma: serve una fonte
fidata, perché il checksum non ne autentica l'origine.
