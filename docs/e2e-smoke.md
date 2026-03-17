<!-- Codex: created 2026-02-19 -->
# E2E Smoke (Web)

Questo documento descrive l'harness E2E web per validare interazioni principali
in ambiente isolato.

## Stato corrente

- Web: smoke test automatizzato con Playwright (`e2e/web-smoke.spec.ts`).
- macOS: testing tracciato separatamente nel playbook native:
  - [docs/native-testing.md](./native-testing.md)

Riferimenti correlati:
- [docs/parity-matrix.md](./parity-matrix.md)
- [PLANS.md](../PLANS.md)
- [docs/README.md](./README.md)

## Prerequisiti

1. Node.js 20+
2. Dipendenza Playwright installata:
   - `npm install -D @playwright/test`
   - `npx playwright install chromium`

Nota: in ambienti senza rete il setup Playwright non puo essere completato.

## Esecuzione smoke (isolata)

Comando consigliato:

```bash
npm run e2e:smoke
```

Lo script:

1. usa un data dir isolato (`MEDIFLOW_DATA_DIR=./tmp-e2e-data`)
2. prepara credenziali deterministiche per smoke (`admin` + `E2E_PIN`, default `1234`)
3. resetta il DB smoke locale per evitare contaminazione tra run
4. avvia Next.js su una porta dedicata (`E2E_BASE_URL`, default `http://127.0.0.1:3100`) e su un `distDir` separato (`.next-e2e`)
5. attende readiness su `/api/auth/check` della stessa istanza
6. esegue i test Playwright smoke (`e2e/web-smoke.spec.ts`, `e2e/document-import.spec.ts`)

Nota:
- l'uso di `E2E_BASE_URL` evita collisioni con un eventuale server locale gia attivo su `:3000`

Output utili:

- log dev server: `tmp-e2e-data/logs/next-dev.log`
- report Playwright: `playwright-report/`
- artefatti test: `test-results/`

## Esecuzione in VM macOS (raccomandata)

Per test ripetibili dei click-path:

1. crea snapshot VM "clean"
2. clona/apri repo nella VM
3. esegui `npm run e2e:smoke`
4. valida esito, raccogli report
5. ripristina snapshot prima del run successivo

Questo evita contaminazione di sessioni locali, token e cache browser.

## Nota parity testing
Per i run parity completi, combina:

1. `npm run e2e:smoke` (web)
2. `npm run test:native` oppure `npm run test:native:xcode` (macOS)

Oppure usa il runner unificato:

```bash
npm run test:parity:smoke
```

Dettagli:
- [docs/parity-smoke.md](./parity-smoke.md)
