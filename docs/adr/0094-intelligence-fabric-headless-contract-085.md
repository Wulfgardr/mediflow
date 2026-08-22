# ADR 0094: contratto Intelligence Fabric e headless 0.8.5

Date: 2026-08-22
Status: Proposed

Issue: WUL-522
Baseline: `main` a `0d55c6d0f`, versione `0.8.2`
Program line: candidato `0.8.5`

Related: [ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0090](./0090-giunture-fabric-trust-onboarding-routing-interazione.md),
[ADR 0091](./0091-candidato-locale-fabric-admissione-continuita-status.md),
[ADR 0092](./0092-limite-digest-bound-readiness-ai-locale.md), ADR 0093
in [PR #185](https://github.com/Wulfgardr/mediflow/pull/185).

## Problema

La PR #159 ha portato su `main` il nucleo locale Intelligence Fabric. Patient
Insight e Document Synthesis producono gia metadati Fabric. Smart Import, OCR e
Treatment Reasoning invocano ancora il runtime locale senza passare dallo
stesso resolver host-owned.

Il piano headless validato nelle PR #184, #187 e #190 resta in uno stack che
dipende dalla PR #180. Lo stack mescola contratto, backend, mockup web e shell
in 1.309 righe aggiunte. Non e una base revisionabile per il bridge Fabric.

Serve un contratto unico prima del runtime. Il contratto deve distinguere la
scopribilita dell'interfaccia dall'autorita sui dati, il routing Fabric
dall'input del chiamante e la review durabile dall'apply clinico.

## Baseline verificata

| Area | Stato su `main` | Conseguenza |
| --- | --- | --- |
| Fabric | PR #159 merged; resolver, cataloghi, lifecycle candidato, receipt e provenance presenti | Il nuovo lavoro estende il nucleo; non lo sostituisce. |
| Patient Insight | Adapter Fabric presente | Serve un gate che impedisca il bypass del resolver. |
| Document Synthesis | Adapter Fabric presente | Serve lo stesso gate del Patient Insight. |
| Smart Import | Invocazione diretta di `AIService` | Deve migrare in un packet dedicato. |
| OCR | Invocazione diretta di `AIService` | Deve migrare in un packet dedicato. |
| Treatment Reasoning | Lane ATHENA MLX separata | Deve ricevere una risoluzione Fabric prima dell'invocazione. |
| Headless | PR #180-#190 aperte e draft | Le branch restano preservate; i packet vengono ricostruiti da `main`. |

## Decisioni candidate

L'accettazione deve registrare in WUL-522 l'approvazione esplicita di D1-D9.
Fino a quel momento nessun packet runtime e autorizzato.

### D1. Interfaccia installata, dati non pubblici

Il candidato 0.8.5 installa e rende scopribile l'interfaccia headless per
default. Help, versione, schema e catalogo delle disposition possono essere
letti senza una projection clinica.

Ogni dato paziente richiede una credenziale agentica breve e broker-owned,
sessione medica valida, lease, capability e projection minima. Pairing, token
locale, manifest, receipt o presenza del processo non concedono autorita.

### D2. Routing solo host-owned

Il chiamante dichiara una capability e argomenti conformi allo schema. Non
sceglie provider, modello, credenziale, endpoint o venue. Il Fabric host-owned
risolve questi valori da policy e stato correnti.

Il risultato include receipt e provenance PHI-safe. Receipt e provenance
descrivono una decisione; non sono grant e non possono essere riusate come
credenziali.

### D3. Operazioni specifiche, nessun invoke generico

Il contratto espone soltanto operazioni nominate e schema-bound. Nel candidato
sono ammesse `read`, `review` e `preview` quando la capability le dichiara.

Non esiste un comando headless `invoke`, `run-model` o equivalente. Un adapter
non puo inoltrare prompt libero, nome modello, provider options o parametri di
trasporto.

### D4. Selezione paziente e lifecycle

Ogni operazione clinica lega mandato, ambulatorio, paziente selezionato,
capability, stadio massimo, versione manifest e `selectionEpoch` broker-owned.

Lock, logout, revoca, expiry, cambio paziente o cambio epoch invalidano la
sessione e il lease prima della richiesta successiva. Il replay resta negato.
Gli input equivalenti forniti dal chiamante sono non fidati.

### D5. Apply negato nella 0.8.5

Il massimo stadio headless e `preview`. `apply` e ogni scrittura clinica sono
negati dal contratto anche dopo una review positiva.

Un futuro apply richiede un ADR separato, attore medico corrente, step-up
broker-owned e un comando applicativo distinto. La receipt Fabric non soddisfa
questi requisiti.

### D6. Cinque call path sotto lo stesso Fabric

Patient Insight, Document Synthesis, Smart Import, OCR e Treatment Reasoning
devono ottenere una risoluzione Fabric valida prima di ogni invocazione
generativa locale. Ogni path conserva kill switch, schema, timeout e semantica
review-first propri.

Il gate deve fallire se un path chiama direttamente un provider o se una
negazione Fabric viene trasformata in un fallback.

### D7. Lifecycle e review durabili

Stato provider locale, revoca, degrado e review sopravvivono al riavvio
attraverso servizi applicativi host-owned. Il piano headless non accede
direttamente a SQLite e non definisce migrazioni.

La review registra stato, attore, riferimenti opachi, receipt e versione. Il
record non contiene prompt, risposta grezza o testo clinico. Review e apply
restano lifecycle distinti.

### D8. Pilot senza egress

Il candidato usa fixture sintetiche e venue locali approvate. Sono esclusi
cloud, provider remoti, credenziali reali, rete generica, accesso diretto a
SQLite e fallback silenzioso.

`egress=none` richiede prove sul path completo. Loopback, nome del provider o
digest del modello non dimostrano da soli l'assenza di egress.

### D9. Manifest AIP-Fabric-Mini

Un manifest machine-readable collega capability AIP, capability Fabric,
operazione Mini, schema, disposition, stadio massimo, context binding, egress,
fallback e reason.

Il drift gate confronta cataloghi Fabric, manifest AIP e comandi Mini. Deve
fallire su ID mancanti o duplicati, binding incoerenti, generic invoke,
disposition senza reason, path generativo non governato e metrica non
ricalcolabile.

## Riconciliazione WUL-553, WUL-554 e WUL-555

| Issue | Decisione | Prova semantica | Preservazione |
| --- | --- | --- | --- |
| WUL-553 | Ancora unica; da ricostruire | PR #181 classifica OpenAPI, paired e Fabric con drift gate. Il manifest Mini copre invece 66 righe web e non sostituisce il catalogo AIP. | Conservare PR #181; ricostruire manifest e gate da `main`, poi aggiungere il bridge D9. |
| WUL-554 | Ancora unica; da ricostruire | PR #183 definisce `patient_open_loops.v1`, provenienza, freshness e filtro single-patient. Nessun modulo equivalente e su `main`. | Conservare PR #183; riusare contratto e test sintetici in un packet isolato. |
| WUL-555 | Implementazione sostituita; requisiti ancora vincolanti | PR #182 valuta sessione, lease, request e clock forniti insieme dal chiamante. ADR 0093 e PR #187 spostano stato, clock, revoca e `selectionEpoch` nel broker. | Conservare PR #182 come prova negativa; ricostruire il broker verificato da `main`, senza riusare l'evaluator come authority runtime. |

Nessuna issue o PR viene chiusa, riscritta o cancellata da questa decisione.

## Stack sostitutivo non distruttivo

```text
P0 ADR 0094 (questo packet)
 |
 +--> A1 ADR 0093 ricostruita da main
       |
       +--> A2 broker/session/lease/revoca/epoch
       +--> A3 projection patient_open_loops.v1 [WUL-554]
       +--> A4 manifest AIP e drift base [WUL-553]
              \        |        /
               A5 shared service read/review/preview

P0 --> F1 contratto invocazione Fabric host-owned
       +--> F2 Patient Insight gate
       +--> F3 Document Synthesis gate
       +--> F4 Smart Import adapter
       +--> F5 OCR/fallback adapter
       +--> F6 Treatment Reasoning adapter
       +--> L1 lifecycle provider durabile
       +--> L2 review durabile senza apply

A5 + F2..F6 + L1 + L2 --> B1 bridge AIP-Fabric
A4 + B1               --> M1 manifest AIP-Fabric-Mini e drift
M1                    --> M2 contratto Mini ricostruito
M2                    --> M3 adapter Mini ricostruito
M3                    --> I1 integrazione sintetica end-to-end
I1                    --> V1 verifica indipendente WUL-564
```

Ogni packet parte da `main`, modifica un solo confine e resta sotto circa 300
LOC. F2 e F3 possono essere packet di gate e test se il codice merged soddisfa
gia D6. Le PR #180-#190 e le relative branch restano evidenza read-only fino
alla verifica dei sostituti.

| Packet logico | Dipende da | Confine |
| --- | --- | --- |
| F4 Smart Import | F1 | Resolver e receipt prima dell'attuale invocazione generativa. |
| F5 OCR/fallback | F1 | Resolver prima dell'OCR; fallback locale esplicito o negato, mai silenzioso. |
| F6 Treatment Reasoning | F1 | Risoluzione host-owned prima della lane ATHENA MLX. |
| L1-L2 lifecycle/review | P0 | Stato provider e review durabili, senza apply clinico. |
| B1-M1 bridge/manifest | A5, F2-F6, L1-L2 | Operazioni capability-specific e binding AIP-Fabric-Mini. |
| I1 integrazione sintetica | M3 | Broker, Fabric, proposta, receipt e review con denial lifecycle ed egress. |

## Falsificatori e stop condition

Riaprire l'ADR e fermare la promozione se:

- la discovery restituisce dati clinici senza broker;
- il chiamante influenza provider, modello, credenziale, endpoint o venue;
- una capability accetta prompt libero o generic invoke;
- revoca, expiry o cambio selezione non precedono la richiesta successiva;
- uno dei cinque path raggiunge un provider senza risoluzione Fabric;
- review e apply condividono lo stesso stato o comando;
- una receipt contiene testo clinico o autorizza un consumer;
- compare egress, fallback, provider reale o accesso SQLite dal piano headless;
- il manifest non rileva una divergenza tra AIP, Fabric e Mini.

## Non-obiettivi

- Nessun runtime, route, UI web o client Apple in questo packet.
- Nessun provider, modello, account, credenziale o dato paziente reale.
- Nessuna migrazione, scrittura clinica, MCP, REST agentico o cloud.
- Nessun version bump, merge, tag, release, cleanup o security review.

## First Thin Slice

1. Pubblicare questa ADR come `Proposed` con il DAG e la riconciliazione.
2. Registrare in WUL-522 l'accettazione o le modifiche richieste a D1-D9.
3. Solo dopo l'accettazione, ricostruire A1 da `main` come packet ADR-only.
4. Tenere ogni packet runtime bloccato fino al gate precedente verificato.
