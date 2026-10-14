---
summary: "Operator instructions for the synthetic backup and restore drill, and how to read its report."
read_when:
  - "Checking that a backup can be restored before relying on it."
  - "Changing the backup format, the scheduled runner or the restore executor."
---

# Prova di ripristino dell’esportazione portabile

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


## Backup completo dopo la perdita del computer

Questo percorso è distinto dalla prova portabile sopra. In Impostazioni →
Backup, «Crea backup completo cifrato» salva `.mediflow-recovery` con l’intero
SQLite, account e chiavi protette compresi. Conserva il kit corrispondente a
quella copia; una rotazione successiva delle credenziali produce un altro kit.
La chiave su carta resta separata. «Verifica il file cifrato» controlla
l’autenticità con la chiave sbloccata, **non** dimostra un ripristino.

Per recuperare su un computer nuovo:

1. Installa le dipendenze del sorgente con Node 24, ma non completare il primo
   avvio. Prepara una cartella locale vuota su volume cifrato, fuori da servizi
   di sincronizzazione. Chiudi tutti i processi MediFlow. Non copiare token
   locali o configurazioni di accesso dalla sorgente; lascia disattivato
   `MEDIFLOW_LOCAL_API_TOKEN` anche al primo avvio dopo il recupero.
2. Ritira la vecchia installazione: non usare contemporaneamente i due archivi.
   Il protocollo locale non può osservare una copia su un altro computer.
3. Dalla cartella del programma esegui, sostituendo i tre percorsi:

   ```bash
   npm run recovery:restore -- --backup /percorso/backup.mediflow-recovery --kit /percorso/kit.json --data-dir /percorso/archivio-vuoto --source-retired
   ```

4. Inserisci la chiave cartacea al prompt: non compare sul terminale e non va
   messa nella riga di comando. In caso di errore non eliminare lo stato di
   manutenzione o le copie del protocollo per forzare un secondo tentativo.
5. Avvia MediFlow con `MEDIFLOW_DATA_DIR` impostata alla stessa cartella.
   Scegli «Recupera con kit e chiave», imposta una nuova passphrase, salva il
   nuovo kit e rinnova l’accesso. Riabbina i dispositivi.
6. Nella prova sintetica controlla una nota cifrata, lo storico e una ricevuta
   già applicata; la ricevuta non deve produrre una seconda scrittura.

Il backup è limitato a 512 MiB e allo schema corrente. File incompleto, alterato,
chiave o kit errati, schema incompatibile e destinazione non vuota vengono
rifiutati prima dello swap. La prova automatica del confine SQLite è
`lib/recovery-backup.test.ts`: usa solo archivi sintetici e verifica anche che
un processo locale ancora ammesso impedisca la sostituzione. Non costituisce
la prova operativa di un secondo operatore né certifica un backup dello studio.
