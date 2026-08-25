# ADR 0103: scrittura SOAP Headless autorizzata dal medico

Date: 2026-08-25
Status: Accepted

Issue: WUL-522, WUL-282
Baseline: `b55e8e1a6dff53c79cf0fc6a314582df0268d307`
Program line: candidato `0.8.5`

Related: [ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0098](./0098-physician-terminal-review-authority.md) e
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md).

Candidate evidence only, non-ancestor: commit
`89645257fd76b08009ddb6d4533b8bde608d0f9d`. Il commit contiene la candidata
ADR 0097, che non e presente in questa base e non viene collegata, importata o
presentata come decisione accettata.

## Problema

ADR 0100 nega ogni write Headless. Un assistente puo raccogliere una bozza
SOAP, ma testo chat, voce/audio trascritti, planner, Mini, agente, proposal,
receipt Fabric, provider o venue non possono autorizzare un append nel diario.

Serve una sola eccezione stretta. Deve usare una sessione di medico autenticato
e un'approval monouso, senza creare un canale Headless di scrittura generale.

## Decisione

### Unica eccezione e precedenza

L'unica operazione e `mediflow.clinical_diary.append_soap.v1`, con
`authorizationPolicy: clinician_confirmed_single_use`. Questa ADR sostituisce
la clausola blanket no-write di ADR 0100 **solo** per questa operazione. Tutte
le altre righe Fabric e Headless restano `applyPolicy=none` e non ottengono
authority per analogia, unione o trasferimento.

L'operazione non ricava authority da Fabric, provider, venue, receipt,
proposal, Mini, Web, chat o altro adapter. Patient Insight, Document
Synthesis, Smart Import, OCR e Treatment Reasoning mantengono consegna Fabric
obbligatoria e distinta. La loro evidenza non autorizza SOAP, e SOAP non prova
la consegna di nessuno dei cinque path.

### Ingresso della bozza e proprietà host

Il chiamante puo presentare solo un ordinary record senza prototype e con sei
own data keys enumerabili, in questo ordine esatto:

```text
schema, operationId, subjective, objective, assessment, plan
```

`schema` e `operationId` hanno valori fissi. Le quattro sezioni SOAP sono il
solo contenuto clinico. L'ingress respinge chiavi mancanti o extra e ogni
accessor, Proxy, valore non-enumerabile, inherited/prototype o symbol.

Respinge inoltre ogni valore caller-supplied per actor, role, patient,
ambulatory, purpose, action, field set, record/entry/command IDs, autorita di
idempotenza, date, type, title, attachments, metadata, revisioni, epoch,
policy, digest, receipt, provider, venue, egress, apply o authority. Un valore
equivalente non e un fallback.

L'host risolve univocamente un paziente attivo e corrente. Se la selezione
host-selected e ambigua, non univoca, stantia, non attiva o non corrisponde a
sessione, lease o currentness, l'operazione nega prima della preview.

L'host fissa `patientRef`, `ambulatoryRef`, actor, sessione padre/figlia,
lease identity/generation, active-role grant ref/version/revocation generation,
principal/authentication generation, `selectionEpoch`, patient version, azione
`append`, finalita `clinician_requested_documentation`, proposal revision,
expiry e policy digest. Fissa anche l'entry field set: type, title, date,
setting, metadata e nessun attachment, piu le quattro sezioni SOAP.

### Sessione di medico e lifecycle della proposta

H2a e H2b richiedono una sessione active-role del medico autenticato accettata
o restacked. L'host deve risolvere `actorRef`, principal/authentication
generation, active-role grant ref/version/revocation generation, identita della
sessione padre/figlia e del lease, e il minimo audit PHI-safe. `role`, actor,
cookie, PIN, pairing, token, receipt o body non sono authority.

Il lifecycle e esattamente `inspect -> preview -> proposal`. Preview e proposal
sono memory-only, con scadenza breve host-owned. L'host le elimina su expiry,
denial, logout, restart, cambio selezione, ruolo o policy. SOAP non entra in
log, persistenza o backup. Solo dopo H3, se necessario e dimostrato, puo
persistere un record minimizzato di digest e contesto di approvazione;
non contiene SOAP e non e un grant.

Chat, voce/audio trascritti, planner text, Mini e utterance dell'agente possono
solo raccogliere la bozza o richiedere preview. Non possono mai approvare,
coniare un gesto, confermare un PIN o consumare una proof.

### Presentazione e approval clinica

Il client riceve l'entry risultante dall'host. Sigilla title, contenuto e
metadata, incluse tutte le sezioni SOAP e tutti gli altri campi fissi. Prima
del gesto riapre il seal e confronta byte per byte ogni campo risultante:
type, title, date, setting, metadata, attachments assenti e SOAP.

Solo la UI di approval dedicata consente il gesto esplicito seguito da PIN
fresco. Un "si" conversazionale, un click Mini, una scelta planner o un'azione
agentica non sono approval. L'attestation, il gesture e la route
`physician_terminal_review` di ADR 0098 autorizzano soltanto la disposition di
review. Non autorizzano SOAP append e non possono essere riusati come step-up,
gesto o proof SOAP.

Il boundary di autenticazione conia `authorizationProof` CSPRNG opaca,
memory-only e valida al massimo 30 secondi. Il suo stato e atomico e monouso:
`minted -> in_flight -> spent`. Lock, logout, revoca, expiry, cambio di
principal/role/patient/ambulatory, lease, epoch, version, policy o proposta la
invalidano. Un commit fallito la brucia e richiede nuova review, seal, gesto e
PIN fresco.

### Binding, commit e ricevuta

L'host genera `commandId` e l'`idempotencyKey` approvata. `approvalRef` e
`authorizationProof` sono legati esattamente a entrambi, a lease
identity/generation e a ogni campo host precedente: paziente, ambulatorio,
sessione padre/figlia, actor, principal/authentication generation, active-role
grant ref/version/revocation generation, action, purpose, field set, payload e
seal digest, proposal/revision/expiry, selection epoch, patient version,
currentness e policy digest. Una proof non puo essere abbinata a un'altra
idempotency key.

Il piccolo envelope dell'Application Service accetta soltanto `approvalRef`,
`idempotencyKey` e `authorizationProof`. Risolve `commandId` internamente e
non accetta SOAP, ID clinici, authority o altri campi. In una sola transazione
SQLite, ricontrolla tutti i binding e inserisce insieme entry, audit PHI-safe e
idempotenza/receipt durevole. Un failure fa rollback di tutto e consuma la
proof. Un replay esatto restituisce la stessa receipt; stessa chiave con un
campo o binding diverso e conflitto.

L'approval artifact, audit e receipt sono PHI-safe. Contengono solo riferimenti
opachi, esito, timestamp, digest e versioni necessari. Non contengono SOAP,
PIN, proof, projection, identita dirette, provider, venue, egress o testo di
proposta e non sono grant riusabili.

Mini resta `proposal_only`. Web e chat sono adapter senza authority. DTO e
golden test shared-core tri-OS provano solo portabilita del contratto, non UI,
runtime o parity Apple.

## Decomposizione H1-H10

| Fase | Confine richiesto |
| --- | --- |
| H1 | DTO SOAP chiuso, own-key rejection, digest e denial currentness. |
| H2a | Restack accettato della sessione medico: `actorRef`, principal/auth generation, role grant e audit minimo. |
| H2b | Owner host di sessione padre/figlia e lease con ref/version/revocation generation, senza authority caller. |
| H3 | Lifecycle memory-only `inspect -> preview -> proposal`, expiry e wipe; eventuale record minimizzato solo se provato. |
| H4 | Entry field set host-fixed e client seal/reopen con confronto byte-esatto. |
| H5a | UI dedicata con gesto esplicito; ogni superficie conversazionale o Mini resta non approvante. |
| H5b | PIN fresco e proof CSPRNG monouso, TTL, invalidazione e burn-on-failure. |
| H6 | Binding host-generated di command, idempotency, lease e di tutti i campi approvati. |
| H7a | Contratto Application Service con envelope di tre campi e revalidazione interna. |
| H7b | Transazione SQLite atomica, audit, idempotenza, receipt, replay e conflict. |
| H8 | Adapter Web/chat senza authority; Mini proposal-only; nessun nuovo transport. |
| H9 | DTO e golden shared-core tri-OS, solo fixture sintetiche. |
| H10 | Verifica indipendente di denial, race, rollback, replay, conflict e assenza di authority union. |

L'ordine e vincolante: `H1 -> H2a -> H2b -> H3 -> H4 -> H5a -> H5b -> H6
-> H7a -> H7b -> H8 -> H9 -> H10`. Dopo un gate precedente accettato e una
base esatta, i packet locali bounded successivi procedono senza una nuova
approvazione utente. Questo non autorizza runtime clinico, dati reali o azioni
remote.

## Stop rule, claim ceiling e consegna

Fermare se compare una seconda operazione, authority write generale, un campo
authority caller-defined, approvazione implicita, riuso ADR 0098, proof
persistita, transazione parziale, replay non esatto, SQLite diretto, union
Fabric/Headless, provider, venue, egress, attachment o boundary architetturale
ulteriore.

Questa decisione accettata non implementa runtime, route, schema, migrazione,
writer, UI, test runtime, dati clinici, provider, cloud, egress, Mini apply,
push, PR, merge, tag o release. Claim ceiling: **contratto accettato per una
sola append SOAP locale a conferma clinica monouso; nessun write e consegnato.**

L'ordine downstream e `H1..H10 -> Daybreak independent review -> canonical
docs and claims review -> explicit authority: push -> PR -> merge -> tag ->
release`. Ogni freccia e una dipendenza di verifica. Push, PR, merge, tag e
release restano autorita separate.
