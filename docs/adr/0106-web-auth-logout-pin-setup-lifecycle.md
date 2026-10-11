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

Emendamento 0.8.6, 6 settembre 2026: il cambio PIN puo essere iniziato anche
da una sessione paired native corrente. I due input autenticati restano una
union esplicita: nessuna sessione native viene convertita in una projection
Web. Dopo la verifica del PIN, l'owner native prepara un retirement legato
all'esatto oggetto di sessione, utente e binding paired. Un ingresso separato
dell'owner Web consuma una sola volta la prova di quella preparazione e ne
deriva l'utente dal registro privato. Produce soltanto il normale ticket Web
di retirement: non emette sessioni, control, cookie o grant Web.

La claim della prova non consuma il ticket native necessario al commit/abort.
Una copia, un ticket terminale, un ticket preparato soltanto per userId o una
seconda claim negano. Le route account rileggono il pairing e la sessione
prima della preparazione e prima del CAS; la rotazione del token paired non
riassocia una sessione precedente. L'ordine prepare native, prepare Web, CAS,
commit Web, commit native resta identico per entrambi i canali. Dopo un CAS
riuscito non si esegue abort per nascondere una failure di finalizzazione.

Dopo aver verificato il PIN corrente e prima di calcolare il nuovo hash o
avviare il CAS, l'host prepara sia il retirement native sia una capability Web
opaca, esatta e monouso. La capability Web lega l'owner e l'utente alla
projection ancora autentica, ma non ritira sessioni. Un abort brucia la
capability e lascia invariata l'authority, salvo transizioni concorrenti
esterne.

Il prepare Web incrementa un'epoch dei tentativi login e apre una quiescenza
conservativamente globale: `begin` non conosce ancora l'utente che verra
validato, quindi nessun nuovo attempt puo iniziare finche una capability resta
preparata. Gli attempt anteriori all'epoch restano bruciati anche dopo abort;
solo un nuovo `begin` successivo alla terminalita di commit o abort puo emettere
una sessione.

Il canale native usa un fence separato, opaco e monouso, catturato prima della
verifica delle credenziali. Il commit native del retirement PIN avanza il
watermark dello stesso utente; il commit del reset amministrativo avanza il
watermark globale. Gli abort non li avanzano. La pubblicazione native consuma e
ricontrolla il fence in una sezione sincrona: un tentativo verificato prima del
commit non puo creare una sessione dopo il commit, mentre un retirement di un
altro utente non lo invalida.

Un CAS credenziali PIN riuscito consuma la capability e ritira fail-closed tutte
le sessioni Web P3 dello stesso utente, inclusa la sessione che ha iniziato la
richiesta. L'intero roster diventa terminale prima di qualunque cleanup o
disposer. Reentry, throw o failure di cleanup non possono interrompere la
terminalizzazione e lasciare una sibling `ACTIVE`. Ogni retirement usa il
proprio binding P2/P3; nessun `clear`, `delete` o expiry diretto puo rimuovere
una cella `ACTIVE`.

La route non conferma il successo finche ogni retirement richiesto non e
terminale e il relativo fence e terminale. Se il CAS PIN fallisce, non modifica
sessioni, control, fence, cookie o stato di retirement. Se un retirement non
puo diventare terminale, la route nega fail-closed e non dichiara il successo
PIN. L'ordine terminale e: prepare native, prepare Web, confronto e CAS oppure
abort di entrambe, commit Web, commit native, guard completato e audit. Il
client elimina l'authority locale dopo un successo; se perde la risposta dopo
il dispatch, si blocca e richiede un nuovo login esplicito.

Questa decisione non definisce il formato PIN, KDF, key re-wrap o reset PIN.
Un reset e un packet separato. Non puo cancellare silenziosamente il cookie
fisso per recuperare il lifecycle.

### Setup account e sessione

Il setup separa il commit DB dall'autenticazione Web. Il commit puo persistere
account e impostazioni prima del CAS P3. Solo dopo un CAS riuscito e il flip
P3 a `ACTIVE` la route puo emettere il cookie bearer.

Emendamento 0.8.6, 6 settembre 2026: quando il setup raccoglie il nome
dell'ambulatorio e non esiste ancora alcuna sede, la stessa transazione crea
la prima sede predefinita con quel nome. Il primo utilizzo paired ha cosi un
ambulatorio reale da selezionare. Sedi gia presenti non vengono rinominate,
sostituite o promosse; il setup senza nome conserva il comportamento precedente.
Un errore annulla insieme account, impostazioni e nuova sede. Un diniego P3
dopo il commit conserva tutti e tre per il recupero tramite login ordinario,
senza creare duplicati al retry. Nessuna rete, pairing o capability viene
abilitata da questa inizializzazione.

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
3. Modifica PIN: preparare native e Web, chiudere i tentativi login concorrenti,
   applicare il CAS e terminalizzare l'intero scope utente prima di cleanup,
   audit e successo osservabile.
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
- attempt login iniziato prima o durante il prepare che emette una sessione
  dopo commit, o che torna valido dopo abort;
- login native verificato prima di un commit PIN o reset che, riprendendo dopo
  il commit, emette cookie o sessione; abort e retirement di un altro utente
  devono invece preservare un tentativo altrimenti valido;
- cleanup o disposer che tramite throw o reentry interrompe il roster e lascia
  una sessione sibling `ACTIVE` dopo il CAS;
- client che conserva authority locale dopo successo PIN o dopo un esito
  post-dispatch non osservabile;
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


## Mappa prima/dopo della semplificazione 0.9.0

Per [WUL-725](https://linear.app/wulfgardr/issue/WUL-725), questa mappa raccorda
il lifecycle precedente con gli owner correnti. I link al codice seguono la
revisione del documento; i confronti storici sono nelle PR indicate. Non crea
un secondo catalogo di capacità o di dati a riposo.

| Oggetto o controllo | Prima | Owner attuale e momento del controllo |
| --- | --- | --- |
| Tentativi e stato di blocco delle credenziali | Confronto e aggiornamento SQLite separati; race nei contatori e nel reset dello stato. | [Verificatore host](../../lib/security/host-credential-verification.ts): transizione atomica dopo il confronto, senza cancellare un blocco concorrente; [PR389](https://github.com/Wulfgardr/mediflow/pull/389). |
| Ammissione delle mutazioni con cookie Web | Il singolo ingresso doveva richiedere l'origine fidata. | [Proxy](../../proxy.ts) prima del body di ogni mutazione API con entrambi i cookie Web, usando [request-transport](../../lib/security/request-transport.ts); [PR392](https://github.com/Wulfgardr/mediflow/pull/392). Bootstrap, native e metodi sicuri restano distinti. |
| Control, attempt, ticket, cella e projection Web | Cluster storico `web-auth-control-owner`, `web-auth-control-record`, `web-auth-session-issuer`. | Un [package fisico](../../packages/web-auth-lifecycle-owner/index.js), consumato dal solo [adapter](../../lib/security/web-auth-lifecycle-owner-adapter.ts). `begin`, `issue`, resolver e retirement controllano identità esatta, fence, TTL e terminalità; il [guard](../../lib/security/web-auth-lifecycle-owner-boundary.test.ts) esclude consumer prodotto del cluster storico e deep import. |
| Sessione native, pairing e trasporto | Il cambio dei campi di authority poteva lasciare attiva la sessione operatore. | Owner native nello stesso package, esposto da `serverSessions`, più [workspace Apple](../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift): endpoint, pin TLS e pairing cambiati ritirano prima degli osservatori; [PR394](https://github.com/Wulfgardr/mediflow/pull/394). Non emettono projection Web. |
| Port, use e risorsa privata Web/native | Lifecycle separati per canale, con il rischio di replicare la sequenza di uso nei consumer. | [Ordinary session authority](../../lib/security/ordinary-session-authority.ts) condivide soltanto la meccanica; i due issuer conservano brand e registri separati. Verifica a mint, begin, binding, commit e disposal; cleanup dopo ritiro terminale. |
| Selezione paziente/sede, lease, epoch e porte di commit delle quattro funzioni documentali | Factory e facade non bastavano a provare un unico owner di processo. | [Singleton production](../../lib/security/server-session-projection-owner-production-internal.ts), pubblicato dalla [facade](../../lib/security/server-session-projection-owner-production.ts). [Owner](../../lib/security/server-session-projection-owner.ts) ricontrolla sessione, paziente, versione, scope e lease prima e dopo il punto d'uso; ogni porta mantiene la propria semantica, non un commit generico. |
| Projection clinica e handle monouso | Broker tipizzato autonomo: la validità del contenuto non prova il lifecycle della sessione. | [Broker](../../lib/typed-projection-broker.ts) controlla target, capability, freschezza e consumo; [binding](../../lib/security/server-session-projection-broker.ts) lo revoca con la risorsa autentica. Le proiezioni per capability restano quelle dell'[ADR0095](./0095-broker-projection-e-servizi-host-per-capability.md), non dati arbitrari. |
| Grant di ruolo, child session, proposal e prova umana headless | Autorità già separate, non controlli equivalenti da fondere. | [ADR0097](./0097-active-role-session-and-step-up-authorization.md) e [ADR0103](./0103-headless-clinician-authorized-soap-entry-write.md) possiedono la mappa dei grant e i controlli a emissione, uso e conferma. Dipendono dalla sessione/selection autentica; nessuna conferma passa al client o al modello. |
| Passphrase, PIN di conferma, chiave clinica e recupero | Sblocco Web tramite PIN e involucro storico. | [ADR0143](./0143-strong-unlock-credential.md) possiede custodia e formato correnti C07: wrapping nel browser, chiave residente non estraibile, rinnovo esplicito dopo reload. Il cambio prepara il ritiro prima del CAS; non cambia l'owner packed. |
| Segreti provider, file e risorse di processo | Autorità differenti dalla sessione, non trasferibili al broker. | [Census](../authority-census.md#altre-autorità-owner-e-fonte-da-consultare) rimanda ai rispettivi owner; [matrice a riposo](../data-at-rest-matrix.md) possiede i residui. C15 lega le sessioni anche alla [generazione dell'archivio](../../lib/security/archive-session-generation.ts): non si riusa autorità dopo una sostituzione. |

### Consolidamento e controlli che restano

Il consolidamento elimina consumer del vecchio owner, centralizza l'ammissione
cookie e condivide il lifecycle delle risorse senza unire i canali. Non elimina
le verifiche successive: origine non prova la sessione; sessione non prova la
selezione; selezione non prova versione e lease al commit. Il confronto delle
credenziali e il CAS finale proteggono momenti diversi. I confini in-process
restano quelli dell'[ADR0105](./0105-web-auth-process-integrity-assumption.md).

Le prove riusate sono [process lifecycle](../../lib/security/web-auth-lifecycle-owner-process.test.ts)
(eseguito sull'installato), [adapter](../../lib/security/web-auth-lifecycle-owner-adapter.test.ts),
[projection owner](../../lib/security/server-session-projection-owner.test.ts),
[commit binding](../../lib/security/server-session-projection-owner-commit-binding.test.ts)
e [broker binding](../../lib/security/server-session-projection-broker.test.ts):
negano cloni, target/capability differenti, scadenza, riuso, reentry e uso dopo
ritiro; mantengono distinti abort e commit del retirement. Clock e membership
sintetici non sono provider o autorizzazione clinica.

La corrispondenza sorgente/archivio/installato e il rifiuto di membri alterati
usano il [guard packed esistente](../../lib/security/web-auth-lifecycle-owner-boundary.test.ts)
e il profilo `local-package` del [ledger runtime](../runtime-payload-ledger.md#local-packed-owner-package),
non una nuova lista. La sessione senza AI è provata dai percorsi produzione
[Web ordinario](../../e2e/web-smoke.spec.ts) e [logout ostile/valido](../../e2e/web-cookie-mutation-admission.spec.ts);
non dipende da eseguire un provider. Gli esiti appartengono alla PR e alla CI,
non a questa mappa.
