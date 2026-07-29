# ADR 0091: candidato locale Fabric, admissione provider, continuita e stato paired

Date: 2026-07-29
Status: Accepted

Issue: WUL-522 (completamento tecnico post-0.8)

Program line: post-0.8
Baseline: branch `codex/WUL-522-intelligence-fabric-cos-local` a
`31c506c25` (S4 chiuso `GO` sul codice `54040f2e8`)

Related:
[ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md),
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md),
[ADR 0088](./0088-limite-digest-bound-readiness-ai-locale.md),
[ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0090](./0090-giunture-fabric-trust-onboarding-routing-interazione.md).

## Problema

ADR 0089 e ADR 0090 definiscono il nucleo Fabric e le sue giunture. Il
closeout S4 ne ha verificato i contratti, ma restano quattro limiti:

1. onboarding e classi di credenziale non hanno un ciclo operativo per stato
   degradato e revoca provider;
2. una venue `unknown` puo ancora arrivare al resolver e lo stato `degraded`
   non e negato per default;
3. il client paired legge un riepilogo AI che nomina un fallback locale non
   implementato e non espone il contratto Fabric fail-closed;
4. routing, ricevuta, provenienza e review medica non hanno una prova
   sintetica unica.

Il data plane paired non autorizza invocazioni AI. La venue `home_base` di
ADR 0089 non concede questa autorita.

## Decisione

Il candidato locale applica quattro regole.

### 1. Admissione provider dichiarativa

- Il ciclo operativo provider e separato dall'onboarding.
- Gli stati sono `available_unqualified`, `degraded` e `revoked`.
- La revoca e terminale. Il recupero e consentito solo da `degraded`.
- Lo stato contiene provider, classe di credenziale e stato operativo. Non
  contiene segreti, token, endpoint, prompt o payload clinici.
- Solo un onboarding `enabled` puo iniziare il ciclo operativo.
- `consumer_login` e `subscription` non concedono accesso provider.
- Le classi cloud restano negate finche il gate egress e chiuso.
- Il percorso candidato richiede uno stato provider coerente con la ricevuta.
  Il resolver di basso livello resta una primitiva pura e non prova, da solo,
  l'admissione runtime.

Questa decisione verifica revoca e degrado come enforcement locale e
sintetico. Non dichiara un broker credenziali o una revoca vendor.

### 2. Continuita fail-closed

- `offline`, `unknown` e `degraded` negano la risoluzione nel percorso
  candidato.
- La negazione conserva la venue richiesta e produce un record osservabile.
- Pairing revocato, re-pairing richiesto o sessione scaduta non diventano
  stato offline generico nel modello di continuita.
- Nessuna negazione sceglie un'altra venue.
- `on_device` resta `not_implemented`.
- `cloud` resta `egress_profile_closed`.
- Il fallback resta sempre `denied_by_contract`.

### 3. Proiezione paired in sola lettura

`GET /api/v1/network/ai-runtime` puo esporre una proiezione Fabric PHI-safe:

- versione del contratto;
- accesso `status_only`;
- esecuzione paired `not_authorized`;
- gate egress chiuso;
- readiness `available_unqualified`;
- fallback negato;
- stato dichiarativo delle quattro venue.

La proiezione non accetta richieste AI e non concede capability, sessione,
pairing o autorita clinica. Il modello Swift condiviso puo decodificarla per
macOS, iPhone e iPad senza nuova UI. Il valore legacy
`client-local-runtime-else-ai-unavailable` viene sostituito con una semantica
che nega ogni fallback automatico.

### 4. Harness sintetico end-to-end

Un harness locale compone:

1. onboarding;
2. ciclo operativo provider;
3. osservazione della venue;
4. risoluzione e ricevuta;
5. provenienza;
6. proposta e review del medico.

Le prove includono revoca, degrado, offline, riconnessione, cloud chiuso,
on-device assente e una capability deterministica `in_house`. L'harness non
scrive dati clinici e non sostituisce i servizi applicativi reali.

## DAG e ownership

```text
P1 provider admission ──┐
                        ├── P3 harness end-to-end
P2 status paired/Swift ─┘
```

| Packet | Ownership esclusiva | Falsificatore |
| --- | --- | --- |
| P1 admissione e continuita | nuovi moduli Fabric; edit bounded a routing observability; test relativi | provider revocato/degradato o venue unknown produce una ricevuta |
| P2 proiezione status | modello network AI, tipi API, OpenAPI, modello/test Swift condiviso | il paired ottiene un grant AI, un fallback locale o un payload con segreti |
| P3 harness | nuovo harness Fabric e test di composizione | review accettata senza medico/provenienza, fallback implicito o core non-AI bloccato |

Un solo writer possiede ogni file per wave. P3 parte solo dopo l'integrazione
di P1 e P2.

## Non-obiettivi e blocker esterni

- Nessun provider, account, API vendor o credenziale reale.
- Nessun broker segreti, rotazione o revoca vendor.
- Nessuna esecuzione `cloud` o `on_device`.
- Nessuna invocazione AI dal client paired.
- Nessuna coda offline o riconciliazione di output AI.
- Nessun writer, route applicativa o UI per una scrittura clinica.
- Nessuna readiness qualificata: ADR 0088 resta `HOLD`.
- Nessuna prova su device, LAN reale o entitlement Apple.

## Regole di arresto

Fermare il packet se:

1. apre egress o abilita una venue bloccata;
2. introduce un segreto o un dato clinico nel contratto;
3. trasforma pairing o stato provider in un grant ereditato;
4. applica fallback automatico;
5. introduce una scrittura clinica senza comando separato e review medica;
6. rende il core non-AI dipendente dal Fabric;
7. richiede un cambio breaking di `/api/v1` non documentato.

## Alternative rifiutate

- Integrare subito tutti i call site AI: rifiutato, perche non esiste ancora
  uno stato provider persistente e verificato.
- Esporre un endpoint AI paired: rifiutato, perche amplia il data plane e
  richiede un ADR e un threat model dedicati.
- Simulare cloud o on-device come disponibili: rifiutato, perche produrrebbe
  una prova falsa.
- Aggiungere una UI: rifiutato, perche il requisito e contrattuale e non
  richiede una decisione estetica.

## Verifica richiesta

- test mirati Fabric, network, OpenAPI e Swift disponibili;
- suite unit completa, typecheck, lint e build web;
- claims, never-regress e OpenAPI drift;
- concorrenza pairing;
- falsificatori egress, fallback, revoca, degrado, provenance e review;
- verifica indipendente a contesto fresco.

