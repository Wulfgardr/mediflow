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
  > `testWorklistLastRowClearsTheFloatingTabBarAtAX5`. L'UDID iPad citato piu'
  > sotto non esiste piu' tra i simulatori disponibili.
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

## Ambiente

- Xcode-beta su sparsebundle esterno; `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`
- Simulatori iOS 27 creati: iPhone 17 Pro `97738497-…`, iPad Pro 13 M5 `D2216CF2-…`
- Demo: istanza Next su `:3100` con DB sintetico nello scratchpad (verificato
  col descrittore di file, **non** dedotto dalla cwd), proxy TLS `:3543`,
  `launch.sh` con auto-login.
- **I pazienti reali di Leonardo sono su `:3000`.** `:3100` e' sintetica.

## Nota di metodo per chi riprende

Due volte in questa sessione ho asserito quale database fosse in uso senza
verificarlo, deducendolo dalla working directory invece di leggere i file
aperti dal processo. La seconda volta ho lanciato un falso allarme su dati
reali. Su questo progetto: **chiedere al processo, non dedurre.**
