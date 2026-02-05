<!-- Codex: created 2026-02-01 -->
# Setup rapido client nativo

Questo script automatizza:
- generazione certificato locale
- avvio proxy TLS
- creazione config per il client macOS

## Uso

```bash
./scripts/native-setup.sh
```

Il file di configurazione viene scritto in:

```
~/Library/Application Support/MediFlow/native-config.json
```

Il client macOS lo legge automaticamente al primo avvio.

## Variabili opzionali

- `MEDIFLOW_LOCAL_API_TOKEN` (se vuoi token per l'API)
- `MEDIFLOW_TLS_CERT_DIR` / `MEDIFLOW_TLS_CERT_PATH` / `MEDIFLOW_TLS_KEY_PATH`
- `MEDIFLOW_TLS_PORT` (default 3443)
- `MEDIFLOW_HTTP_TARGET` (default http://127.0.0.1:3000)
