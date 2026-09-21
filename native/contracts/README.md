# Contratti cross-platform del core nativo

Implementazioni scritte in linguaggi diversi devono produrre gli stessi byte,
non soltanto risultati che sembrino equivalenti. Questa cartella raccoglie perciò
gli ORACOLI di riferimento che ogni core MediFlow deve riprodurre su macOS,
Windows-MSVC e Linux: il riferimento web TS, `MediFlowCore` in Swift e un eventuale
core Rust futuro. [ADR 0071](../../docs/adr/0071-tri-os-reversed-flow-shared-core.md)
colloca questa verifica all'inizio del percorso, nella Fase 0, attraverso il
gate CI golden-vector.

## Crittografia zero-knowledge per campo

- `crypto-golden-vectors.v1.json`: vettori FROZEN, byte-exact, generati dalle
  primitive WebCrypto del riferimento web ([lib/security/security.ts](../../lib/security/security.ts)):
  KEK = PBKDF2-HMAC-SHA256(PIN, salt, 100000); master key AES-256-GCM protetta nel
  formato `base64(iv12 || GCM(rawKey, KEK))`; campi
  `ENC:base64(iv12):base64(ct||tag)` con plaintext = `JSON.stringify(value)`.
- `generate-crypto-vectors.mjs`: rigenera la fixture in modo deterministico e
  ne verifica ogni vettore mediante decifratura e recupero della chiave:
  `node native/contracts/generate-crypto-vectors.mjs`.

### Chi deve passare l'oracolo

- **Swift (oggi):** `CryptoGoldenVectorsTests` in
  `native/MediFlowMac/Tests/MediFlowAppleSharedTests/` consuma direttamente il
  fixture e verifica `deriveKEK`, `unwrapMasterKey`, `decryptField`.
  Esecuzione: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  swift test --package-path native/MediFlowMac --filter CryptoGoldenVectorsTests`.
- **Web (riferimento):** i vettori derivano da
  [lib/security/security.ts](../../lib/security/security.ts); la verifica riportata
  attesta che `arrayBufferToBase64` produce gli stessi base64.
- **Windows-MSVC / Linux (passaggio previsto da questa sequenza):** gli stessi
  vettori e lo stesso test devono essere usati dopo l'estrazione di
  `MediFlowCore`, con `swift-crypto` al posto di `CryptoKit`.

### Regola di invarianza

I vettori `v1` sono CONGELATI perché definiscono il contratto crittografico:
modificarli potrebbe rompere la compatibilità e corrompere i dati a riposo
indicati qui come PHII. Per coprire nuovi casi si AGGIUNGONO vettori, oppure un
file `v2`; quelli esistenti non si modificano.

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
  oracolo codec module-internal Swift. Lo stesso test è obbligatorio su Linux e
  Windows nel gate tri-OS.

Il risultato va letto entro ciò che il vettore misura: la parità byte per byte
dell'oracolo del core condiviso. Non dimostra che esistano un owner H4 a runtime,
controlli fence key/generation, un handoff H5, un'approvazione clinica, una
persistenza o una scrittura consegnata. Questi passaggi non possono essere
dedotti dalla sola compatibilità del codec.

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

Il codec H9 tratta draft e receipt soltanto come dati: non espone route né
trasporto e non conferisce autorità di scrittura. Per questo la verifica del
formato non basta a dichiarare la portabilità, che resta
`HOLD_TRI_OS_CI_SAME_SHA` finché Linux, Windows e macOS non superano i controlli
sulla stessa SHA candidata.
