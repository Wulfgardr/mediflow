# Setup rapido client nativo

Questo script automatizza:
- generazione certificato locale
- avvio proxy TLS
- creazione config per il client macOS

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/native-launch.md](./native-launch.md)
- [docs/native-testing.md](./native-testing.md)

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

- `MEDIFLOW_LOCAL_API_TOKEN` (token per API locale)
- `MEDIFLOW_TLS_CERT_DIR` / `MEDIFLOW_TLS_CERT_PATH` / `MEDIFLOW_TLS_KEY_PATH`
- `MEDIFLOW_TLS_PORT` (default 3443)
- `MEDIFLOW_HTTP_TARGET` (default http://127.0.0.1:3000)
