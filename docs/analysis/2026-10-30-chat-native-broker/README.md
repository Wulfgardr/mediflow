# Scheda sintetica, broker e conferma nativa

Refs WUL-788. Base: `cebba9b7ad80690bd9c39b01db31657819ac0dfb`.
Contributo di implementazione, non accettazione finale delle righe C.

La vista MCP Apps richiede una scheda sintetica. Il listener GPUI verifica il
peer OS e l'antenato Claude/Codex firmato secondo ADR 0165, poi cattura sessione,
archivio e selezione. Un processo Node privato della GPUI prepara la fixture
`basic` con il broker e GLiNER: non legge la cartella selezionata e non è un
server MCP. La UI nativa dichiara esplicitamente questa distinzione.

La finestra nativa mostra byte finali, SHA-256 e fonte ricomposta locale.
Soltanto il gesto nella GPUI, attraverso PIN verificato dal canale paired
esistente o LocalAuthentication, può approvare la richiesta. La chat non
riceve PIN, passphrase, cookie, proof, mapping, filename o nome originale.
Il risultato app-only mette il payload esclusivamente in `_meta`; testo del
tool ed errori restano fissi. Nessun `structuredContent`, aggiornamento del
contesto del modello, inferenza, writer o scrittura clinica è introdotto.

La conferma dura 30 secondi dalla disponibilità della revisione; il processo
privato applica anche il proprio limite di 30 secondi. Si consuma una sola
lettura. Nessun rinnovo. La vista si ritira dopo cinque minuti dalla consegna,
oppure prima per revoca, lock, fine connessione o nuova notifica tool dopo
l'avvio esplicito. Le poll di stato non prolungano l'autorizzazione.
Il controllo della selezione host viene riletto alla conferma e al consumo;
le poll verificano la selezione locale. Un cambio remoto dopo la consegna
non ha una notifica server dedicata: non si promette ritiro immediato.

Il mapping è confinato alla RAM del processo privato. Fine richiesta e revoca
lo terminano; una preparazione ancora in attesa osserva la cancellazione
entro 50 ms tra attese IPC, con limite totale di 90 s. Consumo e verifica
finale hanno un limite IPC di 2 s; sessione e selezione sono ricontrollate
anche dopo l'attesa. Il renderer può avere già ricevuto i byte dopo il
controllo finale: revoca e chiusura non ne attestano la cancellazione nell'host.

## Prove

Mac osservato: Mac16,5, macOS 27.2 **26B123**, Claude Desktop **4.29.0**,
Codex nell'app ChatGPT **26.1023.51421 (22530)**, bundle `com.openai.codex`.
Questo differisce dal profilo ipotizzato 26B118. Node locale **24.18.0**.

- GLiNER reale, stesso corpus annotato di otto schede: prima della correzione
  recall critica 0,8, otto casi respinti; filename in tutti i casi e un luogo
  non rilevati. Dopo il filtro comune per riferimenti a file e luoghi con
  etichetta esplicita: otto casi validi, recall critica 1, nessun token vietato
  residuo. Nessun ricorso alle annotazioni per produrre gli span. Il limite
  resta questo corpus e il linguaggio sintetico chiuso del broker.
- Oltre 300 test Node mirati: redazione, evidenze, broker, PIN/lockout autentico
  sul verifier e route paired, owner privato e selezione della suite.
- GPUI: build e Clippy workspace/all-targets; cinque test chat passati,
  sette integrazioni storiche ignorate perché richiedono un antenato desktop
  firmato; un’ulteriore integrazione richiede l’host sintetico e GLiNER locali. Il doppio del risultato biometrico è solo test, senza flag runtime.
- Prova integrata esplicita sul vero host sintetico: login v3, preparazione
  GLiNER nel processo Node privato avviato dalla GPUI, PIN verificato dal
  verifier paired reale, consumo del payload uguale ai byte revisionati,
  replay respinto e logout. Sullo stesso host, nuove preparazioni GLiNER e
  PIN reali negano consenso assente, scadenza dei 30 s, inattività di 5 min
  e revoca. Per le scadenze si spostano gli istanti della richiesta nel test;
  non si attende artificialmente il timeout. PASS. Il peer OS è un doppio di test; non attesta
  l'antenato firmato né un clic nella finestra desktop. Il primo tentativo
  ha rivelato l'ordine errato degli import nel processo Node: corretto e
  coperto dal test di avvio diretto, senza loader ereditato dal test runner.
- Frame Playwright a 390 e 1440 px: consumo singolo, reload negato, revoca
  nativa, nuovo input tool, teardown, cinque minuti e notifica iniziale.
  Il contesto rifiuta esplicitamente qualsiasi richiesta alla porta 3000.
- 64 test dei consumatori della preparazione comune: pass.
- Lint, typecheck, claims e never-regress passati.

Le prove native del consenso assente/scaduto, rifiuto, inattività, revoca,
istanza diversa, replay, lock, cambio archivio e selezione/ABA negano la
consegna. Il test PIN Node usa il verifier reale e il lockout persistente;
il server dei test Rust di stato è un doppio HTTP. La prova integrata unisce ora verifier e broker reali, ma non è
un E2E nei desktop reali. Il figlio Node riceve un ambiente minimo senza
credenziali ereditate dal processo GPUI.

Sul desktop reale Claude è stato osservato il rendering della risorsa.
Il primo tentativo è stato ritirato dalla notifica iniziale: la correzione
ha un caso di regressione nel frame. Il primo sblocco v3 della GPUI è stato
osservato su runtime sintetico isolato. La qualifica completa del candidato
con PIN nella finestra e payload inline deve ancora essere attestata.
Nessuna prova Touch ID reale è dichiarata.

Gli hash di report e log sono in `evidenze.csv`; i file completi restano nel
  dossier locale `~/Antigravity/mf-hillclimb-20261028/chat-c-<SHA-base>/curated/`.
  Nessuna galleria è aggiunta a Git. Le configurazioni temporanee di Claude
  sono state ripristinate byte per byte, la bozza iniziale è stata ripristinata
  senza invio e i processi GPUI/HTTP posseduti dal run sono stati arrestati.

## Stato dei criteri e prova restante

| Riga | Risultato del contributo | Limite per la chiusura |
| --- | --- | --- |
| C-B | Runner reale, corpus, filtro corretto, consenso nativo sui byte collegato | E2E finale sui due desktop e review indipendente |
| C-3a | Canale app-only e frame collegati; R Claude osservato | Payload e canali sul candidato finale in entrambi gli host |
| C-3b | Ricomposizione privata RAM, token e fonti separati dal bridge | Ciclo completo di lock/refresh/riavvio sui due desktop |
| C-4 | PIN nativo collegato; test verifier, lockout e doppio biometrico | PIN interattivo finale, Touch ID reale con Leonardo e negativi Mac |
| C-L | Corpus reale iniziale, protocollo in `carico.md` | Carichi completi e almeno 30 run caldo/freddo per scenario |
| C-8 | Matrice in `catalogo.csv`, omissioni esplicite | Catalogo I-0 e qualifica funzione/host |
| C-10a | Matrice in `canali.csv`; incognito Claude osservato | Account/policy/retention e canali non osservabili; D2 per dati reali |

Leonardo deve provare Touch ID vero, rifiuto, lockout biometrico, hardware
assente e lock del Mac sul bundle congelato. D2 e D5 non sono stati usati
per bloccare o autorizzare le prove sintetiche; dati reali, listing e store
restano fuori dal contributo. Nessun criterio qui è marcato «chiuso» prima
delle relative prove e della review indipendente.

## Avvio circoscritto

Usare un host sintetico paired già preparato e fare il primo sblocco v3.
Impostare nella GPUI:

- `MEDIFLOW_CHAT_ACCESS_SOCKET`: socket in directory privata, canonica,
  già esistente, modalità 0700; nessun socket preesistente viene sostituito;
- `MEDIFLOW_CHAT_CARD_NODE`: eseguibile assoluto Node 24.18.0;
- `MEDIFLOW_CHAT_CARD_OWNER`: percorso assoluto a
  `scripts/chat-card-native-owner.mjs`, con byte uguali alla copia incorporata
  nella build GPUI;
- `MEDIFLOW_CHAT_CARD_INSTALLATION`: JSON locale privato con `runner` ed
  `evidence` secondo `SyntheticCardInstallation`; evidenze reali sul corpus
  `scripts/fixtures/chat-card-corpus.json`, mai report simulati in installazione.

Il processo privato usa i moduli della stessa checkout e le sue dipendenze
locali; questo avvio non è il packaging C-10b. Nessun download o ripiego
automatico. Configurare il desktop per avviare lo stesso binario GPUI con
`--chat-access-stdio PERCORSO_SOCKET`. Un'altra build viene respinta.
Aprire una nuova vista per ogni autorizzazione: reload e seconda lettura
non recuperano concessioni precedenti.

`shell.rs` non è stato modificato. I punti di conflitto con la divisione
concorrente sono soltanto gli ingressi esistenti di `shell/chat_access.rs`
(`start_chat_access`, `retire`, `chat_access_view`) e la loro eventuale nuova
collocazione; il broker e il trasporto restano in moduli separati.

I primi controlli CI hanno inoltre rilevato la registrazione non aggiornata
dei nuovi trigger e una funzione di test inutilizzata su Linux. Correzioni
circoscritte a registrazione e compilazione condizionale, senza esclusioni
di controlli o aumento di soglie.

Sviluppo assistito: GPT-6.1 Sol, effort xhigh, nessun subagente.
