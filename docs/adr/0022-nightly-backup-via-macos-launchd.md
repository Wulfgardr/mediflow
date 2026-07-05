# ADR 0022: Backup automatico notturno via `launchd` su macOS

Date: 2026-03-18
Status: Superseded

Superseded by: [ADR 0068](./0068-cross-platform-runtime-windows-linux.md), che
porta lo scheduling backup dietro un `SchedulerAdapter` cross-platform (launchd
su macOS, Task Scheduler su Windows, systemd-timer o cron su Linux). La decisione
sotto resta valida come thin slice macOS originaria.

## Problema

L'artifact backup v1 esiste gia, ma il suo uso e solo manuale dal browser.
`WUL-30` richiede un backup automatico locale, affidabile e verificabile, senza
introdurre cloud sync o dipendere da una tab aperta.

## Contesto

- MediFlow e local-first e il Mac e l'home base architetturale.
- Il backup v1 con manifest/checksum e il restore preflight sono gia canonici
  tramite ADR 0016.
- Il job deve poter girare in modo headless anche senza browser aperto.
- `WUL-31` retention e cleanup storico restano fuori da questa slice.

## Opzioni

1. Timer nel client web o job in-process dentro Next.js.
2. Scheduler applicativo generico cross-platform in repository.
3. Adapter OS-level minimo: `launchd` utente su macOS + runner headless locale.

## Trade-off

- Opzione 1:
  - Pro: semplice da sviluppare.
  - Contro: non affidabile; fallisce se browser o app non sono attivi.
- Opzione 2:
  - Pro: astrattamente piu portabile.
  - Contro: troppo ampia per questa fase; introduce un framework di job non
    necessario.
- Opzione 3:
  - Pro: coerente con "Mac home base", affidabile, diff limitato.
  - Contro: thin slice inizialmente macOS-only.

## Decisione

Adottiamo l'opzione 3.

- Il backup notturno usa un `LaunchAgent` utente su macOS.
- La configurazione minima e persistita in `settings`:
  - `enabled`
  - `hour`
  - `minute`
  - `destinationDir`
- Il job esegue un runner headless locale che:
  - legge `medical.db`
  - genera un artifact `.mediflow` v1
  - scrive esito, timestamp e path ultimo artifact nelle stesse settings
- Il pannello web Impostazioni resta il punto di configurazione e verifica.

## Conseguenze

- Positivo: il backup automatico non dipende da una sessione browser aperta.
- Positivo: il formato artifact resta identico a quello manuale v1.
- Positivo: il failure mode e osservabile nella UI tramite stato ultimo run.
- Negativo: questa slice non copre Linux/Windows.
- Negativo: la retention automatica resta fuori scope.

## First Thin Slice

1. Definire stato scheduler persistente e adapter `launchd`.
2. Aggiungere runner headless che genera artifact v1 da SQLite.
3. Esporre UI minima per enable/time/destination + `run now`.
4. Salvare esito ultimo run e coprire il runner con smoke automatico.
