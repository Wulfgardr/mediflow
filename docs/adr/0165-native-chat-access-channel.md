# ADR 0165 — Canale di accesso della chat alla sessione GPUI

Stato: **Accepted** per il contratto del canale, con qualificazione desktop separata. Data: 26 ottobre 2026. Refs WUL-788.

## Decisione

C4a aggiunge soltanto il protocollo e l'esito di accesso, senza proiezioni
cliniche, mapping, inferenza o writer. Non completa C4 né il broker di ADR 0160.
La GPUI già sbloccata possiede un listener Unix locale, abilitato da un percorso
esplicito in una directory privata. Lo stesso eseguibile offre un adapter MCP
`--chat-access-stdio PERCORSO`, privo di accesso al DB. Non viene collegato
`card-owner.mjs`, che rimane sintetico.

Il listener acquisisce dal kernel `LOCAL_PEERTOKEN` e `LOCAL_PEERPID`.
Security.framework risolve il codice dinamico dal token, ne verifica la
validità e confronta l'hash del codice con quello dell'eseguibile GPUI.
Una firma ad hoc generica o un percorso uguale non bastano. La catena dei
processi viene riletta con start time; un antenato vivo deve soddisfare il
requisito Developer ID esatto dell'host. I requisiti osservati sul target sono
`com.openai.codex` / team `2DC432GLL2` e
`com.anthropic.claudefordesktop` / team `Q6L2SF6YDW`.
La cattura viene confrontata di nuovo prima dell'uso; PID riutilizzati,
eseguibili sostituiti, app assente o riavviata negano l'accesso.
Anche l'hash del codice dell'antenato viene congelato nella cattura.

L'adapter espone una vista statica e strumenti app-only. Il tool di apertura
restituisce testo fisso. Il frame correla le richieste; non contiene endpoint
HTTP, bearer, cookie, PIN, chiave, nonce di approvazione o proof e non aggiorna
il contesto del modello. Le risposte contengono soltanto stati finiti.
La sola operazione ammessa è `mediflow.chat.access-status.v1`.
Il bridge usa il [protocollo MCP Apps 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

La GPUI acquisisce dalla propria RuntimeSession la sessione operatore,
generazione archivio e selezione corrente. Il riepilogo nativo mostra host,
archivio, paziente e operazione, senza ricevere nomi dal chiamante.
La challenge interna dura 30 secondi. Touch ID usa LocalAuthentication con
policy biometrica; il PIN si inserisce soltanto nella GPUI e viene verificato
sul canale paired esistente da `verifyHostCredentials`, purpose confirmation,
con il lockout persistente comune. Nessun nuovo login, key wrapping o sblocco
a freddo: dopo riavvio serve il primo accesso v3.
Il GET della route privata `/api/auth/native/chat-access-confirmation` verifica
soltanto l'ammissibilità dell'account e il lockout; il POST verifica il PIN.
Nessuna delle due risposte è una proof. Anche il consumo dopo Touch ID rilegge
l'ammissibilità, per non aggirare un lockout del PIN sullo stesso account.

La concessione resta RAM e appartiene alla connessione OS, alla richiesta e
alla selezione catturata. Una sola operazione può consumarla. Il consumo
ricontrolla autorità e selezione, anche dopo attese asincrone. Il contesto
congela anche l'epoch della selezione host: un epoch diverso, locale o riletto
dalla porta `patient-profile/selection-epoch`, nega conferma e consumo.
Una vista
inattiva termina dopo cinque minuti, senza rinnovo automatico. EOF, reload,
revoca, lock della sessione/Mac, cambio selezione anche A→B→A, cambio archivio
e riavvio ritirano richieste e concessioni; una risposta tardiva non le ricrea.

## Minacce e limiti

Un altro processo dello stesso utente, un booleano nel frame, l'origine HTML,
un UUID, un link o una firma ad hoc diversa non attestano il peer.
La connessione e l'hash del codice impediscono di riusare una concessione in
un'altra istanza. Nessun riferimento intercettato è una capability esportata.
Il modello o un frame ostile possono chiedere una conferma, ma non produrla.
Codice già iniettato in MediFlow o nell'host firmato resta fuori dal confine:
il protocollo non attesta l'integrità del renderer dell'host né cancella byte
già acquisiti. Perimetro e assunzioni richiedono review indipendente del diff.

L'abilitazione locale non è installazione globale o distribuzione. Le prove
unitarie non attestano il gesto biometrico, il PIN reale, la ricezione/rendering
MCP Apps dei due host o il ritiro osservato al lock del Mac; queste prove vanno
registrate sulla revisione e sul bundle effettivamente eseguiti.

## Preparazione e verifica circoscritta

Sul solo Mac target, creare una directory socket privata con nome breve,
per esempio usando `mktemp -d /private/tmp/mediflow-c4a.XXXXXX` e permessi
`0700`. Il percorso del socket deve rientrare nel limite Unix di macOS.
Avviare il candidato con `MEDIFLOW_CHAT_ACCESS_SOCKET` impostato al file
`access.sock` di quella directory e `--server` riferito a un host sintetico
isolato. Pairing e primo sblocco v3 avvengono nella GPUI. Configurare il client
MCP per invocare **lo stesso identico eseguibile** con gli argomenti
`--chat-access-stdio PERCORSO_SOCKET`; un altro build, anche firmato dallo stesso
sviluppatore, viene negato. La route privata deve esistere nell'host candidato.
La directory non viene creata o ripulita automaticamente; un socket esistente
non viene sostituito. Non usare un archivio reale per questa qualifica.

Le prove native aggiuntive, ignorate di default perché la CI non ospita
Codex/Claude firmati, si eseguono con `cargo test -p mediflow-gpui-patient-pilot
chat_access::owner::tests -- --include-ignored`. Verificano il peer reale, mentre
l'esito di presenza dei casi di grant rimane dichiaratamente sintetico.
`node scripts/run-strip-types.mjs --test lib/security/native-chat-access-confirmation.test.ts`
richiede `MEDIFLOW_DATA_DIR` isolato e prova il verifier e la route reali.
`npx playwright test --config e2e/native-chat-access-frame.config.ts` prova
il frame con un host di test a 390 e 1440 px, senza attestare R su un host desktop.

Rilevazione del 26 ottobre: macOS `27.2 (26B118)`, Codex `26.1021.31345`
build `21828` e Claude `3.6556.2`. La rilevazione identifica installazioni e
requisiti di firma, non qualifica il percorso interattivo dei due host.

## Collegamento sintetico al broker, 30 ottobre 2026

L'operazione del socket diventa `mediflow.chat.synthetic-card.v1`. La GPUI
avvia un processo Node privato con configurazione locale esplicita; esso
compone il broker sintetico esistente e GLiNER, senza accesso all'archivio.
La revisione dei byte finali e la ricomposizione rimangono nella GPUI.
Dopo il gesto nativo, una sola lettura restituisce alla vista il payload
pseudonimizzato in `_meta`. L'adapter MCP non riceve il mapping o la fonte
ricomposta. Il verifier PIN paired mantiene il proprio purpose di conferma
nativa; non emette proof trasferibili né nuove sessioni.

Il [rapporto del contributo](../analysis/2026-10-30-chat-native-broker/README.md)
distingue prove automatiche, GLiNER reale e prove desktop ancora aperte.
Questa composizione resta esplicitamente sintetica, non modifica writer,
ammissione clinica o qualificazione desktop del canale.

## Estensione del 31 ottobre 2026: dettatura locale

Il comando app-only `local-voice` riusa il canale nativo e restituisce soltanto
`requested`, `voice-opened` o un diniego. Non concede accesso alla scheda e non
può consumare una trascrizione. La cattura inizia soltanto dopo il gesto nella
finestra MediFlow. Il bundle dichiara lo scopo del permesso microfono.

La GPUI collega staticamente il motore Apple già usato dal client Swift:
preflight, limiti PCM, cattura, finalizzazione e contratto di stato restano gli
stessi sorgenti. `SpeechTranscriber` esegue la trascrizione sul dispositivo;
servono macOS 26 e risorse italiane già installate. Il raccordo ne verifica la
presenza e non richiede download né usa `SFSpeechRecognizer` o servizi remoti.
Toolchain non supportate espongono l'indisponibilità, senza un motore alternativo.

Audio e trascrizione restano nel processo nativo, anche se contengono nomi o
altri identificativi. Non esiste un payload voce nel bridge verso la chat o il
modello. Il medico rilegge e corregge il testo, poi può trasferirlo a una bozza
nel compositore di diario esistente. Il salvataggio continua a usare revisione,
conferma e writer comuni. La fine della trascrizione non apre né esegue writer.
La bozza voce appartiene ad archivio, sessione, ambulatorio, paziente, revisione
ed epoca correnti: cambio contesto, revoca o blocco ne impediscono il trasferimento.
Un'altra richiesta della chat non sostituisce una revisione voce aperta.

Le prove automatiche usano un doppio dietro `VisitRecordingRuntimePort`, senza
microfono, audio persistito o dati reali. Verificano il raccordo e i dinieghi;
non qualificano la cattura hardware, l'accuratezza del riconoscimento o i due host
desktop. I claim crittografici e l'autorità del modello restano invariati.

Riferimenti Apple: [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)
e [SpeechAnalyzer, WWDC25](https://developer.apple.com/videos/play/wwdc2025/277/).

## Consultazione AIFA dalla vista app

La seconda tranche C-7/C-8 aggiunge il comando app-only `drugs`, con query
testuale di 2-80 caratteri e senza identificativo paziente. Il listener
riusa la richiesta nativa, il binding di sessione e la conferma monouso.
`RuntimeSession.chat_drug_search` compone esclusivamente conteggio e ricerca
del servizio catalogo esistente, con un limite di 20 risultati. Nessuna route
o contratto HTTP cambia. L'output `mediflow.drug-catalog.v1` è un risultato
non generativo, app-only, con fonti opache per riga e aggiornamento dichiarato
non verificato. Il frame valida schema chiuso, limiti e tipi, e renderizza
soltanto testo. Non interpreta token PII e non aggiorna il contesto del modello.
Il broker clinico conserva il proprio confine sintetico e la propria autorità.
Il grant non autorizza prescrizioni, scritture o inferenza. Le prove sui due
desktop reali restano alla qualifica, così come la negoziazione delle capacità.

## Proiezioni cliniche dell'archivio: decisione del 31 ottobre 2026

La grammatica `mediflow.synthetic-chat-card.v1` rimane riservata alle fixture.
Non ammette letture dell'archivio né testo clinico arbitrario. Un raccordo ai
servizi comuni richiede un profilo distinto, versionato e a schema chiuso;
aggiungere valori al profilo sintetico non costituisce tale raccordo.

Per una proiezione clinica valgono C-B, C-3a, C-3b, C-4, C-7 e C-8 del
[contratto 0.9.1](../releases/0.9.1-contract.md). La selezione precede la
redazione: ogni campo clinico ammesso è testo con una fonte opaca, legata
localmente alla revisione letta. Identità, ID dell'archivio, filename, percorsi
e riferimenti originali non sono fonti esportabili. Campi o varianti di schema
non classificati devono negare l'intera uscita, senza omissioni silenziose.

Il broker posseduto dalla GPUI deve comporre la proiezione dal servizio comune,
il runner GLiNER locale reale e il controllo del payload serializzato completo.
Runner assente o non qualificato, output invalido, residui identificanti e
contesto cambiato negano l'uscita senza ripieghi. Il corpus sintetico annotato
deve coprire CF da OCR, terzi, luoghi, nascita, filename e campi ignoti nella
nuova proiezione, con zero falsi negativi; un'evidenza legata
alla sola grammatica sintetica non qualifica prosa clinica diversa. La conferma
autenticata nella finestra nativa riguarda gli esatti byte finali. La chat
riceve soltanto pseudonimi; mappe e ricomposizione rimangono RAM dell'owner
locale. Token estranei, altra sessione, lock, refresh e riavvio negano l'uso.
Il frame app-only non aggiorna il contesto del modello. Questo raccordo non
amplia le uscite già ammesse al modello, non modifica writer o claim crittografici.

### Prima scheda clinica

Leonardo ha deciso il 31 ottobre 2026: la prima scheda comprende diagnosi e
passi delle note che il medico spunta a mano nella finestra nativa. Nessun
estrattore automatico, nessuna nota intera. La selezione delle diagnosi usa le
righe non vuote del campo comune; i passi sono sottostringhe esatte aggiunte dal
medico e poi spuntate. Un testo modificato, la nota intera o l'insieme dei passi
che copre tutta la nota sono negati. Il testo ostile resta dato, senza istruzioni
eseguite o interpretazione HTML.

Il comando app-only `clinical-profile` apre questa selezione nella GPUI.
`RuntimeSession.chat_clinical_profile` compone `open_patient_profile`, che usa
il servizio comune `readPatientProfile` sul canale paired, senza nuovi accessi
al database. Sessione, selezione ed epoch vengono rivalidati prima e dopo le
attese; la revisione del profilo è controllata anche prima e dopo il consumo.

Il profilo attivo è `mediflow.clinical-chat-profile.v1`: oggetto chiuso con
`profile`, `version: 1`, `pseudonym`, `diagnoses` e `noteExcerpts`. Le due liste
contengono solo `{ text, sourceRef }`. Limiti: 16 diagnosi, 8 passi, 2048 unità
UTF-16 per testo selezionato, 6000 complessive prima della redazione, 4096 per
voce redatta e 16384 byte UTF-8 per il JSON finale canonico. Il superamento
nega l'uscita, senza troncamenti. Le fonti sono casuali e opache, con testo
originale e revisione disponibili soltanto all'owner nativo in RAM.

Sono esclusi nome, codice fiscale, nascita, contatti, caregiver, esenzioni,
ADI e stato amministrativo. Nessuna data clinica esatta è ammessa implicitamente:
se presente in un passo scelto, passa dalla redazione comune C-B. Date rilevate
sono token di sessione, comprese quelle di valutazione e controllo. Il confine
nega residui nei formati numerici controllati; il consenso autenticato riguarda
soltanto i byte finali, senza eccezioni per la cronologia.

La GPUI avvia `chat-card-clinical-owner.mjs` sul canale privato posseduto.
`MEDIFLOW_CHAT_CLINICAL_INSTALLATION` indica il file locale di runner ed evidenze
per questo profilo; non sostituisce la qualifica sintetica in
`MEDIFLOW_CHAT_CARD_INSTALLATION`. Node e directory dell'owner restano quelli
configurati esplicitamente per il processo GPUI. Il
broker usa lo stesso runner GLiNER reale e gli stessi controlli di identità ed
evidenza di #726, ma richiede il digest del nuovo corpus clinico. Una qualifica
del solo corpus sintetico non basta. Oltre alla redazione dei testi, esamina il
payload serializzato completo, valida schema e ricomposizione di ogni voce e
nega entità residue. Il secondo esame non riscrive i byte revisionati.

La conferma nativa PIN o Touch ID autorizza una sola lettura entro 30 secondi.
Il frame valida il profilo distinto e mostra soltanto testo; non aggiorna il
contesto del modello. Refresh, altra sessione, token estranei, lock, revoca e
riavvio negano il riuso. Nessun ripiego quando runner, qualifica, schema o
contesto non sono validi. La grammatica sintetica resta intatta.

Terapie, prescrizioni protesiche e riassunto restano nella matrice C-8 per la
tranche successiva. La consultazione dei cataloghi già consegnata resta distinta
dalle prescrizioni. Questa decisione non ammette uso clinico o qualifica dei due
desktop, non amplia l'autorità del modello e non modifica claim crittografici.
