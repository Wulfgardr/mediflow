# WHO locale — candidato Mac 0.8.6, follow-up 4

**Perimetro attuale: Mac, localhost sul Mac e backend condiviso/Headless sullo stesso Mac.**
Windows, Linux, Mini, iOS/iPadOS sono rinviati alla 1.0. I sorgenti e i test di
portabilità già consegnati sono conservati; non sono una qualifica di rilascio.
La prova Linux r3 allegata è una diagnosi di F-WHO4, non una prova Mac.

**PROPOSTA, non contratto accettato:** leggere prima
[WHO-TRIOS, emendamento D9–D11](../proposals/WHO-TRIOS-ADR.md).
Gli ADR accettati, le route applicative, il motore di ricerca e il launcher base
non cambiano. Le sezioni storiche più sotto spiegano il lavoro precedente:
le istruzioni su pubblicazione Docker, v3 e tre OS NON sono la procedura Mac
corrente. Per Mac prevalgono questo capitolo e D9–D11.

## Correzioni e gate

F-WHO2 accetta solo combinazioni di URI WHO canonici della release 2026-01,
separati esattamente da ` & `: massimo16 componenti/1536 caratteri; limite codice32
invariato. F-WHO3 usa `container stop --timeout 30`, con ID esatto restituito e
readback indipendente dello stato fermo. Il delta locale pre-direttiva a quattro
file è attribuito al suo autore precedente, non presentato come nuovo codice o
nuova evidenza di questo run.

F-WHO4 non viene risolto interpretando porte nulle come raggiungibili. I nuovi
container Mac non pubblicano porte Docker. Il solo processo Node24 possiede
`127.0.0.1:8382` e inoltra le tre forme GET del backend tramite un programma EXEC
fisso verso `127.0.0.1:80` nel container esatto. Le richieste HTTP viaggiano su
stdin, mai come codice shell. La copia ripristinata usa un listener temporaneo
con porta assegnata dal sistema, distinta8382. Nessun nuovo container, immagine,
privilegio, mount, proxy generico o riconnessione al bridge esterno è introdotto.

Dopo l'acquisizione, WHO resta sulla sola rete internal posseduta, con verifiche
IPv4/IPv6 prima e dopo ogni risposta. Identità motore/endpoint Unix, ID, owner,
immagine pinnata, epoch/PID, rete/membri e limiti sono ricontrollati. Una risposta
con guardia fallita non è rilasciata all'applicazione. Origin del browser,
Cookie/Authorization, URL arbitrari, redirect, body in ingresso e metodi diversi
da GET sono rifiutati. Il server Web non riceve autorità Docker.

**Prerequisito corretto F4, ancora PROPOSTO:** il parent ha osservato
BusyBox1.37.0 e assenza di Bash nell'immagine ARM64 pinnata. Il programma è ora
un argv fisso, senza shell o opzioni GNU:

```
/bin/busybox timeout -s KILL 4 /bin/busybox nc -n -w 5 127.0.0.1 80
```

HTTP passa soltanto su stdin, chiuso dopo il GET. Il timeout interno di4 secondi
non è un controllo di process group GNU. `nc -w 5` non sostituisce il deadline
assoluto. Il client deve chiudere la sola scrittura TCP all'EOF di stdin e leggere
il resto della risposta. Servono exit0, Content-Length esatto o chunked completo,
JSON/UTF8 validi, cap e controlli identità prima/dopo; nessun body senza framing,
parziale o seguito da errore viene accettato. Il preflight verifica echo+EOF,
help nc richiesto e una vera scadenza timeout/cat con stdin mantenuto aperto,
sempre come UID/GID65534 e con rilettura dell'identità. Queste prove NON
qualificano TCP, terminazione nel container, WHO, restore o dataset.

La richiesta host mantiene deadline5 secondi, risposta64KiB, header8KiB,
concorrenza4 e massimo8 connessioni. All'annullamento si scarta il body e si
mantiene lo slot fino all'uscita EXEC o al limite host. Uccidere il solo CLI
al limite non certifica che l'interno sia già terminato: la prova immagine
opt-in verifica socket e processi interni separatamente. Nessuna installazione,
nuova immagine, shell custom o apertura egress è consentita come fallback.
Gli errori distinguono BusyBox mancante, timeout/nc incompatibili e deadline
non dimostrato. F3 non viene promosso: il contratto prerequisite e l'identificatore
trasporto BusyBoxv2 sono necessari per la nuova receipt Macv4. Una receipt v4 già
`ready` con campi obsoleti è `private_state_invalid`: non modificarla per
aggirare i controlli. Le installazioni incomplete conservano la ripresa esplicita.

## Procedura Mac attuale

Prima della qualifica WHO, dopo review del codice proposto e nel solo ambiente
Mac del parent, eseguire il test opt-in del trasporto sull'immagine ARM64 esatta
**già presente localmente**. Non scarica immagini, non avvia WHO/dataset e non
modifica container esistenti: crea solo peer temporanei identificati, con rete
none, senza volumi, UID65534. Il PID1 sintetico `cat` non è il processo WHO:
eventuali watchdog terminati ma non riassorbiti sono registrati separatamente.
La gestione/reaping delle richieste ripetute da parte del vero PID1 WHO resta
un gate distinto. La fine del CLI non vale da sola come termine del processo.

```sh
node --version  # deve essere 24.x
MEDIFLOW_WHO_BUSYBOX_CONTEXT=desktop-linux \
MEDIFLOW_WHO_BUSYBOX_MAC_ACCEPTANCE=I_ACCEPT_TEMPORARY_NO_NETWORK_TRANSPORT_TESTS \
node --test --test-name-pattern 'F4 parent Mac pinned-image' scripts/who-local-probe.test.mjs
```

`desktop-linux` è il contesto riportato dal parent: verificare che sia proprio il
contesto locale scelto. Su un Mac diverso scegliere esplicitamente il suo nome;
TCP/SSH ed engine non ARM64 sono rifiutati. Il test deve eseguire tutte le quattro
sottoprove, non risultare SKIP. Un PASS del solo trasporto non qualifica WHO.

Dopo questo gate e approvazione D10, nel checkout Mac con Node24 e runtime locale
autorizzato, completare le verifiche reali di installazione/offline/restore:

```sh
./Setup_WHO.command setup
./Setup_WHO.command status
```

`setup` richiede il gesto `ACCETTO`, crea solo risorse etichettate della propria
installazione, acquisisce immagine/dataset, misura cinque file e verifica quattro
ricerche reali distinte: acquisizione, riavvio offline, restore separato, recupero
dell'originale. Confronta hash/metadati e ferma la copia. La receipt Mac è **v4**;
v3 e precedenti richiedono nuova conferma e nuova qualifica, senza adozione o
promozione automatica. L'originale resta internal; un fallimento mantiene WHO
disabilitato e arresta soltanto i container di cui è ancora verificata la proprietà.
Un cambiamento di owner/motore impedisce anche cleanup non sicuro e viene riferito.

Per avviare l'app tramite il launcher ordinario, mantenendo vivo il ponte:

```sh
./Setup_WHO.command start
```

Il processo resta in primo piano e possiede mutex/listener per la durata del
launcher dell'app. Per l'app Mac o un backend condiviso/Headless già avviato con
la configurazione della propria installazione:

```sh
./Setup_WHO.command serve
```

`serve` non lancia/ferma l'app e richiede un terminale/gesto locale. Mantenerlo
aperto; Ctrl-C chiude solo il ponte. Non è un LaunchAgent o un daemon installato.
Non avviare `start` e `serve` insieme: mutex e conflitto porta sono gate, non
motivi per terminare altri processi. `qualify` richiede conferma e ricalcola
le prove; una nuova qualifica non può procedere sotto il ponte posseduto.

`status` è solo lettura: `qualified` significa receipt salvata, NON listener
presente o risposta WHO attuale. `MEDIFLOW_ICD_WHO_ENABLED=1` è configurazione,
non healthcheck. App già avviate non rileggono automaticamente un file ambiente.
Usare il supervisore previsto per le sole tre variabili canoniche e verificare
Search/code-check dal backend. La UI pazienti e `Start_MediFlow.command`
restano invariati: l'assenza del servizio WHO opzionale non modifica dati o DB.
La ricetta A–Z del pacchetto dettaglia avvio separato, riqualifica, stop-rules e
accettazione Xcode/appMac riservata al parent.

## Evidenza e limiti

Questo candidato non è stato eseguito su Mac né dentro Docker/WHO. I test nativi
Node24 usano socket host reali e Docker/dataset sintetici. I test BusyBox
sull'host, quando eseguibili, dichiarano build/capability e non qualificano
l'immagine WHO. Le prove GNU/Bash F3 sono superate, non riattribuite. I test
parent106PASS/lint0 e la diagnosi Linux restano evidenze precedenti, separate.
Nessun digest AMD64, licenza, snapshot o qualifica Mac viene generato da metadati.
Promuovere solo dopo osservazioni Mac reali complete, incluse ricerca del backend,
riavvio/restore, assenza egress, annullamento e pulizia sicura. Se uno strumento
richiesto manca nell'immagine, fermarsi e riportarne il codice: non cambiare pin,
contratto o rete per aggirarlo.

---

## Documentazione storica conservata — non procedura Mac corrente

# Contesto dei precedenti candidati WHO locali

La scelta vigente e il sidecar WHO locale, dietro l'Application Service
server-only di [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md).
Il vecchio container MediFlow e la porta `8888` restano ritirati. Non esiste fallback a
ICD-9, a JSON WHO grezzo o al servizio WHO remoto. Non sono richieste credenziali
OAuth. Il candidato comprende Search, stato e una procedura guidata con installer locale
a comandi fissi. Il server Web non esegue Docker.

Il [manifesto](./who-local-sidecar.manifest.json) distribuito ha lock obbligatori
non valorizzati: ogni installazione deve registrarli fuori Git. La documentazione congelata riferisce che il 7 settembre
2026 un deployment ARM64 di prova ha completato acquisizione, Search, riavvio
offline e ripristino dopo l'accettazione esplicita dell'operatore. Questa prova
non accetta i termini per altri utenti e non attiva servizi nelle installazioni.
Questa consegna non ripete né attesta quella prova storica. La revisione tri-OS
è una [proposta di contratto WHO-TRIOS](../proposals/WHO-TRIOS-ADR.md), non un ADR accettato.

## Configurazione server e stato

Il servizio e disattivato per default. Solo il processo server legge:

| Variabile | Valore |
| --- | --- |
| `MEDIFLOW_ICD_WHO_ENABLED` | `1` dopo il provisioning verificato |
| `MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST` | Digest reale `sha256:<64 hex>` dell'immagine bloccata |
| `MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID` | Identita `sha256:<64 hex>` dello snapshot inventariato |

Sono identificatori dichiarati dall'host, non attestazioni del contenuto del
sidecar. Le variabili vengono rilette al confine delle operazioni; cambiare
un file esterno non aggiorna automaticamente l'ambiente del processo.
Iniettare la configurazione tramite il supervisore previsto sul target.
Le precedenti variabili di rete e credenziali OAuth non sono lette dal locale.

Destinazione fissa `http://127.0.0.1:8382`, Search v2, release `2026-01`, MMS,
inglese. Nessun URL fornito dal browser, proxy o redirect. Limiti: query 160
byte UTF-8, 25 risultati restituiti, risposta 64 KiB, transport 5 s e audit 1 s.
L'audit conserva una proiezione esplicita della receipt validata, senza query,
codici, descrizioni o URI: `counts` contiene `resultCount`; i flag `schema`,
`operation`, `deployment`, `source`, `release`, `language`, `binding`, `image`,
`dataset`, `latencyMs`, `fetchedAt`, `expiresAt`, `completedAt` conservano i
rispettivi valori. `binding/image/dataset` corrispondono a
`bindingId/imageDigest/datasetSnapshotId`. I digest SHA-256 restano interi:
le chiavi brevi rispettano il limite di 80 caratteri del sanitizer audit.

Entro i 64 KiB il parser valida tutte le voci upstream, anche quelle oltre la
venticinquesima, e conserva l'ordine WHO. Restituisce le prime 25 con
`partial=true` se altre sono omesse o WHO segnala `resultChopped`. Una voce
malformata, codici/URI duplicati o un body oltre 64 KiB negano la risposta.
Le combinazioni di codici conservano il codice completo e un riferimento
ufficiale CodeInfo, dopo la verifica dei componenti restituiti da Search.
Questo riferimento non attesta una verifica clinica o una chiamata CodeInfo
per ciascun risultato. Search cerca termini. **Verifica codice WHO**, nei
Repertori o accanto a una diagnosi ICD-11, avvia invece CodeInfo e la lettura
del titolo del codice base: codice riconosciuto, non trovato e servizio non
disponibile sono esiti distinti. La cartella non viene modificata dal controllo.
Una fonte che dichiara una release diversa viene segnalata, senza ricodifica.
Per combinazioni, il titolo inglese mostrato riguarda esplicitamente il codice
base, non l'intera combinazione.

- `disabled`: opt-in assente;
- `configuration_required`: identificatori assenti o invalidi;
- `configured`: configurazione presente, risposta diretta recente non osservata;
- `available`: ricerca diretta riuscita nel binding corrente nelle ultime 24 ore;
- `unavailable`: tentativo diretto/audit fallito.

`configured` non equivale a `available`. Leggere lo stato non invia ricerche.
**Impostazioni → Diagnostica → Verifica con termine di esempio** interroga
solo al clic il termine pubblico `cholera`. La UI distingue risposta diretta,
cache e fallimento; una cache hit non ristabilisce la disponibilita del sidecar
e non aggiorna il tempo dell'ultimo successo diretto.

Cache solo RAM: 256 chiavi/4 MiB, TTL assoluto 24 ore senza rinnovo su hit.
Binding, immagine e dataset separano le chiavi. Disable, cambio configurazione,
dispose o clock regressivo invalidano cache e risultati pendenti. Il listener
loopback non autentica gli altri processi locali dell'host.

## Percorso ordinario locale tri-OS — PROPOSTA

Il candidato aggiunge un solo percorso Node 24 per macOS, Windows e Linux,
sullo **stesso computer che ospita MediFlow**. Windows/Linux non usano un Mac,
relay o server remoto. Il parent deve accettare la proposta WHO-TRIOS prima
che questa estensione sostituisca il limite di provisioning di ADR 0115.
Il contratto Web e i DTO Search/CodeInfo non cambiano.

### Prerequisiti e selezione del target

L'host Node può essere x64 o arm64. L'architettura dell'immagine dipende invece
dall'architettura osservata del **motore Docker Linux**, non dall'host o dal browser.
La procedura non installa Docker, non accetta termini al suo posto, non avvia
VM, non usa elevazione, non cambia gruppi né contesto Docker globale.
L'operatore sceglie, installa se necessario e avvia il proprio runtime.
Non viene dichiarato un installer/versione/requisito di licenza non verificato.

| Host della procedura | Endpoint locale ammesso | Stato iniziale del target immagine |
| --- | --- | --- |
| macOS x64/arm64 | Socket Unix assoluto canonico | ARM64 e AMD64: metadati verificati; consenso e qualifica locale ancora necessari |
| Linux x64/arm64 | Socket Unix assoluto canonico accessibile all'utente, senza sudo | Stesso gate basato sul motore |
| Windows x64/arm64 | Esattamente `npipe:////./pipe/docker_engine` oppure `npipe:////./pipe/dockerDesktopLinuxEngine` | Stesso gate; serve motore Linux, non Windows containers |

TCP, incluso loopback, SSH, pipe remote/arbitrarie, endpoint malformati o con
query/frammenti non sono accettati. Si neutralizzano gli override ambientali
Docker di host/contesto/TLS anche con maiuscole/minuscole differenti su Windows.
Identità del daemon, endpoint e architetture vengono legati all'installazione
e ricontrollati nelle operazioni. Questa è una difesa contro cambi accidentali,
non un'attestazione contro un amministratore locale che manipoli il runtime.

Il release-lock v2 verifica **offline** i byte dell'indice OCI allegato, i due
descriptor, il manifest figlio e il readback del target selezionato. Nel follow-up 1
entrambi i target hanno metadati pubblici verificabili: **verified_metadata**, non
immagine acquisita, licenza accettata, installazione qualificata o servizio disponibile.
I due readback riportano `imageAcquired=false`; nessun layer è allegato.

Per AMD64 sono copiati senza riserializzazione i byte pubblici forniti dal parent:

| Artefatto | SHA-256 dei byte esatti |
| --- | --- |
| `docs/who-lock-evidence/2.6.0-amd64.json` | `a63a4c1c73329ff2ebff616a0cde2089b6b0595dec25255844f57f5b1903a4b8` |
| `docs/who-lock-evidence/2.6.0-amd64-readback.json` | `2ab0f2979049422ae4df9c390eabd4088178f4eb08a715e572b35f876f983348` |

Il readback conserva `2026-09-08T13:24:41.901316+00:00`; il lock v2 lega
`2026-09-08T13:24:41.901Z`, la rappresentazione ISO in millisecondi dello stesso
istante usata dal verificatore JavaScript. Non è un nuovo readback. L'indice e le
evidenze ARM64 restano invariati. Il config AMD64 fornito nel pacchetto di contesto
lega il child a `linux/amd64`, ma non è un file sorgente nuovo né una prova runtime.

Se in una distribuzione mancano child/readback o il binding del lock, il percorso
restituisce `image_evidence_missing` **prima del consenso e del pull/create**.
Byte alterati o binding errati producono `release_lock_invalid`. Le fixture negative
rimuovono/alterano solo copie sintetiche, mai i file canonici. Non si cerca un altro
tag o un'immagine ARM in emulazione. Il digest locale osservato dopo il pull viene
controllato prima della creazione; inventario e prove offline/restore sono sempre
calcolati per quella specifica installazione.

### Preparazione, installazione, avvio

Nella cartella MediFlow del computer host, con Node 24 disponibile, il comando comune è:

```text
node scripts/who-local-onboarding.mjs setup
```

I launcher sottili delegano alla stessa procedura:

| Host | Comando dalla cartella MediFlow |
| --- | --- |
| macOS | `./Setup_WHO.command` (launcher originale conservato) |
| Windows, PowerShell | `.\Setup_WHO.ps1` |
| Linux, terminale | `bash ./Setup_WHO.sh` |

Scegliere fra eventuali contesti locali con il numero mostrato. La procedura
verifica il motore e il target, poi la porta 8382. Non adotta, ferma o rimuove
un servizio già presente con ownership non dimostrata. In caso di Docker assente
mostra i prerequisiti dell'OS e consente di ripetere il medesimo comando dopo
l'intervento dell'operatore. Un errore non apre altre destinazioni di rete.

Per una nuova installazione vengono mostrati versione, lingua, termini WHO e
operazioni previste. Scrivere **ACCETTO** registra il gesto locale e autorizza
il download della specifica immagine e le verifiche del nuovo servizio.
Nessuna accettazione viene precompilata dal checkbox Web o riusata da altri utenti.
Il primo download richiede rete; lo spazio libero per immagine, dataset e copie
va controllato sul target. Il candidato non finge di misurarlo né generalizza
le dimensioni del precedente deployment ARM64.

Al termine scegliere separatamente se avviare MediFlow. Il launcher **Avvia
MediFlow con WHO**, nella cartella privata, riesegue `start`, rilegge e controlla
lo stato e delega al launcher applicativo già esistente di quello stesso OS:
`Start_MediFlow.command`, `Start-MediFlow.ps1`, `scripts/start-mediflow.sh`.
Windows non richiede bash o un Mac. Le altre impostazioni ambientali restano
invariate; vengono composte soltanto le tre variabili WHO esistenti.
Un processo MediFlow già in esecuzione non viene interrotto. La policy PowerShell
rimane del gestore, senza bypass: il comando Node comune resta utilizzabile
quando l'organizzazione consente Node ma non il file launcher.

### Comandi operativi Windows e Linux (solo dopo autorizzazione sul target)

Dalla cartella MediFlow, con Node 24 e runtime Docker Linux locale già preparati
dall'operatore, usare esplicitamente questi comandi. `setup` può scaricare WHO solo
dopo il gesto richiesto; `status` è in sola lettura. Nessuno installa Docker.

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

Non è necessario eseguire `qualify` dopo un `setup` già concluso correttamente:
è un comando separato per una nuova verifica. `start` non rimedia automaticamente
alla mancanza di consenso, metadati o qualifica. Quando la policy consente Node ma
non il launcher PowerShell, il comando comune è
`node scripts/who-local-onboarding.mjs <azione>`; non aggira la policy degli altri
launcher o dei controlli ACL. Un contesto Docker remoto deve essere gestito dal
proprietario: la procedura non esegue `docker context use` e non lo converte.

Per prove pulite usare una macchina/account dedicato. `MEDIFLOW_DATA_DIR` isola
il database sintetico di MediFlow ma **non cambia la directory privata WHO** sotto
indicata: non basta impostarla per isolare un'installazione WHO preesistente.

### Stato privato, permessi e qualifica della propria installazione

Directory predefinite, sempre fuori dai sorgenti:

| Host | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/MediFlow/WHO/2026-01_en` |
| Linux | `$XDG_DATA_HOME/MediFlow/WHO/2026-01_en`, oppure `~/.local/share/MediFlow/WHO/2026-01_en` |
| Windows | `%LOCALAPPDATA%\MediFlow\WHO\2026-01_en` |

POSIX mantiene directory 0700, metadati/configurazione 0600 e payload snapshot
0644 dentro la directory privata. Windows richiede un percorso locale NTFS:
non UNC, device, ADS, reparse/junction, traversal o file hardlink. Una funzione
PowerShell fissa controlla owner corrente e ACL privato; solo le nuove directory
ricevono un DACL protetto. Gli ACL esistenti troppo ampi non vengono corretti
silenziosamente. I mode bit Windows non sono accettati come prova di ACL.
I percorsi con spazi/apostrofi sono passati come argomenti o dati; il launcher
Windows generato usa BOM UTF-8 anche per percorsi Unicode. Queste semantiche
hanno test di unità, non ancora una prova di esecuzione Windows reale.

Ogni installazione ha un UUID, container ID, pin e binding del daemon locale.
La qualifica acquisisce risposte bounded con termini pubblici fissi, ferma solo
il container posseduto, copia i cinque file previsti e calcola inventario/SHA-256
dai **byte acquisiti in quella installazione**. Non assume hash uguali fra architetture.
Verifica il riavvio su rete Docker interna senza IPv6/default route, crea una
copia di restore separata sulla sola rete interna, confronta dimensioni, metadati
e hash, ferma la copia e riavvia separatamente il servizio originale sulla rete
**internal posseduta**, senza riconnettere il bridge di acquisizione (proposta D6). Le copie e
la rete restano conservate; niente `rm`, `prune`, mount clinici o letture di log
indiscriminati. Analytics, DORIS, FHIR e restart automatico rimangono disattivati.

La protezione ACL dell'host non sostituisce `root:root`/0644 nel container Linux.
Per una copia proveniente da Windows vengono normalizzati soltanto i cinque
file del **nuovo container di restore posseduto**, prima del confronto di metadati
e hash. Non vengono alterati i permessi del dataset originale o di altre risorse.

La receipt di qualifica **v3** lega tentativo, host/motore, container originale/ripristinato,
immagine, network, inventario, esiti e tempi osservati. Tutti i gate riusciti
sono necessari per salvare configurazione abilitata; non autorizzano una scrittura
clinica. Queste prove osservano la topologia Docker interna, non ogni possibile
egress dell'host. I probe host non sostituiscono parser, autenticazione e DTO
applicativi. Il listener rimane `127.0.0.1:8382:80`.

### Ripresa, annullamento e migrazione

```text
node scripts/who-local-onboarding.mjs status
node scripts/who-local-onboarding.mjs qualify
node scripts/who-local-onboarding.mjs start
```

`status` non avvia, scarica, qualifica o fa una Search. `qualify` richiede
conferma e ripete le prove sul solo servizio registrato. `start` richiede una
qualifica valida e non installa implicitamente ciò che manca. Se il servizio
posseduto è fermo, il gesto di start ne permette l'avvio con verifica del listener.

Un pull interrotto conserva il consenso e lo stato preparato; riprendere richiede
una nuova conferma. Dopo un create confermato, l'ID viene persistito prima di
rispondere all'annullamento. Un create con esito ambiguo non permette adozione
per nome: serve indagine del gestore. Ctrl+C/TERM/chiusura input chiedono una
cancellazione cooperativa ai confini delle operazioni; una chiamata Docker sincrona
può completarsi prima che il segnale venga gestito. I socket HTTP host vengono
chiusi subito. La sola fermata delle risorse con ownership ancora verificabile può
proseguire: annullamento o fallimento non autorizzano un riavvio sul bridge con egress. La guida Web non può annullare un job host.

Fallimento e annullamento preservano snapshot e receipt incompleta. La
riqualifica invalida il file di attivazione prima di mutare le risorse, ma non
cambia l'ambiente di un server già aperto. Nessuna pulizia automatica del lock
`.setup-active`: dopo un arresto forzato il gestore verifica processi e identità
prima di rimuovere **quel solo lock**. Cambio host/daemon/endpoint invalida
l'autorità della vecchia receipt, senza cancellarla o usarla sul nuovo target.

Le registrazioni ordinarie v1 restano leggibili: status non le promuove e start
nega. Solo setup/qualify con conferma, ownership e target ARM64 coerenti le migra
alla versione installazione v2 e calcola una nuova qualifica **v3**, conservando
gli snapshot precedenti. Anche una vecchia qualifica v2 deve essere rifatta con
nuovo gesto: metadati e receipt legacy non autorizzano il trasporto v3.
La CLI tecnica v1 mantiene i suoi controlli ARM64/Unix; non è un percorso per
attivare AMD64 senza l'evidenza v2. Nessun ADR accettato viene modificato.

### Disponibilità nell'interfaccia

La guida distingue prerequisiti mancanti, evidenza immagine mancante, download,
qualifica, configurazione salvata e risposta diretta osservata. La scelta dell'OS
è esplicita e riguarda il server, non il browser. Copiare un comando o selezionare
un checkbox non installa e non rende disponibile WHO. `ready` della CLI significa
qualifica salvata, non il DTO `available` della sessione applicativa.
In MediFlow usare **Rileggi configurazione** e una **Verifica con termine di esempio**
esplicita. Cache hit e risposta diretta restano distinte. Nessuna nuova route
privilegiata, accesso al DB o scrittura clinica viene introdotta.

## Accettazione su macchina pulita — NOT_RUN per tutti e tre gli OS

Questa è una ricetta, non evidenza raccolta. Il parent la esegue soltanto dopo
revisione/accettazione dell'ADR e autorizzazione delle risorse di test. Usare una
macchina/account dedicato senza dati clinici e senza WHO preesistente; Node 24,
dipendenze **del lockfile** e runtime scelto già preparati dall'operatore.
Registrare OS/build, architettura Node, versione Node/Docker/daemon, tipologia
endpoint ammessa, immagine realmente disponibile, stato firewall e spazio libero.
Non registrare `Config.Env`, credenziali o dettagli personali; mantenere i readback
privati e soltanto il binding pseudonimizzato negli artefatti condivisibili.

| OS | Ambiente sintetico e prova launcher |
| --- | --- |
| macOS | Impostare `MEDIFLOW_DATA_DIR` a una nuova cartella privata di test esterna al checkout. Eseguire `./Setup_WHO.command` e successivamente il launcher `.command` generato. |
| Linux | Impostare `MEDIFLOW_DATA_DIR` a una nuova cartella privata di test esterna al checkout. Eseguire `bash ./Setup_WHO.sh` e il launcher `.sh` generato, senza sudo/Mac. |
| Windows | Impostare `$env:MEDIFLOW_DATA_DIR` a una nuova cartella NTFS privata di test, anche con spazi/apostrofo/Unicode. Eseguire `.\Setup_WHO.ps1` e il launcher `.ps1` generato, senza WSL bash/Mac/policy bypass. Registrare la versione PowerShell e verificare realmente ACL/reparse/hardlink. |

Per ciascun target: prima provare Docker assente/remoto e porta 8382 occupata da
un servizio di test, verificando assenza di mutazioni. Provare il rifiuto della
licenza, poi il consenso esplicito in un'installazione pulita. La distribuzione
canonica contiene ora i due artefatti AMD64; ci si attende la verifica metadati e
il successivo consenso, non disponibilità immediata. Su una copia dedicata con
evidenza assente/alterata il percorso deve ancora bloccarsi prima del pull.
La prova sintetica positiva AMD64 non sostituisce la prova reale, qui NOT_RUN.

Per un target con evidenze complete, osservare pull al digest, inventario reale
nuovo, riavvio offline e restore. Conservare receipt e hash del proprio inventario;
non usare gli hash dei test o del deployment storico. Provare interruzione/ripresa,
restore fallito e cambio identità su risorse dedicate, senza cancellare altri servizi.
Verificare che la configurazione rimanga disabilitata quando un gate fallisce.

Dopo qualifica, avviare esplicitamente il launcher MediFlow dello stesso OS con
il solo database sintetico. Nella UI autenticata verificare Search pubblica diretta,
cache/non disponibile e CodeInfo tramite i percorsi esistenti; controllare che
nessuna cartella clinica sia scritta automaticamente. Annotare separatamente
esito setup, qualifica dataset, avvio applicativo e disponibilità osservata.
Ripetere dopo un riavvio controllato: il percorso WHO non imposta avvio automatico.
Nessun test sintetico di questa consegna sostituisce questi passaggi.

## Procedura tecnica per deployment gestiti separatamente

1. Copiare il manifesto fuori Git e verificare target, risorse, disponibilita
   della porta e runtime container. Il candidato fissa `linux/arm64`; non prova
   la compatibilita o installabilita di uno specifico Mac.
2. Verificare nel registry primario `registry-1.docker.io` il riferimento
   `whoicd/icd-api:2.6.0` e il manifesto della piattaforma. Registrare digest
   reale, data e hash dell'evidenza conservata fuori Git. Non usare `latest`,
   hash sintetici o un digest copiato dal vecchio packet senza nuova verifica.
3. L'operatore valuta e, se decide, accetta espressamente i
   [termini WHO](https://icd.who.int/en/docs/icd11-license.pdf). Registrare fuori
   Git data e riferimento opaco alla decisione: la scelta del sidecar non e
   accettazione dei termini. Controllare i prerequisiti locali con:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage provision --manifest /percorso/manifesto-locale.json
   ```

   Il comando valida solo struttura e registrazioni: non verifica il registry,
   la validita della decisione o gli artefatti, e non esegue il provisioning.
4. Solo dopo questi gate e l'autorizzazione operativa ottenere l'immagine
   bloccata e creare manualmente un nuovo container identificabile. Parametri:
   bind `127.0.0.1:8382` verso porta container `80`, `include=2026-01_en`,
   `saveAnalytics=false`, `enableDoris=false`, `fhirSupport=false`;
   `acceptLicense=true` solo dopo il passo 3. Nessun mount clinico/socket Docker,
   avvio automatico o modifica globale. WHO documenta rete necessaria per
   immagine e primo caricamento del dataset; cio non autorizza traffico clinico.
5. Inventariare il dataset effettivamente acquisito e lo snapshot ripristinabile,
   conservando identita e hash dell'inventario. Il digest dell'immagine non e il
   digest del dataset. Il metodo supportato di snapshot/ripristino va verificato
   sul target; questo candidato non inventa percorsi interni, volumi o modifiche
   al software WHO. Se il ripristino non e ripetibile, l'attivazione resta bloccata.
6. Verificare con termini sintetici binding, Search, riavvio senza rete con nuove
   query e ripristino; osservare risorse ed egress del processo. Registrare le
   prove prima del controllo di attivazione:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage activate --manifest /percorso/manifesto-locale.json
   ```

   Soltanto dopo una verifica positiva sul target iniettare i due identificatori
   e l'opt-in server. Il checker non sostituisce queste prove.
7. Per aggiornamenti creare un deployment distinto, ripetere lock e verifiche
   e conservare il precedente recuperabile. Rollback: disabilitare Search e
   fermare solo il container candidato identificato; niente rimozioni globali.

Il manifesto distribuito fallisce intenzionalmente entrambi i gate finche le
registrazioni obbligatorie sono assenti. Non esiste avvio automatico dal server Web MediFlow.

## Prova storica riportata nella base — 7 settembre 2026

La sezione seguente è conservata come riferimento del sorgente congelato:
non è una prova eseguita in questo run e non qualifica il candidato tri-OS.

La prova usa l'immagine ufficiale `whoicd/icd-api:2.6.0`, piattaforma
`linux/arm64`, verificata nel registry e bloccata al digest
`sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e`.
Il runtime Colima dedicato usa 2 CPU e 3 GiB di RAM assegnati, senza mount
utente, analytics o cambio del contesto Docker predefinito. Queste sono risorse
assegnate alla prova, non requisiti minimi misurati per ogni target.

- Search locale: `cholera` restituisce 16 risultati, incluse combinazioni.
- Riavvio senza route di rete esterna: nuova ricerca `measles` riuscita.
- Ripristino su un nuovo container della stessa immagine: nuova ricerca
  `rubella` riuscita senza route esterna; cinque hash del dataset corrispondono.
- Application Service MediFlow: risposta diretta, nessun risultato e cache
  verificati, con DTO validato e audit raccolto dal probe. Questa prova non
  attraversa ancora la route HTTP autenticata o l'interfaccia del paziente.
- CodeInfo attraverso l'Application Service e il sidecar reale: `1A00` e
  `1A00&XN8P1` riconosciuti, titolo del codice base recuperato; `ZZ9999` non
  trovato. Tre receipt dedicate validate dal client, senza uso del database
  paziente. La verifica non usa cache e non converte codici o release.

Le due prove offline interrogano il loopback **dentro il container**: il network
Docker interno non esponeva la porta al Mac. Dopo il ripristino, il binding
host `127.0.0.1:8382` e stato verificato separatamente con il bridge ripristinato.
Non si deduce da queste prove un isolamento generale da ogni possibile egress.

Lo snapshot inventaria i soli cinque file del dataset osservati sotto `/tmp`
nel container fermo: 493.455.110 byte totali, identita
`sha256:ecf3b894425d5cfb7514868d554eb086a7b5e7284ef212d2bb230a84b523b825`.
Non include l'intera directory temporanea o lo stato del servizio. Le copie
di archivio restano private; nel container vanno ripristinati proprietario
`root:root` e permessi originali `0644`. Un primo tentativo con file `0600`
falliva durante la riscrittura dell'indice; ripristinare i metadati originali
ha consentito avvio e ricerca. Nessuna modifica al software o all'immagine WHO.

Inventario, hash, accettazione, fallimento iniziale e verifiche di recupero sono
conservati nel packet locale dell'operatore, fuori Git. Questo metodo e stato
osservato su quel target e quella immagine: non costituisce un installer
qualificato per Windows, Linux o per futuri aggiornamenti WHO.

## Verifica del candidato e limite di consegna

Le fixture coprono Search locale, route autenticata, client, stato passivo,
limiti, cache, timeout e manifesto. Non usano un servizio WHO o un corpus reale.

Con Node 24 e `MEDIFLOW_DATA_DIR` già impostata esplicitamente a una directory
sintetica di proprietà del run, invocazione focalizzata comune a tutti gli OS
(nessun glob dipendente dalla shell):

```text
node scripts/run-strip-types.mjs --test scripts/check-who-local-sidecar-manifest.test.mjs scripts/who-local-setup.test.mjs scripts/who-local-onboarding.test.mjs scripts/who-local-platform.test.mjs scripts/who-local-onboarding-portability.test.mjs scripts/who-local-probe.test.mjs lib/reference-data/who-local-setup-guide-state.test.ts components/settings/who-local-setup-guide.test.ts lib/reference-data/icd11-who-local-runtime.test.ts lib/reference-data/icd11-who-local-node-transport.test.ts lib/reference-data/icd11-who-local-integration.test.ts
```

Il runner fornito richiede `typescript@5.9.3` dal lockfile. Nel workspace
follow-up 2 Node **24.11.1** è presente, ma le dipendenze canoniche non sono
installate. Il tentativo del loader fallisce con `ERR_MODULE_NOT_FOUND` per
TypeScript prima delle asserzioni; il messaggio generico del runner non dimostra
l'assenza di Node 24. La suite nativa include anche il nuovo
`scripts/who-local-probe.test.mjs`: **157 PASS / 0 FAIL / 1 SKIP** (browser opt-in
non eseguito). Usa file e peer HTTP sintetici, non Docker/WHO. Non sostituisce i
check canonici o la qualifica sui target. Claims/crosswalk sono eseguiti sia sulla
base sia sul candidato; i test crosswalk sono 9/9 su entrambi. Lint/build sono
bloccati da dipendenze assenti; il tentativo diagnostico con TypeScript 5.8.3
non canonico fallisce per contesto/dependency mancanti e non è un typecheck PASS.
Gli esiti parent 129+9 del follow-up 1 e i risultati più vecchi restano storici,
non prove di questo candidato. Dettagli e log sono in `VALIDATION.md` della consegna.


Il DTO v2 conserva codice, titolo, URI canonico, partial e identita della fonte;
il client mantiene la lettura separata del DTO v1. La selezione nel modulo
paziente conserva `canonicalUri/reference` attraverso schema client, salvataggio
nel JSON `diagnoses` gia cifrato e rilettura. Questi campi sono opzionali per i
record storici/manuali; non vengono inventati URI per codici preesistenti.
`reference` contiene metadati aggiunti da MediFlow, non prodotti da WHO.
Il codice della selezione WHO e in sola lettura: sostituire/cancellare la
selezione tramite la ricerca. Una nuova ricerca libera azzera codice e fonte.
Nessuna nuova colonna SQLite, route o modifica alla cifratura. I test del modulo
e la fixture E2E verificano questo percorso con dati sintetici e DB temporaneo
marcato, senza copiare il DB sorgente.
Il codec `MediFlowCore.DiagnosesCodec` conserva gli stessi campi opzionali nel
decode/encode usato dall'editor nativo, senza Search o validazione WHO nativa.
I riferimenti restano JSON opaco; campi nil non aggiungono chiavi ai record
precedenti. I test Core verificano round-trip, forma storica e fonti sconosciute.
Il modulo web tratta i due campi opzionali null come assenti, senza riscrivere
diagnosi invariate; una modifica effettiva omette le chiavi vuote. Le prove di
round-trip includono questi record, oltre alle selezioni WHO con fonte completa.
Export, altri caller, migrazioni storiche, certificazione
e prova UI autenticata WHO restano da completare; il §1.2.3 dei termini WHO
resta un requisito da valutare anche per tali flussi prima della promozione.

Fonti primarie WHO riportate come consultate nella documentazione congelata il 2026-09-06 (non riaperte in questo run):
[deployment locale](https://icd.who.int/docs/icd-api/ICDAPI-LocalDeployment/),
[container e opzioni](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/),
[release/lingue](https://icd.who.int/docs/icd-api/SupportedClassifications/),
[release 2.6](https://icd.who.int/docs/icd-api/ReleaseNotes-Version2.6/).
MMS inglese 2026-01 e disponibile; non viene proposta una traduzione italiana.

### Gate UI aggiuntivo del candidato

`components/settings/who-local-setup-guide.test.ts` include sia vincoli sorgente
sia una fixture browser del componente reale con stati sintetici. La fixture browser
è **NOT_RUN** in questa consegna e richiede l'opt-in esplicito
`MEDIFLOW_WHO_UI_ACCEPTANCE=1`, dipendenze del lockfile e browser già disponibile;
non viene scaricato né avviato nulla da questi test quando l'opt-in è assente.
Le interazioni sintetiche verificano comando comune e tre OS, consenso nuovo,
clipboard, reset/focus e assenza di richieste/provider o disponibilità inventata.
Non sono una prova del backend o di WHO. La fixture aggiunge promesse clipboard
controllate per completamenti tardivi, cambio passo/host, reset e smontaggio;
monta il componente reale in StrictMode. La fixture parent
`lib/reference-data/repertory-guides-ui.test.ts` è aggiornata entro D2: default
Node, poi scelta esplicita macOS/Windows/Linux, conservando consenso, clipboard,
reset, focus e zero richieste; i casi AIFA restano invariati. Anche questa
fixture browser è **NOT_RUN** qui. Il cleanup della UI è corretto senza
soppressione del warning; ESLint completo resta un gate parent da rieseguire.


## Follow-up 2 — trasporto proposto senza curl nell'immagine

**PROPOSED; nessuna qualifica runtime Linux/Windows/macOS in questa consegna.**
Il parent ha osservato exit127 di `curl` sull'immagine ARM64 pinnata: nessuna
richiesta HTTP era partita. Non è prova dell'assenza o presenza di wget, Python,
Node o altri strumenti nel container. Questa proposta non ne cerca uno alternativo.

Il nuovo `scripts/who-local-probe.mjs` usa solo `node:http` dell'host Node 24
esistente: non introduce compiler, SDK, helper image o binario scaricato. Non
apre un server, non ha CLI/background daemon, non modifica gli endpoint di
MediFlow e non accede a account o database. Ogni GET usa un agent privato senza
proxy d'ambiente, IPv4 letterale `127.0.0.1`, porta verificata sul container esatto,
API-Version v2, inglese, solo quattro query fisse. Limite assoluto 5 s (non esteso
da byte lenti), corpo massimo 65536 byte, header massimo 8192 byte; niente
redirect, hostname, URL dal chiamante, compressione o autenticazione. Risposta
completa UTF-8 JSON e URI WHO MMS 2026-01 validi obbligatori. Ogni richiesta ha
readback prima/dopo di ID, UUID, immagine, daemon, port binding e epoch del processo.

Acquisition usa il source sulla rete di download consentita e la porta 8382.
Offline restart, restore e original recovery richiedono rete bridge **internal**
creata e registrata da questa installazione, opzioni chiuse, IPv6 disabilitato,
assenza di default route e route con gateway nelle tabelle effettive. Il restore
pubblica una sola porta effimera `127.0.0.1::80`, osservata sul suo ID, mai
indovinata o fissa in conflitto con 8382. L'originale rimane internal dopo
riavvio indipendente, ricerca nuova e confronto hash/metadati. Si conservano reti,
container fermati, snapshot e ricevute; non si elimina alcuna risorsa.

### Blocco di fattibilità da verificare prima di una promozione

**Non è dimostrato che il motore locale esponga un listener host funzionante per
un container con la sola rete internal.** Il sorgente congelato riporta già un
precedente Mac con porta non esposta in tale stato; il problema Moby #36174
riferisce la stessa limitazione generale. L'opzione `gateway_mode_ipv4=nat` non
viene dichiarata una correzione verificata di quella limitazione. Una rete
internal e `HostConfig.PortBindings` non equivalgono a pubblicazione effettiva.

Il candidato richiede anche `NetworkSettings.Ports` corretto e una vera risposta
HTTP della stessa istanza. Mapping assente: `probe_endpoint_unavailable`,
terminale. Mapping presente ma connessione non riuscita: solo il polling bounded
previsto per avvio; alla scadenza prova incompleta, causa specifica conservata,
WHO disabilitato. **Il percorso A–Z può quindi arrestarsi al primo probe offline
sul target reale. Non è una installazione tri-OS risolta o qualificata.** Il parent
può respingere la proposta in review, prima di qualunque esecuzione guest. Non
esiste fallback verso bridge esterno, relay, IP VM o tool supposto disponibile.

Questo percorso propone Docker Engine **>=28** per la semantica di binding
loopback documentata; non seleziona/installa una versione. Engine/API, rootless,
Desktop/VM e firewall effettivi restano informazioni da registrare sul target.
Non cambia contesto, configurazione daemon, firewall o VM. I privilegi già
necessari per il socket/pipe non vengono elevati.

`cat` per le due tabelle route, `stat`, `sha256sum`, e `chown`/`chmod` solo nel
restore Windows sono prerequisiti **non verificati qui** dell'immagine. Ogni
comando reale deve riuscire; exit127/126/ENOENT/EACCES e timeout di comando sono
terminali, non readiness. `docker cp` e la sua semantica di metadati restano da
qualificare su ogni host. Non vengono riscritti i metadati dell'originale.

### Ricevute incomplete, migrazione e recovery

La v3 contiene quattro osservazioni distinte, sei readback di isolamento
prima/dopo, inventario dei cinque file, hash reali, restore fermato e recupero
separato dell'originale. `probeFailures` conserva tentativo e causa bounded di
ogni probe fallito, anche quando avvio successivo riesce. Il primo errore rimane
`failure`/`failureCause`; un eventuale cleanup fallito va in `cleanupFailures`
e `recoveryFailure`, non sostituisce il primo errore con cancelled/dataset_not_ready.
Non si copiano stdout/stderr, env, credenziali o log indiscriminati nelle ricevute.

In errore o annullamento si tenta solo la fermata dei container i cui ID/ownership,
engine e reti sono ancora verificabili. Se la fermata o l'autorità fallisce, la
ricevuta lo dichiara: una configurazione disabilitata **non attesta container
fermo**, e non modifica un MediFlow già in esecuzione. Nessuna nuova attesa per
simulare il recupero, nessuna riconnessione bridge. L'intervento parent deve
leggere i soli ID registrati e la causa, non ripetere setup finoverde. Un'interruzione
tra due operazioni rete può lasciare una topologia ambigua: non viene adottata o
riparata automaticamente. Gli snapshot storici non vengono sovrascritti.

### Fonti tecniche consultate per questa proposta

- Docker, [port publishing](https://docs.docker.com/engine/network/port-publishing/):
  binding localhost e limitazione delle versioni precedenti alla 28; non prova il target.
- Moby, [issue 36174](https://github.com/moby/moby/issues/36174): limite riportato
  di pubblicazione su rete internal, non una prova eseguita in questo run.
- Node 24, [HTTP API](https://nodejs.org/docs/latest-v24.x/api/http.html): agent,
  proxy d'ambiente e client HTTP. Nessuna libreria esterna viene aggiunta.

Per la sequenza di review, preflight, prova Linux isolata, alternative Windows/macOS,
readback delle ricevute, stop-rules e prova applicativa successiva usare
`GUEST-A-Z.md` della consegna. Tutta la ricetta guest è **NOT_RUN** qui.
# F5 — Mac: primo avvio, diagnosi e ripresa dello stato posseduto incompleto

RUN_ID: 989f06de3f2341be87d202cc2ee55652. **PROPOSED; qualifica reale Mac non
eseguita in questa consegna.** Perimetro 0.8.6: Mac, localhost sul Mac e backend
condiviso/Headless sullo stesso Mac. Nessuna nuova qualifica Windows/Linux/Mini/mobile.

## Stato di partenza e significato delle evidenze

La capsula parent riporta Node24.19/Mac, 222 PASS/0 FAIL/3 SKIP nella suite precedente
e quattro scenari di trasporto sull'immagine ARM64 pinnata PASS. Il successivo setup
WHO, con ACCETTO reale, è invece fallito. Il log pre-cleanup mostra un errore di
caricamento di `icd11_2026-01-17_release-icf-mms_en.pbf.gz` e il processo WHO termina134,
OOM=false. Il relay137 contemporaneo non basta a diagnosticare timeout incompatibile.
La causa sottostante (acquisizione esterna, proxy/DNS/TLS, distribuzione del catalogo,
caricamento/compatibilità del servizio o altro) **non è dimostrata**. Il diff senza
file dataset non prova un guasto di rete. Il container posseduto è fermo; WHO deve
restare disabilitato. Il servizio estraneo8888 non è un'alternativa né una risorsa
da modificare. Queste evidenze parent non diventano risultati del candidato F5.

## A. Integrare senza sostituire la base

Applicare soltanto l'incremento F5 ai sorgenti F4 esatti. Prima usare VERIFY.mjs in
modalità `before`, poi `git apply --check IMPLEMENTATION.patch`; applicare la patch
una volta e usare VERIFY.mjs in modalità `after`. Non sovrapporre un full replacement
F3 o F2. Non modificare i file immutati, i modi, il lock, i digest o i cinque nomi.
L'ADR D12/D13 resta proposta: l'integrazione e l'eventuale promozione sono decisioni
parent distinte. La patch dipende dalla proposta, non introduce un nuovo contratto
accettato. Eseguire prima i controlli canonici del progetto con il runner parent.

## B. Non distruggere lo stato fallito

Non cancellare `installation.json`, `license.json`, `manifest.json`, `who.env`, le
cartelle `snapshot-*`, il container o la rete registrata. Non cambiare fase o flag
manualmente. Non rimuovere `.setup-active` alla cieca: un lock presente richiede
prima verifica locale che nessuna procedura sia ancora attiva. Non usare `docker
rm`, prune, rename, reset, adozione per nome, pull di latest, cambio immagine o una
copia dei dataset di un servizio estraneo. Non leggere/copiare dati paziente.

## C. Leggere lo stato, senza avviare WHO

Dalla directory del candidato integrato, sul Mac con Node24 già previsto:

```sh
bash Setup_WHO.command diagnose
```

Il launcher originale è invariato e inoltra l'azione. `diagnose` controlla cartella
privata, manifest/licenza, host/engine binding, owner, ID e immagine esatti, topologia
e campi di runtime selezionati. Non crea ricevute e non esegue start/stop, EXEC,
ricerche HTTP, lettura log, diff o download. Non apre8382 né usa8888. Non emette
Config.Env, State.Error testuale, endpoint/identificatori privati o URL con token.
Sono distinti stato corrente e precedente errore minimizzato. Un container fermo
può riflettere il cleanup: per la causa del fallimento usare la prova **pre-cleanup**,
non reinterpretare a posteriori l'exit corrente come diagnosi certa.

`diagnose` non prende il posto delle quattro ricerche WHO; `qualifiedReceipt=true`
indica soltanto una ricevuta salvata valida. Mancanza di stato/ID confermato non
innesca discovery/adoption. Owner, engine o rete discordanti: fermarsi, non aggirare
la verifica. `incomplete_attempt_requires_review` indica riferimenti a risorse di
un tentativo interrotto non ancora risolte: mantenerli e verificare il caso, senza
riconnettere bridge o sovrascrivere la ricevuta.

## D. Discriminare prima di riprovare

| Osservazione effettiva | Cosa permette di concludere | Azione e limite |
|---|---|---|
| stesso owner/engine/epoch, WHO exited134 prima/durante preflight | arresto del processo WHO; il relay può essere stato interrotto dal container | conservare exit/OOM e causa relay separata; nessun riavvio automatico; causa esterna indeterminata |
| stesso processo ancora running, relay_deadline_unverified | prova del deadline non acquisita in quel tentativo | non considerare il trasporto qualificato dal solo fatto che il servizio è vivo; controllare le quattro prove F4 senza cambiare argv |
| stesso processo running, connessione rifiutata/503/timeout | indisponibilità temporanea, non successo | polling solo per queste tre classi, massimo60 prove e budget15 minuti; exit, drift o annullamento interrompono |
| risposta reale ma file assente, metadati/hash diversi | non superato il gate dati/ripristino | conservare copia/ricevuta incompleta, non cambiare schema o generare digest |
| owner/engine/epoch o rete cambiati | autorità/currentness persa | nessun retry, adozione, egress o cleanup su risorse non più autorizzate |

Fonte WHO ufficiale consultata per questo difetto:
https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/
La documentazione conferma ARM, `include=2026-01_en`, necessità di Internet al primo
avvio e funzionamento offline solo dopo acquisizione. Per reti che lo richiedono
documenta il parametro `https_proxy` esplicito al container. **Non** identifica la
causa di questo exit134, non fornisce un URL privato di download da indovinare e non
prova che un'immagine già scaricata possa acquisire il catalogo. La connessione
funzionante del browser host o un test TCP locale non qualificano il percorso WHO.

Con l'amministratore della rete verificare se il percorso iniziale autorizzato del
container possa realmente accedere ai servizi WHO senza un proxy/certificato non
fornito. Non stampare URL con credenziali, non copiare Config.Env o stack raw e non
inviare log a servizi esterni. Un proxy necessario, credenziali o un certificato non
sono inventabili: servono configurazione supportata esatta e **nuova proposta ADR
separata prima di cambiare il container governato**. Nessun inserimento implicito
nel candidato F5. Se il percorso è consentito ma il caricamento fallisce ancora,
serve una spiegazione primaria WHO/riscontro discriminante sull'immagine e release
esatte. Mantenere il blocco, senza provare una release/lingua/pin differente in luogo
del requisito. I log minimizzati già allegati sono sufficienti a nominare il file
fallito, non a diagnosticare trasporto di rete o contenuto del dataset.

## E. Un tentativo esplicito, stessa installazione

Dopo la verifica esterna pertinente e con nessun altro setup attivo:

```sh
bash Setup_WHO.command qualify
```

Confermare `s` alla richiesta di ripresa. Nessuna nuova accettazione fittizia:
la precedente licenza ACCETTO viene verificata e conservata. Senza quella
registrazione coerente il percorso si ferma. Non lanciare una seconda installazione.
Per una vera prima installazione senza stato usare invece `setup` e accettare
personalmente i termini quando richiesto.

F5 salva configurazione disabilitata e tentativo incompleto **prima** di avviare
l'originale fermo, conferma l'ID restituito e osserva il runtime. Il servizio
originale viene avviato al massimo una volta per la fase iniziale di quel gesto;
i successivi riavvii intenzionali di qualifica restano separati. Se si arresta134,
il tentativo finisce immediatamente, non riparte60 volte. La ricevuta minimizzata
pre-cleanup conserva exit/OOM, fase, epoch e eventuale causa relay precedente;
nessun corpo/log/URL viene memorizzato. Il nuovo tentativo punta al precedente
attemptId, senza modificarne il file qualification.json o ricostruirne una prova.
Una ripresa che fallisce ancora resta disabilitata e conserva entrambe le prove.

Se WHO resta vivo ma non pronto, valgono solo i tre errori transitori già previsti.
Il budget monotono15 minuti è verificato ai confini delle operazioni sincrone,
ciascuna già bounded; non garantisce SIGINT istantaneo né che cleanup e comando in
corso terminino all'esatto millisecondo del budget. Stop mantiene timeout30s e
conferma ID/stato. Un errore del cleanup viene registrato a parte, senza cancellare
la prima causa. SIGINT/Ctrl-C non equivale a rollback o qualifica.

## F. Criteri A–Z, nessuna scorciatoia

Per dichiarare operativo il target Mac devono essere osservati sullo stesso
candidato: pin e licenza coerenti; acquisizione con risposta WHO reale attraverso
il listener posseduto127.0.0.1:8382 e destinazione interna127.0.0.1:80; tutti e cinque
file con metadati consentiti; snapshot inventariato/hash reali; rete interna senza
egress e riavvio offline con nuova ricerca; ripristino separato con nuova ricerca,
metadati e hash corrispondenti; copia ripristinata fermata; recupero dell'originale
con una quarta ricerca indipendente e hash corrispondenti. Prima/dopo ogni risposta
valgono ancora i guard engine/owner/container/epoch/topologia e i limiti F4.

Il trasporto F4 e le sue quattro prove opt-in restano esattamente invariati. Se
ripetuti dal parent, i risultati devono essere registrati come trasporto-only; la
terminazione dei client/timeout temporanei non dimostra il riassorbimento ripetuto
dei processi da parte del PID1 WHO reale. Quest'ultimo resta un gate Mac separato.
Non usare le vecchie prove Linux o un listener diverso come qualifica Mac.

## G. Avvio e verifica applicativa, solo dopo qualifica reale completa

```sh
bash Setup_WHO.command start
# oppure, per un backend condiviso/Headless già avviato sullo stesso Mac:
bash Setup_WHO.command serve
```

Mantenere aperto il processo proprietario del ponte. Eseguire realmente Search e
controllo codice dal backend, verificare cancel/chiusura e indisponibilità dopo la
chiusura del ponte; non assumere disponibilità dal solo who.env o da status. Le
prove appMac/Xcode/browser restano a carico del parent. Qualsiasi gate mancante,
nuovo exit, hash difforme, egress, identità discordante o risposta incompleta
impedisce la promozione. F5 non ha eseguito nessuno di questi test Mac reali.
