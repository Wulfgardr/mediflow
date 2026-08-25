# ADR 0103: scrittura SOAP Headless autorizzata dal medico

Date: 2026-08-25
Status: Proposed

Issue: WUL-522, WUL-282
Baseline: `92695cfc32e34d4d6de7a0fa926e80be970b7477`
Program line: candidato `0.8.5`

Related: [ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0098](./0098-physician-terminal-review-authority.md), and
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md).

## Problema

Il piano Headless e il catalogo corrente negano ogni scrittura con
`applyPolicy=none`. Un assistente puo preparare una bozza SOAP, ma una risposta
conversazionale affermativa, una receipt Fabric, una venue, un provider o una
proposta non possono autorizzare la scrittura nel diario.

Serve un solo confine proposto, stretto e verificabile per registrare una bozza
SOAP gia definita dal medico. Il confine non rende Headless un canale di write
generico e non modifica il runtime con questa ADR.

## Decisione

### Operazione e input della bozza

L'unica operazione candidata e
`mediflow.clinical_diary.append_soap.v1`. Il chiamante puo consegnare una
bozza solo con queste sei chiavi proprie, tutte esatte:

```text
schema, operationId, subjective, objective, assessment, plan
```

`schema` e `operationId` devono avere i valori fissi del contratto. Le quattro
sezioni SOAP sono il solo contenuto clinico ammesso. Non sono ammessi campi
aggiuntivi, riferimenti paziente o ambulatorio, sessioni, ruoli, epoch,
revisioni, date, tipo, titolo, allegati, policy, digest, receipt, provider,
venue o autorita caller-defined.

Prima della conferma, l'host compone e conserva soltanto una proposta interna
con scadenza e revisione. L'host determina `patientRef`, `ambulatoryRef`,
sessione padre e figlia, active-role grant, `selectionEpoch`, patient version,
azione `append`, finalita `clinician_requested_documentation`, data, tipo,
titolo, field set, assenza di allegati, revisione/scadenza proposta, policy e
digest della bozza. Il chiamante non puo sostituire nessuno di questi valori.

### Eccezione di autorizzazione isolata

Questa operazione usa soltanto
`authorizationPolicy: clinician_confirmed_single_use`. Non cambia
`applyPolicy=none` degli inventari Fabric o Headless, delle altre operazioni o
dei cinque path Fabric. Non deriva, unisce o trasferisce autorita da Fabric,
provider, venue, receipt, proposta, Mini o adapter.

La sessione figlia e dedicata alla singola proposta. Richiede un active-role
grant per il diario clinico, inattivo per default, e uno step-up fresco. Lock,
logout, revoca, expiry, cambio di principal, ruolo, paziente, ambulatorio,
`selectionEpoch`, patient version, policy o proposta negano e invalidano la
sessione figlia prima della scrittura.

La sola UI di approvazione e dedicata. Il client deve sigillare la bozza e,
prima del gesto, riaprirla e confrontarne i byte esatti. Il medico deve fare un
gesto esplicito e inserire un PIN fresco. Un "si" conversazionale, una scelta
del planner o un'azione dell'agente non sono approvazioni.

### Autorizzazione monouso e commit

Il boundary di autenticazione conia una `authorizationProof` CSPRNG,
memory-only, opaca e valida al massimo 30 secondi. Il relativo `approvalRef` e
legato esattamente a operazione, digest SOAP sigillato, proposta/revisione,
policy digest, sessione padre e figlia, attore, active-role grant, paziente e
ambulatorio opachi, epoch, patient version, azione e finalita.

Lo stato e monouso: `minted -> in_flight -> spent`. Il consume e atomico. Un
commit fallito, inclusa una denial di freshness o conflitto, consuma comunque
l'autorizzazione. Il proof grezzo non entra in cookie, URL, storage browser,
log, audit, receipt o backup.

Il comando di commit dell'Application Service accetta soltanto
`approvalRef`, `idempotencyKey` e `authorizationProof`. L'Application Service
risolve internamente proposta, autorita e dati host-owned; non accetta un
payload SOAP, un identificatore clinico o un campo di autorita in questo hop.

In una singola transazione SQLite, il servizio ricontrolla tutti i binding e
inserisce insieme la voce del diario, audit PHI-safe e record durevole di
idempotenza/receipt. Ogni failure fa rollback di tutte le scritture. Un replay
identico restituisce la stessa receipt; stessa chiave con binding o contenuto
diverso restituisce conflitto. La receipt e opaca e PHI-safe: puo contenere
identificatori opachi, esito, timestamp, digest e versioni, ma mai testo SOAP,
PIN, proof, projection, dati paziente, provider o contenuto di proposta.

L'approval artifact PHI-safe usa gli stessi limiti: registra solo `approvalRef`
opaco, esito, timestamp, digest e versioni necessarie alla verifica. Non e un
grant riusabile e non contiene contenuto clinico, proof, PIN o identita dirette.

### Adapter, Fabric e portabilita

Mini rimane `proposal_only`. Web e chat sono adapter dello stesso Application
Service e non ricevono authority. Il contratto condiviso usa DTO e golden test
tri-OS; non dichiara una UI, un runtime o parity Apple completa.

Patient Insight, Document Synthesis, Smart Import, OCR e Treatment Reasoning
mantengono la loro consegna Fabric obbligatoria e separata. La loro evidenza,
provider, venue, receipt o proposal non diventa autorita per questa operazione,
e questa operazione non prova la consegna Fabric di nessuno dei cinque path.

## Decomposizione H1-H10

| Fase | Unico confine e risultato richiesto |
| --- | --- |
| H1 | DTO SOAP chiuso, own-key validation e digest della bozza sintetica. |
| H2 | Risoluzione host di paziente/ambulatorio, sessione padre-figlia, epoch e patient version. |
| H3 | Active-role grant del diario, inattivo per default, revoca e step-up fresco. |
| H4 | Proposta interna con fixed type/title/date/field set, senza allegati, revisione, expiry e policy digest. |
| H5 | UI dedicata: seal, reopen e confronto byte-esatto, gesto esplicito e PIN fresco. |
| H6 | `approvalRef` e proof monouso memory-only, TTL e consume atomico. |
| H7 | Application Service con il solo triplet di commit e revalidazione host-owned. |
| H8 | Writer SQLite atomico: diario, audit PHI-safe, idempotenza e receipt. |
| H9 | Adapter Web/chat e Mini proposal-only, DTO/golden test shared-core tri-OS. |
| H10 | Fixture sintetiche: denial, race, rollback, replay esatto, conflitto e verifica indipendente. |

Ogni fase richiede autorizzazione separata, una base esatta e un diff sotto
circa 300 LOC. Nessuna fase puo anticipare o assorbire la successiva.

## Stop rule, non-obiettivi e ordine di consegna

Fermare il lavoro se compare un campo di autorita caller-defined, una bozza con
chiavi diverse, una UI o conversazione che approva implicitamente, un proof
persistito, un retry dopo failure senza nuova approvazione, una transazione
parziale, un replay non esatto, un accesso SQLite diretto, unione di authority
Fabric/Headless, cloud, egress, provider, venue, allegato, write generico o un
secondo boundary architetturale.

Questa ADR non aggiunge runtime, route, schema, migrazione, writer, UI, test
runtime, dati clinici, provider, Fabric delivery, cloud, egress, Mini apply,
parity, push, PR, tracker, merge, tag o release. Il claim massimo e:
**contratto proposto per una singola scrittura SOAP locale, vincolata a una
conferma clinica monouso; nessun write e consegnato.**

L'ordine downstream e vincolante:

```text
H1 -> H2 -> H3 -> H4 -> H5 -> H6 -> H7 -> H8 -> H9 -> H10
   -> Daybreak independent review -> canonical docs and claims review
   -> explicit authority: push -> PR -> merge -> tag -> release
```

Ogni freccia e una dipendenza di verifica, non un permesso. Push, PR, merge,
tag e release restano autorita separate; Daybreak e una revisione indipendente
e non sostituisce nessuna di esse.
