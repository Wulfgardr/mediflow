# Pilota note paziente: caratterizzazione HTTP cifrata

Refs WUL-574, WUL-706. Verifica del 17 ottobre 2026 sul runtime di
`3d4e5f0ffff8367c5be0bb73c62665b7e2eab1af`, con il nuovo test
`scripts/patient-notes-pilot-http.test.mjs`.

## Esito

Passa il giro continuo che mancava al confronto preparatorio di WUL-574:
login Web reale, apertura della chiave dell'account sintetico, cifratura delle
note, lettura attraverso Web e API v1, modifica delle sole note con versione
attesa, un evento di audit, rilettura e decifratura. La stessa cartella viene
modificata una volta da ciascun ingresso; ogni modifica è riletta da entrambi.

La prova usa le funzioni di cifratura del prodotto e osserva il database SQLite
riaprendolo in sola lettura dopo ogni risposta HTTP. Non sostituisce writer,
autenticazione o dipendenze di produzione.

Sono verificati:

- due aggiornamenti cifrati riusciti, con due soli nuovi eventi `patient.updated`;
- identità e superficie attribuite dall'host; `changedFields` contiene soltanto
  `notes`, la versione è aggiornata e i metadati non contengono testo o ciphertext;
- conservazione di ogni altra colonna del paziente, appartenenza all'ambulatorio,
  righe degli altri pazienti e storico dell'audit;
- quattro replay con versione superata, respinti con `409 VERSION_CONFLICT`
  senza effetti clinici o sull'audit;
- paziente archiviato ancora leggibile, tombstone escluso da entrambi gli
  ingressi e due tentativi di modifica del tombstone respinti con `404`;
- nessuna modifica di pazienti, appartenenze o audit durante le letture.

Ambiente: Linux, Node 24.19.0, dipendenze del lockfile installate con `npm ci`,
server Next di sviluppo su `127.0.0.1`, archivio sintetico nuovo in `/tmp`.
Il test ha concluso con **1 pass, 0 fail, 0 skip**. La durata del test non è una
baseline prestazionale del prodotto.

## Riproduzione

Il runner HTTP esistente prepara l'account, avvia il server in una copia
temporanea del sorgente e arresta il server a fine prova. Non serve un altro
harness. Dopo `npm ci`, scegliere una porta loopback libera ed eseguire:

```bash
WUL574_DATA_DIR="$(mktemp -d /tmp/mediflow-wul574.XXXXXX)"
export MEDIFLOW_DATA_DIR="$WUL574_DATA_DIR"
export MEDIFLOW_NETWORK_WRITE_DATA_DIR="$WUL574_DATA_DIR"
export MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1
export MEDIFLOW_LOCAL_AUTHORITY=0
export MEDIFLOW_PROVIDER_V2_ENABLED=0
export MEDIFLOW_PROVIDER_V2_NETWORK=0
export NEXT_TELEMETRY_DISABLED=1
export E2E_BASE_URL=http://127.0.0.1:43174
export E2E_USERNAME=admin
export E2E_PIN="$(node -e 'process.stdout.write(crypto.randomUUID())')"
export MEDIFLOW_LOCAL_API_TOKEN="$(node -e 'process.stdout.write(crypto.randomUUID())')"
export MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT=scripts/patient-notes-pilot-http.test.mjs
bash scripts/network-home-base-write-smoke.sh
```

Il risultato è nell'output `node:test`; il test non genera un rapporto JSON.
Il chiamante conserva o elimina la directory sintetica dopo l'arresto del
server. Il preparatore usa il percorso di credenziali sintetiche legacy già
previsto dal runner: questa prova non qualifica l'accesso v3 o un dispositivo
nativo. Non passa dal proxy TLS nativo, dal trasporto paired o da un browser.

## Conseguenza per la migrazione

La candidata `ReadPatientProfile` / `UpdatePatientNotes` ha ora una
caratterizzazione cifrata continua dei due ingressi HTTP correnti. I nomi
restano proposti: non sono nuovi servizi esposti da questo contributo.

La [mappa C01](../authority-census.md) recepisce la differenza dell'autorità
Swift opzionale; la sua destinazione resta da decidere in WUL-582:
`PairedPatientsWorkspaceModel.makeClient()` può selezionare
`LocalPatientsDataSource` con `MEDIFLOW_LOCAL_AUTHORITY`, mentre i relativi
store SQLite hanno propri percorsi di scrittura. La prova qui eseguita non li
attiva. Il confine applicativo, l'idempotenza, la ricevuta del servizio e la
qualifica integrata restano nelle issue 0.9.1; questa caratterizzazione non
chiude WUL-573, WUL-580 o l'accettazione Rust WUL-736.
