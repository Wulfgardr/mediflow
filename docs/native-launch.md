<!-- Codex: created 2026-02-01 -->
# Avvio rapido MediFlowMac

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/native-testing.md](./native-testing.md)

## Avvio con doppio click (consigliato)

1) Avvia la web app locale, se non è già attiva:

```bash
./Start_MediFlow.command
```

`Start_MediFlow.command` resta il launcher della superficie web e dei servizi locali opzionali; non apre il client Apple.

2) Avvia separatamente il client nativo:

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
