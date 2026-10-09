# ADR 0139: Bound dei body JSON patient esistenti

Date: 2026-09-30
Status: Proposed

## Decisione

WUL-720, coorte congelata: POST /api/patients e /api/v1/patients;
PUT/DELETE dei rispettivi /{id}; POST /api/v1/network/patients e
PUT/DELETE /api/v1/network/patients/{id}. Nessuna dipendenza da PR365.

Le sei scritture locali senza tetto introducono 4.194.304 byte inclusivi,
come le tre paired gia governate da ADR 0124. Il budget comprende l'intera
busta UTF-8, whitespace e ciphertext. E una nuova restrizione locale:
i payload precedentemente arbitrariamente grandi ricevono 413, senza troncamento.

Dopo gli stessi gate di ammissione, il reader canonico bounded conta i chunk
anche senza Content-Length o con header mendace/non valido. Un header decimale
oltre soglia permette il diniego anticipato. Risposta 413:
`{"error":"JSON payload too large","code":"JSON_BODY_TOO_LARGE"}`.
JSON malformato, null, array, scalari e letture interrotte ricevono 400
`{"error":"Richiesta non valida."}`. Create e paired delete correggono
cosi il precedente percorso 500 per envelope invalidi.

Il segnale Request cancella best-effort una lettura pendente. Non si introduce
un timeout o cancellazione del commit gia iniziato. Il reader rilascia il lock;
nessun chunk oltre soglia viene accumulato. Il trasporto puo aver gia allocato
il chunk: non si promette un limite RSS globale o del proxy.

Conservati Request.json semantics (replacement UTF-8, ultima chiave duplicata),
normalizzatori, campi compatibili, ENC, scope, versioni, audit e tombstone.
Tutti i dinieghi avvengono prima delle mutazioni e dell'audit clinico.
Il POST locale resta fuori dalla specifica stabile secondo la policy corrente;
PUT/DELETE v1 dichiarano il tetto e 413 nella specifica.

## Verifica e rollback

Fixture sintetiche SQLite sulle nove operazioni: sotto/al/oltre limite,
chunked e header assente/mendace/non valido, JSON invalidi, abort pendente,
righe/versioni/membership/audit invariati al diniego, valori ENC preservati.
Rollback della sola coorte prima della promozione; nessun replay o rimozione audit.

## Identità create (C05, 2026-10-09)

Le tre superfici POST patient validano l'ID originale prima del fallback:
solo l'omissione genera un UUID; un ID fornito non stringa o vuoto dopo trim
riceve 400 `{"error":"Invalid id"}`. Le stringhe opache valide sono conservate
esattamente, inclusi spazi periferici; il trim serve solo alla validazione.
Questa restrizione corregge il precedente fallback silenzioso per ID invalidi;
i client devono omettere `id` per richiedere la generazione, senza inviare null
oppure stringhe vuote. Non cambia l'identità dei record già esistenti.

Una collisione create-only riceve 409 `{"error":"Patient create conflict"}`
anziché 500, senza snapshot o identità esistente nella risposta. Il lookup
avviene nella transazione IMMEDIATE dopo l'ammissione di autorità/scope e
la destinazione; nessun paziente, membership o audit viene modificato.
La risposta 201, versione iniziale e audit required restano invariati.
POST locale resta fuori dalla specifica stabile; lo schema paired documenta
la restrizione e il 409. Restore e purge/ricreazione restano fuori coorte.


## Destinazione create locale (C05, 2026-10-09)

Il POST v1 locale valida `ambulatoryId` originale: omissione e null mantengono
la creazione senza membership; un valore fornito non stringa o vuoto dopo trim
produce 400. Una stringa opaca valida viene conservata senza trim.
Nel create Web legacy e v1, un target ambulatoriale inesistente produce 404
`Ambulatory not found`, verificato nella transazione prima del lookup dell'ID
paziente duplicato. Il diniego non modifica pazienti, membership o audit.
L'ammissione paired, fixed-preview e create-context resta invariata. Il POST v1
locale resta fuori dalla superficie OpenAPI stabile; non si introduce un endpoint.
