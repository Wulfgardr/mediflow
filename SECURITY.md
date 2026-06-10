# Security Policy: MediFlow

MediFlow processa **dati sanitari**. Sicurezza e privacy sono requisiti core.

Questo documento definisce confini di sicurezza e aspettative minime per chi contribuisce.

---

## Riferimenti correlati

- [ARCHITECTURE.md](./ARCHITECTURE.md) (confini architetturali stabili)
- [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md) (stato corrente completo e boundary operativi)
- [docs/topologia-dati-flussi.md](./docs/topologia-dati-flussi.md) (percorsi dato e trust boundaries)
- [docs/walkthrough.md](./docs/walkthrough.md) (flussi operativi end-to-end)
- [docs/adr/](./docs/adr/README.md) (decisioni con impatto sicurezza)
- [docs/README.md](./docs/README.md) e [docs/markdown-index.md](./docs/markdown-index.md) (mappa e indice completo documentazione)

---

## Principi di sicurezza fondamentali

- **Local-first di default**: nessuna uscita cloud se non esplicitamente implementata e documentata.
- **Zero-knowledge a riposo**: il database deve restare illeggibile senza il PIN utente.
- **Least privilege**: le API locali devono essere autenticate; il proxy deve essere allowlisted.
- **No PHI/PII in repo**: mai committare dati reali di pazienti.

---

## Threat model (alto livello)

Assumiamo che:

- Un attaccante possa ottenere il file SQLite (`medical.db`) tramite:
  - furto del disco
  - leak da backup
  - accesso filesystem
- Un attaccante possa leggere log, crash report o screenshot.
- Il traffico localhost resti sensibile; per i client native evitare HTTP plain quando possibile.

Non copriamo ancora:

- host OS completamente compromesso (malware con keylogging + accesso memoria)
- attacchi mirati su dispositivo fisico mentre app sbloccata

---

## Protezione dati

### Dati a riposo (SQLite)

- Lo storage autorevole è un singolo file SQLite nella directory dati MediFlow.
- I campi sensibili vengono cifrati **lato client** prima della scrittura.
- I valori cifrati usano il formato:

```
ENC:<iv_b64>:<cipher_b64>
```

### Decifratura fallita e conservazione del ciphertext

- Se un campo `ENC:` non si decifra (chiave assente, dato corrotto), la UI
  mostra il placeholder `[LOCKED DATA]`.
- Il placeholder è un artefatto di sola presentazione: non deve mai essere
  persistito.
- Il ciphertext originale viene conservato e riscritto invariato a ogni save:
  un salvataggio successivo non deve mai sovrascrivere il dato clinico cifrato
  con il placeholder o con una sua ri-cifratura.

### Cancellazione paziente ed erasure

- Il DELETE operativo di un paziente è un soft-delete reversibile (tombstone
  version-guarded), non una cancellazione fisica.
- L'erasure GDPR passa da una purge amministrata dedicata (dry-run + execute,
  solo sessione admin web) con audit `patient.purged`; il restore esplicito
  emette `patient.restored`.
- I pazienti soft-deleted viaggiano nei backup: una richiesta di erasure deve
  considerare anche gli artefatti già esportati, che la purge non raggiunge.

### Chiavi e PIN

- Il PIN **non viene mai salvato**.
- Una key-encryption key (KEK) viene derivata da PIN + salt.
- La master key viene salvata cifrata e decifrata solo **in memoria** durante una sessione attiva.

> Se cambi il modello PIN / key derivation, devi scrivere prima un ADR.

---

## API locali

MediFlow espone due superfici API:

- `/api/*` (web UI): protetta da sessione
- `/api/v1/*` (client native): protetta da token, versionata
- `/api/v1/network/*` (home-base opt-in): paired/read-only-first con write
  limitati a profilo/status paziente, diario, terapie, checkup e osservazioni, protetta da
  credenziale device + sessione operatore

Regole minime:
- Mai esporre endpoint sensibili senza autenticazione.
- Mantenere `/api/v1/*` stabile e retrocompatibile.
- Il bearer token locale non equivale a una sessione amministrativa umana:
  route di sistema distruttive o amministrative richiedono session cookie con
  admin web. In particolare audit, backup export/restore, backup scheduler,
  repair DB, purge e restore paziente e start/stop MLX non devono accettare
  solo il token locale.
- Le eccezioni token-aware fuori da `/api/v1/*` restano superfici locali di
  supporto/bootstrap, non privilegi admin generali: cataloghi locali,
  settings/native bootstrap, proxy AI/OCR locale, health/redaction locali,
  network overview e stato MLX read-only. Ogni nuova eccezione deve documentare
  perche non richiede una sessione admin web.

### Trasporto

- Web UI usa HTTP su localhost.
- Client native usa proxy HTTPS locale (`:3443`) + certificate pinning (vedi [docs/local-api-tls.md](./docs/local-api-tls.md)).

### Modalita network home-base

Quando il nodo passa a `network-home-base`:

- il default locale non cambia: la modalita rete resta un opt-in esplicito
- disattivare la modalita non revoca i pairing salvati: ogni token paired
  diventa inerte e le route del data plane rispondono
  `403 NETWORK_MODE_DISABLED` finché la modalita non viene riattivata
- `POST /api/v1/network/pairing-intents` e il bootstrap PHI-safe del device
  paired
- il primo data plane remoto (`/api/v1/network/patients*`) richiede sempre
  device paired + sessione operatore
- `PUT /api/v1/network/patients/{id}` richiede inoltre capability
  `network.replica.write-patient-profile` e `version`
- `/api/v1/network/patients/{id}/entries*` richiede capability diary dedicate,
  sessione operatore e `entries.version`; abilita solo create/update/soft-delete
  del diario clinico
- `/api/v1/network/patients/{id}/therapies*` richiede capability terapia
  dedicate, sessione operatore e `therapies.version`; abilita solo
  create/update/soft-delete delle terapie
- `/api/v1/network/patients/{id}/checkups*` richiede capability checkup
  dedicate, sessione operatore e `checkups.version`; abilita solo
  create/update/soft-delete dei checkup
- `/api/v1/network/patients/{id}/observations*` richiede capability osservazioni
  dedicate, sessione operatore e `observations.version`; abilita solo
  create/update/soft-delete delle osservazioni LOINC/UCUM
- delete remoto hard, attachment/document write remoti, cataloghi, sync
  record-level, campi AI/documentali e fallback automatico restano fuori scope

### Lockout autenticazione PIN

La policy canonica è definita in [docs/adr/0017-auth-lockout-policy.md](./docs/adr/0017-auth-lockout-policy.md).

- Si applica a `/api/auth/login`, condiviso tra lock screen web e unlock macOS.
- Soglia: `5` tentativi falliti nella stessa finestra di `15 minuti`.
- Durata lockout: `15 minuti`.
- Reset completo su login valido; se la finestra precedente scade, il conteggio riparte da `1`.
- Contratto risposta:
  - `401 AUTH_INVALID_CREDENTIALS` finché il lockout non è attivo
  - `423 AUTH_LOCKED` quando il lockout è attivo, con header `Retry-After`
- Il bearer token `/api/v1` già bootstrapato non introduce una policy separata: il controllo avviene sul PIN condiviso prima dell'emissione della sessione web o dell'unlock native.

---

## Proxy verso servizi locali (sicurezza SSRF)

Alcuni endpoint inoltrano richieste a servizi locali (es. Ollama).
Regole minime:

- Permettere solo target **localhost / 127.0.0.1**.
- Permettere solo porte previste.
- Trattare ogni risposta come input non fidato.

## AI locale e import clinico guidato

I flussi AI locali che leggono note paziente, diario clinico o documenti analizzati
devono rispettare queste regole aggiuntive:

- usare solo servizi locali allowlisted (`localhost`, `127.0.0.1`)
- trattare l'output del modello come **non fidato** finché un operatore non lo conferma
- non eseguire import silenziosi da testo libero verso diagnosi o terapie
- mantenere review esplicita prima di scrivere nuovi dati strutturati in scheda
- trattare `summarySnapshot` e `parseEvidenceArtifactSnapshot` degli allegati
  come artifact clinici locali, non come payload innocui di debug

L'autofill automatico resta ammesso solo nei casi già documentati e prudenti
(es. codici ICD espliciti in fonte documentale, vedi ADR 0011).

## Comparator cloud opt-in

Il comparator cloud documentato in [docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md](./docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md)
non cambia il default `local-first`.

Regole minime:

- e ammesso solo come lane interna di engineering, mai come runtime clinico
- usa solo case pack privati, redatti/minimizzati e fuori Git
- richiede approvazione umana esplicita prima di qualunque export
- non puo scrivere dati paziente, generare apply automatici o essere committato
  nel repository

---

## Logging e redazione

I dati sanitari non devono trapelare dai log.

La taxonomy audit canonica e definita in [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./docs/adr/0015-audit-taxonomy-minimum-catalog.md).

### Audit record vs log applicativi

- Gli audit record sono strutturati, versionati e append-only.
- I log applicativi restano piu poveri e devono limitarsi a dati tecnici
  redatti.
- Non usare log testuali liberi come sostituto del catalogo audit.

### Non loggare
- campi paziente decifrati
- testo OCR grezzo
- testo note/diario usato nei prompt AI
- suggerimenti clinici grezzi prima della conferma utente
- allegati caricati (base64)
- `summarySnapshot` o `parseEvidenceArtifactSnapshot` grezzi
- token, PIN, chiavi o salt
- prompt AI completi, risposte AI grezze e descrizioni cliniche non redatte
- case pack privati/comparator cloud o output non minimizzati di shadow eval

### Puoi loggare (preferibile)
- conteggi (es. numero record)
- timing (latenza)
- status code / classi di errore
- identificatori redatti (es. prime 6 chars di un id)
- numeri di versione e flag booleane
- nomi di superfici tecniche (`web`, `native`, `api`, `job`)

### Audit v1

Quando implementi o estendi il writer audit:

- usa il catalogo `audit.v1` dell'ADR 0015
- consenti solo `eventType`, `outcome`, `actorRef`, `subjectRef` redatto,
  `sourceSurface`, timestamp e metadati strutturati
- mantieni fuori dal catalogo qualsiasi testo libero, payload clinico o
  informazione necessaria solo al rendering UI
- se un valore puo identificare un paziente al di fuori del database locale,
  redigilo o hashalo prima di loggare o esportare

Se aggiungi log:
- assumi che possano finire in crash report
- mantienili minimi e azionabili

---

## Gestione segreti

- Non committare `.env` con valori reali.
- Se introduci variabili ambiente:
  - documentale nei file rilevanti (`docs/native-setup.md` o README/CONTRIBUTING)
  - evita di richiedere segreti per l'uso locale di default

---

## Dependency e security checks

Controlli consigliati prima di release o merge rilevanti:

```bash
npm run lint
npm run build
npm audit
npm run check:never-regress
npx tsc --noEmit
```

Opzionali (se usati nella toolchain):
- secret scanning (es. gitleaks)
- SAST / dependency auditing in CI

---

## Segnalazione vulnerabilità

Se ritieni di aver trovato una vulnerabilità:

1. Preferisci canale privato (GitHub Security Advisories / Security tab), se disponibile.
2. Se il canale privato non è disponibile, apri una issue **senza dettagli sensibili**:
   - descrivi impatto e area coinvolta
   - fornisci passi minimi di riproduzione
   - evita dati reali, token o payload decifrati

Includi sempre:
- versione/commit impattato
- scenario d'attacco
- comportamento atteso vs osservato
