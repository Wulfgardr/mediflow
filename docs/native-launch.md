# Avvio rapido MediFlowMac

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/native-testing.md](./native-testing.md)

## Avvio con doppio click (consigliato)

1) Il client nativo e la web app hanno avvii distinti. Se la web app locale non è già attiva, avviala con:

```bash
./Start_MediFlow.command
```

`Start_MediFlow.command` avvia la superficie web e i servizi locali opzionali, non il client Apple.

2) Per aprire il client nativo, esegui separatamente:

```
./scripts/Launch_MediFlowMac.command
```

Lo script prepara TLS e pin, avvia il proxy locale e compila il client nativo; al termine apre l'app macOS.

Nell'app, il pannello `Runtime` consente di avviare e arrestare esplicitamente backend web production standalone e proxy TLS inclusi nel bundle. Ollama e MLX rimangono invece servizi opzionali gestiti separatamente: il pannello ne mostra soltanto lo stato diagnostico in lettura, senza assumerne la supervisione. Anche ICD-11 WHO segue un percorso distinto, verificato dalla diagnostica web attraverso readiness autenticata, senza probe nativo o query clinica implicita. Per backend e proxy, l'arresto concede una breve finestra ordinata prima dell'escalation locale, così che PID non più validi non blocchino il ciclo successivo.

Prima di includere il backend standalone nel bundle, esegui la build e il controllo del suo contenuto:

```bash
npm run build
npm run check:standalone-runtime-bundle
```

Il controllo blocca il pacchetto se `.next/standalone` contiene database locali, directory temporanee o documentazione privata o estranea al runtime. Verifica inoltre il manifest Node/ABI prodotto dalla build e carica effettivamente il `better-sqlite3` incluso. Il supervisor accetta soltanto Node 24.x con l'ABI registrata: anche `MEDIFLOW_NODE_BINARY` può essere usato solo dopo lo stesso controllo, senza ripiegare su un Node di sistema incompatibile. Poiché `better-sqlite3` è nativo, ogni bundle resta legato all'architettura del Node di build, `arm64` oppure `x86_64`, e non è universale.

La firma deve essere richiesta esplicitamente; la notarizzazione rimane un passaggio distinto:

```bash
MEDIFLOW_CODESIGN_IDENTITY="-" bash scripts/build-apple-macos-app.sh
MEDIFLOW_CODESIGN_IDENTITY="Developer ID Application: ..." \
bash scripts/build-apple-macos-app.sh
```

In assenza di queste variabili, lo script produce un bundle locale non firmato. La notarizzazione richiede una Developer ID reale e un passaggio separato di distribuzione: lo script non la esegue automaticamente.

## Avvio manuale

```bash
./scripts/native-setup.sh
./scripts/build-apple-macos-app.sh
open tmp-mac-derived-data/Build/Products/Debug/MediFlow.app
```
