# ADR 0124: JSON bounded per login native e network

Date: 2026-09-07
Status: Accepted

## Problema e contesto

La prima domanda Daybreak sul tree `1d633d98d0a0` rileva letture JSON senza
contatore byte nel login native e nelle route network. Il lettore canonico
`lib/bounded-request-body.ts` esiste gia per il CAS degli allegati. Il proxy
TLS non fornisce una prova di limite e resta fuori da questa modifica.

## Decisione

Riutilizzare il lettore canonico, aggiungendo una modalita esplicita compatibile
con `Request.json()` (UTF-8 con replacement, ultima chiave duplicata prevalente).
Il default strict dei consumer CAS esistenti non cambia. La validazione dei
campi, i gate, scope, capability, sessione e grant restano invariati.

Limiti inclusivi del corpo JSON serializzato, contati in byte UTF-8:

| Superficie | Cap |
| --- | --- |
| POST `/api/auth/native/login` | 65.536 byte (64 KiB) |
| POST `/api/v1/network/pairing-intents` | 65.536 byte (64 KiB) |
| Altre operazioni network che consumano JSON, eccetto allegati | 4.194.304 byte (4 MiB) |
| POST `/api/v1/network/patients/{id}/attachments` | `resolveMaxAttachmentBytes() + 4.194.304` byte |

Il cap allegati usa il limite wire ciphertext gia canonico (25 MiB di default,
override host `MEDIFLOW_ATTACHMENT_MAX_BYTES`) piu 4 MiB per involucro e
metadati: 30.408.704 byte (29 MiB) di default. Conserva il ciphertext al limite
con la serializzazione canonica del client (`JSON.stringify` e
`HomeBaseAttachmentWireUtilities.encodedBody`, senza escape degli slash),
purche il resto della busta rientri nei 4 MiB. Non garantisce whitespace o
escape arbitrari; nessun valore viene normalizzato o troncato. La validazione
separata di `data` conserva i 25 MiB wire e `Attachment payload too large`.
Una configurazione non rappresentabile come cap intero sicuro fallisce prima
di leggere il body; non viene interpretata come unlimited.

Solo il POST allegati prenota uno slot, dopo auth/modalita/capability/sessione
e risoluzione dello scope, prima di leggere header o body. Una sola operazione
puo essere attiva per istanza del modulo server; non esiste coda. Un secondo
POST ammesso dai gate riceve 503 `ATTACHMENT_OPERATION_BUSY` con `Retry-After: 1`,
senza leggere il body. Lo slot copre accumulo, materializzazione, validazione,
servizio asincrono e costruzione della risposta JSON; il `finally` lo libera
solo quando queste operazioni terminano o falliscono. Abort del client durante
il servizio non interrompe il servizio e non libera anticipatamente lo slot.
Un servizio che non termina mantiene lo slot: non introdurre una race che
consenta altre operazioni mentre il lavoro precedente continua.

Solo la lettura allegati ha una scadenza totale di 30 secondi, non rinnovata dai
chunk: timer piu controllo del tempo monotono prima e dopo ogni read. Scadenza
e abort cancellano il reader best-effort, fermano il ciclo prima della
materializzazione e restituiscono rispettivamente 408
`ATTACHMENT_BODY_READ_TIMEOUT` e 400 `ATTACHMENT_BODY_READ_ABORTED`. Timer e
listener sono rimossi al termine della lettura; lo slot si libera dopo l'uscita
del lettore. Non si attende una eventuale cleanup asincrona del trasporto in
`cancel()`: non contiene il ciclo di accumulo o il servizio applicativo.
Gli altri consumer conservano il comportamento precedente, incluso il default
strict. La scadenza e cooperativa con l'event loop, non interrompe lavoro sincrono.

I 4 MiB clinici includono testo, ciphertext, campi strutturati e documento di
validazione FSE. Il transcript gia limitato a 12.000 caratteri entra anche con
escape Unicode (al massimo 72.000 byte per i caratteri UTF-16, piu involucro).
Gli altri campi ispezionati non avevano massimi complessivi: il cap introduce
quindi una restrizione dimensionale esplicita, non una promessa di compatibilita
con ogni precedente input di dimensione arbitraria. Nessun campo viene tagliato,
normalizzato o scartato dal lettore; i payload entro budget passano ai medesimi
validatori e servizi.

Il controllo Content-Length e solo un rifiuto anticipato per valori decimali
validi oltre cap. Header assente, mendace o non valido non evita il contatore
sui chunk. Il chunk che oltrepassa il budget non viene accumulato o decodificato;
il reader viene cancellato best-effort e rilasciato. Il trasporto puo aver gia
allocato/consegnato quel chunk: questo non e un limite alla memoria di Next,
proxy o socket. Lo slot allegati non coordina processi, worker o copie del modulo
e non limita RSS, memoria del trasporto o altri endpoint.

Il superamento restituisce HTTP 413 e JSON stabile
`{"error":"JSON payload too large","code":"JSON_BODY_TOO_LARGE"}` prima dei
catch generici e di ogni servizio dipendente dal payload. Il rifiuto dimensionale
non diventa un tentativo credenziali invalide o il body vuoto del DELETE
ambulatorio. Errori JSON/stream mantengono il percorso precedente della route.

Admission e auth esistenti precedono ogni lettura e controllo header del body.
Il bootstrap pairing conserva l'eccezione senza token di ADR 0038 e il gate di
modalita nel servizio, dopo la lettura bounded; non viene aggiunta authority.

## Alternative e conseguenze

Un solo Content-Length non copre i byte effettivi; un cap globale del proxy
coinvolgerebbe upload estranei; un nuovo parser duplicato creerebbe drift.
Il riuso mantiene una sola implementazione del contatore. Il budget allegati
conserva il wire cap nella busta canonica; lo slot limita le operazioni
applicative simultanee senza promettere una misura o un limite RSS globale.

Impatto contrattuale: cap e 413 sulle operazioni elencate; per il POST allegati
anche cap ridotto, 503 di ammissione e 408/400 di lettura interrotta.
Allineamento OpenAPI e indici nella lane del parent prima della promozione.
Il login native resta fuori dalla slice `/api/v1` ed è descritto qui.
Non dichiarare `no contract impact`.

## Verifica e limite della consegna

Test unitari con stream piccoli e cap ridotti: JSON, byte UTF-8, chunking,
Content-Length, errori e cancellazione. Test delle route con dipendenze fake:
ordine admission/auth, 413 senza servizi downstream, richieste entro cap e
compatibilita del fallback DELETE/login. Nessun server, DB reale, riproduzione
di vulnerabilita, build Next o verifica del bundle distribuito e richiesta da
questa lane. La receipt esterna identifica commit e check effettivamente eseguiti.


## Raccordo C05 diario locale, 26 settembre 2026 (candidato locale)

La decisione specifica nell'[estensione diario di ADR 0015](./0015-audit-taxonomy-minimum-catalog.md#estensione-c05-del-26-settembre-2026--diario-clinico-ordinario)
introduce 4.194.304 byte per le sole sei mutazioni JSON Web/API locale del
diario. E un nuovo tetto per ingressi prima non limitati, non un'estensione
automatica di questa ADR a tutte le route locali. Le due mutazioni del diario
rete conservano il limite gia previsto qui. Il reader canonico e riusato
senza cambiarne semantica; nessun limite di durata/inflight e nessuna promessa
di compatibilita con richieste locali storicamente di dimensione arbitraria.
