# TLS locale per MediFlow

I client Apple devono poter riconoscere il certificato del nodo a cui si
collegano e usare un cookie operatore `Secure`, anche quando il backend Next
comunica ancora in HTTP. Il proxy descritto qui si colloca davanti a
`http://localhost:3000` e rende disponibile HTTPS locale con verifica del
certificato atteso, o certificate pinning.

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

Il proxy riceve le richieste su `https://localhost:3443` e le inoltra al server
HTTP locale. Trasmette anche `x-forwarded-proto=https`, `x-forwarded-host` e
`x-forwarded-port`: le route di autenticazione possono così riconoscere il
trasporto HTTPS esterno ed emettere il cookie di sessione con flag `Secure`.

## 2b) Bind LAN solo in `network-home-base`

Il collegamento di prova o il pairing da iPhone/iPad sulla LAN richiedono che
il proxy sia raggiungibile anche fuori dal loopback, per esempio tramite
`0.0.0.0`. Questo ascolto è permesso solo quando il database MediFlow è già in
`network.mode = network-home-base`: la necessità di collegare un dispositivo
non autorizza da sola l'esposizione in rete.

Con `scripts/native-setup.sh`:

```bash
MEDIFLOW_TLS_BIND_HOST=0.0.0.0 bash scripts/native-setup.sh
```

Quando `network.mode` non è ancora `network-home-base`, lo script rifiuta
l'ascolto sulla LAN e termina con errore. Il proxy non viene quindi esposto
per effetto della sola configurazione dell'indirizzo.

## 3) Calcola il fingerprint SHA256

Il client macOS identifica il certificato atteso mediante la sua SHA256 in formato DER; il comando seguente calcola il valore da usare per il pin.

```bash
openssl x509 -in ./certs/local-api.crt -outform der | shasum -a 256
```

Copia l'hash esadecimale nelle impostazioni del client macOS.
