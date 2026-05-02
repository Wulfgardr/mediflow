<!-- Codex: created 2026-04-18 -->
# Mobile Home-Base Paired Smoke (iPhone/iPad)

Stato documento: SECONDARY (runbook operativo)
Ultimo aggiornamento: 2026-04-18

---

## Obiettivo

Eseguire uno smoke rapido del client Apple mobile contro un `home-base` reale
MediFlow, verificando il boundary paired definito da
[docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
e i vincoli di sicurezza di [SECURITY.md](../SECURITY.md).

Script:
- `scripts/mobile-home-base-paired-smoke.sh`

Il flusso non usa il `local-api-token` nel client iOS/iPadOS: il token resta sul
Mac per bootstrap e conferma pairing, poi il device mobile usa credenziali paired
temporanee piu sessione operatore.

---

## Prerequisiti

- backend MediFlow raggiungibile su `http://127.0.0.1:3000`
- TLS proxy locale raggiungibile su `https://127.0.0.1:3443`
  - se assente, lo script tenta `scripts/native-setup.sh`
- database reale disponibile in `~/Library/Application Support/MediFlow/medical.db`
- almeno un simulatore iPhone o iPad booted
- `MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN` valorizzato

Riferimenti correlati:
- [docs/apple-wide-parity-qa.md](./apple-wide-parity-qa.md)
- [docs/native-testing.md](./native-testing.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/walkthrough.md](./walkthrough.md)

---

## Comando base

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

## Cosa fa lo script

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

## Output

- artifact dir: `tmp-mobile-home-base-paired-smoke/<run-id>/`
- env temporaneo: `tmp-mobile-home-base-paired-smoke/<run-id>/launch.env`
- snapshot impostazioni: `tmp-mobile-home-base-paired-smoke/<run-id>/network-settings.snapshot`
- screenshot: `tmp-mobile-home-base-paired-smoke/<run-id>/mobile-home-base-launch.png`
- log Bonjour opzionale: `tmp-mobile-home-base-paired-smoke/<run-id>/bonjour.log`

Lo script rimuove `launch.env` in cleanup. In caso di abort manuale o crash,
verifica che il file non sia rimasto nei `tmp-*`.

---

## Note di sicurezza

- le credenziali paired generate sono temporanee e usate solo per il run
- lo stato `network.*` del database viene ripristinato a fine esecuzione
- il bundle iOS/iPadOS dichiara `NSLocalNetworkUsageDescription` e
  `NSBonjourServices = ["_mediflow-homebase._tcp"]`
- con `AUTOLOAD_PATIENTS=1` lo screenshot puo contenere PHI
- anche con autoload disabilitato, gli artifact possono esporre metadata locali
  del nodo o identificativi paired temporanei: non allegarli fuori dal perimetro
  di sviluppo senza revisione

---

## Uso consigliato

- smoke iPad/iPhone del boundary `paired client + operator session`
- verifica rapida prima di aprire o aggiornare una PR del filone `home-base`
- controllo regressioni su override di launch e bootstrap mobile
