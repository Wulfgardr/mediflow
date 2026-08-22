# ADR 0094: Intelligence Fabric e controllo headless 0.8.5

Date: 2026-08-22
Status: Proposed

Issue: WUL-522
Baseline: `main` a `0d55c6d0f`, versione `0.8.2`
Program line: candidato `0.8.5`

Related: [ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0090](./0090-giunture-fabric-trust-onboarding-routing-interazione.md),
[ADR 0091](./0091-candidato-locale-fabric-admissione-continuita-status.md),
[ADR 0092](./0092-limite-digest-bound-readiness-ai-locale.md), ADR 0093
in [PR #185](https://github.com/Wulfgardr/mediflow/pull/185) e WUL-282.

## Problema

Intelligence Fabric e Agent Interface Plane (AIP) risolvono problemi diversi.
Il Fabric decide come MediFlow ottiene intelligenza per le capability
applicative. AIP decide come un agente esterno controlla MediFlow. Confonderli
creerebbe due percorsi business, oppure farebbe dipendere la completezza
headless dai soli percorsi intelligenti.

La PR #159 ha portato su `main` il nucleo Fabric. Patient Insight e Document
Synthesis producono gia metadati Fabric; Smart Import, OCR e Treatment
Reasoning non attraversano ancora lo stesso resolver host-owned. Le PR
#180-#190 contengono evidenza utile per AIP e Mini, ma dipendono da uno stack
ampio e non diventano la nuova base per effetto di questa ADR.

Serve un contratto architetturale prima di altro runtime. Deve mantenere una
sola logica applicativa, separare le identita e classificare tutte le
capability, senza confondere installazione, discovery, sessione e autorita.

## Baseline verificata

| Area | Stato su `main` | Conseguenza |
| --- | --- | --- |
| Fabric | PR #159 merged; resolver, cataloghi, lifecycle candidato, receipt e provenance presenti | Il nuovo lavoro estende il nucleo. |
| Smart paths | Due path adottano Fabric; tre hanno ancora chiamate locali dirette o lane separate | Tutti e cinque richiedono governance Fabric end-to-end. |
| AIP e Mini | PR #180-#190 aperte e draft | Restano evidenza; i replacement packet partono da `main` o da uno stack accettato. |
| Step-up | WUL-282 e Backlog e blocca WUL-522 per apply | Nessun apply viene implementato da questo packet. |

## Decisioni candidate

L'accettazione deve registrare in WUL-522 l'approvazione esplicita di D1-D10.
Fino a quel momento lo stato resta `ADR_PROPOSED_MANAGER_REVIEW` e nessun
packet runtime e autorizzato.

### D1. Un solo Application Service Layer

UI e AIP sono adapter dello stesso Application Service Layer. Questo layer
host-owned possiede regole business, validazione, transazioni, revisioni,
conflitti e audit. Un adapter non replica queste regole e non accede
direttamente al database.

```text
Web / macOS / iOS / iPadOS          CLI / agent service
             \                         /
              Application Service Layer
                 |              |
          servizi di dominio    Intelligence Fabric
```

Le capability nominate del service layer sono il solo ingresso. Non esistono
un percorso business Web e un percorso Agent separati.

### D2. Fabric e AIP sono ortogonali

Intelligence Fabric risponde a: "come MediFlow ottiene intelligenza per una
capability applicativa?" Seleziona provider, modello, credenziale, endpoint e
venue secondo policy host-owned e produce receipt e provenance PHI-safe.

AIP risponde a: "come un agente esterno controlla MediFlow?" Autorizza e
trasporta comandi applicativi tipizzati. Puo richiamare una smart capability
solo attraverso l'Application Service Layer; non sceglie ne configura il
Fabric. La completezza headless non e definita dal numero di smart preview.

### D3. Tre identita e un agente come venue

Medico o utente, agente delegato e provider AI sono tre identita distinte. Un
agente non riceve username o password del medico, cookie, token generale o
credenziale del provider.

L'agente esterno e una venue e un destinatario di trattamento distinti, anche
quando usa un trasporto locale. Sessione e context lease legano almeno:

- identita e runtime dell'agente;
- scopo e finalita;
- capability, pazienti e campi ammessi;
- permesso esplicito di elaborazione esterna;
- scadenza, revoca e massimo stadio.

Selection, `selectionEpoch`, projection, clock e revoca sono broker-owned.
Lock, logout, expiry, cambio paziente o cambio epoch invalidano l'autorita
prima della richiesta successiva. I valori equivalenti forniti dal chiamante
restano non fidati.

### D4. Completezza architetturale e operativa

La completezza architetturale richiede insieme:

- 66/66 righe canoniche classificate e machine-readable;
- nessuna duplicazione della logica business;
- tutte le funzioni intelligenti governate dal Fabric;
- venue ed egress espliciti;
- lease, optimistic concurrency, idempotenza, job, cancellazione, revoca e
  rate limit;
- receipt e provenance PHI-safe, degrado fail-closed ed E2E sintetico.

La completezza operativa e progressiva: ogni riga dichiara una disposition
verificabile, che puo avanzare senza cambiare la definizione architetturale.

Ogni voce del catalogo dichiara almeno `id`, `version`, `domain`, `input`,
`output`, `mode`, `maxStage`, `dataContext`, `authority`, `idempotency`,
`conflict.expectedRevision`, `fabricDependency`, `egress`, `offline`,
`headlessDisposition`, `evidence` e `uiSurfaces`.

Il drift gate verifica ordine e 66/66, ID e versioni unici, schemi, disposition,
binding UI/AIP/Mini, dipendenze Fabric, evidence e metriche ricalcolabili.

### D5. Disposition progressive, non apply generalizzato

Il Mini pilot corrente resta apply-denied. Il catalogo classifica invece il
massimo stadio per capability:

| Classe | Disposition obiettivo |
| --- | --- |
| Search, read e projection minimizzate | `available` dopo broker, lease e authority. |
| Sintesi e classificazione nominate | `available` o `proposal_only`. |
| Creazione di bozze | `proposal_only`. |
| Apply amministrativo a basso rischio | Solo dopo conferma, idempotenza, expected revision, receipt e completamento di WUL-282. |
| Modifiche cliniche | Prevalentemente `proposal_only`. |
| Firma, prescrizione, cancellazione irreversibile | `manual_only` oppure step-up forte secondo contratto accettato. |
| Amministrazione, chiavi, segreti e credenziali | `unavailable`. |

WUL-282 e un blocco live di WUL-522 per apply. Questa ADR non autorizza
l'implementazione di apply. Lo stato di review puo essere letto, ma il Mini
pilot non esegue `accept`, `reject` o `supersede`.

### D6. Flusso proposal-first e comando applicativo

Ogni operazione mutante segue:

```text
inspect -> preview -> proposal -> confirmation/step-up -> apply -> receipt
```

Gli stadi sono separati e il chiamante non puo saltarli. Il comando lega
`command_id`, `idempotency_key`, `actor_session`, capability, contesto paziente,
expected revision, proposal e confirmation. La conferma e physician-owned e
non puo essere sintetizzata dall'agente o da una receipt Fabric.

### D7. Contratto multi-agent

Ogni agente ha isolamento, context lease e budget propri. Le mutazioni future
usano optimistic concurrency ed expected revision; i retry usano
`idempotency_key`. Le attivita lunghe sono job host-owned con stato tipizzato.

Cancellazione e revoca impediscono nuovi step e rendono osservabile l'esito;
non trasformano un'operazione gia committata in rollback implicito. Rate limit
per agente, capability e sessione contengono concorrenza e abuso. Ogni esito
terminale produce una receipt opaca e PHI-safe.

### D8. Trasporti e host topology 0.8.5

I trasporti target sono CLI pipe-first e servizio locale persistente su Unix
socket o named pipe. Non esiste un listener LAN. L'interfaccia e installata e
scopribile per default, ma non e abilitata: catalogo e status pubblici non
contengono dati; il medico deve abilitare esplicitamente una sessione prima di
qualunque accesso.

macOS o desktop ospita l'agent service. Il web usa un bridge esplicito verso
quel servizio. iOS e iPadOS consentono consultazione, approvazione e revoca,
ma non ospitano l'agent service.

### D9. Cinque smart path governati dal Fabric

Patient Insight, Document Synthesis, Smart Import, OCR e Treatment Reasoning
passano dal Fabric end-to-end per l'uso UI e applicativo. Ogni path dichiara
capability nominata, `inputProjectionSchema`, `outputProposalSchema`,
`availabilityDisposition`, provenance e receipt. Non sono ammessi generic
invoke, prompt o testo libero del chiamante.

Le projection paziente sono versionate e broker-owned. Document Synthesis e
OCR richiedono anche un handle documento opaco selezionato dal medico, mai un
upload o testo caller-supplied.

Un OCR primario low-signal puo richiedere una seconda risoluzione Fabric
host-owned per Apple Vision, con receipt e provenance distinte. Una denial non
innesca fallback. Senza seconda autorizzazione l'esito e fallback negato o
`ocr_pending`.

Il record Fabric durabile conserva stato, attore, riferimento, versione e
receipt. Una proposta sanitizzata vive in un record applicativo domain-owned
referenziato; prompt e risposta provider grezzi non sono record Fabric.

### D10. Nessun egress nel candidato corrente

Il candidato usa solo fixture sintetiche, provider locali approvati e nessuna
credenziale reale. Sono esclusi cloud execution, egress, accesso diretto a
SQLite e fallback silenzioso. Loopback e un trasporto locale ammesso, ma non
prova `egress=none`; la rete outbound generica resta bloccata.

Un futuro provider esterno richiede un contratto privacy e security separato,
accettato prima dell'uso. Receipt e provenance descrivono una decisione e non
sono grant riusabili.

## Riconciliazione delle PR #180-#183

| Evidence | Valore unico | Trattamento |
| --- | --- | --- |
| PR #180 | Integra ADR, AIP, mockup e shell in un unico stack ampio | Preservare branch e PR; ricostruire i confini da `main`. |
| PR #181 / WUL-553 | Catalogo AIP e drift gate oltre al manifest Mini | Preservare; ricostruire il catalogo 66/66 conforme a D4. |
| PR #182 / WUL-555 | Evidenzia il rischio di sessione e lease caller-supplied | Preservare come prova negativa; usare authority broker-owned. |
| PR #183 / WUL-554 | Projection `patient_open_loops.v1`, freshness e single-patient | Preservare e riusare il contratto in un packet sintetico isolato. |

Nessuna PR viene chiusa, riscritta o cancellata da questa decisione.

## Stack sostitutivo non distruttivo

```text
P0 ADR 0094 (questo packet)
 |
 +--> S1 Application Service Layer condiviso
 |     +--> C1 catalogo 66/66 + drift
 |     +--> A1 identita, broker, sessione, lease, projection
 |     +--> J1 concorrenza, idempotenza, job, cancel/revoke, rate limit
 |
 +--> F1 contratto Fabric host-owned
 |     +--> F2 Patient Insight + Document Synthesis gate
 |     +--> F3 Smart Import
 |     +--> F4 OCR + fallback esplicito
 |     +--> F5 Treatment Reasoning
 |     +--> F6 lifecycle provider + review durabili
 |
 +--> T1 CLI pipe + local service + bridge host

S1 + C1 + A1 + J1 + T1 --> M1 Mini/AIP con disposition progressive
F2..F6 + S1           --> B1 binding smart application capabilities
M1 + B1               --> I1 E2E sintetico fail-closed
I1                    --> V1 verifica indipendente WUL-564
WUL-282               --> A2 apply amministrativo futuro, fuori dal packet
```

| Packet logico | Confine |
| --- | --- |
| Smart Import | Resolver Fabric e receipt prima dell'invocazione. |
| OCR/fallback | Resolver primario e seconda decisione esplicita. |
| Treatment Reasoning | Risoluzione Fabric prima della lane locale. |
| Lifecycle/review durabili | Stato provider, job, review e riferimenti domain-owned. |
| Bridge/manifest | Catalogo AIP-Fabric-Mini, UI surfaces e drift. |
| Integrazione sintetica | Autorita, servizio, Fabric, job, proposta, revoca e receipt. |

Ogni packet parte da `main` o da uno stack gia accettato, modifica un confine e
resta sotto circa 300 LOC. Le branch e PR originali restano evidence read-only.

## Falsificatori e stop condition

Riaprire l'ADR e fermare la promozione se:

- UI e AIP applicano regole business diverse;
- un agente riceve una credenziale del medico o del provider;
- discovery o sessione espongono dati senza lease e authority;
- il chiamante influenza provider, modello, venue o fallback;
- una delle 66 righe non ha classificazione o campi D4;
- uno smart path evita il Fabric o usa generic invoke;
- apply precede WUL-282, conferma, idempotenza o expected revision;
- conflitti, revoca, cancellazione o rate limit non falliscono chiusi;
- un listener LAN, egress, cloud, SQLite diretto o fallback silenzioso compare;
- una receipt contiene testo clinico o viene usata come grant.

## Non-obiettivi e gate

- Nessun runtime, route, UI o client Apple in questo packet.
- Nessun provider, credenziale, dato paziente reale o migrazione.
- Nessun apply, MCP, REST agentico, listener LAN o cloud.
- Nessun merge, promotion, tag, release, cleanup o security review.
- Le PR #180-#183 restano evidence e non vengono riscritte.

Il prossimo gate e una decisione manageriale esplicita su D1-D10. Fino ad
allora lo stato e `ADR_PROPOSED_MANAGER_REVIEW`.
