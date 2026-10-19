# ADR 0151 — Contratti del profilo e topologia Node/Swift (BT-07)

- Stato: Accepted con l'integrazione protetta, dopo review indipendente e WUL-579/585
- Data: 2026-10-19
- Riferimenti: WUL-580; ADR 0146–0149; ADR 0150; ADR 0145

## Contesto e decisione

Il pilota ha definito tre contratti consumati dal servizio Node, dalla UI Web
e dalle superfici Headless. Tenerne la definizione sotto `lib` costringe AIP e
MCP a un'eccezione di import verso l'host. La separazione utile è quella tra
contratto dei messaggi e proprietario dell'autorizzazione e degli effetti.

`packages/patient-profile-contracts` contiene le tre definizioni già usate:

| Modulo | Responsabilità conservata |
| --- | --- |
| `src/query.ts` | Richiesta scoped, proiezione, vista, currentness e budget UTF-8. |
| `src/review.ts` | Input e vista della revisione senza effetti, identificativo di policy e limiti. |
| `src/notes-commit.ts` | Input, vista, ricevuta ed esatto involucro metadata del journal delle note. |

I parser, le costanti e i tipi sono trasferiti senza cambiare il comportamento.
Il solo import interno delle note punta a `review.ts`. I consumatori importano
la definizione unica nel pacchetto; i vecchi moduli sotto `lib` vengono rimossi.
Non rimangono copie o parser alternativi che possano produrre risultati diversi.

Il pacchetto privato espone sorgenti TypeScript eseguibili con Node 24 e non ha
dipendenze runtime. Next continua a compilarli nel percorso esistente. Non si
introducono un processo, un bridge, una distribuzione npm o un protocollo nuovi.
La conformità riguarda i messaggi già provati; il nome di una policy o un oggetto
che passa il parser non costituiscono mai una prova di autorità.

## Proprietari che rimangono nell'host

Il servizio applicativo Node continua a risolvere sessione, ruolo, ambito e
attualità, interrogare gli owner reali della selezione e della revisione,
verificare il PIN fresco e creare il comando canonico. Il dispatch, il writer
SQLite e l'audit restano gli stessi. Il journal autorevole e il recupero C15
rimangono negli adapter host; il pacchetto valida soltanto la loro forma
delimitata. L'estrazione non amplia le superfici abilitate al commit delle note.

Swift rimane una fondazione e una superficie distinta; il client Rust/GPUI usa
le API paired già definite. Nessuno dei due diventa writer del profilo e non
deve importare il pacchetto TypeScript. Eventuali implementazioni dei contratti
nei client vanno confrontate con i vettori, senza ricreare l'autorità dell'host.
I contratti di aggiornamento generale, AI e documenti non sono estratti: non
appartengono a questo risultato delimitato del pilota.

## Prova e ritorno al confine precedente

La suite Headless esistente include i vettori del pacchetto su Node 24 in tutti
e tre i job macOS/Linux/Windows. Essi verificano proiezioni/versioni, rifiuto dei
campi di autorità del chiamante, conservazione ENC, budget in byte UTF-8,
separazione delle policy e ricevute/journal delimitati. La scansione unica e il
typecheck senza DOM descritti in BT-08 impediscono dipendenze dall'host o da una
piattaforma. Il percorso reale del profilo viene nuovamente verificato dopo la
composizione con lifecycle e recovery; la PR raccoglie review e risultato CI.

Il ritorno in-process consiste nel ripristinare posizione dei tre moduli e
import dei consumatori. Processo e writer sono già in-process in entrambe le
configurazioni. Nessuna conversione di record, schema, ciphertext, backup o
ricevuta è richiesta; non si ripresenta un comando già eseguito. Questo gate
non qualifica installazioni native o la consegna complessiva della 0.9.1.
