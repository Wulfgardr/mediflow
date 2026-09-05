# ADR 0105: assunzione di integrita del processo per l'auth web

Date: 2026-08-28
Status: Accepted

Issue: WUL-522
Program line: candidato `0.8.5`
Exact evidence: H1a `7c98474a13ce03c14b46f66d963dcb0ea2d780af`

Related: [ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0102](./0102-document-synthesis-source-authority.md) e
[SECURITY.md](../../SECURITY.md).

## Problema

H1a acquisisce una sessione web autenticata e il relativo projection owner
attraverso un boundary privato e fail-closed. La primitive Next `cookies()`
restituisce pero una Promise nativa. Il suo settlement avviene nel runtime
JavaScript condiviso e non puo essere reso indipendente da una mutazione
process-global persistente di `Object.prototype.then` senza cambiare anche il
boundary framework.

Serve rendere esplicito quale integrita del processo assume il candidato
0.8.5, quale minaccia resta fuori dal contratto e quali prove bloccano H1b e la
promozione.

## Decisione

### Assunzione accettata per H1a

Il core H1a opera sotto un'assunzione di integrita process-global:

- dati controllati dalla richiesta non possono modificare prototype globali;
- codice non fidato non viene eseguito nello stesso processo con facolta di
  monkeypatch globale;
- dipendenze, bootstrap e moduli server trusted non modificano
  `Object.prototype.then` durante una richiesta autenticata.

Una mutazione gia presente all'ingresso o introdotta da un callout sincrono
osservato da H1a deve negare senza pubblicare sessione o owner. Il boundary
non trasforma cookie, body, route, adapter o provider in authority.

Questa e un'assunzione tecnica limitata, non una proprieta dimostrata contro
un host compromesso o contro codice arbitrario gia in esecuzione nel processo.

### Evidenza e limite osservato

Alla SHA H1a esatta, `lib/security/server-auth.ts`:

- controlla l'assenza di un `then` ambient prima dell'ingresso e attorno ai
  callout sincroni;
- richiede una Promise cookie nativa dello stesso realm;
- costruisce il contesto finale come record `null`-prototype, frozen e con i
  soli riferimenti `session` e `owner`;
- restituisce `null` su errore, forma ostile o perdita dell'assunzione rilevata
  prima dell'ingresso o durante callout applicativi sincroni.

I test H1a provano il diniego pre-entry, la Promise cookie nativa, gli stati
sessione/database negati e l'uso degli intrinsic catturati. Non provano
l'integrita generale del processo.

Una mutazione persistente e concorrente di `Object.prototype.then` durante il
settlement della Promise nativa di `cookies()` puo invece impedire il settlement
e negare disponibilita. Nel perimetro osservato non pubblica un contesto
autenticato, non concede authority e non avvia callout applicativi di stadi
successivi. Questo residuo resta un rischio di disponibilita, non una garanzia
contro ogni forma futura di reentry o modifica del framework.

### Responsabilita delle rejection e diniego dei Proxy

Il gate distingue tre casi. Questa distinzione non amplia gli input accettati:

1. **Promise nativa accettata dal boundary.** Se il producer canonico
   `cookies()` consegna una Promise nativa dello stesso realm e H1a la accetta,
   H1a possiede il settlement. Ogni rejection deve diventare denial osservata,
   senza `unhandledRejection`, lavoro post-denial o pubblicazione di authority.
2. **Rejection osservabile dal producer.** Se un adapter, un caller o una
   fixture crea una Promise che H1a non accetta, il producer conserva
   l'identita della Promise e deve consumarne la rejection prima di presentare
   il valore al boundary. Il diniego di H1a non trasferisce questa
   responsabilita.
3. **Target nascosto dietro un Proxy.** H1a deve negare il `Proxy` prima di
   riflessione o assimilazione, con zero trap. Il boundary non puo recuperare
   in modo sicuro una Promise target nascosta dal producer. Non deve chiamare
   `then`, `Promise.resolve`, `await` o un trap per tentare di consumarne la
   rejection. Una rejection non gestita del target resta un difetto del
   producer fuori contratto, non una rejection accettata dal boundary.

Il terzo caso non e un'eccezione runtime. E ammesso soltanto come falsificatore
sintetico isolato quando la fixture dimostra insieme che:

- la fixture possiede il target e ne consuma la rejection prima del wrapping;
- H1a nega il `Proxy` con zero trap e senza assimilazione;
- non vengono pubblicati sessione, owner, contesto o altra authority;
- non restano lavoro differito, mutation o stato recuperabile dal boundary;
- nessun listener o handler process-global sopprime rejection in produzione.

Una rejection non gestita di una Promise ordinaria, di una Promise accettata o
del producer canonico resta sempre un blocco di promozione. La classificazione
non autorizza Proxy, thenable arbitrari, monkeypatch globali o una riduzione del
threat model.

### Alternative escluse dalla 0.8.5

Non introduciamo in questa release:

- timeout o policy di race non misurati;
- freeze globale dei prototype o monkeypatch del runtime;
- riscrittura ampia di `requireSession` o del framework auth;
- capability pre-acquisite o redesign delle route;
- un nuovo boundary pubblico per aggirare la Promise cookie di Next.

Queste opzioni aumentano il perimetro o spostano il rischio senza una prova
proporzionata. Una loro futura adozione richiede un packet e una decisione
separati.

## Threat actor e confine

Il boundary copre input di richiesta, oggetti ostili presentati alle funzioni
H1a e drift sincrono nei callout osservati. Non copre malware, host OS
compromesso, dipendenza server malevola, plugin in-process non fidato o codice
trusted che mantenga una mutazione globale concorrente.

Se una di queste capacita entra nel threat model operativo, l'assunzione non e
piu valida e H1a torna in `HOLD_SECURITY`.

## Gate H1b e release

H1b puo procedere solo se conserva la SHA H1a esatta nella propria ancestry,
consuma esclusivamente il contesto canonico H1a e ripete i falsificatori sul
tree integrato. H1b non puo ampliare `requireSession`, accettare un contesto
ricostruito o trattare una denial come sessione valida.

Prima della release, la review di sicurezza sull'exact release candidate deve:

1. verificare che nessun input di richiesta raggiunga mutation di prototype;
2. ripetere poison pre-entry e durante ogni callout sincrono;
3. verificare che il poison persistente durante la Promise cookie produca al
   massimo denial/disponibilita e mai pubblicazione di sessione o owner;
4. provare sul runtime Node.js 24 / ABI 137 risolto per il candidato exact-SHA
   e su Next.js 16.3.4 che il producer canonico `cookies()` consegni una Promise
   nativa dello stesso realm, non un `Proxy` o un thenable arbitrario;
5. verificare che ogni rejection ordinaria, accettata o del producer canonico
   sia gestita e non lasci lavoro differito o authority recuperabile;
6. verificare il falsificatore sintetico del target nascosto con ownership
   della fixture, zero trap, zero authority e nessuna assimilazione o
   soppressione globale;
7. riesaminare bootstrap, dipendenze server e nuovi plugin in-process.

Un esito diverso, una mutazione globale raggiungibile da input, una modifica
della semantica `cookies()`, un nuovo runtime multi-tenant o un plugin
in-process non fidato sono trigger obbligatori di revisione.

## Addendum 2026-09-03: evidenza sul producer Next 16.3.4

La decisione e il claim ceiling restano invariati. Il gate unico
`npm run check:web-auth-lifecycle-owner-boundary` include ora due prove prima
della promozione:

- `lib/security/web-auth-next-producer-boundary.test.ts` costruisce una App
  Route temporanea con il Next installato, la avvia sul solo loopback in
  configurazione production e osserva il vero `cookies()` di `next/headers`;
- `lib/security/server-auth.test.ts` ripete sul consumer H1a/H1b la matrice
  avversaria integrata.

Sul runtime fissato dal gate, la App Route deve osservare esattamente:

- Node.js `24.19.0` e Next.js `16.3.4` anche dentro la route;
- una Promise riconosciuta da `node:util.types.isPromise`, non riconosciuta
  come `Proxy` e con prototype identico a `Promise.prototype` dello stesso
  realm;
- per entrambi i cookie auth, un record non-Proxy con prototype
  `Object.prototype`, sole chiavi proprie `name`, `value`, `path`, `path: "/"`
  e data descriptor enumerabili, configurabili e scrivibili.

La matrice consumer verifica diniego senza pubblicazione di owner per poison
pre-entry, durante il settlement e in ciascun callout sincrono osservato:
`cookies`, `cookieStore.get`, resolver, predicate, query builder, lettura,
ritiro e acquisizione owner. Nega inoltre Promise fake, cross-realm, subclass
e nascoste da `Proxy` senza assimilarle; i cookie Proxy o con accessor restano
negati senza eseguire trap o getter. La rejection della Promise nativa
accettata resta consumata dal boundary.

La fixture e sintetica, viene rimossa nel `finally`, disabilita la telemetria
Next e non modifica route applicative. Build e richiesta loopback hanno timeout
espliciti; la suite gira con concorrenza uno per non sovrapporre mutation
process-global o inventari del resolver.

Questa prova non copre Edge runtime, host compromesso, dipendenze malevole,
plugin in-process non fidati, disponibilita sotto poison persistente e
concorrente, catena auth completa o sicurezza generale. Non rende valida per
analogia una futura versione di Node o Next: il gate va ripetuto sull'exact
release candidate e ogni drift riporta la promozione in `HOLD_SECURITY`.

## Addendum 2026-09-04: patch Node risolta e riprovata dal gate

Il requisito di prodotto resta Node.js 24 con ABI moduli `137`; Next.js resta
fissato a `16.3.4`. La prova `24.19.0` sopra rimane evidenza storica, ma la patch
Node non e piu un letterale nel sorgente del test. Il workflow `node-version: 24`
puo ricevere una patch compatibile successiva e deve rieseguire l'intero probe,
non accettarla per analogia.

Il test ora registra la patch exact nel proprio nome, richiede major 24 e ABI
137 nel processo del gate e verifica che la vera App Route riporti la stessa
versione exact e lo stesso ABI. Un cambio di major, ABI, versione Next o
semantica di Promise/cookie resta fail-closed e riporta la promozione in
`HOLD_SECURITY`.

## Claim ceiling e stop rule

Il claim massimo e: **H1a e un candidato locale fail-closed sotto
l'assunzione documentata di integrita process-global; il residuo noto e una
possibile perdita di disponibilita senza pubblicazione osservata di authority.**

Fermare H1b o la promozione se il poison pubblica un contesto, resta lavoro
post-denial, una rejection ordinaria o canonica non e gestita, `cookies()` non
rispetta il contratto verificato, l'assunzione non e verificabile sul tree
integrato o la review di sicurezza non copre questo confine. Fermare anche se
il falsificatore del target nascosto esegue trap, assimila il valore, pubblica
authority o usa soppressione globale.

Questo ADR non dimostra la catena auth completa, sicurezza generale,
compliance, disponibilita, integrazione, release readiness o release. Non
modifica runtime, test, route, cookie, database, provider, persistenza o apply.
