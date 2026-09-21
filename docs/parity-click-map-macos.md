---
summary: "Manual P6 click-map for the packaged MediFlow macOS home-base shell."
read_when:
  - "Running the residual WUL-481 P6 gate or deciding whether a macOS capability can move from partial to full parity."
  - "Verifying the universal macOS bundle after native UI or navigation changes."
---

# Click-map P6 macOS home-base

Stato documento: `SECONDARY / VERIFICATION RUNBOOK`

La mappa descrive il percorso P6 costruito sugli strumenti di `WUL-401` e
PR #21; `WUL-481` ne governa i prerequisiti operativi ancora bloccati e il
verbale manuale residuo. Il probe AX aiuta a identificare i controlli, ma non
può dimostrare da solo che siano usabili, che tutti i campi siano presenti o
che vi sia parità di interfaccia. I blocchi riportati sotto appartengono alla
fixture di questo percorso, non sono una nuova valutazione dell'intera
famiglia Apple.

## Confini

- Usare solo la fixture sintetica Debug; non acquisire screenshot di dati reali.
- Non salvare, archiviare o cancellare record su un home-base reale.
- La click-map non autorizza AI paired, write offline, hard delete remoto o
  scritture document-derived escluse da ADR 0076.

## Preparazione ripetibile

```bash
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
export MEDIFLOW_MAC_DERIVED_DATA="$PWD/tmp-p6-packaged-derived-data"
scripts/build-apple-macos-app.sh

APP="$MEDIFLOW_MAC_DERIVED_DATA/Build/Products/Debug/MediFlow.app"
test -f "$APP/Contents/Resources/WebRuntime/server.js"
open -n \
  --env MEDIFLOW_APPLE_UITEST_PATIENTS=1 \
  --env MEDIFLOW_APPLE_UITEST_OPEN_PATIENT_INDEX=0 \
  "$APP"
```

La procedura costruisce il bundle Debug completo del runtime e, prima di
avviare la fixture, controlla che il WebRuntime Next.js vi sia effettivamente
incluso. In questo modo la verifica non si limita alla sola shell SwiftUI.

Con accesso Accessibility concesso al terminale corrente, eseguire il probe
preparatorio:

```bash
npm run test:native:clickmap:probe -- --app-path "$APP"
```

## Copertura effettiva della fixture

La fixture permette di percorrere navigazione, ricerca e filtri paziente,
dettaglio sintetico, segnali del cockpit, righe di diario, terapie, checkup e
osservazioni, trend e controlli del testo formattato, senza salvare. Proprio
perché non prepara un contesto autorizzato alla scrittura, alcune prove restano
`BLOCKED` per costruzione e non vanno promosse a `PASS`:

- mutazioni, conflitti e lifecycle: la fixture non crea sessione paired,
  credenziali, master key o capability di write;
- allegati e tombstone: gli array sintetici sono vuoti;
- Agenda, Diario globale e Analytics: le capability host non sono caricate;
- deep-link URL: la baseline della fixture qui descritta non disponeva ancora
  di un contratto `mediflow://`/`onOpenURL` verificato in questo percorso.

Aprire un modulo senza salvarlo dimostra che la superficie è raggiungibile,
non che il CRUD funzioni dall'inizio alla fine. Per chiudere queste verifiche
serve un home-base temporaneo con database esclusivamente sintetico,
credenziali effimere e pulizia automatica. Anche il deep-link deve avere un
contratto verificabile in questo percorso, oppure essere esplicitamente
escluso dal perimetro, prima che `WUL-481` possa produrre un verbale interamente
verde.

## Mappa manuale P6

Per ogni riga registrare `PASS`, `BLOCKED` o `FAIL`, con una nota breve e senza
contenuti clinici.

| Area | Percorso da esercitare | Evidenza minima |
| --- | --- | --- |
| Shell / deep-link | Aprire tutte le sezioni della sidebar; tornare a Pazienti; verificare selezione, titolo finestra e assenza di shell concorrenti. Il deep-link resta `BLOCKED` finché un vero `open mediflow://...` non apre sezione e paziente dichiarati. | Ogni destinazione è raggiungibile; sidebar e deep-link ricevono esiti separati. |
| Pazienti | Cercare `Rossi`, alternare Attivi/Archiviati/Cestino, aprire la scheda sintetica e i form Modifica/Nuovo paziente senza salvare. | Lista, filtri, dettaglio e campi significativi sono leggibili e azionabili con pointer e tastiera. |
| Diario base | Verificare filtro tipo, toggle eliminate, righe, allegati, Modifica e Nuova voce senza salvare. | CRUD reviewable e stati tombstone sono comprensibili; nessuna write queue offline e promessa. |
| Editor rich text | Nel form Nuova voce inserire il template S/O/A/P, aggiungere/rimuovere blocchi e provare i controlli di formattazione senza salvare. | Il contenuto resta editabile, il markup non viene mostrato come testo grezzo e i controlli sono accessibili. |
| Terapie | Alternare i filtri stato; aprire create/edit senza salvare; verificare lookup AIFA/manuale e collegamento diagnosi. | AIC/ATC/principio attivo, posologia, stato, date, motivazione e diagnosi sono rappresentabili. |
| Checkup | Alternare i filtri stato e aprire create/edit senza salvare. | Titolo, data, note, stato/source e gestione conflitto sono comprensibili. |
| Osservazioni | Verificare righe LOINC/UCUM, trend/sparkline e form create/edit senza salvare. | Codice, display, valore, unità, data e note sono rappresentabili senza estrazione automatica. |
| Cockpit | Verificare segnali sintetici nella scheda e le viste Agenda, Diario globale e Analytics. | Conteggi capped sono dichiarati onestamente e ogni vista ha stato vuoto/loading/error leggibile. |

## Verbale di esecuzione

```text
Run ID:
Commit:
macOS / Xcode:
Bundle packaged (WebRuntime verificato):
Fixture sintetica: si/no
Probe AX: PASS/BLOCKED/FAIL

Shell/deep-link:
Pazienti:
Diario base:
Editor rich text:
Terapie:
Checkup:
Osservazioni:
Cockpit:

Blocker e follow-up:
```

Una funzionalità può passare a `full-parity` solo quando il verbale manuale è
verde e rimangono verdi anche i controlli automatici pertinenti. Il probe, da
solo, non sostituisce nessuna delle due condizioni.
