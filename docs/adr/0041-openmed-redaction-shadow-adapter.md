<!-- Codex: created 2026-03-21 -->
# ADR 0041: OpenMed redaction shadow adapter interno

Date: 2026-03-21
Status: Proposed

---

## Problema

Il benchmark `WUL-96` mostra che OpenMed e promettente come lane locale
specializzata per PII/redaction in italiano, ma il repo non ha ancora un
contratto applicativo esplicito per usarlo senza mescolare benchmark, proxy
generici e flussi clinici autoritativi.

Senza uno strato adapter minimo, il rischio e introdurre un uso opportunistico
del sidecar dentro il runtime generativo o direttamente nei write path clinici,
violando i confini fissati da `ARCHITECTURE.md`, `SECURITY.md` e dalla nota
benchmark [docs/openmed-toolkit-evaluation.md](../openmed-toolkit-evaluation.md).

## Opzioni

1. Restare solo con benchmark headless e nessuna surface applicativa.
2. Esporre subito OpenMed come nuovo contratto client-facing `/api/v1`.
3. Introdurre prima una route interna autenticata che normalizzi OpenMed in una
   shape `redaction.v1`, restando fuori da `/api/v1` e dai write path
   autoritativi.

## Trade-off

- Opzione 1:
  - Pro: rischio minimo nel breve.
  - Contro: nessun punto d'integrazione concreto per shadow mode o future UI.
- Opzione 2:
  - Pro: contratto apparentemente pronto per native.
  - Contro: congela troppo presto una surface ancora sperimentale e apre un
    impegno di backward compatibility non giustificato.
- Opzione 3:
  - Pro: rende l'integrazione locale testabile, autenticata e separata dal core
    generativo senza promettere ancora stabilita client-facing.
  - Contro: aggiunge una surface interna in piu da mantenere.

## Decisione

Adottiamo l'opzione 3.

Introduciamo una route interna autenticata `POST /api/system/redaction` con
smoke `GET /api/system/redaction`, basata su un adapter server-side locale che:

- usa solo target localhost allowlisted tramite `lib/local-target.ts`
- accetta sessione web o local API token, coerentemente con gli altri adapter
  locali
- espone una shape normalizzata `redaction.v1` indipendente dalle label grezze
  OpenMed
- legge configurazione locale da env/settings senza nuove tabelle o dipendenze
- resta in shadow lane, senza persistere testo redatto nei campi clinici
  autoritativi

La shape `redaction.v1` non e ancora un contratto `/api/v1`: e un foundation
layer interno per web/native-local orchestration.

## Fuori scope esplicito

- nessun riuso del proxy chat generico
- nessuna sostituzione del runtime generativo `ollama`
- nessuna mutazione automatica di `patients.aiSummary`,
  `patients.documentInsights` o altri campi persistiti
- nessuna pubblicazione OpenAPI o promessa di stabilita client-facing

## Conseguenze

- Positivo: MediFlow guadagna un hook applicativo reale per benchmark shadow e
  future UI di redaction.
- Positivo: la tassonomia label OpenMed viene compressa in una shape piu stabile
  lato app.
- Positivo: la configurazione resta locale e compatibile con il threat model
  SSRF gia esistente.
- Negativo: finche la lane resta shadow non c'e ancora valore user-facing
  diretto.
- Negativo: serviranno benchmark aggiuntivi su precision e corpora piu ampi
  prima di usare la lane come trasformazione operativa pre-prompt.

## First Thin Slice

1. Estendere l'allowlist locale alla porta OpenMed benchmark (`18080`).
2. Introdurre helper server-side `openmed-redaction` con:
   - config resolution env/settings
   - validazione input minima
   - normalizzazione label -> `redaction.v1`
3. Esporre `GET/POST /api/system/redaction` con auth locale e no PHI nei log.
4. Coprire il foundation helper con test isolati e mantenere il benchmark
   esistente come gate lane-specific.
