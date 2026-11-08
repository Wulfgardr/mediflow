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

## Allergie del paziente

ADR 0182 aggiunge `allergies` al dettaglio restituito da
`GET /api/v1/patients/{id}` e `GET /api/v1/network/patients/{id}`.
È una stringa `ENC:iv:ciphertext` o null. Il JSON decifrato è un elenco:
`[{"substance":"Amoxicillina","reaction":"Orticaria","severity":"moderate"}]`.
Solo `substance` è obbligatoria. Le gravità ammesse sono `mild`, `moderate`,
`severe` e descrivono la reazione, senza attestare una verifica allergologica.
Null, campo assente ed elenco vuoto significano nessuna allergia registrata.
Un errore di decifratura o una forma non riconosciuta resta dato non disponibile.
Apple e GPUI devono leggere questo campo nel dettaglio per alimentare la
pillola ▲ in testata. La lista compatta non lo include. Il golden
`crypto-golden-vectors.v1.json` contiene un vettore aggiuntivo
`patient.allergies`; i vettori precedenti conservano i loro byte.

## Registrazione delle voci di diario

ADR 0183 aggiunge `recordedBy` nullable e facoltativo ai DTO di lettura delle
voci, locali v1 e paired, insieme all'orario `createdAt` già presente. Il nome
è testo del profilo in chiaro, fotografato dal server alla scrittura. Un nome
assente o null resta senza autore. Il campo non è ammesso nelle richieste di
creazione o modifica. Non ricavarlo da `metadata.authorName`, che descrive
un'altra provenienza. Le voci SOAP o di sistema non ricevono il nome del medico.

`entry-recording.v1.json` contiene i tre casi comuni a Swift e Rust. I decoder
accettano nome, null e campo assente. `ClinicalFieldCrypto.decryptEntry`
conserva il nome. Le GUI native e la lettura SQLite diretta Apple restano
fuori dalla resa di questa PR. Per la riga usare `recordedBy` e `createdAt`
del DTO HTTP, con ripiego «Registrata il <data> alle <ora>» senza autore.
