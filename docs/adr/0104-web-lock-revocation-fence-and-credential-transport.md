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

### Addendum: owner fisico unico tra bundle Web

Il cutover di produzione deve collocare P2, P3, lifecycle guard, control store,
session store, risorse e revoca in un solo modulo `server-only` caricato una
volta dal processo Node host. Il modulo e esterno ai bundle delle route: due
route compilate non possono incorporarne due copie o mantenere un proprio
registro autoritativo.

Per `0.8.5` il modulo e un package CommonJS fisico, con un solo export root e
una sola copia installata e tracciata dal lockfile. Sono vietati dual entry
CommonJS/ESM, deep import, seconda copia, symlink di directory, import relativo
della sorgente e fallback a un owner locale. Il package non esporta
costruttori, registri, celle, Map, Set, WeakMap o primitive che consentano al
chiamante di creare o sostituire authority.

`globalThis`, `process`, `Symbol.for`, cache Next, cache manuali, injection di
puntatori e un servizio locale separato non sono owner ammessi. Sono ambienti
mutabili o cambiano il confine di deployment; non provano identita fisica,
lifetime o revoca condivisi.

Tutti i consumer P2 e P3 devono passare dallo stesso adapter canonico e
consegnare l'identita di sessione host-owned esatta. Un `sessionId`, cookie,
header, receipt o altro valore data-only non seleziona l'owner e non conferisce
authority. Il chiamante non sceglie tra owner storico ed esterno.

Il cutover e atomico: adapter, issuer, control, replay, expiry, resource
cleanup, revoca e tutti i resolver P2/P3 passano insieme al package esterno.
Nello stesso commit gli export storici che potrebbero conservare una seconda
authority diventano fail-closed. Preparazioni stateless e migrazioni dei
caller possono precedere il cutover, ma non possono attivare un owner ibrido.

La prova minima richiede una sola identita fisica in Webpack dev, Turbopack
dev e nei due standalone di produzione; login, richiesta protetta, logout,
lock, expiry e replay devono attraversare bundle distinti mantenendo un unico
lifecycle. Un restart dello standalone deve negare cookie, ticket, locator e
operation precedenti. Manifest, lockfile, digest, roster del package e assenza
di sorgente owner nei chunk sono evidenze separate e obbligatorie.

Questa decisione resta limitata a un solo processo Node, un solo realm e un
supervisore standalone. Multiprocesso, worker, Edge, serverless o routing senza
affinity richiedono una nuova decisione: non possono ereditare il claim
process-local di questa ADR.

### Addendum D0b: preparazione dormiente del package

Questo addendum precisa le preparazioni ammesse prima del cutover atomico. La
parola `stateless` alla riga di confine precedente qualifica il grafo che la
produzione puo valutare, non la sola presenza di file nel tree. Un file interno
puo contenere l'implementazione P2 solo se resta irraggiungibile dal root del
package, dall'adapter e da ogni consumer di produzione.

La sola presenza dei byte non costituisce authority. Costituiscono invece
authority, e rendono lo stato `INVALID`, qualunque import, `require`, export,
deep import, loader dinamico o calcolato, side effect, cache, registrazione su
`globalThis` o `process` e qualunque stato condiviso valutato dalla produzione.
I test possono valutare il file interno solo in processi sintetici isolati;
questa prova non e evidenza di attivazione runtime.

Gli stati pre-cutover ammessi sono ordinati e chiusi:

1. `DORMANT_PREPARED`: esiste solo l'adapter canonico dormiente; non esistono
   package, dipendenza, lock entry, copia installata o consumer.
2. `PACKAGE_SOURCE_PREPARED`: esiste la sorgente esatta sotto
   `packages/web-auth-lifecycle-owner/`. Il root e inerte e non carica
   `internal/`; l'implementazione P2 interna puo essere presente, ma il package
   resta assente da dipendenze, lockfile, `node_modules`, configurazione Next,
   adapter e grafi di import di produzione.
3. `PHYSICAL_PACKAGE_PREPARED`: alla sorgente si aggiungono tarball e
   provenienza della versione corrente `0.8.5-prepared.N`, dipendenza e lock
   entry esatti e una sola copia fisica installata. Il root resta inerte, non
   carica `internal/` e non ha consumer o externalization di produzione. La
   prima versione accettata di questo stato e `0.8.5-prepared.0`.

La sola transizione ammessa e
`DORMANT_PREPARED -> PACKAGE_SOURCE_PREPARED -> PHYSICAL_PACKAGE_PREPARED ->`
cutover atomico. D1 deve riconoscere il nome esatto dello stato prima che il
relativo packet sia accettato. Combinazioni parziali, ritorni a uno stato
precedente e due authority parallele sono `INVALID` e fermano il programma.
In tutti e tre gli stati l'owner storico locale resta la sola authority runtime.

### Addendum D0c: serie monotona delle versioni preparate

`0.8.5-prepared.N` e una serie monotona, dove `N` e un intero non negativo.
Ogni packet preparato parte dall'ultimo `N` accettato e usa `N + 1`. Non puo
saltare, riusare o diminuire `N`.

Ogni modifica di un solo byte agli input del package, ai membri o ai metadati
del tarball oppure alla provenienza richiede un nuovo `N`. Dopo l'accettazione,
la coppia formata dalla versione e dai relativi digest e immutabile. Una
versione non puo quindi identificare byte, roster, digest o integrity diversi.

Per ogni `N`, questi elementi avanzano insieme e identificano la stessa
versione corrente:

- `packages/web-auth-lifecycle-owner/package.json`;
- il tarball
  `packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.N.tgz`;
- la provenienza
  `packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.N.provenance.json`;
- la dipendenza root
  `file:packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.N.tgz`;
- versione, `resolved` e `integrity` dell'unica entry del lockfile;
- l'unica copia fisica corrente installata nell'applicazione.

La provenienza di `N > 0` registra il predecessore esatto come
`{version,tarSha256,provenanceSha256}`. Registra inoltre la base Git
accettata del packet, la toolchain, i comandi, i roster e i digest della nuova
versione. Il predecessore deve coincidere con l'ultimo `N` accettato.

Un packet preparato e indivisibile. D1 riconosce
`PHYSICAL_PACKAGE_PREPARED` soltanto quando manifest, tarball, provenienza,
dipendenza, lockfile e copia fisica coincidono sullo stesso `N`. Deve esistere
esattamente un solo `N` corrente. Qualunque combinazione parziale o mista e
`INVALID`, anche se ogni elemento e valido separatamente.

La copia sotto `node_modules` e ignorata da Git e non viene mai tracciata. La
verifica la rimaterializza dal tarball corrente e riconosce il nuovo stato solo
quando anche questa copia e avanzata allo stesso `N`, con identita fisica,
roster e digest esatti. Fino a quel momento il packet non e accettabile.

Tarball e provenienze di versioni precedenti possono restare tracciati soltanto
come evidenza storica inerte. Nessuna dipendenza, lock entry, copia installata,
adapter, test runtime o consumer puo referenziarli, installarli o caricarli.
Non costituiscono la versione corrente e non acquisiscono authority.

Il cutover finale `0.8.5` parte dall'ultimo `0.8.5-prepared.N` accettato. La sua
provenienza indica quel predecessore esatto. Il commit di cutover sostituisce
insieme tutti gli elementi correnti secondo il contratto finale gia definito;
non puo partire da una versione preparata superata o da una serie incompleta.

### Addendum D0d: provenienza senza autoriferimento

Per ogni `N > 0`, `acceptedBase` e lo SHA Git completo dell'immediata base gia
accettata da cui parte il packet, prima di qualunque suo edit. Non e lo SHA del
commit che consegna il packet e non identifica un commit sorgente intermedio.

La provenienza di `N > 0` omette la chiave `sourceCommit`. Un riferimento al
commit che contiene la provenienza sarebbe circolare; un placeholder o uno SHA
previsto non costituiscono evidenza. I digest degli input e il roster ordinato
legano invece la provenienza agli esatti byte sorgente. Questa regola non
modifica la provenienza storica immutabile di `0.8.5-prepared.0`.

Il predecessore resta esattamente
`{version,tarSha256,provenanceSha256}` e coincide con l'ultimo `N` accettato. La
provenienza conserva inoltre toolchain, comandi di pack, digest e `integrity`
dell'artifact, input e roster del tarball.

Per P3a1, due copie temporanee pulite dello stesso candidato eseguono i due pack
offline e senza script. Solo se i tarball sono byte-identici, i loro valori
reali di lunghezza, digest, `integrity` e roster possono entrare nella
provenienza e nel guard.

Lo stesso packet atomico P3a1 congela nel guard questi valori reali e sposta il
live pin alla nuova versione. Manifest, tarball, provenienza, dipendenza root,
lockfile e unica copia fisica avanzano insieme allo stesso `N`. Non sono ammessi
un commit preparatorio fisico, un pin anticipato, valori sintetici, due versioni
correnti o un elemento ancora riferito al predecessore storico.

### Sorgente, manifest e root CommonJS

Per la prima versione preparata `0.8.5-prepared.0`, nomi e percorsi sono fissi:

- sorgente: `packages/web-auth-lifecycle-owner/`;
- nome package: `@mediflow/web-auth-lifecycle-owner`;
- root: `packages/web-auth-lifecycle-owner/index.js`;
- tarball: `packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.tgz`;
- provenienza: `packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.provenance.json`;
- dipendenza root:
  `file:packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5-prepared.0.tgz`.

Il `package.json` del package contiene, nello stesso ordine, soltanto:

```json
{
  "name": "@mediflow/web-auth-lifecycle-owner",
  "version": "0.8.5-prepared.0",
  "private": true,
  "type": "commonjs",
  "main": "./index.js",
  "exports": "./index.js",
  "files": ["index.js", "internal/"],
  "engines": { "node": ">=24 <25" }
}
```

Non sono ammessi `module`, `browser`, `imports`, `bin`, `scripts`, dipendenze,
peer o optional dependency, export condizionali o subpath. Il tar contiene
soltanto `package/package.json`, `package/index.js` e file regolari sotto
`package/internal/`; test, mappe, documenti, provenance e altri artifact
restano fuori dal roster.

Prima del cutover il root ha l'unico contenuto eseguibile seguente, oltre a
spaziatura e commenti:

```js
'use strict';
module.exports = Object.freeze(Object.create(null));
```

Il root non espone API, owner o stato e non carica il file P2 interno. Qualunque
altra dichiarazione, chiamata, export, import, `require` o lettura ambientale
porta lo stato a `INVALID`.

Il marker `server-only` resta responsabilita esclusiva dell'adapter canonico,
che importa `server-only` a livello di modulo. Il CommonJS non aggiunge
`require('server-only')`, dipendenze o condizioni di export. Prima del cutover
nessun modulo di produzione carica il package; al cutover solo l'adapter puo
caricarne il root. Route, client, deep import e accesso diretto a `internal/`
restano vietati.

Il commit atomico di cutover crea invece il nuovo tarball finale
`packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5.tgz` e la provenienza
`packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.5.provenance.json`.
Il manifest finale usa la versione `0.8.5`; il root espone la nuova API attiva
e deve avere byte e digest diversi dal root inerte dell'ultima versione
`0.8.5-prepared.N` accettata. Nello
stesso commit indivisibile dipendenza root, lockfile, `resolved`, `integrity`,
copia installata, adapter e consumer passano insieme al tarball finale. Prima
di quel commit i byte del root/API attivo `0.8.5` non possono esistere in
sorgente, artifact, lockfile o `node_modules`, ne essere installati o caricati. Solo l'adapter puo
caricarne il root; deep import e accesso diretto a `internal/` restano vietati
anche dopo il cutover.

### Provenienza, pack e installazione fisica

La provenienza preparata registra almeno: base Git accettata, nome e versione,
versioni esatte Node e npm, comando di pack, lunghezza e SHA-256 del tarball,
roster ordinato del tar e SHA-256 di ogni input e membro. Per
`0.8.5-prepared.0` la base Git accettata e
`a9a81a4fe4c3551be1b9676019579a7bcdd6a611`; ogni `N > 0` registra la base Git
accettata del proprio packet e il predecessore imposto da D0c. Il file non
contiene percorsi assoluti, cache, credenziali o dati runtime. La provenienza
finale registra separatamente l'ultimo predecessore preparato e i nuovi roster
e digest `0.8.5`.

Il pack viene eseguito due volte da due copie temporanee pulite della sorgente,
con la stessa toolchain registrata e con:

```text
npm pack --ignore-scripts --pack-destination ./artifacts
```

I due tarball devono essere byte-identici e avere lo stesso roster e gli stessi
digest dei membri. Il pack non usa rete, registry, Git URL, lifecycle script o
cache ambientale. Un risultato non riproducibile e `HOLD_SUPPLY_CHAIN`.

La prova di installazione usa un package scratch vuoto la cui unica dipendenza
e il tarball tracciato. Usa una cache temporanea vuota e:

```text
npm install --offline --ignore-scripts --no-audit --no-fund <tarball>
```

La dipendenza dell'applicazione punta allo stesso `file:` esatto. Il lockfile
v3 contiene una sola risoluzione locale con `integrity`, senza `link: true`,
workspace, directory package, registry, Git o URL. Nessun comando puo ricadere
su rete o cache per completare il package owner.

Le prove `lstat`, `stat` e `realpath` devono mostrare una sola directory package
fisica e un solo root sotto il `node_modules` dell'applicazione. Manifest, root
e file interni sono file regolari, non symlink o hardlink, e hanno link count
uno. Roster e digest devono coincidere con la provenienza. Le stesse prove si
ripetono sulla copia finale `0.8.5` inclusa nello standalone di produzione.

### Significato dei due standalone di produzione

I "due standalone di produzione" della prova minima sono due avvii sequenziali,
A e B, dello stesso output immutabile `.next/standalone`. A viene terminato
completamente prima di avviare B; ogni avvio crea un nuovo processo Node e un
nuovo realm.

In A e in B almeno due bundle route compilati separatamente devono attraversare
la stessa unica copia fisica finale `0.8.5` e lo stesso lifecycle process-local.
B deve negare ogni cookie, ticket, locator e operation emesso da A e deve
osservare una nuova identita process-local. Il digest dell'output e il roster
del package non cambiano fra i due avvii.

Questa prova non descrive due build, due supervisori concorrenti, replica, alta
disponibilita o coordinamento multiprocesso. Avvii sovrapposti o authority
condivisa tra A e B richiedono una nuova decisione e restano `HOLD`.

### Falsificatori e claim del packet D0b

Fermare la preparazione se il root raggiunge P2, un consumer di produzione
carica package o adapter prima del cutover, l'owner storico smette di essere la
sola authority, o D1 non restituisce lo stato atteso esatto. Fermare anche per
tar non riproducibile, versione riusata con byte diversi, drift di manifest,
roster, digest, provenienza, lock o integrity, installazione con rete, cache o
script, link o copia duplicata, import diretto/client/deep e inferenze
multiprocesso dalla prova sequenziale. Sono falsificatori anche i byte del
root/API attivo `0.8.5` presenti prima del cutover e un commit finale che non sostituisce
insieme tarball, provenienza, dipendenza, lock, `integrity` e root inerte. D0c
aggiunge come falsificatori un salto o riuso di `N`, un predecessore errato,
piu versioni correnti e qualunque mix tra elementi di versioni preparate diverse.

Registry remoto, Git o URL, dual CJS/ESM, condizioni di export, un marker
`server-only` interno al package, un secondo owner, un servizio separato,
worker, Edge, serverless, replica o multiprocesso cambiano il confine e
richiedono una nuova decisione. Route, cookie, API e semantica P2/P3 restano
fuori da D0b.

Claim massimo D0b: **contratto documentale per preparare sorgente e copia fisica
di un package CommonJS dormiente, locale e riproducibile; nessun package,
lockfile, configurazione, consumer, runtime o authority esterna e consegnato da
questo addendum.**

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

### Addendum O1: receipt di sessione e packet O1-P5-O1-P12

Il package esterno non restituisce la cella P3 o il `ServerSession` conservato
dall'owner. Il resolver root riceve il solo `sessionId` come locator dati non
autorizzante, risolve internamente l'esatta identita della cella e restituisce
una receipt congelata con uno dei tre esiti chiusi:

- `active`, con la proiezione dati esatta `id`, `userId`, `username`, `role`,
  `authChannel`, `createdAt`, `expiresAt`;
- `owned_denied`, quando l'identita appartiene a una cella non `ACTIVE`;
- `absent`, quando l'identita non appartiene all'owner Web.

La proiezione `active` e un nuovo oggetto dati, non la cella o la sessione
interna. Il package lega l'esatta identita della proiezione alla cella `ACTIVE`
in una `WeakMap` privata. Quella stessa identita e l'unica authority che le API
successive possono ricevere. Ogni API ripete il controllo di identita, stato,
`sessionId` ed expiry. Il ritiro esatto richiede la proiezione autentica e una
causa controllata; il solo `sessionId` non basta. Un ritiro o un restart rende
inutilizzabile ogni proiezione gia emessa.

L'adapter canonico resta Web-only: non conserva Map, WeakMap, cache, generation
o puntatori all'owner e non importa l'owner native/system. Passa la receipt e
la proiezione senza copiarle. Il facade stateless `server-session.ts` consulta
prima l'adapter Web. Soltanto `absent` permette il lookup nell'owner
native/system gia server-marked; `owned_denied` termina la risoluzione. Questa
precedenza non e configurabile dal caller e l'owner native/system rifiuta
sempre `authChannel: web`.

Il root finale espone soltanto funzioni congelate per:

- `begin`, `issue` e `abort` del tentativo login/setup;
- risoluzione tri-state della sessione Web;
- ritiro esatto per proiezione, utente e causa controllata;
- prepare/commit/abort dell'operazione fissa di reset amministrativo;
- port, use e registrazione delle risorse private della proiezione autentica.

Non espone costruttori, celle, registri, stato, primitive CAS, ticket P2,
prepared capability o API per scegliere l'owner. Il cleanup puo richiamare un
disposer gia validato soltanto dopo `RETIRED`; nessuna callback entra tra CAS e
flip terminale. Un eventuale esito Promise/thenable nativo viene contenuto dopo
il ritiro e non puo modificare o ripristinare authority.

Il reset amministrativo prepara prima della mutazione DB una capability opaca,
esatta e monouso dall'esatta proiezione `ACTIVE` di un admin autenticato. La
preparazione non ritira sessioni e non riceve dal caller causa o selettore
owner. Se la cancellazione degli utenti fallisce, l'abort brucia la capability
senza cambiare le sessioni. Se riesce, il commit non rilegge la proiezione:
autentica la capability gia preparata e ritira tutte le authority Web correnti
attraverso `ACTIVE -> ARMED_RETIRE -> RETIRED` con la causa interna `clear`,
revoca il lavoro Web non attivo e compatta le risorse.

Il facade `server-session.ts` prepara prima del DB anche l'operazione separata
dell'owner native/system e conserva soltanto le due capability opache in una
receipt congelata. Dopo il DB esegue i due commit gia validati senza altro
lavoro fallibile; su errore DB li abortisce entrambi. In questo modo il reset
non dipende da una proiezione che potrebbe cambiare dopo la cancellazione e non
fonde i due owner. La cancellazione del cookie resta ammessa soltanto in questa
operazione distruttiva di onboarding; non cambia logout/lock di ADR 0106.

La modifica autenticata del PIN resta distinta. Dopo il CAS credenziali
riuscito ritira tutte le sessioni Web P3 dello stesso utente e, con una seconda
chiamata esplicita, invalida anche le sessioni native/legacy dello stesso
utente. Questa scelta preserva il comportamento attuale senza fondere i due
owner. Un vero reset del PIN senza il PIN corrente resta fuori da O1.

O1-P5-O1-P9 contengono helper senza Map, WeakMap, celle o registri mutabili a livello
di modulo. Tutte le strutture mutabili, inclusa la WeakMap delle proiezioni,
sono allocate una sola volta dalla factory interna di `owner.cjs`. La factory
e invocata dal root soltanto in O1-C; prima del cutover puo essere invocata
esclusivamente da un child process sintetico.

La costruzione esterna segue questo ordine. Circa 300 LOC attivano una review
di confine, non una divisione automatica. Si divide soltanto quando entrambe le
parti restano verificabili con un solo owner; una modifica atomica resta unita
se separarla creerebbe due authority o uno stato intermedio pericoloso:

| Packet | File interni e API preparate | Dipendenze e claim |
| --- | --- | --- |
| O1-P5 | `internal/control-record.cjs`: ticket P2, prepare/commit/abort activation e retirement. | Solo supporti puri e `successor-fence`; root inerte. |
| O1-P6 | `internal/session-cell.cjs`: staging, reservation, cella, port e lifecycle guard. | O1-P5; nessun resolver o consumer. |
| O1-P7 | `internal/session-activation.cjs`: prepare e commit-last `ARMED_ACTIVATE -> ACTIVE`. | O1-P5/P6; nessun `issue`, ritiro o route. |
| O1-P8a | `internal/session-retirement.cjs`: `ACTIVE -> ARMED_RETIRE -> RETIRED`. | O1-P5/P7; nessun cleanup prima di `RETIRED`. |
| O1-P8b | `internal/session-resource.cjs`: port, use, revoca e cleanup post-retirement. | O1-P6/P8a; nessun registro esterno. |
| O1-P9 | `internal/session-resolver.cjs`: receipt tri-state, proiezione autenticata e currentness delle risorse. | O1-P7/P8b; nessuna importazione native. |
| O1-P10 | `internal/owner.cjs`: unica factory, stato e composizione `begin`/`issue`/`abort`. | O1-P5/P9; root ancora inerte. |
| O1-P11 | Ultimo `0.8.5-prepared.N`, tar, provenance, lock e unica copia fisica. | Tutti gli helper accettati; nessun consumer. |
| O1-P12 | Test esterno con probe interno exact-roster in app sintetica Webpack, Turbopack e standalone A-B. | Il root preparato resta inerte; prova solo identita/topologia. |

La matrice processuale vive in un test esterno al tar, per esempio
`lib/security/web-auth-lifecycle-owner-process.test.ts`. Il probe O1-P12 puo
caricare l'internal soltanto nella copia exact-roster dell'app sintetica e non
introduce route diagnostiche o deep import nell'applicazione reale.

Ogni modifica ai byte del package incrementa `prepared.N` di una sola unita e
aggiorna nello stesso packet manifest, tar, provenance, dipendenza, lock,
installazione fisica e guard. Il test puo caricare un internal solo in una
fixture sintetica exact-roster; nessun file di produzione o test applicativo
puo usare deep import.

Prima del cutover i consumer possono migrare verso l'adapter soltanto mentre
questo contiene una sola importazione diretta dell'owner Web storico, zero
import del package, zero branch configurabili e zero alternativa locale. O1-C
rimuove quell'import nello stesso diff che carica il root `0.8.5`, externalizza
il package, commuta i consumer residui e rende gli owner Web storici
fail-closed. La prova finale ripete O1-P12 sull'app reale e aggiunge due avvii
standalone sequenziali: ogni artefatto emesso dal processo A deve essere negato
dal processo B.

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
