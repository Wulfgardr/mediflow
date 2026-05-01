# Security Policy — MediFlow

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
- `/api/v1/network/*` (home-base opt-in): paired/read-only-first, protetta da
  credenziale device + sessione operatore

Regole minime:
- Mai esporre endpoint sensibili senza autenticazione.
- Mantenere `/api/v1/*` stabile e retrocompatibile.

### Trasporto

- Web UI usa HTTP su localhost.
- Client native usa proxy HTTPS locale (`:3443`) + certificate pinning (vedi [docs/local-api-tls.md](./docs/local-api-tls.md)).

### Modalita network home-base

Quando il nodo passa a `network-home-base`:

- il default locale non cambia: la modalita rete resta un opt-in esplicito
- `POST /api/v1/network/pairing-intents` e il bootstrap PHI-safe del device
  paired
- il primo data plane remoto (`/api/v1/network/patients*`) resta read-only e
  richiede sempre device paired + sessione operatore
- write remoto, sync record-level e fallback automatico restano fuori scope

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
- trattare l'output del modello come **non fidato** finche un operatore non lo conferma
- non eseguire import silenziosi da testo libero verso diagnosi o terapie
- mantenere review esplicita prima di scrivere nuovi dati strutturati in scheda
- trattare `summarySnapshot` e `parseEvidenceArtifactSnapshot` degli allegati
  come artifact clinici locali, non come payload innocui di debug

L'autofill automatico resta ammesso solo nei casi gia documentati e prudenti
(es. codici ICD espliciti in fonte documentale, vedi ADR 0011).

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

1. Preferisci un canale riservato (GitHub Security Advisories / Security tab), se disponibile.
2. Se il canale riservato non è disponibile, apri una issue **senza dettagli sensibili**:
   - descrivi impatto e area coinvolta
   - fornisci passi minimi di riproduzione
   - evita dati reali, token o payload decifrati

Includi sempre:
- versione/commit impattato
- scenario d'attacco
- comportamento atteso vs osservato
