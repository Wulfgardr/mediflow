---
summary: "Known limitations and evidence boundaries for MediFlow 0.8.5."
read_when:
  - "Evaluating MediFlow 0.8.5 or its claim ceiling."
  - "Preparing public notes, a tag, an App Store claim, or a conformance statement."
---

# Limitazioni note di MediFlow 0.8.5

Stato documento: `CANONICAL`

Ultimo aggiornamento: 2026-09-04

## Stato ed evidenze

Questa pagina conserva i limiti e le evidenze della versione `0.8.5`, secondo
la data riportata sopra; non trasferisce quelle prove alle versioni successive.
Il tree definisce il contenuto sorgente, ma non dimostra da solo CI remota sulla
stessa SHA, firma, tag, GitHub Release, distribuzione o installazione su un host
esterno. Per questi esiti occorrono i controlli e le ricevute di chiusura
pertinenti. Lo storico delle versioni è nel [CHANGELOG](../CHANGELOG.md).

## Avvio unificato, aggiornamento 15 ottobre 2026

Gli ingressi del sorgente corrente richiedono Node 24 installato; non sono
installer. Linux può richiedere il permesso eseguibile e un file manager che
avvii gli script nel terminale; il comando `install-desktop-entry` aggiunge
un ingresso nel menu. La voce App per Mac richiede un bundle locale costruito
con Xcode per la stessa revisione. Non compila implicitamente l'app nativa.

Le modifiche non committate impediscono la build di produzione e richiedono
la scelta esplicita per sviluppo. Il riuso di un processo richiede la ricevuta
del lanciatore per quella cartella e il fingerprint corretto; un server
avviato manualmente o da un altro ingresso non viene adottato.

L'accesso per agenti richiede un client sul protocollo standard input/output;
la scelta nel browser non crea una sessione clinica autorizzata. La nuova
pagina Avvio non aggiunge una prova di VoiceOver o di doppio clic nei tre
sistemi. La CI del lanciatore Node non sostituisce quelle verifiche manuali.

Preferenze e lock del lanciatore seguono la configurazione utente, distinta
per cartella sorgente. La migrazione automatica sposta soltanto i file esatti
del lanciatore; file sconosciuti e collegamenti restano intatti. Un vecchio
lanciatore ancora attivo deve essere arrestato prima della migrazione.
Su macOS la configurazione è nella sottocartella `launcher` della radice
predefinita di MediFlow. Il primo avvio riconosce quella posizione e le sole
voci di servizio dell'[ADR 0138](./adr/0138-explicit-data-directory-bootstrap.md#emendamento-2026-10).
Backup, residui SQLite e altre voci senza database restano bloccanti.

La build non inizializza PM2 né risolve il percorso del token locale.
La lunghezza dei socket PM2 resta un limite del servizio MLX al suo utilizzo:
un percorso dati lungo può richiedere un percorso locale più corto per MLX.
Questo limite non deve impedire la build né l'uso senza quel servizio opzionale.
I test dei percorsi di configurazione non attestano da soli il doppio clic
reale o l'avvio su Linux. Su Windows la configurazione eredita la ACL del
profilo utente.

## AIFA: controllo remoto nel sorgente successivo alla 0.9.0

Il controllo dei metadati AIFA richiede il consenso Internet dedicato e
l'apertura di Repertori o delle relative impostazioni. Non è un servizio
continuo: senza aperture non controlla; un errore o un arresto durante HEAD
può rinviare il tentativo successivo fino a 24 ore. ETag e Last-Modified sono
dichiarazioni del server, non prove di autenticità. Senza validatori locali
non si può attestare l'assenza di variazioni. L'applicazione è sempre esplicita.
Le prove sintetiche non attestano l'acquisizione dell'intero feed live.

Il feed confezioni_fornitura ha copertura parziale: non vengono conservati
FORNITURA e STATO_AMMINISTRATIVO; fascia e prezzo sono assenti dalla fonte
corrente. Il catalogo non certifica disponibilità, rimborsabilità o appropriatezza.
La conferma di una riduzione sotto il 90% richiede un nuovo download e vale
solo per lo stesso file e lo stesso catalogo locale. L'audit transazionale
copre le sostituzioni AIFA, non la pulizia o il caricamento legacy. Questi
ultimi condividono comunque l'esclusione con verifica e importazioni AIFA;
il conflitto restituisce 409. L'esclusione è per processo, non tra più processi;
il download remoto conserva anche il controllo dello snapshot in transazione.

## VoiceOver su iPhone e iPad

Gli audit di accessibilità XCTest e i test UI della baseline storica
`0843726fe` sono verdi:

- iPhone: 2/2;
- iPad: 7/7.

L'esito vale soltanto per quel tree e non equivale a una prova reale di
VoiceOver. Anche la disponibilità di Xcode va verificata sulla macchina: non
rimane attestata dal solo contenuto del tree. I controlli Apple sulla revisione
esatta appartengono alle relative ricevute di chiusura; questa pagina non
aggiunge una nuova prova VoiceOver mobile.

La prova sul simulatore iOS 27, con Xcode 27 beta build `27A5194q`, non si è
conclusa: la chiamata pubblica `XCUIDevice.shared.voiceOverService.enable()`
non ha raggiunto uno stato terminale e il runtime ha continuato a riavviare il
servizio assistivo. Il test è stato interrotto; un risultato incompleto non
viene considerato positivo.

Apple documenta il problema `173507341` nelle note di Xcode 27 beta. La deroga
accettata riguardava la release sorgente GitHub `0.8.2`. La `0.8.5`
non aggiunge una nuova prova VoiceOver mobile.

### Cosa si può dichiarare

- audit XCTest e test UI verdi sul simulatore per la baseline `0843726fe`;
- layout AX5 verificato sulla stessa baseline;
- VoiceOver manuale macOS eseguito sulla stessa baseline;
- limite mobile esterno ancora aperto.

### Cosa non si può dichiarare

- VoiceOver verificato su iPhone o iPad;
- piena conformità accessibilità;
- prova su device fisico;
- conformità WCAG delle app native;
- idoneità App Store, certificazione o conformance.

### Chiusura futura

Il limite si chiude solo con uno dei seguenti esiti terminali:

1. una versione Xcode che risolve il problema e completa il test pubblico su
   iPhone e iPad;
2. test VoiceOver completati su due device fisici eleggibili.

<a id="parity-funzionale"></a>

## Equivalenza funzionale

La parità riguarda il significato clinico e le operazioni disponibili, non
l'identità dei pixel. Nella baseline pubblicata a cui si riferisce questa
pagina risultano:

- 30 capability complete;
- 13 capability parziali;
- 23 capability intenzionalmente host-only.

Le funzionalità riservate all'host non rappresentano promesse mobile non
mantenute: rimangono sul Mac home-base perché dipendono dalla sua autorità,
dal filesystem, dal runtime AI, dalla sicurezza o dalle policy.

## Offline mobile

Nella baseline descritta, la continuità offline mobile è parziale e consente
soltanto la lettura dove documentata. La piena visibilità dell'età della cache,
del TTL e della sua eventuale obsolescenza, insieme alla riconciliazione,
rimaneva lavoro successivo. Non sono presenti una coda di scrittura offline
né una sincronizzazione multi-master.

<a id="tooling-di-sviluppo"></a>

## Strumenti di sviluppo

La fotografia del 29 luglio 2026, eseguita con Node `v24.18.0`, non rilevava
vulnerabilità nelle sole dipendenze di produzione e rilevava 21 rilievi
nell'audit completo del tooling di sviluppo:

- 1 low;
- 5 moderate;
- 15 high;
- zero critical.

I conteggi fotografano quell'audit, non il grafo delle dipendenze delle
revisioni successive. Il 4 settembre 2026, un audit delle sole dipendenze di
produzione con Node `v24.19.0` ha individuato
`GHSA-px8p-9vwx-vf98` in `fflate@0.8.2`, dipendenza transitiva di
`jspdf@4.2.1`. Il candidato descritto risolve quella sola relazione di dipendenza a `fflate@0.8.3`,
versione corretta dentro il range `^0.8.1` già dichiarato da jsPDF. Il lockfile,
l'albero installato, la generazione PDF reale e una regressione ZIP64 bounded
confermano la correzione; l'endpoint npm audit non ha restituito il rollup
post-fix per timeout, quindi questo documento non dichiara un audit corrente a
zero.

Un candidato di aggiornamento portava l'audit a zero, ma forzava versioni
transitive fuori dai range dichiarati e falliva l'installazione
`strict-peer-deps`. La release 0.8 non assorbe quel workaround.

Il debito più ampio è tracciato in
[issue #305](https://github.com/Wulfgardr/mediflow/issues/305). La sua chiusura
richiede un packet dipendenze separato con:

1. nessun override fuori range;
2. installazione strict-peer verde;
3. audit completo e production audit;
4. lint, build, test e regressione E2E completi.

## Intelligence Fabric e apply clinico

La 0.8.5 collega quattro percorsi generativi al Fabric:

- `patient_insight`;
- `smart_import`;
- `document_synthesis`;
- `treatment_reasoning`.

Tutti producono proposte con disposition `proposal_only`. Le anteprime
mostrano ricevuta, provenienza e validità del contesto al momento dell'uso,
ma queste informazioni non concedono autorità. Nessuno dei percorsi applica
diagnosi, terapie o altri dati clinici. Ollama e ATHENA/MLX sono provider locali
assegnati a funzioni specifiche: non vi sono un provider generico o un ripiego
silenzioso, e trovare un processo disponibile non equivale a dimostrarne la
prontezza per l'uso clinico.

Il raccordo con il runtime è descritto in
[`fabric-generative-runtime-crosswalk.v1.json`](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json).
La receipt storica `fabric-product-crosswalk-receipt.v1.json` resta immutabile
con stato `candidate_not_integrated`; non prova lo stato del runtime corrente.

### Precondizione e prova locale ATHENA

La possibilità di usare ATHENA dipende dalla macchina, non dalla sola presenza
del codice di Treatment Reasoning: modello e runner MLX offline devono essere
già disponibili. Il runner deve essere indicato mediante
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN`, con un percorso eseguibile assoluto sotto
il controllo dell'host; MediFlow non lo scarica né lo predispone.

Il supporto del runner nel commit `2574cf5fc` ha superato TDD 6/6, typecheck ed
ESLint. Un singolo smoke sintetico sul percorso di produzione con modello BF16
locale ha completato in 10,6 secondi, producendo 64 token e 211 caratteri senza
registrare il raw output. Questa prova non dimostra disponibilità su un'altra
macchina, qualità clinica, stabilità, capacità o readiness universale.

## Estrazione allegati e OCR

AnyDoc esegue il primo passaggio automatico locale e non è un provider Fabric.
Per i PDF supportati, il tree prepara e renderizza soltanto le pagine
`needsOcr`, le invia ad Apple Vision locale senza rete e ricompone il risultato
sotto il controllo dell'host sulla validità del contesto. Immagini dirette,
documenti cifrati, formati ambigui o assenza del motore locale interrompono il
percorso senza ripieghi; le route OCR legacy rispondono `410`.

DeepSeek-OCR 2/CUDA, benchmark E2E e readiness universale hanno stato
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`. Il crosswalk Fabric conserva `ocr` come
`unavailable`: il fallback Apple Vision appartiene alla composizione AnyDoc,
non a una production root Fabric.

## Esiti di perimetro F6 e F7

| Gate | Implementato | Verificato localmente | Parte non pronta | Esito |
| --- | --- | --- | --- | --- |
| F6: OCR selettivo | AnyDoc first-pass e fallback Apple Vision locale sulle sole pagine PDF `needsOcr` | Contratti bounded, fail-closed e percorso sintetico sul Mac eleggibile | DeepSeek-OCR 2/CUDA, benchmark di qualifica e readiness universale | Fallback locale integrato |
| F7: provider esterni | Provider v2, secret broker, adapter ufficiali e probe amministrativa review-only OpenAI/Anthropic `default OFF` | Transport fake, route admin-only e denial prima della rete | Credenziali, rete live, retention account e runtime readiness cloud | `INTEGRATED / DEFAULT_OFF` |

Un account, un login o un abbonamento consumer OpenAI/Anthropic non forniscono
accesso alle API. Allo stesso modo, la presenza di registry, adapter e probe
non autorizza configurazione iniziale, esecuzione, invio di PHI o uscita dei
dati.

Lo smoke ATHENA misura una singola osservazione, non le prestazioni della
release. Non è registrato un benchmark per accuratezza OCR, qualità dei
provider, latenza o throughput. I test locali dei contratti non consentono
quindi di dichiarare prestazioni e non sostituiscono la suite finale sulla
revisione esatta.

## Headless, MCP e Mini

Il Supervisor Node portabile avvia Web standalone e MCP come processi figli
distinti e autenticati su IPC ereditato. MCP `stdio` espone catalogo,
terminology search, Open Loops patient-scoped, proposta follow-up
`proposal_only` e query semantica bounded read-only. Mini condivide catalogo e
foundation CLI ma non ha binding production al Supervisor e fallisce chiuso
senza parent AIP. Contesto, lease, revoca e audit restano host-owned; gli
adapter non importano SQLite, non accettano authority caller-supplied e non
aprono listener.

F10 espone via MCP soltanto la preview `pending -> completed|cancelled`. Il
commit appartiene alla UI Web trusted, che rilegge la risorsa e richiede ruolo
medico attivo, step-up e gesto specifico; CAS, idempotenza, audit e receipt
restano atomici. Proof e commit non attraversano MCP. Il planner è collegato al
Supervisor ma resta read-only, con al massimo due operazioni allowlisted e
senza SQL libero.

L'integrazione rimane delimitata al runtime locale. Lo smoke standalone
concluso e la prova sulla SHA esatta devono risultare dalle ricevute di
chiusura, non da questa pagina. Non sono dichiarati consegnati installer,
configurazione iniziale, ciclo di vita supportato o esercizio su host esterni.

<a id="funzioni-fuori-scope"></a>

## Funzioni escluse dal perimetro

La `0.8.5` non consegna:

- DeepSeek-OCR 2/CUDA, benchmark OCR o readiness universale, con stato
  `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`;
- credenziali o rete live OpenAI/Anthropic, runtime readiness cloud o consenso
  implicito di invio esterno;
- installer, onboarding o validazione su host esterni per MCP/Mini;
- authority agentica generale o commit checkup eseguito da MCP;
- smoke con microfono reale, validazione clinica o writer automatico della
  registrazione Apple on-device disponibile su macOS 26 o successivo;
- operazioni planner ulteriori, accesso SQL diretto o scritture;
- invocazione AI dai client paired;
- app complete Windows o Linux.

## Materiali storici

Il whitepaper, gli strumenti del gemello 0.8.6, sei verbali di luglio, quattro
proposte superate e gli originali PNG 0.8 sono conservati nello storico Git
e nel [tag v0.9.0](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/docs/markdown-index.md).
Non sono inclusi nell’albero corrente. Restano le immagini ottimizzate e il
manifest con hash, dimensioni e collegamenti agli originali. Le prove
storiche non attestano il funzionamento della versione corrente.


## Fonti personali protesica

Verifica e ripristino web del backup completo non usano la clonazione del proxy
Next limitata al singolo upload. Il caso riguarda anche gli allegati paziente,
non solo i 100 MiB ammessi per gli originali protesici. Export e lettura JSON
richiedono comunque memoria proporzionale al backup; non è garantita una
dimensione arbitraria. I test HTTP dedicati richiedono un server sintetico
isolato e un ambiente che consenta un listener loopback.

Su macOS e Linux il bootstrap normalizza a `0600` soltanto i file SQLite
regolari dell'utente corrente. Non corregge file non propri, symlink o i permessi
di una cartella dati personalizzata; l'apertura di file non sicuri resta
bloccata. Non è una verifica degli ACL Windows né una cifratura del database.
La correzione avviene per percorso, senza aprire i file, cosi' non rilascia i
lock delle connessioni SQLite attive; un file sostituito durante la correzione
viene rifiutato.

- Import diretto XLSX non disponibile: esportare in CSV UTF-8, con virgola o punto e virgola e mappatura esplicita.
- Nessuna estrazione AI, attestazione normativa o aggiornamento clinico automatico.
- Fonti derivate da nome/versione/ambito; una versione differente crea una fonte distinta. La migrazione non recupera collisioni già avvenute nelle versioni precedenti.
- Originali aggiuntivi nel database locale, in chiaro, fino a 25 MiB ciascuno e 100 MiB totali (massimo 1.000). Nessuna cancellazione o sostituzione dalla UI.
- Snapshot di provenienza in chiaro e additivo nei DTO web/network; nessuna provenienza automatica per prescrizioni esistenti. Il client Apple attuale ignora lo snapshot di provenienza: non lo visualizza e non offre la gestione delle fonti.
- Il collegamento all’originale richiede una sessione web autenticata e scarica il documento; non è un visualizzatore integrato. Il riferimento a pagina è dichiarato dall’operatore e non validato contro il contenuto.

## Catalogo ICD-11 incorporato (2026-10)

La ricerca tabellare MMS 2026-01 usa il bundle WHO ufficiale incluso, verificato
e importato al primo uso senza Docker, rete o credenziali: 35.664 categorie
con codice. Un bundle assente, alterato o disabilitato non viene attivato.

Copertura: solo categorie con codice e titoli inglesi SimpleTabulation, senza
sinonimi, traduzione italiana o postcoordinazione dell'API. Il parser supporta
tab-separated UTF-8 in ZIP, rifiuta XLSX e intestazioni non riconosciute. Lo schema
dell'archivio reale è verificato, comprese le note multilinea. Le combinazioni
postcoordinate non vengono verificate dal catalogo tabellare. Dati WHO CC BY-ND
3.0 IGO, non MIT; nessuna garanzia clinica deriva dalla presenza di un codice.

L'estrazione ZIP rifiuta una tabulazione che produca più di 64 MiB o più byte
di quelli dichiarati nell'archivio; richiede dimensione esatta e CRC completo.
La decompressione è sincrona e limitata a blocchi, senza un timer dedicato.

Il catalogo pubblico usa un DB dedicato e conserva l'archivio originale e una
versione precedente ripristinabile. Il backup clinico non lo include. Il contratto
incorporato delle route web WHO è additivo. Le route v1 paired conservano il
contratto sidecar precedente, senza impatto OpenAPI; i client Apple non sono
ancora qualificati per il catalogo incorporato. Il sidecar esistente e Setup_WHO restano opzionali.
