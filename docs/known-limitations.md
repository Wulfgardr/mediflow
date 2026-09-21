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
| F6 — OCR selettivo | AnyDoc first-pass e fallback Apple Vision locale sulle sole pagine PDF `needsOcr` | Contratti bounded, fail-closed e percorso sintetico sul Mac eleggibile | DeepSeek-OCR 2/CUDA, benchmark di qualifica e readiness universale | Fallback locale integrato |
| F7 — provider esterni | Provider v2, secret broker, adapter ufficiali e probe amministrativa review-only OpenAI/Anthropic `default OFF` | Transport fake, route admin-only e denial prima della rete | Credenziali, rete live, retention account e runtime readiness cloud | `INTEGRATED / DEFAULT_OFF` |

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
