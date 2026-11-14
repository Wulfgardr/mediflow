# Fascio pubblico qualificato

`public-ca.pem`: Node v24.21.0, `tls.rootCertificates.join('\n')`, 121 CA,
181304 byte, SHA-256 `8403bc9ed3ae3e71b4af96a4d37c23999d7ba8c2fc9411fc6d6feb5e7ee8c4f7`.
È lo stesso fascio fissato dalla PR #540, ADR 0134, senza CA aggiunte.

Fonte: https://raw.githubusercontent.com/nodejs/node/v24.21.0/src/node_root_certs.h
SHA-256 `3cc4e524e51a7bb85223de9239688de4b22e8d32fc04e7d0bfca785172cc6a74`.
Copia e licenza del rilascio in `scripts/fixtures/node-public-ca/`.
La licenza Node contiene le condizioni Mozilla per i certificati derivati
(NSS, MPL 2.0) e le relative attribuzioni.

Rigenerazione offline, con destinazione assente:

```sh
node scripts/regenerate-chatgpt-public-ca.mjs /percorso/nuovo/public-ca.pem
cmp /percorso/nuovo/public-ca.pem assets/chatgpt-execution/public-ca.pem
```

Il generatore verifica entrambi i digest. Non legge il trust store del Node
corrente. Qualunque aggiornamento del fascio richiede una scelta esplicita
e una nuova qualifica del confine secondo ADR 0134.
