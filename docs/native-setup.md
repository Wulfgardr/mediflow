# Setup rapido client nativo

Il client macOS richiede un certificato locale, un proxy TLS e la propria configurazione. Lo script prepara questi elementi insieme, generando il certificato, avviando il proxy e creando il file che il client leggerà.

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/local-api-tls.md](./local-api-tls.md)
- [docs/native-launch.md](./native-launch.md)
- [docs/native-testing.md](./native-testing.md)

## Uso

```bash
./scripts/native-setup.sh
```

La configurazione viene scritta nel percorso:

```
~/Library/Application Support/MediFlow/native-config.json
```

Al primo avvio il client macOS legge automaticamente questo file.

Lo script produce inoltre il file di stato:

```
~/Library/Application Support/MediFlow/runtime-status.json
```

Questo secondo file contiene esclusivamente metadati PHI-free del runtime locale: `baseURL`, porta, modalità di rete, fingerprint TLS e percorsi runtime. Il pannello `Runtime` li usa per mostrare se il servizio sia pronto e per consentire l'avvio e l'arresto espliciti del proxy TLS locale.

## Variabili opzionali

- `MEDIFLOW_LOCAL_API_TOKEN`: token per l'API locale.
- `MEDIFLOW_ATTACHMENT_MAX_BYTES`: limite del payload allegato in `/api/attachments`, espresso in byte; valore predefinito 25 MiB.
- `MEDIFLOW_OCR_GENERATION_TIMEOUT_MS`: tempo massimo, in millisecondi, per una singola generazione OCR locale; il valore predefinito è 120000 e allo scadere la richiesta viene abortita.
- `MEDIFLOW_OCR_TIMEOUT_MS`: alias di ripiego, letto solo quando `MEDIFLOW_OCR_GENERATION_TIMEOUT_MS` non sia impostata.
- `MEDIFLOW_TLS_CERT_DIR` / `MEDIFLOW_TLS_CERT_PATH` / `MEDIFLOW_TLS_KEY_PATH`: percorsi TLS.
- `MEDIFLOW_TLS_PORT`: porta TLS, predefinita 3443.
- `MEDIFLOW_HTTP_TARGET`: destinazione HTTP, predefinita http://127.0.0.1:3000.