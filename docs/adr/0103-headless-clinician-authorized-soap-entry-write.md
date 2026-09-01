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

Il controller di binding H3 verifica H2b e selection con due continuation
host-owned ordinate e non sovrapposte. La prima cattura una sola volta
`childLease` e `activeRole` e chiude il relativo resource use Web prima che la
seconda catturi selection e `patientVersion`. Solo dopo entrambi i successi H3
costruisce la capsule e invoca la callback sincrona; poi ricontrolla attachment
H2b, attachment selection, identita locali e deadline. Questa sequenza evita
un resource use Web annidato sullo stesso owner reentry-safe senza trasformare
gli snapshot intermedi in authority o rinunciare ai final fence.

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

### Costanti H5a per 0.8.5

H5a e composto da due owner senza authority: il lifecycle host della
presentazione e la review client dedicata. L'handoff canonico ha schema
`mediflow.headless.soap-entry-presentation.v1` ed esattamente le own data key
enumerabili `schema`, `correlationToken`, `fieldSet`, in questo ordine. Il
`fieldSet` e una copia canonica H4; il token e il base64url senza padding di 32
byte CSPRNG host-owned, quindi ha esattamente 43 caratteri ASCII canonici. Il
token correla soltanto la presentazione: non e authority, approval, gesture,
proof, lease o idempotency key e non contiene proposal ref, scope,
registration, identita cliniche o testo SOAP.

Un entry ref H4 puo produrre una sola presentazione. Il lifecycle H5a si
registra e si conferma come dipendente H4 prima di pubblicare handoff o token;
eredita integralmente currentness e scadenza H4/H3 e non introduce un TTL
indipendente. Drain H4, cancel, failure di attach o perdita di currentness
terminalizzano H5a, cancellano registro e copia host; token foreign, stale,
duplicato o non canonico resta inerte. Il controller privato per H5b espone
solo currentness e lifecycle dipendente, mai il field set al caller.

Sul client, l'apertura sigilla il field set una sola volta senza emettere
alcun segnale. Il solo CTA della UI dedicata consuma il gesto; immediatamente
prima di restituire il risultato riapre seal e field set e applica il
confronto byte-esatto H4. Il risultato positivo H5a e esattamente il record
null-prototype e frozen `{ status: 'pin_required' }`, senza token o payload.
Click concorrenti o ripetuti, cancel, close e denial terminalizzano l'owner.
I denial restano quelli H4 piu `gesture_unavailable`, tutti PHI-safe. Mount,
trasporto e adapter applicativi restano H8; H5a non apre route o fetch.

### Costanti H5b per 0.8.5

H5b e un owner process-local separato e non ha authority di scrittura
autonoma. Espone pubblicamente soltanto
`issue(correlationToken, candidatePin)` e `wipe(authorizationProof)`. `issue`
accetta il token canonico H5a, che resta non-authorizing, e il PIN grezzo come
stringa di 4..8 caratteri, senza trim o normalizzazione. Actor, sessione,
ruolo, paziente, ambulatorio, field set, digest, command, idempotenza, approval
e policy non sono mai input caller-supplied.

`issue` reclama una presentazione una sola volta e registra il dipendente H5b
prima della prima operazione asincrona sul PIN. Risolve la sessione Web admin
corrente prima e dopo `verifyHostCredentials` e richiede uguaglianza esatta di
`id`, `userId`, `username`, `role`, `authChannel`, `createdAt` ed `expiresAt`,
oltre alla corrispondenza dell'account verificato. H5b adotta la semantica
canonica di audit e lockout di `verifyHostCredentials`: non duplica bcrypt,
CAS o conteggio dei tentativi. Il ruolo Web non prova il ruolo clinico; il
prerequisito physician deriva soltanto dalla currentness transitiva
H5a/H4/H3/H2b/H2a. PIN invalido, credenziale negata o session drift
terminalizzano la presentazione; un nuovo tentativo richiede nuova
presentazione, seal e gesto.

Il risultato positivo ha esattamente le own data key enumerabili `status` e
`authorizationProof`, in questo ordine, su record null-prototype e frozen.
`status` e `proof_issued`. `authorizationProof` e `hsap_` seguito da 64
caratteri hex lowercase, ottenuti da esattamente 32 byte CSPRNG host-owned. Il
dominio e `mediflow.headless.soap-authorization-proof.v1`. L'owner conserva
soltanto il digest SHA-256 domain-separated della proof, mai il valore raw.
PIN e proof raw non entrano in cookie, URL, storage browser, persistenza, log,
audit, backup o receipt; il loro rilascio e logico e non dichiara zeroization
delle stringhe.

Il record H5b lega privatamente presentazione/dipendente H5a, proiezione Web
esatta verificata, digest della proof, stato e tempo. La currentness H5a porta
transitivamente revoca, selezione, proposta, field set e sessione figlia, ma
H5b non enumera questi binding, non ne dichiara la convergenza completa e non
li espone. H6 deve risolvere e confrontare tutti i binding host completi al
primo consumo; fino ad allora la proof non e un `approvalRef`, un command o
authority eseguibile.

La TTL e esattamente `30000 ms` dal campione clock finale preso dopo PIN
valido, sessione Web invariata e final fence H5a, immediatamente prima della
pubblicazione. L'intervallo e half-open: corrente per `now < expiresAt` e
scaduto per `now >= expiresAt`. Clock e somma devono essere safe integer non
negativi; overflow, valore invalido o rollback terminalizzano. Uno scheduler
host-owned e cancellabile effettua cleanup; una callback anticipata
rischedula il residuo. Il timer non e authority e ogni uso ricontrolla tempo e
currentness.

La proof segue soltanto `minted -> in_flight -> spent`, senza ritorni. Il
controller privato espone esattamente `withCurrentProof`,
`registerDependent`, `confirmDependent`, `unregisterDependent`,
`withCurrentDependent` e `withSingleUseProof`. Tutte le callback sono
sincrone, host-owned e senza argomenti. `withSingleUseProof` porta
atomicamente `minted` a `in_flight` immediatamente prima della callback e
porta sempre a `spent` prima dell'uscita, su successo, throw, risultato
asincrono, reentry, rollback o final fence fallito. Expiry, `wipe`, lock,
logout o drain upstream portano direttamente a `spent`; `wipe` e idempotente
come esito booleano.

I denial PHI-safe H5b sono esattamente `presentation_unavailable`,
`pin_unavailable`, `proof_unavailable`, `proof_expired` e
`lifecycle_unavailable`. Una proof malformed, foreign, restarted, in-flight o
spent e `proof_unavailable`; soltanto una proof nota e minted che raggiunge il
boundary temporale e `proof_expired`. La precedenza e identita/formato,
currentness H5a e sessione Web, tempo, final fence e stato monouso. Dopo il
primo attach H5a ogni denial terminalizza il lifecycle; prima dell'attach gli
input foreign restano inerti.

H5b non importa o riusa `physician_terminal_review`, non crea route, fetch,
`approvalRef`, command, idempotency key, writer, schema clinico o transazione.

Chat, voce/audio trascritti, planner text, Mini e utterance dell'agente possono
solo raccogliere la bozza o richiedere preview. Non possono mai approvare,
coniare un gesto, confermare un PIN o consumare una proof.

### Costanti H6 per 0.8.5

La base H5b vincolante per H6 e `c5ebd50da`. Questa sezione completa il
binding H6 e autorizza soltanto i seam privati necessari a costruirlo. I
service e i facade pubblici H2a-H5b restano invariati. I controller lifecycle
gia fissati restano invariati; eventuali callback con dati di binding vivono
in controller privati distinti, usano gli stessi registry e non creano un
secondo owner.

#### Lineage host-owned

H6 riceve la currentness upstream soltanto in una continuation sincrona
host-owned. La continuation porta una capsule memory-only, null-prototype e
frozen con esattamente queste own data key enumerabili, nell'ordine indicato:

```text
schema, operationId, webSession, activeRole, childLease, selection,
patientVersion, action, purpose, proposal, entryIdentity, payloadDigest,
sealDigest, policyDigest
```

I literal sono:

```text
schema      = mediflow.headless.soap-authorization-lineage.v1
operationId = mediflow.clinical_diary.append_soap.v1
action      = append
purpose     = clinician_requested_documentation
```

Le forme annidate sono chiuse, null-prototype e frozen:

```text
webSession = id, userId, username, role, authChannel, createdAt, expiresAt
activeRole = grantIdentity, principalRef, authenticationGeneration, actorRef,
             attestationRef, attestationVersion, revocationGeneration,
             policyVersion
childLease = parent, child, lease
parent     = identity, contractVersion, generation, revocationGeneration
child      = identity, contractVersion, generation, revocationGeneration,
             proposalBudget, expiresAt
lease      = identity, contractVersion, generation, revocationGeneration
selection  = scopeIdentity, sessionRef, patientRef, ambulatoryRef, leaseRef,
             selectionEpoch, expiresAt
proposal   = proposalIdentity, revision, expiresAt
```

`webSession` e l'esatta proiezione a sette campi gia verificata da H5b.
L'owner Web aggiunge una porta privata closure-bound che, dentro un resource
use corrente, espone il principal ref e una identity opaca, fieldless e
process-local della exact active cell come `authenticationGeneration`. La
porta non cambia la proiezione o il facade Web e non accetta una generation
dal chiamante. `activeRole` lega questa identity, l'identita process-local del
grant H2a, la stessa sessione Web, actor, attestation
ref/version/revocation generation e policy version.

Prima di invocare CSPRNG o pubblicare la proof, H5b conserva l'identita della
proiezione Web owner-issued restituita dal secondo fence del PIN fresco. Entra
e chiude un resource use Web dedicato, cattura privatamente principal ref e
authentication generation e soltanto dopo entra nella continuation H5a. La
continuation deve esporre una volta sola lo stesso principal ref e la stessa
generation per identita; i due resource use non sono annidati. Mismatch,
callback assente o duplicata, risultato diverso dal booleano `true`, throw o
perdita del final fence terminalizzano la presentazione come
`presentation_unavailable`, prima di entropy. Il final fence H5a post-entropy
resta obbligatorio.

`childLease` lega tre identity fieldless distinte per parent, child e lease
H2b e conserva separatamente le tre terne contract version, generation e
revocation generation; il child aggiunge `proposalBudget = 0`, gia consumato
dalla transizione H3, ed expiry. `selection` lega
scope identity, session ref, patient ref, ambulatory ref, lease ref, selection
epoch ed expiry. La source selection canonica risolve insieme
`patientId,ambulatoryId,patientVersion`; l'owner conserva `patientVersion`, la
rilegge dalla stessa source a ogni currentness e richiede uguaglianza. La
versione e un safe integer almeno `1`, non deriva dal selection epoch e non e
letta direttamente da H6. Il registry e il lease pubblico selection restano
invariati.

H3 assegna e conserva `proposal.revision = 1` soltanto nella transizione
riuscita `preview_current -> proposal_current`; il controller di binding la
emette con proposal identity ed expiry. Non esiste una seconda revisione nella
0.8.5. `entryIdentity` e l'identita opaca H4;
`payloadDigest` e la copia canonica H4. `sealDigest` e la copia canonica H4
confermata dal gesto H5a. La capsule non contiene SOAP plaintext, PIN, proof
raw, ciphertext, ID clinici raw, receipt o write authority. Il bundle H4
entra solo nella continuation di consumo e non viene trattenuto da H6.

Le identita opache si confrontano soltanto per `===`. Proiezioni, versioni,
expiry e digest si confrontano per forma chiusa e valore byte-esatto. La
currentness non e un boolean caller-supplied: e il successo delle continuation
ordinate e closure-bound Web, H2a, H2b, selection, H3, H4, H5a e H5b con i
rispettivi final fence; i resource use Web condivisi non sono annidati. H6
conserva la prima capsule senza dati clinici e al consumo ne
richiede una nuova, completa e corrente; qualunque drift nega.

#### Seal handoff H5a

Il lifecycle H5a aggiunge un controller server-only distinto con il solo
metodo `bindGestureSeal(correlationToken, sealBundle)`. Non entra nel facade
production H5a prima dell'adapter H8. Il client gesture owner invoca la porta
di binding soltanto dopo il reopen byte-esatto riuscito e prima di restituire
il gia fissato `{ status: 'pin_required' }`; il risultato pubblico non cambia.

Il controller accetta soltanto il token H5a corrente e l'esatto bundle
`mediflow.headless.soap-entry-seal.v1`. Verifica forma chiusa, assenza di
attachments, uguaglianza di type/date/setting/payload digest con il field set
H4 corrente e ricalcola il seal digest dai tre `ENC:` con il codec H4. Non
dichiara di decryptare server-side: quella prova resta nel client owner H4.
Conserva memory-only una copia canonica del bundle verificato per il solo
handoff H7 e ne proietta nella capsule soltanto `sealDigest`; bundle e
ciphertext non sono conservati da H6. Il primo binding valido porta la
presentazione da `presented` a `gesture_bound`; duplicato, mismatch, perdita
di currentness o failure terminalizzano H5a e upstream. H5b puo emettere una
proof soltanto da una presentazione `gesture_bound`. Cancel, drain, expiry o
proof spent rilasciano bundle e digest.

#### Policy digest

`policyDigest` usa il codec
`mediflow.headless.soap-authorization-policy-digest.v1`, SHA-256 e il framing
UTF-8 length-prefixed unsigned 32-bit big-endian H1/H4. L'ordine esatto e:

```text
mediflow.headless.soap-authorization-policy-digest.v1
mediflow.clinical_diary.append_soap.v1
clinician_confirmed_single_use.v1
physician
append
clinician_requested_documentation
1
300000
120000
30000
mediflow.headless.soap-entry-field-set.v1
mediflow.headless.soap-entry-payload-digest.v1
mediflow.headless.soap-entry-seal.v1
mediflow.headless.soap-entry-seal-digest.v1
mediflow.headless.attachments.absent.v1
```

Il golden hex e
`1175ad0f063ac03d73f71afce252a7922e359882c9c1f7313a5cbc445e3a5f17`.
Il digest ha la forma chiusa `codec,sha256`, quindi `bytes,hex`; e una
costante H6, non una source configurabile. Una policy diversa richiede
amendment.

#### Identita e API H6

H6 genera con tre draw CSPRNG indipendenti, in quest'ordine:

```text
commandId      = hsac_<64 hex lowercase>
approvalRef    = hsaa_<64 hex lowercase>
idempotencyKey = hsai_<64 hex lowercase>
```

Ogni suffix usa esattamente 32 byte host-owned. Non esistono retry: entropia
malformata, throw o collisione live/tombstoned negano e bruciano una proof gia
reclamata. Le tombstone durano quanto il processo. H6 conserva soltanto il
digest domain-separated della authorization proof, mai la stringa raw.

L'owner H6 espone `{ service, approvalController }`; soltanto `service` entra
nel facade H6. Il service espone esattamente:

```text
bind(authorizationProof)
wipe(approvalRef, authorizationProof)
```

`bind` restituisce un record null-prototype e frozen con le sole key
`status,approvalRef,idempotencyKey`, dove `status = approval_bound`.
`commandId`, capsule e digest non attraversano il facade. `wipe` richiede la
coppia esatta ref/proof, restituisce `true` soltanto alla prima
terminalizzazione e usa la proof caller-held solo per unregister e cleanup;
non la conserva.

L'`approvalController` privato H7 espone soltanto
`withSingleUseApproval(envelope, operation)`. `envelope` e il record chiuso
H7 null-prototype e frozen, non Proxy, con le sole own data property
enumerabili, non writable e non configurable, nell'ordine `approvalRef`,
`idempotencyKey`, `authorizationProof`; symbol, accessor o chiavi ulteriori
negano. `operation` riceve un `boundCommand` null-prototype e frozen con
esattamente:

```text
schema, commandId, approvalRef, idempotencyKey,
authorizationProofDigest, lineage, sealBundle
```

`schema = mediflow.headless.soap-bound-command.v1`. `lineage` e la capsule
appena ri-risolta; `sealBundle` e la copia canonica H5a appena ri-risolta
nella stessa continuation e contiene i tre ciphertext da consegnare a H7.
La callback e sincrona, host-owned e void. Async,
generator, Proxy, thenable/Promise, throw, risultato non-void o reentry negano
e bruciano approval e proof.

#### Lifecycle e handoff H6 verso H7

Lo stesso proof owner H5b espone alla sola composition H6 un controller di
binding distinto con esattamente
`withCurrentDependentBinding(authorizationProof, registration, operation)` e
`withSingleUseDependentBinding(authorizationProof, registration, operation)`.
Entrambi restituiscono `Promise<boolean>` e invocano la callback sincrona
host-owned come `operation(lineage, sealBundle)`. La registration viene creata,
confermata o ritirata soltanto dai tre metodi gia fissati sul lifecycle
controller H5b; i due controller riusano record e registry. Il controller di
binding non entra nel facade H5b e non cambia le callback zero-arg. Un proof
H5b puo avere un solo dipendente H6.

H6 usa soltanto `bound -> in_flight -> spent`. Non introduce timer o TTL: la
sua validita e l'intersezione della proof H5b residua, al massimo `30000 ms`,
e di tutta la lineage upstream. `bind` registra e conferma il dipendente H5b,
acquisisce e valida la prima capsule, genera le tre identita e pubblica solo
dopo il final fence. Non chiama il consumo monouso: la proof resta `minted`.

`withSingleUseApproval` controlla prima la tripla envelope e il proof digest,
poi entra nel consumo atomico H5b con l'esatta registration H6. H5b
ri-risolve internamente lineage e bundle mentre la proof e ancora `minted`,
applica tempo e final fence, porta la proof a `in_flight` e soltanto allora
invoca la callback H6. H6 confronta la capsule, passa `bound -> in_flight` e
invoca H7. Prima dell'uscita entrambi sono sempre `spent`, su successo o
failure. H7 deve contenere nella callback l'intera transazione sincrona; H6
non conserva receipt e non consente lavoro differito.

Una tripla malformed, foreign o non corrispondente resta inerte. Dopo la
corrispondenza esatta, expiry, currentness loss, drift, callback failure,
rollback o final fence bruciano approval e proof e drenano H5a-H2b. Restart
prima del commit nega; replay durevole, conflict e risposta persa dopo commit
sono esclusivamente H7b e non riattivano H6.

I denial PHI-safe H6 sono esattamente `proof_unavailable`, `proof_expired`,
`binding_unavailable`, `approval_unavailable`, `binding_changed` e
`lifecycle_unavailable`. La precedenza di bind e proof, registration H5b,
currentness/capsule, policy, entropia/collisioni e final fence. La precedenza
del consumo e envelope, lookup/stato, idempotency e proof digest,
currentness/tempo H5b, ri-risoluzione e confronto capsule, transizione monouso
e callback H7.

H6 non importa route, adapter, cookie, `SecurityProvider`, schema clinico,
Drizzle, SQLite, writer, audit, log o persistenza. Non accetta SOAP, patient
ID, ambulatory ID, field set, seal digest, version, epoch, policy, command o
idempotency dal chiamante. Fermare se compare un secondo proof owner, un TTL
H6, capsule caller-supplied o serializzata, patient version derivata
dall'epoch, proposal revision diversa da `1`, proof raw trattenuta, callback
asincrona, accesso DB/route o qualunque writer, replay o receipt H7.

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

#### Contratto H7a dell'Application Service

H7a espone un solo metodo server-only:

```text
execute(envelope: unknown): Promise<HeadlessSoapEntryCommitResultV1>
```

Il risultato di successo e un record null-prototype, frozen e chiuso con le
sole key `status,receipt`, dove `status = entry_committed`. Fresh commit e
replay esatto hanno la stessa shape e la stessa snapshot di receipt: non
espongono un flag `fresh`, `replay` o altra informazione sul percorso. La
receipt e il record canonico H7b; H7a non la estende e non la ricostruisce.

L'envelope conserva l'ordine e le regole H6: record null-prototype e frozen,
non Proxy, con le sole own data property `approvalRef`, `idempotencyKey`,
`authorizationProof`, enumerabili, non writable e non configurable. H6 e H7a
usano un solo parser server-only condiviso. Il parser produce una copia
canonica dell'envelope e il digest domain-separated della proof; la proof raw
resta effimera, non raggiunge alcun port durevole e non viene mai persistita.

H7a orchestra soltanto quattro authority private:

1. l'`approvalController` H6 con `withSingleUseApproval`;
2. il selection-currentness controller dell'owner production che risolve una
   selection scope identity autentica senza esporre registry o projection;
3. un lookup H7b sincrono che riceve soltanto
   `approvalRef,idempotencyKey,authorizationProofDigest` e restituisce
   `missing`, `exact` con receipt canonica oppure `conflict`;
4. un commit H7b sincrono che riceve soltanto il `boundCommand` owner-issued
   da H6 e il commit binding canonico prodotto dal controller selection; la
   transazione termina interamente prima del return.

Il selection-currentness controller resta una property non pubblica dello
stesso process owner che contiene registry e controller H3. Espone soltanto:

```text
withCurrentCommitBinding(scopeIdentity, expected, operation): boolean
```

`expected` e il record chiuso
`webSessionId,sessionRef,patientRef,ambulatoryRef,leaseRef,selectionEpoch,patientVersion`.
`scopeIdentity` e l'identita opaca owner-issued conservata nella lineage H6.
Il controller la risolve nel WeakMap dell'owner, confronta byte-esattamente
session locator e tuple opaca, ricontrolla expiry, Web resource cell,
selection e source currentness prima e dopo la callback e passa a `operation`
soltanto `patientId,ambulatoryId,patientVersion` canonici. Questi ID raw restano
nella callback privata e raggiungono soltanto il commit port H7b. `peekSession`
e `registry.lookup` non sono authority H7 e non vengono usati per ricostruire
una projection da una copia della sessione.

Il commit port non accetta l'envelope caller-supplied. Il lookup e il commit
port non ricevono la proof raw. Entrambi sono sincroni perche l'intera H7b
deve restare contenuta nella callback `void` H6; Promise, thenable, callback
duplicata, throw non tipizzato o risultato non canonico sono failure
fail-closed.

Lookup e commit restituiscono solo union null-prototype, frozen e chiuse. Il
lookup usa `{status: missing}`, `{status: exact,receipt}` o
`{status: conflict}`. Il commit usa `{status: committed,receipt}` oppure un
denial `{status: denied,code}`, dove `code` e soltanto
`binding_unavailable`, `idempotency_conflict`, `receipt_unavailable`,
`storage_unavailable` o `lifecycle_unavailable`; non restituisce boolean,
`undefined`, errori raw o union estendibili. H7a espone
`HeadlessSoapEntryCommitError`, che contiene
soltanto uno dei codici H7a fissati sotto. Rejection, throw arbitrario, union o
receipt malformata vengono normalizzati a `lifecycle_unavailable` o
`storage_unavailable` secondo il boundary che ha fallito; nessun messaggio
dependency-supplied attraversa il service.

Il lookup H7b segnala una corruzione durevole gia classificata soltanto con
`HeadlessSoapEntryCommitOwnerError`, limitato ai codici
`receipt_unavailable` e `storage_unavailable`. H7a preserva esclusivamente
questi due codici nominali; ogni throw arbitrario o lookalike resta
`storage_unavailable`. La failure tipizzata non aggiunge una quarta shape alla
union del lookup e non trasporta dettagli storage.

L'ordine H7a e vincolante:

1. validare e copiare l'envelope, quindi calcolare il proof digest;
2. eseguire il lookup durevole prima di H6;
3. su `exact`, restituire la receipt senza currentness, consumo H6 o write;
4. su `conflict`, negare senza currentness, consumo H6 o write;
5. su `missing`, entrare una volta in `withSingleUseApproval`;
6. dentro la callback sincrona, entrare nel selection-currentness controller;
   dentro la sua callback lasciare a H7b il secondo lookup come race fence e,
   soltanto su miss, il CAS SQLite e il commit atomico;
7. se H6 conferma e la callback ha prodotto una receipt canonica, restituirla;
8. dopo ogni esito dubbio -- H6 `false`, selection final fence perso, receipt
   mancante o failure dopo un possibile commit -- ripetere una sola volta il
   lookup esatto dopo H6; il post-lookup non riattiva H6 e non riscrive;
9. applicare la precedenza finale `exact > conflict > receipt/storage error >
   denial catturato > approval_unavailable`; rejection o shape H6 invalida e
   `lifecycle_unavailable`;
10. senza receipt durevole, non restituire mai la receipt catturata da un
    commit il cui selection o H6 final fence non e confermato.

La chiave di replay e la tripla esatta caller-held
`approvalRef,idempotencyKey,authorizationProof`, verificata durevolmente come
`approvalRef,idempotencyKey,authorizationProofDigest`. La proof raw non entra
nel database. Un replay e `exact` soltanto se H7b verifica anche integrita e
coerenza della receipt, dell'entry, dell'audit e dei digest di binding
persistiti. Qualunque stessa idempotency key con approval, proof digest o
binding diverso e `idempotency_conflict`; uno stato parziale, incoerente o
tampered e `receipt_unavailable`, mai un replay.

I codici H7a PHI-safe sono esattamente `envelope_unavailable`,
`approval_unavailable`, `binding_unavailable`, `idempotency_conflict`,
`receipt_unavailable`, `storage_unavailable` e `lifecycle_unavailable`.
Malformed envelope precede ogni lookup; replay exact e conflict precedono H6;
un denial H7b catturato precede `approval_unavailable`; una receipt durevole
exact post-commit precede il final denial H6. Errori arbitrari non attraversano
il boundary.

H7a non importa session store, registry, projection facade, schema clinico,
Drizzle, SQLite, route, audit writer, Fabric, provider, venue o egress. Non
genera ID, timestamp o receipt e non decodifica riferimenti opachi. La
composition production lega l'owner H6, il controller selection-currentness
privato e il solo owner H7b; non pubblica controller, registry o port privati.

#### Contratto H7b della transazione SQLite

H7b implementa il solo owner sincrono iniettato in H7a. `lookup`, `commit` e
`snapshotReceipt` terminano prima del return e non avviano Promise, timer,
route, audit asincroni o lavoro differito. H7b importa il database server-side,
lo schema clinico, il parser H4 e le primitive hash/audit minime; non importa
H6, projection registry, route, Fabric, provider, venue, egress o UI.

Lo schema aggiunge una sola tabella `headless_soap_entry_commits` con le
colonne, in ordine canonico:

```text
idempotency_key PRIMARY KEY
approval_ref
authorization_proof_digest
command_id UNIQUE
entry_id UNIQUE REFERENCES entries(id) ON DELETE CASCADE
audit_event_id UNIQUE REFERENCES audit_events(event_id)
receipt_ref UNIQUE
binding_snapshot
binding_digest
entry_digest
audit_snapshot
audit_digest
receipt_snapshot
receipt_digest
committed_at
```

Tutte le colonne sono `NOT NULL`. Il ledger non contiene SOAP, proof raw, PIN,
username, ID paziente o ambulatorio raw, provider, venue, prompt o testo in
chiaro. `command_id` e `entry_id` restano distinti. Il ledger e inserito per
ultimo: una riga esistente implica entry, audit e receipt integralmente
materializzati oppure e una corruzione, mai uno stato parziale valido.

Gli identificatori persistiti sono deterministici e non riusano input caller:
`entry_id = hsei_<sha256>`, `audit_event_id = hsea_<sha256>` e
`receipt_ref = hser_<sha256>`. Ciascun digest usa un codec domain-separated v1
distinto e il solo `commandId` H6 canonico come payload. Ogni valore ha 64
cifre esadecimali lowercase dopo il prefisso. Collisione con una riga non
field-exact e `idempotency_conflict` o `receipt_unavailable` secondo che
l'incoerenza preceda o segua un ledger gia accettato.

La receipt H7b e un record null-prototype, frozen e chiuso con le sole key, in
questo ordine:

```text
schema
receiptRef
operationId
outcome
commandId
entryRef
auditEventRef
patientVersion
entryVersion
committedAt
bindingDigest
entryDigest
auditDigest
```

`schema = mediflow.headless.soap-entry-commit-receipt.v1`,
`operationId = mediflow.clinical_diary.append_soap.v1`,
`outcome = entry_committed`, `entryVersion = 1` e `committedAt` e un ISO 8601
UTC canonico a precisione di secondo. `receipt_snapshot` e il JSON canonico
byte-esatto di questo record; `receipt_digest` usa il codec
`mediflow.headless.soap-entry-commit-receipt-digest.v1`. Fresh commit, replay
nello stesso processo, replay dopo restart e replay dopo restore restituiscono
la stessa receipt senza flag di percorso.

`binding_snapshot` e un JSON canonico chiuso che conserva soltanto i campi
serializzabili necessari a dimostrare il binding H6: schema e ID operazione,
command/approval/idempotency e proof digest, Web session ID, principal/actor e
attestation ref con versioni, policy, versioni/generazioni della child lease,
selection refs/epoch/expiry, patient version, action/purpose, proposal
revision/expiry e i digest payload, seal e policy. Le identity JavaScript
opache non sono serializzate. Gli ID clinici raw ricevuti dal commit binding
sono usati soltanto nella transazione e vi compaiono come digest
domain-separated `patientIdDigest` e `ambulatoryIdDigest`.
`binding_digest` e il digest del JSON canonico completo.

`selectionExpiresAt` eredita byte-esattamente `webSessionExpiresAt`, come la
selection production da cui proviene. Le deadline child H2b, selection/Web e
proposal H3 restano lifecycle distinti: H7b ne richiede forma e valore
canonici ma non deduce un ordinamento tra loro e non usa una deadline per
estenderne un'altra. La currentness congiunta e gia provata dalle continuation
H6/H7 prima del commit; il reread durevole non la ricostruisce dai timestamp.

Il lookup usa `idempotency_key` come indice. Una riga assente produce
`missing`. Una riga con `approval_ref` o `authorization_proof_digest` diverso
produce `conflict`. Una riga candidata a replay viene riletta insieme alla sua
entry e al suo audit; H7b ricostruisce e confronta snapshot, receipt e tutti i
digest. Solo una catena integralmente coerente produce `exact`. Righe mancanti,
JSON non canonico, digest drift, riferimenti incrociati incoerenti o entry/audit
tampered causano il solo `HeadlessSoapEntryCommitOwnerError` tipizzato
`receipt_unavailable`; failure SQLite non classificabili restano
`storage_unavailable`.

Il fresh commit usa `runDbServerImmediateTransaction` e, sotto lo stesso
writer lock, esegue esattamente:

1. un secondo lookup del ledger come race fence; `exact` restituisce la receipt
   gia durevole e `conflict` nega senza write;
2. parsing esatto del bound command, della lineage e del seal H4, con confronto
   di proof, command, approval, idempotency, operation, payload, seal e policy
   digest;
3. un solo read-CAS su `patients`, `patients_to_ambulatories` e
   `ambulatories`: patient ID e ambulatory ID devono essere quelli del commit
   binding, il paziente deve essere non archiviato e non tombstoned, la
   membership deve esistere e `patients.version` deve uguagliare la version H6;
4. insert dell'entry `visit` usando byte-per-byte il seal H4 per `date`,
   `title`, `content`, `setting` e `metadata`, con `attachments`, `deleted_at`
   e `deletion_reason` null, version 1 e timestamp espliciti; il normalizzatore
   generico delle route non viene usato e la patient version non viene
   incrementata;
5. insert sincrono dello stesso audit `entry.created`, outcome `success`, actor
   `user` con ref hashato, subject `entry`, source `web`, request null e
   metadata PHI-safe contenenti soltanto operation/command ref e digest;
6. costruzione della receipt e insert del ledger per ultimo;
7. rilettura e verifica field-exact di ledger, entry e audit prima del return.

Ogni throw o denial prima del completamento del punto 7 rollbacka entry, audit
e ledger insieme. Failure di currentness produce `binding_unavailable`; race
su chiave produce `idempotency_conflict`; corruzione o incoerenza durevole
produce `receipt_unavailable`; errori SQLite restano `storage_unavailable` e
shape o lifecycle inattesi `lifecycle_unavailable`. Nessun messaggio raw
attraversa il port.

Il backup artifact v1 aggiunge la collection additiva
`headlessSoapEntryCommits`; artifact legacy che la omettono vengono
normalizzati a `[]`. Non viene esportato globalmente `audit_events`. Ogni riga
H7b esporta le colonne del ledger, inclusi `binding_snapshot`,
`audit_snapshot`, `receipt_snapshot` e i digest; l'entry correlata continua a
viaggiare nella collection `entries`. Il restore effettua prima un preflight
integrale, poi nella transazione target usa l'ordine `entries -> audit H7b ->
ledger`: inserisce un audit H7b assente, riusa quello presente soltanto se
field-exact e rollbacka su ogni collisione diversa prima di cancellare dati.
Audit non correlati restano append-only. Un re-export dopo restore deve essere
byte-equivalente e il replay H7b deve restare `exact`.

La composition production vive in un root server-only interno che crea una
sola istanza H7a legando l'`approvalController` H6, il
`selectionCommitBindingController` del process owner e il solo owner SQLite
H7b. Il facade production esporta esclusivamente
`headlessSoapEntryCommitService`; owner, controller, registry e port DB restano
privati.

### Costanti H8 per 0.8.5

H8 aggiunge soltanto due nomi server-only per il facade production H7:
`headlessSoapEntryCommitWebAdapter` e
`headlessSoapEntryCommitChatAdapter`. Entrambi sono alias 1:1 della stessa
identita frozen `headlessSoapEntryCommitService`, espongono quindi il solo
metodo `execute(envelope)` gia definito da H7a e non introducono wrapper,
branching o semantica dipendente dalla superficie. Web e chat non diventano
authority e un esito conversazionale non viene interpretato come gesto,
approval o proof.

Il modulo H8 importa soltanto il facade production e `server-only`. Non crea
route, transport, listener, request parser, draft, proof, controller, owner,
registry, provider, venue, egress o accesso storage. In particolare non
aggiunge endpoint HTTP, handler Next, socket, IPC, listener CLI o un secondo
parser dell'envelope: ogni validazione e currentness restano quelle di H7.

Mini non viene collegato a H7. Il comando sorgente storico `draft preview`
conserva nel manifest la disposition di provenienza `proposal_only` con motivo
`SYNTHETIC_PREVIEW_ONLY`; H8 non riscrive quella evidenza. La proiezione
operativa locale e invece deny-only: per `draft preview`, come per il roster
Mini referenziale chiuso della 0.8.5, il DTO
`mediflow.mini.headless-referential-status.v1` conserva esattamente
`manualDisposition=manual_only`, `grantability=not_grantable`,
`operationId=null`, `applicationServiceRef=null`, `applyPolicy=none` e
`writesPerformed=0`. La disposition sorgente descrive il candidato storico;
il DTO operativo descrive cio che H8 permette e prevale per l'esecuzione.

La CLI Mini espone soltanto la consultazione pipe-only di questi stati
referenziali. Ogni comando ben formato diverso da `capabilities`, incluso
`draft preview`, termina senza chiamare H7 con errore
`TRANSPORT_UNBOUND` e process exit code `69`. Questo codice non e una denial
clinica, non conia receipt e non prova che esista un transport non raggiungibile:
attesta che H8 non ne seleziona alcuno.

Claim ceiling H8: **due alias server-only locali dello stesso facade H7 e una
proiezione Mini referenziale deny-only; nessuna route, chat runtime, operazione
Mini, authority, transport, parity, integrazione remota o release.**

### Costanti H9 per 0.8.5

H9 congela due DTO language-neutral gia definiti dai gate precedenti. Non
aggiunge un nuovo stadio applicativo e non rende eseguibile il draft su un
client shared-core.

Il draft e il solo record H1 a sei key, nello stesso ordine:

```text
schema
operationId
subjective
objective
assessment
plan
```

`schema = mediflow.soap-draft.v1` e
`operationId = mediflow.clinical_diary.append_soap.v1`. Le quattro sezioni
sono stringhe. Il tipo condiviso e `ClinicianSoapDraftV1`; la costante
`CLINICIAN_SOAP_DRAFT_KEYS` e l'unica lista autorevole delle sei key. Il DTO
non include `status`, digest, paziente, ambulatorio, actor, sessione, proposal,
approval, proof, idempotenza, receipt, provider, venue, egress o authority.
Normalizzazione, limiti, non-vuoto e digest restano responsabilita del
validator H1 host: il codec H9 non li reinterpreta.

La receipt e il record H7b a tredici key, nello stesso ordine:

```text
schema
receiptRef
operationId
outcome
commandId
entryRef
auditEventRef
patientVersion
entryVersion
committedAt
bindingDigest
entryDigest
auditDigest
```

Il modulo puro condiviso espone il tipo
`ClinicianSoapEntryCommitReceiptV1`, le costanti letterali H7b e
`CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS`, piu il solo parser
`snapshotClinicianSoapEntryCommitReceipt(value)`. Non importa `server-only`,
database, schema, owner, route, Fabric, provider, venue, egress o UI e non
esegue I/O.

Il parser accetta soltanto un ordinary object intrinseco, come quello prodotto
da `JSON.parse`, oppure un record null-prototype gia frozen con property non
scrivibili e non configurabili. L'input non puo essere un Proxy e deve avere
esattamente le tredici own data property enumerabili, nell'ordine canonico,
senza accessor, symbol, key mancante o extra. I literal,
i pattern dei ref e dei digest, le versioni positive e il timestamp UTC a
precisione di secondo devono rispettare H7b. L'output e sempre una nuova copia
null-prototype, frozen e chiusa. Il parser non dimostra l'integrita del ledger,
la relazione deterministica tra i ref o l'esistenza di entry e audit: queste
verifiche restano nell'owner H7b.

Il golden H9 tracciato e unico e contiene soltanto dati sintetici. Congela:

- il draft a sei key usando le stesse quattro sezioni sintetiche del golden H4;
- una receipt a tredici key con `patientVersion = 7`, `entryVersion = 1`,
  `committedAt = 2026-08-31T23:45:12.000Z`,
  `commandId = hsac_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
  `bindingDigest` composto da 64 `e`, `entryDigest` da 64 `f` e
  `auditDigest` da 64 `0`;
- i tre ref derivati dal `commandId` con gli esatti domini H7b e la funzione
  `SHA-256(domain + NUL + commandId)`:
  `mediflow.headless.soap-entry-id.v1`,
  `mediflow.headless.soap-entry-audit-id.v1` e
  `mediflow.headless.soap-entry-receipt-ref.v1`; i risultati sono
  `entryRef = hsei_36647f110c8e0f4271a40a0bff529323bb5dfcf83615d1384703560aaa82d19f`,
  `auditEventRef = hsea_3be641fc6ff30e2cebb20f7cb14b3ce99dfab5065b3a7dc9b4d2130b6ef3fcce`
  e
  `receiptRef = hser_e5bdc96f3ec004423c2ca2716bf49e40ade4e1f7ab196a6b7a3ac6699bf57b14`;
- l'ordine delle key e il JSON canonico compatto UTF-8, senza BOM o whitespace,
  di entrambi i DTO;
- i campi canonical self-describing `receiptDigestCodec =
  mediflow.headless.soap-entry-commit-receipt-digest.v1` e
  `receiptDigestHex =
  4374289aaf2aff0ea046e7c3bc301d940d41f3fc38d905dee1496051139fe483`,
  con il digest calcolato come SHA-256 di
  `mediflow.headless.soap-entry-commit-receipt-digest.v1 + NUL +`
  `canonicalReceiptJSON`.

Un generatore deterministico possiede i valori sintetici e supporta una
modalita `--check` che confronta il golden tracciato senza riscriverlo. Il test
TypeScript usa i codec di riferimento. Il test `MediFlowCore` decodifica il
medesimo artifact, verifica literal e tipi e ricostruisce i due JSON canonici
byte-per-byte con un encoder a ordine esplicito. `JSONEncoder` con ordine non
dimostrato non e un oracolo equivalente.

Il gate CI H9 deve osservare lo stesso commit candidato su tutte le gambe:

- il drift check del generatore e il test TypeScript;
- il test `MediFlowCore` su Linux e Windows nel required check
  `core-tri-os`;
- lo stesso test Swift nella suite macOS Apple.

Un test locale, una singola gamba verde, esiti su commit diversi o un check
skipped non provano tri-OS. Fino a quando i check Linux, Windows e macOS non
sono verdi sulla stessa SHA, lo stato resta `HOLD_TRI_OS_CI_SAME_SHA`.

Il golden non contiene ID paziente o ambulatorio raw, identita utente, SOAP
reale, proof, PIN, token, sessione, route, transport o authority. Draft e
receipt sono dati: nessuno dei due e un grant, un envelope H7 o una chiamata a
`execute`.

Claim ceiling H9: **contratto DTO e golden sintetico byte-exact verificabili
localmente; la portabilita tri-OS resta in HOLD fino a CI Linux, Windows e
macOS verde sulla stessa SHA; nessuna authority, route, transport, UI, parity
applicativa, integrazione o release.**

### Costanti H10 per 0.8.5

H10 aggiunge una sola suite integrata evidence-only sul tree candidato esatto.
La suite usa fixture sintetiche, un database temporaneo isolato e le
composition production gia esistenti da H1 a H8. Non aggiunge codice runtime,
una seconda composition, un owner, un controller, una porta o un export per i
test.

La suite contiene sei gruppi di prova, in questo ordine:

1. **Denial.** Un draft, envelope, proof, binding o receipt malformed,
   foreign, scaduto o stantio deve negare con il codice PHI-safe previsto. Il
   test confronta prima e dopo i conteggi di entry, audit e ledger e richiede
   zero delta.
2. **Race.** Due dispatch concorrenti dell'envelope esatto possono
   materializzare al massimo una entry, un audit e una riga ledger. Ogni
   successo osservabile deve restituire la stessa receipt canonica; nessuna
   seconda proof, approval o idempotency authority viene coniata.
3. **Rollback.** Un trigger SQLite creato soltanto nel database temporaneo del
   test forza un abort dopo l'inizio della transazione e prima del ledger
   completo. L'esito deve lasciare zero entry, audit e ledger H7b per il
   comando; approval e proof restano consumate e lo stesso envelope non puo
   riprendere il commit dopo la rimozione del trigger.
4. **Replay.** Dopo un commit completo, la tripla envelope esatta restituisce
   byte-per-byte la receipt durevole anche quando l'authority upstream non e
   piu corrente. Il replay non entra in H6, non ricrea currentness e non
   modifica entry, audit o ledger.
5. **Conflict.** La stessa `idempotencyKey` con `approvalRef` o
   `authorizationProofDigest` differente deve produrre
   `idempotency_conflict` prima di qualunque write o consumo di authority
   estranea. Entry, audit e receipt originarie restano invariate. Un binding o
   una chain durevole tampered e invece `receipt_unavailable`, mai conflict.
6. **Assenza di authority union.** Gli alias Web e chat devono essere la
   stessa identita del facade H7; Mini resta senza transport. Un oggetto che
   unisce l'envelope a receipt Fabric, provider, venue, Mini, patient ID,
   operation o altre key deve fallire la shape H7 con zero write. Nessun
   oggetto Fabric, Mini, route, adapter o DTO H9 puo sostituire
   `approvalRef,idempotencyKey,authorizationProof` o ampliare la singola
   operazione SOAP.

Il test puo osservare il database temporaneo e installare o rimuovere il
trigger di failure. Questo accesso e sola strumentazione evidence-only: non
diventa un percorso applicativo e non viene importato da moduli production.
Sono vietati `NODE_ENV` branch, hook di failure runtime, dependency opzionali
solo per i test, timer ambientali aggiuntivi, monkeypatch production e nuovi
export da file `*-production*`. I failure vengono indotti ai boundary reali
con input ostili, concorrenza e primitive SQLite limitate alla fixture.

Ogni gruppo parte da uno stato sintetico noto oppure registra la baseline
prima del gesto. La suite verifica insieme esito pubblico, terminalita delle
authority coinvolte e stato durevole; un solo assert sul codice errore o sul
conteggio non chiude il gate. Nessun log o failure output contiene SOAP,
identita cliniche raw, proof o payload persistiti.

H10 e verde soltanto sul commit che contiene H1-H9 e tutte le composition
production corrispondenti. Non sostituisce la review indipendente successiva,
non prova host compromesso, crash recovery generale, multiprocesso, UI, route,
transport, parity, integrazione remota o release.

Claim ceiling H10: **evidenza integrata locale sul tree candidato esatto per
denial, race, rollback, replay, conflict e assenza di authority union; nessun
nuovo seam runtime e nessun claim di release readiness o release.**

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
