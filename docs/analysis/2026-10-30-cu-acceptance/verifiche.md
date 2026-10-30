# Verifiche del dossier CU

Revisione dei test: `3943e0bbcd6991ec921b7d0dbbec977a7b91eab7`, base `5e356edbc51e9b9c2132282a0b9ac9a4fb07f7de`. macOS locale, Node **v24.18.0** da nvm, `npm ci` reale. Solo archivi temporanei sintetici con directory dati esplicita; nessun accesso all'archivio clinico o ai portali reali. Nessuna galleria o log grezzo nel repository.

| Controllo | Esito osservato | Confine |
| --- | --- | --- |
| Suite CU completa, comando sotto | 199/199, zero fail, zero skip | Servizio, journal, protocollo MCP e browser del portale inventato |
| Nuovi casi dei cinque contratti | 20/20, inclusi nei 199 | Quattro casi per procedura del servizio comune con adapter HTTP simulato |
| Nuovi negativi esenzioni | 2/2, inclusi nei 199 | Scadenza/futuro e rifiuto del piano misto; non implementano l'applicazione mista |
| `npm run check:test-selection` | Verde dopo registrazione dell’harness manuale | Inventario completo, harness escluso con motivo esplicito |
| `node --test scripts/check-test-selection.test.mjs` | 45/45 | Selezione delle suite |
| `npm run typecheck` | Verde | Comprende il supporto di accettazione manuale |
| `npm run lint` | Verde | Diff test e documenti, nessun prodotto modificato |
| `npm run check:claims` | Verde | Nessuna nuova qualifica o affermazione di autonomia |
| `npm run check:never-regress` | Verde | Controlli statici previsti dal progetto |
| `swiftc native/LocalOperationDemo/main.swift -o <percorso temporaneo>` | Compilato con uscita 0 | Nessuna esecuzione biometrica o accettazione implicita |
| Harness `acceptance.test-support.ts` | Typecheck e controllo sintattico verdi; sessione interattiva non eseguita | Richiede Leonardo, helper nativo e osservazione del gesto |

Comando CU, con directory sintetica posseduta dal run:

```sh
node scripts/run-strip-types.mjs --test --test-concurrency=1 \
  lib/local-operation/*.test.ts lib/local-operation/specialist/*.test.ts
```

Le prove storiche e le falsificazioni delle PR #715/#719 vengono riusate per i confini di produzione invariati, con attribuzione separata nel README. Non sono nuovi run a questa revisione. La suite corrente esercita tutti i negativi CU esistenti oltre ai nuovi casi.

## Suite unitaria generale

`npm run test:unit` è stata eseguita prima del push. La prima invocazione termina con uscita 1: 8.908 test, 8.881 pass, 3 fail, 24 skip. Il runner si ferma prima dei gruppi seriali successivi; non sono dichiarati eseguiti. Sono osservati tre fallimenti in `lib/chatgpt-execution/execution-mac.test.ts`, esterni al diff CU: mancano `MEDIFLOW_MAC_PUBLIC_SOURCE_DIR`, `MEDIFLOW_MAC_C1_RECEIPT` e `MEDIFLOW_MAC_NATIVE_SOURCE`, necessari ai test degli asset pubblici congelati su macOS. Il file è invariato rispetto alla base; nessun asset, variabile o skip è stato inventato per ottenere verde. Questo run non va presentato come suite unitaria generale verde. La CI della PR resta una verifica distinta, attribuita alla sua head.

## Riproduzione e limiti

Ogni test nel nuovo corpus rifiuta esplicitamente una destinazione con porta 3000; lo stesso controllo è nel supporto manuale. Le fixture usano porte effimere loopback. Il corpus non sceglie endpoint o cataloghi istituzionali.

Il diniego di ricevuta parziale nel corpus comune usa una ricevuta alterata e quindi anche non autentica. La prova della completezza delle parti, distinta dall'autenticità, è coperta dai test esistenti del servizio. L'audit del servizio comune non è un writer farmaceutico, Protesica o INPS.

La preparazione nativa dimostra compilabilità e collegamento del supporto di prova. Solo la sessione descritta nella procedura può attestare Touch ID reale, diniego e risultato osservato dal medico. Un successo del simulatore o una password accettata non soddisfano il criterio biometrico.

Il primo controllo dell’inventario aveva segnalato `TEST_NOT_SELECTED` per l’harness interattivo. È stato registrato nelle esclusioni motivate, perché richiede il gesto personale e non registra test automatici. Il controllo successivo è completo; nessun caso automatico CU è stato escluso. I file dei test eseguiti sono identici fra la prima revisione `8d96114c9b21fc024cf8037459f0e93fec3e6091` e `3943e0bbcd6991ec921b7d0dbbec977a7b91eab7`: cambia soltanto questa registrazione nell’inventario.
