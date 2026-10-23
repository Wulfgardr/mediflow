# Nucleo locale delle operazioni CU

CU-1a consegna il protocollo e il nucleo dell'esecutore previsti dall'[ADR 0162](./adr/0162-local-computer-use-executor.md), che resta **Proposed**. Le prove usano dati inventati e un adapter simulato su HTTP loopback. La verticale specialistica PRREG su portale sintetico appartiene a CU-1b: CU-1 rimane incompleta fino all'accettazione di entrambe. Nessun servizio istituzionale, client desktop o uso clinico è qualificato da questa consegna. La modalità 2 non è implementata.

## Confine remoto

Il profilo candidato ha un solo tool, `mediflow.local_operation.v1`, distinto dal profilo di sola navigazione. `open` richiede di continuare nella superficie locale; non crea una pratica. Dopo la selezione locale l'host pubblica un riferimento casuale di sessione. `resume` richiede la riapertura locale della stessa operazione; non esegue compilazione o atto. `status` restituisce soltanto uno stato generico.

L'unico risultato applicativo è `{schema:"mediflow.local-operation.v1",status,ref?}`. Gli stati ammessi sono `continue_in_mediflow`, `local_processing`, `local_result_available`, `unavailable`. `local_result_available` invita alla consultazione locale e non attesta il successo dell'atto. Nome della procedura, paziente, valori, ricevuta e motivazione della sospensione rimangono locali.

Il server costruisce l'intera risposta JSON-RPC. Handshake MCP `2025-11-25`, nome/versione server, catalogo del singolo tool ed errori sono statici. Nessuna risorsa, prompt, notifica di avanzamento, `_meta`, immagine, widget o messaggio libero. Gli ID sono interi tra 0 e 1.000.000; gli altri ID sono rifiutati senza eco. Frame massimi 4 KiB, 64 messaggi per processo, una richiesta IPC pendente, 32 richieste applicative per binding, intervallo minimo 250 ms, 16 riferimenti pubblicati per binding. Il codice non usa valori clinici per scegliere ID, riferimenti o budget.

Questi limiti riducono il polling e le superfici di uscita. Non rendono costanti latenza e sequenza dei messaggi: restano inferenze da uso, frequenza, contesto della chat e strumenti alternativi dell'host. La garanzia riguarda **i valori nel canale MediFlow misurato**, non l'intero Mac, l'anonimato o i registri interni del provider. Input sensibili digitati dall'utente nella chat sono fuori da questo filtro.

## Composizione locale e porte fidate

`createLocalOperationHost` in `lib/local-operation/host.ts` compone il servizio, il journal cifrato, la lettura corrente dei pacchetti territoriali e la porta AIP del figlio. Riceve dal processo fidato:

- connessione corrente dell'archivio, contesto autenticato, chiave dell'archivio sbloccato e orologio;
- risoluzione del piano dai servizi locali, conferma dell'esatto piano nella superficie fidata e invalidazioni del contesto;
- adapter della superficie posseduta e richieste di apertura/ripresa della UI locale.

Il factory verifica la generazione effettiva nel database e legge `readTerritorialPacks` dall'host; non usa capacità dichiarate o memorizzate dal client. `attachChild` registra solo il comando remoto sopra AIP. `publish` è una funzione dell'host, non un metodo MCP. Alla chiusura del figlio vengono distrutti riferimenti e autorità; nessuna approvazione o chiave entra nel canale.

Il punto di composizione deve essere unico per superficie dell'adapter. La porta di invalidazione deve notificare cambio di sessione, paziente, pratica, account, dati, intervento umano e capacità. Il servizio rilegge comunque contesto e capacità prima di ogni richiesta e dopo gli `await`. Un adapter reale deve anche fermare il traffico di fondo e applicare il guard prima di ogni dispatch. Queste porte sono provate con un host simulato: CU-1b deve collegare superficie fidata, sorgenti del piano e portale sintetico, senza sostituire la conferma nativa con un booleano proveniente dalla chat.

`scripts/local-operation-mcp-stdio.mjs` è l'entrypoint candidato, con IPC ereditato nel modo `local_operation_inherited_child_ipc_v1`. Senza parent autorizzato restituisce indisponibilità. Non è registrato nei plugin distribuiti o nel launcher ordinario e non amplia `mediflow-local-ui`.

## Autorità, contenuto e adapter

Il riferimento `lo_` ha 128 bit casuali e resta in RAM del binding. Non è una capability. La capability locale è un oggetto riconosciuto per identità dal servizio e lega installazione, generazione dell'archivio, sessione/client, medico, paziente, pratica, operazione, piano esatto e revisione territoriale. Il piano comprende versioni di contratto, adapter, UI, catalogo e fonti, campi classificati e destinazioni. Durata massima cinque minuti, limitata dalla sessione; approvazione massima due minuti, monouso e legata anche alla revisione durevole. Revoca, completamento e riavvio non ripristinano le vecchie autorità.

Il piano viene validato e congelato prima di essere consegnato all'adapter. Ogni valore deve avere una fonte/versione presente nel piano; non si deducono valori mancanti. Identità, pratica, account, UI, revisione umana e contenuto vengono riletti prima della compilazione e dell'atto. Campi non classificati bloccano il passo. Le destinazioni sono vincolate a origine, percorso esatto, metodo e fase: una destinazione di atto non è utilizzabile durante la preparazione.

`AdapterContext` dà solo identità dell'operazione, tentativo, segnale di arresto e guard locali. Nessun database o writer è consegnato all'adapter. Un passo alla volta possiede la superficie; un contesto trattenuto dopo il passo è inutilizzabile. Nel passo finale è ammesso un solo dispatch di atto. Il contratto dell'adapter richiede controllo di redirect, frame, richieste di pagina e traffico di fondo; il simulatore prova il meccanismo, non il contenimento di un browser reale o di un adapter malevolo.

L'atto automatico richiede `finalAct: protected` e un adapter che garantisca il confronto atomico del contesto e del contenuto presso il destinatario. Un clic generico non soddisfa questa condizione. Negli altri casi il servizio conserva `awaiting_manual_act`, cede la superficie e riconcilia soltanto. Modifiche nel passo manuale richiedono `reviewManualContent` nella superficie fidata; non concedono un nuovo atto automatico.

## Journal, esito e recupero

Il journal è una voce riservata `localOperationJournal.v1` nelle impostazioni dell'archivio esistente; nessun secondo database. Tutti i canali generici di scrittura delle impostazioni la negano. Il payload è cifrato e autenticato con AES-256-GCM, IV casuale e contesto di versione autenticato. La chiave di 32 byte deve essere fornita dall'host sbloccato: il componente non crea, salva o recupera chiavi da variabili d'ambiente.

Il servizio conserva identificativi interni, impronta del piano, stato, revisione, tentativi, possibilità dell'effetto, motivazione locale e ricevuta. Non conserva riferimenti remoti, capability o prove di approvazione. I valori del piano rimangono nei servizi locali che ne possiedono le fonti; `resolvePlan` deve recuperarne la versione pertinente. Il journal ammette al massimo 1.000 operazioni e non elimina quelle esistenti per liberare spazio.

CAS, salvataggio e audit `local_operation.changed` condividono una transazione SQLite `IMMEDIATE`. La scrittura è riletta e un audit rifiutato o ignorato causa rollback. L'evento contiene solo revisione e codici di stato/fase; note, valori e ricevute restano nel payload cifrato. Il controllo territoriale viene ripetuto nel writer operativo.

`attempt_started` ed `effectPossible` vengono scritti prima del comando esterno. Un timeout, una risposta persa o il recupero di un tentativo interrotto richiedono riconciliazione della stessa operazione. Il nucleo non offre un reinvio dopo un effetto possibile. Una ricevuta deve essere autenticata dall'adapter e correlata a operazione, paziente, pratica, contenuto, destinazione e tutte le parti attese. Un esito parziale resta incerto.

Se la ricevuta è verificata ma il writer finale fallisce, resta `confirmed_pending_recording`: la ripresa registra soltanto l'esito locale. La conferma nel journal è l'esito operativo del servizio CU; la proiezione nella prescrizione specialistica sarà collegata ai servizi proprietari in CU-1b, senza scritture dirette dell'adapter.

A pacchetto disattivato i guard negano anche osservazione, riconciliazione e richieste di fondo; il servizio interrompe l'adapter e conserva `suspended_pack_disabled` oppure `uncertain` se un effetto è possibile. Le sole transizioni del journal di conservazione usano la fase del nucleo; non abilitano writer territoriali. La riattivazione non rinnova capability o approvazioni. Nessun completamento viene presunto.

Le prove riaprono SQLite e il servizio conservando dati sintetici e chiave. Non simulano un guasto elettrico. La sostituzione dell'archivio nega le vecchie autorità; migrazione/ripresa di un'operazione su un archivio restaurato, rotazione della chiave, retention e purge richiedono raccordo specifico prima dell'ammissione reale. Non si attiva il profilo in produzione in questa unità.

## Prove e limiti

I test in `lib/local-operation/*.test.ts` sono inclusi in `test:unit`. Coprono protocollo completo, sentinelle anagrafiche e cliniche, scambio di sessione, revoca/scadenza, contenuto cambiato, sospensione/ripresa, ricevute errate e parziali, errore del writer, concorrenza, atto manuale, richieste non ammesse e pacchetto disattivato. La cattura osserva stdout, stderr e IPC del processo MCP reale; separatamente il destinatario HTTP locale riceve i valori sintetici. Le richieste ostili di prova contengono intenzionalmente sentinelle: l'assenza si verifica sulle uscite, non su byte inseriti dall'avversario.

La [verifica finita e la mappa al codice](./formal/local-operation/README.md) dichiarano proprietà, assunzioni e falsificazioni. I log grezzi di sviluppo restano fuori da Git. Restano esclusi portali istituzionali, isolamento OS dell'harness, browser clinico reale, compatibilità desktop e accettazione di CU-1b. La review indipendente del diff finale precede qualsiasi merge.
