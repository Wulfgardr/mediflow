# OpenAPI `/api/v1` — Runbook di Manutenzione

Stato documento: `SECONDARY`  
Fonte canonica del contratto: [docs/openapi/mediflow-v1.yaml](./mediflow-v1.yaml)  
Decisione di riferimento: [docs/adr/0010-openapi-spec-first-for-api-v1.md](../adr/0010-openapi-spec-first-for-api-v1.md)

## A cosa serve

Questo file spiega **come mantenere aggiornata** la documentazione OpenAPI mentre
lo sviluppo continua.

La spec OpenAPI non descrive tutto il backend MediFlow. Descrive solo il
**contratto client-facing** esposto in modo stabile sotto `/api/v1/*`.

## Cosa entra nella spec

Metti nella spec:

- endpoint esposti sotto `/api/v1/*`
- parametri query/path
- payload request/response
- auth richiesta
- errori osservabili dai client

Non mettere nella spec:

- endpoint interni `app/api/*` usati solo dal web
- proxy locali tecnici (es. ICD, Ollama) se non fanno parte del contratto `/api/v1`
- dettagli implementativi del DB o della logica interna

Regola pratica:

Se un client macOS/iOS/iPadOS deve potersi affidare stabilmente a quell'endpoint,
allora quell'endpoint deve stare nella spec.

## Regola ricorsiva

Ogni PR che tocca uno di questi punti deve fare una delle due cose:

- aggiornare [docs/openapi/mediflow-v1.yaml](./mediflow-v1.yaml)
- dichiarare esplicitamente `no contract impact`

File/aree da considerare sensibili:

- `app/api/v1/*`
- `lib/api/v1/types.ts`
- client/model consumer native collegati a `/api/v1`
- `docs/openapi/contract-policy.json` per eccezioni di coverage e override breaking

Domanda guida per la review:

> Se genero o leggo oggi il contratto OpenAPI, il comportamento osservabile del
> client cambia?

Se la risposta e `si`, la spec va aggiornata.

## Workflow minimo

1. Classifica il cambiamento:
   - solo implementazione interna
   - cambiamento contrattuale non-breaking
   - cambiamento breaking
2. Se il cambiamento tocca il contratto, aggiorna la spec nello stesso diff.
3. Allinea eventuali consumer (`lib/api/v1/types.ts`, client Swift, docs collegate).
4. Nella PR scrivi cosa e cambiato:
   - spec aggiornata
   - oppure `no contract impact`
5. Se il cambio e breaking o deprecante, aggiorna prima ADR/PLANS/Linear.
6. Esegui `npm run check:openapi:drift` per verificare coverage, drift e breaking.

## Registro eccezioni e override

- `docs/openapi/contract-policy.json` elenca gli endpoint implementati ma ancora
  fuori dalla slice OpenAPI pubblicata; una nuova operation `/api/v1` deve stare
  o nella spec o in questo registro
- `breakingOverrides` nello stesso file e il punto unico per deroghe intenzionali:
  ogni voce deve citare il change esatto bloccato dal guard e il Linear issue che
  la giustifica

## Versioning semplice

- `info.version`:
  - `patch` per chiarimenti, esempi, correzioni senza cambio di shape
  - `minor` per aggiunte non-breaking
- `/api/v1` resta invariato finche il contratto rimane retrocompatibile
- breaking change: nuova major (`/api/v2`) o finestra di compatibilita esplicita

## Esempi rapidi

Aggiorna la spec:

- aggiungi un nuovo campo opzionale in risposta
- aggiungi un nuovo query parameter opzionale
- aggiungi un nuovo endpoint stabile in `/api/v1`
- cambi il payload di errore osservabile dal client

`no contract impact` plausibile:

- refactor SQL interno senza cambiare response
- miglioramento logging
- riorganizzazione helper privata
- fix interno che non cambia shape, semantica o auth

## Baseline attuale

La baseline iniziale copre:

- `GET /api/v1/patients`
- `GET /api/v1/patients/{id}`
- `PUT /api/v1/patients/{id}`
- `DELETE /api/v1/patients/{id}`

L'estensione agli altri endpoint `v1` va fatta per moduli stabili, senza
gonfiare la spec in un unico passaggio.
