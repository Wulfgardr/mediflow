# Test Concorrenza Pazienti (Web + Native API)

Runbook operativo per la suite minima `WUL-17` dedicata ai conflitti di scrittura sui pazienti.

Stato: `SECONDARY`  
Fonti canoniche correlate: [CONTRIBUTING.md](../CONTRIBUTING.md), [docs/native-testing.md](./native-testing.md), [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml)

## Obiettivo

Verificare in modo ripetibile che i write path web (`/api/patients/*`) e native (`/api/v1/patients/*`) si comportino in modo coerente quando due client usano la stessa `version` paziente.

La suite copre il thin slice introdotto con `WUL-15` e `WUL-16`:

- `update/update` cross-client con loser in `409 VERSION_CONFLICT`
- `update/delete` cross-client con loser in `409 VERSION_CONFLICT`
- report esplicito per lane `web` e lane `native-v1`

## Cosa NON copre

- UI automation macOS end-to-end
- stress test massivi
- il caso `currentState=missing`, che con le route attuali richiede una race intra-request non deterministica e quindi non e adatto a questa suite smoke

Nota: la lane "native" qui esercita il contratto `/api/v1` consumato dal client macOS, non la UI SwiftUI.
Nel workspace isolato del test la lane web (`/api/patients/*`) accetta lo stesso local token usato dalla lane native, cosi la suite resta focalizzata sulla semantica di concorrenza e non dipende dal session store in-memory del dev server.

## Comando standard

```bash
npm run test:concurrency:patients
```

Il runner:

1. prepara un `MEDIFLOW_DATA_DIR` isolato
2. crea un workspace Next temporaneo con `distDir` dedicato
3. abilita nel solo workspace di test l'accesso local-token anche sulle route web dei pazienti
4. avvia `next dev`
5. esegue la suite Node contro il server reale
6. scrive un report JSON

## Variabili utili

- `MEDIFLOW_CONCURRENCY_DATA_DIR`: override del data dir isolato
- `E2E_BASE_URL`: override del base URL del server (default harness: `http://127.0.0.1:3100`)
- `MEDIFLOW_LOCAL_API_TOKEN`: token statico per la lane `/api/v1`

## Runner diretto

Se il server e gia attivo e configurato, puoi eseguire solo il runner:

```bash
npm run test:concurrency:patients:runner
```

In questo caso devi fornire tu:

- `E2E_BASE_URL`
- `MEDIFLOW_LOCAL_API_TOKEN`
- un backend gia pronto che esponga sia `/api/patients/*` sia `/api/v1/patients/*` con local token valido

## Output

Artifact principale:

- `MEDIFLOW_DATA_DIR/reports/patient-concurrency-report.json`

Il report contiene:

- nome scenario
- lane vincente
- lane in conflitto
- tipo write perdente (`update` o `delete`)
- status HTTP osservato
- `expectedVersion` e `currentVersion`

## Quando eseguirla

Esegui questa suite quando cambi:

- `patients.version`
- logica compare-on-write su pazienti
- payload `409 VERSION_CONFLICT`
- autenticazione/sessione delle lane usate dai test
- flussi client che dipendono direttamente dalle mutation `/api/patients/*` o `/api/v1/patients/*`
