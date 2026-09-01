# Contratti cross-platform del core nativo

Questa cartella ospita gli ORACOLI neutri rispetto al linguaggio che ogni
implementazione del core MediFlow (riferimento web TS, `MediFlowCore` Swift oggi,
un eventuale core Rust domani) deve riprodurre byte-per-byte, su macOS,
Windows-MSVC e Linux. Vedi [ADR 0071](../../docs/adr/0071-tri-os-reversed-flow-shared-core.md)
(Fase 0: gate CI golden-vector come prima cosa).

## Crittografia zero-knowledge per campo

- `crypto-golden-vectors.v1.json`: vettori FROZEN, byte-exact, generati dalle
  primitive WebCrypto del riferimento web ([lib/security/security.ts](../../lib/security/security.ts)):
  KEK = PBKDF2-HMAC-SHA256(PIN, salt, 100000); master key AES-256-GCM wrappata
  `base64(iv12 || GCM(rawKey, KEK))`; campi `ENC:base64(iv12):base64(ct||tag)` con
  plaintext = `JSON.stringify(value)`.
- `generate-crypto-vectors.mjs`: rigenera il fixture in modo deterministico e si
  auto-verifica (ogni vettore viene anche decifrato/unwrapped per controllo):
  `node native/contracts/generate-crypto-vectors.mjs`.

### Chi deve passare l'oracolo

- **Swift (oggi):** `CryptoGoldenVectorsTests` in
  `native/MediFlowMac/Tests/MediFlowAppleSharedTests/` consuma direttamente il
  fixture e verifica `deriveKEK`, `unwrapMasterKey`, `decryptField`.
  Esecuzione: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  swift test --package-path native/MediFlowMac --filter CryptoGoldenVectorsTests`.
- **Web (riferimento):** [lib/security/security.ts](../../lib/security/security.ts) e la sorgente da
  cui i vettori sono derivati (verificato: `arrayBufferToBase64` produce gli stessi
  base64).
- **Windows-MSVC / Linux (prossimo):** stessi vettori, stesso test, una volta
  estratto `MediFlowCore` con `swift-crypto` al posto di `CryptoKit`.

### Regola di invarianza

I vettori `v1` sono CONGELATI: cambiarli significa rompere il contratto crypto e
potenzialmente corrompere PHII a riposo. Per nuovi casi si AGGIUNGONO vettori
(o un file `v2`), non si mutano quelli esistenti.

## Field set e seal SOAP H4

- `headless-soap-entry-h4-golden.v1.json` congela il field set host-owned, il
  framing SHA-256 length-prefixed, i tre plaintext JSON e il bundle
  AES-256-GCM di ADR 0103. La fixture usa soltanto contenuto clinico sintetico.
- `../../scripts/generate-headless-soap-entry-h4-golden.mjs` genera il vettore
  deterministico con tre IV distinti e si auto-verifica anche tramite decrypt.
  `--check` confronta il file tracciato senza riscriverlo:
  `node scripts/generate-headless-soap-entry-h4-golden.mjs --check`.
- `HeadlessSoapEntryH4GoldenTests` verifica materializzazione, decoder
  grammaticale, ciphertext, digest del seal, reopen e tamper mediante un
  oracolo codec module-internal Swift. Lo stesso test e obbligatorio su Linux e
  Windows nel gate tri-OS.

Il vettore dimostra parita byte-esatta dell'oracolo shared-core. Non dimostra un
owner H4 runtime, fence key/generation, handoff H5, approvazione clinica,
persistenza o write consegnato.

## DTO draft e receipt SOAP H9

- `headless-soap-entry-contract-golden.v1.json` congela i due DTO
  language-neutral di ADR 0103: draft H1 a sei key e receipt H7b a tredici key,
  con JSON canonico compatto, digest H1 length-framed e digest receipt
  domain-separated. Tutti i valori sono sintetici.
- `../../scripts/generate-headless-soap-entry-contract-golden.ts` possiede la
  fixture e ne controlla il drift senza riscrittura con:
  `node scripts/run-strip-types.mjs scripts/generate-headless-soap-entry-contract-golden.ts --check`.
- `HeadlessSoapEntryContractGoldenTests` decodifica forme chiuse, literal,
  tipi, pattern, versioni e timestamp, poi ricostruisce i JSON con ordine
  esplicito e confronta entrambi i digest. Esecuzione locale:
  `swift test --package-path native/MediFlowMac --filter HeadlessSoapEntryContractGoldenTests`.

Il codec H9 tratta draft e receipt soltanto come dati e non espone route,
transport o authority di scrittura. La portabilita resta
`HOLD_TRI_OS_CI_SAME_SHA` finche Linux, Windows e macOS non passano sulla stessa
SHA candidata.
