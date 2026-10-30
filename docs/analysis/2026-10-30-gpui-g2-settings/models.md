# Motore locale, parametri e account ChatGPT nel client Mac

Base `973b19dbe`, 30 ottobre 2026. Consegna parziale delle quattro voci G-2;
nessuna esclusione dal contratto 0.9.1. Il completamento tecnico dei consumer
non sostituisce la prova del client installato o la review indipendente.

## Percorsi aggiunti

Il pannello Modelli e hardware usa la configurazione salvata, l'inventario
Ollama già presente e il servizio Web di ammissione locale. «Aggiorna stato»
legge senza attivare; «Verifica e attiva locale» trasmette soltanto l'intento
fisso e la revisione letta. Il server risolve modello e indirizzo. Dopo il
salvataggio dei modelli viene riletto lo stato senza attivazione automatica.
Il timeout HTTP dedicato è di 70 secondi, a fronte del limite host di 60.
La conferma richiede la rilettura indipendente del risultato. Versione non
ammessa, servizio irraggiungibile e modello non pronto hanno messaggi distinti.
Non cambiano versioni ammesse, attestazione, digest o revoca terminale.
L'annullamento ritira la gestione locale; non promette di annullare un effetto
già concluso dal server.

Funzioni AI offre le modalità Automatica, Rapida, Approfondita e Personalizzata,
i quattro limiti di Patient Insight e le modalità Spento, Osservazione e Attivo
del router documentale. La conferma mostra i valori prima di usare i writer
Web. La bozza resta separata dal valore letto e sopravvive alla navigazione;
il blocco la ritira. Ogni PUT è seguita dalla rilettura della chiave e il
risultato complessivo da una nuova lettura dei tre parametri. Concorrenza
osservata, errore parziale o discordanza impediscono il successo e il reinvio
automatico. Le PUT separate non sono un CAS composto né una transazione.

Nella stessa pagina è presente il controllo account ChatGPT: stato, avvio
esplicito dell'accesso ufficiale, annullamento, verifica, aggiornamento account,
catalogo informativo, finestre di utilizzo e logout. Ogni operazione usa la
route nominata e un corpo vuoto, con stato riletto prima della pubblicazione.
L'URL OAuth ammette solo la destinazione ufficiale già validata dal Web; è
transitorio, consumato all'apertura e ritirato su errore, navigazione e blocco.
Catalogo e quote scompaiono dopo un minuto. Le risposte di operazioni ritirate
non ripubblicano i dettagli. Non sono ricevute email, token o credenziali API.

## File dei modelli: protezione e decisione richiesta

POST `/api/ai/pull` nega sempre con `model_pull_disabled`. Il commit
`312479032` aveva ristretto il proxy ai riferimenti locali; il successivo
`0043f487a` ha rimosso completamente il pull dalla lane locale per chiudere
ulteriori falsificatori della località. L'ADR 0077 conserva il confine di
uscita dati; l'ADR 0136 permette verifica e precaricamento senza download;
l'ADR 0172 conserva esplicitamente il diniego del pull e l'assenza di un writer
di rimozione. Il diniego è una protezione, non una funzione incompleta da
riattivare sul client.

Sono implementati soltanto inventario, stato e istruzione esatta per il modello
consigliato: `ollama pull qwen3.5:35b-a3b`, da eseguire separatamente nel
Terminale dell'host. MediFlow non esegue il comando. Le alternative per il
coordinatore sono:

1. Conservare la gestione dei file negli strumenti Ollama e qualificare il
   percorso nativo di inventario, scelta, istruzione e ammissione. È la
   raccomandazione per questa tranche: conserva il confine attuale, ma non
   chiude implicitamente l'obbligo di gestione nativa dei file nella 0.9.1.
2. Definire prima un servizio host nominato per installazione e rimozione,
   con ADR, catalogo ammesso, integrità e provenienza, spazio, annullamento,
   controllo dell'uscita dati, gestione dei modelli in uso, audit e ricevuta.
   Il client sarebbe soltanto un consumer di quel servizio. Richiede decisione,
   implementazione e qualifica proprie; nessun collegamento diretto alla shell
   o alle API Ollama dal client.

## Autorità e consenso

| Superficie | Autorità riusata e limite |
| --- | --- |
| GET/POST `/api/ai/local-provider/onboarding` | Sessione Web locale della #725; revisione opaca e attestatore host. Nessuna scelta libera nel POST, ammissione clinica o inferenza. |
| GET/PUT `/api/settings/[key]` | Solo `aiInsightMode`, `aiInsightManualConfig`, `documentRouterControlFlow`; writer Web esistente, conferma consumabile una volta e rilettura. |
| GET `/api/settings/ai/chatgpt/status` | Snapshot account locale, senza avvio implicito o inferenza. |
| POST `/api/settings/ai/chatgpt/{login/start,login/cancel,login/complete,read,models,rate-limits,logout}` | Corpo `{}`, sessione e lifecycle Web esistenti; nessun token paired diventa autorità Web. |
| URL di accesso | Gesto esplicito; solo `https://auth.openai.com/oauth/authorize` con state, senza credenziali o frammento. |
| Consenso alle proposte | Nessun nuovo grant o writer. Account, disponibilità, quota e consenso restano distinti. |

Il piano e le finestre Codex dell'account ChatGPT non sono credito API e non
ammettono l'esecuzione delle funzioni. Nessuna modifica all'egress gate, alle
route di generazione, ai claim di cifratura o zero-knowledge, al database o al
contratto `/api/v1`.

## Residui

G-2/chatgpt resta aperta: mancano il consumer nativo della prova DEMO e il
consenso sul contenuto esatto delle proposte ordinarie. Non è presente un
consenso globale sostitutivo. La pagina dichiara il limite. I-5 e I-6 restano
ferme per decisione di Leonardo. Non sono state eseguite chiamate remote,
login reali, generazioni o download di modelli.

Restano da qualificare il percorso completo con host sintetico e finestra
nativa su Mac installato, navigazione da tastiera, VoiceOver, zoom e ritorno
del fuoco nelle nuove superfici. I test del modello di stato non attestano
questa qualifica G-7. Nessuna installazione o ammissione clinica è dichiarata.
La review indipendente del diff finale precede ogni merge.

Implementazione GPT 6.1 Sol, effort xhigh, senza ulteriori collaboratori.

## Prove sintetiche e controlli

Le fixture HTTP usano listener loopback posseduti dal test, con porte casuali
che rifiutano esplicitamente 3000. Non delegano la richiesta a Ollama o a
OpenAI. Coprono il corpo esatto dell'ammissione, la revisione letta, la
rilettura discordante, versione negata, servizio irraggiungibile o non pronto,
salvataggio parziale dei parametri e mancato reinvio, URL OAuth ufficiale,
quote mancanti, logout e blocco. I test GPUI coprono bozza, navigazione,
operazione in corso e ritiro dei dettagli transitori; non sono prove della
finestra installata o dell'intera matrice di accessibilità.

Il primo passaggio completo Rust ha rilevato `WouldBlock` nella lettura della
fixture della ricevuta di ripristino. La nuova regressione riproduce il
fallimento prima della correzione e passa dopo: l'helper imposta il socket in
modalità bloccante prima della lettura HTTP con il timeout esistente di cinque
secondi. Anche il caso originale passa dopo la correzione. Nessuna asserzione,
soglia o protezione del prodotto è stata rimossa.

Il primo `npm run test:unit` ha prodotto 8.936 pass, tre errori e 24 salti:
mancavano le variabili dei tre asset pubblici macOS congelati. Sono state
verificate le copie locali contro tutti gli hash previsti, senza inventare
asset o qualifiche. Il nuovo passaggio completo con Node 24.18.0 e gli input
espliciti ha prodotto **9.066 pass, zero errori e 24 salti**, inclusi i due
gruppi WHO seriali. Il controllo del selettore comprende i nuovi moduli e le
prove contro moduli mancanti o condizionali: **45 pass**; l'inventario è
completo, con 1.340 file di test, 1.296 selezionati e 44 esclusioni già motivate.

Fmt, Clippy workspace/all-targets/locked con `-Dwarnings`, never-regress,
claims e lint passano. Sul Mac è usato `gpui_platform/runtime_shaders`;
l'avviso upstream di compatibilità futura di `block 0.1.6` resta visibile.
Le ultime correzioni a etichette del piano, valore iniziale del router e
ritiro dei dettagli sono verificate anche separatamente. Nessun nuovo skip.

Gli esiti intermedi, i comandi e i log integrali restano in
`~/Antigravity/mf-hillclimb-20261028/gpui-g2-models-973b19dbe/`.
Non sono state aggiunte gallerie o catture al repository. Il disco è stato
controllato durante la lavorazione, sempre sopra la soglia di 25 GiB.
La CI e la review del contributo restano verifiche distinte dalle prove locali.

## Correzioni dei residui della review

Le PUT Web delle chiavi `aiInsightMode`, `aiInsightManualConfig` e
`documentRouterControlFlow` rifiutano ora con HTTP 400 modalità sconosciute,
JSON incompleto o con campi estranei e budget non interi o fuori intervallo.
Il rifiuto precede il writer e l'audit. Il contratto delle modalità e dei
limiti è condiviso con il Web in `lib/insight-parameters-contract.ts`.
Gli archivi esistenti restano leggibili con gli stessi default e clamp:
nessuna migrazione e nessun rifiuto aggiunto alla lettura.

Il comando Rust espone soltanto accessor; modalità e router sono enum chiusi.
Il budget ha campi privati e costruzione validata. Lasciare Funzioni ritira
l'osservazione transitoria ChatGPT e invalida i callback precedenti, conservando
la bozza dei parametri. Il controllo account è disponibile; DEMO, consenso
alle proposte e generazione nativa restano da consegnare. La qualifica della
finestra installata resta da eseguire e documentare nel dossier.

Correzioni GPT 6.1 Sol, effort high, senza collaboratori.
