# ADR 0026: Rotazione PIN via re-wrap client-side della master key

Date: 2026-03-18
Status: Accepted

---

## Problema

MediFlow autentica l'utente locale con un PIN che protegge una master key
simmetrica usata per i campi clinici cifrati. Prima di questa slice non esisteva
un flusso esplicito per cambiare il PIN senza degradare la postura zero-knowledge
o forzare una ricifratura massiva dei dati clinici.

Serve un cambio PIN che:

- non invii mai la master key in chiaro al server
- non richieda di ricifrare tutti i record clinici
- mantenga invariato il contratto di login/unlock esistente

## Contesto

- [SECURITY.md](../../SECURITY.md) richiede local-first, assenza di egress non
  documentata e protezione dei dati clinici.
- [docs/adr/0017-auth-lockout-policy.md](./0017-auth-lockout-policy.md) ha gia
  formalizzato il comportamento auth e lockout lato server.
- [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./0024-web-core-stabilization-before-next-version-bump.md)
  ha ridotto il peso di `SecurityProvider`, quindi la slice deve agganciarsi al
  nuovo shell auth senza riaprire il branch stacked storico.

## Opzioni

1. Ricifrare tutti i dati clinici con una nuova master key quando cambia il PIN.
2. Inviare al server la master key in chiaro e fargli rigenerare `salt` +
   `encryptedMasterKey`.
3. Fare client-side re-wrap della stessa master key con un nuovo KEK derivato dal
   nuovo PIN, inviando al server solo `encryptedMasterKey` + `salt` aggiornati.

## Trade-off

### Opzione 1

- Pro: modello semplice da spiegare.
- Contro: costosa, fragile, invasiva su tutto il dataset e fuori scala per una
  thin slice di sicurezza.

### Opzione 2

- Pro: implementazione server apparentemente piu lineare.
- Contro: rompe il vincolo zero-knowledge perche la master key lascerebbe il
  boundary client.

### Opzione 3

- Pro: mantiene il server cieco rispetto alla master key, evita ricifratura
  bulk, resta coerente con il contratto auth esistente.
- Contro: richiede che il client abbia una sessione valida e la master key
  disponibile in memoria al momento della rotazione.

## Decisione

Adottiamo l'opzione 3.

Il client:

1. valida `currentPin` e `newPin`
2. usa la master key gia sbloccata in sessione
3. deriva un nuovo KEK dal nuovo PIN
4. fa il re-wrap della stessa master key
5. invia al server solo `encryptedMasterKey` + `salt` aggiornati

Il server:

- verifica il PIN corrente con `bcrypt`
- aggiorna `passwordHash`, `encryptedMasterKey` e `salt`
- resetta lockout counters residui
- scrive audit `settings.updated` PHI-safe

## Prima thin slice

- helper puro `lib/pin-change.ts` con validazione input, re-wrap bundle e mapping
  errori
- test isolato del helper
- route `POST /api/auth/change-pin`
- wiring minimo nel client auth shell (`SecurityProvider` + `client-auth-api`)
- card "Sicurezza" in `/settings`

## Fuori scope

- policy enterprise sul formato del PIN oltre al range gia deciso
- revoca forzata di tutte le sessioni/device
- ricifratura completa del dataset
- parity macOS/iOS: freeze sciolto da [ADR 0075](./0075-paired-account-operations-and-pin-rotation.md)
  e dalla Wave 4 del client universale Apple; restano validi i confini e le
  esclusioni definiti da ADR 0075
