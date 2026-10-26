# ADR 0160 — MediFlow dentro la chat delle app desktop

Data: 2026-10-22. Stato: Proposed.
Riferimenti: [WUL-788](https://linear.app/wulfgardr/issue/WUL-788),
[WUL-778](https://linear.app/wulfgardr/issue/WUL-778),
[WUL-759](https://linear.app/wulfgardr/issue/WUL-759).

Questo ADR propone il contratto del nuovo client. Non modifica il prodotto,
non ammette dati reali e non attesta funzionamento, anonimato o conformità.
Secondo round del 22 ottobre: recepisce le decisioni e le prove sintetiche
riportate sotto. Queste prove non qualificano dati reali o nuove scritture.
Aggiornamento del 26 ottobre: registra D3 e le durate iniziali D4 approvate
da Leonardo il 25 ottobre in [WUL-788](https://linear.app/wulfgardr/issue/WUL-788).
L'ADR resta Proposed; budget, implementazione e relativa accettazione restano distinti.

## Problema e contesto

L'obiettivo è l'uso completo di MediFlow dal plugin: consultazione, creazione
del paziente da documenti, tutte le funzioni dell'Intelligence Fabric,
scritture, visita a voce e ambulatorio. La domanda sceglie una vista pertinente,
senza caricare sempre l'intera scheda. La completezza funzionale è un criterio
di arrivo, non una capacità già consegnata né un'autorizzazione generica.
Il telecomando di ADR 0159 apre invece
la UI MediFlow separata e restituisce solo `continue_in_mediflow`.

Le fonti di decisione sono la ricognizione «MediFlow nella chat — WUL-788» del
22 ottobre 2026 e il commento «Decisioni di Leonardo (22 ottobre)» su WUL-788
(ID `b9addde9-5ff1-49ec-b237-9d5fe59df695`), le decisioni successive
(`eafa63a9-4caa-4d2e-96b1-5a4f5bc6475a`) e i nuovi requisiti di prodotto
(`15fa0a62-9fad-4856-b4f9-da99a651c9af`), tutti nella stessa issue:

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
- **Scelto:** accesso con Touch ID nella finestra nativa aperta dalla vista;
  ripiego con PIN nella stessa finestra. Mai PIN o passphrase nella chat.
- **Scelto:** prima scrittura limitata al cambio di stato di una terapia,
  con anteprima, conferma nella vista e verifica nativa.
- **Scelto:** corrispondenze pseudonimo → nome soltanto per la sessione;
  vecchie chat e riavvii restano a pseudonimi. Nessuna persistenza del mapping.
- **Scelto il 25 ottobre (D3):** nomi soltanto nella finestra nativa MediFlow;
  nella chat restano pseudonimi e le corrispondenze vivono soltanto in RAM.
- **Approvato per la prima qualifica sintetica il 25 ottobre (D4):** una sola
  operazione per autorizzazione, 30 secondi per confermarla, blocco della vista
  dopo 5 minuti d'inattività, senza rinnovo automatico. Restano da fissare i
  budget di prestazione dopo baseline e da accettare l'implementazione.
- **Richiesto:** importazione da documenti, Fabric completo, catalogo di viste,
  opzione di chat temporanea, prestazioni con budget e pubblicazione per terzi.

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

## Esiti R/L e scelta del canale per host

R misura la vista inline nel client reale; L la lettura diretta da loopback.
I rapporti del 22 ottobre riguardano il demo sintetico alla revisione
`328a0df5833ecaa4563193a772c524fad6c04727`; l'addendum del 25 ottobre su
[WUL-788](https://linear.app/wulfgardr/issue/WUL-788) riguarda il demo 0.1.0
alla revisione `8c343bc2949fc90c663c374bcd8719ab3933cbe2`. Nessuno dei due
qualifica il broker proposto qui.

| Superficie provata | Esito | Conseguenza per il disegno |
| --- | --- | --- |
| Codex nell'app ChatGPT desktop 26.1016.61520 (21421) | R PASS con difetti, checklist completata manualmente da Leonardo; L FAIL | Origine `codex-sandbox://`: il percorso diretto con il validatore corrente è impraticabile. Vista pseudonimizzata via canale host da qualificare; ricomposizione nativa. |
| Codex CLI 0.163.0 | PASS, una chiamata demo e ricevuta, exit 0 | Prova del telecomando testuale, non di R o L. |
| Claude Desktop 3.1623.1 | R FAIL; L non verificato | Demo e controllo ufficiale `@modelcontextprotocol/server-map@2.0.3` eseguono il tool ma producono zero `resources/read`. Limite del percorso host osservato; resta la UI nativa. |
| Claude Desktop 3.1623.4, 25 ottobre 2026 | R PASS e L PASS sul demo sintetico | Rendering inline e lettura autorizzata della sentinella in RAM osservati; Blocca rimuove il contenuto e la nuova apertura non eredita l'autorizzazione. Non qualifica broker/prodotto, riservatezza verso l'host, prestazioni o Claude Desktop 3.6556.2. |

Su Claude la prova A/B storica e il successivo PASS non identificano quale
cambiamento di build, account o bridge locale abbia risolto il precedente
FAIL; non dimostrano un difetto del solo HTML MediFlow. Su Codex non sono qualificati
CSP/CORS/LNA effettivi né la causa di rete precisa. Non si estende il verdetto
a tutte le versioni future e non si allenta il validatore per ottenere L.
I difetti R residui sono salto della chat in fondo al clic, ricevuta JSON
visibile, fasce grigie laterali e fluidità da misurare. R PASS non chiude tali
difetti e non prova la revoca di una sessione clinica, assente nel demo.

**Direzione scelta con D3:** ricomporre identità e documenti soltanto nella UI nativa;
nei desktop capaci di R, usare viste pseudonimizzate e risposte in chat
alimentate dal broker. È un percorso dal plugin con passaggi nativi espliciti,
ancora da implementare e provare nel prodotto. Su Claude il PASS del demo
permette di proseguire la qualifica inline; il telecomando conserva il proprio
perimetro e non sostituisce quella prova.

L'alternativa per i nomi inline è un tool con `_meta.ui.visibility: ["app"]`
e risultato riservato alla vista, attraverso l'host. La
[specifica MCP Apps, draft consultato](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
definisce questa visibilità e il bridge; il
[riferimento OpenAI](https://developers.openai.com/plugins/reference)
distingue inoltre `_meta` dai campi del risultato visibili al modello.
Sono due controlli diversi: visibilità del tool e destinazione del risultato.
Per MediFlow vanno provati entrambi, incluso il turno successivo, gli errori,
lo stato widget, notifiche, screenshot e aggiornamenti del contesto.

App-only evita una nuova dipendenza da loopback e può ridurre i turni modello
nelle interazioni, ma l'host trasporta comunque i byte e può vedere renderer
e risultato. Non è cifratura verso l'host né una qualifica di retention; il
solo flag non autorizza letture o scritture. La raccomandazione consente di
sperimentarlo per viste **pseudonimizzate**, mai come ripiego implicito per
identificativi. I nomi via bridge richiederebbero una decisione di trattamento
e una qualifica aggiuntive. Nessun esito del bridge vale come L positivo.

La lettura diretta resta un'opzione futura per host che superino L, con gli
stessi rischi del renderer. Identificativi nei tool ordinari e iframe
dell'intera Web UI rimangono esclusi. Le unità restano sintetiche finché
l'ADR non è accettato; l'accettazione non ammette il deployment concreto.

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

### Documenti in entrata: prima del broker conta dove si carica

**Un documento trascinato nel compositore della chat arriva in chiaro all'host
e può entrare nel modello prima di qualsiasi chiamata MediFlow.** «In chiaro»
qui significa accessibile al destinatario, anche se il trasporto usa TLS.
Il broker non può filtrare retroattivamente quel trasferimento. File, immagini,
nomi file, metadati e audio seguono lo stesso limite; una chat temporanea non
lo cambia. Gli helper di upload dell'host non sono un caricamento locale.

Percorso raccomandato, avviabile dal plugin:

1. «Aggiungi paziente da documenti» apre la finestra nativa MediFlow autenticata.
   Il medico trascina i documenti lì o usa il selettore file nativo. La vista
   in chat riceve solo una ricevuta opaca, senza percorso, filename o anteprima.
2. Il broker **locale posseduto da MediFlow**, distinto dall'adapter MCP, vede
   i byte originali, metadati, testo estratto e candidati anagrafici necessari.
   Verifica tipo/dimensione, origine, scope di creazione, duplicati e integrità;
   i file restano in un'area locale di preparazione con durata limitata alla
   lavorazione. Nessun URL arbitrario o file ID dell'host viene scaricato
   automaticamente. Parser e istruzioni nel documento non concedono autorità.
3. AnyDoc e l'OCR locale ammesso preparano evidenze per pagina; Smart Import
   produce candidati, con errori e provenienza, senza inserire record. Prima
   di un eventuale invio a un provider Fabric o al modello della chat, lo
   stesso broker riduce, pseudonimizza, controlla i byte finali e ottiene il
   consenso per la destinazione esatta. I due destinatari non si autorizzano
   reciprocamente. Un percorso interamente locale non richiede tale uscita.
4. Il medico rivede nella UI nativa identità, ambiguità, possibili duplicati,
   dati clinici e fonti. «Nuovo paziente» è uno scope proprio, non il paziente
   attualmente selezionato. Conferma nativa e writer applicativo comune
   inseriscono soltanto i campi approvati; merge con un paziente esistente
   richiede una scelta distinta. Terapie estratte non diventano prescrizioni.
5. Il broker controlla anche ciò che ritorna dal modello: schema, token della
   sessione, riferimenti alle fonti, revisione e dati estranei. Ricompone solo
   localmente; un output non valido resta una proposta rifiutata. Alla chat
   escono solo esito minimale e contenuto pseudonimizzato ammesso; originali
   e allegati accettati seguono la conservazione clinica locale, mentre lo
   staging rifiutato/scaduto viene ritirato secondo la policy documentata.

Un futuro drop **dentro la vista MediFlow incorporata** sarebbe distinto dal
compositore, ma il renderer dell'host vedrebbe comunque il file prima del
broker. È escluso dal percorso iniziale raccomandato. Per abilitarlo servono
R, canale di upload autenticato qualificato e decisione esplicita su quel
trattamento; L fallito impedisce di assumere un upload diretto. Un ponte
app-only farebbe transitare anche l'originale nell'host, non risolverebbe il
confine. Il tasto della vista può invece aprire il selettore nativo senza
ricevere i byte del file.

Prima dell'uso, vicino all'azione di importazione, mostrare:
«Carica i documenti nella finestra MediFlow. Se li alleghi a questa chat,
li condividi direttamente con il suo fornitore prima della protezione MediFlow.»
Se l'host segnala un allegato nel compositore, interrompere il percorso di
importazione del plugin e avvisare senza citare il contenuto:
«Questo file è stato allegato alla chat e può essere già stato acquisito dal
suo fornitore. MediFlow non può annullare quell'invio. Rimuovilo dagli allegati
e dalle copie salvate dall'host, se disponibili, e caricalo dalla finestra
MediFlow. La rimozione non garantisce la cancellazione immediata delle copie.»
Non promettere intercettazione se l'host non espone l'evento; l'avviso
preventivo resta necessario. Non scaricare né ripetere il file per “ripulirlo”.
Un'esposizione reale segue la procedura del titolare, senza dichiarare
automaticamente né escludere una violazione dei dati.

## Ricomposizione locale

### Custodia: chiave hardware e mapping sono oggetti diversi

Un componente nativo MediFlow possiede la ricomposizione sul Mac. Per decisione
di Leonardo il mapping vive soltanto in RAM per la sessione autorizzata, con
sottoambiti per paziente, tentativo e payload. Non viene persistito, cifrato
su disco, sincronizzato o salvato nel renderer, nella cronologia o nel processo
MCP. Una nuova sessione crea nuove corrispondenze; non ricostruisce le vecchie
mappe tramite identificatori stabili. Questo non cancella le fonti cliniche.

Una chiave privata generata nel Secure Enclave può proteggere l'accesso al
materiale crittografico della sessione. Il Keychain custodisce riferimenti e
materiale avvolto con policy legata al dispositivo; **il Secure Enclave non
è il contenitore della tabella di corrispondenza**. La chiave hardware non è
esportata; il mapping deve comunque apparire nella RAM del componente
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
mappe in memoria; anche crash, logout, scadenza e riavvio terminano la sessione.
Una copia su un altro Mac non deve riaprire la mappa. Le vecchie chat restano
a pseudonimi; un nuovo contesto può essere generato dalle fonti locali solo
con nuova autorizzazione. Non si cambia il recupero
della cartella previsto da ADR 0143, né si elimina lo storico clinico.

### Percorso verso la vista e qualificazione del canale

Con D3 la vista nella chat riceve soltanto la proiezione pseudonimizzata;
nomi e ricomposizione si mostrano nella finestra nativa MediFlow. Mappa e
chiavi non vengono consegnate al renderer della chat. Un L positivo qualifica
il solo percorso di trasporto provato: non autorizza l'inserimento dei nomi
nella vista inline.

`ui://` non attribuisce origine localhost al renderer. Occorre qualificare
CSP, CORS, Local Network Access, origine effettiva, autenticazione del servizio
e dell'istanza e no-store. Porta locale, `Origin` e nonce pubblicato nell'HTML
non sono da soli credenziali. Un'origine opaca o `null` non giustifica una
allowlist generica. Non si rimuovono i controlli della Web UI, non si aprono
porte LAN/tunnel e non si introduce un proxy generico verso il runtime.

Il percorso scelto conserva soltanto pseudonimi nella chat e mostra la
ricomposizione nella finestra nativa MediFlow; implementazione e prove restano
aperte. Un eventuale bridge di nomi richiede una nuova decisione di trattamento
e relative prove; non è un ripiego autorizzato da D3 o dal PASS del demo.
In ChatGPT `_meta` è documentato come nascosto
al modello, ma visibile all'host; app-only limita la disponibilità del tool,
non dimostra segretezza del risultato. Nessun trasporto così ottenuto può
essere registrato come L positivo. Nel perimetro scelto la ricomposizione
dei nomi inline rimane disabilitata.

## Autorità della vista

### Sessione propria, nascita e ritiro

La vista è un client con concessione propria dell'owner MediFlow, non una
sessione copiata dal browser o derivata dal login Claude/ChatGPT. Si propone:

1. Il pacchetto installato apre una vista statica senza autorità. Un gesto umano
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
Per la prima qualifica sintetica D4 approva una sola operazione per
autorizzazione, 30 secondi per confermarla e blocco della vista dopo 5 minuti
d'inattività, senza rinnovo automatico. La decisione fissa i valori da provare,
non attesta l'implementazione né approva i budget di prestazione.
I marker di scritture già partite sopravvivono al ritiro
come metadati di recupero, senza concedere nuove autorizzazioni.

### Touch ID e PIN nativi: decisione acquisita, non attestazione clinica

La scelta di Leonardo mantiene il comando «Accedi» o «Conferma e registra»
nella vista, ma demanda il gesto biometrico alle API native MediFlow. Touch ID
non «fornisce il PIN»: autorizza un'operazione protetta del componente nativo.
Il ripiego scelto è il PIN nella stessa finestra nativa. Né PIN, né passphrase,
né verificatore riutilizzabile attraversano il renderer.
Il protocollo deve verificare una challenge legata alla sessione e, per la
scrittura, al comando esatto; un booleano `authenticated` dalla vista non vale.

**Obiezione:** Touch ID prova la presenza/autenticazione prevista dalla policy
OS, non l'identità del paziente, il ruolo medico, il contenuto approvato o la
CAS. Un renderer ostile può mostrare una cosa e richiederne un'altra. Si
raccomanda perciò un riepilogo nativo autenticato di paziente e operazione,
ricavato dall'owner, prima del gesto finale. Il flusso nasce e si conclude
nella chat, ma il riepilogo e il prompt OS non sono HTML dell'host. Il contratto
proposto richiede questo riepilogo per impedire una conferma cieca; il solo
messaggio del renderer non attesta il comando approvato.

ADR 0143 non viene cancellato. Per il primo incremento si propone Touch ID
per associare la vista a una sessione nativa già sbloccata e per il successivo
step-up; primo accesso e recupero restano con passphrase v3 nella UI nativa.
Lo sblocco rapido a freddo richiederebbe un nuovo involucro/credenziale protetto
hardware e una decisione specifica su persistenza e recupero. Non si salva
la passphrase o il PIN nel Keychain soltanto per simulare l'accesso esistente.
Anche sostituire il PIN di conferma con una prova nativa richiede un'estensione
esplicita dell'ammissione del writer, mantenendo ruolo e verifiche comuni.

Il PIN di conferma non sblocca la master key v3: il fallback scelto opera su
una sessione già sbloccata e ammessa. Dopo riavvio o perdita della chiave serve
prima la passphrase nella UI nativa. Lo sblocco rapido a freddo resta un lavoro
distinto, senza reinterpretare il PIN come credenziale v3. PIN nel renderer
è escluso; password OS e WebAuthn non sostituiscono tacitamente il ripiego scelto.

Rifiuto, lockout o variazione biometrica portano a un esito esplicito e, quando
ammesso, alla scelta visibile del PIN nativo, con limiti tentativi e verifica
di ruolo/sessione. App nativa assente o hardware non supportato impediscono
l'associazione. Il fallback non amplia automaticamente i requisiti del primo
pacchetto a Mac senza Touch ID.

### Scritture, CAS ed esito incerto

Il modello propone; il medico rivede e conferma nella vista. L'owner rilegge
le fonti correnti, costruisce un comando immutabile e lega l'approvazione a
archivio, sessione, ruolo, paziente, risorsa, valori, versione attesa, nonce e
scadenza. Una modifica dopo l'anteprima invalida la conferma. Il componente
nativo consegna la prova all'ammissione MediFlow, mai al modello o al MCP.
La vista non può firmare autonomamente un consenso del medico.

Si chiamano **lo stesso writer e gli stessi controlli** delle altre UI:
ammissione, versione/CAS, transazione, audit e ricevuta applicabili. Nessun
writer del plugin o accesso diretto al database. La prima scrittura scelta è
un solo cambio stato terapia, attraverso
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

L'app della chat ospita DOM, memoria e pixel della vista pseudonimizzata.
Se in futuro si ammettessero nomi inline, ospiterebbe anche quelli. Può
accedere a quanto mostrato tramite renderer, strumenti di sviluppo, accessibilità, crash
report, telemetria o screenshot. La lettura loopback evita il normale risultato
MCP, non questo trattamento. Cifratura del canale e Touch ID non lo eliminano.
Non è accertata qui la retention effettiva di ogni build/account, né si
attribuiscono acquisizioni automatiche non documentate ai fornitori.

Qualunque scelta di vista fidata comporta accettare, a livello architetturale,
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

## Catalogo delle viste e Intelligence Fabric

Il plugin è un client dei servizi applicativi, non un secondo gestionale.
«Uso completo» richiede una matrice funzione → servizio → vista/azione →
permesso → prova, versionata con il prodotto: nessuna funzione può sparire
perché manca una carta. Le funzioni non ancora ammesse restano visibili come
indisponibili o apribili nella UI nativa, senza dichiarare completata la parità.
Il modello può suggerire una vista; selezione, dati e comandi disponibili
sono decisi dall'owner sulla sessione corrente.

| Domanda o compito | Vista e risposta | Vincolo operativo |
| --- | --- | --- |
| «Apri la scheda completa» | Scheda navigabile con storia, fonti e sezioni caricate su richiesta | Completa per consultazione autorizzata, non invio dell'intera cartella al modello; nomi nella UI nativa. |
| «Mostra le terapie / i farmaci» | Vista mirata, filtri, stato e comandi dinamici | Comandi tipizzati dal catalogo host secondo ruolo, versione e capacità; niente codice o URL prodotti dal modello. Primo write: cambio stato. |
| «Mostra gli ausili» | Vista di protesica con richieste, dispositivi, stato e fonti | Capacità territoriali e workflow reali, senza implicare invii regionali. |
| «Riassumi il paziente» | Risposta breve pseudonimizzata in chat; carta MediFlow opzionale con fonti e approfondimento | Il risultato Fabric viene nuovamente controllato prima di uscire; nomi solo nella ricomposizione nativa. |
| «Che cosa è cambiato?» / esito di un comando | Aggiornamento di stato compatto nella grafica MediFlow | «Registrato» soltanto con ricevuta autorevole; distinguere proposta, rifiuto, attesa ed esito ignoto. |
| «Crea un paziente da questi documenti» | Apertura del caricamento nativo, revisione dei candidati e conferma | Percorso in entrata descritto sopra, nessun allegato nel compositore; niente inserimento al solo drop. |
| «Registra la visita» / «Gestisci l'ambulatorio» | Cattura nativa, bozza rivista e viste operative pertinenti | Audio locale, selezione e scope specifici, scritture confermate separatamente. |

Grafica, temi, accessibilità e linguaggio seguono [DESIGN.md](../../DESIGN.md)
e Lume. Espansioni, filtri e cambio tema aggiornano la carta senza un turno
modello o un rimontaggio globale; preservano focus, posizione della chat e
lettura. Ricevute tecniche non sono testo ordinario dell'interfaccia. Dati
vuoti, revocati, obsoleti o in caricamento devono essere distinguibili.

Il perimetro comprende **tutte le funzioni Fabric disponibili nel deployment**:
Patient Insight, Smart Import, Document Synthesis e Treatment Reasoning,
oltre alle capability del catalogo e alle operazioni future quando ammesse.
Per ciascuna serve un percorso verificato, non un tool generico che esegua
qualunque richiesta. Il catalogo dichiara disponibilità e limiti: AnyDoc è
estrazione locale separata, `ocr=unavailable` non diventa disponibile grazie
al plugin. Nessuna abilitazione implicita di modelli o provider mancanti.

Il broker è indipendente dal modello della chat. L'host MediFlow continua a
scegliere esecutore, modello e policy Fabric secondo i contratti vigenti;
il modello della chat non imposta endpoint, provider, prompt privilegiati o
ripieghi. Una chiamata Fabric locale può produrre un risultato che poi esce
nella chat: l'uscita richiede comunque controllo e consenso. Viceversa, usare
un provider remoto Fabric non autorizza a copiare il suo input o output
nell'host chat. Fonti, ricevuta, validità e natura di proposta accompagnano
il risultato; la chat non si attribuisce l'esecuzione di una funzione non
chiamata. Ogni applicazione clinica resta una scrittura distinta e confermata.

## Prestazioni obbligatorie

I seguenti sono **budget proposti di accettazione**, non misure già ottenute.
Valgono per ogni host dichiarato supportato; non si compensa un host lento
con la media di un altro. Prima di implementare si fissa una fixture sintetica
ripetibile: 100 eventi, 30 terapie, 10 documenti; payload da redigere di 10.000
caratteri e PDF di 10 pagine/10 MiB per la prova import, inclusa una variante
scansionata. Una matrice di carichi maggiori prova paginazione e limiti.

| Operazione e misura | Budget p95 |
| --- | --- |
| Input → feedback visibile di clic, focus o avvio comando | ≤ 100 ms |
| Input → filtro/espansione/tema aggiornato, senza modello | ≤ 200 ms |
| Apertura → vista utile con dati già autorizzati, runtime caldo | ≤ 2 s |
| Apertura → vista utile a freddo, dipendenze già installate | ≤ 5 s |
| Broker: preparazione e controllo dei 10.000 caratteri, runner caldo | ≤ 2 s |
| Fine conferma umana → ricevuta della transizione terapia | ≤ 2 s; oltre il limite si mostra attesa/esito ignoto, mai successo presunto |
| Import: caricamento nativo → candidati pronti per revisione, PDF fixture | ≤ 30 s, avanzamento almeno ogni 1 s |
| Riassunto Fabric fixture → risposta verificata pronta alla visualizzazione | ≤ 30 s, stato visibile entro 1 s; niente streaming di output non ancora controllato |

La baseline proposta è Mac Apple Silicon M2, 16 GiB, macOS compatibile con
l'app; è un profilo di benchmark da confermare con l'hardware supportato,
non una nuova dichiarazione di compatibilità. Registrare chip, RAM, OS,
build host, versioni app/plugin/runner/modello, rete e dimensioni reali.
Almeno 30 esecuzioni per scenario caldo/freddo, p50/p95/massimo, errori e
confronto con la UI nativa; niente sole medie o esclusione dei timeout.
Separare tempi di modello/rete, host, broker e rendering, ma riportare anche
il totale percepito. Il tempo umano di consenso/Touch ID è separato, non
sottratto nascostamente; anche l'attesa di quota resta un esito riportato.

Animazioni brevi (120–200 ms), rispetto di Reduce Motion, nessun salto di
scroll e nessun blocco del thread UI oltre 50 ms attribuibile al widget nel
percorso misurato. Il superamento dei budget impedisce la qualifica della
funzione su quell'host: si ottimizza o si propone esplicitamente un budget
rivisto prima dell'accettazione. Non si tagliano redazione, audit, controlli
o conferme per guadagnare tempo. Cache di asset statici e proiezioni in RAM
restano legate a sessione/revisione; nessun prefetch clinico fuori scope.

## Chat temporanee e retention

L'opzione «Usa una chat temporanea» va proposta prima del primo invio, solo
se la modalità esiste e funziona con il plugin nel client scelto. Se il plugin
non può aprirla o rilevarla, guida l'utente e indica che lo stato non è
verificato; non converte silenziosamente la conversazione in uso.

Le fonti ufficiali del 22 ottobre distinguono:

- [ChatGPT Temporary chat](https://help.openai.com/en/articles/8914046-temporary-chat-in-chatgpt):
  può conservare una copia fino a 30 giorni per sicurezza; salvarla la rende
  ordinaria. La modalità senza personalizzazione esclude i plugin, quella
  personalizzata può usare memorie e plugin: la compatibilità effettiva con
  Codex desktop e questo pacchetto va provata, non dedotta dal nome.
- [Claude Incognito](https://support.claude.com/en/articles/12260368-use-incognito-chats):
  assenza dallo storico e dal training non significa assenza di conservazione;
  la documentazione indica 30 giorni, o più secondo la policy Enterprise,
  e possibili export/compliance organizzativi. La modalità è fuori dai progetti.
- [Retention ChatGPT di chat e file](https://help.openai.com/en/articles/8983778-chat-and-file-retention-in-chatgpt):
  le copie nella Library possono sopravvivere alla cancellazione della chat.
  [Anthropic consumer](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data)
  e [commerciale](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
  hanno condizioni distinte per cronologia, training, cancellazione ed
  eccezioni di sicurezza/legge; le condizioni API non si trasferiscono alle chat.

Per ogni deployment registrare account/workspace, piano, regione contrattuale,
training, memoria, file, export amministrativi, diagnostica, tempi e deroghe
di conservazione, cancellazione e subfornitori. Nessun generico «zero retention»
è ammesso senza un accordo applicabile a **quel prodotto e quel canale**.
La modalità temporanea è facoltativa e non sostituisce questi controlli,
la pseudonimizzazione, il caricamento nativo o l'audit clinico locale.
Terminare la chat ritira la sessione quando osservabile; la lease locale
scade comunque. Non ripristina mappe e non annulla scritture già registrate.

## Pubblicazione per terzi

La pubblicazione richiesta è parte del perimetro, coordinata con WUL-759.
Questo round prepara il contratto; non esegue submission o distribuzione.
Si distinguono tre risultati: pacchetto distribuibile, approvazione dello
store/directory, ammissione clinica del deployment. Nessuno prova gli altri.

### Pacchetto e installazione

Il pacchetto pubblico contiene manifest, adapter MCP, viste statiche, skill,
launcher, dipendenze necessarie, licenze e istruzioni. **Nessun dato paziente,
nessuna chiave, credenziale, mapping, configurazione personale o archivio.**
Esempi e account di review usano soltanto fixture sintetiche isolate e
identificate; non si incorporano sessioni o credenziali dei revisori nel ZIP.
Anche screenshot, log di supporto e nomi dei file pubblicati sono sintetici.

Restano locali: archivio e allegati, estrazione/OCR, broker, mapping in RAM,
chiavi e credenziali nel loro confine nativo, writer, audit e ricevute durevoli.
Possono uscire solo le proiezioni esplicitamente ammesse ai destinatari
scelti; installare un pacchetto locale non rende locale il modello host.
Il publisher non riceve cartelle, backup o telemetria clinica per installazione.

Il primo profilo proposto richiede **Mac, app MediFlow compatibile installata,
Touch ID configurato e componente nativo qualificato**; PIN nativo come
ripiego sulla sessione già sbloccata. La scheda pubblica deve indicare versioni
minime effettivamente provate, requisiti dei runner opzionali e account host
ammessi. Installazione pulita, avvio, aggiornamento e disinstallazione vanno
provati senza l'ambiente dello sviluppatore. L'assenza di app/hardware/versione
non abilita un accesso più debole. Non si pubblicizza supporto Windows, Linux,
web o di tutti i Mac senza prove; CLI e desktop hanno capacità distinte.

### Regole ufficiali delle directory

- **OpenAI:** le [Plugin Guidelines](https://developers.openai.com/plugins/plugin-guidelines)
  vietano raccolta, richiesta o trattamento di PHI e altri dati riservati;
  chiedono inoltre disclosure e privacy policy. Dato sanitario GDPR e PHI
  non sono categorie equivalenti: la pseudonimizzazione non prova una deroga.
  La candidatura sanitaria va valutata rispetto alle regole effettive, senza
  nasconderne l'uso sotto un pacchetto vuoto o sintetico.
  Il percorso [desktop-only](https://developers.openai.com/plugins/deploy/desktop-only)
  ammette MCP locali soltanto per partner approvati, con organizzazione in
  allowlist, test di installazione e review. Non è dimostrata qui l'idoneità
  di MediFlow a quel programma. Non si crea un tunnel/HTTPS remoto per
  aggirare il vincolo. La [submission](https://developers.openai.com/plugins/deploy/submission)
  richiede materiali di review, casi positivi/negativi, dimostrazione e
  credenziali di test separate; approvazione e pubblicazione sono passaggi distinti.
- **Anthropic:** la [submission connector](https://claude.com/docs/connectors/building/submission)
  richiede un server remoto HTTPS; un server locale va incluso in un plugin.
  Per questo disegno si valuta quindi il percorso
  [Submit your plugin](https://claude.com/docs/plugins/submit): repository e
  manifest, domande sul trattamento, scansioni per versione e review prima
  della pubblicazione secondo lo stato assegnato. Un connector remoto sarebbe
  un'altra architettura, non una riconfezione equivalente. R FAIL nella build
  osservata impedisce di dichiarare le viste inline qualificate per Claude.
- **MCP:** la [specifica Apps](https://modelcontextprotocol.io/extensions/apps/overview)
  descrive il protocollo e la sandbox dell'host. Compatibilità MCP, presenza
  in un registry e successo di un tool non sono approvazioni delle directory
  OpenAI/Anthropic né certificazioni per trattare dati sanitari.

Prima della submission servono privacy policy e termini corrispondenti ai
flussi effettivi, contatto di supporto/sicurezza, istruzioni d'installazione,
matrice di compatibilità e prove sintetiche riproducibili per i revisori.
Se il percorso di review non consente Touch ID e setup locale, si concorda
una modalità di prova sintetica col reviewer: nessun bypass in produzione.
Se una directory non ammette il trattamento, si sospende quella candidatura;
una distribuzione esterna resta soggetta ai termini applicabili, non li elude.

### Ruoli e responsabilità

Il deployment deve identificare chi determina finalità e mezzi e chi tratta
per suo conto: ente sanitario, professionista, gestore dell'installazione,
publisher e provider non hanno un ruolo deducibile dal nome del software.
La sola pubblicazione del pacchetto non assegna al publisher il ruolo di
responsabile dei dati clinici; supporto con accesso ai dati, servizi remoti o
telemetria richiedono una valutazione distinta. Per i provider host vanno
verificati ruoli e accordi effettivi per ciascuna finalità, non presunta una
relazione di responsabile per qualsiasi account consumer.

Il responsabile del deployment documenta base giuridica e condizione per i
dati sanitari, informativa, autorizzazioni degli operatori, eventuali accordi
di trattamento, trasferimenti, conservazione, diritti, risposta agli incidenti
e necessità di una valutazione d'impatto. Il consenso nel widget è un controllo
operativo; non sostituisce tale valutazione. Il riferimento è il
[GDPR e le responsabilità applicabili](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en),
non una dichiarazione legale di conformità del plugin.

Sono vietati claim di anonimato, invisibilità dei dati all'host, assenza
assoluta di retention, conformità GDPR/HIPAA automatica, approvazione clinica
implicita nello store, filtro preventivo dei file nel compositore o parità
funzionale già raggiunta. Sono vietate anche promesse di compatibilità con
ogni host, cifratura totale o autonomia clinica senza le prove e i limiti
previsti dai contratti MediFlow. La documentazione deve distinguere feature
proposta, implementata, provata, distribuita e ammessa all'uso concreto.

### Versioni, aggiornamenti e revoca

Versionare pacchetto, protocollo broker, schemi dei tool e delle viste,
manifest delle capacità e combinazioni app/host qualificate. Un cambiamento
incompatibile richiede nuova versione maggiore e URI della risorsa UI nuovo;
nuove destinazioni, dati o permessi richiedono nuova revisione e consenso.
L'owner nega combinazioni non ammesse, senza fidarsi solo della versione
presentata dal renderer; il bootstrap locale verifica identità e integrità
del pacchetto. Gli aggiornamenti non ampliano scope delle sessioni attive.

Revoca locale: disabilitare il plugin ritira grant, mapping e richieste non
ancora ammesse; i comandi già inviati si riconciliano tramite ricevuta, senza
cancellare audit o record. Il publisher può ritirare una versione/listing e
pubblicare un avviso; ciò non elimina copie già installate o dati nell'host.
Il deployment deve poter negare versioni vulnerabili mediante policy locale
aggiornabile, preservando il recupero dei dati. Qualunque feed di aggiornamento
ha autenticità, frequenza e validità esplicite e non invia dati clinici; offline
non si promette una revoca remota istantanea. Per usare dati reali serve una
policy non scaduta, oltre all'ammissione clinica e contrattuale separata.

## Sequenza di unità e verifica attesa

Ogni unità produce evidenza sintetica legata a commit, pacchetto, host/build,
account di prova e carico. Quanto segue è **prova futura**, salvo gli esiti
R/L registrati sopra. I numeri 1–5 conservano i riferimenti del primo round;
la vecchia unità 6 viene distinta in 6–10. Le sotto-unità 2a–2c già avviate
restano nello stesso posto e non sono dichiarate consegnate da questo ADR.

1. **R/L e rifinitura.** Riutilizzare gli esiti ottenuti; su Codex correggere
   scroll, ricevuta visibile e fasce laterali e misurare i budget. Su Claude
   riprovare dopo un cambiamento identificato del percorso host, con controllo
   ufficiale, senza qualificare il desktop tramite CLI/reference host.
   **Prova:** navigazione, tastiera, temi, due larghezze, riapertura e profiling;
   risposta testuale non passa R. Tenere L FAIL separato: niente wildcard,
   modifica del validatore o sentinella nel risultato tool per farlo passare.
2. **Broker e lettura pseudonimizzata.** 2a: nucleo di preparazione indipendente
   dal provider, senza cambiare i quattro adapter esistenti. 2b: profilo chiuso
   scheda, owner sintetico, consenso sui byte finali, corpus annotato. 2c: tool
   read-only e vista statica alimentata soltanto dall'uscita approvata.
   **Prova:** equivalenza del contenuto clinico, provenienza e tutti i canali
   osservabili, incluso turno successivo. Terzi, CF OCR, luoghi, nascita,
   filename, campi sconosciuti, runner/report invalidi e cambio paziente devono
   bloccare l'uscita. Un falso negativo del corpus blocca la promozione.
   Per il solo prototipo sintetico 2c, la risorsa senza dati clinici consegna
   una volta per sessione MCP una chiave casuale alla closure del controllo;
   il bundle rimuove subito il proprio script dal DOM. Ogni preparazione emette
   una challenge distinta, monouso e valida 30 secondi, legata al tentativo e
   al digest conservato dall’owner. La conferma richiede challenge e firma HMAC-SHA-256,
   generata soltanto dal listener `isTrusted` del controllo dedicato. La
   chiave non attraversa i tool; una firma osservata non vale per un altro nonce. La sola
   challenge disponibile nei messaggi non concede il consenso; la risorsa
   non è rileggibile nella stessa sessione. La riapertura richiede pertanto
   una nuova sessione MCP, da qualificare sui desktop. Il confine del tool `share` copre i
   messaggi forgiati dopo il bootstrap fidato, non codice arbitrario nel frame
   né l’host che può controllare renderer o caricamento: non è autenticazione clinica né una
   prova crittografica di gesto verso un host ostile. Revoca e nuovi tentativi
   invalidano sincronicamente l’epoca; l’owner ricontrolla l’epoca subito
   prima dell’uscita, senza attese intermedie.

   Il canale `ui/update-model-context` è fidato quanto il frame: il bridge MCP
   Apps non verifica HMAC, nonce o consenso del broker e accetta anche byte
   arbitrari inviati da codice che controlla il frame. Questi meccanismi
   proteggono soltanto l'accesso a `share`, non il canale di contesto.
   La garanzia è che il frame non riceve dati MediFlow non approvati:
   risorsa UI senza dati, `prepare` con sola challenge, errori e revoche fissi,
   nessuna risorsa di fonti o mappe. Dopo una revoca non si possono ritirare
   byte già approvati e ricevuti. Un frame compromesso può inviare byte propri
   o già approvati; questo non dimostra un'esfiltrazione dal broker.
   La risorsa contiene solo il bundle locale (SDK incluso), senza script remoti;
   una CSP con hash del bundle per istanza vieta script aggiunti ed eval,
   connessioni e risorse esterne. Gli stili dinamici dell'host restano ammessi.

   Ogni `share` restituisce byte approvati e un identificatore casuale del
   tentativo. Prima di aggiornare il contesto, la vista chiama `deliver`:
   l'owner verifica vista, tentativo corrente, generazione, scadenza e stato
   approvato, e consuma l'autorizzazione sincronicamente. Chiusura, revoca e
   nuova preparazione invalidano il tentativo prima di qualsiasi attesa.
   Una risposta `share` trattenuta e rilasciata dopo una chiusura completata
   non autorizza quindi un invio; errore, conferma mancante o discordante
   chiudono la vista senza aggiornare il contesto.

   Resta una finestra distribuita fra il consumo atomico di `deliver` sul
   server e l'invio al bridge: una chiusura che avviene in quella finestra
   (anche mentre la risposta `deliver` è trattenuta) non è osservabile senza
   una nuova comunicazione. Aggiungere altre conferme sposta la finestra,
   non la elimina. L'autorizzazione si linearizza al consumo server; una
   consegna già autorizzata lì può arrivare dopo una chiusura successiva.
   Solo un host che verifica e consuma il tentativo insieme all'accettazione
   del contesto può garantire un ordine globale rispetto alla chiusura.
   Questo limite resta esplicito nel prototipo sintetico e non qualifica
   l'uso clinico o l'invio a un LLM desktop.
3. **Canale per host e ricomposizione nativa.** Implementare il percorso
   raccomandato; provare app-only su dati pseudonimizzati dove R è disponibile.
   **Prova:** tool non disponibile al modello, risultati non reinseriti nel
   suo contesto, errori/notifiche/state controllati, sole mappe RAM. Token
   estraneo, altra sessione, lock, refresh e riavvio negano ricomposizione;
   vecchie chat restano a pseudonimi. Nessun nome nel bridge. Su Claude senza R
   verificare il ripiego nativo, dichiarando il requisito inline ancora aperto.
4. **Accesso nativo.** Touch ID e ripiego PIN scelti, riepilogo autenticato,
   challenge e grant limitato. Le unità 2–3 precedono questa solo su fixture.
   **Prova su Mac reale:** primo sblocco v3, sessione calda, rifiuto/lockout,
   assenza hardware/app, revoca e chiusura. Replay, istanza diversa, booleano
   forgiato e cambio archivio negati; nessun segreto in chat, tool, URL o log.
5. **Prima scrittura: stato terapia.** Prima implementare comando/ricevuta
   durevoli e coordinamento fra client; poi anteprima, conferma, step-up,
   writer comune, CAS, transazione e audit.
   **Prova:** paziente/versione/payload cambiati, doppio clic, replay, crash
   prima/dopo commit, risposta persa, reload e concorrenza Web/Claude/Codex.
   Un solo effetto auditato; esito ignoto resta tale, senza retry automatico.
6. **Paziente da documenti.** Dopo broker, accesso e contratto comune di scrittura:
   caricamento nativo, estrazione, Smart Import, revisione e creazione.
   **Prova:** PDF testuale/scansionato, documento misto con più identità,
   duplicato, campo incerto, istruzioni ostili, errore OCR, annullamento e
   crash. Nessun record parziale dichiarato riuscito, nessun merge implicito;
   allegato nel compositore produce l'avviso senza download/ripetizione.
   Ispezionare separatamente byte in entrata, uscita provider e ritorno in chat.
7. **Fabric completo e risposte.** Patient Insight, Document Synthesis,
   Treatment Reasoning e percorso Smart Import già introdotto, più ogni
   capability ammessa nel catalogo. Una prova per funzione e venue supportata.
   **Prova:** riassunto in chat con fonti, controllo di uscita anche sui risultati
   locali, provider indisponibile, output malformato/token estraneo, contesto
   scaduto, revoca durante generazione. Nessun ripiego o applicazione silenziosa;
   tempi end-to-end e costo del controllo nei budget.
8. **Catalogo interattivo e parità.** Scheda completa, terapie/farmaci,
   protesica, riassunto e stato nella grafica MediFlow; ampliare i comandi
   soltanto dopo le prove del relativo writer.
   **Prova:** matrice delle funzioni senza omissioni, filtri e comandi dinamici
   coerenti con ruolo/versione/capacità, fonti accessibili, confronto con UI
   nativa, stati vuoti/stale/revocati, tastiera e budget su ogni host supportato.
9. **Voce e ambulatorio.** Incrementi distinti sui servizi comuni: cattura e
   trascrizione Apple locali, revisione, poi scritture e workflow operativi.
   **Prova:** microfono negato, cambio paziente, identificativi pronunciati,
   bozza non rivista, altra selezione, capacità territoriale disattiva. Audio
   grezzo fuori dal modello; niente azioni esterne non ammesse. Agenda interna,
   candidati da calendari e prenotazione confermata rimangono stati distinti.
10. **Chat temporanea e distribuzione.** La valutazione delle policy/directory
    precede ogni uscita reale e può procedere durante le unità sintetiche;
    questa unità chiude packaging, onboarding, compatibilità e review.
    **Prova:** modalità temporanea disponibile/non disponibile e retention
    dichiarata correttamente, installazione pulita senza dati/chiavi, versioni
    incompatibili negate, upgrade e revoca senza perdita di audit, materiali
    sintetici per store e verifica dei budget. Pubblicare solo le capacità
    provate; nessun listing dichiara superata R su Claude senza nuova evidenza.

La parità completa e la qualifica di entrambi i desktop restano obiettivi:
la consegna di un sottoinsieme non chiude WUL-788. Accettazione dell'ADR,
review del codice futuro, pubblicazione e ammissione clinica restano separate.

## Decisioni ancora aperte per Leonardo

Le scelte Touch ID/PIN **nativi**, prima scrittura **stato terapia**, mapping
**solo di sessione** e D3 **nomi solo nella finestra nativa** sono acquisite.
Anche le durate D4 per la prima qualifica sintetica sono approvate, senza
attestare implementazione o budget. La numerazione resta quella del
[registro 0.9.1](../releases/0.9.1-contract.md#decisioni-e-dipendenze-esterne):

1. Fissare versioni minime OS/app/host e hardware compatibile, nel profilo Mac
   con Touch ID previsto; lo sblocco rapido a freddo resta escluso dal primo incremento.
2. Scegliere fasce d'età e criteri per età/date precise, con limiti di utilità
   e riconoscibilità; nominare account/workspace e trattamenti ammessi prima
   di dati reali, compresi screenshot, strumenti host, memoria e retention.
3. **D3 decisa il 25 ottobre:** nomi solo nella finestra nativa MediFlow,
   pseudonimi nella chat e corrispondenze solo in RAM per la sessione. Restano
   da accettare implementazione e prove; un futuro bridge di nomi richiede
   una decisione separata sul trattamento da parte dell'host e relative prove.
4. **D4 parzialmente fissata il 25 ottobre:** per la prima qualifica sintetica,
   una sola operazione per autorizzazione, 30 secondi per confermarla, blocco
   dopo 5 minuti d'inattività, nessun rinnovo automatico. Restano aperti i
   budget proposti dopo baseline e l'accettazione dell'implementazione.
5. Scegliere, dopo la verifica di idoneità, i canali pubblici e il perimetro
   dichiarabile; il responsabile del deployment decide l'ammissione clinica
   e contrattuale. Il desiderio di pubblicare non prova l'approvazione store.

## Fonti e limiti della ricognizione

- Rapporti locali `wul788-codex-rl-20261022.md` e
  `wul788-desktop-rl-20261022.md`: esiti sintetizzati nella matrice R/L.
  Prevalgono gli addendum successivi: CLI autorizzata PASS e checklist manuale
  R PASS. Diagnosi Claude A/B e commenti Linear collegano le evidenze; log,
  screenshot grezzi e configurazioni restano privati. Nessuna nuova prova
  desktop è stata eseguita durante questo secondo round documentale.
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
- Specifica MCP Apps draft, riferimenti OpenAI UI/visibility, linee guida e
  submission OpenAI (incluso desktop-only), submission Claude connector/plugin,
  pagine di retention/chat temporanee e fonte della Commissione europea
  collegate sopra: ricontrollate il 22/10/2026 per questo round. Le condizioni
  vanno ricontrollate alla submission e all'ammissione del deployment.
  Nessuna deduzione di ammissione clinica o pubblicazione dalla sola tecnica.

Autoria dell'ADR e della ricognizione: **GPT-6-Astra, High, via Codex/T3**,
senza delega. Brief iniziale del coordinatore Opus; coordinamento corrente
Astra. La revisione del coordinamento resta distinta dalla stesura: lo stato
rimane Proposed. Il secondo round integra gli esiti riferiti dal pilota e da Leonardo, senza
attribuirsi la loro esecuzione. Nessuna modifica di codice o ammissione clinica.
