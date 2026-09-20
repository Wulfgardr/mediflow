---
summary: "Product contract for MediFlow: audience, tasks, platform roles, boundaries, anti-goals, and success criteria."
read_when:
  - "Changing product behavior, release claims, platform roles, or the public narrative."
  - "Separating current MediFlow capabilities from later product direction."
---

<a id="mediflow-product"></a>
# MediFlow: contratto di prodotto

## Banner

**Serve the right information at the right time.**<br>
**Porta l'informazione giusta nel momento giusto.**

<a id="purpose"></a>
## Finalità

MediFlow è uno spazio di lavoro clinico aperto e gratuito, nato dalle
difficoltà operative che i medici incontrano ogni giorno. Il suo scopo è
ridurre i passaggi evitabili per ritrovare un’informazione, registrarla o
preparare una decisione, senza cancellare la complessità del caso e senza
separare i dati dalla provenienza, dalla riservatezza o dalla responsabilità
professionale.

Si parte dunque dal lavoro, non dall’AI. Cartelle, strumenti deterministici e
documenti devono restare utili anche quando tutti i provider siano spenti.
La scelta modulare permette di aggiungere funzioni solo dove servano, senza
imporre un servizio esterno per rendere utilizzabile il gestionale. Questa
attenzione riguarda anche contesti a risorse limitate, ma non definisce una
soglia hardware verificata. Il progetto intende rimanere aperto e gratuito,
così che altri possano studiarlo, discuterlo e contribuire; hardware e servizi
opzionali di terzi mantengono costi e condizioni propri.

<a id="audience-and-setting"></a>
## A chi si rivolge e in quale lavoro

Il riferimento principale sono i medici della sanità territoriale italiana.
In un’attività interrotta di frequente e condizionata dal tempo disponibile,
occorre recuperare fatti, aggiungere informazioni e preparare il seguito
senza perdere la fonte clinica o confondere il contesto di un paziente con
quello di un altro.

<a id="core-tasks"></a>
## Compiti essenziali

Il lavoro segue tre passaggi: **ritrovare** il paziente e l’informazione che
risponde alla domanda presente; **registrare** fatti strutturati, note,
documenti, terapie, osservazioni e attività pendenti con una provenienza
chiara; **preparare** gli elementi per la decisione del medico. Quest’ultimo
passaggio non significa prescrivere, diagnosticare autonomamente o inventare
un’azione che non abbia riscontro nelle fonti.

Ricerca, tocco, tastiera, controlli strutturati e voce possono essere ingressi
diversi nella stessa funzione. Non occorre che le interfacce siano identiche;
devono invece conservare significato clinico, evidenze, autorità e azioni
consentite.

<a id="platform-roles-in-the-08-line"></a>
## Ruoli delle piattaforme nella linea 0.8

Questi sono i ruoli del disegno di prodotto, non un elenco di applicazioni
complete distribuite. La release sorgente 0.8.6 riguarda il runtime locale e
headless sul Mac, con interfaccia browser localhost; il client nativo segue
un percorso separato.

| Superficie | Ruolo |
| --- | --- |
| iPhone | Recuperare e acquisire informazioni in momenti brevi, anche con una sola mano. |
| iPad | Lavorare sul campo con più contesto, acquisizione strutturata, revisione documentale ed editing più ampio. |
| macOS | Conservare il dato autorevole e governare amministrazione, sicurezza, riconciliazione, backup e flussi complessi. |
| localhost | Offrire sulla postazione principale lo spazio di lavoro completo, con struttura web e modello condiviso delle funzioni. |

iOS e iPadOS condividono un’app universale nel disegno Apple, adattando layout,
multitasking, tastiera, puntatore e densità al dispositivo. macOS adotta le
convenzioni desktop native; localhost quelle del Web. La parità riguarda
funzioni equivalenti e significato clinico entro il ruolo dichiarato, non
l’identità dei pixel. Non ne deriva una qualifica delle app mobili o della
distribuzione nativa della 0.8.6.

<a id="product-voice"></a>
## Come il prodotto parla a chi lo usa

L’interfaccia deve essere calma, precisa e diretta. Le etichette nominano il
fatto clinico o l’azione; quando un contenuto manca, è in caricamento, non è
raggiungibile, è superato, entra in conflitto o viene negato, il messaggio deve
spiegare che cosa sia accaduto e che cosa si possa fare.

Fatti, ipotesi, avvisi, informazioni mancanti e attività pendenti restano
riconoscibili come cose diverse. I testi clinici e di sicurezza non si
riscrivono per un effetto visivo. Le affermazioni pubbliche seguono le prove,
non le intenzioni: partire dal significato di una scelta aiuta a comprenderla,
ma non ne attenua le condizioni.

<a id="current-boundaries"></a>
## Confini di prodotto e stato delle prove

Il funzionamento locale è l’impostazione iniziale: nessun cloud, telemetria o
invio di dati è attivo per default. Il Mac è il nodo autorevole, la
`home-base`; i client mobili vi accedono tramite pairing esplicito e API locale
versionata. Cartella, terminologie, dati di riferimento e flussi deterministici
non dipendono dall’AI. Per lo stato delle singole funzioni prevale la matrice
di parità, letta con le date e le revisioni delle sue evidenze.

La **Intelligence Fabric** è la struttura che coordina strumenti diversi per
esigenze diverse. Già il sorgente 0.8.5 collegava Patient Insight, Smart Import,
Document Synthesis e Treatment Reasoning a quattro percorsi governati
dall’host. Ogni percorso si ferma a una proposta da rivedere e rende visibili
ricevuta, provenienza e validità del contesto, la *currentness*. La presenza
del codice non dimostra da sola distribuzione, funzionamento live o idoneità
clinica.

Quando configurati, Ollama serve i compiti generativi generali e ATHENA su
MLX soltanto Treatment Reasoning. I loro cicli di vita restano separati e
sotto il controllo dell’host. La scelta del modello segue il catalogo e i
controlli di ADR0129: default durevoli e override di richiesta non sono una
configurazione libera. Il chiamante non può scegliere arbitrariamente
provider, modello, endpoint, sede di esecuzione, prompt, fallback o politica
di applicazione. Ricevuta e provenienza non autorizzano una scrittura.

OpenAI e Anthropic mantengono adapter provider v2 e una prova amministrativa
Document Synthesis in sola revisione. La sua attivazione richiede opt-in
esplicito dell’host, riferimento al segreto e politiche di uscita e conservazione
dei dati. Le prove di quel percorso usano trasporti simulati, non attestano
credenziali o rete live. Separatamente, l’integrazione ChatGPT segue il canale
nominato di ADR0134 e l’estensione di ADR0129: configurazione, login, catalogo,
consenso e funzionamento reale restano stati distinti. Non viene dichiarata
una nuova prova live di account/provider consumer sul candidato finale.
Un abbonamento consumer o dell’host non è un’autorizzazione API all’inferenza.
I servizi esterni restano disattivati per default.

**Il percorso documentale** inizia con AnyDoc, prima estrazione automatica
locale degli allegati. Sul Mac Apple Vision elabora soltanto le pagine PDF
supportate contrassegnate `needsOcr`; il risultato resta legato alla fonte,
da rivedere e bloccato in caso di controlli non superati. Immagini dirette e
input non supportati richiedono revisione manuale. La capability Fabric `ocr`
separata resta indisponibile, e le vecchie route OCR autenticate rispondono
`410`. DeepSeek-OCR 2/CUDA conserva, nel perimetro storico 0.8.5, lo stato
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.

**L’accesso senza interfaccia grafica** passa dai servizi applicativi nominati
di MediFlow. Nel percorso locale introdotto con la 0.8.5, un Supervisor Node
fidato avvia Web e MCP come figli separati; MCP usa il canale AIP RPC ereditato
e non accede direttamente a SQLite. Mini aveva allora catalogo tipizzato e
base CLI, senza avvio di produzione dal Supervisor e senza permessi in assenza
di un canale AIP parent. Il raccordo successivo WUL-696 aggiunge quella sessione
Supervisor/Mini: non trasforma però la prova sintetica in una qualifica clinica
completa. Installer, configurazione di host esterni e compatibilità con
qualunque host MCP restano fuori dalle affermazioni di distribuzione.

Il catalogo comprende letture circoscritte, proposta di follow-up, pianificatore
semantico in sola lettura e preview F10 del checkup. F10 scrive soltanto nella
UI Web fidata, dopo nuovi controlli di ruolo, autenticazione rafforzata
(*step-up*), gesto pertinente, validità del contesto, CAS, audit e ricevuta.
L’aggiunta SOAP confermata dal clinico è un’operazione separata, con politica,
prova e ricevuta proprie: l’autorità non passa da una scrittura all’altra.

Su macOS 26 o successivo, il percorso di registrazione visita usa acquisizione
e trascrizione Apple sul dispositivo, consenso esplicito, audio limitato in
RAM e revisione del testo. Non ha uno scrittore clinico automatico. Le prove
con microfono reale e la validazione clinica restano fuori dall’affermazione
storica 0.8.5; qui non vengono promosse alla 0.8.6.

SISS e FSE restano passaggi assistiti documentati: MediFlow non dichiara
sincronizzazione regionale nativa o writeback. Il comportamento mobile offline
è parziale e in sola lettura dove documentato. Le prove Windows e Linux
riguardano portabilità del core e percorsi runtime circoscritti, non app
MediFlow complete. Pubblicazione sorgente e test sintetici non autorizzano
l’impiego clinico: la valutazione del deployment resta in WUL-688 e il
coordinamento generale in WUL-669.

<a id="anti-goals"></a>
## Ciò che MediFlow non deve fare

MediFlow non sostituisce il giudizio o la responsabilità del medico; non
prescrive, non formula diagnosi autonome, non esegue triage e non interpreta
in modo conclusivo le immagini. Non deve nascondere incertezza, provenienza,
conflitti o informazioni mancanti, né richiedere un provider AI per il lavoro
ordinario.

Sono esclusi l’invio silenzioso di dati clinici a un provider cloud e
l’applicazione silenziosa dei risultati del modello alla cartella strutturata.
Non si cerca una copia pixel per pixel fra piattaforme. Certificazioni,
validazione clinica, qualifiche normative e conformità di accessibilità non
si dichiarano senza evidenze specifiche.

<a id="success-criteria"></a>
## Criteri di riuscita

Il progetto riesce nel suo intento quando un medico raggiunge le informazioni
pertinenti con meno passaggi evitabili, continuando a vederne fonte e attualità.
I controlli devono rendere comprensibile il proprio scopo e attivare il servizio
e lo stato documentati; gli adattamenti fra piattaforme devono conservare il
medesimo significato clinico.

L’interfaccia deve restare utilizzabile alle dimensioni e con le impostazioni
di accessibilità supportate. Errori e condizioni degradate devono essere
riconoscibili e permettere un’azione appropriata. I contratti devono potersi
verificare con test sintetici, senza usare dati di pazienti reali.

<a id="085-delivery-and-later-direction"></a>
## Dalla consegna 0.8.5 agli sviluppi successivi

Il sorgente 0.8.5 comprendeva un’implementazione circoscritta della Fabric
per quattro funzioni `proposal_only`. Non attestava un’interfaccia generale
per agenti o disponibilità cloud; i risultati non potevano applicarsi
automaticamente alla cartella. Il modello
provider v2 separa tipo, istanza, autenticazione, modello, capability, gruppi,
binding e allowlist delle funzioni; distingue inoltre modelli locali, chiavi
API, OAuth ufficiale del provider e abbonamenti dell’host. Gli adapter OpenAI
e Anthropic restano `default OFF`: il codice non prova credenziali live,
politiche dell’account, conservazione o disponibilità del servizio.

Un eventuale adapter DeepSeek-OCR 2 può elaborare soltanto pagine `needsOcr`.
Prima della promozione richiede evidenze end-to-end, benchmark sintetico
italiano, soglie dichiarate, provenienza per pagina, hash, segnali di qualità,
ricomposizione che si blocchi se non sicura e prova che i dati rimangano nel
processo locale. La sua assenza non blocca la 0.8.5.

Restano due modalità distinte: un provider può lavorare dentro la Fabric,
sotto il governo di MediFlow; oppure un host intelligente può invocare,
tramite MCP e Supervisor, soltanto i servizi MediFlow nominati. La base Mini
della 0.8.5 e il successivo raccordo WUL-696 vanno letti nelle rispettive
revisioni, non come una promessa di compatibilità universale o autorità
generale dell’agente.

Una scelta più ampia fra logica deterministica, modelli sul dispositivo,
home-base associata e provider esterni ammessi rimane una direzione oltre i
percorsi documentati. Ogni estensione deve essere esplicita, vincolata alle
politiche, osservabile e bloccarsi quando non ne siano soddisfatte le condizioni.
Non esiste un fallback cloud silenzioso. Ogni risultato clinico deve conservare
confini d’identità del paziente, provenienza, incertezza, sede di esecuzione e
revisione del medico.

App Windows e Linux, continuità offline più ampia, configurazione di host
esterni, validazione con microfono reale e flussi conversazionali rimangono
sviluppi successivi o esplorativi finché decisioni e prove separate non ne
consentano la promozione. La release sorgente 0.8.6, pubblicata il 20 settembre
2026, non chiude per questo l’intero programma.
