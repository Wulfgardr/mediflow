<!-- Codex: created 2026-02-01 -->
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

Lo script scrive anche:

```
~/Library/Application Support/MediFlow/runtime-status.json
```

Il file contiene solo metadati PHI-free del runtime locale (`baseURL`, porta,
modalita rete, fingerprint TLS e percorsi runtime). Il pannello `Runtime`
dell'app lo usa per mostrare readiness e per avviare/arrestare il proxy TLS
locale in modo esplicito.

## Variabili opzionali

- `MEDIFLOW_LOCAL_API_TOKEN` (token per API locale)
- `MEDIFLOW_ATTACHMENT_MAX_BYTES` (limite byte per payload allegato in `/api/attachments`, default 25 MiB)
- `MEDIFLOW_TLS_CERT_DIR` / `MEDIFLOW_TLS_CERT_PATH` / `MEDIFLOW_TLS_KEY_PATH`
- `MEDIFLOW_TLS_PORT` (default 3443)
- `MEDIFLOW_HTTP_TARGET` (default http://127.0.0.1:3000)
