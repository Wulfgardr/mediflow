---
summary: "Known limitations and evidence gaps for the MediFlow 0.8.5 local source candidate."
read_when:
  - "Evaluating the MediFlow 0.8.5 local source candidate or its claim ceiling."
  - "Preparing public notes, a tag, an App Store claim, or a conformance statement."
---

# Limitazioni note del candidato sorgente locale MediFlow 0.8.5

Stato documento: `CANONICAL`

Ultimo aggiornamento: 2026-09-01

## Stato del candidato

Il tree locale usa la versione `0.8.5`, ma non costituisce una release. Non
esistono ancora prove di CI remota sulla stessa SHA, tag, GitHub Release,
distribuzione o installazione su un host esterno. Il claim massimo resta
**candidato sorgente locale**. La release sorgente `0.8.2` conserva il proprio
storico separato nel [CHANGELOG](../CHANGELOG.md).

## VoiceOver su iPhone e iPad

Gli audit di accessibilità XCTest e i test UI sono verdi:

- iPhone: 2/2;
- iPad: 7/7.

Queste prove non equivalgono a un test VoiceOver reale.

Nel simulatore iOS 27, con Xcode 27 beta build `27A5194q`, la chiamata pubblica
`XCUIDevice.shared.voiceOverService.enable()` non ha raggiunto uno stato
terminale. Il runtime ha riavviato in ciclo il servizio assistivo. Il test è
stato interrotto e il risultato incompleto non è usato come prova positiva.

Apple documenta il problema `173507341` nelle note di Xcode 27 beta. La deroga
accettata riguardava la release sorgente GitHub `0.8.2`. Il candidato `0.8.5`
non aggiunge una nuova prova VoiceOver mobile.

### Cosa si può dichiarare

- audit XCTest e test UI verdi sul simulatore;
- layout AX5 verificato;
- VoiceOver manuale macOS eseguito;
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
- 21 capability intenzionalmente host-only.

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

Il candidato locale collega quattro percorsi generativi al Fabric:

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

AnyDoc è l'unica estrazione automatica locale degli allegati supportati. AnyDoc
non è OCR e non è un provider Fabric. Immagini, PDF scansionati senza text
layer, documenti cifrati e formati non supportati falliscono chiusi come
`review_required/unsupported_local_extraction` e richiedono revisione manuale.

Nel tree corrente la capability `ocr` è `unavailable` e le route OCR legacy
rispondono `410`. Il candidato non include un percorso OCR eseguibile.

## Esiti di perimetro F6 e F7

| Gate | Implementato | Verificato localmente | Parte non pronta | Esito |
| --- | --- | --- | --- | --- |
| F6 — OCR selettivo | AnyDoc elabora i documenti con testo estraibile; immagini e scansioni falliscono chiuse a revisione manuale; `ocr=unavailable`; route legacy `410` | Guard AnyDoc local-only, crosswalk corrente e contratti di retirement OCR | DeepSeek-OCR 2 selettivo sulle pagine `needsOcr`, provenance/hash/quality per pagina, benchmark sintetico italiano con soglie ed E2E non sono implementati o verificati | `RELEASE_SCOPE_EXCLUDED` |
| F7 — provider esterni | Ollama e ATHENA/MLX sono i soli provider effettivi, dove configurati e per le capability assegnate; OpenAI e Anthropic compaiono solo nel registro e nella UI informativa | Test di disclosure, stato Fabric e proiezione UI read-only con fixture sintetiche | Esecuzione cloud, configurazione credenziali, probe, egress e contratto completo type/instance/auth/model/capabilities/groups/bindings/allowlist/credential classes non sono inclusi | `RELEASE_SCOPE_EXCLUDED` |

Un account, login o abbonamento consumer OpenAI/Anthropic non fornisce accesso
API. Le righe informative non autorizzano onboarding, esecuzione, invio di PHI
o uscita dati.

Lo smoke ATHENA è una singola osservazione, non un benchmark di release. Non è
registrato un benchmark per accuratezza OCR, qualità dei provider, latenza o
throughput. I test locali dei contratti non costituiscono un claim di
prestazione e non sostituiscono la suite finale del tree esatto.

## Headless e SOAP

Il piano Headless classifica 66 anchor con esiti terminali. Le 32 route `GET`
network osservate sono evidence candidate e non diventano operazioni o grant.
Le operazioni Headless generali eseguibili restano zero.

La sola eccezione stretta è la append SOAP locale server-side H1-H10. Richiede
una sessione physician active-role, currentness, revisione clinica, gesto e
step-up monouso, CAS, audit e receipt. Non apre un trasporto agentico e non
autorizza Mini, apply generale o authority Fabric.

## Funzioni fuori scope

Il candidato `0.8.5` non consegna:

- DeepSeek-OCR 2, benchmark OCR o fallback automatico per immagini e scansioni;
- esecuzione o configurazione credenziali OpenAI/Anthropic, provider cloud,
  egress o consenso di invio esterno;
- server, adapter operativo, installer o onboarding MCP;
- registrazione o trascrizione della visita;
- semantic query planner o accesso SQL diretto;
- invocazione AI dai client paired;
- app complete Windows o Linux.
