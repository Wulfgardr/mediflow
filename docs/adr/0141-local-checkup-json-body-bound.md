# ADR 0141: limite JSON per POST e PUT checkup locali

Date: 2026-09-30

Status: Proposed

## Problema e contesto

PR360 ha reso atomici mutazione e audit dei checkup, rinviando limiti locali
e anomalie dell'involucro. I quattro POST/PUT ordinari Web e v1 locale usano
ancora `Request.json()` senza un contatore byte. Il limite paired di
[ADR 0124](./0124-bounded-native-network-json.md) non si applica implicitamente
agli ingressi locali; [ADR 0055](./0055-network-checkup-write-boundary.md)
conserva il contratto paired distinto.

## Decisione proposta

Introdurre un NUOVO massimo inclusivo di **4.194.304 byte (4 MiB)** per il
corpo JSON serializzato di queste sole operazioni:

- `POST /api/checkups`
- `PUT /api/checkups/{id}`
- `POST /api/v1/patients/{id}/checkups`
- `PUT /api/v1/patients/{id}/checkups/{checkupId}`

Il checkup contiene identificativi, titolo, data, stato, provenienza, versione
e note, che possono essere ciphertext `ENC:`. Non trasporta allegati o dati
binari. Il budget segue quello gia esplicito per il checkup paired e consente
note e metadati sostanziali, contando anche involucro, whitespace ed escape.
I contratti locali non fissavano un massimo aggregato per titolo/note: questa
e una restrizione di compatibilita nuova, non una garanzia per ogni input
storicamente ammesso o per tutti i client esterni. Non si tronca alcun campo.

Riutilizzare `readBoundedJsonBody` con semantica `request-json`: UTF-8 con
replacement e ultima chiave duplicata prevalente. Il helper checkup richiede
un oggetto non nullo e non array. JSON malformato, corpo assente, null, array,
scalare, stream fallito o abort prima/durante la lettura restituiscono 400
`{"error":"Invalid JSON body"}`. Un superamento restituisce 413
`{"error":"JSON payload too large","code":"JSON_BODY_TOO_LARGE"}`.
L'abort usa il segnale della richiesta; nessun timer, timeout o limite inflight
viene introdotto. Un abort dopo la lettura non interrompe il servizio sincrono.

I gate esistenti di sessione/token e risoluzione attore precedono lettura di
header e corpo. `Content-Length` decimale valido oltre cap consente un rifiuto
anticipato; header assente, falso o invalido non elude il contatore sui chunk.
Il limite conta byte effettivi prima della decodifica. La cancellazione del
reader e best-effort e non limita allocazioni di trasporto, Next, proxy o RSS.

Dopo un oggetto entro cap, schemi e normalizzatori esistenti restano gli stessi:
note ENC, stato, date (incluse differenze Web/v1), ID e campi sconosciuti non
vengono riparati o filtrati dal helper. Nei PUT la versione precede la ricerca
esistente e il 404 continua a precedere la validazione degli altri campi.
CAS, controllo padre, membership e audit IMMEDIATE restano invariati. Un
rifiuto dell'involucro non avvia alcuna mutazione o audit clinico.

## Alternative e conseguenze

Solo `Content-Length` non coprirebbe stream chunked o header mendaci; un parser
nuovo duplicato introdurrebbe drift. Il reader canonico mantiene il contatore
comune senza modificare il default strict degli altri consumer.

La proposta cambia il contratto locale v1: massimo, 400 e 413 devono essere
allineati nella specifica OpenAPI prima della promozione. La patch OpenAPI e
coordinata separatamente per evitare sovrapposizione con PR372; non dichiarare
`no contract impact`.

## Verifica e residui

Prove sintetiche del helper e dei quattro route: sotto/al/sopra cap, multibyte,
chunking, header assente/falso/invalido, abort prima/durante read e stream
fallito; read-back SQLite di righe/versioni, padre, membership e audit su ogni
rifiuto. Le prove esistenti di audit FAIL/IGNORE e CAS devono restare verdi.
Smoke HTTP dei route interessati e lint/typecheck/build sono associati alla
revisione candidata, senza dati clinici reali o browser interattivo.

DELETE locale e `parseClinicalDeleteBody`/`request.text()` restano un residuo
esplicito. POST/PUT paired restano invariati, con il limite gia previsto da
ADR 0124. Questa slice non conclude WUL-720 complessiva o i parent WUL-718/719.
