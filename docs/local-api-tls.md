<!-- Codex: created 2026-02-01 -->
# TLS locale per MediFlow

Questa guida configura un proxy HTTPS locale davanti a `http://localhost:3000`.
Serve ai client Apple per usare HTTPS con certificate pinning e per mantenere
il cookie operatore `Secure` anche quando il backend Next gira ancora in HTTP.

Riferimenti correlati:
- [docs/NATIVE.md](./NATIVE.md)
- [docs/native-setup.md](./native-setup.md)
- [SECURITY.md](../SECURITY.md)
- [docs/walkthrough.md](./walkthrough.md)

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
Inoltre inoltra `x-forwarded-proto=https`, `x-forwarded-host` e
`x-forwarded-port`, cosi le route auth possono emettere il cookie sessione con
flag `Secure`.

## 2b) Bind LAN solo in `network-home-base`

Per test o pairing da iPhone/iPad su LAN il proxy puo ascoltare anche su un host
non loopback, per esempio `0.0.0.0`. Questo e permesso solo quando il database
MediFlow e gia in `network.mode = network-home-base`.

Con `scripts/native-setup.sh`:

```bash
MEDIFLOW_TLS_BIND_HOST=0.0.0.0 bash scripts/native-setup.sh
```

Se `network.mode` non e ancora `network-home-base`, lo script rifiuta il bind
LAN e termina con errore invece di esporre il proxy per sbaglio.

## 3) Calcola il fingerprint SHA256

Il pin del client macOS usa la SHA256 del certificato in formato DER.

```bash
openssl x509 -in ./certs/local-api.crt -outform der | shasum -a 256
```

Copia l'hash esadecimale nelle impostazioni del client macOS.
