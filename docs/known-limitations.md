---
summary: "Known limitations and evidence boundaries for MediFlow 0.8.5."
read_when:
  - "Evaluating MediFlow 0.8.5 or its claim ceiling."
  - "Preparing public notes, a tag, an App Store claim, or a conformance statement."
---

# Limitazioni note di MediFlow 0.8.5

Stato documento: `CANONICAL`

Ultimo aggiornamento: 2026-09-03

## Stato ed evidenze

Il tree `0.8.5` definisce il contenuto sorgente della versione. CI remota sulla
stessa SHA, firma, tag, GitHub Release, distribuzione e installazione su un host
esterno sono evidenze di confine: vanno lette nei check e nei receipt del
closeout, non inferite da questo documento statico. Lo storico delle versioni
vive nel [CHANGELOG](../CHANGELOG.md).

## VoiceOver su iPhone e iPad

Gli audit di accessibilità XCTest e i test UI della baseline storica
`0843726fe` sono verdi:

- iPhone: 2/2;
- iPad: 7/7.

Queste prove valgono soltanto per quel tree e non equivalgono a un test
VoiceOver reale. La disponibilità di Xcode è una precondizione della macchina,
non una proprietà persistente del tree; i check Apple su una revisione exact-SHA
appartengono ai receipt del closeout. Questo documento non dichiara una nuova
prova VoiceOver mobile.

Nel simulatore iOS 27, con Xcode 27 beta build `27A5194q`, la chiamata pubblica
`XCUIDevice.shared.voiceOverService.enable()` non ha raggiunto uno stato
terminale. Il runtime ha riavviato in ciclo il servizio assistivo. Il test è
stato interrotto e il risultato incompleto non è usato come prova positiva.

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

## Parity funzionale

La parity è clinico-semantica, non pixel-per-pixel. La baseline pubblicata
registra:

- 30 capability complete;
- 13 capability parziali;
- 23 capability intenzionalmente host-only.

Le capability host-only non sono promesse mobile mancanti. Riflettono autorità,
filesystem, runtime AI, sicurezza o policy del Mac home-base.

## Offline mobile

La continuità offline mobile è parziale e read-only dove documentata. La
visibilità completa di età, TTL e staleness della cache e la riconciliazione
restano lavoro successivo. Non esiste una coda di scrittura offline o un sync
multi-master.

## Tooling di sviluppo

Con Node `v24.18.0`, l'audit delle sole dipendenze di produzione non rilevava
vulnerabilità. L'audit completo del 29 luglio 2026 rilevava 21 rilievi nel
tooling di sviluppo:

- 1 low;
- 5 moderate;
- 15 high;
- zero critical.

Il rischio riguardava la toolchain dei contributor, non il grafo installato in
produzione. Questa evidenza non è stata aggiornata sul candidato `0.8.5` e il
limite non è classificato come risolto.

Un candidato di aggiornamento portava l'audit a zero, ma forzava versioni
transitive fuori dai range dichiarati e falliva l'installazione
`strict-peer-deps`. La release 0.8 non assorbe quel workaround.

La chiusura richiede un packet dipendenze separato con:

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

Tutti hanno disposition `proposal_only`. Le preview rendono visibili receipt,
provenienza e currentness, ma questi dati non sono grant. Nessun percorso
applica diagnosi, terapie o altri dati clinici. Ollama e ATHENA/MLX restano
provider locali capability-specific: non esiste un provider generico, un
fallback silenzioso o una equivalenza tra disponibilità del processo e
readiness clinica.

Il crosswalk corrente è
[`fabric-generative-runtime-crosswalk.v1.json`](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json).
La receipt storica `fabric-product-crosswalk-receipt.v1.json` resta immutabile
con stato `candidate_not_integrated`; non prova lo stato del runtime corrente.

### Precondizione e prova locale ATHENA

Treatment Reasoning può usare ATHENA solo quando il modello e il runner MLX
offline sono già presenti sulla macchina. Il runner deve essere indicato con
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN` come percorso eseguibile assoluto host-owned;
non viene scaricato o predisposto da MediFlow.

Il supporto del runner nel commit `2574cf5fc` ha superato TDD 6/6, typecheck ed
ESLint. Un singolo smoke sintetico sul percorso di produzione con modello BF16
locale ha completato in 10,6 secondi, producendo 64 token e 211 caratteri senza
registrare il raw output. Questa prova non dimostra disponibilità su un'altra
macchina, qualità clinica, stabilità, capacità o readiness universale.

## Estrazione allegati e OCR

AnyDoc resta il primo passaggio automatico locale e non è un provider Fabric.
Per i PDF supportati, il tree materializza e renderizza soltanto le pagine
`needsOcr`, le passa ad Apple Vision locale senza rete e ricompone il risultato
sotto currentness host-owned. Immagini dirette, documenti cifrati, formati
ambigui o motore locale indisponibile falliscono chiusi; le route OCR legacy
rispondono `410`.

DeepSeek-OCR 2/CUDA, benchmark E2E e readiness universale hanno stato
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`. Il crosswalk Fabric conserva `ocr` come
`unavailable`: il fallback Apple Vision appartiene alla composizione AnyDoc,
non a una production root Fabric.

## Esiti di perimetro F6 e F7

| Gate | Implementato | Verificato localmente | Parte non pronta | Esito |
| --- | --- | --- | --- | --- |
| F6 — OCR selettivo | AnyDoc first-pass e fallback Apple Vision locale sulle sole pagine PDF `needsOcr` | Contratti bounded, fail-closed e percorso sintetico sul Mac eleggibile | DeepSeek-OCR 2/CUDA, benchmark di qualifica e readiness universale | Fallback locale integrato |
| F7 — provider esterni | Provider v2, secret broker, adapter ufficiali e probe amministrativa review-only OpenAI/Anthropic `default OFF` | Transport fake, route admin-only e denial prima della rete | Credenziali, rete live, retention account e runtime readiness cloud | `INTEGRATED / DEFAULT_OFF` |

Un account, login o abbonamento consumer OpenAI/Anthropic non fornisce accesso
API. Registry, adapter e probe non autorizzano onboarding, esecuzione, invio di
PHI o uscita dati.

Lo smoke ATHENA è una singola osservazione, non un benchmark di release. Non è
registrato un benchmark per accuratezza OCR, qualità dei provider, latenza o
throughput. I test locali dei contratti non costituiscono un claim di
prestazione e non sostituiscono la suite finale del tree esatto.

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

Questa integrazione resta bounded al runtime locale. Il terminal smoke
standalone e la prova exact-SHA sono receipt di closeout separati dal presente
documento. Installer, onboarding, lifecycle supportato ed esercizio su host
esterni non sono dichiarati consegnati.

## Funzioni fuori scope

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
