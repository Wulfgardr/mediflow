# Verifica di Leonardo: CU-1 e Touch ID

Scopo: accettare o respingere la verticale specialistica sul solo portale inventato. Durata prevista: una seduta breve, dopo la preparazione. ADR 0162 resta Proposed fino alla decisione esplicita. I contratti ancora parziali sono elencati nel [dossier](./README.md).

**Preparazione in checkout dedicata della revisione della PR**, Mac con Touch ID configurato, Node nvm v24.18.0 e dipendenze installate. Non usare l'archivio dell'app. In Terminale, dalla checkout:

```sh
set -o pipefail
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export CU_ACCEPTANCE_DIR="$(mktemp -d /tmp/mediflow-cu-acceptance.XXXXXX)"
export MEDIFLOW_DATA_DIR="$CU_ACCEPTANCE_DIR/data"
export MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1
mkdir "$MEDIFLOW_DATA_DIR"
git rev-parse HEAD | tee "$CU_ACCEPTANCE_DIR/revisione.txt"
sw_vers > "$CU_ACCEPTANCE_DIR/macos.txt"
node -v > "$CU_ACCEPTANCE_DIR/node.txt"
swiftc native/LocalOperationDemo/main.swift -o "$CU_ACCEPTANCE_DIR/cu-native"
npx playwright install chromium
```

Il simulatore sceglie una porta loopback effimera; l'harness rifiuta 3000. Non aprire altri siti nel browser di prova. Helper e database sono temporanei e separati; conservare gli esiti fino alla decisione.

1. **Diniego.** Eseguire il comando sotto con `cancel`. Selezionare la pratica inventata, rileggere il riepilogo, scegliere Annulla nella finestra di autorizzazione. Atteso: nessun invio, nessuna registrazione, `sends:0, records:0`, uscita 0. Un errore di avvio non è un diniego superato.
2. **Gesto reale.** Ripetere con `protected`. Rileggere assistito inventato, account, pratica, quesito, quantità ed esenzione. Premere Autorizza e usare il dito sul sensore quando macOS lo richiede. Atteso: finestra nativa e richiesta biometrica osservate, `state:confirmed, sends:1, records:1`; il tentativo ripetuto viene respinto dall'harness. Se è stata usata la password, annotare “Touch ID non osservato” e non accettare quel criterio.
3. **Atto manuale.** Ripetere con `manual`. Selezionare la stessa pratica inventata della nuova fixture. Il browser visibile mostra i dati preparati: controllarli e usare il comando di invio/firma del medico nel simulatore, poi Invio nel Terminale. Atteso: nessun invio automatico prima del gesto, poi `state:confirmed, sends:1, records:1`. Questo passo non richiede né prova una firma istituzionale o Touch ID.

```sh
node scripts/run-strip-types.mjs \
  lib/local-operation/specialist/acceptance.test-support.ts \
  cancel "$CU_ACCEPTANCE_DIR/cu-native" \
  | tee "$CU_ACCEPTANCE_DIR/cancel.txt"
```

Sostituire `cancel` con `protected` e poi `manual`, cambiando anche il nome del file. Controllare l'esito del processo Node nel Terminale; un'asserzione o errore su stderr invalida il passo, anche se `tee` termina correttamente. Ogni comando crea una fixture nuova e la rimuove alla fine: non è una prova di recupero fra tre avvii. I negativi, il recupero durevole e la disattivazione sono già attribuiti alle suite nel dossier.

**Risposta da registrare su WUL-791**, senza dati reali: “Revisione [SHA intero], macOS [versione]. Diniego [osservato/non osservato], Touch ID col dito [osservato/non osservato], atto manuale e riconciliazione [osservati/non osservati]. Invii/registrazioni: [esiti]. Accetto / respingo CU-1 nel perimetro sintetico. Accetto / mantengo Proposed ADR 0162. Motivo o anomalie: [...]. Confermo di aver letto i limiti e i contratti parziali del dossier.” Solo dopo questa risposta si può recepire la decisione nell'ADR; nessun portale reale o uso clinico è autorizzato.
