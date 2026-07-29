# Handover — interfaccia Apple universale

Data: 2026-07-26
Sessione: Claude Opus 5, worktree `.codex/worktrees/404d/medical-record-app`
Perimetro: **solo interfaccia** nativa + mappatura Apple Intelligence.
Fuori perimetro (per istruzione): backend, schema, API, web. **Niente push.**

## Stato del codice

- Ramo: `apple/ui-harmonization-2026-07-26`
- Commit: `fe023be6e` (da `ab4909fd9`)
- Worktree pulito, **nessun push eseguito**
- Il worktree era in *detached HEAD* con 34 file non committati: e' stato messo
  su ramo prima dell'handover. Verificare `git branch --show-current` prima di
  qualunque operazione in quel worktree.

## Verificato

- **Batteria UI iOS: 32 test, 0 fallimenti** (iOS 27, iPhone 17 Pro).
  Questa e' la nuova linea di base: da qui, qualunque fallimento e' una
  regressione. Non esiste piu' una "coppia preesistente" da scusare.
  > **Rettifica del 26 luglio, sessione successiva.** La cifra e' esatta ma
  > incompleta: dei 32, **4 sono saltati** perche' sono contratti di layout
  > solo-iPad che si auto-saltano altrove. Su iPhone la linea di base e'
  > **28 passati, 4 saltati, 0 falliti**. Su iPad Pro 13 M5 i 4 contratti
  > girano davvero e **passano**, mentre **5 test falliscono**:
  > `testTabBarNavigatesBetweenSections`, `testProjectMenuOpensEverySurface`,
  > `testUsablePatientHomeShowsWorklistBeforeConnectionSetup`,
  > `testFirstPatientIsVisibleInTheFirstViewportAtAX5`,
  > `testWorklistLastRowClearsTheFloatingTabBarAtAX5`.
  >
  > **Chiuso il 27 luglio.** Quei cinque non erano regressioni ne' divari di
  > parita': sono contratti del cromo compatto, cioe' la tab bar mobile e il
  > menu Progetto che vive solo nel ramo `TabView`. Su iPad quel cromo non
  > esiste per scelta dichiarata (#142): li' la navigazione e' una
  > `NavigationSplitView` con sidebar, e un test che pretende la tab bar su iPad
  > asserisce l'opposto del progetto. I messaggi lo dicevano da soli, "compact
  > layout should present the tab bar" e "Compact navigation should expose four
  > sections". Ora si auto-saltano su iPad, come i quattro contratti solo-iPad
  > gia' si auto-saltavano su iPhone: la matrice adattiva era a meta' ed e'
  > diventata simmetrica.
  >
  > **Linea di base definitiva, app nativa su iOS 27:**
  >
  > | | eseguiti | falliti | saltati |
  > |---|---|---|---|
  > | iPhone 17 Pro | 34 | **0** | 4, solo-iPad |
  > | iPad Pro 13 M5 | 34 | **0** | 5, solo-compatto |
  >
  > Nessuna copertura spenta, verificato nominalmente: i cinque contratti
  > compatti risultano `passed` su iPhone, non `skipped`.
  >
  > **Rettifica di una rettifica, e conta piu' di quanto sembri.** Questa riga
  > dichiarava che l'UDID iPad citato piu' sotto non esisteva piu'. Falso:
  > `D2216CF2-6EA0-4EA4-861F-41E0DED1E5F8` esiste, e' disponibile ed e' il
  > dispositivo giusto. Lo avevo cercato con un elenco troncato da `head -8`.
  >
  > La conseguenza non e' formale. Avendolo creduto sparito ne ho usato un
  > altro, `B02B47BF-…`, che gira su **iOS 26.3**: tutte le misure iPad prese
  > prima di accorgermene, comprese le cinque rotture e i pixel del registro
  > scuro, non erano sul runtime di destinazione. **Il target e' iOS 27**, e
  > `D2216CF2` e' l'unico iPad che lo monta. Le misure iPad valide sono solo
  > quelle rifatte li'.
- Unit: `ClinicalContrastTests` 5/5, `ClinicalFieldCryptoTests` 7/7.
  > **Rettifica.** Sono due classi, non la batteria. Il pacchetto SwiftPM
  > completo e' **396 test con 1 fallimento** gia' su `c0b1ee2a9`:
  > `LumeKitTests.testLumePrimitivesRenderOpaqueInAllRegisters` asserisce che
  > una primitiva Lume non coincida con lo sfondo e trova `[30, 30, 30]`
  > uguale a `[30, 30, 30]`. Verificato mettendo da parte ogni modifica.
- Nativo allineato al database sintetico: iPhone mostra "60 pazienti caricati in
  lettura", nomi `Sintetica…`, auto-login, nessun PIN.

## Il sistema visivo, in tre file condivisi

Prima viveva solo su macOS dentro `#if os(macOS)`; su iOS c'era una zuppa di 25
`caption2` e 17 `caption` nella sola sezione Documenti.

- `ClinicalChartMetrics.swift` — geometria (raggi concentrici *per costruzione*:
  interno = esterno − padding) e i registri `chartCardTitle`,
  `chartGroupHeading`, `chartRowTitle`, `chartProse`, `chartMetadata`, piu'
  `ChartGroup`.
- `ClinicalSectionAccent.swift` — tinte di orientamento **solo sul glifo** di
  sezione. Vincolo esplicito: `LumeTone` (positive/attention/critical) dichiara
  lo stato clinico, quindi gli accenti nascono da famiglie fredde e desaturate e
  non toccano mai un dato.
- `ClinicalFieldStyle.swift` — `ClinicalTextFieldStyle` (capsula) applicato una
  volta alla radice dello spazio di lavoro: viaggia nell'ambiente e raggiunge
  decine di campi.

## Equivalenza funzionale macOS ↔ iOS

Nove azioni su nove mappate (Modifica, Archivia, Riattiva, Elimina, Esporta
FHIR, Condividi FHIR, Prescrittivo regionale, overflow, Nuovo paziente).
Cambia solo la collocazione: barra della finestra sul Mac, riga del titolo piu'
overflow su iOS.

**Una asimmetria deliberata:** `.host` esiste solo su macOS. L'amministrazione
dell'home-base si offre solo da loopback; esporla sul canale abbinato sarebbe
amministrazione a distanza di un archivio clinico. **Non "completare" questa
equivalenza.**

## Difetti corretti che non erano estetici

1. **Template S/O/A/P.** Inseriva nel documento la stessa stringa che sul web e'
   solo il `placeholder` dell'editor. L'app poteva salvare nel referto quattro
   righe di prosa clinica che nessun clinico ha scritto, incluso "valutazione
   clinica da rivedere" sotto la A. Ora inserisce solo `S:` `O:` `A:` `P:`.
2. **Pillola ICD illeggibile** sulla riga selezionata: `.primary` viene
   ridipinto in bianco dallo stile di selezione sopra il riempimento chiaro del
   chip. Misurato **1.09:1**. Ora colori espliciti, 15.7:1.
3. **Scheda Diario che sforava** lo schermo tagliando date e controlli.
4. **Selettore di ambulatorio** nel modulo di abbinamento invece che nello
   spazio di lavoro che filtra.
5. **`statusMessage`/`errorMessage`** renderizzati solo nel foglio di
   configurazione: ogni esito o errore dello spazio di lavoro era invisibile
   dove l'azione avveniva.

I punti 4 e 5 erano i due test che fallivano "da sempre" e che io ho trattato
per gran parte della sessione come rumore di fondo. Non lo erano.

## Trappole verificate, da non ripetere

- **`ViewThatFits` conserva comunque l'ULTIMO candidato.** Se l'ultimo quasi
  entra, allarga l'intera scheda e taglia tutto al bordo. L'ultimo gradino deve
  essere quello che non puo' sforare.
- **`DisclosureGroup`** commuta solo sulla propria etichetta, ma il riquadro
  comprende il blocco rivelato: dove cade un tocco al centro dipende
  dall'altezza di quel blocco.
- **`PlatformColors.cardBackground` non e' bianco** su iOS
  (`secondarySystemBackground`). Per le schede usare `chartCardSurface`.
- **`backgroundProminence`** richiede macOS 14; il pacchetto punta a 13.
- La suite UI presuppone un iPhone: su iPad fallisce ~5 test per assunzioni
  sulla tab bar, **non** per regressioni.

## Aperto, con punto d'attacco preciso

1. **Sblocco web di localhost:3100.** Il PIN `314159` (utente
   `performance-baseline`) **e' valido** — il client nativo si autentica con
   quelle credenziali sullo stesso DB e carica 60 pazienti. Ma dal browser
   fallisce e `failed_login_attempts` resta **0**: la richiesta non arriva al
   controllo. Ipotesi: la schermata di sblocco non trasmette lo username (mostra
   solo "PIN operatore"). **Prossimo passo: leggere cosa il form invia a
   `/api/auth/login`.**
   > **Diagnosi chiusa, e l'ipotesi era sbagliata.** Lo username mancante non
   > c'entra: `resolveLoginUsername` (`app/api/auth/login/route.ts:64`) ha un
   > ripiego a utente unico e il DB sintetico ha **esattamente 1 utente**
   > (verificato in sola lettura). La richiesta arriva al controllo, bcrypt
   > passa, il server risponde **200** e azzera il contatore: `0` non significa
   > "mai arrivata", significa "accesso riuscito".
   >
   > La catena si rompe **dopo**, nel client. Il seed
   > (`scripts/seed-performance-baseline.mjs:121`) scrive
   > `encrypted_master_key = 'fixture-wrapped-master-key-not-for-runtime'`, una
   > stringa segnaposto. `security-provider.tsx:318` la passa a
   > `unwrapMasterKeyVersioned`, che finisce in `atob` e lancia
   > `DOMException Invalid character` (verificato eseguendolo). Il `catch`
   > generico mostra "Errore durante il login." e la schermata resta chiusa.
   > Il nativo supera lo stesso punto solo perche' `unwrapMasterKeyVersioned`
   > restituisce un opzionale e la sessione prosegue dichiarando "Cifratura
   > campi non disponibile": significa che i 60 pazienti erano probabilmente
   > **letti con i campi clinici sigillati**, non decifrati.
   >
   > Causa radice nello strumento di demo, non nel web. Rimane da decidere se
   > toccare `security-provider.tsx` perche' distingua "PIN sbagliato" da
   > "chiave archiviata inutilizzabile": e' web, fuori dal perimetro dichiarato,
   > e serve autorizzazione esplicita.
2. **Agenda, Diario, Analytics** hanno preso i registri ma non sono stati
   rivisti a schermo dopo la modifica.
3. **Dati finti per quelle tre viste**: `AgendaWorkspaceModel` passa dal livello
   di connessione, quindi e' plumbing, non un dizionario in piu'.
4. **Terreno unico su macOS** non verificato: serve il permesso di cattura
   schermo, che concede Leonardo.
5. **Gating proattivo delle capability**: l'host ne dichiara 30, il client ne
   verifica 7. Non e' un divario funzionale ma di gating — le superfici vecchie
   falliscono con 403 al momento dell'uso invece di avvisare prima. Il pattern
   corretto esiste gia' nella sezione Documenti.
   > **Rettifica.** Le capability dichiarate sono **29**, non 30: concordano
   > l'inventario di runtime (`lib/network-contract.ts:263`), il tipo
   > `NetworkCapabilityKey` (`lib/api/v1/types.ts:471`), l'enum OpenAPI e il
   > test contrattuale, che asserisce `capabilities.length === 29`. Di queste,
   > 25 sono chiavi network attive. La causa strutturale del divario e' che
   > `PairedPatientsWorkspaceModel` non nominava mai una capability in 4464
   > righe: le sue proprieta' `can*`, su cui poggiano quasi tutti i pulsanti,
   > verificavano sessione e connessione ma non il permesso.

## Parita' verificata su quattro superfici, non su due

L'handover verificava la parita' **macOS ↔ iOS**, nove azioni su nove, e regge:
le etichette native sono tutte presenti (Modifica, Archivia, Riattiva, Elimina,
Esporta FHIR, Condividi FHIR, Prescrittivo regionale, Altre azioni, Nuovo
paziente). Quello che non era stato verificato e' il lato **web ↔ nativo**, e li'
i divari ci sono. Rilevati sulla scheda viva di un paziente sintetico su `:3101`,
non dedotti dal codice.

> **Rettifica della prima stesura.** La versione precedente di questa tabella
> dichiarava assenti dal web archiviazione, riattivazione ed eliminazione. Era
> **sbagliato**: esistono, su `/patients/[id]/edit`, con `db.patients.update`
> e `db.patients.delete`. Le avevo giudicate assenti guardando la sola scheda
> `/modules` e cercando stringhe esatte. E' lo stesso errore di metodo che
> questo documento rimprovera altrove: dedurre l'assenza da una vista parziale
> invece di interrogare la superficie intera.

| azione sul paziente | nativo | web | nota |
|---|---|---|---|
| Modifica | si | si | |
| Esporta FHIR | si | si | nomi diversi: **"Esporta FHIR"** contro **"Export FHIR"** |
| Nuova voce | si | si | |
| Archivia | si | si | sul nativo nella riga paziente, sul web un livello piu' in fondo, in `/edit` |
| Riattiva | si | si | sul web si chiama **"Ripristina"** |
| Elimina paziente | si | si | entrambi soft delete con motivazione |
| Report PDF | si | si | `PatientReportDocument.swift` contro `lib/report-service` |
| Prescrittivo regionale | si | si | sul web e' la famiglia **SISS handoff** |
| Condividi FHIR | si | si | **chiuso il 27 luglio**, vedi sotto |

Il divario di **funzione** e' chiuso: era uno solo, Condividi FHIR, portato sul
web il 27 luglio. Il nativo separa due tempi, `prepareFHIRExport` che valida
contro FSE e scrive il file e `ShareLink` che lo consegna al sistema; il web
faceva solo la prima meta' e finiva in cartella Download. Ora i due percorsi
condividono la stessa preparazione, cosi' il controllo che blocca sugli errori
FSE non ha due copie che possono divergere, e la consegna passa dalla Web Share
API. Il pulsante si disegna **solo dove il browser sa davvero condividere un
file**: su iPhone, iPad e Safari sul Mac si', in diversi browser desktop no, e
li' un pulsante che non apre niente sarebbe peggio della sua assenza.

Resta un divario di **collocazione e di nome**, che non e' meno reale per chi
passa da una superficie all'altra:

1. Sul nativo il ciclo di vita del paziente sta accanto al paziente; sul web
   sta dietro "Modifica". Chi impara il gesto su iPhone non lo ritrova sul web
   dove se lo aspetta.
2. **Due** azioni identiche avevano due nomi, ora allineate al nativo:
   "Export FHIR" e' diventato "Esporta FHIR", e il disarchiviare e' diventato
   "Riattiva". Il secondo non era un sinonimo ma un'ambiguita': sul web
   "Ripristina" indicava **quattro** operazioni diverse, disarchiviare un
   paziente, recuperare una voce dal cestino, ripristinare il database e
   ripristinare un backup. Il nativo distingue "Riattiva" dall'archivio e
   "Ripristina" dal cestino, ed e' la distinzione corretta.

   > **Il terzo caso non era un divario, e la mia matrice sbagliava.**
   > "Prescrittivo regionale" e "SISS" non sono due nomi per la stessa cosa:
   > il nativo apre `SissPortalURLs.prescrittivoRegionale`, quindi PRREG e' una
   > **destinazione dentro** la famiglia SISS, e il web scrive gia'
   > `'prescription.create': 'Prescrittivo Regionale (PRREG)'`. SISS e' il nome
   > reale del portale e resta corretto come etichetta di famiglia.

## Aperto: la barra strumenti dell'iPad, causa non trovata

Guardato a schermo su iPad Pro 13 M5, iPadOS 27, modalita' dimostrativa con 20
pazienti. La barra di navigazione disegna una capsula di vetro larga circa mille
punti con il glifo "nuovo paziente" inchiodato al bordo sinistro, il menu di
ordinamento e il selettore di ambulatorio al bordo destro, e circa ottocento
punti di vetro vuoto in mezzo. Legge come un layout venuto meno, non come una
barra composta. Su iPhone la barra e' troppo stretta perche' si veda.

Cosa e' stato escluso, con prove:

- **Non e' il campo di ricerca collassato.** Toccando lo spazio vuoto non
  succede nulla; la ricerca e' il cerchio separato al bordo destro.
- **Non e' il raggruppamento.** I tre controlli erano tre `ToolbarItem`
  separati; riuniti in un solo `ToolbarItemGroup(placement: .primaryAction)` la
  resa e' rimasta identica, verificata ricostruendo e reinstallando.

Il raggruppamento e' stato tenuto, perche' quei tre controlli sono un gruppo,
ma non risolve e il commento nel codice lo dichiara.

Da provare a chi riprende: se la capsula sia la barra di ricerca **non**
collassata che occupa il centro mentre `MinimizedSearchToolbarBehavior` e' un
no-op su iPad; se `.primaryAction` in una colonna di `NavigationSplitView` su
iPadOS 27 si distribuisca invece di raggrupparsi; e se `ToolbarSpacer`, che e'
iOS 26, permetta di dichiarare esplicitamente il confine fra i gruppi con un
`#available` sopra il target dichiarato iOS 17.

## Aperto dopo la ripresa: la rampa Lume su macOS, che chiede una tua decisione

Cercando la prova del terreno unico ho misurato i colori di sistema contro una
`NSWindow` reale, in entrambe le apparenze, su macOS 27:

| colore di sistema | chiaro | scuro |
|---|---|---|
| `underPageBackgroundColor` | 246, 246, 246 | 40, 40, 40 |
| `windowBackgroundColor` | 255, 255, 255 | 30, 30, 30 |
| `textBackgroundColor` | 255, 255, 255 | 30, 30, 30 |
| `controlBackgroundColor` | 255, 255, 255 | 30, 30, 30 |

Ne discendono due cose. La prima l'ho corretta: `PlatformColors.groupedBackground`
era `windowBackgroundColor`, cioe' esattamente il colore delle schede che
dovevano posarci sopra, quindi il terreno non recedeva affatto. Ora e'
`underPageBackgroundColor`, e `MacSingleGroundTests` lo fissa.

La seconda **non** l'ho toccata, perche' e' una decisione sul linguaggio
visivo e non e' mia. `LumeSurface.macOSSurface` mappa le quattro zone su
`canvas → underPage`, `field → control`, `focal → text`, `chrome → window`, e
il commento accanto promette "un gradino per zona, cosi' una sezione, un blocco
annidato e il pannello attorno restano distinguibili". Misurato: **tre zone su
quattro sono lo stesso colore.** La rampa ha due livelli, non quattro, e il
sistema non offre un terzo livello fra quelli usati.

Questo spiega anche il fallimento pre-esistente di
`LumeKitTests.testLumePrimitivesRenderOpaqueInAllRegisters`, che va letto per
quello che e': il test chiede che il registro **guardia** produca una superficie
diversa dal grafite, ma su macOS `LumeSurface` usa deliberatamente i colori di
sistema e **ignora la palette**, per la ragione scritta a `Lume.swift:247`
("le superfici macOS sono materiali di sistema, non esadecimali fissi").
Il test e la decisione di progetto si contraddicono a vicenda: o cade il test,
o cade la scelta di ignorare la palette su macOS. Non e' un artefatto di
misura, ed e' verificato: chiaro e scuro **differiscono** regolarmente, quindi
la risoluzione dei colori funziona.

## Ambiente

- Xcode-beta su sparsebundle esterno; `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`
- **Simulatori di destinazione, iOS 27 e nient'altro.** iPhone 17 Pro
  `97738497-D8C4-4ACB-94CB-93871F42D7DD` e iPad Pro 13 M5 (27)
  `D2216CF2-6EA0-4EA4-861F-41E0DED1E5F8`. Sulla macchina esistono anche
  dispositivi su iOS 26.3, fra cui un altro iPad Pro 13 M5
  (`B02B47BF-…`): **non vanno usati**, il prodotto targetizza iOS 27.
  Verificare sempre il runtime, non il solo nome del dispositivo, con
  `xcrun simctl list devices | awk '/^-- /{rt=$0} /<udid>/{print rt}'`.
- Demo: istanza Next su `:3100` con DB sintetico nello scratchpad (verificato
  col descrittore di file, **non** dedotto dalla cwd), proxy TLS `:3543`,
  `launch.sh` con auto-login.
- **I pazienti reali di Leonardo sono su `:3000`.** `:3100` e' sintetica.

## Nota di metodo, seconda parte: dedurre l'assenza da una vista parziale

La sessione di ripresa ha ripetuto **tre volte** lo stesso errore, e vale la pena
nominarlo perche' e' insidioso proprio quando si va di fretta.

1. Ho dichiarato che il web non sapesse archiviare, riattivare o eliminare un
   paziente. Esiste tutto, su `/patients/[id]/edit`: avevo guardato la sola
   scheda `/modules`.
2. Ho dichiarato che Report PDF esistesse solo sul web e il prescrittivo solo sul
   nativo. Esistono su entrambi, con altri nomi.
3. Ho dichiarato che un UDID di simulatore non esistesse piu'. Esiste: l'elenco
   era troncato da `head -8`.

Ogni volta il codice o il sistema avevano risposto correttamente a una domanda
piu' stretta di quella che credevo di porre. La regola che ne segue e' gemella
di quella qui sotto: **non concludere l'assenza da un comando che non ha
guardato tutto.** Un `grep` su una stringa esatta, una sola schermata, un elenco
troncato: nessuno dei tre puo' dimostrare che qualcosa non c'e'.

## Nota di metodo per chi riprende

Due volte in questa sessione ho asserito quale database fosse in uso senza
verificarlo, deducendolo dalla working directory invece di leggere i file
aperti dal processo. La seconda volta ho lanciato un falso allarme su dati
reali. Su questo progetto: **chiedere al processo, non dedurre.**
