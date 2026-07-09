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
