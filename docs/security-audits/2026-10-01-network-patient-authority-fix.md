---
summary: "Rapporto pubblico sanitizzato sulla correzione dell’autorità nelle scritture paziente di rete."
read_when:
  - "Valutare i finding F-01 e F-02 e la loro correzione."
  - "Comporre la correzione con PR 372 o verificarne la futura distribuzione."
---

# Correzione dell’autorità nelle scritture paziente di rete

Data della review: 2026-10-01 UTC

## Disposizione

I due finding validati nel perimetro hanno stato `FIX_VERIFIED` sull’esatta
candidata locale descritta sotto:

- F-01, severità High: correzione verificata;
- F-02, severità Medium: correzione verificata.

La candidata riceve un `BOUNDED_PASS` tecnico nel perimetro esaminato. La
consegna resta `HOLD_COMPOSITION_AND_PUBLICATION`: il commit non è stato
pubblicato e la composizione con PR 372 deve ancora essere completata e
verificata.

Questo rapporto non certifica la sicurezza generale del prodotto.

## Identità esatta della candidata

- repository: `Wulfgardr/mediflow`
- base: `a238b47fccce09db9a0a7b3977355266962216ca`
- head: `c6feccb8962cecf8826ec375b09a9c37b26b87fc`
- tree: `9c4744668243ed351dd8d09e22d6389d10305e76`
- SHA-256 della patch base-to-head:
  `3c6c316ae050f654e1ac95d8c9f3187c4641032013be5e0ac5af42bd5b4592fe`
- stato osservato: candidata locale, non pubblicata

Questa identità deve restare nel rapporto anche se la correzione viene
successivamente composta in un commit differente. Il futuro commit distribuito
dovrà essere registrato separatamente.

## Perimetro

La review ha riguardato:

1. validità dell’autorità durante create, update, delete e restore del paziente
   attraverso il data plane paired;
2. revoca di pairing, modalità di rete, capability e sessione operatore;
3. atomicità tra rivalidazione, mutazione clinica e audit obbligatorio;
4. esclusione dei campi AI e document-derived dalla scrittura paired del
   profilo paziente;
5. currentness delle sessioni native e Web usate da queste operazioni;
6. compatibilità con il limite JSON di PR 372;
7. test modificati e contratti SECURITY, ADR e OpenAPI pertinenti.

Non erano in scope deployment, dati reali, login applicativo, PIN, servizi
esterni, installazione o una nuova esplorazione generale delle superfici di
attacco.

## Metodo

Il lavoro ha combinato:

- confronto di oggetti Git e patch esatti;
- revisione statica dei confini di autorità e dei punti di commit;
- confronto con SECURITY, ADR e contratto OpenAPI;
- prove sintetiche con dati inventati e database temporanei;
- suite focalizzate e indipendenti;
- lint globale, build di produzione e verifica del pacchetto standalone;
- analisi di composizione a tre vie con PR 372.

Le prove sintetiche attestano il comportamento del controllo esaminato, non un
deployment reale.

## Finding e correzioni

| Finding | Severità | Stato precedente | Correzione | Stato sulla candidata |
| --- | --- | --- | --- | --- |
| F-01 | High | Una scrittura paziente già ammessa poteva conservare autorità non più corrente dopo una revoca. Il difetto era già presente nella base verificata e non viene attribuito a PR 372. | Rivalidazione di pairing, modalità, capability, sessione, operatore e scope nella stessa transazione `IMMEDIATE`, prima di letture, mutazioni e audit di successo. | `FIX_VERIFIED` |
| F-02 | Medium | La scrittura paired del profilo poteva modificare metadati che determinano freschezza e provenienza dei riepiloghi AI. Il difetto era già presente nella base verificata e non viene attribuito a PR 372. | Allowlist esplicita dei campi profilo/status e rifiuto dei campi AI/document-derived, inclusi i metadati derivati e i valori null. | `FIX_VERIFIED` |

La rivalidazione non promette di annullare una transazione già linearizzata:
stabilisce un punto di commit documentato e atomico. Un diniego avviene prima
della mutazione clinica e dell’audit di successo; un errore nell’audit
obbligatorio continua a causare il rollback della mutazione.

## Verifiche

| Verifica | Esito |
| --- | --- |
| Suite focalizzata route/service/transazione | 167/167 passati |
| Sottoinsieme di review indipendente | 152/152 passati; modello ed effort del reviewer non verificati |
| Typecheck, lint dei file modificati e gate audit/schema/OpenAPI/claims | Passati |
| Lint globale | Passato |
| Build canonica di produzione | Passata su Node 24.21.0, ABI 137 |
| Guard del pacchetto standalone | Passata su Node 24.21.0, ABI 137 |
| Dipendenze della build | Dipendenze fisiche fissate e compatibili con ABI 137; nessuna ricompilazione SQLite |
| Aggregato completo | 5.489 passati, 2 falliti, 12 saltati, totale 5.503 |

I due fallimenti dell’aggregato dipendono dall’indisponibilità delle fixture
congelate Mac config-schema e C1 receipt. Non sono stati osservati fallimenti
del sorgente nel perimetro della patch di audit. L’aggregato complessivo non va
tuttavia descritto come interamente verde.

## Runtime della verifica

Un primo replay della review finale configurata per Daybreak è stato avviato
con Node 26, ABI 147, mentre la dipendenza SQLite conservata era costruita per
ABI 137. Nessun corpo di test è stato eseguito in quel tentativo.

La patch esatta è stata poi qualificata esplicitamente con Node 24.21.0,
ABI 137, usando le dipendenze fisiche fissate.

## Provenienza dei modelli

- Il report avversariale originario non registra un’identità modello ed effort
  attestabile nelle fonti pubbliche.
- Un primo tentativo di validazione nel percorso Sol è stato bloccato e non ha
  prodotto una disposizione; non viene contato come review Daybreak.
- Il reviewer indipendente riavviato ha eseguito il sottoinsieme 152/152, ma
  la sua interfaccia non esponeva modello ed effort: la sua identità resta non
  verificata.
- Per la review finale l’orchestratore ha richiesto Daybreak Blue,
  `gpt-daybreak-blue-latest`, effort `xhigh`. L’interfaccia del reviewer non
  esponeva l’identità effettivamente servita né la telemetria dell’effort: la
  configurazione richiesta è registrata, la provenienza runtime non è
  attestata.
- La proposta di questo rapporto è stata prodotta in una task avviata
  esplicitamente con `gpt-daybreak-blue-latest`, effort `xhigh`; anche in
  questo caso la selezione dell’orchestratore non equivale a telemetria del
  serving model.
- La review Daybreak del 2026-09-07 riguarda una revisione e un audit separati;
  la sua provenienza non viene trasferita a questo lavoro.

## Composizione con PR 372

La composizione con PR 372 è ancora pendente. L’analisi a tre vie ha rilevato
un conflitto testuale in:

- `lib/patient-json-envelope.test.ts`

Le modifiche di produzione operano su livelli complementari, ma il tree
composto deve essere riesaminato. La risoluzione deve conservare sia la matrice
completa dei limiti e dell’involucro JSON di PR 372 sia le fixture reali
dell’autorità introdotte da questa correzione.

Sul commit composto devono essere rieseguiti almeno:

- suite di autorità e body-bound;
- typecheck e lint;
- gate audit e sicurezza;
- controllo di drift OpenAPI;
- build di produzione e guard standalone;
- controlli richiesti per il merge.

Qualunque modifica al sorgente, rebase o risoluzione del conflitto produce una
nuova identità e richiede una nuova ricevuta.

## Limiti

Non sono attestati:

- server distribuito o applicazione impacchettata;
- database o dati clinici reali;
- login, PIN, credenziali o provider reali;
- comportamento multipiattaforma;
- merge, release o installazione;
- sicurezza generale di altre route o future integrazioni.

Sono intenzionalmente esclusi log grezzi, probe eseguibili, percorsi locali,
segreti, dettagli delle credenziali, istruzioni temporali di riproduzione e
specifiche operative utili a sfruttare una versione non ancora distribuita.
