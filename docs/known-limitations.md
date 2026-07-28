---
summary: "Known limitations and accepted external evidence gaps for the MediFlow 0.8 source candidate."
read_when:
  - "Evaluating MediFlow 0.8 release readiness or accessibility claims."
  - "Preparing public notes, a tag, an App Store claim, or a conformance statement."
---

# Limitazioni note della candidata MediFlow 0.8

Stato documento: `CANONICAL`

Ultimo aggiornamento: 2026-07-29

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
accettata riguarda solo la candidata sorgente GitHub 0.8.

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

La parity è clinico-semantica, non pixel-per-pixel. La matrice corrente registra:

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

Con Node `v24.18.0`, l'audit delle sole dipendenze di produzione non rileva
vulnerabilità. L'audit completo del 29 luglio 2026 rileva 21 rilievi nel
tooling di sviluppo:

- 1 low;
- 5 moderate;
- 15 high;
- zero critical.

Il rischio riguarda la toolchain dei contributor, non il grafo installato in
produzione. Non è classificato come risolto.

Un candidato di aggiornamento portava l'audit a zero, ma forzava versioni
transitive fuori dai range dichiarati e falliva l'installazione
`strict-peer-deps`. La candidata 0.8 non assorbe quel workaround.

La chiusura richiede un packet dipendenze separato con:

1. nessun override fuori range;
2. installazione strict-peer verde;
3. audit completo e production audit;
4. lint, build, test e regressione E2E completi.

## Provider e funzioni future

Ollama è l'unico provider AI operativo. Intelligence Fabric, provider esterni,
Windows/Linux applicativi, voce completa, inbox conversazionale e scaffold
intelligente restano post-0.8 o esplorativi. Non sono funzioni consegnate dalla
candidata.
