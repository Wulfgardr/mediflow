# ADR 0116: transizione agentica governata dello stato checkup

Date: 2026-09-01
Status: Accepted

Issue: [GitHub #319](https://github.com/Wulfgardr/mediflow/issues/319)
Program line: candidata `0.8.5`
Evidence base: `91d254ea76500ef7737d32e0edc7b1b73147cef5`

Related: [ADR 0055](./0055-network-checkup-write-boundary.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0097](./0097-active-role-session-and-step-up-authorization.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md),
[ADR 0103](./0103-headless-clinician-authorized-soap-entry-write.md),
[ADR 0108](./0108-piano-canonico-headless-read-only-085.md) e
[ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md).

## Problema

ADR 0114 richiede una decisione operation-specific prima di promuovere una
scrittura AIP o MCP. La scrittura SOAP di ADR 0103 non e un precedente
riutilizzabile: owner, approval e proof sono process-local e limitati
all'append nel diario clinico.

La candidata `0.8.5` deve dimostrare un solo write non-SOAP, utile ma piccolo.
La scelta deve impedire che planner, modello, chat, voce, MCP, provider o lease
AIP trasformino una proposta in una modifica autonoma del dato clinico.

## Opzioni considerate

1. **Creare, modificare o eliminare un checkup.** Sarebbe utile, ma apre campi
   clinici, testo libero, date, cancellazione e piu regole di dominio.
2. **Cambiare soltanto lo stato di un checkup esistente.** Riusa la revisione
   della risorsa e limita il comando a una transizione enumerata.
3. **Riusare il proof SOAP.** Riduce il codice, ma trasferisce authority tra due
   operazioni diverse e viola il vincolo operation-specific.
4. **Lasciare ogni write indisponibile.** E il fallback sicuro, ma non valida il
   percorso agentico governato richiesto dal programma riaperto.

## Decisione

Si adotta l'opzione 2. L'operazione e
`mediflow.patient.checkup.status.transition.v1`; la capability ha lo stesso ID.
Il solo Application Service e
`HeadlessCheckupStatusTransitionServiceV1`.

L'agente puo chiedere una preview, ma il suo massimo stadio resta
`proposal_only`. Soltanto una conferma esplicita nella UI MediFlow trusted puo
creare un'autorizzazione privata monouso per il commit esatto. Questa
autorizzazione non eleva l'owner AIP e non attraversa MCP.

La sola macchina di dominio ammessa e:

```text
pending -> completed
pending -> cancelled
```

Ogni altra transizione e negata. Riapertura, modifica di un record gia
terminale, create, delete, restore, batch e modifica di date, titolo, note,
source o altri campi restano manuali.

### Contratto operativo a 13 campi

| Campo | Valore accettato |
| --- | --- |
| Operation ID | `mediflow.patient.checkup.status.transition.v1` |
| Capability ID | `mediflow.patient.checkup.status.transition.v1` |
| Application Service | `HeadlessCheckupStatusTransitionServiceV1` |
| Input schema | `mediflow.patient.checkup.status.transition.input.v1` strict |
| Output schema | preview `mediflow.patient.checkup.status.transition.preview.v1`; receipt `mediflow.patient.checkup.status.transition.receipt.v1` |
| Maximum stage | owner AIP `proposal_only`; commit solo tramite conferma UI operation-specific |
| Authority | medico autenticato, ruolo attivo, step-up fresco e proof privato monouso; nessuna authority del chiamante |
| Sessione | owner AIP process-bound piu sessione UI corrente, entrambi host-owned e legati alla stessa selezione |
| CAS | `expectedRevision` esatta e transizione atomica da `pending` |
| Idempotenza | chiave opaca host-owned legata al digest del comando; stesso digest restituisce la stessa receipt, digest diverso e negato |
| Limiti | una risorsa, una transizione, una proposta attiva per owner e risorsa, TTL breve, zero batch e zero testo libero |
| Receipt | esito strutturato PHI-safe, persistito con il commit o nessun commit |
| Dipendenza Fabric | `none`; modello, provider, prompt, venue ed egress non partecipano all'esecuzione |

Una route HTTP, un tool MCP o un nome nel planner non sostituiscono nessuno di
questi campi.

### Input minimizzato e riferimenti opachi

L'input agentico contiene esattamente:

```text
schemaVersion, operationId, checkupRef, targetStatus, expectedRevision
```

`schemaVersion` e `operationId` sono costanti. `targetStatus` accetta soltanto
`completed` o `cancelled`. `expectedRevision` e un intero positivo sicuro.
`checkupRef` e un riferimento opaco, breve, non indovinabile, emesso dall'host
per l'owner e la selezione correnti. Non e un ID database e non e authority.

Il chiamante non puo fornire patient ID, checkup ID, ambulatorio, actor, ruolo,
sessione, purpose, generation, epoch, policy, proof, receipt, idempotency key,
provider, modello, prompt, venue, egress o fallback. Sono vietati chiavi extra,
prototype non ordinari, accessor, Proxy, symbol e valori non enumerabili.

L'host risolve `checkupRef` soltanto dentro il paziente e l'ambulatorio gia
selezionati dal broker. Il record deve esistere, non essere eliminato, essere
`pending` e avere la revisione attesa. Un riferimento scaduto, foreign,
riavviato o fuori scope viene negato senza rivelare se la risorsa esiste.

### Preview e conferma trusted

La preview e immutabile, memory-only e valida per al massimo `120000 ms`.
Rappresenta una sola coppia risorsa-comando e conserva internamente il digest
di operation, owner, selezione, currentness, stato iniziale, stato finale e
revisione attesa. Non rinnova owner, lease o sessione. Per ogni coppia
owner-risorsa puo esistere una sola preview corrente.

Il risultato AIP o MCP espone soltanto stato della proposta, riferimento opaco
e scadenza. La UI trusted risolve autonomamente il contesto da mostrare al
medico; non renderizza testo fornito dall'agente come spiegazione autorevole.

La conferma richiede nella UI MediFlow:

- sessione e ruolo medico ancora correnti;
- selezione paziente e ambulatorio identica alla preview;
- step-up locale fresco;
- gesto esplicito sul comando e sullo stato finale mostrati;
- nuova lettura di stato e revisione prima del commit.

Il verificatore di step-up puo riusare un meccanismo host interno, ma il proof
risultante appartiene esclusivamente a questa operazione. E un'identita privata,
opaca, non serializzabile, valida per al massimo `30000 ms` e con budget uno.
Non e il proof SOAP e non puo essere convertito, copiato o ricostruito da PIN,
cookie, handle, receipt o campi equivalenti.

Assenso in chat, risposta del modello, voce trascritta, annotation del tool,
click del client MCP o presenza di una preview non costituiscono conferma. Il
proof non entra in output, log, audit, provider o processo MCP.

### Addendum: binding multiprocesso operation-specific

Nella topologia production di ADR 0117, broker AIP e Web trusted sono processi
distinti. La separazione non trasferisce F10 al Supervisor: ruolo, step-up,
PIN, gesto, proof e commit restano nel processo Web che possiede la sessione
autenticata e il writer clinico.

Il Supervisor puo inoltrare al Web una sola richiesta di preview tramite un
sottoprotocollo IPC privato, chiuso e distinto dal bootstrap H1a. Prima
dell'inoltro apre un permit AIP con maximum stage `proposal_only`; lo finalizza
soltanto dopo un esito Web corrente e terminalizza richiesta e permit su
revoca, timeout, protocol error o uscita di uno dei figli. Il processo MCP non
parla mai direttamente con il Web.

La richiesta contiene soltanto input canonico, `requestRef` casuale e costanti
di schema/operazione. La risposta espone soltanto esito PHI-safe,
`proposalRef` opaco e scadenza. `requestRef` e `proposalRef` sono correlazione,
non authority. Actor, ruolo, cookie, PIN, gesto, proof, idempotency key e ID
database non attraversano il canale; la conferma usa una route trusted separata
e risolve nuovamente sessione, selezione e risorsa nel Web.

Il Web accetta il sottoprotocollo soltanto dall'esatto parent Supervisor gia
ereditato, mantiene `checkupRef` e preview memory-only e li revoca insieme a
sessione, selezione o canale. Un ACK di preview non autorizza il commit e un
riavvio non ricostruisce riferimenti o proposte. Questa estensione non aggiunge
altre operazioni write e non amplia i quattro frame di bootstrap H1a.

### Concorrenza, idempotenza e commit

L'host genera una chiave di idempotenza opaca e la lega al digest completo del
comando confermato. Il chiamante non la sceglie e non la riceve.

Il servizio linearizza il consumo del proof prima di pubblicare un esito. Un
failure rende il proof terminale: non puo produrre un secondo tentativo. Il
port di persistenza verifica nella stessa transazione:

1. currentness di scope e risorsa;
2. stato iniziale `pending`;
3. `expectedRevision` esatta;
4. chiave di idempotenza e digest;
5. update dello stato e incremento della revisione;
6. audit e receipt PHI-safe.

Due conferme concorrenti hanno al massimo un vincitore. Il replay dello stesso
digest restituisce la receipt gia materializzata senza una seconda scrittura.
La stessa chiave con digest diverso, una revisione cambiata o una transizione
gia terminale vengono negate. Audit o receipt indisponibili prima della
transazione causano zero write; non e ammesso un audit best-effort successivo.

### Output, audit e redazione

La receipt contiene soltanto:

- schema, operation ID, capability ID, outcome e denial code;
- `fromStatus`, `toStatus`, revisione precedente e nuova;
- riferimenti hash di owner, risorsa, proof e receipt;
- generation, revocation generation, selection epoch e timestamp host-owned.

Non contiene patient ID, checkup ID, handle, titolo, data, note, testo libero,
query, prompt, risposta del modello, provider, segreto, token o PIN. Il valore
del proof non entra in output, log o audit; il record conserva soltanto il suo
riferimento hash host-owned. Log e messaggi di errore rispettano la stessa
redazione. Il processo MCP non scrive direttamente audit e non accede al
database.

### Revoca e denial fail-closed

Lock, logout, scadenza o revoca della sessione, cambio ruolo, paziente,
ambulatorio, epoch o policy, expiry, restart e `dispose` revocano preview e
proof prima del successivo uso osservabile. La revoca dell'owner padre drena i
figli; un restart non ricostruisce preview, riferimenti o proof. Una receipt di
idempotenza gia persistita resta evidenza, non authority per una nuova call.

Il boundary pubblico usa denial PHI-safe e almeno queste classi stabili:

- `invalid_input`, `operation_unavailable` e `resource_unavailable`;
- `scope_changed`, `session_unavailable` e `role_unavailable`;
- `preview_expired`, `confirmation_required`, `proof_unavailable` e
  `proof_replayed`;
- `revision_conflict`, `transition_unavailable` e `idempotency_conflict`;
- `audit_unavailable`, `commit_unavailable` e `restart_changed`.

Errori inattesi diventano `operation_unavailable`. Nessun denial rivela
identita, presenza della risorsa o causa interna piu precisa del necessario.

## Split di implementazione

La consegna resta in packet separati:

1. [GitHub #320](https://github.com/Wulfgardr/mediflow/issues/320) implementa
   Application Service, preview, proof, idempotenza e fake port, senza DB,
   route, MCP o provider.
2. [GitHub #317](https://github.com/Wulfgardr/mediflow/issues/317) compone il
   servizio con owner production e writer checkup sotto scope broker-owned,
   con database solo sintetico nei test.
3. Un binding AIP/MCP puo essere promosso soltanto dopo i due packet, import
   guard, prova di revoca e verifica sulla stessa exact candidate.

Ogni packet usa TDD, resta sotto circa 300 LOC runtime e non aggiunge una
seconda operazione write.

## Matrice minima di prova

| Gate | Prova positiva | Falsificatore bloccante |
| --- | --- | --- |
| Input | record strict e solo transizione enumerata | extra key, Proxy, raw ID o authority caller accettati |
| Scope | ref opaco risolto sulla selezione broker-owned | lookup cross-patient o accesso diretto MCP al DB |
| Preview | snapshot immutabile, TTL e una proposta attiva | preview rinnova lease o sopravvive a revoca |
| Conferma | UI trusted, step-up fresco e proof distinto | chat, modello, MCP o proof SOAP autorizzano il commit |
| CAS | revisione esatta e un solo vincitore | lost update o transizione da stato non `pending` |
| Idempotenza | replay identico restituisce la stessa receipt | secondo write o riuso con digest diverso |
| Audit | receipt atomica e PHI-safe | write senza audit o payload clinico nel record |
| Lifecycle | lock, logout, epoch, restart e dispose revocano | ref o proof riutilizzabile dopo terminalita |

Tutte le fixture sono sintetiche. I test del core non provano la composizione
DB; i test DB non provano MCP, host esterni, uso clinico o release readiness.

## Conseguenze

- MediFlow ottiene un primo write agentico governato senza aprire create,
  delete, testo libero o accesso database.
- La conferma resta un atto host-owned distinto dalla proposta dell'agente.
- SOAP e checkup conservano proof, owner e receipt non trasferibili.
- La composizione deve garantire audit e receipt atomici; il writer network
  esistente non e automaticamente equivalente.
- Ogni altra scrittura richiede un nuovo ADR operation-specific.

## Claim ceiling

Questa ADR accetta il contratto e lo split. Non implementa Application Service,
proof, writer, binding AIP/MCP, UI, database o test runtime. Il claim massimo e
`AGENTIC_CHECKUP_STATUS_CONTRACT_ACCEPTED__NO_RUNTIME_WRITE_OR_BINDING`.
