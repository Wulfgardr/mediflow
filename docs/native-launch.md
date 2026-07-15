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
Gli stop di backend/proxy usano una finestra ordinata breve e poi escalation
locale, cosi i PID stale non bloccano il ciclo successivo.

Prima di impacchettare il backend standalone nel bundle, eseguire:

```bash
npm run build
npm run check:standalone-runtime-bundle
```

Il guard fallisce se `.next/standalone` contiene database locali, directory
temporanee o documentazione privata/non-runtime. Verifica inoltre il manifest
Node/ABI generato dalla build e carica davvero il `better-sqlite3` incluso.
Il bundle non accetta un Node di sistema incompatibile: il supervisor cerca un
Node 24.x con la stessa ABI registrata, oppure usa `MEDIFLOW_NODE_BINARY` solo
se supera lo stesso controllo.
Poiche `better-sqlite3` e nativo, ogni bundle prodotto e esplicitamente legato
all'architettura del Node di build (`arm64` oppure `x86_64`), non universale.

Firma e notarizzazione restano esplicite:

```bash
MEDIFLOW_CODESIGN_IDENTITY="-" bash scripts/build-apple-macos-app.sh
MEDIFLOW_CODESIGN_IDENTITY="Developer ID Application: ..." \
bash scripts/build-apple-macos-app.sh
```

Senza queste variabili lo script produce un bundle locale non firmato. La
notarizzazione richiede una Developer ID reale e un passaggio di distribuzione
separato; non viene eseguita automaticamente da questo script.

## Avvio manuale

```bash
./scripts/native-setup.sh
./scripts/build-apple-macos-app.sh
open tmp-mac-derived-data/Build/Products/Debug/MediFlow.app
```
