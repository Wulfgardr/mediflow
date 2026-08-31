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

Ogni sessione figlia e dedicata a una sola proposta. Ha un budget di una
proposta, TTL breve e stato terminale dopo denial, commit o restart. Non puo
approvare o autorizzare un'altra proposta, operazione, paziente, field set,
payload o sessione successiva.

### Costanti H2b per 0.8.5

L'owner H2b e process-local e apre una sessione figlia solo dopo avere emesso
e verificato il grant H2a-A corrente. Registra inoltre il parent attraverso un
seam lifecycle privato, legato per closure allo stesso record H2a-A: il
facade production pubblico non espone quel controller. La terminalizzazione
H2a-A drena in modo sincrono i parent dipendenti e tutti i relativi figli.
L'attach e linearizzato sul record H2a-A: o fallisce se il record e gia
terminale, oppure entra nel set che il disposer deve drenare. Nessun lease e
pubblicato prima dell'attach riuscito e non esiste un altro `await` tra attach
e pubblicazione.
L'API di apertura non accetta grant, actor, sessione, riferimenti, generation,
TTL o altri campi authority dal chiamante. Restituisce un solo lease opaco,
frozen, senza campi e legato per identita al parent e alla sessione figlia.

Il lease scade esattamente dopo cinque minuti, senza rinnovo. La validita e
half-open: e corrente per `now < expiresAt` e scaduto per `now >= expiresAt`.
Il clock viene campionato nella continuation sincrona finale di apertura,
dopo l'emissione H2a-A e immediatamente prima dell'attach; `expiresAt` e quel
campione piu cinque minuti. Un clock non sicuro, negativo o che non consente
la somma esatta nega l'apertura.
La sua validita effettiva e sempre la congiunzione con il grant H2a-A: open
emette e verifica il parent corrente, mentre consumo e recheck lo rivalidano.
Il disposer privato garantisce la cascata immediata anche senza un uso
successivo del lease.
Il seam privato esegue publication, recheck e consumo H2b come callback
sincrone nella stessa continuation dell'ultima validazione H2a-A, prima di
risolvere al facade H2b. Le callback sono closure host-owned, non accettano
input authority e un throw, un risultato asincrono o il fallimento del final
fence terminalizzano il parent coinvolto.

I record H2b di parent, child e lease nascono ciascuno con contract version
`1`, generation `1` e revocation generation `0`; il figlio nasce inoltre con
budget astratto `1`. Il consumo atomico porta il budget a `0`; il figlio resta
solo recheckable per il futuro lifecycle della stessa proposta e non ottiene
un secondo budget. Expiry, denial host-provato, commit host-provato o
terminazione esplicita rendono terminali nello stesso processo i record
coinvolti e portano la relativa revocation generation a `1`. Un clock rollback
non riattiva lo stato. Il denial del parent drena tutti i figli; expiry,
denial host-provato, commit o terminazione di un figlio revocano soltanto quel
child e il relativo lease, senza revocare parent o sibling. Il restart
distrugge invece record e controller: una
nuova istanza nega il vecchio lease per identita assente, senza ricostruire o
simulare una transizione persistita.

Il service H2b espone esattamente `open()`, `recheck(lease)`,
`consumeProposalBudget(lease)` e `terminate(lease)`. `open()` non ha argomenti;
recheck e il primo consumo restituiscono la stessa identita lease. Un secondo
consumo nega con `proposal_budget_exhausted`, ma il lease resta recheckable.
`terminate` e idempotente come esito booleano: `true` solo per la prima
transizione terminale, poi `false`. I denial pubblici PHI-safe sono fissati a
`active_role_unavailable`, `child_unavailable`, `lease_unavailable`,
`lease_expired`, `proposal_budget_exhausted` e `lifecycle_unavailable`; cause e
identita H2a-A non attraversano questo boundary.

La precedenza dei denial e deterministica. Un'identita assente, foreign,
riavviata o gia terminale all'ingresso e `lease_unavailable`. Un lease noto e
corrente che raggiunge il boundary temporale e `lease_expired`; clock invalido
o somma TTL non sicura sono `lifecycle_unavailable`, mentre rollback e perdita
del child durante un'operazione in flight sono `child_unavailable`. Il failure
di emissione o recheck H2a-A e `active_role_unavailable` e drena il parent;
failure di attach o final fence con parent ancora presente e
`lifecycle_unavailable`. Solo `consumeProposalBudget` su un lease altrimenti
corrente con budget gia zero e `proposal_budget_exhausted`. I check avvengono
nell'ordine identita, tempo, recheck H2a-A, final fence e budget.

In H2b parent, child e lease restano identita object process-local host-owned;
non esiste ancora una proiezione serializzabile dei relativi binding. Il
digest H1, SOAP, paziente, selezione, proposal, approval, proof e write non
entrano nell'owner H2b: il digest viene legato solo quando H3 materializza la
proposta memory-only.

### Porta lifecycle H2b per H3

H2b espone al codice production due superfici separate. Il facade pubblico
resta esattamente il service a quattro metodi gia fissato; un owner interno
condivide per closure lo stesso stato e consegna al solo controller host H3 una
porta lifecycle privata. Il lifecycle H3 resta un modulo autonomo e dipende
strutturalmente da questa porta minima per attach e continuation e dal solo
`terminate` del service H2b per la terminalita; non dipende dal facade
production concreto H2b.

La porta privata espone esattamente `withCurrentLease(lease, operation)`,
`registerDependent(lease, dispose)`, `confirmDependent(lease, registration)`,
`unregisterDependent(lease, registration)`,
`withCurrentDependent(lease, registration, operation)` e
`withCurrentProposalBudget(lease, registration, operation)`. Lease e
registration sono identita opache, frozen, senza campi. Dopo `open()`,
`withCurrentLease` rivalida il figlio e invoca la callback di attach nella
continuation H2a; nessun record H3 puo essere pubblicato prima che questa
continuation termini con successo. La terminalizzazione del figlio rimuove
tutte le registration e invoca sincronicamente ogni disposer prima del
successivo uso osservabile.

Le tre continuation accettano soltanto callback sincrone host-owned e
restituiscono `true` solo quando callback e final fence terminano sullo stesso
figlio corrente. Throw, risultato asincrono, reentry, attach parziale o perdita
del figlio terminalizzano quel figlio, drenano i suoi dipendenti e non
revocano parent o sibling. `withCurrentProposalBudget` applica la precedenza
identita, tempo, H2a, final fence, registration e budget; porta il budget da
`1` a `0` una sola volta immediatamente prima della callback. Un budget gia
zero resta `proposal_budget_exhausted` e non rende terminale il figlio. Nessuna
callback riceve SOAP, digest, selezione, proposal, approval, proof o write
authority da H2b.

### Sessione di medico e lifecycle della proposta

H2a e H2b richiedono una sessione active-role del medico autenticato accettata
o restacked. L'active-role grant e diary-operation-scoped a
`mediflow.clinical_diary.append_soap.v1`, inattivo per default e attivabile
solo da attestazione host-owned e step-up fresco. Non e un grant generale o
riusabile. L'host deve risolvere `actorRef`, principal/authentication
generation, active-role grant ref/version/revocation generation, identita della
sessione padre/figlia e del lease, e il minimo audit PHI-safe. `role`, actor,
cookie, PIN, pairing, token, receipt o body non sono authority.

Il lifecycle e esattamente `inspect -> preview -> proposal`. Preview e proposal
sono memory-only, con scadenza breve host-owned. L'host le elimina su expiry,
denial, logout, restart, cambio selezione, ruolo o policy. SOAP non entra in
log, persistenza o backup. Solo dopo H3, se necessario e dimostrato, puo
persistere un record minimizzato di digest e contesto di approvazione;
non contiene SOAP e non e un grant.

### Costanti H3 per 0.8.5

H3 possiede un solo record memory-only per lease H2b e applica la macchina a
stati irreversibile `inspect_current -> preview_current -> proposal_current ->
terminal`. Il service pubblico espone esattamente `inspect(lease, h1Snapshot)`,
`preview(inspectRef)`, `proposal(previewRef)` e `wipe(stageRef)`. I tre ref di
stadio sono identita distinte, opache, frozen e senza campi. Una transizione
invalida il ref precedente per ulteriori transizioni; un ref autentico di uno
stadio precedente puo ancora essere usato solo per `wipe`. Ref foreign,
riavviati o terminali non modificano un lifecycle corrente.

`inspect` accetta soltanto l'esatto snapshot `accepted` prodotto da H1. H3 ne
rivalida forma, normalizzazione e digest attraverso il contratto H1, ne crea
una copia closure-owned e non trattiene il DTO caller. Non accetta SOAP,
digest, paziente, selezione, lease binding o authority come campi separati.
La copia H1 non attraversa il facade H3: resta raggiungibile soltanto dalle
continuation private degli stadi downstream.

La deadline H3 e unica e vale esattamente `120000 ms` dal campione clock finale
dell'attach riuscito. L'intervallo e half-open: corrente per `now < expiresAt`
e scaduto per `now >= expiresAt`. Preview e proposal non rinnovano o
rischedulano la deadline. Il clock deve restituire un safe integer non negativo
e consentire la somma esatta; valore invalido, overflow o rollback rendono il
record terminale.

Un scheduler host-owned e cancellabile elimina il record anche senza un uso
successivo. Il core riceve clock e scheduler per dependency injection e non
usa timer ambientali. Il failure del primo scheduling nega prima della
pubblicazione. Una callback anticipata ricampiona il clock e schedula soltanto
il residuo; una callback puntuale o tardiva esegue il wipe. Ogni metodo
ricontrolla comunque clock e deadline: il timer e cleanup, non authority.

La validita H3 e sempre la congiunzione di H2b, selezione host corrente e
tempo H3. `inspect` usa un attach a due fasi: prima verifica il lease, poi
registra il dipendente sulla selezione corrente, infine registra il dipendente
H2b e ricontrolla la stessa selezione nella continuation H2b. Nessun ref H3 e
pubblicato prima che entrambe le registration e i relativi final fence siano
correnti. Un attach parziale viene ritirato interamente.

`preview` transiziona soltanto un `inspectRef` corrente. `proposal` transiziona
soltanto un `previewRef` corrente e usa
`withCurrentProposalBudget`: il budget H2b passa da `1` a `0` immediatamente
prima della callback di transizione. Il `proposalRef` viene pubblicato solo
dopo i final fence H2b, selezione e tempo. Due transizioni concorrenti hanno al
massimo un vincitore; il loser osserva uno stadio non piu corrente e non
terminalizza il vincitore.

I denial H3 PHI-safe sono esattamente `snapshot_unavailable`,
`lease_unavailable`, `selection_unavailable`, `stage_unavailable`,
`proposal_expired`, `proposal_budget_exhausted` e `lifecycle_unavailable`.
`inspect` applica la precedenza snapshot H1, lease H2b, selezione, clock e
scheduler, attach e final fence. Preview e proposal applicano identita ref,
H2b, selezione, tempo H3, stadio atteso, budget quando richiesto e final fence.
Un failure dopo l'ingresso in una transizione sullo stadio corrente rende H3
terminale; un ref foreign o un ref autentico gia superato non danneggiano il
record corrente. Cause, SOAP e identita upstream non attraversano gli errori.

`wipe` e idempotente come esito booleano: `true` solo per la prima transizione
terminale, poi `false`. Marca il record terminale prima del cleanup, cancella
il timer, rimuove i ref dalle registry, rilascia la copia SOAP e digest,
unregistera H2b e selezione e drena sincronicamente i dipendenti H4 contenendo
throw e reentry. E cancellazione logica delle referenze JavaScript, non una
garanzia di zeroization della RAM. Expiry, denial, cambio selezione, logout,
ruolo o policy, commit e wipe H3 invocano inoltre il gia esistente
`H2b.service.terminate(lease)`: non aggiungono un settimo metodo alla porta
lifecycle H2b e non lasciano riutilizzabile la sessione figlia.

### Porta selection lifecycle per H3

Il projection owner production resta un singleton process-local, ma viene
composto come owner interno con due superfici closure-bound: il registry
pubblico invariato e un controller selection privato. Il facade pubblico non
espone controller, scope o registration e non viene creato un secondo
registry.

La porta privata espone esattamente `withCurrentSelection(session, operation)`,
`registerDependent(scope, dispose)`, `confirmDependent(scope, registration)`,
`unregisterDependent(scope, registration)` e
`withCurrentDependent(scope, registration, operation)`. Scope e registration
sono identita opache, frozen e senza campi. Le callback sono sincrone e
host-owned; risultato asincrono, throw, reentry o final fence fallito ritirano
e drenano il solo dipendente coinvolto, senza revocare la selezione o i
sibling.

Ogni registration pubblicata e legata anche alla private-resource authority
della stessa sessione Web. Reselection, expiry, lock, logout, reset, retirement
o disposal dell'owner fanno prima snapshot e drain sincrono di tutti i
dipendenti della selezione precedente, quindi rimuovono o pubblicano lo stato
successivo. La callback di retirement rimuove la registration locale senza
tentare un secondo unregister sulla risorsa gia drenata.

### Porta lifecycle H3 per H4

L'owner H3 condivide per closure service e controller privato. La porta H4
espone esattamente `withCurrentProposal(proposalRef, operation)`,
`registerDependent(proposalRef, dispose)`,
`confirmDependent(proposalRef, registration)`,
`unregisterDependent(proposalRef, registration)` e
`withCurrentDependent(proposalRef, registration, operation)`. Le callback
ricevono soltanto una copia H1 closure-owned; non ricevono patient ID,
selezione serializzabile, lease, sessione, approval, proof o write authority.
Throw, risultato asincrono, reentry o perdita di currentness terminalizzano H3
e drenano i dipendenti, mentre un ref o una registration foreign restano
inermi.

### Costanti H4 per 0.8.5

H4 e diviso in due componenti senza authority: il field set host-owned e il
codec client di seal/reopen. Il primo resta server-side e closure-bound a H3;
il secondo resta browser-side e closure-bound alla master key della sessione.
Nessuna identita opaca JavaScript attraversa il confine server/browser. H5
usera il canale applicativo previsto per trasportare soltanto il DTO canonico
e un correlation token non-authorizing; `proposalRef`, scope e registration
non sono serializzabili e non attraversano quel canale.

Il field set plaintext usa lo schema letterale
`mediflow.headless.soap-entry-field-set.v1` e ha esattamente queste own data
keys enumerabili, nell'ordine indicato:

```text
schema, type, title, date, content, setting, metadata, payloadDigest
```

I literal host-owned sono esattamente:

```text
type    = visit
title   = Voce clinica
setting = ambulatory
```

`date` deriva da un solo epoch millisecond host-owned, safe integer e non
negativo, campionato dentro la prima continuation H3 corrente. H4 tronca al
secondo inferiore e usa esclusivamente la forma ASCII UTC
`YYYY-MM-DDTHH:mm:ss.000Z`, con anno a quattro cifre. Locale, timezone,
precisione e data caller-supplied non sono input.

`content` concatena quattro blocchi, in ordine S, O, A, P. Per il label `L` e
la sezione H1 `v`, il blocco e `<p>L:</p>` quando `v` e vuota e
`<p>L: {escape(v)}</p>` altrimenti. `escape` procede una volta da sinistra a
destra: `&`, `<`, `>`, `"`, `'` diventano rispettivamente `&amp;`, `&lt;`,
`&gt;`, `&quot;`, `&#39;`; ogni LF diventa `<br>`. Non esegue trim,
sanitization, DOM parsing o ulteriori normalizzazioni. Spazi, tab, slash,
emoji e LF gia normalizzati da H1 restano byte-significativi. Il decoder
accetta soltanto questa grammatica e richiede
`encode(decode(content)) === content`; `<br/>`, tag o whitespace alternativi
non sono equivalenti.

`metadata` e l'esatta proiezione digest H1, come oggetto JSON e non come
stringa JSON: own keys `codec, sha256`, poi `bytes, hex`. La serializzazione
canonica non contiene whitespace e usa esattamente l'ordine
`codec,sha256` / `bytes,hex`; bytes ed hex devono rappresentare lo stesso
SHA-256. Non aggiunge schema, operation, autore, paziente o altro contesto.

`attachments` e semanticamente assente: non e una own key nel field set, nel
bundle sigillato o nello snapshot H5 e corrisponde a SQL `NULL` al commit.
`null`, `[]`, `"[]"`, stringa vuota o un quarto `ENC:` non sono
rappresentazioni equivalenti. Nei digest l'assenza e legata dal sentinel
letterale `mediflow.headless.attachments.absent.v1`.

`payloadDigest` usa il codec
`mediflow.headless.soap-entry-payload-digest.v1` e SHA-256. Ogni campo e UTF-8
senza BOM, preceduto dalla propria lunghezza unsigned 32-bit big-endian, nello
stesso framing H1. L'ordine e esattamente:

```text
mediflow.headless.soap-entry-payload-digest.v1
mediflow.headless.soap-entry-field-set.v1
mediflow.headless.soap-draft-digest.v1
<h1DigestHex>
visit
Voce clinica
<date>
<content>
ambulatory
<metadataJsonCanonico>
mediflow.headless.attachments.absent.v1
```

Il digest ha la forma chiusa e frozen `codec`, `sha256`, quindi `bytes`,
`hex`; bytes contiene 32 interi e hex 64 caratteri lowercase.

### Seal client H4

Il client sigilla separatamente e una sola volta `title`, `content` e
`metadata`. Il plaintext e rispettivamente l'UTF-8 senza BOM di
`JSON.stringify(string)`, `JSON.stringify(string)` e del JSON metadata
canonico come oggetto raw. Non usa il sanitizer rich-text, l'encoder
Foundation `.iso8601`, il `JSONEncoder` Swift ambientale o i generic helper che
trasformano un errore di decrypt in `null`.

Ogni campo usa AES-256-GCM con un IV CSPRNG distinto di 12 byte e tag di 16
byte. Il wire format e esattamente quello di ADR 0071:
`ENC:base64(iv12):base64(ciphertext||tag)`, con base64 RFC 4648 canonico. Il
bundle usa lo schema `mediflow.headless.soap-entry-seal.v1`, conserva in chiaro
`type`, `date`, `setting` e `payloadDigest`, contiene i tre `ENC:` nell'ordine
`title`, `content`, `metadata` e non contiene `attachments`.
Le own data keys enumerabili del bundle sono esattamente, nello stesso ordine,
`schema`, `type`, `date`, `setting`, `title`, `content`, `metadata`,
`payloadDigest`, `sealDigest`.

`sealDigest` usa il codec
`mediflow.headless.soap-entry-seal-digest.v1`, lo stesso framing length-prefixed
e questo ordine:

```text
mediflow.headless.soap-entry-seal-digest.v1
mediflow.headless.soap-entry-seal.v1
mediflow.headless.soap-entry-payload-digest.v1
<payloadDigestHex>
visit
<date>
ambulatory
<titleEnc>
<contentEnc>
<metadataEnc>
mediflow.headless.attachments.absent.v1
```

Il client riapre lo stesso bundle, verifica i tipi plaintext
string/string/object, ricostruisce il field set e confronta byte per byte
schema, type, title, date, content, setting, metadata, payload digest e assenza
attachments con il DTO host ricevuto. Verifica inoltre il seal digest; una
re-encryption non e un confronto valido perche gli IV sono casuali.

Il seal owner e creato dentro `SecurityProvider`: master key e generation di
authority restano closure-bound e non sono parametri caller. Ogni await
WebCrypto e seguito da un fence sulla stessa key identity e sulla stessa
`authorityAttemptGenerationRef`; lock, logout o cambio generation impediscono
la pubblicazione tardiva e rendono il bundle non corrente.

### Lifecycle host H4 verso H5

L'owner host H4 espone esattamente `{ service, lifecycleController }`. Il
service espone solo `materialize(proposalRef)` e `wipe(entryRef)`.
`materialize` accetta esclusivamente un `proposalRef` H3 corrente, reclama una
sola volta quella proposta, campiona la data, costruisce il field set e
registra un dipendente H3 prima di pubblicare un `entryRef` opaco, frozen,
null-prototype e senza campi. Nessun field set attraversa il facade pubblico.

Il controller privato H5 espone esattamente
`withCurrentEntry(entryRef, operation)`, `registerDependent(entryRef,
dispose)`, `confirmDependent(entryRef, registration)`,
`unregisterDependent(entryRef, registration)` e
`withCurrentDependent(entryRef, registration, operation)`. Le continuation
ricevono soltanto una copia frozen del field set H4; non ricevono paziente,
ambulatorio, sessione, lease, proposal ref, approval, proof, command,
idempotenza o write authority.

La currentness H4 e la congiunzione di entry identity, dipendente H3 e proposta
H3 correnti; H4 non rinnova ne estende la deadline H3. Callback async,
generator, Proxy, throw, risultato non-void, Promise, reentry o final fence
fallito terminalizzano H4 e H3. Ref e registration foreign o stale restano
inermi. Il drain H5 e bifase e snapshot-safe; unregister esplicito e true una
sola volta e non invoca il disposer.

`wipe` e idempotente: marca H4 terminale, rimuove ref e registration, rilascia
le copie plaintext e i digest, unregistera H3, invoca `H3.service.wipe` e poi
drena H5 contenendo throw, Promise rejection e reentry. Il disposer H3 usa la
stessa terminalizzazione senza tentare di riusare H3. E cancellazione logica
delle referenze, non zeroization della RAM.

I denial PHI-safe H4 sono esattamente `proposal_unavailable`,
`field_set_unavailable`, `seal_unavailable`, `seal_mismatch` e
`lifecycle_unavailable`. Prima dell'attach un ref foreign e inerte. Dopo il
primo attach H3 riuscito, ogni denial terminalizza H4 e H3. H4 non apre route,
non legge o scrive SQLite, non conia approval o proof e non implementa H5.
Il gate H4 richiede field set host, codec/golden tri-OS e seal/reopen client
verificati; il loro handoff runtime e parte di H5 e non viene anticipato.

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
PIN fresco. La proof include il budget della sola proposta e non puo superare
la sessione figlia terminale o autorizzare una proposta, operazione, paziente,
field set, payload o sessione successiva.

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
| H2a | Restack accettato della sessione medico: `actorRef`, principal/auth generation, grant diary-operation-scoped inattivo, attestazione host-owned, step-up fresco e audit minimo. |
| H2b | Owner host di sessione padre/figlia e lease con ref/version/revocation generation; una figlia ha budget una proposta, TTL e terminalita, senza authority caller. |
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

Fermare se compare una seconda operazione, authority write generale, grant non
diary-operation-scoped o riusabile, sessione figlia con piu di una proposta,
un campo authority caller-defined, approvazione implicita, riuso ADR 0098,
proof persistita o riusata fuori dal suo proposal budget, transazione parziale,
replay non esatto, SQLite diretto, union Fabric/Headless, provider, venue,
egress, attachment o boundary architetturale ulteriore.

Questa decisione accettata non implementa runtime, route, schema, migrazione,
writer, UI, test runtime, dati clinici, provider, cloud, egress, Mini apply,
push, PR, merge, tag o release. Claim ceiling: **contratto accettato per una
sola append SOAP locale a conferma clinica monouso; nessun write e consegnato.**

L'ordine downstream e `H1..H10 -> Daybreak independent review -> canonical
docs and claims review -> explicit authority: push -> PR -> merge -> tag ->
release`. Ogni freccia e una dipendenza di verifica. Push, PR, merge, tag e
release restano autorita separate.
