# WHO locale — candidato Mac 0.8.6, follow-up 4

**Il perimetro attuale comprende Mac, localhost sul Mac e backend condiviso/Headless sullo stesso Mac.** I percorsi Windows, Linux, Mini e iOS/iPadOS sono rinviati alla 1.0: conservarne sorgenti e test di portabilità non equivale a qualificarne il rilascio. Anche la prova Linux r3 allegata serve a diagnosticare F-WHO4, non a provare il funzionamento sul Mac.

**PROPOSTA, non contratto accettato:** prima di procedere occorre leggere [WHO-TRIOS, emendamento D9–D11](../proposals/WHO-TRIOS-ADR.md). Restano invariati gli ADR accettati, le route applicative, il motore di ricerca e il launcher base. Le sezioni storiche spiegano i passaggi precedenti, ma le loro istruzioni su pubblicazione Docker, v3 e tre OS NON costituiscono la procedura Mac corrente, per la quale prevalgono questo capitolo e D9–D11.

## Correzioni e gate

Per la sola qualificazione, F-WHO2 ammette combinazioni di URI WHO canonici della release 2026-01, separati esattamente da ` & ` oppure ` / `, senza trim o normalizzazione. Restano il massimo di 16 componenti e 1536 caratteri e il limite di codice 32. Ciascun URI deve conservare host `http://id.who.int`, release e percorso `mms`, con i suffissi ammessi `other` o `unspecified`. La ricerca ufficiale con `medicalCodingMode=true` può restituire [postcoordinazione](https://icd.who.int/icdapi/docs2/ReleaseNotes-Version2.3/): i due separatori derivano dalla risposta pubblica acquisita, non definiscono una regola generale per i separatori dei codici.

F-WHO3 esegue `container stop --timeout 30` sull'ID esatto restituito e richiede una rilettura indipendente che confermi l'arresto. Il delta locale pre-direttiva di quattro file conserva l'attribuzione all'autore precedente: non viene presentato come codice nuovo né come nuova evidenza del run descritto.

F-WHO4 non considera raggiungibile una porta nulla. I nuovi container Mac non pubblicano porte Docker: soltanto il processo Node24 possiede `127.0.0.1:8382` e inoltra le tre forme GET del backend, tramite un programma EXEC fisso, a `127.0.0.1:80` nel container esatto. La richiesta HTTP passa su stdin, mai come codice shell. Per la copia ripristinata si usa un listener temporaneo con porta assegnata dal sistema, diversa da 8382. Il percorso non introduce nuovi container, immagini, privilegi, mount, proxy generici o riconnessioni al bridge esterno.

Dopo l'acquisizione, WHO deve rimanere sulla sola rete internal posseduta. Prima e dopo ogni risposta vengono controllati IPv4/IPv6, identità di motore ed endpoint Unix, ID, owner, immagine pinnata, epoch/PID, rete, membri e limiti: se una guardia fallisce, la risposta non raggiunge l'applicazione. Sono rifiutati Origin del browser, Cookie/Authorization, URL arbitrari, redirect, body in ingresso e metodi diversi da GET. Il server Web non riceve autorità Docker.

**Prerequisito corretto F4, ancora PROPOSTO:** poiché il parent ha osservato BusyBox 1.37.0 e assenza di Bash nell'immagine ARM64 pinnata, il programma usa un argv fisso, senza shell né opzioni GNU:

```
/bin/busybox timeout -s KILL 4 /bin/busybox nc -n -w 5 127.0.0.1 80
```

La richiesta HTTP passa esclusivamente su stdin, che viene chiuso dopo il GET. Il timeout interno di 4 secondi non controlla un process group GNU e `nc -w 5` non sostituisce il deadline assoluto. All'EOF di stdin, il client deve chiudere soltanto la scrittura TCP e continuare a leggere la risposta. Per accettarla servono exit 0, Content-Length esatto oppure framing chunked completo, JSON/UTF8 validi, rispetto dei limiti e identità verificate prima e dopo: body privi di framing, parziali o seguiti da errore sono rifiutati. Il preflight verifica echo+EOF, l'help nc richiesto e una scadenza reale di timeout/cat con stdin mantenuto aperto, sempre come UID/GID 65534 e con rilettura dell'identità. Queste prove NON qualificano TCP, terminazione nel container, WHO, restore o dataset.

La richiesta host conserva deadline di 5 secondi, risposta massima 64 KiB, header 8 KiB, concorrenza 4 e massimo 8 connessioni. In caso di annullamento, il body viene scartato ma lo slot resta occupato fino all'uscita EXEC o al limite host. Terminare soltanto il CLI non prova che il processo interno sia già finito: socket e processi nel container richiedono la prova opt-in sull'immagine. Non sono consentiti come ripiego installazioni, immagini nuove, shell custom o aperture di egress. Gli errori distinguono BusyBox assente, timeout/nc incompatibili e deadline non dimostrato. F3 non viene promosso: contratto prerequisite e identificatore di trasporto BusyBoxv2 sono necessari alla nuova receipt Macv4. Una receipt v4 già `ready` ma con campi obsoleti produce `private_state_invalid` e non deve essere modificata per eludere i controlli. Le installazioni incomplete mantengono la ripresa esplicita.

## Procedura Mac attuale

Prima di qualificare WHO, e soltanto dopo la revisione del codice proposto, il parent deve eseguire nel proprio ambiente Mac il test opt-in del trasporto sull'immagine ARM64 esatta **già presente localmente**. Il test non scarica immagini, non avvia WHO o dataset e non modifica container esistenti: crea solo peer temporanei identificati, senza rete o volumi, con rete none e UID 65534. Il PID1 sintetico `cat` non riproduce il processo WHO, perciò eventuali watchdog terminati ma non riassorbiti vengono registrati separatamente. La gestione e il riassorbimento delle richieste ripetute da parte del vero PID1 WHO restano un gate distinto: l'uscita del CLI non basta a provare la fine del processo.

```sh
node --version  # deve essere 24.x
MEDIFLOW_WHO_BUSYBOX_CONTEXT=desktop-linux \
MEDIFLOW_WHO_BUSYBOX_MAC_ACCEPTANCE=I_ACCEPT_TEMPORARY_NO_NETWORK_TRANSPORT_TESTS \
node --test --test-name-pattern 'F4 parent Mac pinned-image' scripts/who-local-probe.test.mjs
```

Il contesto `desktop-linux` è quello riportato dal parent e deve essere verificato come contesto locale effettivamente scelto. Su un altro Mac il nome va selezionato esplicitamente; TCP/SSH ed engine non ARM64 sono rifiutati. Tutte e quattro le sottoprove devono essere eseguite, non risultare SKIP, e il loro PASS qualifica soltanto il trasporto, non WHO.

Superato questo gate e ottenuta l'approvazione D10, completare le prove reali di installazione, offline e restore nel checkout Mac, con Node24 e runtime locale autorizzato:

```sh
./Setup_WHO.command setup
./Setup_WHO.command status
```

`setup` richiede il gesto `ACCETTO` e crea soltanto risorse etichettate della propria installazione. Acquisisce immagine e dataset, misura cinque file ed esegue quattro ricerche reali distinte: acquisizione, riavvio offline, restore separato e recupero dell'originale. Confronta hash e metadati, poi ferma la copia. La receipt Mac è **v4**: v3 e versioni precedenti richiedono nuova conferma e qualificazione, senza adozioni o promozioni automatiche. L'originale rimane internal; se il percorso fallisce, WHO resta disabilitato e vengono arrestati soltanto i container di cui sia ancora verificata la proprietà. Un cambio di owner o motore impedisce anche un cleanup non sicuro e deve essere segnalato.

Per usare il launcher ordinario dell'app e mantenere attivo il ponte, eseguire:

```sh
./Setup_WHO.command start
```

Il processo rimane in primo piano e possiede mutex e listener per tutta la durata del launcher. Quando l'app Mac o un backend condiviso/Headless siano già avviati con la configurazione della propria installazione, usare invece:

```sh
./Setup_WHO.command serve
```

`serve` richiede un gesto locale e un terminale da mantenere aperto; non avvia né arresta l'app, e Ctrl-C chiude soltanto il ponte. Non installa LaunchAgent o daemon. È vietato avviare insieme `start` e `serve`: mutex e conflitto di porta sono gate, non autorizzazioni a terminare altri processi. Anche `qualify` richiede conferma e ricalcola le prove; una nuova qualificazione non può procedere mentre il ponte posseduto è attivo.

`status` effettua soltanto lettura: `qualified` indica una receipt salvata, NON la presenza del listener o una risposta WHO attuale. Analogamente, `MEDIFLOW_ICD_WHO_ENABLED=1` è configurazione, non healthcheck. Poiché un'app già avviata non rilegge automaticamente il file ambiente, occorre usare il supervisore previsto per le sole tre variabili canoniche e verificare Search/code-check dal backend. UI pazienti e `Start_MediFlow.command` restano invariati: l'assenza del servizio opzionale WHO non modifica dati o DB. La ricetta A–Z del pacchetto descrive avvio separato, riqualifica, stop-rule e accettazione Xcode/appMac riservata al parent.

## Evidenza e limiti

Il candidato qui descritto non è stato eseguito su Mac né dentro Docker/WHO. I test nativi Node24 usano socket host reali, ma Docker e dataset sintetici; quelli BusyBox sull'host, quando eseguibili, dichiarano build e capacità senza qualificare l'immagine WHO. Le prove GNU/Bash F3 sono superate e non vengono riattribuite, mentre parent 106 PASS/lint 0 e diagnosi Linux rimangono evidenze precedenti separate. I metadati non generano digest AMD64, accettazione di licenza, snapshot o qualifica Mac. La promozione richiede osservazioni Mac reali complete: ricerca dal backend, riavvio/restore, assenza di egress, annullamento e pulizia sicura. Se nell'immagine manca uno strumento richiesto, fermarsi e riportare il codice, senza cambiare pin, contratto o rete per aggirare il limite.

---

## Documentazione storica conservata — non procedura Mac corrente

# Contesto dei precedenti candidati WHO locali

Nei candidati precedenti la scelta era il sidecar WHO locale, dietro l'Application Service server-only di [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md). Il vecchio container MediFlow e la porta `8888` restavano ritirati, senza ripiego su ICD-9, JSON WHO grezzo o servizio WHO remoto e senza credenziali OAuth. Il candidato comprendeva Search, stato e procedura guidata con installer locale a comandi fissi; il server Web non eseguiva Docker.

Il [manifesto](./who-local-sidecar.manifest.json) distribuito lascia non valorizzati i lock obbligatori, che ogni installazione deve registrare fuori Git. La documentazione congelata riporta una prova ARM64 del 7 settembre 2026 con acquisizione, Search, riavvio offline e ripristino completati dopo l'accettazione esplicita dell'operatore. Quell'esito non accetta termini per altri utenti né attiva servizi nelle loro installazioni; viene conservato come prova storica, non ripetuto o attestato nuovamente. La revisione tri-OS rimane una [proposta di contratto WHO-TRIOS](../proposals/WHO-TRIOS-ADR.md), non un ADR accettato.

## Configurazione server e stato

Il servizio è spento per default. La configurazione viene letta soltanto dal processo server:

| Variabile | Valore |
| --- | --- |
| `MEDIFLOW_ICD_WHO_ENABLED` | `1` dopo il provisioning verificato |
| `MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST` | Digest reale `sha256:<64 hex>` dell'immagine bloccata |
| `MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID` | Identità `sha256:<64 hex>` dello snapshot inventariato |

Gli identificatori sono dichiarazioni dell'host, non attestazioni del contenuto del sidecar. Le variabili vengono rilette al confine di ogni operazione, ma modificare un file esterno non cambia l'ambiente di un processo già avviato: la configurazione va iniettata attraverso il supervisore previsto sul target. Il percorso locale non legge le precedenti variabili di rete o credenziali OAuth.

La destinazione è fissa: `http://127.0.0.1:8382`, Search v2, release `2026-01`, MMS in inglese. Non sono ammessi URL dal browser, proxy o redirect. I limiti sono 160 byte UTF-8 per la query, 25 risultati restituiti, risposta di 64 KiB, transport di 5 s e audit di 1 s. L'audit conserva soltanto una proiezione esplicita della receipt validata, senza query, codici, descrizioni o URI: `counts` contiene `resultCount`; `schema`, `operation`, `deployment`, `source`, `release`, `language`, `binding`, `image`, `dataset`, `latencyMs`, `fetchedAt`, `expiresAt` e `completedAt` mantengono i rispettivi valori. `binding/image/dataset` corrispondono a `bindingId/imageDigest/datasetSnapshotId`. I digest SHA-256 restano interi; le chiavi brevi rispettano il limite di 80 caratteri del sanitizer audit.

Entro il limite di 64 KiB, il parser valida tutte le voci upstream, comprese quelle oltre la venticinquesima, e mantiene l'ordine WHO. Restituisce le prime 25 con `partial=true` quando ne ometta altre o WHO segnali `resultChopped`; una voce malformata, codici o URI duplicati oppure un body oltre 64 KiB fanno rifiutare l'intera risposta. Per le combinazioni vengono conservati codice completo e riferimento ufficiale CodeInfo, dopo la verifica dei componenti restituiti da Search. Il riferimento non attesta né una verifica clinica né una chiamata CodeInfo per ciascun risultato: Search cerca termini. È invece **Verifica codice WHO**, nei Repertori o accanto a una diagnosi ICD-11, ad avviare CodeInfo e leggere il titolo del codice base, distinguendo codice riconosciuto, non trovato e servizio non disponibile. Il controllo non modifica la cartella; una release diversa dichiarata dalla fonte viene segnalata senza ricodifica. Nelle combinazioni, il titolo inglese visualizzato si riferisce esplicitamente al codice base, non all'intera combinazione.

- `disabled`: opt-in assente;
- `configuration_required`: identificatori assenti o invalidi;
- `configured`: configurazione presente, risposta diretta recente non osservata;
- `available`: ricerca diretta riuscita nel binding corrente nelle ultime 24 ore;
- `unavailable`: tentativo diretto/audit fallito.

Lo stato `configured` non equivale ad `available`, e leggerlo non avvia ricerche. Solo il clic su **Impostazioni → Diagnostica → Verifica con termine di esempio** interroga il termine pubblico `cholera`. La UI distingue risposta diretta, cache e fallimento: una cache hit non ripristina la disponibilità del sidecar né aggiorna il momento dell'ultimo successo diretto.

La cache resta esclusivamente in RAM, con 256 chiavi/4 MiB e TTL assoluto di 24 ore, non rinnovato dalle hit. Binding, immagine e dataset separano le chiavi; disable, cambio di configurazione, dispose o clock regressivo invalidano cache e risultati pendenti. Il listener loopback non autentica gli altri processi locali dell'host.

## Percorso ordinario locale tri-OS — PROPOSTA

La proposta tri-OS introduce un percorso comune Node 24 per macOS, Windows e Linux, sullo **stesso computer che ospita MediFlow**: Windows/Linux non dipendono da Mac, relay o server remoto. Prima che l'estensione sostituisca il limite di provisioning di ADR 0115, il parent deve accettare WHO-TRIOS. Contratto Web e DTO Search/CodeInfo rimangono invariati.

### Prerequisiti e selezione del target

L'host Node può essere x64 o arm64, ma l'immagine deve corrispondere all'architettura osservata del **motore Docker Linux**, non a quella dell'host o del browser. È l'operatore a scegliere, installare se necessario e avviare il runtime: la procedura non installa Docker, non ne accetta i termini, non avvia VM, non eleva privilegi e non modifica gruppi o contesto Docker globale. Non vengono dichiarati installer, versioni o requisiti di licenza non verificati.

| Host della procedura | Endpoint locale ammesso | Stato iniziale del target immagine |
| --- | --- | --- |
| macOS x64/arm64 | Socket Unix assoluto canonico | ARM64 e AMD64: metadati verificati; consenso e qualifica locale ancora necessari |
| Linux x64/arm64 | Socket Unix assoluto canonico accessibile all'utente, senza sudo | Stesso gate basato sul motore |
| Windows x64/arm64 | Esattamente `npipe:////./pipe/docker_engine` oppure `npipe:////./pipe/dockerDesktopLinuxEngine` | Stesso gate; serve motore Linux, non Windows containers |

Non sono accettati TCP, neppure loopback, SSH, pipe remote o arbitrarie, endpoint malformati o con query/frammenti. Gli override ambientali Docker per host, contesto e TLS vengono neutralizzati, anche quando usino maiuscole/minuscole diverse su Windows. Identità del daemon, endpoint e architetture sono legati all'installazione e ricontrollati nelle operazioni: proteggono dai cambi accidentali, senza attestare resistenza a un amministratore locale che manipoli il runtime.

Il release-lock v2 verifica **offline** i byte allegati dell'indice OCI, i due descriptor, il manifest figlio e il readback del target selezionato. Nel follow-up 1 entrambi i target dispongono di metadati pubblici verificabili, classificati **verified_metadata**: ciò non significa immagine acquisita, licenza accettata, installazione qualificata o servizio disponibile. Entrambi i readback riportano `imageAcquired=false` e non è allegato alcun layer.

Per AMD64 sono conservati, senza riserializzarli, i byte pubblici forniti dal parent:

| Artefatto | SHA-256 dei byte esatti |
| --- | --- |
| `docs/who-lock-evidence/2.6.0-amd64.json` | `a63a4c1c73329ff2ebff616a0cde2089b6b0595dec25255844f57f5b1903a4b8` |
| `docs/who-lock-evidence/2.6.0-amd64-readback.json` | `2ab0f2979049422ae4df9c390eabd4088178f4eb08a715e572b35f876f983348` |

Il readback conserva `2026-09-08T13:24:41.901316+00:00`; il lock v2 usa `2026-09-08T13:24:41.901Z`, rappresentazione ISO in millisecondi dello stesso istante nel verificatore JavaScript, non una nuova lettura. Indice ed evidenze ARM64 restano invariati. Il config AMD64 del pacchetto di contesto lega il child a `linux/amd64`, senza costituire un nuovo file sorgente o una prova runtime.

Se mancano child/readback o binding del lock, il percorso restituisce `image_evidence_missing` **prima del consenso e del pull/create**; byte alterati o binding errati producono `release_lock_invalid`. Le fixture negative agiscono soltanto su copie sintetiche, mai sui file canonici. Non si cercano tag alternativi o immagini ARM in emulazione. Dopo il pull, il digest locale osservato viene controllato prima della creazione; inventario e prove offline/restore devono essere calcolati sulla specifica installazione.

### Preparazione, installazione, avvio

Con Node 24 disponibile, dalla cartella MediFlow del computer host il comando comune è:

```text
node scripts/who-local-onboarding.mjs setup
```

I launcher di piattaforma delegano alla medesima procedura:

| Host | Comando dalla cartella MediFlow |
| --- | --- |
| macOS | `./Setup_WHO.command` (launcher originale conservato) |
| Windows, PowerShell | `.\Setup_WHO.ps1` |
| Linux, terminale | `bash ./Setup_WHO.sh` |

Se sono presenti più contesti locali, sceglierne uno con il numero mostrato. La procedura verifica prima motore e target, poi la porta 8382, senza adottare, fermare o rimuovere servizi di cui non sia dimostrata la proprietà. Quando Docker manca, espone i prerequisiti dell'OS e permette di ripetere lo stesso comando dopo l'intervento dell'operatore. Nessun errore apre destinazioni di rete alternative.

Prima di una nuova installazione vengono mostrati versione, lingua, termini WHO e operazioni previste. Scrivere **ACCETTO** registra il gesto locale e autorizza il download della specifica immagine e le verifiche del servizio; la scelta non può essere precompilata dal checkbox Web o riutilizzata per altri utenti. Il primo download richiede rete, mentre lo spazio libero necessario a immagine, dataset e copie deve essere controllato sul target. Il candidato non dichiara di misurarlo e non estende agli altri sistemi le dimensioni del precedente deployment ARM64.

Terminato il setup, l'avvio di MediFlow richiede una scelta separata. Il launcher **Avvia MediFlow con WHO**, nella cartella privata, riesegue `start`, rilegge e controlla lo stato e delega al launcher esistente dello stesso OS: `Start_MediFlow.command`, `Start-MediFlow.ps1` oppure `scripts/start-mediflow.sh`. Windows non richiede Bash o Mac. Vengono composte soltanto le tre variabili WHO esistenti, lasciando invariato il resto dell'ambiente e senza interrompere un MediFlow già avviato. La policy PowerShell rimane del gestore e non viene aggirata: il comando Node comune resta utilizzabile quando l'organizzazione consenta Node ma non il file launcher.

### Comandi operativi Windows e Linux (solo dopo autorizzazione sul target)

I comandi seguenti richiedono la cartella MediFlow, Node 24 e un runtime Docker Linux locale già predisposto dall'operatore, oltre all'autorizzazione sul target. `setup` può scaricare WHO solo dopo il gesto richiesto, mentre `status` legge soltanto; nessuno dei comandi installa Docker.

```powershell
# Windows PowerShell, senza elevazione o cambio ExecutionPolicy.
node --version
.\Setup_WHO.ps1 status
.\Setup_WHO.ps1 setup
# Dopo un'interruzione: lo stesso setup chiede conferma per riprendere.
# Riqualifica richiesta dall'operatore; poi avvio separato del processo MediFlow.
.\Setup_WHO.ps1 qualify
.\Setup_WHO.ps1 start
```

```bash
# Linux, terminale dell'utente proprietario; nessun sudo o Mac remoto.
node --version
bash ./Setup_WHO.sh status
bash ./Setup_WHO.sh setup
# Stessa procedura per la ripresa con conferma.
bash ./Setup_WHO.sh qualify
bash ./Setup_WHO.sh start
```

Dopo un `setup` completato correttamente non serve eseguire `qualify`, che rimane una richiesta separata di nuova verifica. `start` non supplisce automaticamente a consenso, metadati o qualifica mancanti. Quando la policy ammette Node ma non il launcher PowerShell, si può usare `node scripts/who-local-onboarding.mjs <azione>`, senza aggirare policy degli altri launcher o controlli ACL. Un contesto Docker remoto resta responsabilità del proprietario: la procedura non esegue `docker context use` e non lo converte.

Per isolare davvero una prova, usare una macchina o un account dedicato. `MEDIFLOW_DATA_DIR` separa il database sintetico MediFlow, ma **non cambia la directory privata WHO** indicata sotto: impostarla non basta a isolare un'installazione WHO già presente.

### Stato privato, permessi e qualifica della propria installazione

Le directory predefinite restano sempre esterne ai sorgenti:

| Host | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/MediFlow/WHO/2026-01_en` |
| Linux | `$XDG_DATA_HOME/MediFlow/WHO/2026-01_en`, oppure `~/.local/share/MediFlow/WHO/2026-01_en` |
| Windows | `%LOCALAPPDATA%\MediFlow\WHO\2026-01_en` |

Su POSIX, directory, metadati/configurazione e payload snapshot nella directory privata mantengono rispettivamente permessi 0700, 0600 e 0644. Windows richiede invece un percorso NTFS locale, escludendo UNC, device, ADS, reparse/junction, traversal e file hardlink. Una funzione PowerShell fissa verifica owner corrente e ACL privato; il DACL protetto viene applicato soltanto alle directory nuove. ACL esistenti troppo ampi non sono corretti in silenzio e i mode bit Windows non valgono come prova di ACL. Spazi e apostrofi nei percorsi passano come argomenti o dati; il launcher Windows generato usa BOM UTF-8 anche con percorsi Unicode. Queste semantiche hanno test di unità, non ancora una prova reale su Windows.

Ogni installazione lega UUID, container ID, pin e daemon locale. La qualifica acquisisce risposte entro limiti definiti usando termini pubblici fissi, ferma soltanto il container posseduto e copia i cinque file previsti. Inventario e SHA-256 derivano dai **byte acquisiti in quella installazione**, senza presumere hash identici fra architetture. Viene verificato il riavvio sulla rete Docker interna senza IPv6/default route; una copia separata viene ripristinata sulla sola rete interna e confrontata per dimensioni, metadati e hash. Dopo averla fermata, l'originale viene riavviato separatamente sulla rete **internal posseduta**, senza riconnettere il bridge di acquisizione, secondo la proposta D6. Copie e rete si conservano: sono vietati `rm`, `prune`, mount clinici e letture indiscriminate dei log. Analytics, DORIS, FHIR e riavvio automatico rimangono disattivati.

Gli ACL dell'host non sostituiscono proprietario `root:root` e permessi 0644 richiesti nel container Linux. Per una copia proveniente da Windows si normalizzano soltanto i cinque file del **nuovo container di restore posseduto**, prima del confronto di metadati e hash. Dataset originale e altre risorse non subiscono modifiche ai permessi.

La receipt di qualifica **v3** lega tentativo, host/motore, container originale e ripristinato, immagine, network, inventario, esiti e tempi osservati. La configurazione abilitata può essere salvata soltanto dopo il successo di tutti i gate, che non autorizzano comunque scritture cliniche. Le prove osservano la topologia Docker interna, non ogni possibile egress dell'host, e i probe host non sostituiscono parser, autenticazione o DTO applicativi. Il listener di questa procedura rimane `127.0.0.1:8382:80`.

### Ripresa, annullamento e migrazione

```text
node scripts/who-local-onboarding.mjs status
node scripts/who-local-onboarding.mjs qualify
node scripts/who-local-onboarding.mjs start
```

`status` non avvia, scarica, qualifica o esegue Search. `qualify` richiede conferma e ripete le prove soltanto sul servizio registrato. `start` può operare solo con qualifica valida e non installa implicitamente ciò che manca; se il servizio posseduto è fermo, il gesto ne autorizza l'avvio con verifica del listener.

L'interruzione di un pull conserva consenso e stato preparato, ma riprendere richiede un'altra conferma. Dopo un create confermato, l'ID viene persistito prima di rispondere all'annullamento; se l'esito è ambiguo, non è ammessa l'adozione per nome e deve intervenire il gestore. Ctrl+C, TERM e chiusura dell'input chiedono cancellazione cooperativa ai confini delle operazioni, perciò una chiamata Docker sincrona può terminare prima che il segnale sia gestito. I socket HTTP host vengono invece chiusi subito. Può proseguire soltanto la fermata di risorse la cui proprietà sia ancora verificabile: né annullamento né fallimento autorizzano il riavvio sul bridge con egress. La guida Web non può annullare un job host.

Fallimento e annullamento conservano snapshot e receipt incompleta. Prima di mutare risorse, la riqualifica invalida il file di attivazione, ma non l'ambiente di un server già aperto. Il lock `.setup-active` non viene pulito automaticamente: dopo un arresto forzato, il gestore deve controllare processi e identità prima di rimuovere **quel solo lock**. Cambiare host, daemon o endpoint invalida l'autorità della vecchia receipt, senza cancellarla né trasferirla al nuovo target.

Le registrazioni ordinarie v1 restano leggibili, ma status non le promuove e start rifiuta l'avvio. Solo setup/qualify con conferma, ownership e target ARM64 coerenti può migrare l'installazione a v2 e calcolare una nuova qualifica **v3**, conservando gli snapshot precedenti. Anche una qualifica v2 richiede una nuova prova e un nuovo gesto: metadati e receipt legacy non autorizzano il trasporto v3. La CLI tecnica v1 mantiene i controlli ARM64/Unix e non può attivare AMD64 senza evidenza v2. Nessun ADR accettato viene modificato.

### Disponibilità nell'interfaccia

La guida separa i passaggi necessari a ottenere il servizio — prerequisiti, evidenza dell'immagine, download e qualifica — dalla configurazione salvata e dalla risposta diretta osservata. La scelta dell'OS riguarda quindi il server, non il browser: copiare un comando o selezionare un checkbox non installa WHO né lo rende disponibile. Anche `ready` della CLI attesta una qualifica salvata, non il DTO `available` della sessione applicativa.
Per verificare quest'ultima in MediFlow occorrono **Rileggi configurazione** e una **Verifica con termine di esempio** esplicita, distinguendo un risultato in cache da una risposta diretta. Il percorso non introduce nuove route privilegiate, accessi al DB o scritture cliniche.

## Accettazione su macchina pulita — NOT_RUN per tutti e tre gli OS

La procedura definisce le prove da raccogliere, ma non ne attesta l'esecuzione. Il parent può eseguirla soltanto dopo revisione/accettazione dell'ADR e autorizzazione delle risorse di test, su una macchina/account dedicato senza dati clinici né WHO preesistente. Node 24, dipendenze **del lockfile** e runtime scelto devono essere già preparati dall'operatore.
Registrare OS/build, architettura Node, versione Node/Docker/daemon, tipologia di endpoint ammessa, immagine realmente disponibile, stato del firewall e spazio libero: sono le condizioni che permettono di riferire l'esito a quel target. I readback restano privati; negli artefatti condivisibili entra soltanto il binding pseudonimizzato, mai `Config.Env`, credenziali o dettagli personali.

| OS | Ambiente sintetico e prova launcher |
| --- | --- |
| macOS | Impostare `MEDIFLOW_DATA_DIR` a una nuova cartella privata di test esterna al checkout. Eseguire `./Setup_WHO.command` e successivamente il launcher `.command` generato. |
| Linux | Impostare `MEDIFLOW_DATA_DIR` a una nuova cartella privata di test esterna al checkout. Eseguire `bash ./Setup_WHO.sh` e il launcher `.sh` generato, senza sudo/Mac. |
| Windows | Impostare `$env:MEDIFLOW_DATA_DIR` a una nuova cartella NTFS privata di test, anche con spazi/apostrofo/Unicode. Eseguire `.\Setup_WHO.ps1` e il launcher `.ps1` generato, senza WSL bash/Mac/policy bypass. Registrare la versione PowerShell e verificare realmente ACL/reparse/hardlink. |

Per ciascun target iniziare dai casi che devono fermarsi senza mutazioni: Docker assente/remoto e porta 8382 occupata da un servizio di test. Provare poi il rifiuto della licenza e, in un'installazione pulita, il consenso esplicito. La distribuzione canonica contiene i due artefatti AMD64, ma ciò consente la verifica dei metadati e il successivo consenso, non una disponibilità immediata. Su una copia dedicata, l'evidenza assente o alterata deve ancora bloccare il percorso prima del pull. La prova sintetica positiva AMD64 non sostituisce quella reale, che resta NOT_RUN.

Quando le evidenze del target sono complete, osservare pull al digest, nuovo inventario reale, riavvio offline e restore. Conservare receipt e hash di quell'inventario, senza riutilizzare quelli dei test o del deployment storico. Le prove di interruzione/ripresa, restore fallito e cambio d'identità devono usare risorse dedicate, senza cancellare altri servizi; per ogni gate fallito verificare che la configurazione rimanga disabilitata.

Solo dopo la qualifica avviare esplicitamente il launcher MediFlow dello stesso OS, con il solo database sintetico. Nella UI autenticata verificare Search pubblica diretta, cache/non disponibile e CodeInfo attraverso i percorsi esistenti, controllando che nessuna cartella clinica venga scritta automaticamente. Registrare separatamente esito del setup, qualifica del dataset, avvio applicativo e disponibilità osservata, perché un passaggio riuscito non prova il successivo. Ripetere la verifica dopo un riavvio controllato: il percorso WHO non imposta l'avvio automatico e nessun test sintetico del candidato sostituisce queste prove.

## Procedura tecnica per deployment gestiti separatamente

1. Copiare il manifesto fuori Git e verificare target, risorse, disponibilità della porta e runtime container. Il candidato fissa `linux/arm64`, ma questo vincolo non prova compatibilità o installabilità su uno specifico Mac.
2. Nel registry primario `registry-1.docker.io`, verificare il riferimento `whoicd/icd-api:2.6.0` e il manifesto della piattaforma; registrare digest reale, data e hash dell'evidenza conservata fuori Git. Non usare `latest`, hash sintetici o un digest copiato dal vecchio packet senza una nuova verifica.
3. L'operatore valuta i [termini WHO](https://icd.who.int/en/docs/icd11-license.pdf) e, se decide di accettarli, lo fa espressamente, registrando fuori Git data e riferimento opaco alla decisione. La scelta del sidecar non vale come accettazione dei termini. Controllare quindi i prerequisiti locali con:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage provision --manifest /percorso/manifesto-locale.json
   ```

   Il comando controlla struttura e registrazioni, non il registry, la validità della decisione o gli artefatti; non esegue il provisioning.
4. Solo dopo questi gate e l'autorizzazione operativa ottenere l'immagine bloccata e creare manualmente un nuovo container identificabile. Usare bind `127.0.0.1:8382` verso porta container `80`, `include=2026-01_en`, `saveAnalytics=false`, `enableDoris=false`, `fhirSupport=false`; impostare `acceptLicense=true` solo dopo il passo 3. Sono esclusi mount clinici/socket Docker, avvio automatico e modifiche globali. La rete che WHO documenta come necessaria per l'immagine e il primo caricamento del dataset non autorizza traffico clinico.
5. Inventariare il dataset effettivamente acquisito e lo snapshot ripristinabile, conservando identità e hash dell'inventario: il digest dell'immagine non è quello del dataset. Verificare sul target il metodo supportato di snapshot/ripristino, senza inventare percorsi interni, volumi o modifiche al software WHO. Se il ripristino non è ripetibile, l'attivazione resta bloccata.
6. Con termini sintetici verificare binding, Search, riavvio senza rete con nuove query e ripristino, osservando risorse ed egress del processo. Registrare le prove prima del controllo di attivazione:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage activate --manifest /percorso/manifesto-locale.json
   ```

   Soltanto una verifica positiva sul target consente di iniettare i due identificatori e l'opt-in server: il checker non sostituisce queste prove.
7. Per un aggiornamento creare un deployment distinto, ripetere lock e verifiche e conservare quello precedente in forma recuperabile. In caso di rollback disabilitare Search e fermare solo il container candidato identificato, senza rimozioni globali.

In assenza delle registrazioni obbligatorie, il manifesto distribuito fallisce intenzionalmente entrambi i gate. Il server Web MediFlow non avvia automaticamente il servizio.

## Prova storica riportata nella base — 7 settembre 2026

Questa prova appartiene alla base congelata e documenta il target verificato il 7 settembre 2026. Non costituisce una verifica del candidato tri-OS.

La prova ha usato l'immagine ufficiale `whoicd/icd-api:2.6.0`, piattaforma `linux/arm64`, verificata nel registry e bloccata al digest `sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e`. Al runtime Colima dedicato erano assegnati 2 CPU e 3 GiB di RAM, senza mount utente, analytics o cambio del contesto Docker predefinito. Queste risorse descrivono la prova; non sono requisiti minimi misurati per ogni target.

- Search locale: `cholera` ha restituito 16 risultati, incluse combinazioni.
- Riavvio senza route di rete esterna: la nuova ricerca `measles` è riuscita.
- Ripristino su un nuovo container della stessa immagine: la nuova ricerca `rubella` è riuscita senza route esterna, con corrispondenza dei cinque hash del dataset.
- Application Service MediFlow: sono stati verificati risposta diretta, nessun risultato e cache, con DTO validato e audit raccolto dal probe. La prova non ha attraversato la route HTTP autenticata o l'interfaccia del paziente.
- CodeInfo attraverso l'Application Service e il sidecar reale: `1A00` e `1A00&XN8P1` sono stati riconosciuti, recuperando il titolo del codice base; `ZZ9999` non è stato trovato. Il client ha validato tre receipt dedicate senza usare il database paziente. La verifica non ha usato cache né convertito codici o release.

Le due prove offline hanno interrogato il loopback **dentro il container**, perché la rete Docker interna non esponeva la porta al Mac. Il binding host `127.0.0.1:8382` è stato verificato separatamente dopo il ripristino, con il bridge ripristinato. Questi esiti non dimostrano quindi un isolamento generale da ogni possibile egress.

Lo snapshot comprende soltanto i cinque file del dataset osservati sotto `/tmp` nel container fermo: 493.455.110 byte totali, identità `sha256:ecf3b894425d5cfb7514868d554eb086a7b5e7284ef212d2bb230a84b523b825`. Non comprende l'intera directory temporanea né lo stato del servizio. Le copie di archivio restano private, mentre nel container occorre ripristinare proprietario `root:root` e permessi originali `0644`: il primo tentativo con file `0600` falliva durante la riscrittura dell'indice, e solo il ripristino dei metadati originali ha consentito avvio e ricerca. Non sono stati modificati software o immagine WHO.

Inventario, hash, accettazione, fallimento iniziale e verifiche di recupero sono conservati nel packet locale dell'operatore, fuori Git. Il metodo è stato osservato su quel target e quella immagine; non qualifica un installer per Windows, Linux o futuri aggiornamenti WHO.

## Verifica del candidato e limite di consegna

Le fixture verificano Search locale, route autenticata, client, stato passivo, limiti, cache, timeout e manifesto su dati sintetici. Non interrogando un servizio WHO né un corpus reale, non ne provano il comportamento sul target.

Per l'esecuzione focalizzata occorrono Node 24 e `MEDIFLOW_DATA_DIR` già impostata esplicitamente a una directory sintetica di proprietà del run. Il comando è comune a tutti gli OS e non usa glob dipendenti dalla shell:

```text
node scripts/run-strip-types.mjs --test scripts/check-who-local-sidecar-manifest.test.mjs scripts/who-local-setup.test.mjs scripts/who-local-onboarding.test.mjs scripts/who-local-platform.test.mjs scripts/who-local-onboarding-portability.test.mjs scripts/who-local-probe.test.mjs lib/reference-data/who-local-setup-guide-state.test.ts components/settings/who-local-setup-guide.test.ts lib/reference-data/icd11-who-local-runtime.test.ts lib/reference-data/icd11-who-local-node-transport.test.ts lib/reference-data/icd11-who-local-integration.test.ts
```

Il runner richiede `typescript@5.9.3` dal lockfile. Nel workspace del follow-up 2 era presente Node **24.11.1**, ma mancavano le dipendenze canoniche: il loader si è fermato con `ERR_MODULE_NOT_FOUND` per TypeScript prima delle asserzioni. Il messaggio generico del runner non dimostra dunque l'assenza di Node 24. La suite nativa, che include il nuovo `scripts/who-local-probe.test.mjs`, ha riportato **157 PASS / 0 FAIL / 1 SKIP**, con browser opt-in non eseguito; usando file e peer HTTP sintetici, non Docker/WHO, non sostituisce controlli canonici e qualifica sui target.
Claims/crosswalk sono stati eseguiti sulla base e sul candidato, con test crosswalk 9/9 su entrambi. Lint/build sono rimasti bloccati dalle dipendenze assenti; anche il tentativo diagnostico con TypeScript 5.8.3 non canonico è fallito per contesto/dipendenze mancanti e non vale come typecheck PASS. Gli esiti parent 129+9 del follow-up 1 e quelli precedenti restano prove storiche, non verifiche del candidato. `VALIDATION.md` della consegna di riferimento ne conserva dettagli e log.


Il DTO v2 conserva codice, titolo, URI canonico, partial e identità della fonte, mentre il client mantiene separata la lettura del DTO v1. Nel modulo paziente, `canonicalUri/reference` attraversa schema client, salvataggio nel JSON `diagnoses` già cifrato e rilettura: il riferimento alla selezione resta così associato al dato senza aggiungere colonne SQLite, route o modifiche alla cifratura. I campi sono opzionali per i record storici/manuali e non vengono inventati URI per codici preesistenti; `reference` contiene metadati aggiunti da MediFlow, non prodotti da WHO.
Il codice della selezione WHO è in sola lettura: per sostituire o cancellare la selezione occorre passare dalla ricerca, mentre una nuova ricerca libera azzera codice e fonte. I test del modulo e la fixture E2E verificano il percorso con dati sintetici e DB temporaneo marcato, senza copiare il DB sorgente.
Il codec `MediFlowCore.DiagnosesCodec` conserva gli stessi campi opzionali nel decode/encode dell'editor nativo, senza introdurre Search o validazione WHO nativa. I riferimenti restano JSON opaco e i campi nil non aggiungono chiavi ai record precedenti; i test Core verificano round-trip, forma storica e fonti sconosciute. Nel modulo web i due campi opzionali null sono trattati come assenti: le diagnosi invariate non vengono riscritte e solo una modifica effettiva omette le chiavi vuote. Le prove di round-trip comprendono sia questi record sia le selezioni WHO con fonte completa.
Restano da completare export, altri caller, migrazioni storiche, certificazione e prova UI autenticata WHO. Prima della promozione, il §1.2.3 dei termini WHO deve essere valutato anche per questi flussi.

La documentazione congelata registra la consultazione del 2026-09-06 delle fonti primarie WHO: [deployment locale](https://icd.who.int/docs/icd-api/ICDAPI-LocalDeployment/), [container e opzioni](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/), [release/lingue](https://icd.who.int/docs/icd-api/SupportedClassifications/) e [release 2.6](https://icd.who.int/docs/icd-api/ReleaseNotes-Version2.6/). È a quella ricognizione che si riferisce la disponibilità di MMS inglese 2026-01; non viene proposta una traduzione italiana.

### Gate UI aggiuntivo del candidato

`components/settings/who-local-setup-guide.test.ts` unisce vincoli sui sorgenti e una fixture browser del componente reale con stati sintetici. La fixture è **NOT_RUN** nella consegna di riferimento: richiede l'opt-in esplicito `MEDIFLOW_WHO_UI_ACCEPTANCE=1`, le dipendenze del lockfile e un browser già disponibile. Senza opt-in i test non scaricano né avviano nulla.
Le interazioni verificano comando comune e tre OS, nuovo consenso, clipboard, reset/focus e assenza di richieste/provider o disponibilità inventata; non provano backend o WHO. Il componente reale è montato in StrictMode, con promesse clipboard controllate per osservare completamenti tardivi, cambio passo/host, reset e smontaggio. La fixture parent `lib/reference-data/repertory-guides-ui.test.ts`, aggiornata entro D2, parte dal default Node e richiede poi la scelta esplicita macOS/Windows/Linux, conservando consenso, clipboard, reset, focus e zero richieste. I casi AIFA restano invariati e anche questa fixture browser è **NOT_RUN**. Il cleanup della UI è corretto senza sopprimere il warning; ESLint completo resta un gate parent da rieseguire.


## Follow-up 2 — trasporto proposto senza curl nell'immagine

**PROPOSED; nessuna qualifica runtime Linux/Windows/macOS nella consegna di riferimento.** Sull'immagine ARM64 pinnata il parent ha osservato exit127 di `curl`, prima che partisse qualsiasi richiesta HTTP. Questo esito non prova presenza o assenza di wget, Python, Node o altri strumenti nel container, e la proposta non cerca un'alternativa tra questi.

Per non dipendere da un client supposto nell'immagine, `scripts/who-local-probe.mjs` usa soltanto `node:http` dell'host Node 24 esistente. Non introduce compiler, SDK, helper image o binari scaricati, non apre server né CLI/background daemon, non modifica endpoint MediFlow e non accede ad account o database.
Ogni GET usa un agent privato senza proxy d'ambiente, l'IPv4 letterale `127.0.0.1` e la porta verificata sul container esatto, con API-Version v2, inglese e solo quattro query fisse. Il limite assoluto è 5 s, senza estensione per byte lenti; corpo e header non possono superare rispettivamente 65536 e 8192 byte. Sono esclusi redirect, hostname, URL dal chiamante, compressione e autenticazione. Sono obbligatori una risposta completa UTF-8 JSON e URI WHO MMS 2026-01 validi, oltre al readback prima/dopo ogni richiesta di ID, UUID, immagine, daemon, port binding ed epoch del processo.

Acquisition usa il source sulla rete di download consentita e la porta 8382. Offline restart, restore e original recovery richiedono invece la rete bridge **internal** creata e registrata dall'installazione, con opzioni chiuse, IPv6 disabilitato e assenza di default route o route con gateway nelle tabelle effettive. Il restore pubblica una sola porta effimera `127.0.0.1::80`, osservata sul suo ID: non può essere indovinata o fissata in conflitto con 8382. Dopo riavvio indipendente, nuova ricerca e confronto di hash/metadati, l'originale rimane internal. Reti, container fermati, snapshot e ricevute vengono conservati; non si elimina alcuna risorsa.

### Blocco di fattibilità da verificare prima di una promozione

**Non è dimostrato che il motore locale esponga un listener host funzionante per un container con la sola rete internal.** La base congelata riporta un precedente Mac con porta non esposta in quello stato, e il problema Moby #36174 descrive la stessa limitazione generale. Né la presenza di `HostConfig.PortBindings` su una rete internal né l'opzione `gateway_mode_ipv4=nat` provano una pubblicazione effettiva; quest'ultima non è una correzione verificata del limite.

Per questo il candidato richiede sia `NetworkSettings.Ports` corretto sia una risposta HTTP reale della stessa istanza. Un mapping assente termina il percorso con `probe_endpoint_unavailable`; se il mapping esiste ma la connessione non riesce, è ammesso soltanto il polling bounded previsto per l'avvio. Alla scadenza la prova resta incompleta, la causa specifica viene conservata e WHO rimane disabilitato.
**Il percorso A–Z può quindi arrestarsi al primo probe offline sul target reale: non è un'installazione tri-OS risolta o qualificata.** Il parent può respingere la proposta in review prima di qualunque esecuzione guest. Non sono previsti fallback verso bridge esterni, relay, IP VM o tool supposti disponibili.

Il percorso propone Docker Engine **>=28** per la semantica documentata del binding loopback, ma non seleziona né installa una versione. Sul target occorre registrare Engine/API, rootless, Desktop/VM e firewall effettivi, senza cambiare contesto, configurazione daemon, firewall o VM e senza elevare i privilegi già necessari per socket/pipe.

Restano prerequisiti dell'immagine **non verificati nella consegna di riferimento** `cat` per le due tabelle route, `stat`, `sha256sum` e, solo per il restore Windows, `chown`/`chmod`. Ogni comando reale deve riuscire: exit127/126/ENOENT/EACCES e timeout sono errori terminali, non segnali di readiness. Anche la semantica dei metadati di `docker cp` deve essere qualificata su ogni host; i metadati dell'originale non vengono riscritti.

### Ricevute incomplete, migrazione e recovery

La v3 distingue quattro osservazioni e sei readback di isolamento prima/dopo, conservando inventario dei cinque file, hash reali, restore fermato e recupero separato dell'originale. Per non perdere la causa anche quando un avvio successivo riesce, `probeFailures` registra tentativo e causa bounded di ogni probe fallito. Il primo errore resta in `failure`/`failureCause`; un cleanup fallito viene registrato in `cleanupFailures` e `recoveryFailure`, senza sostituirlo con cancelled/dataset_not_ready. Le ricevute non raccolgono indiscriminatamente stdout/stderr, env, credenziali o log.

In caso di errore o annullamento si tenta soltanto di fermare i container dei quali restano verificabili ID/ownership, engine e reti. Se manca l'autorità o la fermata fallisce, la ricevuta deve dichiararlo: una configurazione disabilitata **non attesta un container fermo** e non modifica MediFlow già in esecuzione. Non si aggiungono attese per simulare un recupero né si riconnette il bridge.
Il parent deve leggere i soli ID registrati e la causa, non ripetere il setup fino a ottenere un esito positivo. Un'interruzione fra due operazioni di rete può lasciare una topologia ambigua, che non viene adottata o riparata automaticamente. Gli snapshot storici non vengono sovrascritti.

### Fonti tecniche consultate per questa proposta

- Docker, [port publishing](https://docs.docker.com/engine/network/port-publishing/): documenta binding localhost e limitazione delle versioni precedenti alla 28, non il comportamento del target.
- Moby, [issue 36174](https://github.com/moby/moby/issues/36174): riporta il limite di pubblicazione su rete internal; non è una prova del candidato.
- Node 24, [HTTP API](https://nodejs.org/docs/latest-v24.x/api/http.html): è il riferimento per agent, proxy d'ambiente e client HTTP, senza aggiunta di librerie esterne.

`GUEST-A-Z.md` della consegna di riferimento descrive review, preflight, prova Linux isolata, alternative Windows/macOS, readback delle ricevute, stop-rules e successiva prova applicativa. L'intera procedura guest resta **NOT_RUN**.
# F5 — Mac: primo avvio, diagnosi e ripresa dello stato posseduto incompleto

RUN_ID: 989f06de3f2341be87d202cc2ee55652. **PROPOSED; qualifica reale Mac non eseguita nella consegna di riferimento.** Il perimetro 0.8.6 comprende Mac, localhost sul Mac e backend condiviso/Headless sullo stesso Mac; non viene qualificato alcun nuovo percorso Windows/Linux/Mini/mobile.

## Stato di partenza e significato delle evidenze

La capsula parent riporta Node 24.19/Mac, **222 PASS/0 FAIL/3 SKIP** nella suite precedente e quattro scenari di trasporto PASS sull'immagine ARM64 pinnata. Il successivo setup WHO, pur con ACCETTO reale, è fallito: nel log pre-cleanup compare un errore di caricamento di `icd11_2026-01-17_release-icf-mms_en.pbf.gz`, seguito dalla terminazione con codice 134 del processo WHO, con OOM=false. Il relay con codice 137 contemporaneo non basta a diagnosticare un timeout incompatibile.
La causa sottostante — acquisizione esterna, proxy/DNS/TLS, distribuzione del catalogo, caricamento/compatibilità del servizio o altro — **non è dimostrata**, e il diff privo di file dataset non prova un guasto di rete. Il container posseduto è fermo e WHO deve restare disabilitato; il servizio estraneo sulla porta 8888 non è un'alternativa né una risorsa da modificare. Questi esiti parent descrivono il punto di partenza, non risultati del candidato F5.

## A. Integrare senza sostituire la base

Applicare soltanto l'incremento F5 ai sorgenti F4 esatti: eseguire VERIFY.mjs in modalità `before`, poi `git apply --check IMPLEMENTATION.patch`, applicare la patch una sola volta e usare VERIFY.mjs in modalità `after`. Non sovrapporre un full replacement F3 o F2 né modificare file immutati, modi, lock, digest o i cinque nomi.
L'ADR D12/D13 resta una proposta: la patch ne dipende, ma non introduce un nuovo contratto accettato. Integrazione ed eventuale promozione sono decisioni parent distinte, precedute dai controlli canonici del progetto con il runner parent.

## B. Non distruggere lo stato fallito

Conservare lo stato fallito senza cancellare `installation.json`, `license.json`, `manifest.json`, `who.env`, cartelle `snapshot-*`, container o rete registrata, e senza cambiare manualmente fase o flag. Un lock `.setup-active` richiede prima la verifica locale che non vi siano procedure ancora attive: non rimuoverlo alla cieca. Sono vietati `docker
rm`, prune, rename, reset, adozione per nome, pull di latest, cambio d'immagine o copie dei dataset di un servizio estraneo. Non leggere né copiare dati paziente.

## C. Leggere lo stato, senza avviare WHO

Per leggere lo stato dalla directory del candidato integrato, usare sul Mac il Node 24 già previsto:

```sh
bash Setup_WHO.command diagnose
```

Il launcher originale, invariato, inoltra `diagnose`, che controlla cartella privata, manifest/licenza, host/engine binding, owner, ID e immagine esatti, topologia e campi di runtime selezionati. L'azione non crea ricevute né esegue start/stop, EXEC, ricerche HTTP, lettura log, diff o download; non apre la porta 8382 e non usa la porta 8888. Non emette Config.Env, State.Error testuale, endpoint/identificatori privati o URL con token.
La diagnosi distingue stato corrente e precedente errore minimizzato, perché un container fermo può riflettere il cleanup anziché la causa iniziale. Per ricostruire il fallimento occorre quindi la prova **pre-cleanup**, senza reinterpretare l'exit corrente come diagnosi certa.

`diagnose` non sostituisce le quattro ricerche WHO: `qualifiedReceipt=true` indica soltanto una ricevuta salvata valida. Se mancano stato o ID confermato non si avvia discovery/adoption; se owner, engine o rete sono discordanti occorre fermarsi, senza aggirare la verifica. Il codice `incomplete_attempt_requires_review` segnala risorse di un tentativo interrotto ancora irrisolte: conservarne i riferimenti e verificare il caso, senza riconnettere bridge o sovrascrivere la ricevuta.

## D. Discriminare prima di riprovare

| Osservazione effettiva | Cosa permette di concludere | Azione e limite |
|---|---|---|
| stesso owner/engine/epoch, WHO exited134 prima/durante preflight | arresto del processo WHO; il relay può essere stato interrotto dal container | conservare exit/OOM e causa relay separata; nessun riavvio automatico; causa esterna indeterminata |
| stesso processo ancora running, relay_deadline_unverified | prova del deadline non acquisita in quel tentativo | non considerare il trasporto qualificato dal solo fatto che il servizio è vivo; controllare le quattro prove F4 senza cambiare argv |
| stesso processo running, connessione rifiutata/503/timeout | indisponibilità temporanea, non successo | polling solo per queste tre classi, massimo 60 prove e budget di 15 minuti; exit, drift o annullamento interrompono |
| risposta reale ma file assente, metadati/hash diversi | non superato il gate dati/ripristino | conservare copia/ricevuta incompleta, non cambiare schema o generare digest |
| owner/engine/epoch o rete cambiati | autorità/currentness persa | nessun retry, adozione, egress o cleanup su risorse non più autorizzate |

Fonte WHO ufficiale consultata per il difetto descritto:
https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/
La documentazione conferma ARM, `include=2026-01_en`, necessità di Internet al primo avvio e funzionamento offline dopo l'acquisizione; per le reti che lo richiedono prevede il parametro `https_proxy` esplicito al container. **Non** identifica però la causa di questo exit134, non fornisce un URL privato di download da indovinare e non dimostra che un'immagine già scaricata riesca ad acquisire il catalogo. Né la connessione del browser host né un test TCP locale qualificano il percorso WHO.

Con l'amministratore della rete verificare se il percorso iniziale autorizzato del container consenta davvero l'accesso ai servizi WHO senza proxy o certificati non forniti. Non stampare URL con credenziali, copiare Config.Env o stack raw, né inviare log a servizi esterni. Proxy, credenziali e certificati necessari non possono essere inventati: occorrono una configurazione supportata esatta e una **nuova proposta ADR separata prima di cambiare il container governato**, senza inserimenti impliciti in F5.
Se l'accesso è consentito ma il caricamento continua a fallire, serve una spiegazione primaria WHO o un riscontro discriminante sull'immagine e sulla release esatte. Il blocco deve restare, senza sostituire il requisito con tentativi su release, lingue o pin differenti. I log minimizzati allegati identificano il file fallito, non la causa nel trasporto di rete o nel contenuto del dataset.

## E. Un tentativo esplicito, stessa installazione

Solo dopo la verifica esterna pertinente, e accertato che nessun altro setup sia attivo, eseguire:

```sh
bash Setup_WHO.command qualify
```

Confermare `s` alla richiesta di ripresa: viene verificata e conservata la precedente licenza ACCETTO, non introdotta una nuova accettazione fittizia. Se quella registrazione non è coerente, il percorso si ferma; non avviare una seconda installazione. Solo per una vera prima installazione priva di stato usare `setup`, accettando personalmente i termini quando richiesto.

F5 salva configurazione disabilitata e tentativo incompleto **prima** di avviare l'originale fermo, poi conferma l'ID restituito e osserva il runtime. Nella fase iniziale di quel gesto il servizio originale viene avviato al massimo una volta; i successivi riavvii intenzionali di qualifica sono fasi separate. Se si arresta con codice 134 il tentativo termina immediatamente, senza ripartire 60 volte.
La ricevuta minimizzata pre-cleanup conserva exit/OOM, fase, epoch ed eventuale causa relay precedente, mai corpi, log o URL. Il nuovo tentativo rinvia al precedente attemptId senza modificarne qualification.json né ricostruirne la prova. Anche una ripresa fallita lascia la configurazione disabilitata e conserva entrambe le prove.

Finché WHO resta vivo ma non pronto sono ammessi solo i tre errori transitori previsti. Il budget monotono di 15 minuti viene controllato ai confini delle operazioni sincrone, ciascuna già bounded: non garantisce SIGINT istantaneo né la conclusione di cleanup e comando in corso all'esatto millisecondo del budget. Stop conserva timeout di 30 s e conferma di ID/stato; un errore di cleanup viene registrato separatamente, senza cancellare la prima causa. SIGINT/Ctrl-C non equivale a rollback o qualifica.

## F. Criteri A–Z, nessuna scorciatoia

Il target Mac può essere dichiarato operativo soltanto dopo aver osservato, sullo stesso candidato, pin e licenza coerenti e acquisizione con risposta WHO reale attraverso il listener posseduto 127.0.0.1:8382 verso la destinazione interna 127.0.0.1:80. Devono essere presenti tutti e cinque i file con metadati consentiti e uno snapshot inventariato con hash reali; occorrono poi rete interna senza egress, riavvio offline con nuova ricerca e ripristino separato con un'ulteriore ricerca, metadati e hash corrispondenti. Dopo la fermata della copia ripristinata va recuperato l'originale, con una quarta ricerca indipendente e hash corrispondenti. Prima e dopo ogni risposta restano obbligatori i guard engine/owner/container/epoch/topologia e i limiti F4.

Il trasporto F4 e le quattro prove opt-in restano invariati. Se il parent li ripete, deve registrare gli esiti come trasporto-only: la terminazione di client/timeout temporanei non dimostra il riassorbimento ripetuto dei processi da parte del PID1 WHO reale, che resta un gate Mac separato. Le precedenti prove Linux o un listener diverso non qualificano il Mac.

## G. Avvio e verifica applicativa, solo dopo qualifica reale completa

```sh
bash Setup_WHO.command start
# oppure, per un backend condiviso/Headless già avviato sullo stesso Mac:
bash Setup_WHO.command serve
```

Mantenere aperto il processo proprietario del ponte ed eseguire realmente Search e controllo codice dal backend, verificando cancel/chiusura e indisponibilità dopo la chiusura del ponte. La disponibilità non si deduce da who.env o da status: le prove appMac/Xcode/browser restano a carico del parent. Qualsiasi gate mancante, nuovo exit, hash difforme, egress, identità discordante o risposta incompleta impedisce la promozione. Il candidato F5 non ha eseguito questi test Mac reali.