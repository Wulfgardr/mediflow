# ADR 0098: autorita per la decisione terminale di review medica

Date: 2026-08-23
Status: Proposed

Issue: WUL-522
Program line: candidato `0.8.5`

Related: [ADR 0090](./0090-giunture-fabric-trust-onboarding-routing-interazione.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md) e WUL-282.

## Problema

ADR 0090 consente solo a un attore `physician` di accettare o rifiutare una
proposta. ADR 0096 rende la stringa `role` solo descrittiva e non autorizzante.
Manca quindi un confine stretto per una decisione terminale di review, prima di
aggiungere runtime.

## Decisione

### Capability e limite della decisione

`physician_terminal_review` e una capability locale, stretta e host-owned. Non
e RBAC e non deriva dalla `role` descrittiva di ADR 0096. Autorizza soltanto
`accept` o `reject` della review corrente risolta dall'host.

La decisione cambia solo il lifecycle durevole proposta/review. Non modifica il
record paziente, non modifica l'output del provider e non crea `applied`.
E una frontiera di *review disposition*, distinta da `R2_admin_apply`.
`R2_admin_apply` resta bloccato e questa ADR non indebolisce WUL-282 o le sue
regole di apply. `applyPolicy=none` e invariabile.

`supersede` resta application-only. La capability non concede invocazione di
provider, job, scrittura clinica, permesso generico o delega.

### Attore e attestazione

Nel candidato 0.8.5, la fonte host per `actorRef` opaco e `users.id` dell'utente
autenticato, risolto lato server dal record utente locale vincolato al PIN. Questa
fonte deve provare una corrispondenza uno-a-uno tra credenziale PIN e utente
locale. Se la credenziale e condivisa o la corrispondenza e ambigua, la route
resta assente.

`actorRef` non puo provenire da `role`, username, body, URL, valore cookie,
identita OS o device, token di pairing o receipt.

`PhysicianReviewAttestationV1` e un record locale, versionato, inattivo per
default e legato a `actorRef`. Contiene soltanto la capability
`physician_terminal_review`, stato, versione dell'attestazione e metadati
PHI-safe necessari alla sua validita. L'installation owner lo provisiona con
una esplicita azione locale di setup/enrollment e PIN fresco.

L'attestazione e un'autorizzazione tecnica di prodotto. Non prova abilitazione
professionale, identita legale o validita di firma elettronica. In 0.8.5 non
esistono route admin, editor, delega, gerarchie di ruolo o un sistema generale
di permessi per questo record.

### Proiezione, review corrente e gesto

La sessione conserva solo `SessionPhysicianReviewAuthorityV1`: `actorRef`,
versione dell'attestazione, generazione della sessione, stato autenticato e
unlocked, scadenza e generazione di revoca. L'host ricontrolla la fonte
canonica quando crea o consuma il gesto. Lock confermato, logout confermato,
cambio credenziale, scadenza, revoca o cambio principal invalidano questa
proiezione prima della richiesta successiva.

L'host crea `ActiveReviewBindingV1` solo sotto il lease del contesto attivo.
Il binding lega sessione, `selectionEpoch`, `reviewContextEpoch`, review
corrente opaca e revisione corrente. L'host risolve esattamente una review; zero
o piu review, selezione stantia o conflitto negano. Il lease impedisce un cambio
concorrente di paziente o review dalla verifica del gesto all'avvio della
transazione terminale. UI, URL, cache, projection e body non identificano la
review.

Un PIN fresco e verificato al boundary di autenticazione puo coniare un solo
`PhysicianReviewGestureV1`. Il gesto e CSPRNG, digest-only, memory-only,
action-bound e valido al massimo 30 secondi con clock monotono. Lega sessione,
attore, versione attestazione, epoch di selezione e review, review, revisione,
azione e acknowledgement dell'incertezza. Il consume e atomico e a uso unico:
`minted -> in_flight -> spent`. Il raw proof non entra in cookie, URL, storage
browser, log, audit, receipt o backup.

Il PIN fresco non crea una sessione step-up riusabile. Il PIN grezzo non oltrepassa
il boundary di autenticazione.

### Route e replay

Quando tutti i gate indicati sotto sono superati, l'unica route puo essere:

```text
POST /api/reviews/current/decision
```

Il body contiene esattamente queste cinque chiavi:

```text
action
expectedRevision
idempotencyKey
gestureProof
uncertaintyAcknowledged
```

Path, query e body non accettano `actorRef`, ruolo, paziente, review, selezione
o capability. La route risolve ogni autorita e la review corrente lato host.

La route risolve prima il binding host della review e cerca poi la receipt prima
del controllo di `expectedRevision`. Un replay e ammesso solo se la receipt
durevole esistente corrisponde
esattamente allo stesso attore, binding review, azione, revisione attesa,
idempotency key e versione di policy. Restituisce la receipt esistente senza
una seconda transizione, gesto o audit. Ogni mismatch nega. Ogni tentativo non
replay richiede un nuovo gesto valido.

La route chiama solo il servizio locale F6-2a per la transizione terminale e la
receipt/audit associata. Il commit `6bdc8c30` e evidenza locale di quel servizio,
non prova di una route registrata. Il fallback backup in `04a35b03` resta
separato: il gesto non entra mai nel backup e la continuita backup resta `HOLD`.

## Gate di abilitazione

La route resta assente e non registrata finche P1-P8 non passano ciascuno con
verifica indipendente.

1. **P1, attore:** verifica la mappatura server-side `users.id`/PIN e rifiuta
   fonte ambigua, condivisa o caller-supplied.
2. **P2, attestazione:** verifica record inattivo di default, provisioning
   locale con PIN fresco e denial per attore, stato o versione errati.
3. **P3, sessione:** verifica la proiezione fail-closed e l'invalidazione dopo
   lock, logout e cambio credenziale confermati, oltre a expiry e revoca.
4. **P4, review attiva:** verifica `ActiveReviewBindingV1`, lease e protezione
   TOCTOU contro switch di paziente/review e race tra tab.
5. **P5, gesto:** verifica TTL di 30 secondi, binding completo, uso unico,
   invalidazione, restart fail-closed e assenza da log, storage e backup.
6. **P6, PIN fresco:** verifica che solo una ri-verifica PIN lato server conii
   il gesto e che non esista uno step-up di sessione riusabile.
7. **P7, servizio terminale:** verifica F6-2a, CAS, lifecycle review-only,
   receipt/replay esatto e audit PHI-safe senza record paziente, provider o
   apply.
8. **P8, integrazione indipendente:** con fixture sintetiche, verifica tutti i
   denial, un solo vincitore concorrente, replay esatto, assenza di route prima
   del gate, body a cinque chiavi e nessun percorso apply/provider/job.

Ogni packet resta sotto 300 LOC e un solo confine di autorita. Un fallimento
mantiene la route assente; non autorizza fallback, degradazione o bypass.

## Evidenza e riconciliazione

ADR 0090 resta la fonte del vocabolario review e dell'assenza di `applied`.
ADR 0096 resta la fonte per il fatto che `role` e descrittiva. Questa ADR non
le sostituisce.

La proposta sibling ADR 0097
`0097-active-role-session-and-step-up-authorization.md` al commit
`89645257fd76b08009ddb6d4533b8bde608d0f9d` riserva il numero 0097 a livello
di programma ed e solo evidenza candidata. Non e in questa base, non e
combinata con essa e non rende accettato alcuno stato. L'artefatto Pro privato
con body SHA
`62d300bafa1650ea17f150979337861992d4a504da78c426d8218e0c1a81b845` e consiglio,
non autorita. WUL-564 deve riconciliare entrambe le ADR prima di integrazione.

## Alternative scartate

- Usare `role`, login PIN, cookie, pairing, receipt o single-user mode come
  prova di medico: confonde segnali tecnici con capability specifica.
- Introdurre RBAC, editor di permessi o delega: supera il confine 0.8.5.
- Persistire o firmare il gesto: amplia lifecycle, revoca e superficie backup.
- Accettare una review da identificatori caller-supplied: apre un bypass del
  binding host-owned.

## Non-obiettivi

Questa ADR non aggiunge runtime, schema, migrazioni, session hook, route, UI,
test, provider, dati clinici, cloud, egress, apply, promozione o modifica
backup. Usa solo contratti e fixture sintetiche nelle verifiche future.
