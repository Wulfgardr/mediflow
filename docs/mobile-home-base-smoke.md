<!-- Codex: created 2026-04-18 -->
# Home-Base Verify Loop And Mobile Paired Smoke

Stato documento: SECONDARY (runbook operativo)
Ultimo aggiornamento: 2026-07-05

---

## Obiettivo

Fornire un runbook eseguibile per verificare il boundary `home-base` di
MediFlow prima di aprire, aggiornare o revieware una PR che tocca
`/api/v1/network/*`, pairing Apple, cache mobile o trasporto locale.

Il gate core e headless e sintetico: usa data directory temporanee e non tocca
il database reale. Il gate mobile iPhone/iPad resta opzionale e va eseguito
solo quando il cambio riguarda UX paired, simulatore, Bonjour, TLS LAN bind,
launch override o screenshot evidence.

Il runbook verifica il boundary paired definito da
[docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
e i vincoli di sicurezza di [SECURITY.md](../SECURITY.md).

Script principali:
- `scripts/network-home-base-readonly-smoke.sh`
- `scripts/network-home-base-write-smoke.sh`
- `scripts/mobile-home-base-paired-smoke.sh`

Il flusso mobile non usa il `local-api-token` nel client iOS/iPadOS: il token
resta sul Mac per bootstrap e conferma pairing, poi il device mobile usa
credenziali paired temporanee piu sessione operatore.

---

## Regola Per Agenti

Prima di modificare questo runbook o il boundary `home-base`:

- non lavorare nel primary checkout se ci sono workstream concorrenti o file
  dirty non correlati;
- usa una branch/worktree dedicata;
- tratta i gate headless come verifiche di default;
- esegui il gate mobile solo con consenso esplicito quando puo toccare DB reale,
  simulatore o artifact sensibili;
- non allegare screenshot, `launch.env`, token, PIN, DB o artifact potenzialmente
  PHI fuori dal perimetro di sviluppo.

Riferimenti correlati:
- [docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json)
- [docs/native-testing.md](./native-testing.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/walkthrough.md](./walkthrough.md)

---

## Core Gate: Headless Network Boundary

Questi smoke sono il gate obbligatorio quando si tocca il boundary
`/api/v1/network/*`. Ogni script crea un `MEDIFLOW_DATA_DIR` temporaneo,
prepara un workspace Next isolato, avvia un dev server dedicato e scrive report
nei rispettivi `tmp-network-home-base-*`.

Esegui almeno il read-only smoke:

```bash
npm run test:network:home-base-readonly
```

Quando tocchi write paired, aggiungi il comando specifico per ogni superficie
modificata:

```bash
npm run test:network:home-base-write
npm run test:network:home-base-diary-write
npm run test:network:home-base-therapy-write
npm run test:network:home-base-checkup-write
npm run test:network:home-base-observation-write
```

Matrice minima:

| Comando | Copre | Artifact atteso |
| --- | --- | --- |
| `test:network:home-base-readonly` | pairing flow, token paired, sessione operatore, read pazienti | `tmp-network-home-base-readonly/<run-id>/reports/network-home-base-readonly-report.json` |
| `test:network:home-base-write` | write profilo/status paziente, `NETWORK_MODE_DISABLED`, version guard | `tmp-network-home-base-write/<run-id>/reports/network-home-base-write-report.json` |
| `test:network:home-base-diary-write` | create/update/soft-delete diario paired | `tmp-network-home-base-write/<run-id>/reports/network-home-base-diary-write-report.json` |
| `test:network:home-base-therapy-write` | create/update/soft-delete terapie paired | `tmp-network-home-base-write/<run-id>/reports/network-home-base-therapy-write-report.json` |
| `test:network:home-base-checkup-write` | create/update/soft-delete controlli paired | `tmp-network-home-base-write/<run-id>/reports/network-home-base-checkup-write-report.json` |
| `test:network:home-base-observation-write` | create/update/soft-delete osservazioni paired | `tmp-network-home-base-write/<run-id>/reports/network-home-base-observation-write-report.json` |

I log server sono in `tmp-network-home-base-*/<run-id>/logs/next-dev.log`.

### Failure Triage Headless

- Server non pronto: apri `logs/next-dev.log` nel run dir indicato dallo script.
- Porta occupata: imposta `E2E_BASE_URL` su una porta libera e rilancia.
- Native module / `better-sqlite3`: su worktree locali puo essere un artifact
  Node ABI; non classificarlo come regressione senza riprodurre in ambiente
  pulito o CI.
- Report mancante: considera il run fallito anche se il processo ha stampato
  output parziale.

---

## Optional Gate: Mobile Paired Smoke

Esegui questo gate solo quando il cambio riguarda iPhone/iPad, pairing UX,
launch override, Bonjour discovery, TLS LAN bind, screenshot evidence o claim di
parity Apple-wide.

### Prerequisiti Mobile

- backend MediFlow raggiungibile su `http://127.0.0.1:3000`
- TLS proxy locale raggiungibile su `https://127.0.0.1:3443`
  - se assente, lo script tenta `scripts/native-setup.sh`
- database reale disponibile in `~/Library/Application Support/MediFlow/medical.db`
- almeno un simulatore iPhone o iPad booted
- `MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN` valorizzato

### Comando Base

```bash
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> bash scripts/mobile-home-base-paired-smoke.sh
```

Se e presente un iPad booted, lo script lo preferisce come default. Per forzare
un simulatore specifico:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> \
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> \
bash scripts/mobile-home-base-paired-smoke.sh
```

Per validare anche il caricamento lista pazienti nel client mobile:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> \
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> \
MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS=1 \
bash scripts/mobile-home-base-paired-smoke.sh
```

Di default `MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS=0`, cosi lo screenshot finale
resta senza nomi paziente.

Per validare anche la discovery Bonjour lato client mobile:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> \
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> \
MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR=1 \
MEDIFLOW_MOBILE_SMOKE_TLS_BIND_HOST=0.0.0.0 \
MEDIFLOW_MOBILE_SMOKE_RESTART_TLS_PROXY=1 \
bash scripts/mobile-home-base-paired-smoke.sh
```

Il bind LAN viene accettato solo se lo script riesce prima ad attivare
temporaneamente `network-home-base`. A fine run lo stato `network.*` viene
ripristinato.

---

## Cosa Fa Il Gate Mobile

1. valida backend HTTP, proxy TLS e certificato locale
2. salva snapshot di `network.mode`, `network.nodeId`, `network.pairing.state`
3. abilita temporaneamente il nodo `network-home-base`
4. crea e conferma un pairing intent
5. esegue login operatore HTTPS, verifica che `Set-Cookie` includa `Secure` e
   poi verifica una read reale su `/api/v1/network/patients`
6. opzionalmente pubblica un servizio Bonjour temporaneo `_mediflow-homebase._tcp`
   con metadata PHI-safe (`node`, `proto`, `mode`, `pin`)
7. lancia `MediFlowMobile` sul simulatore con env `SIMCTL_CHILD_*`
8. cattura uno screenshot e ripristina lo stato `network.*`

---

## Output Mobile

- artifact dir: `tmp-mobile-home-base-paired-smoke/<run-id>/`
- env temporaneo: `tmp-mobile-home-base-paired-smoke/<run-id>/launch.env`
- snapshot impostazioni: `tmp-mobile-home-base-paired-smoke/<run-id>/network-settings.snapshot`
- screenshot: `tmp-mobile-home-base-paired-smoke/<run-id>/mobile-home-base-launch.png`
- log Bonjour opzionale: `tmp-mobile-home-base-paired-smoke/<run-id>/bonjour.log`

Lo script rimuove `launch.env` in cleanup. In caso di abort manuale o crash,
verifica che il file non sia rimasto nei `tmp-*`.

---

## Note di sicurezza

- il gate mobile usa il DB reale di default, a differenza dei gate headless
- le credenziali paired generate sono temporanee e usate solo per il run
- lo stato `network.*` del database viene ripristinato a fine esecuzione
- il bundle iOS/iPadOS dichiara `NSLocalNetworkUsageDescription` e
  `NSBonjourServices = ["_mediflow-homebase._tcp"]`
- con `AUTOLOAD_PATIENTS=1` lo screenshot puo contenere PHI
- anche con autoload disabilitato, gli artifact possono esporre metadata locali
  del nodo o identificativi paired temporanei: non allegarli fuori dal perimetro
  di sviluppo senza revisione
- se lo script abortisce, verifica che `launch.env` sia stato rimosso e che
  `network.mode`, `network.nodeId` e `network.pairing.state` siano tornati allo
  stato precedente

---

## Checklist PR / Linear

Riporta sempre:

- quali comandi `test:network:home-base-*` sono stati eseguiti;
- path dei report JSON controllati;
- se il gate mobile e stato eseguito o perche e stato escluso;
- eventuali artifact non allegati per rischio PHI/metadata;
- cosa non e stato verificato e perche.

Esempio:

```md
## Verification
- `npm run test:network:home-base-readonly`
- `npm run test:network:home-base-write`
- Mobile paired smoke non eseguito: nessun cambio a UI iPhone/iPad, Bonjour,
  TLS LAN bind o launch override.
- Report controllati sotto `tmp-network-home-base-*`; nessun artifact mobile
  allegato.
```

## Uso Consigliato

- gate headless prima di aprire o aggiornare una PR che tocca `/api/v1/network/*`
- smoke iPad/iPhone del boundary `paired client + operator session` quando il
  cambio coinvolge mobile
- controllo regressioni su override di launch, bootstrap mobile e discovery
  Bonjour
