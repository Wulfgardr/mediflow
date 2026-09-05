# ADR 0095: broker di projection e servizi host per capability

Date: 2026-08-22
Status: Accepted

Issue: WUL-522
Baseline: PR #214, branch `codex/WUL-522-fabric-provider-lifecycle-service`
a `b232453537bd731bd2603bddfc312fbc383c9280`
Program line: candidato `0.8.5`

Related: [ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0090](./0090-giunture-fabric-trust-onboarding-routing-interazione.md),
[ADR 0091](./0091-candidato-locale-fabric-admissione-continuita-status.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md), ADR 0093 in
[PR #185](https://github.com/Wulfgardr/mediflow/pull/185), WUL-282 e WUL-564.

## Problema

ADR 0093 richiede un broker host-owned per sessione, selezione e projection
plaintext minimizzate. ADR 0094 richiede un solo Application Service Layer e
vieta a UI e Agent Interface Plane (AIP) di scegliere provider, modello, venue
o fallback.

Lo stack Fabric fino a PR #214 aggiunge uno store durevole e un servizio host
che separa lettura e controllo del lifecycle provider. Il consumer Smart
Import corrente resta pero client-side: ricostruisce un onboarding `enabled`,
ammette un lifecycle sintetico e invoca il provider tramite il proxy generico.
Il record durevole, invece, contiene gia l'esito host-owned dell'ammissione
post-onboarding.

Serve una decisione di composizione prima del runtime. La decisione deve
preservare il plaintext nel trust domain scelto dal medico, leggere il
lifecycle una volta sola e impedire che un adapter diventi un bypass del
Fabric o del servizio applicativo.

## Decisione

### 1. Il lifecycle record e l'esito autorevole post-onboarding

Un `ProviderLifecycleRecord` restituito e validato dal servizio host di sola
lettura e l'esito autorevole dell'ammissione post-onboarding.

- L'onboarding `enabled` resta obbligatorio soltanto per
  `control.admit`.
- Un consumer non ricostruisce l'onboarding e non lo richiede a ogni
  invocazione.
- Il capability service legge il lifecycle esattamente una volta per
  operazione e riusa lo stesso snapshot validato fino alla decisione Fabric.
- `missing`, `corrupt`, `unavailable`, `degraded` e `revoked` negano prima
  dell'invocazione provider.
- Un mismatch tra i binding provider o credenziale del lifecycle record e la
  risoluzione host nega prima dell'invocazione provider.
- Un mismatch indipendente nella policy o nella receipt host-owned per modello,
  endpoint, venue, profilo egress o fallback nega prima dell'invocazione
  provider.
- Ogni denial mantiene `fallback: denied_by_contract`, `receipt: null` e zero
  generazione.

Il record non rende la readiness `qualified`, non concede una capability e non
autorizza un consumer. Il resolver Fabric applica ancora policy, receipt e
provenance all'operazione corrente.

### 2. Il client medico consegna una projection una sola volta

Dopo unlock e selezione esplicita, il client medico decifra e minimizza i soli
dati richiesti dalla capability. Il client consegna una projection tipizzata
al broker locale fidato tramite un canale applicativo autenticato.

La projection viene acquisita una sola volta per lease e lega almeno:

- schema e capability;
- sessione medico corrente;
- paziente selezionato tramite riferimento opaco;
- `selectionEpoch` broker-owned;
- provenienza, freshness, scopo e scadenza.

Il broker copia e possiede la projection soltanto in memoria. Restituisce un
handle opaco, breve e non riutilizzabile fuori dal lease. L'handle non contiene
plaintext, identita paziente, chiavi, prompt o authority ricostruibile.

Lock, logout, cambio paziente, cambio `selectionEpoch`, revoca, expiry o schema
incompatibile invalidano projection e handle prima della richiesta successiva.
Sessione, selezione, epoch, clock o projection equivalenti forniti dal
chiamante non sono authority.

### 3. L'host espone servizi nominati per capability

L'Application Service Layer host espone soltanto comandi `read` o `preview`
capability-specific. Per i cinque smart path sono esclusi prompt liberi e
`generic invoke`.

Ogni capability service:

1. risolve l'handle nel broker e verifica sessione, paziente ed epoch;
2. legge una volta il lifecycle tramite il servizio read-only;
3. risolve capability, provider, modello, endpoint, venue, egress e fallback
   tramite policy host-owned e Fabric;
4. costruisce il prompt dalla projection tipizzata;
5. invoca il provider soltanto dopo una decisione positiva;
6. restituisce una proposta sanitizzata con receipt e provenance PHI-safe.

UI, AIP e MediFlow Mini forniscono soltanto comando tipizzato, handle e
argomenti applicativi ammessi. Non possono fornire lifecycle, onboarding,
provider, modello, endpoint, venue, fallback, prompt o receipt da riusare.

### 4. Il controllo lifecycle resta privilegiato e separato

Il privileged lifecycle control resta host-only in una composition root
separata. Il capability service riceve soltanto il servizio di lettura.

UI, route consumer, AIP, Mini e adapter non importano, esportano o ricevono il
control. Una receipt, un handle o un `actorRef` non sostituiscono questo
confine.

### 5. Il proxy Ollama generico e legacy per i cinque smart path

`/api/proxy/ollama/chat` resta presente, ma non e conforme al contratto
end-to-end per Patient Insight, Document Synthesis, Smart Import, OCR e
Treatment Reasoning.

Ogni path deve migrare al proprio capability service prima di un claim Fabric
end-to-end. Questo packet non modifica o rimuove il proxy. Un header generico
non trasforma il proxy in un servizio applicativo e non autorizza il chiamante
a scegliere la capability.

### 6. Proposal e review restano separate da apply

L'output del capability service e una proposta sanitizzata e review-only. Il
servizio non restituisce prompt o risposta provider grezzi agli adapter.
Ne il broker ne il capability service persistono o registrano nei log la
projection grezza o la risposta provider grezza.

`apply` resta negato. Review persistente, job, conferma e applicazione sono
packet successivi. WUL-282 resta invariato e blocca qualunque apply.

### 7. Le identita restano distinte

Il medico autenticato, l'agente delegato e il provider AI sono identita
distinte. Sessione medico, mandato agentico e binding provider non si
ereditano a vicenda.

`actorClass: host_service` e il relativo `actorRef` sono metadata opachi della
singola operazione host. Non provano l'identita del medico, dell'agente o del
provider e non sono un grant riusabile.

### 8. AIP e Mini sono adapter, non bypass

AIP e Mini possono invocare soltanto capability nominate dell'Application
Service Layer entro mandato e lease broker-owned. Non accedono direttamente
al provider, al Fabric, al lifecycle store, al control o alla projection
plaintext.

## Topologia accettata

```text
browser medico
  -> broker projection ingest
  -> opaque short-lived handle
  -> capability-specific application service
  -> lifecycle read once
  -> Fabric resolve
  -> provider invoke
  -> sanitized proposal + receipt + provenance
```

AIP e Mini si collegano come adapter al capability service. Non introducono un
secondo percorso business e non diventano provider o bypass Fabric.

## Alternative scartate

### Fetch lifecycle solo client

Scartata perche sposta l'admissione nel consumer, separa la decisione
dall'invocazione e rende lifecycle o onboarding valori caller-controlled. Una
receipt client-side non autorizza l'hop provider.

### Ricostruzione sintetica dell'onboarding

Scartata perche dichiara `enabled` senza un evento host. Duplica l'autorita gia
registrata dal lifecycle record e puo ammettere un provider degradato o
revocato.

### Header capability sul proxy generico

Scartato perche un header e caller-controlled. Il proxy non possiede regole
applicative, projection, lifecycle o prompt builder capability-specific.

### SQLite diretto o plaintext costruito dal server

Scartati perche il server non deve ottenere la master key o leggere plaintext
dal database. Il client medico resta il punto che decifra, minimizza e lega la
projection alla selezione corrente.

## DAG reviewable e non distruttivo

```text
Headless evidence: #185 -> #187 -> #184 -> #190 --\
                                                   +-> broker production projection ingest
Fabric evidence:   #207 -> #211 -> #212 -> #213 -> #214 --/

broker production projection ingest
  -> lifecycle-aware capability service
  -> Smart Import adapter
  -> remaining four smart-path adapters
  -> persistent review and job
  -> independent verification WUL-564

WUL-282 -- blocks --> any apply
```

Le frecce indicano dipendenza e ordine di review, non autorizzazione al merge.
Il manager deve scegliere e verificare ogni base esatta prima del packet
successivo. Le PR esistenti restano draft ed evidence; questa ADR non le
riscrive, chiude o integra automaticamente.

Ogni packet modifica un solo confine, resta sotto circa 300 LOC e usa soltanto
fixture sintetiche. Nessun packet successivo e autorizzato da questa ADR senza
un gate manageriale esplicito.

## Falsificatori e stop condition

Fermare la promozione se:

- il lifecycle o l'onboarding sono forniti dal consumer;
- la stessa operazione legge il lifecycle piu di una volta;
- un handle contiene plaintext o sopravvive a revoca, expiry o cambio epoch;
- UI, AIP o Mini scelgono provider, modello, endpoint, venue o fallback;
- un consumer importa o riceve il privileged control;
- uno dei cinque smart path usa ancora il proxy generico nel claim end-to-end;
- un adapter riceve prompt o risposta provider grezzi;
- una denial genera output o una receipt non nulla;
- `host_service` viene presentato come identita medica;
- compare apply prima di WUL-282, review persistente e step-up accettato;
- compaiono PHI/PII reali, credenziali, cloud, egress o fallback silenzioso.

## Non-obiettivi e stato di delivery

Questo packet non aggiunge runtime, route, store, migrazioni, UI, provider,
credenziali, dati clinici, cloud, egress, apply, review persistente o job. Non
modifica il proxy legacy e non esegue merge o promotion.

Lo stato di delivery e `ADR0095_ACCEPTED_CI_PENDING_MANAGER_VERIFY`. Il primo
packet runtime resta soggetto a una nuova autorizzazione manageriale.
