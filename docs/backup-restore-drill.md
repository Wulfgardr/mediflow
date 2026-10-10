---
summary: "Operator instructions for the synthetic backup and restore drill, and how to read its report."
read_when:
  - "Checking that a backup can be restored before relying on it."
  - "Changing the backup format, the scheduled runner or the restore executor."
---

# Prova di ripristino

Un backup serve se si riesce a ripristinarlo. Questa prova lo verifica su
archivi sintetici creati apposta: non legge, non copia e non modifica i dati
dello studio. Dura meno di un minuto.

## Che cosa serve

- Il sorgente di MediFlow con le dipendenze installate (`npm ci`) e Node 24.
- Nessuna preparazione dell'archivio: la prova crea e cancella da sola i propri
  file.

## Eseguirla

Dalla cartella del progetto:

```bash
npm run test:backup-restore:drill
```

L'ultima riga dice l'esito e dove trovare il rapporto:

```text
Restore drill pass. Report: tmp-backup-restore-drill/restore-drill-report.json
```

## Che cosa fa

1. Crea un archivio sintetico di origine con un paziente, una nota, una
   terapia e un documento allegato; otto campi sono cifrati con una chiave
   generata per la prova.
2. Esegue il backup pianificato, lo stesso programma che gira di notte.
3. Ripristina quel backup in un secondo archivio sintetico con lo stesso
   programma che usa l'applicazione.
4. Esporta di nuovo il secondo archivio e lo confronta con il backup,
   collezione per collezione.
5. Decifra gli otto campi cifrati con la chiave della prova.
6. Controlla che la pulizia dei vecchi backup tolga solo i file che le
   appartengono.

## Leggere il rapporto

| Voce | Esito atteso |
| --- | --- |
| `status` | `pass` |
| `realRestore.differences` | elenco vuoto: nessuna collezione è tornata diversa |
| `realRestore.sealedValuesReadable` | `8`: i campi cifrati si leggono ancora |
| `preflight.ok` | `true` |
| `retention` | i tre valori a `true` |
| `failures` | elenco vuoto |

## Che cosa non prova

Lo dice anche il rapporto, in `realRestore.notCovered`:

- **la chiave**: il backup non la contiene; dopo la perdita del computer i
  campi cifrati si recuperano solo con il materiale di sblocco;
- **i comandi di revisione durevoli**: finché esistono, il ripristino si ferma
  di proposito;
- **account locali e impostazioni**: non fanno parte del backup.

Non prova nemmeno il backup dello studio: lavora solo sugli archivi sintetici
che crea.

## Se fallisce

L'ultima riga dice `Restore drill fail` e `failures` elenca il passo, il
motivo e che cosa controllare. Per conservare gli archivi sintetici e
guardarli:

```bash
npm run test:backup-restore:drill -- --keep-work-dir
```

Restano in `tmp-backup-restore-drill/`; si possono cancellare a mano. Un
fallimento va segnalato con il rapporto allegato: non contiene dati reali.
