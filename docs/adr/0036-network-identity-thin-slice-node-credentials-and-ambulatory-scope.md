# ADR 0036: thin slice identity `network` con credenziali nodo e scope ambulatoriale esplicito

Date: 2026-04-03  
Status: Proposed

## Problema

Con [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md) e
[ADR 0035](./0035-network-replica-thin-slice-snapshot-mirror.md) abbiamo reso
espliciti il ruolo del nodo paired e il modello iniziale di replica/fallback.

Manca ancora pero una risposta minima a `WUL-122`: quando un device paired si
aggancia al nodo centrale, **chi e l'operatore**, quali **credenziali** usa e
come si determina lo **scope clinico** visibile senza lasciare tutto al solo
client.

## Contesto

- Il repository ha gia una tabella `users` con `username`, `displayName`,
  `ambulatoryName`, `role`, PIN hash e chiavi cifrate locali.
- Il login locale condiviso web/macOS e gia documentato in
  [ADR 0017](./0017-auth-lockout-policy.md).
- Il walkthrough dichiara ancora `multi-user limitato (admin singolo)`, quindi
  questa slice non puo fingersi un RBAC completo.
- Lo scope pazienti oggi vive soprattutto nel contesto ambulatoriale del client
  web o nel filtro `ambulatoryId` sulle route `/api/v1/patients`.
  generici, federazione identita e derive enterprise premature.

## Opzioni

1. Lasciare pairing, credenziali e scope impliciti lato client.
2. Trattare il pairing del device come autenticazione completa anche
   dell'operatore.
3. Separare esplicitamente:
   - pairing del device come trasporto trusted
   - login dell'operatore sul nodo come identita reale
   - scope clinico minimo risolto dal nodo

## Trade-off

- Opzione 1:
  - Pro: zero lavoro aggiuntivo.
  - Contro: promette continuita cross-device senza un modello identitario reale.
- Opzione 2:
  - Pro: esperienza apparentemente piu fluida.
  - Contro: confonde trasporto e identita, indebolisce audit/scoping e apre una
    deriva verso privilegi impliciti del device.
- Opzione 3:
  - Pro: resta coerente con il local-first, riusa il modello `users` gia
    presente e mantiene audit/scoping leggibili.
  - Contro: lascia deliberatamente fuori un RBAC completo e mantiene una
    UX futura di login multi-utente ancora da rifinire.

## Decisione

Adottiamo l'opzione 3.

Decisioni operative:

- Il pairing del device **non equivale** al login dell'operatore.
- La first thin slice `network` usa ancora le **credenziali locali del nodo**
  (record `users`) come identita operativa.
- Se esiste una sessione utente valida sul nodo, il profilo `network` e
  `session-bound`.
- Se esiste solo il device pairing / bearer token locale, lo stato identitario
  resta `node-credentials-required`.
- La modalita login minima da dichiarare e:
  - `single-local-user-default` se sul nodo esiste un solo account locale
  - `explicit-username-required` se in futuro esistono piu account locali
- Lo scope clinico minimo del profilo `network` viene risolto dal nodo con
  politica:
  - `session-context-else-node-default`
  - se esiste un contesto ambulatoriale valido in sessione, quello diventa lo
    scope effettivo
  - altrimenti si usa l'ambulatorio `default` del nodo
- Questa slice non introduce:
  - RBAC per-patient
  - gerarchie di permessi complete
  - federazione identita
  - provisioning utenti distribuito

## Conseguenze

- Pairing, credenziali operatore e scope non restano piu confusi nello stesso
  concetto.
- Il nodo puo dichiarare in modo PHI-safe se serve ancora login operatore prima
  di usare davvero il data plane condiviso.
- L'ambulatorio effettivo non resta implicito o dedotto solo dal client.
- Restano esplicitamente fuori scope le regole avanzate multi-utente.

## First Thin Slice

1. Persistire questa decisione come ADR per `WUL-122`.
2. Introdurre un summary `/api/v1/network/identity` con:
   - stato credenziali operatore
   - modalita login minima
   - boundary pairing vs login
   - scope ambulatoriale effettivo/default
   - limiti espliciti della slice
3. Estendere la UI `Modalita operativa` in `Impostazioni` con il profilo rete
   locale e il relativo scope.
4. Lasciare a follow-up:
   - UX login multi-utente dedicata
   - mapping per-user di scope piu granulari
   - enforcement lato data routes oltre il summary dichiarativo

## Fuori Scope

- RBAC completo
- OIDC/SAML/LDAP
- permessi per paziente o per record
- provisioning utenti cross-device
