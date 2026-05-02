<!-- Codex: created 2026-05-02 -->
# Apple-Wide Parity QA

Stato documento: CANONICAL (WUL-194, matrice QA Apple-wide)
Ultimo aggiornamento: 2026-05-02

---

## Obiettivo

Questa pagina trasforma la parity Apple da impressione di demo a evidenza
ripetibile capability-by-capability.

Il perimetro Apple-wide corrente e:

- web app come superficie clinica primaria;
- macOS packaged `home-base` come host runtime locale;
- iPhone/iPad come client paired in costruzione sopra `/api/v1/network/*`;
- nessun accesso diretto mobile a SQLite;
- nessun claim di parity piena finche ogni capability non ha evidenza o gap
  tracciato.

Riferimenti canonici:

- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
- [docs/parity-matrix.md](./parity-matrix.md)
- [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md)
- [docs/parity-smoke.md](./parity-smoke.md)

---

## Manifest verificabile

La fonte machine-readable di questa pagina e:

- [`docs/apple-wide-qa-manifest.json`](./apple-wide-qa-manifest.json)

Il guard dedicato e:

```bash
npm run check:apple-wide-qa
```

Il guard non esegue gli smoke costosi. Verifica invece che ogni capability abbia:

- un `id` stabile;
- superfici Apple coinvolte;
- stato esplicito (`covered`, `gap`, `blocked`);
- evidenza ripetibile se `covered`;
- issue gap se `gap` o `blocked`;
- acceptance criterion leggibile.

---

## Stati

| Stato | Significato | Regola |
| --- | --- | --- |
| `covered` | Esiste evidenza ripetibile sufficiente per la capability dichiarata. | Deve avere almeno un comando o runbook verificabile. |
| `gap` | Capability richiesta ma non ancora implementata/verificata. | Deve indicare issue owner. |
| `blocked` | Capability desiderata ma bloccata da prerequisito tecnico/prodotto. | Deve indicare issue owner e motivo. |

`covered` non significa parity piena del prodotto: significa solo che quella riga
ha un'evidenza adeguata al suo scope.

---

## Gates WUL-194

### Gate 1: Runtime packaged macOS

Copre:

- bundle macOS Apple/home-base come entrypoint;
- backend web production e proxy TLS app-managed;
- health diagnostico optional services;
- firma ad-hoc e path Developer ID/notarization documentato.

Evidenza:

```bash
MEDIFLOW_CODESIGN_IDENTITY=- bash scripts/build-native-app.sh
codesign -dv native/MediFlowMac/Build/MediFlowMac.app
```

### Gate 2: Shared Apple core

Copre:

- DTO/client pairing condivisi;
- storage paired locale via Keychain/UserDefaults;
- override launch per smoke simulator;
- discovery Bonjour PHI-safe.

Evidenza:

```bash
swift test --package-path native/MediFlowMac
```

### Gate 3: Mobile paired bootstrap

Copre:

- pairing intent e conferma sul nodo Mac;
- credenziali paired temporanee;
- sessione operatore;
- read reale `/api/v1/network/patients`;
- lancio `MediFlowMobile` su simulatore.

Evidenza:

```bash
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN=<PIN> bash scripts/mobile-home-base-paired-smoke.sh
```

Questo gate puo produrre artifact sensibili se `AUTOLOAD_PATIENTS=1`; non va
allegato fuori dal perimetro di sviluppo senza revisione.

### Gate 4: Write paired non-AI

Copre i write remoti gia ammessi da ADR 0052-0056:

```bash
npm run test:network:home-base-write
npm run test:network:home-base-diary-write
npm run test:network:home-base-therapy-write
npm run test:network:home-base-checkup-write
npm run test:network:home-base-observation-write
```

Questi smoke provano il boundary `paired client + sessione operatore +
capability + version`. Non coprono cache offline o UI mobile completa.

### Gate 5: Gap dichiarati

Restano gap tracciati, non regressioni nascoste:

- mobile CRUD UI completa per moduli core;
  le slice WUL-206/WUL-208 coprono il diario clinico nella scheda paziente
  mobile paired con read, create online idempotente, update e annullamento
  soft-delete versionato; WUL-209 aggiunge le terapie con list/create/update e
  annullamento online per campi manuali non-AI essenziali; WUL-210 aggiunge
  controlli e osservazioni manuali non-AI con soft-delete versionato, sempre
  senza coda offline;
- cache locale cifrata e riconciliazione esplicita. La prima slice WUL-193
  persiste uno snapshot cifrato della lista pazienti, lo usa solo come
  consultazione locale `paired-offline-degraded` entro una soglia di freschezza
  e non abilita ancora scritture offline o coda di merge;
- parity UI clinica completa macOS generalista oltre il runtime shell.

Questi gap non devono essere convertiti in `covered` finche non esiste evidenza
dedicata.

Il click-map WUL-194 copre la superficie Apple oggi realmente disponibile:
macOS home-base shell, bootstrap/read mobile paired su simulatore e write
paired non-AI via boundary `/api/v1/network/*`. Non equivale a parity UI piena
dei moduli clinici su iPhone/iPad.

---

## Uso in PR

Ogni PR Apple-wide deve dichiarare:

1. quali righe del manifest modifica;
2. quali comandi sono stati eseguiti;
3. quali gap restano fuori scope;
4. se gli artifact contengono o possono contenere PHI.

Se una PR aggiunge una capability o cambia il significato di una capability:

- aggiorna `docs/apple-wide-qa-manifest.json`;
- aggiorna questa pagina se cambia il gate umano;
- esegui `npm run check:apple-wide-qa`;
- aggiorna [docs/parity-matrix.md](./parity-matrix.md) se cambia lo stato
  canonico della parity.
