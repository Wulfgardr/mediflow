---
summary: "Current platform inventory and historical Apple parity contract, with source availability and exact-revision interaction evidence kept separate."
read_when:
  - "Planning or reviewing macOS, iPhone, or iPad parity work."
  - "Checking feature parity separately from interaction and assistive-technology evidence."
---

# Matrice di parità Web, Apple e Headless

Stato documento: `CANONICAL`
Ultimo aggiornamento: 2026-10-16 (inventario corrente WUL-694; baseline e prove storiche separate)

## Riconciliazione corrente — WUL-694, 16 ottobre 2026

L'inventario comprende l'accesso v3 integrato in `main` a
`4c69e4daa7163605765f8f7112d76dcf8e34cc02` e il successivo contributo ChatGPT
integrato a `9e2912e6df3c84d963726cd5ac8e2207fb98dff8`. Il codice integrato,
quello nelle PR e le prove sui candidati sono distinti. Le righe seguenti
riportano anche le successive integrazioni Apple. I conteggi e gli esiti 0.8 nelle
sezioni successive sono storia: non misurano il completamento del prodotto
corrente e non impongono nuovi blocchi oltre il contratto vigente. La parità
totale non è attestata.

WUL-694 richiede macOS, Windows 11, Ubuntu, iPhone e iPad per la 1.0. Le prove
recenti usano Mac, Windows 11 ARM e Omarchy/Arch ARM in Parallels e simulatori
Apple. Omarchy non prova Ubuntu 24.04 x86_64; Windows ARM con Node x64 emulato
non prova Windows 11 x64; un simulatore non prova un dispositivo fisico.

### Codice integrato e contributi in revisione

| Contributo | Stato e revisione | Limite della prova |
| --- | --- | --- |
| Accesso v3 nei client Apple abbinati | [PR #539](https://github.com/Wulfgardr/mediflow/pull/539) integrata in `main` a `4c69e4daa` | La prova UI Mac sul precedente candidato `65da737353e8b02d84e476299e5c4088d38aedab` ha completato accesso v3 e creazione di un paziente inventato, con indirizzo decifrato. Il client iPhone in simulatore ha poi eseguito accesso v3 e letto la stessa cartella e lo stesso indirizzo. Non copre tutte le interazioni native. |
| Importazione pazienti da CSV | [PR #542](https://github.com/Wulfgardr/mediflow/pull/542) integrata in `main` a `3980cb68de550366332f59fb29dfad51d79e8654` | Anteprima, conferma ed esiti per riga presenti; 129 test Swift e tre prove HTTP reali su archivio sintetico riusciti. Selettore CSV sul candidato integrato ancora da verificare. |
| Documenti multipli e quattro viste AI su iPhone/iPad | [PR #541](https://github.com/Wulfgardr/mediflow/pull/541) integrata in `main` a `65898d6a6ed1296a89850e19ce123791d37bb026` | Invii sequenziali con esiti per file e interruzione sulle risposte incerte. 113 test Node e 57 Swift riusciti; correzione dei tre hash CI inclusa nel contributo integrato. L'esistenza delle viste non prova una generazione o l'uso su dispositivi fisici. |
| Nuovi allegati dal compositore del diario | [PR #543](https://github.com/Wulfgardr/mediflow/pull/543) aperta: delta `44cb68a5cc2f9f66bd170cd5be6f313990aa9d97`, head `c3d8f117e812f0fdea507daf76a93e060a636a57`; base ancora il branch di #541, da aggiornare a `main` | Caricamento multiplo, conservazione della bozza e salvataggio esplicito presenti; 21 test mirati riusciti. Prova UI sul candidato integrato ancora in corso. |
| Rientri e strutture annidate nell'editor | [PR #544](https://github.com/Wulfgardr/mediflow/pull/544) integrata in `main` a `f9f9626763038c48e2da5c5cc439d925b1634c1d` | 55 test Swift, sette test Web e build Mac/iOS riusciti. Corretti i casi di raggruppamento e numerazione segnalati dalla review indipendente; review finale senza rilievi. Interazione e rilettura dall'host ancora da provare. |

Il candidato locale `cb3f66deac58b97ace6981f40cf50d2a6de64ca9` riunisce
accesso, CSV, documenti multipli e allegati del diario: build Mac completa, build iOS Simulator e verifica rigorosa
della firma riuscite. Il successivo candidato
`74266b111ef6709ab0ac8d510f5c7a94fdcf2ccf` ha superato build, firma e
controllo della revisione del server. L'interazione sul nuovo candidato
resta da verificare. Questi esiti non attestano distribuzione,
notarizzazione, tutte le interazioni o hardware mobile fisico.

Nella prova Mac precedente mancavano tre permessi di lettura nella fixture.
Il ripristino canonico dei permessi della fixture ha consentito di proseguire:
non è stato osservato un difetto dell'app da attribuire a quel rifiuto.

### Inventario funzionale e prove ancora necessarie

`Da provare` indica un percorso senza prova d'uso corrente registrata qui;
`ambiente assente` conserva un target richiesto e non ancora verificato.
Una funzione riservata all'host resta tale per contratto. Le prove valgono
per la revisione e la superficie indicate, senza trasferirsi ad altri candidati.

| Funzione | Web macOS | Web Windows 11 ARM | Web Ubuntu | Nativo macOS | iPhone / iPad |
| --- | --- | --- | --- | --- | --- |
| Accesso e account v3 | Accesso disponibile; lifecycle completo da provare sul candidato | Tre prove di accesso riuscite sulla base `a5420afa3`; lifecycle completato in 50,6 secondi con limite di 120 | Ambiente assente | Integrato con #539; accesso v3 UI riuscito sul candidato `65da73735` | Integrato con #539; accesso e lettura della stessa cartella riusciti nel simulatore iPhone sul candidato `65da73735`; hardware fisico da provare |
| Cartella senza AI e importazione CSV | CRUD presenti; percorsi completi e recupero da provare | Sei prove dell'harness ufficiale riuscite, con errore a freddo ancora da qualificare | Ambiente assente | Creazione e indirizzo decifrato verificati sul candidato `65da73735`; CSV integrato con #542, ancora da provare nella UI integrata | Lettura paired della cartella e dell'indirizzo riuscita in simulatore iPhone; CSV integrato con #542; touch, tastiera iPad e rilettura dopo riavvio da provare |
| Diario ed editor | Composizione, allegati e recupero bozza da provare | Interazione nel guest da provare | Ambiente assente | Upload dal compositore in #543; rientro, elenchi annidati e citazioni multiblocco integrati con #544; interazione da provare | Contributi #543 e #544 presenti; editor e round-trip da provare; scritture offline escluse dal contratto |
| Documenti e OCR | Caricamento, estrazione locale e revisione da provare; Apple Vision sul Mac | OCR Tesseract e dipendenze guest da provare | Ambiente assente; Omarchy resta distinto | Upload multiplo integrato con #541; OCR e revisione derivata sull'host | Upload multiplo integrato con #541; motore OCR sull'host, non sul dispositivo |
| Repertori WHO, AIFA, esenzioni, protesica | Importazione, ricerca e aggiornamento da provare | Servizi e cataloghi locali al guest da provare | Ambiente assente | Lookup e flussi manuali presenti; amministrazione sull'host | Lookup paired e inserimento manuale; amministrazione sull'host |
| Quattro esperienze AI / ChatGPT | Tre funzioni locali Ollama con almeno una preview HTTP riuscita sul candidato `c3ee6f5f1`; limiti Patient Insight descritti sotto. ChatGPT: accesso/catalogo riusciti, generazione bloccata dalla quota | Esecuzione locale ChatGPT non qualificata | Target ed esecuzione locale ChatGPT non qualificati | Quattro viste presenti; generazioni e revisione finale ancora da verificare | Quattro viste integrate con #541; esecuzione sull'host Mac, generazioni da mobile non provate |
| Conflitti, lock, backup e recupero | Conflitto, riavvio e ripristino completo sintetico da provare | Lifecycle riuscito; avvio completo del Supervisor Headless ancora in analisi | Ambiente assente | Writer HTTP e lock presenti; recupero completo amministrato sull'host | Writer HTTP e cache cifrata read-only presenti; niente coda write offline; backup e recupero sull'host |

Il contributo editor #544 aggiunge aumento e riduzione del rientro, elenchi
annidati e citazioni multiblocco. Restano da verificarne uso nell'app e
rilettura, senza dedurre una generica assenza di «azioni in blocco».
H1 è un contenuto legacy
conservato in sola lettura; non è un comando disponibile nell'editor Web.
La scheda AI non conferisce accesso a un account né autorizza un invio.
ATHENA/MLX resta limitata ai target supportati; il percorso manuale deve
restare utilizzabile senza modello.

Fonti: [accesso nativo](../lib/security/native-login-http.ts),
[verifica credenziali](../lib/security/host-credential-verification.ts),
[workspace Apple](../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift),
[documenti Apple](../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDocumentsSection.swift),
[viste AI](../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/NativeOrdinaryViews.swift),
[editor](../native/MediFlowMac/Sources/MediFlowCore/ClinicalRichTextEditor.swift)
e [roster delle scritture](./clinical-write-roster.md). I nuovi comportamenti
non ancora integrati sono descritti nelle PR sopra, non attribuiti alla base.

### Prove guest e loro limiti

| Ambiente e revisione | Risultato osservato | Ancora aperto |
| --- | --- | --- |
| Omarchy/Arch ARM, Node 24.21.0, base `a5420afa3e3eed7cf598a51e3d3dc52e3d132a6e` | Sei prove dell'harness ufficiale e tre prove di accesso riuscite; Supervisor Headless con cinque operazioni riuscito | Non è Ubuntu; non copre l'interazione completa, i nuovi contributi Apple o la generazione ChatGPT |
| Windows 11 ARM con Node 24.21.0 Windows x64, stessa base `a5420afa3` | Build e sei prove ufficiali riuscite dopo una migrazione eseguita dal codice sorgente; tre prove di accesso riuscite, incluso lifecycle in 50,6 secondi con limite di 120 | Primo `DB_QUERY_FAILED` a freddo e risposta HTTP 503 ancora senza causa stabilita; trasporto di prova intermittente. Supervisor Headless completo non verificato, attesa e cleanup ancora in analisi |

Le prove guest non attestano un installer nativo, Windows x64 o Ubuntu.
Su una nuova fixture Windows, il primo avvio canonico ha completato la
readiness di autenticazione in 8,197 secondi e la migrazione dello schema da
0 a 4, conservando integrità e account, senza una migrazione intermedia dal
codice sorgente. Questa prova non ha riprodotto il primo `DB_QUERY_FAILED`
e non ne spiega la causa. L'errore iniziale resta registrato insieme ai
successi successivi. La precedente attesa Headless di 15 secondi non aveva
raggiunto la readiness: il Supervisor completo non è ancora un PASS. La
risposta HTTP 503 e l'intermittenza del trasporto restano osservazioni aperte;
non è dimostrato che abbiano la stessa causa né che il solo trasporto spieghi
il rifiuto applicativo.

### Tre funzioni Ollama: prove reali e limiti

Sul candidato sorgente `c3ee6f5f10e83664994e98c02ec25b532df84670`, con
Ollama 0.40.5 e il modello locale già installato `qwen3.5:35b-a3b`, sono
state eseguite preview HTTP canoniche su un nuovo archivio cifrato con dati
interamente inventati. L'ammissione della versione è un contributo separato,
con seguito documentale `f66b7e353e54e73ffc30e01f08c0a38b947a6817`;
non viene attribuita alle revisioni precedenti o a una distribuzione installata.

| Funzione | Esito reale | Limite |
| --- | --- | --- |
| Patient Insight | Secondo tentativo HTTP riuscito in circa 8,9 secondi | Il primo è stato rifiutato con `proposal_invalid`. Un replay dello stesso prompt ha prodotto una nuova risposta valida, ma non ha riprodotto né spiegato il primo errore. Non è dichiarato risolto. |
| Smart Import | Proposta valida in circa 15,8 secondi, con una diagnosi e una terapia inventate | Fonte riletta dalla fixture e decifrata dal client; nessuna applicazione della proposta. |
| Document Synthesis | Proposta valida in circa 31,2 secondi | Percorso completo di caricamento cifrato, capture, AnyDoc su PDF testo e preview; non prova scansioni, OCR o interazione UI. |

Le tre proposte hanno superato i parser previsti e conservano zero scritture
cliniche. Il paziente riletto è invariato e i campi derivati dell'allegato
restano vuoti. Modello esplicito, nessun download o ripiego, nessun uso di
ChatGPT in queste prove. I tempi includono preparazione e trasporto; il digest
osservato resta `observed_not_causal`, con stato `available_unqualified`.
Queste prove non attestano qualità o ammissione clinica.

L'attivazione Web a freddo si è fermata al limite host di 30 secondi con
`verification_interrupted` (circa 31,2 secondi nella finestra del client).
Dopo un precaricamento tecnico esplicito, la nuova attivazione a caldo è
riuscita in circa 2,6 secondi. Il precaricamento manuale non dimostra un
percorso utente a freddo riuscito. La pagina consente di rileggere lo stato
e confermare un nuovo tentativo; non esegue retry automatici.

### ChatGPT come provider e plugin MediFlow

La [PR #540](https://github.com/Wulfgardr/mediflow/pull/540), integrata in
`main` a `9e2912e6df3c84d963726cd5ac8e2207fb98dff8`, contiene la correzione
dell'account e la verifica sul sistema corrente. Sul suo processo Mac isolato sono
riusciti accesso ufficiale, catalogo reale e
annullamento del tentativo di login con chiusura e pulizia. Un tentativo reale
Patient Insight con dati interamente inventati si è fermato per quota esaurita,
senza proposta; le quattro generazioni restano non verificate. Nessun ripiego
è stato eseguito. L'annullamento del login non prova l'interruzione di una
generazione già iniziata. Le [limitazioni note](./known-limitations.md#chatgpt-e-plugin-stato-delle-prove)
e la [nota WUL-778](./adr/0134-chatgpt-subscription-synthesis-execution.md#riqualifica-del-substrato-e-piano-prolite--wul-778)
descrivono le prove; non attestano ammissione clinica o UI completa.

Il plugin `mediflow-synthetic` è distinto dall'uso di ChatGPT come provider.
Due tool chiamati da Codex reale con argomenti `{}` hanno restituito i due
esempi fissi inventati previsti. Il plugin non legge cartelle cliniche e non
modifica l'archivio. Questa prova non attesta riconoscimento automatico,
interfaccia nativa dell'host o funzionamento in ChatGPT classico. Vedi la
[prova del prototipo](../plugins/mediflow-synthetic/README.md#prova-opzionale-dellagente-codex-reale).

### Headless, MCP e Mini correnti

Il [catalogo MCP](../packages/mcp/src/contracts.ts) contiene cinque operazioni:
terminologia, Open Loops, proposta follow-up, query semantica e anteprima
transizione checkup. Le letture e la query sono read-only; follow-up e checkup
sono proposal-only. Il commit checkup richiede il Web trusted con revisione,
gesto, step-up e protezioni del dominio: non è un comando agente.

Mini espone `status`, `capabilities`, `terminology search`, `open-loops`,
`follow-up-proposal`, `semantic-query` e `checkup-status-preview`, riusando gli
schemi e l'OperationClient MCP. Esempio nel trasporto Mini già avviato e
autorizzato dal Supervisor:

```json
{"command":"checkup-status-preview","args":{"checkupRef":"hcsr_1111111111111111111111111111111111111111111111111111111111111111","targetStatus":"completed","expectedRevision":1}}
```

Il riferimento è opaco e proviene dal contesto host corrente; l'esempio non
individua un checkup reale. Non sono ammessi patientId, proof, confirmation o
commit aggiunti dal chiamante. L'anteprima non garantisce che la successiva
conferma Web sia ancora valida. Il protocollo corrente è
[packages/mini/src/protocol.ts](../packages/mini/src/protocol.ts). Il vecchio
manifest `packages/mini/contracts/mini-parity.json`, citato nella storia, non
è presente sulla base corrente: il conteggio 4/66 non misura questi comandi.

Le prove automatiche Mini del 16 ottobre 2026 su Mac con Node 24.21.0 hanno
registrato `test:mini-cli` 21/21, `test:mcp:intelligent-host` 33/33,
`test:headless-portable` 277/277 e `check:headless-portable-imports` riuscito.
Il commit verificato è `f607d57b2baaac14f27c12a5c4b0f8f4cdb6b34f`. I processi
Node distinti usano IPC reale e servizi sintetici: queste prove non attestano
un checkup clinico reale, una sessione UI o un'installazione guest. La prova
Supervisor sul guest Omarchy, indicata sopra, resta un'evidenza separata.

### Prove da completare

Le prossime ricevute devono indicare SHA completa, revisione runtime letta da
`/api/system/revision`, OS e architettura, Node, artefatto e archivio sintetico.
Build, prova HTTP, interazione UI e tecnologia assistiva sono risultati diversi.
Restano da completare:

- UI del candidato Apple integrato: CSV, caricamenti multipli, diario, editor,
  cambio paziente, revoca del contesto e conservazione degli esiti parziali;
- cause del primo errore Windows e del 503, trasporto intermittente e prova
  completa del Supervisor Headless;
- percorsi su Ubuntu e interazioni sui dispositivi iPhone/iPad fisici;
- causa del primo rifiuto Patient Insight e attivazione Ollama a freddo;
- generazioni ChatGPT, revisione e annullamento durante una generazione,
  quando il provider e la quota lo consentono;
- conflitti, errore parziale, riavvio, ripristino sintetico completo e limiti
  della cache mobile, senza introdurre scritture offline.

Le prove VoiceOver e i gate 0.8 riportati sotto valgono per le rispettive
revisioni storiche; non sono prove delle nuove UI né nuovi divieti generici.

## Gate MediFlow 0.8

Per leggere la matrice occorre separare il contratto funzionale dalle prove
eseguite sulle singole revisioni. Il pacchetto parity parte dalla base congelata
`2355a46a4dde63b1956a2298d99ef0b5c4208222`, tree
`c46d739b026e509a3e1fae2348372a420c9a17aa`; il commit finale della candidata
viene registrato nel run record dopo la verifica successiva al commit.

Il contratto funzionale rimane `PARTIAL`: 13 funzionalità sono parziali e 23
sono intenzionalmente riservate all'host. Questo stato non blocca da solo una
candidata sorgente, ma nemmeno sostituisce le verifiche dell'interazione o le
ricevute di chiusura sulla SHA esatta. La distribuzione sorgente 0.8.6 e il
seguito nativo restano quindi distinti; pubblicare i sorgenti non promuove
questa matrice a parità completa.

La promozione rimane `HOLD_PROMOTION`, perché prove automatiche e interazioni
reali valgono per la baseline su cui sono state eseguite. Sul
runtime `29b2c94b6a044b1639137403a2228ff172ea3d0f`, tree
`5706ade800d6a8caf2ab875882f61fe0881b3dd5`, la sessione web con VoiceOver è
terminale `PASS_BOUNDED`: Chrome production era in primo piano, VoiceOver era
attivo e le azioni sono state esercitate con input tastiera macOS nativo su dati
sintetici. Il successore che registra questa evidenza è docs-only e non modifica
il runtime verificato. Il receipt Xcode exact-SHA resta un gate separato.
VoiceOver reale su iPhone e iPad non è provato perché l'API pubblica della beta
Xcode 27 non raggiunge uno stato terminale nel simulatore: questa è una deroga
esterna accettata, non un PASS, e non autorizza claim App Store o di conformità.

La parità serve a riconoscere e completare le stesse operazioni, non a
riprodurre la stessa interfaccia. Lume fornisce il linguaggio comune; Liquid
Glass è una declinazione nativa Apple, non un'identità da copiare in CSS.
Capacità, significato, gerarchia, stati, sicurezza e riconoscibilità devono
restare coerenti, mentre navigazione, densità, controlli e modalità di input
seguono la piattaforma. Una differenza documentata non è quindi una mancanza;
lo è una funzione necessaria ma assente dal perimetro dichiarato.

## Perimetro

Questa matrice confronta:

- **localhost**: la web app locale sul Mac, superficie clinica di riferimento;
- **macOS**: il bundle Apple/home-base con shell clinica condivisa;
- **iPhone/iPad**: client paired sul boundary `/api/v1/network/*`.

Il contratto leggibile dagli strumenti è
[docs/apple-parity-matrix.json](./apple-parity-matrix.json). Il manifest
[docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json) ha un compito
diverso: verifica 24 record tecnici di accettazione e i contratti di rete.
Per questo lo stato QA `covered` non dimostra automaticamente una parità
funzionale completa.

Riferimenti architetturali:

- [ADR 0005](./adr/0005-web-native-functional-parity.md)
- [ADR 0008](./adr/0008-web-first-with-parity-sweeps.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0076](./adr/0076-paired-document-domain-write-policy.md)

## Due assi distinti

Una funzione può essere presente senza che il suo percorso d'uso sia stato
verificato. La disponibilità funzionale (feature parity) e la possibilità di
completare l'interazione (interaction parity) sono perciò due assi indipendenti.

| Asse | Domanda | Limite |
| --- | --- | --- |
| Feature parity | La capability è disponibile nel perimetro dichiarato? | Non prova l'uso reale dei controlli. |
| Interaction parity | Un operatore completa il workflow con gli input della piattaforma? | Non prova una tecnologia assistiva non esercitata. |

Gli stati di prova sono:

- `verified-automatic`: test o audit terminale sul candidato;
- `verified-real-interaction`: interazione reale su bundle o browser di produzione;
- `partial`: funzione o prova ancora incompleta;
- `blocked`: prova richiesta non eseguibile nel contesto corrente;
- `platform-specific-documented`: adattamento intenzionale e documentato;
- `out-of-scope`: capability esclusa dal perimetro dichiarato.

Anche una prova VoiceOver vale soltanto per la superficie effettivamente
esercitata: in Chrome di produzione riguarda la web app, non l'app nativa
macOS; dentro l'app macOS riguarda soltanto quest'ultima. Né queste sessioni
né gli audit XCTest dimostrano un uso reale di VoiceOver su iPhone o iPad.

## Fotografia storica 0.8 — non misura il candidato corrente

| Classe | Righe | Significato |
| --- | ---: | --- |
| `full-parity` | 30 | Il workflow equivalente è disponibile sulle superfici target previste. |
| `partial` | 13 | Esiste una superficie utile, ma manca equivalenza di funzione, campo, flessibilità o verifica manuale. |
| `missing-both` | 0 | Nessuna capability resta priva sia di boundary sia di UI senza una decisione esplicita. |
| `host-only` | 23 | La funzione resta sul Mac/localhost per autorità, filesystem, runtime AI o policy. |
| **Totale** | **66** | Capability censite. |

Escludendo le 23 righe intenzionalmente host-only, 30 capability su 43 sono
`full-parity` (**70%**); 13 su 43 restano parziali (**30%**). Sul totale
grezzo, le righe full sono 30/66 (**45%**).

Il rapporto 30/13/23 descrive il contratto funzionale censito, non il numero
delle prove valide sulla revisione corrente. Non permette quindi di dichiarare
“parity completa”.

La chiave `reconciliation` del JSON collega il contratto alle prove 0.8.
Il manifest Apple-wide verifica 24 acceptance record tecnici separati.

## Evidenza registrata

Le prove Apple con Xcode riportate sotto appartengono alla baseline storica
`0843726fe`: non si trasferiscono a un tree successivo. La disponibilità di
Xcode deve essere verificata sulla macchina e gli esiti sulla SHA esatta devono
risultare dalle ricevute di chiusura. La riconciliazione dei sorgenti integrati
indica ciò che è presente nel codice, tenendolo distinto da prove SPM, UI e
interoperabilità; non aggiorna per implicazione punteggi, celle UI o stato
della release.

| Classe | Superficie | Prova | Stato |
| --- | --- | --- | --- |
| `verified-automatic` | Web | Evidence Stack 2/2 con PIN sintetico `0000`; build 104 pagine e standalone | PASS |
| `verified-real-interaction` | Web | Chromium produzione a 320/390/768/1440 e zoom esatto 200%/400%; focus visibile e nessun overflow orizzontale | PASS |
| `verified-real-interaction` | Web / VoiceOver | Chrome production in primo piano, VoiceOver attivo e tastiera macOS nativa; `Vai ai pazienti`, `Rivedi agenda`, `Apri revisione`, comando `Diario` e ricerca paziente hanno raggiunto il target di focus dichiarato | `PASS_BOUNDED` sul runtime `29b2c94b6a04`, tree `5706ade800d6`; dati sintetici, non audit applicativo completo |
| `verified-automatic` | iPhone | XCUITest 2/2, tab identifier atomici e apertura delle sei superfici | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-automatic` | iPad | XCUITest 7/7, list-detail, AX5, rotazione, geometria e audit AX | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-real-interaction` | macOS | Build Xcode 27, click-map, focus, Cmd-R contestuale, resize e VoiceOver manuale | PASS storico su `0843726fe` |
| `verified-automatic` | macOS probe | `typecheck` e 6/6 test del probe AX corretto e process-safe | PASS storico su `0843726fe` |
| `accepted-external-limitation` | iPhone/iPad | VoiceOver reale | Non provato; Xcode 27 beta, issue Apple `173507341` |

## Stato per area

| Area | Stato | Cosa è già disponibile | Residuo reale |
| --- | --- | --- | --- |
| Pazienti | `PARTIAL` | lista, ricerca, dettaglio, create/update, DOB con patch `omit/value/null` in UTC, archivio con motivo/nota, cestino e ripristino | prove UI ordinarie e round-trip app/home-base ancora pending; assign/unassign/move/duplicate sono esplicitamente fuori dall'obbligo W2 |
| Diario | `PARTIAL` | CRUD versionato, restore, filtri, S/O/A/P, rich text inline, allegati per-record e bozza visita deterministica | indent/outdent e strutture complesse; prove UI/interop dell'editor |
| Terapie | `PARTIAL` | CRUD, soft-delete, stato, AIC/ATC/principio attivo, autocomplete AIFA, fallback manuale e collegamento diagnosi | prove finali del form e del round-trip |
| Checkup | `PARTIAL` | CRUD, soft-delete, status/source, conflitti versione e prefill follow-up manuale deduplicato | equivalenza campi e flussi |
| Osservazioni | `PARTIAL` | CRUD, soft-delete, LOINC/UCUM, trend e sparkline | equivalenza visuale e flessibilità |
| Cataloghi AIFA/esenzioni | `FULL` per lookup | ricerca network di farmaci ed esenzioni dal boundary paired | import, refresh e stato/freschezza del repertorio restano host-only |
| Prestazioni e protesica | `FULL` nel perimetro paired | read/write versionati e UI nativa | nessun invio regionale o generazione NRE |
| Export FHIR/FSE pre-check | `FULL` nel perimetro locale | bundle on-device e validazione boundary | nessun writeback FSE |
| SISS / PRREG | `HOST-ONLY` per integrazione, utilità PRREG parziale | web con pannello/diario; Apple copia il CF e apre la dashboard PRREG dal paziente | FSE, stato sessione, diario handoff e canale regionale restano sul Mac o fuori scope |
| Viste globali | `MIXED` | agenda, diario globale, analytics e interazione macOS reale; router/deep-link source-present per la sessione ordinaria | apertura OS, focus, resize, VoiceOver e app-freeze proof della slice restano pending; cockpit sintetico partial |
| Documenti | `PARTIAL` e policy-limited | upload cifrato, picker nativo singolo, archivio read, insight read, follow-up, allegati e stati web verificati | multi-file è differenza operativa; OCR, sintesi, curation e delete insight restano host per ADR 0076; UI/interop nativa pending |
| Offline mobile | `PARTIAL` | lista e ultimo profilo in cache cifrata, TTL massimo 24h e renderer read-only source-present nel candidato WUL-676 | workflow offline ordinario e verifica UI/device del renderer integrato (`WUL-403`) |
| AI generativa, Fabric e governance | `HOST-ONLY` | stato runtime/kill switch leggibile; registro Fabric read-only (16 capability, 4 venue, profili egress) e parliament/readiness del nodo host | ADR 0076 esclude l'invocazione AI paired; il registro e la governance descrivono il calcolo della macchina host, quindi non sono gap del client Apple |
| Backup, diagnostica, repertori, update | `HOST-ONLY` | gestiti dal nodo Mac autorevole | non sono gap di parity client |

## Wave completate

1. **Wave 1 — core mobile**: diario, rich text, scale, terapie, report e cockpit.
2. **Wave 2 — boundary paired**: lifecycle paziente, cataloghi, prestazioni,
   protesica, FHIR, terminologie, discovery e revision guard.
3. **Wave 3 — viste globali**: agenda, diario globale, analytics e shell clinica.
4. **Wave 4 — settings e chiavi**: ambulatori, profilo, aspetto, privacy,
   session lock e cambio PIN.
5. **Wave 5 — documenti e superfici AI-adiacenti**: allegati manuali, archivio,
   rich text, bozza visita deterministica, insight/follow-up read-only e stato AI.
   Consegnata con [PR #16](https://github.com/Wulfgardr/mediflow/pull/16) e
   follow-up [PR #17](https://github.com/Wulfgardr/mediflow/pull/17).

La consegna di Wave 5 copre quella tranche di lavoro; i residui riportati sotto
impediscono di leggerla come chiusura della parità complessiva.

## Wave 6 / closeout residuo

### W6-A — convergenza UI macOS e click-map P6

Sono integrati il codice di contenimento visivo, o clipping, e il probe AX
corretto. Le prove Xcode sul commit storico `0843726fe` valgono però soltanto
per quel tree. W6-A non attesta implicitamente il nativo sulla SHA corrente:
servono disponibilità di Xcode ed esito sulla revisione esatta nella ricevuta
di chiusura terminale.

### W6-B — offline degradato onesto

Owner: `WUL-403`.

Il lavoro rende visibili età e TTL della cache, eventuale obsolescenza, limite
di sola lettura e assenza di una coda di scrittura. Serve a rendere comprensibile
il degrado offline, non a introdurre sincronizzazione multi-master o scritture
senza rete.

La candidata locale `WUL-676` (0.8.6) collega al pannello `WUL-556` i metadata
effettivi di acquisizione, scadenza e motivo. Il TTL massimo rimane 24 ore;
oltre la scadenza vengono restituiti soltanto metadata non identificativi,
senza dati paziente. La lettura resta vincolata da ADR 0048 alla stessa
sessione operatore sbloccata, al pairing, all'ambulatorio e al pin TLS:
401/403, errori TLS e risposte non conformi non attivano il ricorso alla cache.

Store e modello conservano anche l'ultimo profilo manuale entro il TTL, con
una presentazione dedicata in sola lettura nelle destinazioni compatta e
affiancata. Questo prova la presenza del percorso circoscritto nel sorgente
candidato, non il workflow offline ordinario né la verifica integrata su UI
e dispositivo, che restano aperti. La riga rimane pertanto `partial`.
Sotto-risorse, artifact AI/documentali, export e coda di scrittura sono invece
esclusi espressamente dal contratto: non vanno aggiunti per colmare un presunto
vuoto funzionale.

Per decisione owner, Carta resta una grammatica del contenuto e non introduce
una palette calda. Le superfici della slice usano canvas e field neutrali
adattivi; i soli colori non neutrali sono segnali funzionali di stato.

Il gate di consumo `WUL-557` è aperto sul manifest canonico
`packages/mini/contracts/mini-parity.json`. I head PR #184
`3fd988bafe71a058fdd7d3c25ea569793dcba903` e PR #190
`1e35733c0218eae67a1d6e158085aab7340bc26b` espongono lo stesso contenuto
(SHA-256 `8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9`).
La metrica Mini è 4/66 (`6.060606%`): 4 `available`, 61 `manual_only`, 1
`proposal_only` e 0 `unavailable`. Le ragioni non vengono appiattite: 23 righe
sono `HOST_AUTHORITY_ONLY`, 38 `NOT_IN_MINI_PILOT` e 1
`SYNTHETIC_PREVIEW_ONLY`.

| Riga web canonica | Contratto Mini esatto | Stato iPhone/iPadOS | Motivo residuo o confine |
| --- | --- | --- | --- |
| 1 — anagrafica paziente | `available`: `patient search`, `patient show` | `partial` | Mini copre ricerca/dettaglio; la riga Apple include anche create/update, DOB e archivio; assign/unassign/move/duplicate sono esplicitamente fuori dall'obbligo W2 |
| 39 — blocco/stato sessione | `available`: `whoami` | `full-parity` nella matrice Apple; stati visuali coperti dalla slice | `whoami`, pairing o token locale non sono un grant agentico |
| 45 — cache offline | `manual_only`: `NOT_IN_MINI_PILOT` | `partial` | Candidato WUL-676: metadata stale live e cache cifrata lista/ultimo profilo con renderer read-only source-present; workflow offline ordinario e verifica UI/device aperti. Write queue esclusa da ADR 0048 |
| 63 — discovery capability | `available`: `capabilities` | `full-parity` per consumo API | Il manifest descrive capability; non autorizza operazioni cliniche |

`open-loops` (riga 11) è la quarta riga Mini `available`, ma non appartiene alla
slice `WUL-556`. `draft preview` (riga 4) resta `proposal_only` con ragione
`SYNTHETIC_PREVIEW_ONLY`. Le altre righe conservano la disposizione e la ragione
del manifest; le 23 `HOST_AUTHORITY_ONLY` restano host-only nella matrice Apple.

| Superficie mobile | Stato candidata | Evidenza | Dipendenza host/headless |
| --- | --- | --- | --- |
| iPhone | `partial` | Test di presentazione, XCUITest e screenshot sintetico | Nessun grant nuovo; usa solo stato paired esistente |
| iPadOS | `partial` | Stesso contratto, layout adattivo, `⌘R`, pointer, XCUITest e screenshot sintetico | Metadata TTL/stale collegati nel candidato WUL-676; integrazione e verifica UI/device ancora aperte |
| Capability AIP/Mini | Gap Apple e disposizione Mini restano assi separati | Manifest WUL-557: 4/66 disponibili | Le ragioni `partial`, host-only e `manual_only` restano esplicite; manifest e receipt non diventano autorità client; verifica manager e `WUL-564` bloccano la promozione |

### W6-C — decisione sul workflow documentale nativo

Dipendenze: `WUL-417` (OCR Apple on-device), `WUL-383` (degradazione OCR) e
`WUL-409` (Smart Import review-first).

Sul web, archivio popolato, revisione delle estrazioni e stati di caricamento,
vuoto ed errore hanno una prova E2E 2/2. I client Apple leggono gli insight,
caricano documenti manuali e mostrano il riepilogo da rivedere, con conteggi
persistiti N+ e stati di caricamento o errore espliciti.

ADR 0076 mantiene sull'host OCR, revisione delle estrazioni e scritture derivate
dai documenti. La separazione è classificata
`platform-specific-documented`: è una scelta di responsabilità, non una
mancanza implicita del client.

### Fuori Wave 6

- chat/generazione AI paired;
- gestione modelli, registro Fabric, governance/rollout, backup, diagnostica e import repertori dal client;
- hard delete remoto;
- writeback SISS/FSE;
- coda di scrittura offline o sync multi-master;
- parity applicativa Windows/Linux.

Il catalogo AIFA nativo non è un residuo: autocomplete, AIC/ATC e fallback
manuale sono già presenti; `WUL-476` è assorbita dallo stato corrente.

## Control-to-action map

La mappa collega ciascun controllo all'azione esercitata e alla prova di
chiusura registrata. Non estende l'esito a controlli o superfici non provati.

| Superficie | Controllo | Identificatore | Azione | Evidenza |
| --- | --- | --- | --- | --- |
| Web | Agenda | nome AX `Agenda` | Cambia area cockpit | Chrome produzione |
| Web | Rivedi agenda | nome AX `Rivedi agenda`; `aria-controls=turno-agenda-heading` | Mantiene `area=turno`, porta in viewport e focalizza il titolo `Agenda di oggi` | E2E e VoiceOver production `PASS_BOUNDED` sul runtime `29b2c94b6a04` |
| Web | Pazienti | nome AX `Pazienti N` | Carica worklist | Chrome produzione |
| Web | Diario | `lume-diario` | Carica feed globale | Chrome produzione |
| Web | Scheda | `lume-scheda-header` | Carica paziente e aggregati | E2E candidato locale D1/D2 — SHA esatti |
| Web | Evidence Stack | tile documento | Mostra stati e avvia curation | E2E 2/2 |
| Apple | Sezione clinica | `clinical-workspace-section-*-button` | Seleziona area | Audit automatico |
| Apple | Lista pazienti | `patients-selection-list` | Seleziona dettaglio | Audit automatico |
| macOS | Agenda sidebar | `clinical-workspace-section-agenda-button` | Seleziona riga `List` | Click-map e probe AX PASS |
| macOS | Riga paziente | `patient-cell-*` | Seleziona e carica dettaglio | Click-map e probe AX PASS |
| macOS | Focus | focus system | Avanza con `Tab` e freccia | Interazione reale PASS |
| macOS | Inspector paziente | `clinical-workspace-inspector-toggle` | Toolbar o `⌥⌘I` mostra/nasconde il contesto della finestra focalizzata | WUL-566/WUL-567: test focalizzati, 2 finestre simultanee osservate nello stesso PID, suite nativa, build Xcode e screenshot light/dark PASS; apertura OS, focus, resize, VoiceOver e app-freeze proof della slice `PARTIAL` restano pending. Il manifest Mini PR #184 mantiene `sourceRow: 32` a `manual_only`, senza comandi Mini. |

### AXPress

Il probe seleziona la riga nativa e ne verifica `AXSelectedRows`, anziché
premere il testo statico al suo interno in SwiftUI. Il precedente rilievo
`AXPress` è quindi `corrected` e non costituisce un blocco corrente.

## Gate di uscita

Una capability può diventare `full-parity` solo con:

1. funzioni equivalenti nel perimetro dichiarato;
2. stessi campi clinici significativi;
3. equivalente ricerca, filtri, stati e gestione conflitti;
4. workflow completabile end-to-end;
5. test o runbook ripetibile;
6. click-map manuale quando la promessa riguarda l’esperienza UI;
7. nessuna violazione dei boundary local-first, cifratura dichiarata o
   review-first.

La verifica assistiva resta non terminale finché la tecnologia richiesta non
viene usata sulla piattaforma dichiarata. L'unica limitazione esterna già
accettata è quella di VoiceOver mobile, registrata in
[docs/known-limitations.md](./known-limitations.md). Ogni altra prova non
terminale mantiene `HOLD_PROMOTION`: un test automatico diverso non può
sostituirla.

## Verifica

```bash
npm run check:apple-wide-qa
jq empty docs/apple-parity-matrix.json
git diff --check
rg --files -g '*.md' | sort
```
