---
summary: "Manual P6 click-map for the packaged MediFlow macOS home-base shell."
read_when:
  - "Running WUL-401 or deciding whether a macOS capability can move from partial to full parity."
  - "Verifying the universal macOS bundle after native UI or navigation changes."
---

# Click-map P6 macOS home-base

Stato documento: `SECONDARY / VERIFICATION RUNBOOK`

Questo runbook raccoglie l'evidenza manuale richiesta da `WUL-401`. Il probe AX
riduce l'ambiguita sugli identificatori, ma non certifica da solo usabilita,
completezza dei campi o parity UI.

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

Questa procedura produce il bundle Debug packaged e verifica che il WebRuntime
Next.js sia realmente incluso prima di avviare la fixture.

Con accesso Accessibility concesso al terminale corrente, eseguire il probe
preparatorio:

```bash
npm run test:native:clickmap:probe -- --app-path "$APP"
```

## Copertura effettiva della fixture

La fixture consente di verificare navigazione, ricerca e filtri paziente,
dettaglio sintetico, segnali cockpit, righe diario/terapie/checkup/osservazioni,
trend e controlli del rich text senza salvare.

Restano `BLOCKED` per costruzione, e non vanno promossi a `PASS`:

- mutazioni, conflitti e lifecycle: la fixture non crea sessione paired,
  credenziali, master key o capability di write;
- allegati e tombstone: gli array sintetici sono vuoti;
- Agenda, Diario globale e Analytics: le capability host non sono caricate;
- deep-link URL: non esiste ancora un contratto `mediflow://`/`onOpenURL`.

Aprire un form senza salvarlo prova la superficie, non il CRUD end-to-end. Per
chiudere quei gate serve un home-base temporaneo con database esclusivamente
sintetico, credenziali effimere e cleanup automatico.

## Mappa manuale P6

Per ogni riga registrare `PASS`, `BLOCKED` o `FAIL`, con una nota breve e senza
contenuti clinici.

| Area | Percorso da esercitare | Evidenza minima |
| --- | --- | --- |
| Shell / deep-link | Aprire tutte le sezioni della sidebar; tornare a Pazienti; verificare selezione, titolo finestra e assenza di shell concorrenti. Il deep-link resta `BLOCKED` finche un vero `open mediflow://...` non apre sezione e paziente dichiarati. | Ogni destinazione e raggiungibile; sidebar e deep-link ricevono esiti separati. |
| Pazienti | Cercare `Rossi`, alternare Attivi/Archiviati/Cestino, aprire la scheda sintetica e i form Modifica/Nuovo paziente senza salvare. | Lista, filtri, dettaglio e campi significativi sono leggibili e azionabili con pointer e tastiera. |
| Diario base | Verificare filtro tipo, toggle eliminate, righe, allegati, Modifica e Nuova voce senza salvare. | CRUD reviewable e stati tombstone sono comprensibili; nessuna write queue offline e promessa. |
| Editor rich text | Nel form Nuova voce inserire il template S/O/A/P, aggiungere/rimuovere blocchi e provare i controlli di formattazione senza salvare. | Il contenuto resta editabile, il markup non viene mostrato come testo grezzo e i controlli sono accessibili. |
| Terapie | Alternare i filtri stato; aprire create/edit senza salvare; verificare lookup AIFA/manuale e collegamento diagnosi. | AIC/ATC/principio attivo, posologia, stato, date, motivazione e diagnosi sono rappresentabili. |
| Checkup | Alternare i filtri stato e aprire create/edit senza salvare. | Titolo, data, note, stato/source e gestione conflitto sono comprensibili. |
| Osservazioni | Verificare righe LOINC/UCUM, trend/sparkline e form create/edit senza salvare. | Codice, display, valore, unita, data e note sono rappresentabili senza estrazione automatica. |
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

Una capability passa a `full-parity` solo quando il verbale manuale e verde e
i gate automatici pertinenti restano verdi.
