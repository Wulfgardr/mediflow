# Avvio rapido MediFlowMac

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/native-testing.md](./native-testing.md)

## Avvio con doppio clic

Apri `MediFlow.command` nella radice e scegli **App per Mac**. Il lanciatore
apre il bundle locale già costruito e ne controlla l'identità rispetto ai
sorgenti. Se il bundle manca, la voce spiega che serve Xcode completo;
**Nel browser** resta il percorso web.

La preparazione del bundle è un'operazione di sviluppo distinta:

```bash
./scripts/Launch_MediFlowMac.command
```

Questo motore interno prepara TLS e pin, avvia il proxy locale e compila
il client. Non è l'ingresso utente. Il lanciatore unico non costruisce
implicitamente l'app nativa e non cerca altre app installate in cartelle
diverse. Usa `MEDIFLOW_MAC_DERIVED_DATA` e `MEDIFLOW_MAC_CONFIG` per un bundle
costruito in una destinazione esplicita.


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

## Compilazione su GitHub

Il workflow **Apple Native** conserva per sette giorni la build macOS ARM64
quando compilazione e test del relativo job riescono. L'artefatto
`mediflow-macos-native-arm64-<commit>` contiene il client Debug non firmato,
con una ricevuta che identifica sorgenti, configurazione e hash dell'archivio.
È un componente per il confezionamento, non un installer.

Scarica l'artefatto da una run verificata della repository e usa un checkout
pulito dello stesso commit. Il builder può completare il pacchetto sul Mac
senza Xcode completo:

```bash
MEDIFLOW_MAC_PREBUILT_ARCHIVE="/percorso/MediFlow-native.zip" \
MEDIFLOW_CODESIGN_IDENTITY="-" \
bash scripts/build-apple-macos-app.sh
```

La ricevuta `.receipt.json` deve rimanere accanto allo ZIP. Servono Node 24,
le dipendenze del progetto, gli strumenti a riga di comando Apple e i quattro
ingressi pubblici fissati per il payload ChatGPT descritti nel builder.
Il runtime Web viene costruito dagli stessi sorgenti; i controlli del
pacchetto e la firma finale restano invariati. Una ricevuta coerente verifica
l'integrità del download, ma la provenienza va verificata nella run GitHub.
La firma locale non equivale a notarizzazione o distribuzione pubblica.

## Avvio manuale

```bash
./scripts/native-setup.sh
./scripts/build-apple-macos-app.sh
open tmp-mac-derived-data/Build/Products/Debug/MediFlow.app
```
