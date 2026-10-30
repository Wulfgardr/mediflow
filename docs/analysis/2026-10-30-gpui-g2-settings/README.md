# Impostazioni native G-2

Base: `6c99ff83c8d96b2cfce63fc79b87023e4345d62d`, main aggiornato il 30 ottobre 2026.
Il confronto usa il censimento G-0, sezione Impostazioni, e le pagine Web della stessa revisione. Nessun rinvio equivale a completamento nativo.

## Lacune iniziali, nell'ordine di intervento

| Unità | Funzioni ancora mancanti alla base |
| --- | --- |
| G-2a, P38 | Pagina Accesso, cambio passphrase con preparazione, conservazione separata di kit e chiave, conferma e ritiro delle sessioni. Adozione passphrase e cambio PIN per archivi legacy non supportati dall'accesso GPUI. |
| G-2a, sessione | Dati della sessione corrente e blocco dalla pagina Accesso. Il Web non offre qui un elenco di sessioni o dispositivi revocabili. |
| G-2d, P44/P50 | Inventario Ollama effettivo, selezione dei due ruoli, profili hardware, connessione e salvataggio. Le preferenze opache per funzione esistono già. Download/rimozione vanno riconciliati con il contratto attuale: POST `/api/ai/pull` nega sempre il download; la pagina Web indica il Terminale, non offre rimozione. |
| G-2d, P51 | Quattro interruttori già presenti; mancano configurazione dettagliata Insight e controllo del router documentale, ammissione locale, account ChatGPT, quote e consensi. Disponibilità del modello e abilitazione di una funzione devono restare distinte. |
| G-2e, P64/P65/P66 | Registro Fabric, capability, sedi e uscita dati, governance, parliament e readiness. |
| G-2b, P41/P42 | Tema, scala, contrasto, privacy e persistenza già presenti; raccordo e qualifica delle preferenze OS restano aperti. |
| G-2c, P28/P55 | Gestione sedi già presente nella base aggiornata. Non ricontata come contributo di questa PR; clear/delete e manutenzione appartengono a G-3d. |
| G-2a, P40 | Profilo account già presente; profilo di lavoro completo da confrontare con `/settings/profilo`. |
| G-2f, P35/P49 | Amministrazione AIFA, esenzioni, protesica e WHO, import/aggiornamento/clear, fonti e freschezza. |
| G-2g, P30/P47/P48/P53/P60 | Compliance, diagnostica, servizi/revisione/aggiornamenti, audit e health redazione. Seeder e comandi distruttivi restano G-3d. |

## Confini

Solo archivio sintetico e route Web esistenti, con sessione loopback della #725. Nessun writer o endpoint generico nuovo. Nessuna modifica dei claim di cifratura. La review indipendente su autenticazione e credenziali segue questa implementazione; la PR non va unita prima di quella review.

## Delta consegnato

Accesso dispone di sessione corrente, blocco e cambio passphrase con kit e
chiave r1 separati. La nuova credenziale è attivabile soltanto dopo salvataggio
verificato del file e conferma della conservazione su carta. Il file è creato
senza sovrascrivere destinazioni esistenti. Kit, chiave, campi e autorità sono
ritirati al blocco; una copia già ammessa può terminare dopo il blocco, come
indicato nell'interfaccia. Dopo l'invio, anche una risposta persa blocca le
copie locali della sessione e impedisce di reinviare la richiesta preparata.
Non viene dichiarato successo senza la risposta positiva del writer Web.

Modelli e hardware dispone di lettura delle impostazioni salvate, inventario
Ollama, scelta dei due ruoli anche dall'elenco, endpoint loopback e tre profili
hardware come nel Web. Profilo e scelta restano una bozza fino alla soglia di
conferma. La rilettura finale verifica tutte le sette impostazioni scritte.
Una modifica concorrente osservata prima dell'invio lo interrompe. La bozza
sopravvive a navigazione, errore e rilettura; il blocco la ritira. Un esito
parziale non è successo e non causa un reinvio automatico. Il confronto prima
delle PUT non è un CAS e non elimina l'intervallo di concorrenza del Web.

Stato delle funzioni, disponibilità nell'inventario, preferenze opache per
funzione e ammissione di un provider restano distinti. Non sono stati eseguiti
download, inferenze, invii a provider o accessi ad archivi clinici.

## Superfici toccate, da sottoporre alla review indipendente

| Consumer nativo | Route e proprietario dell'effetto |
| --- | --- |
| Cambio passphrase | GET `/api/auth/check`; POST `/api/auth/passphrase/change`; servizio Web `changePassphrase`, CAS credenziali, audit e ritiro sessioni esistenti |
| Preparazione del kit | Compatibilità con `unlock-credential.ts`: PBKDF2 v3, HKDF e involucro AES-GCM esistenti; chiave di sessione temporanea protetta da zeroize, nessuna nuova autorità |
| Custodia locale | Campi password, comando legato alla sessione locale e consumabile una volta, ritiro dei callback, avviso di ritiro; picker e creazione privata senza sovrascrittura per il kit |
| Inventario modelli | GET `/api/ai/models`, header `x-target-url` solo loopback; cookie Web locale della #725, nessuna chiamata diretta a Ollama dal client |
| Configurazione modelli | GET/PUT `/api/settings/[key]`: `hardwareProfile`, `aiProvider`, `aiModel_clinical`, `aiModel_reasoning`, `aiModel`, `aiUrl`, `ollamaUrl`; lettura del marker `aiModelDefaultVersion`, senza migrazione implicita |

Nessuna route, permesso, writer server, schema SQLite o contratto `/api/v1`
modificato. L'attestazione dell'ingresso resta quella della #725. I token paired
non diventano sessioni Web e non ricevono nuove capacità. Non è aggiunto alcun
claim su cifratura o zero-knowledge. Implementazione GPT 6.1 Sol, effort xhigh,
senza collaboratori aggiuntivi; nessuna review indipendente già eseguita.

## Residui e proposte di esclusione da approvare

G-2 resta aperta. Le proposte sotto non sono approvate e nessuna voce è contata
come completata. Dove manca il consumer nativo, questo è dichiarato come
implementazione mancante, non come impossibilità del servizio Web.

| Voce | Perché non è chiusa | Proposta esplicita per la decisione di perimetro |
| --- | --- | --- |
| P38, PIN legacy, adozione e recupero all'accesso | Il bootstrap GPUI ammette solo sblocco v3. La pagina nuova cambia una passphrase esistente; non introduce una seconda via di bootstrap per archivi legacy o kit. | Escludere da G-2 U0 gli archivi ancora sbloccati con PIN e il recupero prima dell'accesso, soltanto con approvazione esplicita e aggiornamento del raccordo G-1b. In assenza di approvazione restano requisiti aperti. |
| P50, download e rimozione | Il Web della base nega sempre POST `/api/ai/pull` e non offre rimozione dalla pagina Modelli. Un rinvio al Terminale non è una funzione nativa. | Riconciliare G-0 con il Web attuale: nessun download/rimozione HTTP da abilitare in questa tranche. Se la release richiede gestione nativa dei file modello, escluderla esplicitamente oppure definire prima un servizio host autorizzato. |
| P44/P50, verifica e ammissione del provider locale | La pagina configura e legge l'inventario, ma non collega il workflow `/api/ai/local-provider/onboarding`. La presenza del modello non dimostra ammissione o prontezza. | Escludere la verifica/attivazione nativa locale da questa consegna soltanto con decisione esplicita. Il requisito rimane aperto; non si propone di dedurlo dall'inventario. |
| P51, parametri Insight e router documentale | Quattro interruttori e preferenze per funzione esistono; mancano i consumer nativi dei parametri avanzati del Web. Nessun impedimento server è dimostrato. | Escludere esplicitamente i parametri avanzati dalla parità U0, oppure mantenere aperta G-2d. La seconda scelta conserva il contratto vigente. |
| Account ChatGPT, quote, login e consensi | Il consumer GPUI delle route nominate di account non è implementato. Una configurazione locale non conferisce consenso o accesso OpenAI; il browser esterno non sostituisce il percorso nativo. | Escludere esplicitamente la gestione nativa dell'account ChatGPT da G-2 U0, oppure mantenere aperta G-2d. Nessuna esclusione è implicita in questa PR. |
| P64/P65/P66, Fabric e governance | Mancano le viste native del registro, delle sedi, dell'uscita dati, di parliament e readiness; i servizi Web esistono. Lo stato AI precedente non è un sostituto. | Escludere nominalmente G-2e da U0 con emendamento approvato, oppure mantenerla aperta. Nessuna chiusura per assenza della pagina. |
| P40, profilo di lavoro completo | La PR conserva il profilo account esistente, ma non migra il percorso completo `/api/onboarding/work-profile`. | Escludere dal perimetro U0 soltanto il profilo di lavoro aggiuntivo, oppure mantenere aperta questa parte G-2a. |
| P41/P42, preferenze OS | Le scelte locali persistenti già presenti restano; non sono aggiunti né qualificati i raccordi a testo, contrasto, movimento e trasparenza macOS. | Escludere i quattro raccordi OS soltanto con decisione nominata G-2b/G-8c, oppure mantenere aperti AX-3 e la qualifica. |
| P35/P49, repertori amministrativi | Mancano consumer nativi per import/aggiornamento/clear AIFA, esenzioni, protesica e WHO. I lookup esistenti non equivalgono ad amministrazione. | Escludere nominalmente G-2f da U0 con emendamento, oppure mantenerla aperta. Le azioni distruttive restano anche soggette a G-3d. |
| P30/P47/P48/P53/P60, compliance, diagnostica e sviluppo | Mancano le pagine native e il collegamento ai servizi Web di audit, health e revisione. Nessun blocco server è dimostrato; distruttive e seeder non sono migrati qui. | Escludere nominalmente le superfici G-2g ancora assenti, oppure mantenerle aperte. G-9 e G-3d non sono chiusi da questa proposta. |

Questa PR è una consegna parziale revisionabile, non l'accettazione della riga
G-2 del contratto 0.9.1. La scelta conservativa è mantenere aperti i residui
implementabili, invece di approvare una riduzione tacita del requisito.

## Evidenze e limiti delle prove

Le catture usano finestre e renderer GPUI reali su macOS, con stato sintetico
predisposto in una copia esterna temporanea del sorgente. Quattro esempi sono
nel [manifest con hash](captures.json): [Accesso Grafite](grafite-390-access.png),
[soglia Grafite](grafite-390-review.png), [modelli Giorno](giorno-1200-models.png)
e [modelli Grafite](grafite-390-models.png). La serie completa comprende dodici
immagini, Giorno/Grafite e 1200/390 punti; resta fuori dalla repository.
Non prova picker, VoiceOver, collegamento a un'installazione reale o tutta la
matrice G-7. Il codice temporaneo di predisposizione non è nell'app consegnata.

Le prove HTTP sintetiche verificano cookie/control Web distinti dai token
paired, route esatta di rotazione, assenza delle passphrase nel payload,
verificatore corrente, apertura della nuova chiave, conflitto tra preparazione
e conferma, errore parziale e mancata conferma con rilettura discordante.
Blocco, kit non salvato o chiave non confermata impediscono l'attivazione dalla
UI; la pagina reale crea una sola soglia e i callback ritirati non la riaprono.
Il vettore di recupero è prodotto indipendentemente con Node 24 e confrontato
in Rust per chiave stampabile, HKDF, verificatore e involucro AES-GCM.
Nessun modello è scaricato per le prove: l'inventario usa una fixture da 1 KiB.

Errori intermedi conservati nelle evidenze esterne: primo controllo del
selettore avviato prima del riordino rustfmt dei moduli; inventario che aveva
incluso un file senza test tra i test selezionati; un prestito mancante e una
clonazione non disponibile durante la prima compilazione; contesto di lettura
errato in una prova GPUI; selettore geometrico del pulsante non esposto dal
componente condiviso. Corretti senza togliere le asserzioni di comportamento.
Il primo giro unitario manca dei tre asset pubblici macOS obbligatori: trovate
copie locali con hash identici ai pin e configurate nelle prove successive.
Nessun guard, soglia o test è stato disabilitato.
