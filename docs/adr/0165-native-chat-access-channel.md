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
processi viene riletta con start time; entro 24 antenati un processo vivo deve
soddisfare il requisito Developer ID esatto dell'host. I requisiti osservati
sul target sono
`com.openai.codex` / team `2DC432GLL2` e
`com.anthropic.claudefordesktop` / team `Q6L2SF6YDW`.
La cattura viene confrontata di nuovo prima dell'uso; PID riutilizzati,
eseguibili sostituiti, app assente o riavviata negano l'accesso.
Anche l'hash del codice dell'antenato viene congelato nella cattura.

### Restrizione della catena, WUL-803, 4 novembre 2026

La sola presenza di un antenato firmato non distingue il lanciatore MCP da
un comando dell'agente. Prima di poter creare una richiesta nativa, ogni
processo fra adapter e host deve superare il requisito Developer ID dello
stesso team dell'host. Shell e interpreti (`sh`, `bash`, `zsh`, `fish`, `dash`,
`env`, `python`, `node`, `perl`, `ruby`, `osascript`, incluse varianti versionate)
sono negati anche se firmati da quel team. Non esiste una lista aggiuntiva di
helper ammessi: le fonti non documentano ancora la catena reale dei due desktop.
Firma assente, ad hoc, non valida o di altro team, host assente, catena incompleta
o oltre 24 antenati negano il canale prima di PIN, Touch ID e concessione.

La cattura conserva identità, genitore, start time, hash e nome dell'eseguibile
di ogni anello fino all'host. La rivalidazione confronta l'intera cattura. Il
riepilogo nativo mostra il padre diretto dell'adapter e la catena; il log locale
di attestazione registra gli stessi metadati tecnici e l'esito motivato.
Non registra argomenti, ambiente, percorsi completi, richieste o dati clinici.
Il diniego restituito sul socket è soltanto `withdrawn`; il motivo tecnico
rimane nel log locale, senza arrivare al modello.

Questa regola prudente può negare anche un lanciatore MCP legittimo che passi
per un interprete o per un helper di altro team. Si può rivedere dopo la prova
C-3a con Leonardo, registrando sul bundle candidato padre diretto e catena
reale in Claude Desktop e nell'app Codex. I test di decisione su catene
sintetiche non qualificano quelle catene né la consegna app-only di C-B/C-3b.
Un percorso interamente firmato dallo stesso team può ancora servire più
funzioni dell'host: la firma attesta l'origine del codice, non l'intento MCP.
La verifica desktop deve distinguere vista e comandi dell'agente; WUL-803
resta aperta fino a quella prova. I byte approvati presenti nell'adapter
possono entrare nel modello se l'host ne instrada lo stdout a uno strumento.
La restrizione non attesta il renderer, la destinazione finale dei byte o
la cancellazione dei dati già acquisiti. I claim su cifratura e zero-knowledge
rimangono invariati.

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

Aggiornamento del 10 novembre 2026 (C-9a): su macOS la dettatura può usare anche
whisper large-v3-turbo q5_0 con whisper.cpp e il rilevatore Silero, se il modello è
installato in modo esplicito e il suo SHA-256 coincide; altrimenti resta il motore
Apple. Il ponte Swift cattura l'audio e lo passa a Rust; stati, Review e trasferimento
restano quelli descritti sopra. L'installazione parte soltanto dal pulsante «Installa»
in Impostazioni, Voce locale; aprire la pagina non apre connessioni, e
`MEDIFLOW_NETWORK_DISABLED` la impedisce come per il catalogo AIFA (ADR 0125). Dettagli e misure:
[nota di progetto](../analysis/2026-11-10-gpui-voce-whisper-locale.md).

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
medico e poi spuntate. La nota intera o l'insieme dei passi
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
UTF-16 per testo selezionato, 6000 complessive nella selezione, 4096 per
voce e 16384 byte UTF-8 per il JSON finale canonico. Il superamento
nega l'uscita, senza troncamenti. Le fonti sono casuali e opache, con testo
originale e revisione disponibili soltanto all'owner nativo in RAM.

Sono esclusi nome, codice fiscale, nascita, contatti, caregiver, esenzioni,
ADI e stato amministrativo. La decisione di prodotto esclude le date complete,
comprese quelle cliniche: una riga che le contiene viene bloccata prima del consenso.
Non si riscrive mai il testo clinico: ogni riga esce esattamente come il medico
la vede nella finestra nativa oppure non esce. Non vengono creati token PII.
Il medico può togliere la spunta o modificare una copia locale nella stessa
finestra; la cartella resta invariata e la copia deve superare tutti i controlli.

La GPUI avvia `chat-card-clinical-owner.mjs` sul canale privato posseduto.
`MEDIFLOW_CHAT_CLINICAL_INSTALLATION` indica il file locale di runner ed evidenze
per questo profilo; non sostituisce la qualifica sintetica in
`MEDIFLOW_CHAT_CARD_INSTALLATION`. Node e directory dell'owner restano quelli
configurati esplicitamente per il processo GPUI. Il
broker usa lo stesso runner GLiNER reale e gli stessi controlli di identità ed
evidenza di #726, ma richiede il digest del nuovo corpus clinico. Una qualifica
del solo corpus sintetico non basta. Esamina ciascun testo e il
payload serializzato completo, valida schema e identità esatta di ogni voce e
nega entità non esentate dalla lista clinica chiusa. Il secondo esame non riscrive i byte revisionati.

La conferma nativa PIN o Touch ID autorizza una sola lettura entro 30 secondi.
Il frame valida il profilo distinto e mostra soltanto testo; non aggiorna il
contesto del modello. Refresh, altra sessione, token estranei, lock, revoca e
riavvio negano il riuso. Nessun ripiego quando runner, qualifica, schema o
contesto non sono validi. La grammatica sintetica resta intatta.

Terapie, prescrizioni protesiche e riassunto restano nella matrice C-8 per la
tranche successiva. La consultazione dei cataloghi già consegnata resta distinta
dalle prescrizioni. Questa decisione non ammette uso clinico o qualifica dei due
desktop, non amplia l'autorità del modello e non modifica claim crittografici.

### Controlli locali della proiezione clinica

Gli identificativi strutturati del profilo letto dalla sessione nativa alimentano
`knownIdentifiers` sul solo canale privato GPUI-Node: nome, cognome, CF, nascita,
indirizzo, telefono, caregiver, identificativi e date dei metadati disponibili.
Il broker riceve i valori nel campo storico `names` e le date in `birthDates`;
non sono campi del payload condiviso. Valori fuori limite negano la preparazione.

Il confronto degli identificativi noti precede ogni esenzione clinica. Usa NFKC,
case folding, rimozione di spazi, punteggiatura, accenti e invisibili, omoglifi
cirillici e greci ed equivalenze OCR cifra-lettera. Blocca prefissi di almeno
quattro caratteri dei nomi e sei di CF e altri ID, all'inizio di una parola.
I frammenti più corti dei metadati, come `01`, non partecipano. Un paziente di
cognome Diabete blocca anche «Diabete mellito»: l'omonimia non è una deroga.

Il controllo strutturale blocca lettere mescolate a cifre o simboli, lettere
singole spaziate o puntate, CF separati, OCR e pronunciati, contatti anche a voce,
date complete, tessera e matricola etichettate, quattro o più numeri in lettere
e parole composte per numeri di almeno tre cifre. Una lista chiusa ammette forme
cliniche come HbA1c, FEV1, CD4, T4, B12 e D3; numeri con unità cliniche ammesse
non vengono trattati come telefoni. La verifica si ripete sulle righe e sulla
loro concatenazione, anche per frammenti divisi tra righe. Nessuna trasformazione
è applicata ai byte clinici emessi.

GLiNER esamina i testi e il JSON finale. Soltanto uno span che coincide con un
termine clinico locale chiuso viene esentato. Il repo contiene ICD-11 MMS 2026-01
in inglese (`assets/reference-data/icd11`), non un dizionario italiano di diagnosi;
LOINC e UCUM locali sono riusati tramite `searchStaticTerminology`, con uguaglianza
esatta, e `clinical-terms.ts` aggiunge poche diagnosi italiane comuni e abbreviazioni.
Non vengono lette diagnosi del paziente per generare esenzioni. Un identificativo
noto non può essere esentato. L'identità qualificata e la sentinella sintetica
nome/nascita devono essere valide; rilevatore, identificativi o normalizzazione
degradati negano l'uscita. La sentinella non dimostra recall universale.

Il diniego indica sezione e riga nella finestra nativa, quando localizzabile.
Nessuna causa dettagliata o riga originale viene consegnata alla chat, il consenso
resta disabilitato. Le regressioni delle due review e i positivi clinici sono in
`clinical-chat-exact-corpus.json`, distinti dal corpus di qualifica neurale.

### Modello di minaccia e responsabilità

Il testo viene dalle note del medico, con possibili refusi ed errori OCR. Non è
un avversario. Il controllo è un aiuto e non è anonimizzazione. Un dato sconosciuto
offuscato di proposito può sfuggire, così come un riferimento indiretto nei fatti
clinici. La responsabilità di ciò che esce resta del medico, che vede i byte
esatti prima del consenso. Revocare non cancella dati già acquisiti dall'host.
Le prove sintetiche non attestano anonimato universale, qualifica dei desktop o
accettazione clinica. I claim su cifratura e zero-knowledge restano invariati.

### Limiti dichiarati del controllo

Il confronto con gli identificativi noti riconosce il valore intero, i prefissi,
gli errori di battitura e OCR che sostituiscono o scambiano lettere a parità di
lunghezza e iniziale, e i separatori dentro una parola. Non riconosce un nome
noto con più refusi di questi, né una variante con iniziale diversa: allargare
la tolleranza bloccherebbe parole ordinarie come «aria» o «fianchi». È una scelta
di bilanciamento, non una copertura completa. Il medico vede i byte esatti e ne
resta responsabile; il controllo è un aiuto e non è anonimizzazione.


## Quadro paziente dalla chat, 10 novembre 2026

Per la riga C-7 (emendamento del 9 novembre) il comando app-only
`patient-insight` riusa la richiesta nativa e non porta argomenti: la chat non
sceglie paziente, ambulatorio, fonti o modello. La GPUI lega la richiesta alla
sessione abbinata e alla selezione mostrata, il server la riammette con
`revalidate_chat_access_context` e solo dopo la GPUI apre il Quadro paziente in
Panoramica e legge l'interruttore della funzione. Consenso, generazione,
proposta, fonti, ricevuta e scarto restano nella vista G-5a; il provider lo
sceglie la configurazione della funzione sull'host.

Alla chat tornano soltanto `insight-opened`, `insight-unavailable` (funzione
spenta, kill switch o host locale chiuso), `insight-busy` (un Quadro è già in
preparazione, in generazione o mostrato e non viene sostituito),
`insight-closed` (la finestra ha concluso il Quadro aperto dalla chat) o
`withdrawn`. Fino a `insight-closed` la carta lascia attivo «Revoca»; il ritiro
si controlla anche fra consenso e invio, così nessun dato parte dopo una revoca.
Revoca, EOF, blocco della sessione, cambio di selezione o di scheda durante la
preparazione o la generazione interrompono il Quadro legato alla chat; una
risposta già in volo non compare. Una proposta mostrata appartiene alla
finestra e non si lega più alla chat. Il frame rifiuta ogni risposta con campi
oltre allo stato. Le prove sono di componente con host sintetici; i due host
desktop, i provider reali e il budget end-to-end restano alla seconda seduta.
La [nota C-7](../analysis/2026-10-31-chat-catalog-fabric/raccordi-c7-funzioni-generative.md)
descrive anche i raccordi previsti per sintesi dei documenti e import assistito.


## Sintesi dei documenti dalla chat, 10 novembre 2026

Il comando app-only `document-synthesis` porta soltanto il nome del comando.
Sessione e selezione sono quelle della finestra. L'ammissione sul server e
il controllo dell'interruttore precedono `synthesis-opened`, che comprende
la scelta del documento ed il consenso nella sezione Documenti. La scelta
non può partire durante l'ammissione. Senza documenti la richiesta resta
aperta e Revoca resta disponibile. Un'altra richiesta della stessa funzione
restituisce `synthesis-busy` anche durante la scelta.

Consenso, generazione, fonti, ricevuta e scarto riusano la sintesi GPUI,
senza scritture. La chat riceve soltanto `status`: `requested`, `preparing`,
`synthesis-opened`, `synthesis-unavailable`, `synthesis-busy`,
`synthesis-closed` oppure `withdrawn`. Nessun documento o risultato passa
al modello della chat.

Quadro e sintesi condividono i controlli di ritiro in `GenerationArea`,
con un legame distinto per funzione. `start` impedisce l'invio dopo il
ritiro e cancella contesto e payload rifiutati. `take_running` impedisce
la comparsa di una risposta ritirata. `follow_chat` lascia la scelta del
documento aperta e rilascia la proprietà a proposta o termine della richiesta.
La proposta dopo `synthesis-closed` appartiene alla finestra: revoca o EOF
della chat non la tolgono, mentre il cambiamento del documento la rende
superata secondo la validità nativa. Le stringhe `insight-*` non cambiano.

Questo raccordo tecnico precisa gli stati già previsti da C-7. La qualifica
dei due desktop, dei provider reali e dei tempi end-to-end resta separata.


## Import assistito dalla chat, 10 novembre 2026

Il comando app-only `smart-import` porta soltanto il nome del comando. La
chat non indica note, voci di diario, documenti o candidati: le fonti sono
quelle della scheda selezionata nella finestra. L'ammissione sul server e il
controllo dell'interruttore dell'importazione assistita precedono
`import-opened`, che apre la sezione Documenti. Lì il medico prepara la
richiesta, vede che cosa parte e dà il consenso. Preparazione e invio non
partono durante l'ammissione. Senza note, voci di diario o sintesi di
documenti la richiesta resta aperta con uno stato vuoto che dice che cosa
manca, e Revoca resta disponibile. Un'altra richiesta della stessa funzione
restituisce `import-busy`.

L'import assistito in GPUI è sola anteprima (#901): candidati con la loro
fonte e ricevuta, nessun comando di applicazione e nessuna scrittura nella
scheda. La chat riceve soltanto `status`: `requested`, `preparing`,
`import-opened`, `import-unavailable`, `import-busy`, `import-closed` oppure
`withdrawn`. Nessuna fonte, proposta o ricevuta passa al modello della chat.

Il raccordo riusa i controlli comuni di `GenerationArea` (`start`,
`take_running`, `follow_chat`) e l'apertura comune del canale, con un legame
proprio. Una nuova apertura ammessa seleziona una sola funzione visibile e ritira la richiesta precedente ancora aperta; le proposte concluse restano nello stato nativo.
Dopo `import-closed` la proposta appartiene alla finestra e la sua validità
segue solo le fonti della scheda. Le stringhe `insight-*` e `synthesis-*`
non cambiano. L'applicazione dei candidati resta legata al contratto G-6j.

## Ricerca ICD dalla chat, 12 novembre 2026

Il comando app-only `icd-lookup` non accetta argomenti. La sessione, l’account,
l’archivio e la selezione del paziente sono ammessi con il percorso comune
prima di aprire la ricerca ICD-11 WHO dentro la Panoramica della scheda.
Il lettore paired `RuntimeSession.search_who` conserva i propri controlli.
Non serve l’accesso amministrativo all’host locale, che la normale consultazione
WHO non richiede. L’apertura non invia query, non genera testo e non applica
codici alla scheda. Il medico scrive la query nella finestra.

La carta Web riceve soltanto `status`: `requested`, `preparing`, `icd-opened`,
`icd-unavailable`, `icd-busy`, `icd-closed` oppure `withdrawn`. Query, risultati
e ricevuta WHO restano nella finestra. `icd-closed` segue una lettura riuscita,
compreso un elenco vuoto, e rilascia il legame con la chat. Non rappresenta
una scrittura clinica né una ricevuta durevole da recuperare dopo un riavvio.
Una lettura negata o fallita non produce lo stato di consultazione conclusa.

Cambio di paziente, blocco, revoca, chiusura e perdita del contesto ritirano
la richiesta. La risposta viene ricontrollata prima di mostrarla. Lasciare
la Panoramica chiude la ricerca. Dopo la lettura riuscita i risultati restano
nella scheda fino alla chiusura o al cambio di contesto. Non viene concessa
alcuna autorità di scrittura alla chat.

Abbinamento delle prestazioni, coda delle evidenze e follow-up aperti restano
non collegati: i residui del [catalogo C-7](../analysis/2026-10-31-chat-catalog-fabric/README.md#wul-829-ricerca-icd-aperta-dalla-chat)
indicano quali lettori e viste GPUI mancano. I banchi sintetici non qualificano
i desktop Claude e Codex reali.

## Una funzione visibile alla volta dalla chat, 12 novembre 2026

Le aperture di ICD, Quadro paziente, sintesi e import scelgono esplicitamente
l’area da mostrare nella scheda. La selezione della funzione governa il render:
un pannello ICD, anche dopo una ricerca conclusa, non può coprire il consenso
del Quadro. L’apertura della sintesi mostra la scelta del documento e la sua
sintesi; l’import mostra la propria preparazione. La navigazione ordinaria
ai Documenti conserva la vista completa.

Una nuova apertura ammessa chiude il pannello precedente e ritira la sua
richiesta ancora aperta. Le richieste generative in preparazione, al consenso
o in corso vengono interrotte e i loro testi temporanei cancellati. La ricerca
ICD perde i risultati e invalida le risposte tardive. Una proposta già
conclusa resta nello stato nativo e segue i suoi controlli di validità.
Se la funzione richiesta è già occupata, `busy` rimostra il suo lavoro
esistente senza sostituirlo, leggere nuovi dati o avviare una generazione.
Se l’ammissione è ancora in corso, la richiesta duplicata lascia la vista
precedente visibile.
La richiesta negata durante l’ammissione conserva la vista precedente.

Il collegamento non cambia la selezione del paziente, l’epoca, i permessi o
l’autorità di scrittura. La matrice dei test attraversa il render della
finestra per tutte le coppie funzione precedente e funzione richiesta,
compreso ICD dopo la lettura conclusa.
