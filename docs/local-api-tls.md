<!-- Codex: created 2026-02-01 -->
# TLS locale per MediFlow

Questa guida configura un proxy HTTPS locale davanti a `http://localhost:3000`.
Serve al client macOS per usare HTTPS con certificate pinning.

## 1) Genera un certificato self-signed

Esempio con OpenSSL:

```bash
mkdir -p ./certs
openssl req -x509 -newkey rsa:2048 -keyout ./certs/local-api.key -out ./certs/local-api.crt -days 365 -nodes -subj "/CN=localhost"
```

## 2) Avvia il proxy TLS

```bash
export MEDIFLOW_TLS_CERT_PATH="./certs/local-api.crt"
export MEDIFLOW_TLS_KEY_PATH="./certs/local-api.key"
export MEDIFLOW_TLS_PORT=3443
export MEDIFLOW_HTTP_TARGET="http://127.0.0.1:3000"
node scripts/local-api-tls-proxy.mjs
```

Il proxy ascolta su `https://localhost:3443` e inoltra al server HTTP locale.

## 3) Calcola il fingerprint SHA256

Il pin del client macOS usa la SHA256 del certificato in formato DER.

```bash
openssl x509 -in ./certs/local-api.crt -outform der | shasum -a 256
```

Copia l'hash esadecimale nelle impostazioni del client macOS.
