# ADR 0106: lifecycle Web per logout, PIN e setup

Date: 2026-08-28
Status: Accepted

Issue: WUL-522
Program line: candidato `0.8.5`

Related: [ADR 0104](./0104-web-lock-revocation-fence-and-credential-transport.md),
[ADR 0105](./0105-web-auth-process-integrity-assumption.md) e
[ADR 0017](./0017-auth-lockout-policy.md).

## Problema

ADR 0104 definisce il control fence process-local e il lifecycle P2/P3
commit-last. Restavano non fissati i terminali Web di logout, modifica PIN e
setup. Senza un ordine esplicito, una route puo trattare un CAS PIN, un commit
setup o un cookie browser come prova sufficiente di authority.

Serve una decisione limitata per i terminali Web P3. La decisione deve
preservare il bearer cookie fisso, negare di default e distinguere persistenza,
retirement della sessione e risposta HTTP.

## Contesto ed evidenza delimitata

La fonte P3b2 indicata e
`df506d20f2ed132e86e523bc810712147e74ae01`. Mostra un issuer sincrono che
brucia un attempt monouso, prepara una sessione P3 e la attiva solo tramite il
binding control/session. Restituisce una projection minima con `ok` e
`sessionId`. Questa fonte e un fatto di codice circoscritto, non prova
integrazione, route, cookie, database, native o release.

Un parere di revisione conservato privatamente, run
`7d1af368-c56a-4d2c-a749-6a07db904515`, ha hash SHA-256
`9f85661ed80e6094495fded9520d500eda78b5bfec6171f7dc4fc42582830ad6`.
Ha informato i falsificatori di questa ADR, ma non e una prova del contratto o
del runtime.

## Decisione

### Precedenza e confine

Questa ADR completa ADR 0104. Per logout, modifica PIN e setup Web P3,
sostituisce ogni formulazione storica incompatibile sul lifecycle; ADR 0104
resta autorevole per control, fence, ticket, cella e lock. Le ADR storiche non
vengono riscritte.

Il perimetro resta un processo e un realm JavaScript locali. Tutti gli input,
cookie, header, body, adapter, errori e oggetti esterni sono non fidati. Il
default e denial. Nessun fallback legacy puo autorizzare una sessione Web P3.
Native, system authority e Web restano superfici distinte: non possono unire
grant, sessioni o prove di authority.

### Logout Web

Il logout ritira soltanto l'esatta sessione P3 legata al bearer ricevuto e al
binding server corrente. Non ritira per utente, per cookie name o per una
sessione ricostruita.

Il logout non muta alcun cookie, incluso `mediflow_session`. Dopo il retirement
terminale dell'esatto binding, restituisce `204` con `Cache-Control: no-store`.
Un bearer assente, stantio, non associato o non P3 produce denial e non ritira
un'altra sessione.

### Modifica riuscita delle credenziali PIN

Un CAS credenziali PIN riuscito avvia il retirement fail-closed di tutte le
sessioni Web P3 dello stesso utente, inclusa la sessione che ha iniziato la
richiesta. Ogni retirement usa il proprio binding P2/P3; nessun `clear`,
`delete` o expiry diretto puo rimuovere una cella `ACTIVE`.

La route non conferma il successo finche ogni retirement richiesto non e
terminale e il relativo fence e terminale. Se il CAS PIN fallisce, non modifica
sessioni, control, fence, cookie o stato di retirement. Se un retirement non
puo diventare terminale, la route nega fail-closed e non dichiara il successo
PIN.

Questa decisione non definisce il formato PIN, KDF, key re-wrap o reset PIN.
Un reset e un packet separato. Non puo cancellare silenziosamente il cookie
fisso per recuperare il lifecycle.

### Setup account e sessione

Il setup separa il commit DB dall'autenticazione Web. Il commit puo persistere
account e impostazioni prima del CAS P3. Solo dopo un CAS riuscito e il flip
P3 a `ACTIVE` la route puo emettere il cookie bearer.

La risposta di setup riuscita contiene l'UUID gia persistito e una projection
canonica minima. Non restituisce capability interna, session cell, owner,
server session o authority caller-owned.

Se il DB ha committato ma P3 nega, la route restituisce `409`
`SETUP_COMMITTED_AUTH_UNAVAILABLE`, non emette cookie e indica il recupero con
login ordinario. Non ritenta automaticamente setup, commit o auth.

Se il setup e gia completato, la route restituisce `409`
`SETUP_ALREADY_COMPLETED`. Non ricomincia setup, non ritenta automaticamente e
non modifica il cookie fisso.

### Ordine dei packet

L'implementazione futura segue questo ordine, con sole fixture sintetiche:

1. P3b2 lifecycle: completare e provare prepare, activate, exact retirement e
   resolver che accetta soltanto `ACTIVE`.
2. Logout route: legare bearer, control e P3 esatti; ritirare una sola sessione;
   restituire `204` e `no-store` senza mutare cookie.
3. Modifica PIN: applicare CAS, enumerare lo scope utente e completare tutti i
   retirement prima del successo osservabile.
4. Setup route: separare commit DB, CAS/auth e risposta; applicare entrambi i
   `409` terminali senza retry automatico.
5. Reset PIN: valutare e decidere un packet separato, senza usare il cookie
   fisso come cleanup implicito.

Fermare e dividere se un packet richiede un secondo confine, native, route non
elencate, migrazione cookie, multiprocesso, persistenza nuova o piu di circa
300 LOC.

## Falsificatori obbligatori

Le prove sintetiche devono negare almeno questi casi:

- logout che ritira una sessione diversa, ritira per utente, muta cookie o
  restituisce successo prima del retirement terminale;
- bearer, control, generation, fence o `sessionId` assente, stantio, clonato,
  forgiato, Proxy o associato a un binding differente;
- CAS PIN fallito che modifica anche una sola sessione, control, fence, cookie
  o reservation;
- CAS PIN riuscito che conferma prima del retirement di una sessione P3 dello
  stesso utente, dell'iniziatore o di un fence terminale;
- delete, clear, expiry, reactivation o riuso diretto di una cella `ACTIVE`;
- setup che emette cookie prima di `ACTIVE`, restituisce un UUID non persistito
  o espone oggetti/capability interni;
- denial P3 dopo commit DB che non restituisce esattamente
  `409 SETUP_COMMITTED_AUTH_UNAVAILABLE`, emette cookie o avvia retry;
- setup completato che non restituisce esattamente
  `409 SETUP_ALREADY_COMPLETED`, ricomincia setup o modifica il cookie fisso;
- reset che riusa la route setup, importa authority native/system/legacy o
  cancella implicitamente `mediflow_session`.

## Conseguenze e claim ceiling

La decisione privilegia una denial o un login ordinario dopo un failure rispetto
alla continuita di una sessione non dimostrata. Nessun cookie browser prova da
solo attivazione, retirement, logout o successo PIN.

Claim massimo: **decisione documentale per lifecycle Web P3 process-local,
commit-last e fail-closed; non e prova di runtime, route, cookie behavior,
database, native, reset PIN, multiprocesso, crash recovery, sicurezza generale
o release readiness.**

Fermare la promozione se una prova mostra authority dopo denial, una sessione
P3 non terminale dopo successo PIN, cookie mutation nel logout, fallback
legacy/native/system, retry automatico setup o un claim oltre questo limite.
