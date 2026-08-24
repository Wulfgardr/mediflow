# ADR 0096: owner di sessione, selezione e lifetime del broker

Date: 2026-08-22
Status: Accepted

Issue: WUL-522
Baseline: PR #226, branch `codex/WUL-522-smart-import-host-capability`
a `3a2d7c06ab95f8543a493849b18daba76a3542f6`
Program line: candidato `0.8.5`

Related: ADR 0093 in
[PR #185](https://github.com/Wulfgardr/mediflow/pull/185),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md) e
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md).

## Problema

ADR 0093 assegna al broker host-local sessione, lease, selezione, epoch,
projection, clock e revoca. ADR 0095 richiede che il client medico consegni una
projection minimizzata una sola volta e che il capability service riceva un
handle opaco.

Il runtime corrente non ha ancora un owner production di questi valori. La
sessione server conserva l'identita autenticata, mentre la selezione paziente
vive nel client. Anche il contesto ambulatoriale client non costituisce da solo
autorita. Un broker globale confonderebbe sessioni concorrenti; un broker
creato per richiesta perderebbe replay, revoca e invalidazione.

Serve una decisione unica su owner, granularita e lifetime prima di aggiungere
la projection ingest route o rendere raggiungibile il capability service Smart
Import.

## Decisione

### 1. Una selezione canonica per sessione web autenticata

Per il Model A del prodotto 0.8.5, single-user e senza RBAC, ogni sessione web
corrente e autenticata possiede un solo contesto clinico attivo. Il contesto
lega un ambulatorio canonico e un paziente canonico esclusivamente per
read, projection e preview.

La stringa `role` non concede ne restringe questa capacita: non e step-up
medico, non e un grant multiutente user↔ambulatorio e non autorizza write,
decisioni di review o apply. In questa ADR, le espressioni "sessione medica"
e "medico" descrivono il contesto clinico e non introducono un controllo di
ruolo per il Model A. WUL-282 resta il blocco assoluto di qualunque apply.

Un futuro scope reale user↔ambulatorio richiede un nuovo ADR, data model ed
enforcement esplicito. Non puo derivare dal riuso silenzioso di cookie, role,
pairing, token o receipt.

Le tab del browser che condividono la sessione server condividono anche questa
selezione. Se una tab cambia paziente o ambulatorio, l'host sostituisce la
selezione per l'intera sessione. Le altre tab devono ottenere un nuovo handle
prima di usare una capability clinica.

Un futuro contesto per tab richiederebbe un `applicationContextRef` opaco e un
contratto di routing distinto. Questa variante resta fuori dal candidato 0.8.5
e richiede una nuova decisione prima del runtime.

### 2. L'host possiede riferimenti, epoch e lease

L'owner host genera e conserva almeno:

- `sessionRef`;
- `ambulatoryRef`;
- `patientRef`;
- `selectionEpoch`;
- `leaseRef`;
- scadenza e stato di revoca.

Questi riferimenti sono opachi. Non contengono identita cliniche o chiavi. Il
client, una route, AIP e Mini non possono fornirli come autorita.

Una selezione valida nasce solo dopo che l'host ha risolto la sessione medica,
l'ambulatorio e il paziente tramite fonti canoniche. Cookie, route parameter,
query string o projection indicano una richiesta di contesto, ma non provano
la relativa autorita.

Il cambio di paziente o ambulatorio:

1. revoca il lease corrente;
2. cancella projection e handle associati;
3. incrementa monotonicamente `selectionEpoch` nell'owner della sessione;
4. genera un nuovo `leaseRef` con una nuova scadenza;
5. crea un broker per il nuovo lease solo quando serve.

Un valore caller-supplied equivalente non puo anticipare o sostituire questa
sequenza.

### 3. Owner per sessione e broker per lease

Un registry host di processo mantiene owner distinti per sessione server. Il
registry non e un broker globale. Ogni owner conserva al massimo il broker del
proprio lease attivo e non crea un broker per ogni richiesta.

Il capability service risolve il broker tramite la sessione autenticata e usa
il service consume-only. Non cerca un handle tra sessioni diverse e non riceve
il control del broker.

Owner, broker, projection e handle vivono soltanto in memoria. Non vengono
serializzati, persistiti o registrati nei log. Un riavvio del processo elimina
lo stato e ogni handle precedente fallisce chiuso, senza ricostruzione o
fallback.

Il candidato 0.8.5 usa un singolo processo host. Se una topologia futura avvia
piu processi, un handle presentato a un processo che non possiede il relativo
owner restituisce unavailable. Sticky routing, replica o persistenza richiedono
una nuova decisione; non possono essere aggiunti come fallback implicito.

### 4. Invalidazione legata al ciclo della sessione

L'host dispone l'owner, revoca il lease e cancella projection e handle quando
osserva uno di questi eventi:

- logout completato dal server;
- lock confermato dal server;
- expiry della sessione o del lease;
- reset delle sessioni;
- revoca esplicita;
- cambio valido di paziente o ambulatorio.

Una richiesta di lock iniziata dal client non equivale a un lock confermato.
In particolare, un invio fire-and-forget non dimostra che il server abbia gia
invalidato l'owner. Il runtime deve introdurre un passaggio server osservabile
e completato prima di dichiarare che il lock revoca l'autorita prima della
richiesta successiva.

La registrazione delle risorse session-scoped deve collegare delete, expiry e
reset della sessione alla disposal una sola volta. Un errore interno di cleanup
non deve esporre testo grezzo e non deve riabilitare l'owner.

### 5. Sessioni agente separate

Una sessione agente futura usa un owner figlio separato con capability, lease,
budget e scadenza propri. Non condivide il broker della sessione browser.

Logout, lock confermato, expiry, reset o revoca della sessione medica padre
revocano anche tutti gli owner agente figli. Un owner figlio non estende la
scadenza o l'autorita del padre.

Una sessione `local-api`, `system` o equivalente non prova l'identita del
medico e non puo creare un owner clinico. Il token locale resta un meccanismo
di trasporto o servizio entro i suoi scope, non una sessione medica.

### 6. Addendum A+: relazione privata owner, lease e broker

Per P4, l'owner di sessione deve mantenere una relazione privata,
in-process e non falsificabile tra owner, lease esatto e broker esatto. La
relazione identifica la capability broker congelata dal suo modulo di origine,
non dalla sua forma. Un adapter P4 non riceve alcun token, factory, brand,
simbolo, digest, timestamp, nonce o riferimento da cui ricostruirla.

Il registry host risolve la relazione soltanto internamente. Proxy, accessor,
reflection, thenable ambientali e valori caller-supplied devono essere negati
prima di una reservation o di un commit. Nessun controllo post-commit puo
trasformare una pubblicazione gia riuscita in una denial.

Un riavvio, sostituzione del processo o mismatch del processo proprietario
nega il lease e la relazione senza ripristino. Owner, lease, broker,
reservation e handle restano solo in memoria. Non sono serializzati,
persistiti, esportati o ricreati per P4.

L'owner puo esporre a P4 soltanto l'esito di una reservation gia committata.
P4 non puo vedere una reservation `staged` o `aborted`, e non puo scegliere il
passaggio a `committed`. Il broker prepara il descrittore completo, valida
lease e currentness e pubblica solo dopo il commit sincrono non rientrante.
Un denial pre-commit termina in `aborted`, con zero residui; l'handle non
diventa osservabile.

Questa e una decisione di confine, non prova di implementazione. Registra il
consiglio in sola lettura `MF085-PRO-P4-20260824-01` e il difetto verificato
localmente come input per il prossimo packet. Non autorizza runtime, route,
storage, provider, persistenza, applicazione policy o promozione.
L'esito P4 resta review-only, con zero scritture e `applyPolicy=none`.

## DAG di implementazione

```text
ADR 0095/0096 addendum A+
  -> packet broker: autenticita privata e commit-last
  -> composer P4 ricostruito
  -> falsificatore cross-boundary solo test
  -> integrazione

owner session-scoped e broker per lease
  -> disposal delle risorse server-session
  -> projection input senza authority caller-supplied
  -> registry host di processo
  -> risoluzione canonica ambulatorio/paziente
  -> projection ingest capability-specific
  -> composizione host Smart Import
  -> preview route { handle, requestId }
  -> adapter browser Smart Import
```

L'addendum A+ precede ogni ramo P4. Ogni packet modifica un solo confine e
resta sotto circa 300 LOC. La preview route viene dopo owner, invalidazione,
selezione canonica e ingest. La route non crea il broker e accetta soltanto
`handle` e `requestId` come input applicativi.

Il wiring client del lock e un packet separato dal core session-scoped. Nessun
claim end-to-end include il lock finche il client non attende una conferma
server verificabile.

## Alternative scartate

### Selezione indipendente per tab nella 0.8.5

Scartata perche richiede un nuovo contesto opaco, routing e invalidazione tra
tab. La selezione unica per sessione e piu piccola e fallisce chiusa.

### Broker globale o broker per richiesta

Scartati perche il broker globale mescola sessioni, mentre quello per richiesta
perde lease, replay, consume-once e revoca.

### Riferimenti forniti dal chiamante

Scartati perche trasformano patient, ambulatory, epoch o lease in authority
ricostruibile fuori dall'host.

### Persistenza o replica del broker

Scartate perche aumentano la superficie plaintext e introducono un secondo
confine di sicurezza. Il riavvio deve negare, non ricostruire.

## Falsificatori e stop condition

Fermare la promozione se:

- due sessioni consumano gli stessi handle o condividono un broker;
- una route crea un broker per richiesta;
- un cookie, patient ID o valore caller-supplied diventa authority;
- un cambio paziente o ambulatorio lascia valido il vecchio handle;
- `selectionEpoch` non cresce monotonicamente nell'owner;
- logout, lock confermato, expiry, reset o revoca lasciano stato consumabile;
- il lock client viene dichiarato efficace senza conferma server;
- una sessione agente o `local-api` eredita l'autorita del medico;
- un restart ricostruisce o accetta un handle precedente;
- P4 o un adapter ricostruisce, osserva o falsifica la relazione privata tra
  owner, lease e broker;
- una reservation `staged` o `aborted` diventa osservabile da P4;
- un commit usa yield, `Promise`, thenable, callback o re-entry, oppure
  verifica lease/currentness dopo la pubblicazione;
- proxy, accessor o reflection del chiamante producono un effetto prima del
  commit;
- una topologia multi-process aggiunge replica, persistenza o fallback senza
  una nuova decisione;
- projection, handle o riferimenti clinici entrano in log o storage.

## Non-obiettivi e stato di delivery

Questo packet non aggiunge runtime, route, UI, session hooks, registry, broker,
store, database, migrazioni, provider, invocazioni, cloud, egress o apply. Non
modifica la semantica clinica di Smart Import e non abilita AIP o Mini.

Lo stato di delivery e `ADR0096_ACCEPTED_CI_PENDING_MANAGER_VERIFY`. Ogni packet
runtime richiede un'autorizzazione manageriale separata.
