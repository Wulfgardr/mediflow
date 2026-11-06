# Aggiornare i consumi prima di una release

Prima del tag, dalla checkout di MediFlow con Node 24:

```bash
npm run collect:development-usage
npm run build:usage-dashboard
npm run test:usage-dashboard
npm run test:release-usage
npm run check:usage-dashboard
```

Esaminare il diff degli aggregati, committare JSON, SVG e tabelle, quindi creare
il tag sulla revisione che li contiene. Il workflow `release-usage.yml` esegue
su tag `v*` e release pubblicata le prove e il controllo di coerenza e rifiuta
uno snapshot di oltre due giorni di calendario UTC precedente al commit del tag.
Non confronta la data della pubblicazione o quella dell'oggetto tag annotato.
Un errore blocca il controllo CI: GitHub non annulla un tag già creato.

Il raccoglitore opera solo localmente, senza dipendenze aggiuntive né richieste
ai provider. Legge i rollout Codex attivi ed archiviati e i record Claude Code.
Le sessioni T3 Code sono incluse quando il relativo harness scrive in queste
sedi e la cwd rispetta il confine Git. Una sessione T3 avviata in una scratch
directory estranea resta esclusa, anche quando parla del progetto.
CodexBar, se installato, viene interrogato con `cost --provider codex --period all
--group-by project --format json`: usa soltanto le directory sorgenti verificabili,
nei giorni senza record Codex diretti. Gli aggregati per progetto possono
raggruppare altre directory e non vengono attribuiti attraverso il loro nome.
L'export non viene scritto nel repository. Non si sommano due fonti dello stesso giorno.

La base immutabile `docs/data/development-usage-2026-09-27.json` conserva il
pubblicato fino al 27 settembre incluso. I nuovi record entrano dal giorno
successivo: gli eventuali consumi del 27 settembre dopo l'istante originale
restano fuori per evitare sovrapposizioni non ricostruibili. La serie effort
mantiene quella base ed aggiunge solo i record Codex diretti, senza ricavare
effort dagli aggregati CodexBar. Il provider è dedotto dal nome del modello.
Input ed output includono la cache una sola volta. I token di ragionamento,
già compresi nell'output, non vengono sommati nuovamente.

La copertura resta parziale: log cancellati senza metadati Git verificabili,
righe non decodificabili (conteggiate nel riepilogo locale), altre macchine e
harness senza record compatibili non sono ricostruiti. Le checkout esistenti
sono controllate attraverso origin e worktree. Quelle cancellate richiedono
cwd e repository Git registrate nella sessione. Nessuna attribuzione per nome
della cartella o per contenuto dei prompt. Non aggiungere identificatori
modello all'allowlist senza esaminarli prima della pubblicazione.

Conservare localmente i log necessari alle raccolte successive: oltre la base
storica, ogni esecuzione ricalcola dai record disponibili. La CI vede solo gli
aggregati e non certifica completezza ed attribuzione delle fonti private.
