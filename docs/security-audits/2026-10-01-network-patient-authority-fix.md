---
summary: "Rapporto pubblico sanitizzato sulla correzione dell’autorità nelle scritture paziente di rete."
read_when:
  - "Valutare i finding F-01 e F-02 e la loro correzione."
  - "Verificare la composizione locale della correzione con PR 372."
---

# Correzione dell’autorità nelle scritture paziente di rete

Data della review: 2026-10-01 UTC

## Disposizione

I due finding validati nel perimetro hanno stato `FIX_VERIFIED` sull’esatta
candidata locale descritta sotto:

- F-01, severità High: correzione verificata;
- F-02, severità Medium: correzione verificata.

La candidata composta riceve un `BOUNDED_PASS` tecnico nel perimetro
esaminato. La composizione con PR 372 è stata completata e riesaminata
indipendentemente in locale. La consegna resta `HOLD_PUBLICATION`: nessun
commit è stato pubblicato e questa review non ha verificato PR live, CI
richiesta o stato remoto.

Questo rapporto non certifica la sicurezza generale del prodotto.

## Identità esatta della candidata composta

- repository: `Wulfgardr/mediflow`
- parent esatto di PR 372:
  `902666c53cf5c6c5f321e623bfba4f84bf24ab6d`
- commit sorgente composto dopo la review di governance:
  `9f522a872af93711daa98a0c20bc6fe38d47390d`
- tree sorgente composto: `9be1a7a260b9cbe19af61b0293d9335af7b8ebf6`
- SHA-256 della patch parent-to-composed-source:
  `fcc3915c373bbfcda16f61ac4c8f69f7225e4ecb7fa0a5aeb0839cc0d7ac04c9`
- stato osservato: locale, committato, non inviato, non pubblicato

Il commit documentale successivo a questa identità sorgente aggiorna soltanto
questo rapporto sanitizzato e il relativo indice. La sua ricevuta esatta è
conservata privatamente con le evidenze di review.

## Identità della candidata originale congelata

- base: `a238b47fccce09db9a0a7b3977355266962216ca`
- head: `c6feccb8962cecf8826ec375b09a9c37b26b87fc`
- tree: `9c4744668243ed351dd8d09e22d6389d10305e76`
- SHA-256 della patch base-to-head:
  `3c6c316ae050f654e1ac95d8c9f3187c4641032013be5e0ac5af42bd5b4592fe`

Questa identità conserva la storia della prima validazione. L’identità composta
sopra è la candidata locale corrente e non implica merge o distribuzione.

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
- composizione a tre vie e review indipendente del tree risultante.

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
| Suite focalizzata finale sulla composizione | 286/286 passati |
| Suite di commit-authority dopo la pulizia di governance | 78/78 passati |
| Review indipendente del tree composto | Nessuna vulnerabilità runtime High, Medium o Low; pass condizionato per la pubblicazione |
| Typecheck, lint e gate OpenAPI/claims/audit/AI/schema/never-regress | Passati |
| Build canonica di produzione | Passata su Node 24.21.0, ABI 137 |
| Guard del pacchetto standalone | Passata su Node 24.21.0, ABI 137 |
| Pagine statiche della build | 127/127 generate |
| Aggregato completo composto | 5.622 passati, 3 falliti, 12 saltati, totale 5.637 |
| Rerun seriale dei percorsi Apple Vision interessati | 35/35 passati in 5,1 secondi |

I tre fallimenti dell’aggregato composto sono timeout fail-closed di circa 30
secondi in percorsi locali Apple Vision offline non modificati. Gli stessi tre
percorsi sono passati nel rerun seriale. Questa è controprova ambientale
circoscritta: l’aggregato resta rosso e non deve essere descritto come
interamente verde.

## Runtime della verifica

La candidata composta è stata qualificata con Node 24.21.0, ABI 137, usando le
dipendenze fisiche fissate. La build di produzione ha completato compilazione,
typecheck, 127/127 pagine statiche, validazione post-build e guard del bundle
standalone.

Il reviewer indipendente del tree composto ha esaminato in sola lettura la
patch esatta e le ricevute disponibili. Non ha rieseguito test e non ha
modificato la candidata.

## Provenienza dei modelli

- Il report avversariale originario non registra un’identità modello ed effort
  attestabile nelle fonti pubbliche.
- Le review della candidata congelata mantengono ricevute proprie e non
  attestano il tree composto.
- Per la review indipendente del tree composto l’orchestratore ha richiesto
  Daybreak Blue, `gpt-daybreak-blue-latest`, effort `xhigh`. L’interfaccia
  non esponeva l’identità effettivamente servita né la telemetria dell’effort:
  la configurazione richiesta è registrata, la provenienza runtime non è
  attestata.
- La review Daybreak del 2026-09-07 riguarda una revisione e un audit separati;
  la sua provenienza non viene trasferita a questo lavoro.

## Composizione con PR 372

La composizione locale parte dall’head esatto di PR 372
`902666c53cf5c6c5f321e623bfba4f84bf24ab6d`. L’applicazione a tre vie ha
rilevato un solo conflitto testuale in:

- `lib/patient-json-envelope.test.ts`

La risoluzione conserva tutte le 12 dichiarazioni di test e le 22 assertion di
PR 372, aggiunge autorità di rete sintetica reale ai casi paired e inoltra gli
header soltanto alle richieste network. Il primo run ha isolato sei casi validi
al limite privi dell’autorità richiesta; il run corretto ha chiuso 286/286.

La composizione OpenAPI conserva versione `1.30.0`, limite corpo di 4 MiB e
risposte `413` insieme all’esclusione dei campi derivati di provenienza AI.
Il reviewer indipendente non ha trovato regressioni di sicurezza runtime nel
delta composto. Ha richiesto l’aggiornamento di questo rapporto e la rimozione
di tre marcatori dello strumento di review; entrambe le condizioni sono
soddisfatte nella candidata locale registrata sopra.

La PR remota non è stata modificata né interrogata da questa review. Identità
PR live, CI richiesta e stato di pubblicazione devono essere verificati prima
di qualunque transizione da `HOLD_PUBLICATION`.

## Limiti

Non sono attestati:

- server distribuito o applicazione impacchettata;
- database o dati clinici reali;
- login, PIN, credenziali o provider reali;
- comportamento multipiattaforma;
- merge, release o installazione;
- stato corrente della PR live o CI remota richiesta;
- sicurezza generale di altre route o future integrazioni.

Sono intenzionalmente esclusi log grezzi, probe eseguibili, percorsi locali,
segreti, dettagli delle credenziali, istruzioni temporali di riproduzione e
specifiche operative utili a sfruttare una versione non ancora distribuita.
