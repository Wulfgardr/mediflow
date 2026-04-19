# ADR 0015: Taxonomy audit minima e logging PHI-safe

Date: 2026-03-17  
Status: Accepted

---

## Problema

MediFlow non ha ancora una taxonomy audit canonica e versionata. Senza una
lingua comune, i log rischiano di diventare ad hoc, incoerenti tra web e native
e, soprattutto, troppo ricchi di dettagli clinici.

Serve una base minima per tracciare chi ha fatto cosa, quando, da quale
superficie e con quale esito, senza trasformare il logging applicativo in un
contenitore di PHI.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono local-first, nessun egress cloud
  di default e logging PHI-safe.
  taxonomy e i confini, non il writer append-only completo.
- Non vogliamo toccare backup, parity native o UI per introdurre questa base.

## Opzioni

1. Continuare con log testuali liberi e convenzioni locali per ciascun modulo.
2. Definire un envelope audit generico ma senza catalogo versionato.
3. Introdurre un catalogo audit versionato con schema minimo e confini PHI-safe
   espliciti.

## Trade-off

- Opzione 1:
  - Pro: nessun lavoro iniziale.
  - Contro: drift, scarsa auditabilita e alto rischio di leak.
- Opzione 2:
  - Pro: un po' piu ordinata dei log liberi.
  - Contro: manca una fonte di verita stabile e valida per i client.
- Opzione 3:
  - Pro: contratto chiaro, auditability migliore, difesa migliore contro
    logging eccessivo.
  - Contro: richiede disciplina e un follow-up per il writer append-only.

## Decisione

Adottiamo l'opzione 3.

La taxonomy canonica e `audit.v1`.

### Event catalogo minimo

Eventi core:

- `auth.login.succeeded`
- `auth.login.failed`
- `auth.logout`
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `patient.restored`
- `entry.created`
- `entry.updated`
- `entry.deleted`
- `therapy.created`
- `therapy.updated`
- `therapy.deleted`
- `observation.created`
- `observation.updated`
- `observation.deleted`
- `settings.updated`

Regole:

- ogni evento deve essere classificato con un `eventType` stabile e non libero
- l'esito deve essere esplicito (`success`, `failure`, `denied`)
- il catalogo non deve includere testo narrativo o motivazioni cliniche libere

### Schema evento v1

Ogni record audit deve seguire questo shape logico:

```ts
type AuditEventV1 = {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  occurredAt: string;
  outcome: 'success' | 'failure' | 'denied';
  actorType: 'user' | 'system';
  actorRef: string;
  subjectType: 'session' | 'patient' | 'entry' | 'therapy' | 'observation' | 'settings';
  subjectRef?: string;
  sourceSurface: 'web' | 'native' | 'api' | 'job';
  requestId?: string;
  redactedMetadata?: {
    changedFields?: string[];
    resourceVersion?: number;
    counts?: number;
    flags?: string[];
    reasonCode?: string;
  };
};
```

Regole di schema:

- `actorRef` e `subjectRef` devono essere riferimenti interni o redatti, mai
  nomi, codici fiscali o testo libero
- `redactedMetadata` puo contenere solo valori strutturati e non narrativi
- `subjectRef` puo essere omesso per gli eventi auth che non hanno un soggetto
  stabile da esporre

### Boundaries PHI-safe

Consentito nel catalogo audit:

- timestamp, outcome e tipo evento
- riferimenti interni o redatti
- numeri di versione, conteggi, flag e codici di stato
- nomi di superfici tecniche (`web`, `native`, `api`, `job`)

Vietato nel catalogo audit e nei log applicativi:

- testo OCR grezzo
- note paziente, diario o prompt AI in chiaro
- allegati o base64
- PIN, token, chiavi o salt
- descrizioni cliniche libere o motivazioni narrative non redatte

## Conseguenze

- Positivo: i lavori futuri su audit trail, actor attribution e viewer possono
  condividere un contratto stabile.
- Positivo: la policy di logging diventa verificabile e allineata tra web e
  native.
- Negativo: i futuri writer dovranno rispettare uno schema piu rigido.
- Vincolo: questa ADR non implementa ancora il writer append-only o l'export.

## First Thin Slice

1. Usare `audit.v1` come fonte canonica per i futuri writer.
2. Tenere i log applicativi fuori dal contenuto clinico.
3. Implementare il writer append-only e la UI/estrazione audit in una issue
   successiva.
