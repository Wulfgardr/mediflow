# ADR 0108: piano canonico Headless read-only 0.8.5

Date: 2026-08-31

Status: Accepted

## Problema

Il catalogo Headless contiene 66 anchor semantici canonici, ordinati e
verificati, ma nessuno e ancora un'operazione eseguibile. Gli anchor descrivono
funzioni applicative composte: alcuni includono letture e scritture, altri
amministrazione, UI o smart path. Trattare `66/66` come 66 endpoint o 66 grant
read produrrebbe autorita e semantica non dimostrate.

La superficie `/api/v1/network/*` offre 32 `GET` documentati in OpenAPI e
presenti nel runtime. Queste route sono evidence di implementazione, non ID
semantici Headless, Application Service o grant riutilizzabili.

## Decisione

Per la 0.8.5, `66/66 read plan` significa 66 esiti terminali, uno per ogni
anchor nell'ordine canonico:

- ogni riga e `manual_only` o `unavailable` finche un packet successivo non
  soddisfa integralmente il contratto operativo;
- una riga puo elencare zero o piu candidati read direttamente osservati, senza
  trasformarli in `operationId` o `applicationServiceRef`;
- un anchor misto puo avere piu candidati; la cardinalita degli anchor non
  impone la cardinalita delle future operazioni;
- una route, un `operationId` OpenAPI o un alias Mini non costituisce identita,
  authority, sessione, lease o receipt Headless;
- `applyPolicy=none`, `writesPerformed=0` e assenza di trasporto restano
  invarianti del piano.

Un futuro read diventa `available` solo quando lo stesso packet fornisce i 13
campi di ADR 0100: operation e capability ID, Application Service, schemi
input/output, maximum stage, authority, session, CAS, idempotenza, limiti,
receipt e dipendenza Fabric. Evidenza mancante o conflittuale lascia il read
non grantable.

## Prima slice

1. Materializzare 66 righe immutabili dall'esatto catalogo canonico.
2. Collegare soltanto i 32 `GET` network osservati come evidence candidate,
   tramite mapping esplicito e senza equivalenza nominale.
3. Chiudere la copertura positiva dei 32 `GET` con fixture sintetiche.
4. Verificare conteggi, ordine, unicita, route/OpenAPI drift, assenza di
   operation grant, write, apply, trasporto e accesso diretto a SQLite.

La slice non introduce planner, runtime, adapter, listener, provider, UI,
persistenza o business logic. Il normale read non riusa lo step-up physician
riservato alla sola scrittura SOAP da ADR 0097 e ADR 0103.

## Conseguenze

Il piano rende il residuo calcolabile senza gonfiare il claim: 66/66 righe sono
decise, mentre il numero di operazioni Headless eseguibili resta zero. I
candidati read possono essere promossi uno per packet sopra Application
Service host-owned, con authority e receipt proprie.

## Stop rule

Fermare il packet se:

- un ID route, AIP o Mini viene pubblicato come operation ID semantico;
- un mapping nasce da nome, posizione o somiglianza invece che da evidence
  esplicita;
- una riga omette l'esito terminale o una delle 66 identita canoniche;
- compare `available`, write, apply, SQLite diretto, egress o trasporto;
- una route o un adapter assorbe business logic applicativa;
- il piano viene presentato come runtime, integrazione o release readiness.

## Claim ceiling

Il claim massimo e: "piano locale Headless read-only completo per 66 anchor,
con candidati osservati ma zero operazioni eseguibili". Non prova autonomia,
authority agentica, apply, parity, integrazione, release readiness o release.
