<!-- Codex: created 2026-02-01 -->
# Avvio rapido MediFlowMac

## Avvio con doppio click (consigliato)

1) Avvia la web app se non e' gia' attiva:

```bash
./Start_MediFlow.command
```

2) Doppio click su:

```
./scripts/Launch_MediFlowMac.command
```

Questo script:
- configura TLS e pin
- avvia il proxy locale
- compila il client nativo
- apre l'app macOS

## Avvio manuale

```bash
./scripts/native-setup.sh
./scripts/build-native-app.sh
open native/MediFlowMac/Build/MediFlowMac.app
```
