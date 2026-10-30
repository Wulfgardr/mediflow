# ADR 0042: nuova anagrafica da documento con review esplicita e persistenza prudente delle terapie

Date: 2026-04-03  
Status: Accepted

## Problema

MediFlow aveva gia:

- OCR locale e analisi documentale reviewable
- autofill prudente delle sole diagnosi con codice ICD esplicito
- create-flow della nuova anagrafica con precompilazione dei campi base

Mancava pero un passaggio intermedio esplicito per il caso piu delicato:
creare una nuova scheda paziente partendo da un documento clinico senza
trasformare in modo opaco problemi e terapie estratti in dati strutturati.

Il rischio era doppio:

- precompilare troppo presto dati clinici ancora incerti o incompleti
- perdere il valore operativo delle terapie documentali, relegandole solo a
  nota libera anche quando il documento le supporta in modo abbastanza forte

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti, diff
  piccoli e niente scorciatoie architetturali.
- [SECURITY.md](../../SECURITY.md) impone output AI non fidato finche non
  reviewato e nessun import clinico silenzioso da free text.
- [ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md)
  governa lo smart import reviewable sul profilo paziente gia esistente.
- ADR 0027 (private) governa il
  contratto condiviso di estrazione per le lane documentali locali.

Questa decisione non apre nuovi endpoint `/api/v1` e non modifica il filone
native congelato.

## Opzioni

1. Continuare con precompilazione diretta nel form della nuova anagrafica,
   limitando la review ai soli campi testuali base.
2. Inserire una review esplicita field-by-field prima della creazione scheda,
   con riconciliazione locale ICD/AIFA e persistenza strutturata solo per le
   terapie sufficientemente confermate.
3. Tenere tutto come nota documentale da riconciliare dopo il salvataggio,
   evitando qualsiasi scrittura strutturata nel create-flow.

## Trade-off

- Opzione 1:
  - Pro: meno passaggi UI.
  - Contro: rischio di import troppo opaco; diagnosi e terapie non abbastanza
    governate.
- Opzione 2:
  - Pro: mantiene il controllo umano, sfrutta matching locale gia disponibile e
    riduce il lavoro post-creazione quando la terapia e abbastanza supportata.
  - Contro: aggiunge una review intermedia e logica di default-selection piu
    prudente.
- Opzione 3:
  - Pro: rischio minimo di write strutturati impropri.
  - Contro: spreca casi buoni gia abbastanza affidabili e lascia troppo carico
    manuale dopo il create.

## Decisione

Adottiamo l'opzione 2.

Nel create-flow `Nuova Anagrafica`:

- il documento viene prima analizzato e arricchito localmente
- problemi e terapie candidate vengono riconciliati in locale contro ICD-11 e
  catalogo farmaci AIFA/ATC
- l'operatore passa sempre da una review esplicita prima di applicare i default
  al form
- le diagnosi senza codice esplicito restano reviewable e non entrano in modo
  silenzioso
- una terapia viene persistita come record strutturato solo se:
  - resta selezionata in review
  - e marcata `active`
  - ha almeno nome farmaco e posologia utili
- i casi incompleti, incerti, non attivi o manual-only possono restare come
  nota documentale di supporto invece di forzare una `therapy` strutturata

## Conseguenze

Diventa piu semplice:

- creare una nuova scheda partendo da un documento senza perdere review e
  auditabilita operativa
- salvare subito le terapie piu solide senza doverle re-inserire a mano
- distinguere meglio tra terapia corrente, transizione e materiale solo
  documentale

Diventa piu difficile:

- trattare qualsiasi menzione farmacologica come terapia gia confermata
- usare il create-flow come scorciatoia per import silenziosi da testo libero

## First Thin Slice

1. Arricchire l'output documentale per la nuova anagrafica con candidati
   reviewable per problemi e terapie.
2. Introdurre una review draft esplicita prima del salvataggio.
3. Persistire come `therapies` solo le terapie confermate e sufficientemente
   supportate.
4. Aggiungere test dedicati e aggiornare la documentazione canonica del flusso.

## Fuori Scope

- nuovi endpoint `/api/v1` o parity native su questo create-flow
- import automatico di terapie manual-only senza match o posologia minima
- promozione del materiale documentale non confermato a dato strutturato senza
  review operatore

## Incremento C-6 del 30 ottobre 2026: comando di dominio, senza nuovi ingressi

Il primo incremento di `lib/patient-document-create-command.ts`, nella PR #736,
non aveva chiamanti HTTP, Web, MCP o GPUI. L'ingresso successivo descritto sotto
non completa C-6. `PdfImporter` conserva il blocco prima della persistenza
e gli endpoint legacy restano `410`.

### Ingresso nativo del 30 ottobre 2026

`POST /api/auth/native/patient-document` aggiunge un ingresso nominato al
comando comune. Richiede sessione nativa autentica di amministratore,
ambulatorio corrente e grant paired di creazione pazienti e scrittura
documenti, ricontrollati nella transazione. Una sessione Web non lo usa.
Non modifica `/api/v1`, gli endpoint legacy o il comportamento Web.

`stage` riceve un solo PDF selezionato nel client nativo, fino a 10 MiB,
con originale base64 e nome/percorso `ENC:`. Il client genera una chiave AES-256 casuale per il file e cifra i byte PDF con nonce casuale di 12 byte. Avvolge la chiave con la master key e un secondo nonce casuale di 12 byte. `data` usa il formato versionato:

```text
ENC2:<wrap_iv_b64>:<wrapped_key_b64>:<iv_b64>:<cipher_b64>
```

Base64 RFC 4648 canonico; i due ciphertext comprendono il tag GCM di 16 byte. L’involucro della chiave ha 48 byte e AAD UTF-8 `mediflow.attachment.file-key.v2`; il payload cifra direttamente i byte PDF, con AAD `mediflow.attachment.data.v2`. Nome e percorso mantengono `ENC:`; nessun altro campo accetta ENC2. Non cambiano schema, dati o scrittori preesistenti.

Aggiornamento del 30 ottobre 2026: **il client cifra, il server verifica**. `stage.source` ha esattamente `name`, `path`, `original`, `data`, `fileKey`. `fileKey` è un array JSON mutabile di 32 interi 0–255: il client conforme vi inserisce la chiave del file, non la master key; il server non può distinguerle dal solo valore ricevuto. Il server verifica GCM e uguaglianza byte per byte col PDF ricevuto, prima di AnyDoc, OCR o creazione della fonte. Rifiuta payload illeggibili, chiavi errate e originali diversi. Nei percorsi gestiti azzera i chunk HTTP e il buffer assemblato dopo il parsing, l’array della chiave e i buffer del verificatore prima dell’estrazione, anche in errore. Non conserva intenzionalmente la chiave né la riporta in log, errori o ricevute. L’azzeramento riguarda i buffer posseduti dal codice: non garantisce la cancellazione delle stringhe JS prodotte da JSON o delle copie interne a V8 e OpenSSL. Un arresto del processo può impedire la pulizia.

Il server non apre l’involucro sotto la master key. Un involucro falso può rendere il file illeggibile, ma non sostituirlo con un PDF differente da quello verificato. `execute` e `receipt`, anche dopo riavvio, restituiscono `outcome: applied` insieme a `attachmentReadback: client-verification-required`: attestano la scrittura, non l’apertura. Il client GPUI rilegge `attachments.data`, apre l’involucro con la master key e confronta i byte con lo snapshot originale prima di presentare un esito completo; se fallisce mostra la verifica incompleta e conserva il comando. Il recupero senza snapshot locale segue l’appendice GPUI. Il produttore `sealPatientDocumentFile` è esercitato da un client sintetico attraverso stage, revisione, execute e rilettura effettiva; il vettore condiviso è `native/contracts/attachment-file-golden.v2.json`.

Non sono ammessi URL, percorsi da aprire, identificativi di allegati della chat, candidati, opzioni di parser o provider.

L'host copia i byte, controlla firma PDF, codifica e dimensione, esegue AnyDoc
e prosegue con l'OCR locale soltanto per `image_or_scan`. Custodisce in RAM
lo snapshot cifrato immutabile, legato alla sessione e al solo ambulatorio
di creazione. Logout, scadenza entro cinque minuti o annullamento impediscono
la pubblicazione o l'uso successivo; i buffer dei byte vengono azzerati.
Non viene creato un paziente provvisorio per poter estrarre il testo.

Il testo estratto è destinato esclusivamente al client nativo autenticato.
Non c'è ancora Smart Import per il nuovo scope: i candidati sono vuoti e
ogni estrazione riuscita resta `ambiguous` e `uncertain`. Tutti i campi
inseriti richiedono quindi `correct`, anche in presenza di etichette
apparentemente univoche. Un'estrazione fallita non apre la revisione e
restituisce soltanto il dettaglio d'errore del contratto AnyDoc.

`preview`, `execute`, `receipt` e `revoke` delegano al comando comune:
nessun writer o deposito aggiuntivo; la ricevuta nativa distingue la verifica di apertura ancora richiesta. L'esecuzione usa
il PIN nativo, poi rilegge ricevuta, paziente attivo, appartenenza
all'ambulatorio e fonte prima di rispondere `applied`. Il recupero senza
stato RAM conserva `unknown`; il ritiro non lo converte in `retired`.
La ricevuta del comando comune espone soltanto l’esito; la sola route nativa aggiunge i riferimenti verificati descritti nell’appendice GPUI. Touch ID non è collegato a questo ingresso.

Le prove chiamano l'handler autenticato e SQLite sintetico reale; non provano
un percorso desktop installato. Il chiamante GPUI e il collegamento al deposito
opaco Rust sono descritti nell’appendice. Mancano avvio dalla chat e avviso
del compositore, Smart Import e uso Web dello stesso writer. C-6 resta aperta.

Il comando riceve due porte interne dell'host, mai ricostruite da JSON: l'owner
della sessione e dello scope «nuovo paziente», e la fonte preparata corrente.
Il punto di composizione nativo collega gli owner reali, controlla
upload e tipo sui byte originali e produce evidenze AnyDoc/OCR prima di
emettere la fonte. Il comando non esegue estrazione né accetta URL o file ID
della chat. Le prove del comando usano una porta fonte sintetica; non
qualificano estrattori o custodia degli originali.

La revisione ammette solo nome, cognome, codice fiscale e data di nascita,
ciascuno approvato o corretto esplicitamente. Il chiamante host deve marcare
come ambigui nomi senza etichette separate e identità multiple, anche quando
un parser restituisce due stringhe apparentemente complete. Per esempio
«Paziente: Rossi Mario» non autorizza l'approvazione della separazione
Rossi/Mario: il comando richiede la correzione esplicita di entrambi i campi.
Un errore OCR impedisce la creazione; una fonte incerta richiede la correzione
manuale di ogni campo inserito. Questo incremento non inserisce diagnosi,
terapie, prescrizioni o testo documentale in note cliniche.

Il controllo duplicati confronta codice fiscale oppure nome e cognome,
anche con schede archiviate/eliminate e fuori dallo scope di destinazione.
Non restituisce identificativi delle corrispondenze. Richiede la scelta
distinta `create-separate`; non aggiorna né unisce la scheda esistente.
Una variazione delle corrispondenze dopo la revisione blocca il commit.

Il ciclo comune `createNativeChatWriteApprovals` mantiene le soglie di cinque
minuti dalla vista e trenta secondi dalla revisione, con consumo prima della
conferma. Il servizio richiede all'host conferma e verifica corrente dentro
la transazione, anche dopo le scritture. Non implementa biometria o ripieghi:
questa porta va collegata alla conferma autorizzata, senza simulare Touch ID.
Il ritiro della sessione elimina gli stati privati tramite l'owner; la
scadenza elimina i riferimenti RAM senza dichiarare un ritiro durevole.

Paziente, membership, fonte cifrata con currentness emessa dall'host e i due
audit obbligatori committano nella stessa transazione SQLite `IMMEDIATE`.
L'audit `patient.created` ha `eventId = commandId` e metadato validato
`patientDocumentCreate`: soli riferimenti opachi di comando, generazione,
ambulatorio, paziente e fonte. Il ritiro usa `patient.create.retired`, con
paziente/fonte nulli. La chiave primaria dell'audit e la rilettura sotto lo
stesso lock rendono durevoli idempotenza e ritiro. Anche il riuso di una fonte
già consumata viene rifiutato. Non nasce un secondo deposito o enum degli
esiti: il servizio restituisce `applied`, `retired` o `unknown`, compatibili
con il `ChatWriteResolution` comune. La ricevuta comune non contiene campi paziente,
filename, percorso, testo o identificativo della fonte. La sola risposta
nativa può aggiungere i riferimenti verificati secondo l’appendice GPUI.

Un processo riavviato legge l'audit prima di cercare la conferma RAM. Senza
ricevuta, `unknown` resta incerto e non rinnova il comando. Il ritiro di un
comando sconosciuto resta `unknown`; il servizio non attribuisce un esito a
uno stato perso. Le ricevute seguono l'audit esistente nei backup: la
conservazione non concede autorità nella generazione successiva al restore.
Il deposito opaco e il recupero nativo esistenti restano da collegare a questo
comando; nessun comando paziente viene ancora aperto dalla chat.

Le prove `patient-document-create-command.test.ts` esercitano SQLite,
autorità paired e verifica PIN reali su dati sintetici. Le prove di processo
uccidono il processo durante l'inserimento della fonte o dopo il commit e
rileggono dal nuovo processo. La conferma di queste sole fixture di crash è
simulata: non è una prova aggiuntiva di autenticazione. Il rapporto di consegna conserva separatamente lo script delle mutazioni
e i log: lo script modifica temporaneamente le sorgenti e non viene eseguito
insieme alle suite ordinarie.

## Appendice: client GPUI e riferimenti nativi, 30 ottobre 2026

La finestra GPUI acquisisce un solo PDF, tramite selettore o trascinamento,
fino a 10 MiB. Il client produce ENC2 con una chiave casuale per file custodita
in `Zeroizing`; l'involucro sotto la master e il payload usano gli AAD e il
vettore condiviso descritti sopra. Tutti i campi sono inseriti dal medico con
`correct`; nessun candidato è precompilato. L'anteprima locale conserva la
bozza quando si torna alla revisione. Il PIN nativo autorizza il comando;
la biometria è esplicitamente non disponibile per questa operazione.

Questa modifica cambia la risposta della sola route nativa. Dopo le verifiche
correnti di operatore, dispositivo abbinato, generazione di archivio,
ambulatorio, paziente attivo e allegato, `execute`, `receipt` e `revoke`
restituiscono, solo per `applied`, `patientId` e `attachmentId` insieme a
`attachmentReadback: client-verification-required`. Non aggiungono nome file,
percorso, testo, anteprima o campi del paziente. `unknown` e `retired` restano
privi di riferimenti. Il comando comune conserva la ricevuta opaca: chat e
MCP non ricevono questi identificativi.

Il journal di audit esistente può includere `pairedClientId`, un identificativo
opaco del dispositivo già autenticato. Nessuna nuova tabella o deposito è
introdotto. La verifica di proprietà riusa operatore, generazione e ambulatorio
del comando comune e aggiunge il confronto del dispositivo. Un journal senza
quel vincolo non autorizza la divulgazione dei riferimenti nativi.

Una nuova sessione autenticata e sbloccata dello stesso proprietario può
soltanto rileggere la ricevuta o richiedere la revoca idempotente. Deve
corrispondere per operatore, dispositivo, archivio e ambulatorio. Non può
riprendere `preview` o `execute`; tali operazioni richiedono la lavorazione
in RAM della sessione originale. Un comando sconosciuto resta `unknown`.
Se la lavorazione originale è ancora in RAM, la revoca confronta lo stesso
proprietario usato dalla ricevuta e ritira l’approvazione della sessione
originale. Non trasferisce l’approvazione alla nuova sessione. Senza stato RAM
né esito durevole, il ritiro conserva `unknown`.

GPUI riusa `CommandReferences` e `ChatWriteResolution`, conservando soltanto
il codice opaco prima della conferma. Alla riapertura avvisa e offre la
rilettura. `applied` non completa il controllo: il client rilegge l'allegato
indicato dalla ricevuta e apre ENC2 con la master. Verifica tipo, dimensione,
firma PDF e, quando ancora disponibile, uguaglianza con lo snapshot originale.
Se l'apertura fallisce, mostra scrittura applicata ma verifica incompleta e
conserva il comando. Dopo un crash lo snapshot non è persistito: l'apertura
verifica GCM sul documento individuato dalla ricevuta durevole, senza inventare
un confronto con byte locali non più presenti.

Ritiro, errore, blocco e cambio di contesto svuotano PDF, testo estratto,
campi e PIN dalla UI; nessun ritiro incerto elimina il riferimento. Restano
riservate a Leonardo la prova Touch ID sul client reale e la qualificazione.
