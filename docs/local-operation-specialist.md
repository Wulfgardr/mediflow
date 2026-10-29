# Specialistica CU-1 su portale inventato

La verticale riusa il [nucleo CU-1a](./local-operation-core.md) e il protocollo
`mediflow.local_operation.v1`. L'[ADR 0162](./adr/0162-local-computer-use-executor.md)
resta Proposed: questa consegna consente la valutazione di CU-1, senza qualificare
portali istituzionali, uso clinico, modalità 2 o isolamento dell'intero computer.

## Percorso e fonti

`lib/local-operation/specialist/synthetic-demo.test-support.ts` compone un archivio SQLite
isolato, il portale HTML inventato su loopback, Chromium e il servizio esistente.
Identità e prescrizione già decisa sono rilette dalle tabelle `patients` e
`service_prescriptions`, rispettando i campi cifrati `ENC:` della cartella; catalogo ed esenzione hanno versioni
e validità esplicite. Nessuna scelta clinica deriva dal portale o dal modello.
Codice, descrizione, quantità intera, unità, quesito, diagnosi, priorità, accesso
ed esenzione per ogni riga devono concordare. Un titolo non applicabile blocca.

Il browser compila i soli campi del contratto, salva la bozza e rilegge i valori
HTML. Il digest deriva dai valori effettivi, non da un attributo dichiarato dalla
pagina. Campi aggiunti, identità/pratica/account/UI diversi e input umano cambiato
impediscono il passo. Testo di pagina e istruzioni ostili rimangono dati locali.
Le destinazioni sono esatte per metodo, percorso e fase; richieste di pagina,
risorse, popup e download passano dal guard o sono bloccati. Service worker e
cache HTTP del contesto instradato sono disabilitati. Il manifest ammette solo
navigazioni: fetch/XHR, beacon, EventSource e risorse non sono canali autorizzati.
WebSocket sono negati prima della creazione delle pagine; worker e trasporti
paralleli sono disabilitati. La revoca chiude attivamente il documento e i suoi
canali, inclusi i trasporti HTTP ancora in corso; una ripresa autorizzata crea una pagina nuova. Il censimento comprende
l'albero accessibile di ogni documento e l'editabilità/focusabilità calcolata dal browser.
Solo i controlli previsti, con ruolo, tipo e appartenenza al form verificati, sono ammessi.
Il CSS effettivo è parte del contratto positivo della superficie. Nessuna clipboard o file
di pagina viene acquisito. L'invio intercettato usa `maxRetries: 0` e
`maxRedirects: 0`: Chromium può altrimenti ripetere un POST dopo un reset della
connessione senza una seconda intercettazione. Il destinatario confronta
atomicamente bozza, identità e valori prima di emettere la ricevuta HMAC simulata.
Un errore di navigazione chiude la pagina posseduta prima della ripresa.

Il censimento e l'atto condividono una risorsa CDP: gli script restano sospesi fino
alla risposta e alla lettura dell'esito. Il token di censimento genera un permesso
opaco monouso; il guard lo consuma prima del trasporto host, verificando l'epoca DOM
insieme allo snapshot completo del piano, contesto e lease del servizio, senza un nuovo intervallo asincrono.
Dopo hover/focus si ripete il censimento e si confrontano tutti i valori; al trasporto
il corpo del POST deve coincidere esattamente con i campi approvati. Modifiche CSSOM,
mutazioni, navigazioni inattese e nuovi frame
invalidano il censimento. Alert, confirm, prompt, beforeunload e nuove pagine durante
l'atto impediscono la conferma; dopo il possibile invio resta `uncertain`. La
navigazione principale attesa del form non è un nuovo atto. Il detach segue la
conclusione oppure la chiusura della pagina in errore.

La superficie Swift `native/LocalOperationDemo/main.swift` mostra selezione e
rilettura completa in un pannello scorrevole. Solo dopo il gesto Autorizza richiede
`LocalAuthentication.deviceOwnerAuthentication`, con Touch ID o credenziale di
sistema disponibile. Il helper riceve il piano su stdin e restituisce soltanto
un codice fisso; il modello non riceve il piano né può invocare il helper.
I test sostituiscono questa porta fidata: provano annullamento, binding e risposte
tardive, non un gesto biometrico reale. La compilazione del helper non dimostra
che Touch ID sia stato esercitato o che il client nativo ordinario sia integrato.

Nel ramo manuale il servizio conserva `awaiting_manual_act` e cede la superficie.
Il browser separato del medico esegue Invio e firma sullo stesso simulatore;
MediFlow cerca poi la ricevuta senza inviare nuovamente. Ricevuta assente o valori
cambiati mantengono incertezza. La firma simulata non è una firma istituzionale.

## Registrazione e recupero

Il callback `recordConfirmed` del journal invoca `recordSpecialistOutcome` dentro
la transazione SQLite `IMMEDIATE` già proprietaria dello stato e dell'audit CU.
L'adapter non riceve database o writer. Il servizio rilegge capacità, paziente
attivo, versione, piano e parti della ricevuta; aggiorna la prescrizione già
esistente con CAS e inserisce le prestazioni, con audit obbligatorio per padre
e righe. Quantità, unità ed esenzione sono conservate nelle note cifrate delle
righe; ricevuta e provenienza nei campi documentali esistenti. Non aggiunge tabelle.
Priorità e codici conservano i valori strutturati previsti dai reader ordinari.
Lo stato clinico resta `prescribed`: l'emissione non prova esecuzione o referto.

Un errore o audit ignorato annulla insieme righe, aggiornamento e conferma CU;
`confirmed_pending_recording` conserva la ricevuta. La ripresa registra soltanto
l'esito locale. Dopo un timeout con possibile effetto, la stessa pratica viene
riconciliata e non ripreparata. Il riavvio dei test riapre realmente SQLite e
ricrea host e autorità; non simula spegnimento elettrico o restore da backup.

Il simulatore cambia i pacchetti tramite il writer dedicato dell'host, con CAS e
audit. A pacchetto disattivo il core revoca i grant e blocca anche osservazione,
risorse e riconciliazione. Il journal conserva sospensione prima dell'atto o
incertezza dopo un possibile effetto. La riattivazione esplicita non rinnova le
vecchie autorità. Il callback territoriale resta negato anche senza rete.

## Riproduzione

Richiede Node 24, `npm ci`, Chromium Playwright e `MEDIFLOW_DATA_DIR` sintetica
esterna al repository. Non usare archivi clinici o servizi istituzionali.

```sh
export MEDIFLOW_DATA_DIR="$(mktemp -d)"
node scripts/run-strip-types.mjs --test --glob 'lib/local-operation/**/*.test.ts'
npm run verify:specialist-operation
npm run verify:local-operation
npm run typecheck
npm run lint
```

`verify:local-operation` richiede il jar TLC fissato nel [modello](./formal/local-operation/README.md).
La verticale non cambia stati o transizioni: la registrazione della prescrizione
appartiene alla transazione `Record` già modellata. Browser, esenzioni, cifratura
e valori clinici rimangono proprietà runtime, senza attribuirle a TLC.

`verify:specialist-operation` lavora in copie temporanee e falsifica separatamente
sorgenti, censimento, autorità di rete, ciclo del browser, registrazione e audit.
La quinta tornata include il legame di ogni dato del contesto portale, revisione
umana, confronto integrale dello snapshot, inventario accessibile/calcolato,
indisponibilità dell'albero, contratto CSS, modifiche CSSOM e contenuto del POST.
Dove più difese proteggono lo stesso vincolo, il mutante rimuove insieme quei
controlli: una guardia ridondante superstite non prova la sensibilità del test.
Dopo le falsificazioni riesegue il codice originale. `MEDIFLOW_CU_MUTATIONS`
seleziona etichette di mutazione con un'espressione regolare, per riprendere una
verifica senza ripetere prove già valide dello stesso codice.
`MEDIFLOW_CU_EVIDENCE` indica un file JSON assoluto per conservare i risultati;
`MEDIFLOW_CU_CAPTURE_DIR` conserva catture Giorno/Grafite prima e dopo la riapertura
della stessa bozza, confrontate byte per byte.

Per la demo interattiva su macOS, compilare il helper fuori dal repository e
passarne il percorso assoluto:

```sh
xcrun swiftc native/LocalOperationDemo/main.swift -o /percorso/locale/LocalOperationDemo
node scripts/run-strip-types.mjs scripts/local-operation-specialist-demo.mjs protected /percorso/locale/LocalOperationDemo
# Per il ramo con invio e firma del medico:
node scripts/run-strip-types.mjs scripts/local-operation-specialist-demo.mjs manual /percorso/locale/LocalOperationDemo
```

La demo usa un orologio e dati inventati, non installa plugin né apre archivi
esistenti. Alla fine chiude browser, listener e archivio sintetico posseduti.
L'ingresso rimane separato dai launcher distribuiti.

## Uscite osservate e limiti

`protocol.test.ts` avvia il processo MCP reale collegato all'host della verticale.
Controlla handshake, catalogo, `content`, `structuredContent`, assenza di `_meta`,
errori, stdout, stderr, IPC e console della pagina; sentinelle identificative e
cliniche restano assenti. Include errore per campo nuovo e input remoti ostili.
Il destinatario loopback riceve invece i valori sintetici: l'assenza sul canale
remoto non viene ottenuta omettendo la compilazione.

Sono osservabili i processi posseduti e il protocollo locale. I registri interni
del provider, gli strumenti alternativi dell'harness, lo schermo del Mac e altre
applicazioni non sono isolati o qualificati. Il claim riguarda soltanto i valori
nel canale MediFlow CU; rimangono inferenze da uso, tempi e contesto della chat.
L'accettazione CU-1 e il gesto nativo reale restano valutazioni distinte dalle
prove automatiche della verticale sintetica.
