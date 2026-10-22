# ADR 0160 — MediFlow dentro la chat delle app desktop

Data: 2026-10-22. Stato: Proposed.
Riferimenti: [WUL-788](https://linear.app/wulfgardr/issue/WUL-788),
[WUL-778](https://linear.app/wulfgardr/issue/WUL-778),
[WUL-759](https://linear.app/wulfgardr/issue/WUL-759).

Questo ADR propone il contratto del nuovo client. Non modifica il prodotto,
non ammette dati reali e non attesta funzionamento, anonimato o conformità.
Il pilota R/L procede separatamente su dati sintetici: alla stesura non sono
disponibili esiti conclusivi da cui far dipendere la decisione.

## Problema e contesto

La vista deve consentire al medico di consultare scheda, storia e terapie e,
in incrementi successivi, confermare scritture e gestire visita a voce e
ambulatorio direttamente nella chat. Il telecomando di ADR 0159 apre invece
la UI MediFlow separata e restituisce solo `continue_in_mediflow`.

Le fonti di decisione sono la ricognizione «MediFlow nella chat — WUL-788» del
22 ottobre 2026 e il commento «Decisioni di Leonardo (22 ottobre)» su WUL-788
(ID `b9addde9-5ff1-49ec-b237-9d5fe59df695`). La precisazione successiva del
coordinamento, verificata sulla risposta originale di Leonardo, distingue:

- **Scelto:** Claude Desktop e Codex nell'app ChatGPT desktop per le viste
  ricche; Codex CLI e Claude Code restano telecomandi.
- **Scelto:** nel contesto del modello solo contenuti pseudonimizzati, eliminando
  i riferimenti sensibili e mantenendo il contenuto clinico necessario.
  È una direzione architetturale, non una prova di anonimizzazione.
- **Scelto:** chiavi e corrispondenza di ricomposizione locali, con protezione
  legata all'hardware; accesso e conferma delle scritture avviati nella vista,
  che diventa un nuovo client fidato.
- **Proposto come perimetro iniziale:** solo Mac. Non costituisce una scelta
  definitiva sulle altre piattaforme né una qualifica di tutti i Mac.
- **Proposto dal coordinatore, da confermare:** autenticazione e conferma
  tramite componente nativo MediFlow e Touch ID, senza digitare PIN nel renderer.

Il testo pubblico di [Get MediFlow](https://getmediflow.dev), verificato nel
sorgente `app/mediflow-copy.ts` alle righe 469–474 di `origin/HEAD`
`42fc081a5442fd6b32601caedd59afd915bef15f`, descrive riduzione al necessario,
sostituzione degli identificativi e ricomposizione locale, mantenendo la
qualificazione di dati pseudonimizzati soggetti al GDPR. Questa è la direzione
riusata; il sito non attesta la disponibilità del nuovo client.

### Rapporti con gli ADR precedenti

- [0114](./0114-intelligent-host-aip-mcp-isolation.md) e
  [0117](./0117-headless-portable-agent-first-and-capability-first-fabric.md):
  restano isolamento MCP/AIP, servizi applicativi comuni e autorità MediFlow.
  Si propone un'estensione circoscritta della UI fidata alla vista desktop,
  non della fiducia nel modello, negli argomenti tool o nel parser MCP.
  Il futuro canale loopback della vista è un confine nuovo, non il listener
  già previsto dal baseline IPC privato.
- [0126](./0126-chatgpt-account-control-plane.md): login dell'account ChatGPT
  distinto da accesso MediFlow, consenso e autorizzazione all'uscita dei dati.
- [0134](./0134-chatgpt-subscription-synthesis-execution.md): riuso di riduzione,
  sostituzione, ricomposizione, consenso sul payload e verifica delle fonti.
  La chat desktop persistente non eredita la qualifica del processo confinato
  monouso: strumenti, cronologia, retention e destinatari sono diversi.
- [0140](./0140-synthetic-plugin-feasibility.md): packaging e UI dimostrativa
  riusabili, senza promuovere le fixture a prova del confine clinico.
- [0143](./0143-strong-unlock-credential.md): passphrase/verificatore v3 per
  sblocco, chiave in memoria e PIN di conferma separato. Il richiamo al «PIN»
  nell'esperienza richiesta non reintroduce il PIN come sblocco v3.
- [0156](./0156-therapy-status-uncertain-client-write.md): si conserva la
  distinzione tra abort, writer ancora in corso, CAS ed esito incerto;
  il journal Web non si estende automaticamente a un'altra origine.
- [0157](./0157-hl7-conformance-at-clinical-boundaries.md): la vista è un
  **confine di uscita dei dati**, da censire. Una proiezione applicativa
  pseudonimizzata e MCP/AIP sono `non HL7`, con un contratto proprio. Se si
  introduce un export FHIR/CDA/IPS, serve invece la prova del relativo
  profilo sull'artefatto effettivamente emesso dopo la trasformazione.
  Questo ADR non ne attesta conformità o accettazione.
- [0158](./0158-territorial-packs.md): capacità territoriali decise dall'host
  MediFlow; la vista non può attivare Italia/Lombardia né aggirare una revoca.
  Consultazione storica e azioni operative restano distinte.
- [0159](./0159-plugin-local-ui-navigation.md): il profilo `plugin_local_ui`
  resta un telecomando senza autorità clinica. Il nuovo client richiede una
  composizione esplicita distinta, senza ampliare quel profilo di nascosto.

Qui «host della chat» indica l'app del fornitore; «host MediFlow» indica il
runtime che possiede sessioni, autorizzazioni e servizi. Non sono la stessa
parte fidata.

## Opzioni e compromessi

1. **Vista con lettura locale diretta e contesto pseudonimizzato separato.**
   È la proposta principale, condizionata a L: la vista può mostrare identità
   reali; i tool rivolti al modello espongono soltanto la proiezione ammessa.
2. **Solo contenuto pseudonimizzato nei risultati MCP e nella vista.**
   Funziona senza canale di ricomposizione inline, ma non mostra i nomi reali.
   Può essere un incremento utile, dichiaratamente incompleto.
3. **Canale riservato alla vista attraverso il bridge dell'host.** `_meta`
   o tool app-only possono essere candidati se L fallisce. Richiedono prova
   per ogni client e decisione esplicita sul transito nell'host; non equivalgono
   a una lettura diretta dal Mac e non sono un fallback automatico.
4. **Telecomando e finestra MediFlow affiancata.** Conserva l'esperienza
   esistente e offre un ripiego concreto; non soddisfa la richiesta inline.
5. **Identificativi nei risultati ordinari o iframe dell'intera Web UI.**
   Esclusi: i primi violano la direzione scelta; il secondo incontra difese
   anti-iframe, cookie e controlli di origine che non vanno rimossi.

La proposta combina 1 con una superficie minima di 2; tiene 3 e 4 come
alternative esplicite. Le unità restano sintetiche finché l'ADR non è accettato;
l'accettazione non sostituisce l'ammissione del deployment concreto.

## Confine dei dati

### Proiezione ammessa nel modello

Ogni uscita parte da fonti correnti acquisite dai servizi MediFlow, per una
finalità e una selezione confermate. Prima si riducono campi, intervallo e
numero di documenti; poi si eliminano o sostituiscono gli identificativi.
Non si invia tutta la cartella chiedendo al modello di ignorarne una parte.

Devono essere rimossi integralmente dal payload destinato al modello, anche
nelle loro varianti, nei metadati e nel testo libero:

- nome e cognome del paziente, alias, iniziali identificanti e firme;
- codice fiscale e altri identificativi amministrativi o sanitari;
- indirizzo, domicilio, residenza e coordinate;
- contatti: telefono, email, account e riferimenti di messaggistica;
- data di nascita completa o parziale quando identificante;
- riferimenti documentali: numeri di cartella/referto, nosologico, NRE,
  identificativi di allegati, nomi file, percorsi, URL, barcode/QR e ID di origine;
- nomi di terzi: familiari, accompagnatori, operatori e firmatari;
- luoghi, strutture, organizzazioni e dettagli geografici identificanti;
- qualsiasi porzione di testo libero che contenga o renda ricostruibili
  questi riferimenti, comprese citazioni, intestazioni OCR e trascrizioni.

«Eliminati» significa che i valori originali non escono: se serve una
correlazione si usa un riferimento casuale privo del valore, limitato al
contesto autorizzato. Nessun hash semplice di CF/nome, identificativo DB o
pseudonimo globale stabile. La corrispondenza non accompagna mai i token.
Le fonti documentali diventano riferimenti opachi; il collegamento alla fonte
vera e la sua revisione rimangono locali.

Restano, solo quando necessari, **farmaci, condizioni, storia clinica e
misure**, con unità, dosi e relazioni temporali clinicamente rilevanti. Non
si altera un valore clinico per far passare il controllo. La data di nascita
è esclusa: si propone una fascia d'età predefinita per funzione; l'età precisa
è ammessa solo se motivata clinicamente e scelta prima dell'invio. Le fasce,
il trattamento dei minori e delle età estreme restano da approvare. Per la
cronologia si preferiscono intervalli relativi; eventuali date cliniche
esatte richiedono necessità documentata, senza ricostruire la nascita.
Se la generalizzazione rende il compito inaffidabile, quel compito resta locale.

Condizioni rare, combinazioni di terapie, tempi e misure possono comunque
rendere riconoscibile una persona. È un'obiezione alla sufficienza della sola
rimozione dei nomi, non una modifica della decisione di consentire contenuto
clinico pseudonimizzato. Per questo flusso, con ricomposizione possibile,
**pseudonimizzazione non significa anonimizzazione e il GDPR resta applicabile**
([Commissione europea](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en)).
Il gesto di consenso nel prodotto non risolve da solo base giuridica, ruoli,
condizioni del servizio o valutazione del rischio del deployment.

### Testo libero e riuso effettivo

La ricognizione del codice è statica alla revisione
[`7939f9f34a1d8dca57f202b604afed5102ecb768`](https://github.com/Wulfgardr/mediflow/tree/7939f9f34a1d8dca57f202b604afed5102ecb768),
senza apertura di database. I seguenti percorsi descrivono quella revisione:

- [`ai-egress-gate.ts`](../../lib/ai-egress-gate.ts) riconosce pattern e nomi/date
  noti; il gate generico rimane chiuso. Regex e dizionario non coprono tutti
  i terzi, luoghi, errori OCR o riferimenti indiretti.
- [`ai-redaction-session.ts`](../../lib/ai-redaction-session.ts) unisce span,
  valida offset e limiti e genera token con nonce di sessione. La mappa è in
  RAM e `close()` la ritira; non è una custodia hardware. Il solo metodo
  `rehydrate` non sostituisce la validazione dell'output del percorso ordinario.
- [`ordinary-preparation.ts`](../../lib/chatgpt-execution/ordinary-preparation.ts)
  applica runner GLiNER locale e layer deterministico a unità intere bounded;
  congela payload e hash e ricompone solo stringhe ammesse, respingendo token
  estranei, chiavi e strutture non consentite prima del parser canonico.
- [`ai-redaction-evidence.ts`](../../lib/ai-redaction-evidence.ts) verifica
  identità del runner, corpus, digest, metriche e scadenza dell'evidenza.
  [`ordinary-egress-chokepoint.ts`](../../lib/chatgpt-execution/ordinary-egress-chokepoint.ts)
  rivalida governance, consenso e identità del payload e richiede audit.
  Questo percorso governato è distinto dal gate generico sempre chiuso:
  nessuno dei due diventa un permesso per la nuova chat.
- [`ordinary-flow.ts`](../../lib/chatgpt-product/ordinary-flow.ts) lega fonti,
  tentativo e pubblicazione alla sessione; [`ordinary-wire.ts`](../../lib/chatgpt-product/ordinary-wire.ts)
  dichiara uscita redatta con consenso e condizioni di retention del servizio.
  Non esiste qui una qualifica della conversazione desktop persistente.

Si riusano questi contratti e primitive nei servizi posseduti da MediFlow,
non i dati originali nel processo MCP. Il nuovo profilo deve coprire anche
anagrafiche, terzi, luoghi, nomi file e identificatori strutturali oggi non
necessariamente trattati dai quattro profili di sintesi. Prima dell'uscita
serve un controllo locale del payload serializzato completo: testo, chiavi,
valori, citazioni, metadati e messaggi di errore. Una redazione parziale,
un runner mancante/non qualificato, un campo non classificato o un residuo
identificante bloccano l'invio; nessun troncamento o ripiego remoto silenzioso.

La copertura del testo libero va provata con corpus sintetico annotato:
varianti ortografiche, Unicode, OCR, omonimi, date ambigue, nomi nei farmaci,
parenti e luoghi nelle note. La revisione locale del medico integra questi
controlli, senza trasformare una casella di consenso in prova di assenza di
identificativi. Le istruzioni contenute nei documenti restano dati non fidati:
non possono cambiare scope, policy di uscita o destinazione.

`content`, `structuredContent`, messaggi e aggiornamenti del contesto sono
uscite verso il modello e accettano solo il payload preparato. HTML/JS/CSS
sono statici e privi di dati paziente. URL, errori, log, widget state e titoli
non contengono identificativi o segreti. La regola vale anche per turni
successivi, allegati, immagini e testo scritto nella vista: nessun reinvio
automatico del contenuto ricomposto. Il testo digitato direttamente nella
chat dell'host è fuori dal controllo MediFlow; questa limitazione deve essere
visibile prima dell'uso reale e non aggirata promettendo un filtro universale.

## Ricomposizione locale

### Custodia: chiave hardware e mapping sono oggetti diversi

Si propone che un componente nativo MediFlow possieda la ricomposizione sul
Mac. Per la prima unità il mapping dura quanto il tentativo autorizzato e vive
soltanto nella sua RAM; se serve persisterlo, vive in un archivio locale cifrato
separato, con durata minima esplicita e senza sincronizzazione iCloud. Non
viene salvato nel renderer, nella cronologia o nel processo MCP. La persistenza
è una decisione aggiuntiva, non un effetto implicito del login.

Una chiave privata generata nel Secure Enclave può proteggere l'accesso al
materiale crittografico del mapping. Il Keychain custodisce riferimenti e
materiale avvolto con policy legata al dispositivo; **il Secure Enclave non
è il contenitore della tabella di corrispondenza**. La chiave hardware non è
esportata; il mapping decifrato deve comunque apparire nella RAM del componente
nativo durante l'uso. Il disegno crittografico preciso richiede review e prove.
Non si deriva una chiave dal numero di serie del Mac.

Le [API Security Apple](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)
descrivono generazione di chiavi P-256 nel Secure Enclave, uso attraverso
riferimenti e controllo di accesso: non l'importazione della master key
simmetrica esistente o di una tabella arbitraria. La protezione richiede
hardware e policy verificati, non soltanto una chiamata a `LAContext`.

Nel codice esistente,
[`HomeBasePairedStore.swift`](../../native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePairedStore.swift)
conserva il token paired come generic password e legge con interazione
vietata; non implementa conferme Touch ID per comando.
[`HomeBasePatientCacheStore.swift`](../../native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientCacheStore.swift)
conserva una chiave simmetrica nel Keychain con
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: questo non prova l'uso di
una chiave non esportabile Secure Enclave né l'idoneità della policy per la chat.
La ricerca nei sorgenti Swift non individua un percorso Secure Enclave per
questa funzione. Si riusano esperienza e gestione degli errori Keychain,
non si dichiara il nuovo contratto già implementato.

La mappa è legata ad archivio/generazione, sessione, selezione, tentativo e
versione del payload. Token sconosciuti, di un altro paziente o di una
sessione revocata non vengono ricomposti. Al lock si ritirano concessioni e
mappe in memoria; un eventuale contenitore persistente torna inaccessibile.
Una copia su un altro Mac non deve riaprire la mappa. Si propone, per la prima
unità, di perdere la ricomposizione delle vecchie chat dopo riavvio/perdita
del Mac e rigenerare il contesto dalle fonti locali. Non si cambia il recupero
della cartella previsto da ADR 0143, né si elimina lo storico clinico.

### Percorso verso la vista e dipendenza dall'esito L

Se L passa sul client/build scelto, la vista richiede una proiezione già
ricomposta al componente locale autorizzato. La mappa e le chiavi non le
vengono consegnate. Il modello riceve separatamente solo la proiezione
pseudonimizzata; il nome reale viene inserito nella vista dopo la lettura
locale, senza tornare attraverso risultati tool o aggiornamenti del contesto.

`ui://` non attribuisce origine localhost al renderer. Occorre qualificare
CSP, CORS, Local Network Access, origine effettiva, autenticazione del servizio
e dell'istanza e no-store. Porta locale, `Origin` e nonce pubblicato nell'HTML
non sono da soli credenziali. Un'origine opaca o `null` non giustifica una
allowlist generica. Non si rimuovono i controlli della Web UI, non si aprono
porte LAN/tunnel e non si introduce un proxy generico verso il runtime.

Se L fallisce o non è qualificato, la vista conserva soltanto pseudonimi e
la ricomposizione si mostra nella finestra MediFlow locale: alternativa
utilizzabile ma incompleta rispetto a WUL-788. Per recuperare i nomi inline
si può valutare un bridge app-only con consegna riservata alla vista, provando
il percorso reale su ogni host. In ChatGPT `_meta` è documentato come nascosto
al modello, ma visibile all'host; app-only limita la disponibilità del tool,
non dimostra segretezza del risultato. Nessun trasporto così ottenuto può
essere registrato come L positivo. Se non è dimostrabile l'esclusione dei
nomi dal modello, la ricomposizione inline rimane disabilitata.

## Autorità della vista

### Sessione propria, nascita e ritiro

La vista è un client con concessione propria dell'owner MediFlow, non una
sessione copiata dal browser o derivata dal login Claude/ChatGPT. Si propone:

1. Il pacchetto privato apre una vista statica senza autorità. Un gesto umano
   avvia una richiesta di associazione monouso verso il componente nativo.
2. Il componente autentica il canale/istanza e identifica installazione,
   archivio e account MediFlow. Il medico vede quale app chiede accesso e
   conferma scope e selezione in una superficie autenticata.
3. L'owner emette una concessione limitata a istanza, archivio/generazione,
   sessione, paziente o ambulatorio, finalità, capacità e scadenza. I riferimenti
   scelti dal modello non possono creare selezione o autorità.
4. Il componente nativo conserva credenziali, chiavi e proof di scrittura.
   La vista riceve soltanto il mezzo minimo necessario a usare il canale;
   qualunque capability presente nel renderer va considerata accessibile
   anche all'host. Non è un cookie generale MediFlow e non compare nei tool.

Il binding dell'istanza e il trasporto devono resistere a replay, altri
processi locali e riuso di deep link; la sola origine non attesta l'identità
dell'app. Se il client non consente un binding adeguato, non si promuove il
flusso. Il server MCP rimane adapter isolato: nessun DB, master key, PIN,
verificatore o proof nel suo processo.

Lock MediFlow o del Mac, logout, scadenza, revoca, cambio archivio/account,
selezione o capacità invalidano la concessione interessata. Chiusura e
ricaricamento della vista richiedono una nuova associazione; in mancanza di
segnale affidabile di chiusura, la lease breve scade comunque lato owner.
Risposte tardive sono scartate; dati ricomposti e anteprime vengono rimossi
alla revoca. Non si promette la cancellazione di copie già acquisite dall'host.
Durate e rinnovo sono da fissare; nessun rinnovo implicito prolunga la
sessione MediFlow. I marker di scritture già partite sopravvivono al ritiro
come metadati di recupero, senza concedere nuove autorizzazioni.

### Touch ID: proposta da confermare, non attestazione clinica

La proposta preferita mantiene il comando «Accedi» o «Conferma e registra»
nella vista, ma demanda il gesto biometrico alle API native MediFlow. Touch ID
non «fornisce il PIN»: autorizza un'operazione protetta del componente nativo.
Né PIN, né passphrase, né verificatore riutilizzabile attraversano il renderer.
Il protocollo deve verificare una challenge legata alla sessione e, per la
scrittura, al comando esatto; un booleano `authenticated` dalla vista non vale.

**Obiezione:** Touch ID prova la presenza/autenticazione prevista dalla policy
OS, non l'identità del paziente, il ruolo medico, il contenuto approvato o la
CAS. Un renderer ostile può mostrare una cosa e richiederne un'altra. Si
raccomanda perciò un riepilogo nativo autenticato di paziente e operazione,
ricavato dall'owner, prima del gesto finale. Il flusso nasce e si conclude
nella chat, ma il riepilogo e il prompt OS non sono HTML dell'host. Leonardo
deve confermare che questa interpretazione soddisfi la richiesta inline.
Senza riepilogo nativo rimane un rischio esplicito di sostituzione del comando.

ADR 0143 non viene cancellato. Per il primo incremento si propone Touch ID
per associare la vista a una sessione nativa già sbloccata e per il successivo
step-up; primo accesso e recupero restano con passphrase v3 nella UI nativa.
Lo sblocco rapido a freddo richiederebbe un nuovo involucro/credenziale protetto
hardware e una decisione specifica su persistenza e recupero. Non si salva
la passphrase o il PIN nel Keychain soltanto per simulare l'accesso esistente.
Anche sostituire il PIN di conferma con una prova nativa richiede un'estensione
esplicita dell'ammissione del writer, mantenendo ruolo e verifiche comuni.

Alternative da valutare:

- **Passphrase/PIN nella superficie nativa**, aperta dalla vista: riusa meglio
  ADR 0143 e serve se biometria o hardware non sono disponibili; richiede
  accettare il passaggio alla superficie di sistema, senza downgrade nascosto.
- **Touch ID soltanto su sessione già sbloccata:** riduce la nuova custodia di
  segreti, ma dopo riavvio/lock che distrugge la chiave serve sblocco nativo.
- **PIN nel renderer:** rispetta letteralmente il form inline, ma espone il
  segreto a host, DOM e cattura dei tasti. Sconsigliato; non autorizzato dalla
  sola scelta di una vista fidata e comunque insufficiente a sbloccare v3.
- **WebAuthn/PRF:** possibile percorso futuro, con supporto e binding origin da
  qualificare; non è equivalente al Keychain né un fallback già disponibile.

Mac senza sensore, rifiuto, lockout, variazione biometrica e componente nativo
assente devono produrre un esito esplicito. La policy biometrica e l'eventuale
uso della password OS come fallback vanno scelti e provati; non si deducono
dal nome Touch ID o dall'esistenza del Secure Enclave.

### Scritture, CAS ed esito incerto

Il modello propone; il medico rivede e conferma nella vista. L'owner rilegge
le fonti correnti, costruisce un comando immutabile e lega l'approvazione a
archivio, sessione, ruolo, paziente, risorsa, valori, versione attesa, nonce e
scadenza. Una modifica dopo l'anteprima invalida la conferma. Il componente
nativo consegna la prova all'ammissione MediFlow, mai al modello o al MCP.
La vista non può firmare autonomamente un consenso del medico.

Si chiamano **lo stesso writer e gli stessi controlli** delle altre UI:
ammissione, versione/CAS, transazione, audit e ricevuta applicabili. Nessun
writer del plugin o accesso diretto al database. Per la prima scrittura si
propone un solo cambio stato terapia, attraverso
[`therapy-write-operation.ts`](../../lib/therapy-write-operation.ts), senza
estenderlo a prescrizioni o applicazione automatica di proposte AI.

ADR 0156 conserva un marker in localStorage e Web Locks **per origine/profilo**.
La nuova vista potrebbe avere origine diversa, effimera o storage negato;
una copia del controller non coordina Web, Claude e Codex. CAS resta
necessaria, ma non identifica da sola l'autore di un commit dopo timeout.
Un abort non annulla la scrittura e una GET alla stessa versione non ne
esclude un commit successivo; nessun retry automatico.

Per ammettere quella scrittura nella chat si propone il contratto host distinto
indicato come alternativa da ADR 0156: identità durevole del comando, ricevuta
atomica con commit/audit e interrogazione autorevole degli stati in corso,
rifiutato, commesso o ancora ignoto. Deve coordinare l'ammissione dei client
coinvolti e distinguere timeout prima/dopo l'invio. Se la ricevuta non consente
una conclusione, il blocco permane e la UI non dichiara «Registrata».
Questo è un prerequisito da implementare e revisionare, non una capacità
attribuita al writer corrente né una nuova semantica di CAS.

Alternativa più piccola: vista in sola lettura e conferma nella UI Web esistente,
con i limiti di ADR 0156 espliciti. Non soddisfa la scrittura inline. Non basta
condividere un nome di chiave localStorage o ipotizzare la stessa origine.

## Cosa vede comunque l'host e rischio residuo

L'app della chat ospita DOM, memoria e pixel dei nomi e dati ricomposti.
Può accedervi tramite renderer, strumenti di sviluppo, accessibilità, crash
report, telemetria o screenshot. La lettura loopback evita il normale risultato
MCP, non questo trattamento. Cifratura del canale e Touch ID non lo eliminano.
Non è accertata qui la retention effettiva di ogni build/account, né si
attribuiscono acquisizioni automatiche non documentate ai fornitori.

La scelta della vista fidata comporta accettare, a livello architetturale,
che il renderer dell'host possa leggere il dato mostrato. **Non comporta**
un'accettazione già ottenuta di upload, retention indefinita o inserimento
dei nomi nel modello. Questi aspetti restano decisioni del deployment concreto.
MediFlow deve evitare proprie copie cliniche nei log e nello stato widget e
impedire il reinvio del DOM ricomposto; screen context, screenshot e computer
use verso il modello devono essere esclusi o controllati nel profilo ammesso.
Se l'host non consente il confine richiesto, la vista mostra solo pseudonimi
e i nomi rimangono nella finestra nativa.

Resta il rischio di un host compromesso o autorizzato a catturare la schermata:
non si promette isolamento da chi possiede il renderer. La decisione sul
client deve nominare build, account/workspace, strumenti attivi, retention e
condizioni contrattuali; il solo esito negativo di una ricerca nei log non
certifica assenza di altre copie. Dati già inviati al modello non diventano
revocabili cancellando la mappa locale.

## Client e distribuzione

Per questo incremento si propone soltanto Mac con componente nativo e
**installazione privata**. Ogni app desktop va qualificata separatamente;
prove del CLI, del simulatore o di Claude Desktop non qualificano Codex desktop.
Web, Windows e Linux richiedono decisioni e prove ulteriori.

Nessuna pubblicazione in directory è autorizzata. Le
[Plugin Guidelines OpenAI](https://developers.openai.com/plugins/plugin-guidelines)
vietano raccolta o trattamento di PHI tra i dati soggetti a restrizioni;
non vi è una deroga dimostrata per iframe, loopback o pseudonimizzazione.
PHI e dato sanitario GDPR non sono categorie automaticamente equivalenti.
La [submission Claude](https://claude.com/docs/connectors/building/submission)
richiede un server HTTPS remoto per il listing connector e indirizza server
locali verso plugin: non dimostra un'ammissione sanitaria di MediFlow.
La distribuzione pubblica resta una decisione separata, coordinata con WUL-759;
l'installazione privata non sostituisce governance e verifica del trattamento.

## Sequenza di unità e verifica attesa

Ogni unità produce evidenza sintetica legata a commit, pacchetto e build del
client. I criteri sotto sono **prove future**, non test eseguiti da questo ADR.
Le unità 2–3 possono precedere Touch ID soltanto con autorità di prova su
fixture; non aprono un accesso clinico temporaneamente privo di autenticazione.

1. **Pilota R/L, già in corso.** R: vista inline, navigazione, tastiera e
   ridimensionamento nel client reale. L: sentinella letta da loopback, assente
   da bundle, risultati tool e canali del modello osservabili. Registrare
   separatamente esiti, origine, CSP/CORS/LNA e limiti d'osservazione.
   **Falsificazioni:** solo risposta testuale non passa R; sentinella nel tool
   non passa L; servizio spento, porta errata, consenso rete negato o risposta
   tardiva dopo revoca non devono apparire come successo. R su un client non
   chiude la qualifica nei due desktop richiesta da WUL-788.
2. **Lettura pseudonimizzata.** Una sola scheda e una selezione limitata di
   storia/terapie, con consenso sul payload finale, provenienza locale e
   confronto semantico di farmaci, condizioni e misure. Ispezionare tool,
   transcript, metadati, errori e turno successivo; dichiarare ciò che il
   trasporto del provider non permette di osservare.
   **Falsificazioni:** nome di un terzo nel testo libero, CF OCR, luogo, nascita,
   filename identificante, campo sconosciuto, report redaction scaduto, runner
   discordante e cambio paziente tra preparazione e invio devono fermare l'uscita.
   Un falso negativo sul corpus blocca la promozione, non si nasconde nella media.
3. **Ricomposizione locale.** Se L è positivo, nomi sintetici reali nella vista
   e soli pseudonimi nel modello; mapping confinato al componente nativo,
   ritiro e riapertura verificati. Se L non passa, provare il ripiego locale
   dichiarandolo incompleto; l'eventuale bridge riservato richiede una prova
   distinta e una decisione prima del collegamento.
   **Falsificazioni:** token estraneo, mappa di altra sessione, copia del materiale
   cifrato su altro Mac, lock durante risposta, refresh e screenshot inoltrato
   al modello non devono produrre ricomposizione non autorizzata o fuga silenziosa.
4. **Accesso con Touch ID.** Associazione da gesto nella vista, challenge nativa,
   grant limitato e ritiro sul Mac reale. Provare primo accesso, sessione già
   sbloccata, riavvio, scadenza, revoca e il fallback eventualmente approvato.
   **Falsificazioni:** rifiuto/lockout, hardware assente, replay, app diversa,
   istanza duplicata, booleano forgiato e cambio archivio devono negare accesso;
   nessun segreto nei tool, renderer, URL o log. La prova biometrica non sostituisce
   la verifica di scope e ruolo, né dimostra una scrittura.
5. **Una prima scrittura confermata.** Solo il cambio stato terapia concordato,
   con anteprima, gesto inline, step-up nativo, writer comune, CAS e audit.
   Prima qualificare comando/ricevuta durevoli e coordinamento fra client.
   **Falsificazioni:** paziente o versione cambiati, payload modificato dopo
   conferma, doppio clic, replay, crash prima/dopo commit, risposta persa,
   reload e concorrenza Web/Claude/Codex. Verificare un solo effetto auditato,
   nessun successo falso e mantenimento dell'esito ignoto senza retry automatici.
6. **Visita a voce, terapie, ambulatorio, in incrementi distinti.** Per la voce
   riusare la cattura/trascrizione Apple locale e la revisione del transcript;
   audio e testo grezzo non entrano nel modello. Per terapie estendere una
   operazione alla volta; per ambulatorio provare scope e capacità territoriali.
   Riusare gli stessi servizi e la grafica MediFlow, senza nuovo dominio nel plugin.
   **Falsificazioni:** permesso microfono negato, cambio paziente durante la
   registrazione, identificativi pronunciati, bozza non rivista, terapia stale,
   altro ambulatorio e pacchetto territoriale disattivo. Nessuna scrittura o
   chiamata esterna fuori scope. Non confondere agenda interna, candidati da
   calendari esterni e prenotazione realmente confermata.

## Decisioni ancora aperte per Leonardo

1. Confermare **Mac come perimetro iniziale** e i requisiti minimi di hardware,
   senza dedurre disponibilità di Touch ID da «Mac».
2. Confermare la proposta Touch ID con riepilogo nativo autenticato e chiarire
   se soddisfa «dentro la chat»; in alternativa accettare esplicitamente il
   rischio del renderer quale unica sede del riepilogo. Scegliere il fallback
   nativo e decidere se rinviare lo sblocco rapido a freddo.
3. Scegliere fasce d'età e criteri per età/date cliniche precise, con i limiti
   di utilità e riconoscibilità del testo libero rimasti dopo la redazione.
4. Confermare mapping effimero e perdita della ricomposizione delle vecchie
   chat al riavvio; se serve continuità, decidere durata e recupero del mapping
   cifrato hardware-bound senza cambiare implicitamente il recupero clinico.
5. Dopo R/L, scegliere per ciascun host il canale di ricomposizione: diretto
   qualificato, bridge riservato da valutare oppure nomi nella UI nativa.
   Nessuna decisione è basata su un L positivo ancora non ottenuto.
6. Nominare account/workspace ammessi e rischio residuo accettabile per renderer,
   screenshot e retention prima di qualsiasi dato reale. Resta necessaria
   l'ammissione del deployment, distinta dall'accettazione di questo ADR.
7. Confermare cambio stato terapia come prima scrittura e il prerequisito
   comando/ricevuta host per l'esito incerto; fino ad allora sola lettura nella
   chat. Durate delle concessioni e rinnovo vanno fissati nel contratto attuativo.

## Fonti e limiti della ricognizione

- Ricognizione locale del 22/10/2026, `recon-mediflow-in-chat-20261022.md`,
  §§1–6; il commento «Ricognizione completata» in WUL-788 ne riporta la sintesi.
  Il rapporto resta fuori dalla repository; qui sono riportati confini e fonti
  necessari alla revisione, senza dipendere dall'accesso a un percorso personale.
- Sorgente MediFlow al commit completo citato sopra; ADR e file collegati
  letti staticamente. La presenza del codice non prova l'app installata.
- [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui) e
  [MCP Apps locali Claude](https://claude.com/docs/connectors/building/mcp-apps/getting-started):
  fonti della ricognizione consultate il 22/10/2026, non risultati R/L.
- Fonti Apple primarie, ricontrollate il 22/10/2026:
  [Protecting keys with the Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)
  (contenuto Markdown ufficiale) e
  [Apple Platform Security — Secure Enclave](https://support.apple.com/guide/security/the-secure-enclave-sec59b0b31ff/web).
  Documentano capacità e limiti hardware/API, non il futuro protocollo MediFlow.
- Plugin Guidelines OpenAI, submission Claude e fonte della Commissione europea
  collegate sopra: consultate il 22/10/2026. Nessuna deduzione di ammissione
  clinica o pubblicazione dalla sola disponibilità tecnica.

Autoria dell'ADR e della ricognizione: **GPT-6-Astra, High, via Codex/T3**,
senza delega. Brief iniziale del coordinatore Opus; coordinamento corrente
Astra. La revisione del coordinamento resta distinta dalla stesura: lo stato
rimane Proposed. Nessun esito del pilota parallelo è attribuito a questo lavoro.
