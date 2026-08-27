# ADR 0104: fence di revoca Web lock e trasporto credenziali

Date: 2026-08-27
Status: Accepted

Issue: WUL-522
Baseline: `8a8f314b843d15f5e6de6e220ed948751737d0b0`
Program line: candidato `0.8.5`

Related: [ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0097](./0097-active-role-session-and-step-up-authorization.md) e
[ADR 0017](./0017-auth-lockout-policy.md).

## Problema

Il Web lock deve revocare l'autorita server prima della richiesta protetta
successiva anche se login, setup o lock terminano fuori ordine. I browser
possono applicare tardivamente una risposta `Set-Cookie`; quindi il solo ordine
client, un abort o una coda non provano l'ordine del server.

Il candidato conserva per ora il cookie bearer fisso `mediflow_session`.
Serve un confine che impedisca a una sessione Web precedente o a un completamento
auth tardivo di riaprire autorita dopo un lock, senza dichiarare una migrazione
native o una nuova sessione durevole.

## Contesto e perimetro

La decisione vale soltanto per una tab browser e un processo server locali.
Multi-tab, native, multiprocesso, sticky routing, replica, sessioni durevoli e
ripristino dopo restart sono esclusi. Tutti gli identificatori sotto descritti
sono opachi, tecnici e privi di PHI/PII.

`X-MediFlow-Source-Surface` non e autenticato. Non seleziona privilegi,
sessioni o route di autorita. Il bootstrap e il routing native richiedono il
confine P1 separato; questa ADR non dichiara una sua implementazione.

## Decisione

### Canale di controllo e bearer Web

Un solo cookie HttpOnly opaco `mediflow_auth_control` identifica un record
server process-local. Il record possiede una `generation` monotona, al massimo
un'operazione auth pendente, un solo `activeSessionId` Web e record di
idempotenza con TTL e capienza limitati. Il riuso oltre TTL o capienza nega.

L'ETag opaco del record e `If-Match` formano il fence della richiesta. Ogni
mutazione riceve anche una idempotency key casuale. Cookie di controllo, ETag,
fence e key servono solo a ordinare o negare: non provano clinico, sessione,
paziente, ruolo, owner o authority.

La migrazione mantiene `mediflow_session` HttpOnly come bearer autenticato
fisso. Una route Web protetta deve risolvere entrambi i lati: un record control
corrente con binding autentico e il valore esatto del cookie fisso, marcato sul
server con quel canale e quella generation. Un cookie solo, un control solo o
un binding non esatto nega.

### Login e setup con commit finale compare-and-swap

Login e setup possono svolgere I/O e lavoro asincrono fuori dalla breve sezione
di authority server. Subito prima di creare o attivare la sessione cookie, una
sezione sincrona esegue compare-and-swap di control, fence, operation id e
generation. Non esegue `await` mentre possiede il mutex di authority.

Il setup puo committare account o impostazioni nel database prima di quel CAS.
Se il fence nega la sessione, quei dati non riattivano autorita; il recupero e
un login ordinario. Il CAS approvato crea o attiva solo la sessione che il
record control marca come corrente.

### Lock, disposal e risposte tardive

Il lock bypassa la coda auth client. Nella propria sezione sincrona avanza la
generation, invalida il pending, cattura e rimuove la sessione attiva, poi
avvia la disposal e la receipt di Packet A. Non attende audit, I/O o cleanup
sotto il mutex.

Il lock non invia mai `Max-Age=0` per `mediflow_session`. Una risposta auth
tardiva puo sovrascrivere il browser con un ID ormai morto sul server: il solo
esito ammesso e disponibilita fail-closed con nuovo login. Non puo ricreare
authority. Una risposta lock tardiva non puo eliminare un cookie piu nuovo.

Solo la richiesta lock puo restituire una receipt confirmed dopo avere avanzato
il fence e invalidato una login/setup pending sul medesimo control/fence. La
login/setup tardiva cosi invalidata non puo mai confermare o committare sessione
o authority. Control sconosciuto, mancante, stantio o con fence non corrispondente
non puo confermare. Il body della receipt v1 resta invariato; il fence successivo
e soltanto l'ETag.

La conferma di invalidazione e separata dalla persistenza audit. Un fallimento
audit non ripristina sessione, pending o authority e non modifica la receipt
gia definita.

### Native e restart

P1 deve definire un routing/bootstrap native distinto. Durante una compatibilita
transitoria, l'accettazione legacy puo accettare soltanto sessioni che il server
ha gia marcato native e deve rifiutare sessioni Web legacy dopo il cutover.
Non puo scegliere la fiducia da header, cookie, source surface o convenienza.

Un restart globale revoca control, sessioni e idempotenza process-locali.
Nessun record viene ricostruito, replicato o accettato da un altro processo.

### Addendum: commit finale di attivazione e ritiro

Questo addendum raffina i confini P2, P3 e P4. Non modifica P1, P5, P6 o P7.
Il percorso chiuso usa un solo processo e un solo realm JavaScript.

P2 emette un ticket control opaco, esatto e monouso. Il ticket e legato al
record control, al fence, all'operation id, alla generation e al `sessionId`
risolto dall'host. Prima del compare-and-swap (CAS), P2 completa ogni lavoro
che puo negare o fallire. Il CAS non risolve input, non alloca risorse e non
richiama codice esterno.

L'esito P2 e il solo primitivo `0 | 1 | 2`:

- `0`: denial, senza autorizzare una transizione P3;
- `1`: CAS di attivazione riuscito per l'esatto `sessionId`;
- `2`: CAS di ritiro riuscito per lo stesso binding corrente.

Il ticket viene bruciato in ogni esito. Non contiene un `ServerSession`, non
espone authority e non puo essere riassociato a un altro record, fence,
operation id, generation o `sessionId`.

Prima del CAS di attivazione, P3 prepara una cella di sessione inerte e non
risolvibile. La cella e gia installata nella propria posizione finale, ma lo
stato `ARMED_ACTIVATE` non autorizza `requireSession` o un altro resolver. La
prepared capability viene bruciata prima del CAS e non sopravvive al tentativo.

P3 possiede un solo lifecycle guard globale. Dopo un esito P2 pari a `1`, il
guard esegue soltanto la transizione lessicale totale e incondizionata
`ARMED_ACTIVATE -> ACTIVE`. Tra il CAS riuscito e `ACTIVE` non sono ammessi:

- clock o letture di currentness;
- allocazioni o mutazioni di `Map` e `Set`;
- callback, getter, Proxy o assimilazione di Promise/thenable;
- branch, cleanup, audit, log o disposal.

Se la preparazione o P2 negano, P3 trasforma la cella in tombstone terminale.
La cella negata non torna inerte, non diventa attiva e non puo essere riusata.

Il ritiro usa il percorso simmetrico
`ACTIVE -> ARMED_RETIRE -> RETIRED`. P2 restituisce `2` soltanto dopo il CAS
del binding control-generation-session corrente. P3 esegue quindi il solo
flip totale `ARMED_RETIRE -> RETIRED` sotto lo stesso lifecycle guard globale.
Un denial trasforma la cella in un tombstone `RETIRED`, senza riattivarla o
sostituirla.

Una sessione `ACTIVE` non puo essere eliminata, svuotata o fatta scadere con
una mutazione diretta. Lock, logout, expiry e revoca devono usare il ritiro
coordinato per l'esatto binding. Il cleanup delle risorse avviene solo dopo lo
stato `RETIRED` e resta fuori dalla transizione di authority.

Un restart globale nega ogni cella e ticket precedente. Il reset parziale di
un solo modulo non e supportato: P2, P3, lifecycle guard, control store e
session store devono condividere lo stesso ciclo di vita process-local.

Il percorso chiuso non esporta `ServerSession`, celle, primitive di mutazione,
delete/clear attivo o bypass di ticket e lifecycle guard. Un adapter puo
ricevere soltanto l'identificatore opaco o una receipt minima prevista dal
packet; nessun oggetto interno diventa authority caller-owned.

### Packet commit-last e falsificatori

La sequenza interna obbligatoria e:

1. **P2b ticket control:** ticket esatto monouso, binding completo prima del
   CAS ed esito `0 | 1 | 2`.
2. **P3b2a cella e port:** cella inerte non risolvibile, prepared capability
   monouso e lifecycle guard globale.
3. **P3b2b attivazione:** CAS P2 riuscito seguito dal solo flip
   `ARMED_ACTIVATE -> ACTIVE`.
4. **P3b2c ritiro:** `ACTIVE -> ARMED_RETIRE`, CAS P2 e flip `RETIRED`.
5. **Migrazione resolver:** tutti i resolver Web accettano solo `ACTIVE` e non
   espongono oggetti interni.
6. **E2E route/cookie:** race di login, setup, lock, expiry e risposta tardiva
   con sole fixture sintetiche.

Ogni packet modifica un solo confine e resta sotto circa 300 LOC. Fermare e
separare il packet se richiede un secondo owner, route, cookie, cleanup,
persistenza, multiprocesso o piu di circa 300 LOC.

Le prove devono falsificare almeno:

- ticket riusato, clonato, forgiato, Proxy, thenable o legato a un altro
  control, fence, operation id, generation o `sessionId`;
- collisione di `sessionId`, cella gia presente, doppia preparazione e doppio
  active;
- resolver durante `ARMED_ACTIVATE`, `ARMED_RETIRE`, tombstone e `RETIRED`;
- clock, callback, getter, Proxy, Promise, thenable, allocazione o cleanup tra
  CAS riuscito e flip terminale;
- nested activation/retirement, reentry, logout, lock, expiry e restart;
- ritiro per binding errato, ritiro duplicato e tentativo di riattivazione;
- delete, clear o expiry diretti di una sessione `ACTIVE`;
- reset parziale dei moduli, raw `ServerSession` e bypass export;
- risposta persa dopo il CAS e risposta cookie tardiva, senza inferire
  revoca o attivazione dal solo browser.

Il claim massimo di questi packet e: **transizione di authority osservabile
come commit-last, in un solo processo e un solo realm, per l'esatto binding
control-generation-session**. Lost response route/cookie, multiprocesso,
replica, crash recovery e cleanup delle risorse restano `HOLD` separati.

## Alternative scartate

- Slot cookie univoci per generation: scartati per `0.8.5`. Risposte
  arbitrariamente ritardate rendono indimostrabili i limiti hard su cookie
  stantii e header senza un cap di emissione auth separato.
- Abort, timeout, coda client o epoch client-only: scartati come ordinamento
  server; riducono lavoro o UX ma non revocano authority.
- Cancellare il cookie fisso nel lock: scartato; una risposta lock ritardata
  potrebbe cancellare una credenziale browser piu nuova.
- Dare significato auth a `X-MediFlow-Source-Surface`: scartato; e un input
  non autenticato e non sostituisce il boundary native.

## DAG di implementazione e prove richieste

Ogni packet resta sotto circa 300 LOC, modifica un solo confine e usa sole
fixture sintetiche. Nessun packet procede se il precedente non supera le prove
indicate e lo stop rule.

| Packet | Confine e prove minime | Stop rule |
| --- | --- | --- |
| P1 | Routing/bootstrap native: test che header non decide privilegio e legacy accetta solo sessione server-tagged native. | Qualunque Web legacy accettato dopo cutover, o header che seleziona auth. |
| P2 | Kernel control/fence: monotonia, un pending, un active, CAS `If-Match`, idempotenza TTL/capienza e restart deny. | Due pending/active, record ricostruito o input caller trasformato in authority. |
| P3 | Login/setup: prove I/O fuori mutex, CAS finale e setup DB senza sessione dopo fence stale. | `await` sotto mutex o sessione attivata senza CAS corrente. |
| P4 | Lock e Packet A: prove di lock bypass, invalidazione, pending confirmation, receipt v1 e assenza di `Max-Age=0`. | Lock lascia un binding protetto, audit riattiva authority o risposta lock cancella cookie nuovo. |
| P5 | `requireSession`: prove di binding control-generation-session esatto e compatibilita native P1. | Cookie/control isolato autorizza oppure Web legacy passa il cutover. |
| P6 | Client: bootstrap control, ETag, idempotency key e lock fuori coda; race simulate auth/lock tardive. | Il client dichiara revoca prima della conferma server o invia il cookie-delete proibito. |
| P7 | Migrazione, documentazione e race matrix: esecuzione delle prove P1-P6 con fixture sintetiche e claim review. | Claim di runtime/native/authority non provato, PHI/PII, provider, DB o migration fuori packet. |

L'ordine e `P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7`. Ogni test di race deve
mostrare che un auth tardivo puo lasciare soltanto un cookie server-dead e che
un lock tardivo non puo eliminare un cookie nuovo.

## Conseguenze e claim ceiling

Il design rende esplicita la revoca server-side e accetta un temporaneo costo di
relogin dopo una race browser. Mantiene il bearer fisso finche una migrazione
separata non dimostra un trasporto diverso. Non conferisce authority clinica,
non modifica ADR 0096 e non implementa Web, native, route, cookie, mutex,
audit, session store, database, migrazione, UI, test runtime, provider, cloud,
egress, push, PR, merge, tag o release.

Claim ceiling: **decisione tecnica accettata, solo documentale, per un fence
di revoca Web process-local e un trasporto bearer temporaneo; nessun runtime o
integrazione native e consegnato.**
