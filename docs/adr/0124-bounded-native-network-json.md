# ADR 0124: JSON bounded per login native e network

Date: 2026-09-07
Status: Accepted (candidato locale WUL-669; integrazione da verificare)

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
| POST `/api/v1/network/patients/{id}/attachments` | `6 * resolveMaxAttachmentBytes() + 4.194.304` byte |

Il cap allegati usa il limite wire ciphertext gia canonico (25 MiB di default,
override host `MEDIFLOW_ATTACHMENT_MAX_BYTES`); il fattore 6 ammette anche la
rappresentazione JSON completamente escaped degli ASCII del ciphertext. Il cap
totale di default e 161.480.704 byte (154 MiB). I 4 MiB aggiuntivi coprono
involucro, metadati e whitespace; la validazione separata di `data` conserva il
limite originale e la sua risposta `Attachment payload too large`. Il vecchio
precheck Content-Length della route, che applicava il solo cap `data` anche
all'involucro, e sostituito dal medesimo budget totale usato per i chunk.
Nessun limite multipart o globale del proxy viene introdotto.
Una configurazione non rappresentabile come cap intero sicuro fallisce prima
di leggere il body; non viene interpretata come unlimited.

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
proxy o socket, ne un limite globale di concorrenza o tempo.

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
e volutamente maggiore per conservare il wire cap esistente e gli escape.

Impatto contrattuale: nuovi cap e 413 sulle operazioni elencate. Il parent deve
allineare OpenAPI e indici nella propria lane prima della promozione; questa
lane non modifica quei file. Non dichiarare `no contract impact`.

## Verifica e limite della consegna

Test unitari con stream piccoli e cap ridotti: JSON, byte UTF-8, chunking,
Content-Length, errori e cancellazione. Test delle route con dipendenze fake:
ordine admission/auth, 413 senza servizi downstream, richieste entro cap e
compatibilita del fallback DELETE/login. Nessun server, DB reale, riproduzione
di vulnerabilita, build Next o verifica del bundle distribuito e richiesta da
questa lane. La receipt esterna identifica commit e check effettivamente eseguiti.
