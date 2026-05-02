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

Dentro l'app, il pannello `Runtime` puo avviare/arrestare esplicitamente il
backend web production standalone e il proxy TLS inclusi nel bundle. I servizi
opzionali Ollama e Docker/ICD sono mostrati come health diagnostico read-only
quando gia attivi su `127.0.0.1:11434` e `127.0.0.1:8888`, ma restano fuori
dalla supervisione app-managed e continuano a richiedere gestione separata.

Prima di impacchettare il backend standalone nel bundle, eseguire:

```bash
npm run build
npm run check:standalone-runtime-bundle
```

Il guard fallisce se `.next/standalone` contiene database locali, directory
temporanee o documentazione privata/non-runtime.

## Avvio manuale

```bash
./scripts/native-setup.sh
./scripts/build-native-app.sh
open native/MediFlowMac/Build/MediFlowMac.app
```
