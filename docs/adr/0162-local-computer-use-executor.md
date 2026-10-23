# ADR 0162 — Esecutore locale per procedure clinico-amministrative

- Stato: **Proposed**
- Data: 2026-10-23
- Autore: Astra
- Ambito: filone CU, in coda al programma 0.9.1; solo progetto documentale in questa PR.
- Collegamenti: [analisi/dipendenze](../analysis/2026-10-23-computer-use-procedures.md), [contratti](../analysis/2026-10-23-computer-use-procedure-contracts.md), [fonti](../analysis/2026-10-23-computer-use-sources.md), [contratto 0.9.1](../releases/0.9.1-contract.md).

## Contesto

Le procedure ripetibili richiedono identità e valori reali nel portale destinatario, senza farli passare nella chat. Il modello remoto non deve diventare custode dell'identità, arbitro delle scelte cliniche o possessore di credenziali. Il lavoro materiale può comprendere l'intero percorso autorizzato; una conferma per ogni clic non è necessaria né sufficiente a proteggere l'atto.

Il profilo local-ui naviga soltanto. Il broker chat è sintetico e controlla il contenuto condiviso, non l'intero harness. I servizi territoriali governano le capacità; preparazione e redazione AI governano alcune uscite testuali, non tutte le superfici del computer use. Manca un esecutore di procedure con autorizzazione locale, stato durevole, riconciliazione e controllo sistematico delle uscite.

L'[ADR 0160](./0160-mediflow-in-desktop-chat.md) resta invariato: conferme Touch ID/PIN native, mapping soltanto in RAM di sessione, nessun bridge di nomi come ripiego, direzione di ricomposizione nativa e relativa decisione D3, prima scrittura CHAT sullo stato terapia. I relativi gate e le decisioni ancora aperte non diventano implicitamente accettati. CU non introduce una nuova mappa persistente o un nuovo database clinico.

Sono conservate l'autorità territoriale dell'[ADR 0158](./0158-territorial-packs.md) e la separazione della navigazione dell'[ADR 0159](./0159-plugin-local-ui-navigation.md). Le porte e il ciclo di vita proposti nell'[ADR 0161](https://github.com/Wulfgardr/mediflow/blob/33476d6134af38d0c16d37447bf924e0b203b0cd/docs/adr/0161-gpui-host-ports-lifecycle.md) non fanno coincidere sessione, consenso e grant. Una cancellazione dopo un effetto esterno non è un rollback.

## Alternative considerate

| Alternativa | Vantaggio | Limite e scelta |
| --- | --- | --- |
| Computer use remoto sulla pagina clinica | Adattamento rapido a UI variabili. | DOM, screenshot, OCR e strumenti generici possono esporre identità e contenuto. Non soddisfa la modalità 1; non scelto come esecutore CU. |
| Screenshot oscurati e identità in `_meta`/iframe | Nasconde parti al modello nel percorso più evidente. | Oscuramento incompleto e host che trasporta i byte; non protegge gli altri canali. Non scelto come confine di riservatezza. |
| Solo API istituzionali | Contratti più espliciti e potenziale idempotenza lato servizio. | Disponibilità/ruoli/qualificazione non equivalgono alla GUI. Rimane un futuro trasporto ammesso, senza bloccare i simulatori UI. |
| Esecutore locale deterministico con contratti e nativo fidato | Valori risolti e controllati localmente; modello limitato a intenti opachi; procedura separata dal trasporto. | Richiede adapter versionati, gestione dell'incertezza e qualifica dell'isolamento. **Alternativa raccomandata.** |

## Decisione proposta

### 1. Componenti e responsabilità

Il plugin CU è un ingresso sottile e distinto da `mediflow-local-ui`. Non amplia il suo schema. Il modello chiede di aprire, riprendere o verificare una operazione locale mediante riferimento opaco. La scelta di paziente, pratica e procedura avviene nella UI nativa; i valori clinici derivano dai servizi e dalle indicazioni confermate del medico.

Un coordinatore locale risolve le autorità e il piano. Un esecutore locale applica il contratto attraverso un adapter UI: osserva soltanto la superficie autorizzata, inserisce nei campi classificati e rilegge il risultato. L'eventuale OCR è locale, su regioni previste e con soglia di affidabilità esplicita; ambiguità interrompe il passo. Non è necessario un modello generativo remoto per l'esecuzione. Un diverso componente locale di ragionamento richiederebbe un confine e prove propri.

L'adapter non riceve funzioni universali esposte al modello quali `getPage`, `fillAny`, `eval`, URL o selettori arbitrari. Navigazioni e campi appartengono al manifest locale. Le destinazioni comprendono origine, percorso/operazione consentiti, contesto istituzionale e classe di allegati, non soltanto un dominio. Redirect, popup, frame e download vengono verificati prima di acquisire o inviare valori; redirect verso autenticazione ammessa sospende la compilazione e demanda il login al flusso nativo.

I servizi MediFlow mantengono scrittura e audit. Il confine trasporto/procedura permette un adapter API futuro solo per canali ufficiali, disponibili e ammessi al ruolo. Nessun endpoint privato, estrazione di sessioni o bypass di qualificazione.

Il browser dell'esecutore deve verificare anche le destinazioni delle richieste originate dalla pagina: fetch, WebSocket, beacon, form, risorse e service worker. Ammettere il documento principale non ammette tutte le sue terze parti. Il manifest identifica i destinatari necessari del servizio e le policy del profilo isolato; richieste non classificate sospendono l'immissione dei valori. Cache, cronologia, download, sincronizzazione e crash report del browser rientrano nel perimetro locale di conservazione e isolamento. Questi requisiti non autorizzano modifiche alla rete aziendale; un servizio incompatibile resta non qualificato.

### 2. Riferimento pubblico e capability locale

Il riferimento esposto al modello è casuale con almeno 128 bit di entropia, privo di payload decodificabile, non derivato da codice fiscale o altro dato, non globale e non riutilizzato fra sessioni. Non è la capability e il suo possesso non autorizza un'azione. La tabella di risoluzione vive in RAM della sessione e si distrugge alla chiusura/revoca. Alla ripresa di una pratica durevole si emette un nuovo riferimento.

La capability effettiva rimane nel componente fidato e lega almeno:

- installazione/archivio e relativa generazione; sessione e client autenticato;
- operatore corrente, paziente locale, pratica e operazione durevole;
- procedura e versione del contratto, adapter/UI/catalogo e revisione delle capacità territoriali;
- operazioni, campi, documenti e destinazioni ammessi;
- versione dei dati e impronta del piano esatto approvato, calcolata localmente;
- istante di emissione, scadenza, inattività se pertinente, epoch di revoca e consumo per l'atto.

Le durate saranno coerenti con D4/C-4/C-5 dell'ADR 0160: nessun rinnovo implicito o scelta nascosta di nuovi valori. Prima di ogni risoluzione e immediatamente prima dell'atto si verificano tutti i vincoli correnti. Cambio di paziente, scheda, pratica, account portale, sessione, dati, destinazione o capacità invalida il piano. Ritardi e callback della vecchia generazione sono ignorati e non restituiscono contenuto. Il client autenticato non può scegliere da solo un'identità di operatore.

Il registro durevole della pratica contiene gli identificativi interni necessari al recupero, secondo i servizi di conservazione esistenti. Non conserva i riferimenti remoti, la mappa di pseudonimi o le vecchie prove riutilizzabili. Ripristino da backup o riavvio conserva gli esiti, non riattiva autorità scadute; un tentativo non risolto resta da riconciliare.

### 3. Modalità 1: elenco chiuso dei messaggi remoti

Protocollo **proposto**, non tool già disponibile. Un unico nome generico, `mediflow.local_operation.v1`, descrizione statica senza elenco di patologie o procedure. Input: `action` enum `open | resume | status`, eventuale `ref` nel formato casuale previsto; niente altri campi. `open` apre la selezione locale, non crea automaticamente una pratica. Le richieste errate ricevono una risposta fissa, senza eco dell'input.

Unico oggetto di risultato ammesso:

```json
{"schema":"mediflow.local-operation.v1","status":"continue_in_mediflow","ref":"<riferimento-casuale-di-sessione>"}
```

`status` appartiene esclusivamente a `continue_in_mediflow`, `local_processing`, `local_result_available`, `unavailable`. `ref` è omesso quando non ancora emesso o non valido; nessuna ulteriore chiave. Nessun messaggio libero, conteggio prestazioni, tipo di procedura, motivo di sospensione, titolo, diagnosi, esito clinico, ricevuta, hash del contenuto, nome file, URL o stato specifico del portale. `local_result_available` significa solo “consultare localmente”, non “atto riuscito”.

Le sole altre uscite del server sono: handshake MCP con nome/versione/capacità statici; elenco del singolo tool con schema statico; risposte JSON-RPC di protocollo con codici/messaggi costanti e ID di correlazione validati e limitati. Nessuna `resources`, prompt dinamico, notifica di progress, log remoto, `_meta` dinamico, widget con dati o traceback. Il trasporto deve rifiutare ID/parametri arbitrari prima che possano essere riflessi nei log. I log di avvio/errori dell'esecutore esposti all'host usano codici fissi senza percorsi o dati di contesto. Gli identificativi di trasporto devono essere indipendenti dal paziente.

Si prova l'intero traffico, non solo `content`. Il budget dei messaggi e il polling sono limitati per evitare di codificare valori nei tempi o nella sequenza di stati; i dettagli degli errori restano nel nativo. Anche con questo controllo rimangono inferenze da uso, frequenza e contesto preesistente dell'host: il claim è **assenza dei valori nel protocollo ammesso**, non anonimato o assenza universale di informazioni sanitarie.

### 4. Modalità 2: proiezione clinica approvata

È un ingresso separato e facoltativo, non un ripiego automatico quando la modalità 1 fallisce. Riusa emission plan, redazione e mapping di sessione esistenti; applica C-B/C-L, scelta della funzione/venue e revisione nativa dell'esatto payload prima dell'uscita. La mappa non viene inviata. Ricomposizione solo nella superficie nativa proposta da ADR 0160, senza presentarla come decisione D3 già approvata.

Identificativi diretti, date/luoghi non necessari, terzi, originali e combinazioni rare richiedono minimizzazione o blocco secondo la policy approvata; riconoscibilità residua dichiarata. Fallimento del redattore, evidenza scaduta/non pertinente, token ignoti o testo non classificato impediscono l'emissione. Il risultato del modello è una proposta: non diventa valore del piano senza revisione del medico e invalidazione della precedente autorizzazione. Questa modalità non amplia capability, destinatari o atti consentiti.

### 5. Controllo prima di ogni uscita

| Superficie | Controllo locale richiesto |
| --- | --- |
| DOM, albero di accessibilità, tooltip, testo nascosto | Rimangono nel processo esecutore; proiezione soltanto dei campi classificati necessaria al controllo locale. Nessun dump remoto. Campo inatteso blocca il passo e l'uscita. |
| Screenshot, video, OCR | Modalità 1 non ne emette. Diagnostica con dati soltanto nel nativo protetto; nei report di sviluppo usare fixture inventate. Modalità 2 non autorizza immagini grezze: eventuale contenuto deve passare dal contratto di preparazione specificamente ammesso. |
| URL, navigazioni, referrer | Destinazione locale in allowlist; query, fragment, path variabili e cronologia non sono risultati MCP. Bloccare navigazioni inattese e impedire trasferimenti a origini non autorizzate. |
| Clipboard | Niente clipboard generale per i valori CU; usare il canale locale di inserimento previsto dall'adapter. Una clipboard sincronizzata o leggibile dall'harness impedisce il claim di isolamento esteso. |
| File, PDF, download, nomi e metadati | Acquisizione/importazione e upload nel componente locale; classi e contenuti ammessi, origine e impronta verificate. Nessun percorso, nome o allegato nella chat. Area di lavoro non sincronizzata e non leggibile dall'harness. File non previsto sospende. |
| Notifiche, log, errori, telemetria, crash report | Uscita pubblica con codici fissi; nessun testo di pagina o errore del portale riflesso. Registri locali con accesso/retention espliciti nei servizi esistenti; nessun invio diagnostico implicito. |
| MCP, iframe, callback e turni successivi | Stessa allowlist su `content`, `structuredContent`, `_meta`, notifiche e canali UI. Modalità 1 non usa iframe clinico. Revoca/generazione controllate anche sulle risposte tardive. Impossibile ritirare byte già consegnati al provider: evitare l'uscita, non promettere cancellazione retroattiva. |

Pagina e documenti sono dati non fidati. Un testo che chiede invio altrove, cambio paziente, esecuzione di comandi o modifica dei controlli non è un'istruzione. Anche script, nuovi elementi, frame e nomi di file non possono modificare manifest o autorità. Il controllo locale non deve copiare messaggi ostili nel contesto remoto per chiedere cosa fare.

### 6. Confine dell'harness e client supportabili

Un plugin non è un sandbox del client. Istruzioni nelle skill, modalità read-only, conferme d'uso e strumenti nascosti dal modello non dimostrano che host/provider non possano leggere dati. L'[analisi](../analysis/2026-10-23-computer-use-procedures.md) distingue i client e le prove storiche.

Per un claim esteso all'harness occorre una configurazione verificata che esponga solo l'ingresso CU, senza shell/file/browser/screenshot/clipboard alternativi, MCP aggiuntivi, hook o deleghe con maggiori poteri. Il processo remoto deve essere separato dal profilo browser clinico, archivi, IPC privilegiati, credenziali, schermo e directory di lavoro mediante un confine OS effettivo (ad esempio identità OS/ambiente separato con IPC ristretto); eliminare tool dall'elenco non basta se lo stesso processo può accedere alle risorse. Verificare anche configurazioni ereditate e sessioni riprese.

Su desktop con strumenti generici non confinabili, dichiarare garanzia del solo canale CU e continuare nel nativo; non dichiarare protezione dell'intero host. Se il requisito dell'uso concreto è impedire anche l'accesso dell'host, quel client/configurazione resta non ammesso fino alla prova dell'isolamento. Le CLI sono candidate a un profilo ristretto, non una dimostrazione già acquisita. Nessun diniego viene aggirato con shell, file o screenshot generici.

### 7. Medico, concorrenza e autorizzazione dell'atto

Il medico conserva decisione clinica, revisione dei valori e dichiarazioni personali. La prova di approvazione è emessa dalla superficie nativa dopo la conferma prevista; né testo in chat né booleano del modello possono crearla. È monouso e legata al piano esatto, paziente, pratica, operatore e destinazione. Il grant per eseguire clic materiali non sostituisce firma o credenziale del portale.

L'esecutore possiede una lease esclusiva sulla sola superficie di lavoro interessata. Input umano, cambio scheda/focus rilevante o modifica del medico sospendono prima del prossimo comando. Alla ripresa si rilegge uno snapshot coerente, si confrontano tutti i vincoli e si invalida la prova se il contenuto è cambiato. Il medico può sospendere deliberatamente in qualsiasi fase; l'esecutore non interpreta tale scelta come errore da correggere o motivo per ricreare la pratica.

Prima dell'atto si rileggono identità, pratica, dati, account e stato autorizzativo. Osservare il focus non rende atomico un clic su un portale esterno: se una corsa con modifica umana o una transizione del portale non può essere esclusa in modo verificabile, l'ultimo passo resta manuale nel nativo oppure il percorso non viene ammesso. Dopo che l'atto potrebbe essere partito, una sospensione non ne certifica l'annullamento.

### 8. Stati, registro e riconciliazione

La pratica ha stato CU e stato del servizio separati, con provenienza e data dell'osservazione. Si conserva un registro locale durevole degli intenti, tentativi ed evidenze nei servizi esistenti. Per la prima verticale sintetica si usa un archivio isolato.

| Stato CU | Evidenza e passaggio consentito |
| --- | --- |
| **Preparata** | Piano locale completo/revisionabile, nessuna prova di salvataggio sul portale. |
| **Salvata** | Specificare ambito locale oppure bozza del destinatario riletta e correlata. Non implica firma o presentazione. |
| **Sospesa per scelta** | Motivo locale e volontà esplicita, stato precedente preservato. Ripresa della stessa pratica dopo rilettura; nessuna nuova autorizzazione desunta dal trascorrere del tempo. |
| **Autorizzata all'atto** | Prova nativa valida per singola operazione e contenuto corrente; scadenza/revoca/cambi riportano alla revisione, senza eseguire. |
| **Tentativo avviato** | Identità dell'operazione e numero del tentativo registrati durevolmente **prima** del comando potenzialmente irreversibile. Il successo del clic non è il successo dell'atto. |
| **Esito incerto** | Timeout, crash, cancellazione o risposta incompleta dopo possibile avvio. Bloccare un nuovo invio finché non si riconcilia; la UI deve mostrare l'incertezza. |
| **Confermata** | Evidenza del destinatario correlata all'atto e al contenuto, conservata con esito del servizio e registrazione/audit locale. Se l'effetto esterno è confermato ma il writer locale fallisce, mostrare esplicitamente “confermata dal destinatario, registrazione locale da completare”. |

Una sospensione durante un tentativo conserva anche il fatto che l'esito è incerto: non sovrascriverlo con una bozza riutilizzabile. Un rifiuto esplicito del servizio è un esito documentato con motivo locale, distinto dall'incertezza; può richiedere revisione, non una reiterazione automatica. Annullamento e altri stati specifici del servizio restano distinguibili senza inventare effetti inversi.

La chiave durevole dell'operazione è distinta dal riferimento remoto. Impedisce due tentativi concorrenti sulla stessa pratica/atto; non vieta una ripetizione clinicamente legittima decisa come nuova operazione. Si tenta prima il recupero della ricevuta e la ricerca autorevole della pratica già esistente. Un elenco temporaneamente vuoto o un token scaduto non prova assenza dell'effetto, soprattutto con richieste ancora in corso. Se la risposta divide l'atto, riconciliare ciascuna parte senza ripetere quelle confermate.

Un nuovo tentativo è possibile solo quando il contratto dispone di prova sufficiente che il precedente non abbia prodotto l'effetto, oppure di un meccanismo ufficiale idempotente per la stessa operazione; occorrono nuova verifica locale e autorizzazione valida. Se il servizio non offre un criterio affidabile, sospendere per verifica manuale, non promettere “exactly once”. L'identità dell'operazione resta la stessa, il tentativo ha progressivo distinto e non si ricrea la pratica.

Un banner di successo o una pagina che afferma di essere una ricevuta non bastano da soli: il contratto specifica origine autenticata, identificativo dell'atto, contenuto/stato correlato e modalità di verifica della ricevuta, incluse le firme quando previste. Nel simulatore tali evidenze sono controllabili; sul servizio reale vanno qualificate. Se la provenienza o la correlazione non sono verificabili, mantenere l'esito incerto e la verifica manuale.

Se il servizio esterno ha confermato ma manca la scrittura locale, si ripete soltanto l'acquisizione/registrazione idempotente dell'esito, mai l'atto esterno. Nessuna transazione distribuita fra portale e database viene presunta. Un registro restaurato può richiedere riconciliazione anche se il backup precede la ricevuta.

### 9. Esito tramite i servizi MediFlow

L'adapter consegna a un Application Service un risultato tipizzato locale: operazione/pratica, versione del piano, stato del servizio, parti riuscite/non risolte, evidenza/ricevuta e provenienza della verifica. I nomi delle API verranno definiti nell'implementazione; questa struttura non dichiara un writer già presente.

Il servizio verifica autorità applicabile, versione e correlazione; registra esito, riferimenti documentali e audit secondo la transazione locale esistente, con deduplicazione durevole. Non applica automaticamente proposte cliniche del modello. L'adapter non apre il database, non inserisce righe audit autonomamente e non crea una seconda fonte di verità. Le ricevute e gli identificativi istituzionali non entrano nel protocollo remoto.

La disattivazione di un pacchetto blocca nuovi atti e revoca i piani interessati. Conservazione e lettura dello storico rimangono possibili secondo ADR 0158; il core deve permettere il recupero autorizzato delle evidenze di un effetto già avviato, senza riabilitare la capacità di eseguire nuovi atti. Distinguere riconciliazione documentale e nuova operazione sanitaria.

## Verifica richiesta prima dell'adozione runtime

La sequenza completa è nell'analisi. CU-1 deve provare end-to-end sul simulatore specialistico identità locale, quesito, esenzione, revisione e ricevuta, includendo:

1. Fedeltà di campi, codici, quantità/unità e significato; nessuna inferenza su dati mancanti o decisioni cliniche.
2. Capture delle uscite verso modello, host e provider osservabili: protocollo MCP completo, stderr/log, file/clipboard, browser e diagnosi di errori. Sentinelle inventate anagrafiche **e cliniche** assenti; payload esattamente nell'allowlist. Riportare ciò che non è osservabile all'interno del provider e le inferenze residue, senza trasformare una misura locale in prova universale.
3. Diniego di operazioni/campi/destinazioni non ammessi e istruzioni ostili in pagina/documento; nuovi campi e UI sconosciuta non escono in chiaro.
4. Paziente/pratica errati, scambio riferimento fra sessioni/client, replay dopo revoca/completamento, scadenza, cambio capacità/dati/destinazione e risposta tardiva senza effetti.
5. Approvazione non falsificabile dal modello; modifica del contenuto invalidante; intervento medico simultaneo e sospensione deliberata con ripresa della stessa pratica.
6. Crash prima e dopo il clic, risposta persa, effetto tardivo, ricevuta duplicata, esito parziale e writer locale fallito: nessun reinvio delle parti confermate; incertezza visibile e registro recuperabile.
7. Client/build/configurazione esatti, accessi alternativi e limiti della garanzia documentati. Un controllo rimosso deve far fallire il relativo caso negativo: i test del solo schema non provano il confine OS.

Tutte le prove usano dati inventati e portali sintetici. Nessun atto o chiamata applicativa istituzionale, nemmeno di prova, è autorizzato da questo ADR. Nessuna modifica di rete. La documentazione pubblica può essere consultata in sola lettura. Qualificazione del servizio e ammissione clinica richiedono le autorizzazioni e le prove specifiche di Moduli e del programma.

## Conseguenze e decisioni aperte

Si riusano servizi, redazione, capacità territoriali e autorità native; si aggiungono esecutore, manifest, guard delle uscite e riconciliazione. Il costo maggiore è mantenere adapter affidabili e ambienti effettivamente isolati. Una UI cambiata può sospendere l'automazione; questo limite è preferibile a un atto di cui non si conoscono paziente, contenuto o esito.

Modalità 1 riduce l'esposizione ma non dimostra anonimato; modalità 2 resta pseudonimizzata e necessita valutazione di destinatari e condizioni. Il [registro delle fonti](../analysis/2026-10-23-computer-use-sources.md) delimita C-413/23 P e distingue consultazioni EDPB da testi finali. Nessuna conformità o ammissione istituzionale è dichiarata.

Le sole decisioni di Leonardo sono quelle elencate nell'[analisi](../analysis/2026-10-23-computer-use-procedures.md): confine offerto per client, eventuale trattamento della modalità 2 e perimetro/responsabilità del successivo uso istituzionale. Questo ADR non le anticipa e non modifica le decisioni già assunte in ADR 0160. Fino all'accettazione e alle prove, lo stato è **Proposed/documentato**, non esecutore installato o funzionante.
