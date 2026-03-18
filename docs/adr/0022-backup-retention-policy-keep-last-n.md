<!-- Codex: created 2026-03-18 -->
# ADR 0022: Retention automatica dei backup con policy `keep-last-N`

Date: 2026-03-18
Status: Accepted

## Problema

Con `WUL-30` il backup notturno crea artifact `.mediflow` nella cartella scelta
dall'operatore, ma non esiste ancora una policy di retention. Senza cleanup
automatico la cartella cresce all'infinito e i `.tmp` orfani restano rumore
operativo.

## Contesto

- MediFlow resta local-first e non introduce servizi cloud o job remoti.
- Il backup artifact v1 e canonico via ADR 0016.
- Lo scheduler macOS via `launchd` e canonico via ADR 0021.
- `WUL-31` richiede retention configurabile, dry-run chiaro e cleanup tracciato.
- Non e sicuro cancellare automaticamente file arbitrari o attachment clinici.

## Opzioni

1. Nessuna retention automatica, solo istruzioni manuali.
2. Cleanup generico dell'intera cartella destinazione.
3. Retention stretta sui soli file scheduler-owned con policy `keep-last-N`.

## Trade-off

- Opzione 1:
  - Pro: rischio quasi nullo.
  - Contro: non risolve la crescita indefinita del folder.
- Opzione 2:
  - Pro: aggressiva e apparentemente semplice.
  - Contro: troppo rischiosa; potrebbe toccare file non controllati da MediFlow.
- Opzione 3:
  - Pro: diff piccolo, confine chiaro, comportamento spiegabile.
  - Contro: non copre ancora cleanup piu ampio su altri artifact locali.

## Decisione

Adottiamo l'opzione 3.

- La retention automatica agisce solo nella `destinationDir` configurata.
- Vengono considerati solo:
  - `mediflow-backup-v1-*.mediflow`
  - `mediflow-backup-v1-*.mediflow.tmp`
- La policy minima e configurabile come `retentionKeepArtifacts` con clamp `1..365`.
- Ogni run automatico:
  - crea il nuovo artifact
  - preserva esplicitamente l'artifact appena creato
  - elimina gli artifact piu vecchi oltre `keep-last-N`
  - elimina i `.tmp` orfani compatibili col naming scheduler-owned
- La UI espone:
  - preview dry-run
  - apply manuale
  - ultimo esito retention tracciato in `settings`

## Conseguenze

- Positivo: la cartella backup resta sotto controllo senza toccare dati clinici.
- Positivo: l'operatore puo vedere in anticipo cosa verrebbe rimosso.
- Positivo: la retention reale e tracciata con timestamp, mode e conteggi.
- Negativo: non vengono ancora puliti attachment, export manuali browser o altri
  file esterni al naming controllato.

## First Thin Slice

1. Estendere lo stato scheduler con `retentionKeepArtifacts` e metadati ultimo cleanup.
2. Aggiungere helper puri per dry-run/apply limitati ai file scheduler-owned.
3. Eseguire retention automatica nel runner headless dopo la scrittura del nuovo backup.
4. Esporre preview/apply nella route e nella UI Impostazioni.
