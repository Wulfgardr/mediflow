<!-- Codex: created 2026-04-18 -->
<a id="home-base-verify-loop-and-mobile-paired-smoke"></a>

# Verifica home-base e smoke dei client mobile abbinati

Stato documento: SECONDARY (runbook operativo)
Ultimo aggiornamento: 2026-09-06 (distinzione dal runner mobile reale)

---

## Ambito del percorso mobile

Per verificare la matrice reale iPhone/iPad × macOS/Windows/Linux 0.8.6, il
riferimento è [Interoperabilità mobile con host reali](./native-testing.md#interoperabilita-mobile-con-host-reali).
Lo smoke storico descritto in questa pagina ha uno scopo più ristretto: usa
snapshot e ripristino SQLite, bypass TLS durante il setup e autologin.
Dimostra quindi soltanto le verifiche che esegue, non il normale login nella
UI, la persistenza offline o l'interoperabilità completa. Anche le regressioni
headless riportate sotto provano separatamente i rispettivi contratti API.

## Obiettivo

Quando una PR modifica `/api/v1/network/*`, pairing Apple, cache mobile o
trasporto locale, occorre verificare il confine `home-base` prima di aprirla,
aggiornarla o revisionarla. Questo runbook distingue due percorsi perché
hanno scopi e conseguenze diversi.

Il gate del nucleo è headless e sintetico: lavora in directory dati temporanee
e non tocca il database reale. Il gate mobile iPhone/iPad è invece facoltativo
e va eseguito solo per cambiamenti che riguardino esperienza paired,
simulatore, Bonjour, ascolto TLS sulla LAN, override di avvio o prove tramite
screenshot.

Il runbook verifica il boundary paired definito da
[docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
e i vincoli di sicurezza di [SECURITY.md](../SECURITY.md).

Script principali:
- `scripts/network-home-base-readonly-smoke.sh`
- `scripts/network-home-base-write-smoke.sh`
- `scripts/mobile-home-base-paired-smoke.sh`

Il `local-api-token` resta sul Mac per il bootstrap e la conferma del pairing:
non viene usato dal client iOS/iPadOS. Il dispositivo mobile accede poi con
credenziali paired temporanee e con la sessione operatore, che non sono
intercambiabili.

---

<a id="regola-per-agenti"></a>

## Regola per gli agenti

Prima di modificare questo runbook o il boundary `home-base`:

- non lavorare nel primary checkout se ci sono workstream concorrenti o file
  dirty non correlati;
- usa una branch/worktree dedicata;
- tratta i gate headless come verifiche di default;
- esegui il gate mobile solo con consenso esplicito quando può toccare DB reale,
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

<a id="core-gate-headless-network-boundary"></a>

## Controllo principale: confine di rete headless

Gli smoke headless sono obbligatori per le modifiche al confine
`/api/v1/network/*`. Per isolare la prova dai dati in uso, ogni script crea un
`MEDIFLOW_DATA_DIR` temporaneo, prepara un workspace Next separato e avvia un
server di sviluppo dedicato. I report vengono scritti nei rispettivi
`tmp-network-home-base-*`.

Esegui almeno il read-only smoke:

```bash
npm run test:network:home-base-readonly
```

Quando modifichi una scrittura paired, aggiungi il comando specifico per
ciascuna superficie interessata:

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

<a id="failure-triage-headless"></a>

### Diagnosi degli errori headless

- Server non pronto: apri `logs/next-dev.log` nel run dir indicato dallo script.
- Porta occupata: imposta `E2E_BASE_URL` su una porta libera e rilancia.
- Native module / `better-sqlite3`: su worktree locali può essere un artifact
  Node ABI; non classificarlo come regressione senza riprodurre in ambiente
  pulito o CI.
- Report mancante: considera il run fallito anche se il processo ha stampato
  output parziale.

---

<a id="optional-gate-mobile-paired-smoke"></a>

## Controllo facoltativo: smoke mobile paired

Esegui il gate mobile solo per modifiche a iPhone/iPad, esperienza di pairing,
override di avvio, ricerca Bonjour, ascolto TLS sulla LAN, prove tramite
screenshot o affermazioni di parità nell'intera famiglia Apple.

### Prerequisiti mobile

- Xcode completo selezionato (oppure `DEVELOPER_DIR` esplicito), SDK iOS
  Simulator 26+ e Node 24 su PATH; stesso ambiente per builder e smoke
- backend MediFlow raggiungibile su `http://127.0.0.1:3000`
- TLS proxy locale raggiungibile su `https://127.0.0.1:3443`
  - se assente, lo script tenta `scripts/native-setup.sh`
- database coerente con il backend selezionato; il default e
  `~/Library/Application Support/MediFlow/medical.db`
- almeno un simulatore iPhone o iPad disponibile e booted
- `MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN` valorizzato

Il target predefinito contiene i dati locali dell'utente: l'esecuzione
completa richiede quindi una destinazione e un'autorizzazione coerenti con
l'operazione. Per una verifica isolata usa un backend con dati sintetici, una
`MEDIFLOW_DATA_DIR` dedicata, URL
`MEDIFLOW_MOBILE_SMOKE_HTTP_URL`/`MEDIFLOW_MOBILE_SMOKE_HTTPS_URL` coerenti e
il PIN della fixture.

Quando serve soltanto compilare, senza accedere a dati o pairing, usa
`bash scripts/build-mobile-sim-app.sh`, come descritto in
[native/README.md](../native/README.md).

### Comando base

```bash
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> bash scripts/mobile-home-base-paired-smoke.sh
```

Se è presente un iPad booted, lo script lo preferisce come default. Per forzare
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

Il valore predefinito `MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS=0` evita il
caricamento automatico dei pazienti, così lo screenshot finale non ne contiene
i nomi.

Per validare anche la discovery Bonjour lato client mobile:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> \
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> \
MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR=1 \
MEDIFLOW_MOBILE_SMOKE_TLS_BIND_HOST=0.0.0.0 \
MEDIFLOW_MOBILE_SMOKE_RESTART_TLS_PROXY=1 \
bash scripts/mobile-home-base-paired-smoke.sh
```

L'ascolto sulla LAN è ammesso solo dopo che lo script è riuscito ad attivare
temporaneamente `network-home-base`. Alla fine del run viene ripristinato lo
stato `network.*`: l'esposizione di prova non deve lasciare una configurazione
diversa da quella iniziale.

---

<a id="cosa-fa-il-gate-mobile"></a>

## Cosa verifica lo smoke mobile

Il gate seleziona prima un simulatore iOS già avviato e invoca
`scripts/build-mobile-sim-app.sh --install`. Il builder compila il progetto
Xcode canonico, verifica il bundle e lo installa sullo stesso UDID, senza
rigenerare il progetto né avviare simulatori. Solo dopo questo passaggio il
gate accede al backend: un errore di compilazione o installazione interrompe
lo smoke prima dello snapshot e di qualsiasi modifica al pairing.

1. valida backend HTTP, proxy TLS e certificato locale
2. salva snapshot di `network.mode`, `network.nodeId`, `network.pairing.state`
3. abilita temporaneamente il nodo `network-home-base`
4. crea e conferma un pairing intent
5. esegue login operatore HTTPS, verifica che `Set-Cookie` includa `Secure` e
   poi verifica una read reale su `/api/v1/network/patients`
6. opzionalmente pubblica un servizio Bonjour temporaneo `_mediflow-homebase._tcp`
   con metadata PHI-safe (`node`, `proto`, `mode`, `pin`)
7. lancia l'app Xcode `MediFlowMobileApp` sul simulatore con env `SIMCTL_CHILD_*`
8. cattura uno screenshot e ripristina lo stato `network.*`

---

<a id="output-mobile"></a>

## Risultati dello smoke mobile

- artifact dir: `tmp-mobile-home-base-paired-smoke/<run-id>/`
- env temporaneo: `tmp-mobile-home-base-paired-smoke/<run-id>/launch.env`
- snapshot impostazioni: `tmp-mobile-home-base-paired-smoke/<run-id>/network-settings.snapshot`
- screenshot: `tmp-mobile-home-base-paired-smoke/<run-id>/mobile-home-base-launch.png`
- log Bonjour opzionale: `tmp-mobile-home-base-paired-smoke/<run-id>/bonjour.log`

La pulizia finale rimuove `launch.env`. Se l'esecuzione viene interrotta
manualmente o termina con un crash, verifica che il file non sia rimasto nei
`tmp-*`: l'interruzione non costituisce una prova della sua rimozione.

---

## Note di sicurezza

- il gate mobile usa il DB reale di default, a differenza dei gate headless
- le credenziali paired generate sono temporanee e usate solo per il run
- lo stato `network.*` del database viene ripristinato a fine esecuzione
- il bundle iOS/iPadOS dichiara `NSLocalNetworkUsageDescription` e
  `NSBonjourServices = ["_mediflow-homebase._tcp"]`
- con `AUTOLOAD_PATIENTS=1` lo screenshot può contenere PHI
- anche con autoload disabilitato, gli artifact possono esporre metadata locali
  del nodo o identificativi paired temporanei: non allegarli fuori dal perimetro
  di sviluppo senza revisione
- se lo script abortisce, verifica che `launch.env` sia stato rimosso e che
  `network.mode`, `network.nodeId` e `network.pairing.state` siano tornati allo
  stato precedente

---

## Checklist PR / Linear

Per rendere verificabile la revisione senza esporre dati, riporta sempre:

- quali comandi `test:network:home-base-*` sono stati eseguiti;
- path dei report JSON controllati;
- se il gate mobile è stato eseguito o perché è stato escluso;
- eventuali artifact non allegati per rischio PHI/metadata;
- cosa non è stato verificato e perche.

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

## Uso consigliato

- gate headless prima di aprire o aggiornare una PR che tocca `/api/v1/network/*`
- smoke iPad/iPhone del boundary `paired client + operator session` quando il
  cambio coinvolge mobile
- controllo regressioni su override di launch, bootstrap mobile e discovery
  Bonjour
