# Security Policy — MediFlow

MediFlow processa **dati sanitari**. Sicurezza e privacy sono requisiti core.

Qui troverai i confini di sicurezza e aspettative minime per chi contribuisca, risulta fondamentale conoscere un minimo gli argomenti in questa pagina, forse ancora più delle competenze informatiche.

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

Regole minime:
- Mai esporre endpoint sensibili senza autenticazione.
- Mantenere `/api/v1/*` stabile e retrocompatibile.

### Trasporto

- Web UI usa HTTP su localhost.
- Client native usa proxy HTTPS locale (`:3443`) + certificate pinning (vedi `docs/local-api-tls.md`).

---

## Proxy verso servizi locali (sicurezza SSRF)

Alcuni endpoint inoltrano richieste a servizi locali (es. Ollama).
Regole minime:

- Permettere solo target **localhost / 127.0.0.1**.
- Permettere solo porte previste.
- Trattare ogni risposta come input non fidato.

---

## Logging e redazione

I dati sanitari non devono trapelare dai log.

### Non loggare
- campi paziente decifrati
- testo OCR grezzo
- allegati caricati (base64)
- token, PIN, chiavi o salt

### Puoi loggare (preferibile)
- conteggi (es. numero record)
- timing (latenza)
- status code / classi di errore
- identificatori redatti (es. prime 6 chars di un id)

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
