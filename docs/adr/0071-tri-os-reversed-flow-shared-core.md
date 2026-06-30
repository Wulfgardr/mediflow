<!-- Claude: direttiva utente 2026-06-30 (visione tri-OS reversed-flow) -->
# ADR 0071: App universale tri-OS a flusso invertito con core nativo condiviso

Date: 2026-06-30
Status: Accepted (direzione); la scelta del linguaggio del core e RACCOMANDATA e
sara CONFERMATA dal gate CI Fase 0 (vedi "Decisione" e "Punto di non ritorno").

Related:
[docs/adr/0070-in-house-first-for-buildable-logic.md](./0070-in-house-first-for-buildable-logic.md),
[docs/adr/0065-intended-purpose-and-claims-guard.md](./0065-intended-purpose-and-claims-guard.md),
[docs/adr/0066-patient-soft-delete-lifecycle.md](./0066-patient-soft-delete-lifecycle.md),
[ARCHITETTURA.md](../../ARCHITETTURA.md),
[docs/NATIVE.md](../NATIVE.md),
[lib/security.ts](../../lib/security.ts),
[lib/db.ts](../../lib/db.ts),
[native/MediFlowMac/Sources/MediFlowAppleShared/CryptoService.swift](../../native/MediFlowMac/Sources/MediFlowAppleShared/CryptoService.swift)

## Problema

Oggi MediFlow e un backend web (Next.js + SQLite + field crypto zero-knowledge) e
l'app nativa Apple e un THIN CLIENT paired in sola lettura/scrittura mediata: la
sorgente di verita (dati, validazione, identita, versioni) vive nel backend su
localhost, e l'app dipende da esso per funzionare. La direttiva di prodotto
(2026-06-30, vedi memoria [[tri-os-reversed-flow-vision]]) inverte la rotta:

- l'app nativa deve avere il CONTROLLO TOTALE ed essere autorita locale-first;
- "localhost" deve diventare solo una STAZIONE INTERMEDIA, non la sorgente;
- l'obiettivo finale e UN'app universale come TRE BINARI nativi, uno per OS
  (macOS, Windows, Linux).

Vincolo critico: la crittografia zero-knowledge per campo e l'invariante piu
pericolosa (un errore corrompe PHII a riposo). Oggi esistono GIA due
implementazioni byte-compatibili: web (WebCrypto, [lib/security.ts](../../lib/security.ts))
e Swift (CryptoKit, CryptoService.swift, verificata vs web, vedi [[apple-paired-crypto]]).

## Opzioni valutate

Design pass multi-agente (understand -> 4 proposte da lenti diverse -> giudice).
Tutte e quattro le proposte CONCORDANO sulla destinazione (core nativo possiede
SQLite locale; master key nel keystore OS; Next.js declassato a peer di
sync/archivio solo-ciphertext; UI native per-OS con Liquid Glass solo su Apple).
Differiscono SOLO sul linguaggio del core:

1. Rust core + tre shell native (riuso alto, ma TERZA implementazione crypto).
2. "Sovereign" Rust core, lente medical-grade massima (la piu sicura, la piu lenta, 9-12 mesi).
3. Swift core (`MediFlowCore`) + WebRuntime embedded su Win/Linux (riuso e velocita massimi).
4. Rust core + UI native pure per-OS (migliore UX nativa, 7-8 mesi).

Punteggi del giudice (totali ravvicinati): P3=46, P4=45, P1=44, P2=44. Decisivo:
le proposte 1/2/4 aggiungono volontariamente una TERZA implementazione del
contratto crypto in un linguaggio che il team (TS + Swift) non possiede, e poi
spendono il budget piu grande a ri-verificarla. La P3 lo evita: il contratto e
gia in Swift e gia verificato, e `swift-crypto` (BoringSSL) compila primitive
AES-GCM/PBKDF2 byte-identiche su Windows (MSVC) e Linux dallo stesso sorgente.
La parte che differenzia non e la destinazione (identica) ma il COSTO e il RISCHIO
per arrivarci.

## Decisione

Adottare una **Proposta 3 irrobustita** come spina dorsale:

1. **Core nativo condiviso `MediFlowCore`** (Swift Package senza dipendenze di
   piattaforma) che diventa l'AUTORITA on-device su ogni OS. Possiede: field
   crypto (`ENC:iv:data`), ENCRYPTED_FIELDS (oggi in [lib/db.ts](../../lib/db.ts)),
   wrap/unwrap master key, KEK da PIN (PBKDF2-HMAC-SHA256 100k), SQLite locale
   (medical.db, schema invariato), validatori di scrittura portati da
   `lib/network-*-write.ts`, guardie di versione/concorrenza, soft-delete
   (ADR 0066), codec e moduli in-house (DiagnosesCodec, ExemptionCodesCodec,
   ClinicalScales, ICDCatalog).
2. **Flusso invertito**: l'app scrive PRIMA in locale (assegna id/versioni/timestamp/
   tombstone in-core, cifra in-core, committa su SQLite locale, registra audit),
   senza round-trip. La master key vive solo nel keystore OS via un protocollo
   `KeyStore` (Keychain ora; Credential Manager/DPAPI e libsecret/kwallet come
   backend documentati), RAM-only, mai persistita in chiaro, mai marshalata oltre
   alcun confine FFI/loopback.
3. **localhost declassato a stazione intermedia**: il Next.js diventa un peer di
   sync/archivio SOLO-CIPHERTEXT che riceve scritture gia validate, gia cifrate,
   gia versionate (firmate dal client paired) e le archivia as-is; serve delta
   ciphertext ad altri core per fan-out multi-dispositivo sulla LAN fidata. Non
   valida piu la clinica, non assegna identita/versioni, non e nel percorso
   critico. In installazione mono-operatore puo essere ritirato del tutto.
4. **Shell UI per-OS**: macOS tiene SwiftUI + Liquid Glass (VetroClinico)
   invariata, ripuntata dal client HTTP al core in-process. Windows/Linux, per la
   via piu rapida, riusano la UI React esistente in una WebView (WebView2 /
   WebKitGTK) servita da un bridge loopback 127.0.0.1 dentro il binario nativo,
   con backend = `MediFlowCore`, non Node. La WebView riceve SOLO view-data gia
   decifrati, mai la KEK/master key; bind loopback + token per-lancio (modello dei
   paired header odierni). Resta APERTA l'opzione di sostituire la WebView con
   shell native Fluent (Windows) e GTK4/libadwaita (Linux) in una fase successiva
   per parita di tono col design system (ADR 0059), senza precludere quella UX.

### Innesti dalle proposte Rust (disciplina)

- **Gate CI golden-vector tri-OS come PRIMA cosa** (da P2/P4): i vettori
  byte-exact prodotti dal web devono passare su toolchain Swift macOS, Windows-MSVC
  e Linux PRIMA che qualunque dato fluisca. Neutralizza il rischio numero uno
  della P3 (drift Swift-on-Windows): se fallisce, lo si scopre in settimana 2.
- **Protocollo `KeyStore` unico** e regola "la master key non attraversa MAI un
  confine" (da P4), applicata anche al bridge loopback.
- **Niente terza implementazione crypto**: vietato riscrivere in Rust un contratto
  Swift gia verificato finche `swift-crypto` compila tri-OS.

## Vincoli invariati (non negoziabili in ogni fase)

- Zero-knowledge field crypto byte-exact ([[apple-paired-crypto]], [lib/security.ts](../../lib/security.ts)):
  `ENC:base64(iv12):base64(ct+tag)`, plaintext = `JSON.stringify(value)`, master
  key AES-256-GCM wrappata `base64(iv12 || GCM(rawKey, KEK))`, KEK =
  PBKDF2-HMAC-SHA256(PIN, salt, 100000). Congelato come oracolo (vedi Fase 0).
- ENCRYPTED_FIELDS per tabella, schema SQLite (medical.db), protocollo di rete +
  protocol version, local-first, in-house-first (ADR 0070), intended-purpose
  guard (ADR 0065), wording claim zero-knowledge congelato (WUL-342/354).
- Design: Liquid Glass resta solo-Apple; Windows/Linux ottengono parita SEMANTICA
  di tono (neutral/info/positive/attention/critical), non un port di Liquid Glass.

## Roadmap a fasi (Apple-first)

- **Fase 0 (low-regret, vale sotto OGNI proposta)**: congelare i golden vector
  crypto come fixture neutra; gate CI crypto su macOS + Windows-MSVC + Linux.
- **Fase 1**: estrarre `MediFlowCore` (split di MediFlowAppleShared in core
  senza-piattaforma + MediFlowAppleUI). Nessun cambiamento di comportamento.
- **Fase 2**: SQLite locale in-core (GRDB.swift) con round-trip ciphertext
  byte-uguale al web su un medical.db reale; portare i 5 validatori di scrittura
  con test di parita 1:1 vs TS.
- **Fase 3**: ripuntare l'app macOS dal client HTTP al core in-process (autorita
  locale Apple); invertire il flusso; declassare il Next.js a ingest firmato +
  pull ciphertext.
- **Fase 4**: cross-compile + CI verde su 3 OS; bridge loopback + riuso UI React
  in WebView su Windows.
- **Fase 5**: Linux (riuso del core).
- **Fase 6 (opzionale)**: shell native Fluent/GTK per parita di tono.

## Punto di non ritorno (la scelta del linguaggio del core)

La scelta Swift-core (P3) e RACCOMANDATA, non irreversibile: e GATED dalla Fase 0.
Se il gate CI tri-OS mostra che la toolchain Swift-on-Windows non da primitive
byte-identiche o non e abbastanza matura, si vira su un core Rust (P1/P4) AVENDO
GIA in mano i golden vector e l'estrazione del core: si perde quasi nulla. I primi
passi (Fasi 0-1) sono quindi deliberatamente comuni a tutte le proposte.

## Conseguenze

- Si scrive UN core (non tre): la duplicazione odierna Swift+TS di crypto, codec,
  scale, ICD e validatori collassa in una sola sorgente, riusata su 3 OS.
- L'app diventa local-first reale: funziona offline, possiede i propri dati, non
  ha bisogno di localhost per operare.
- Il backend Next.js sopravvive come UI web legacy e come hub di archivio/replica
  LAN opzionale, fuori dal percorso critico nativo.
- Rischi dichiarati: maturita Swift-on-Windows (mitigato dal gate Fase 0);
  superficie WebView vicino al plaintext su Win/Linux (mitigato: decrittazione
  solo nel processo nativo, bind loopback, token per-lancio, documentato vs
  ADR 0065; non peggiore della web app odierna che gia gira React nel browser).
