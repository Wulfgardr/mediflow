# ADR 0017: Policy lockout autenticazione web e macOS

Date: 2026-03-17
Status: Accepted

## Problema

MediFlow accetta autenticazione locale sia dal client web sia dal client macOS,
ma oggi non applica una policy lockout unificata contro tentativi falliti
ripetuti. Questo lascia la superficie auth senza una regola canonica su:

- soglia di tentativi falliti
- finestra temporale di conteggio
- durata del blocco temporaneo
- codici risposta e messaggi coerenti tra i client

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` richiedono controlli locali semplici,
  espliciti e PHI-safe.
- Il modello attuale usa un solo utente locale operativo (`admin`) sia su web
  sia su macOS, quindi il lockout puo vivere sul record utente senza introdurre
  infrastruttura esterna.

## Opzioni

1. Nessun lockout; solo messaggio generico su PIN errato.
2. Rate-limit per request senza stato persistito sull'utente.
3. Lockout persistito sul record utente con soglia, finestra e durata canoniche.

## Trade-off

- Opzione 1:
  - Pro: zero complessita aggiuntiva.
  - Contro: nessuna difesa base contro brute force locali o tentativi ripetuti.
- Opzione 2:
  - Pro: meno campi su database.
  - Contro: piu fragile su restart/processi e meno leggibile per i client.
- Opzione 3:
  - Pro: regola semplice, stabile e condivisa tra web e macOS.
  - Contro: richiede metadati auth aggiuntivi e reset esplicito su login valido.

## Decisione

Adottiamo l'opzione 3.

Policy canonica:

- massimo `5` tentativi falliti
- finestra di conteggio `15 minuti`
- lockout temporaneo `15 minuti`
- reset stato lockout su login valido
- reset conteggio se la finestra precedente e scaduta
- un account gia lockato resta bloccato fino a scadenza anche se il PIN
  successivo sarebbe corretto

## Contratto operativo

Server:

- `401` per credenziali non valide senza lockout attivo
- `423` per account temporaneamente lockato
- payload JSON con `code`, `message`, `remainingAttempts` e, quando rilevante,
  `lockedUntil` + `retryAfterSeconds`
- header `Retry-After` su risposta `423`

Client:

- web e macOS devono mostrare il messaggio server-side senza ricadere su un
  generico `PIN non valido`
- i client non implementano una loro policy separata; applicano quella del
  backend condiviso

Logging:

- consentito: username tecnico, remaining attempts, lockout expiry, outcome
- vietato: PIN, hash, salt, token o dettagli clinici

## Conseguenze

- Positivo: controllo base uniforme e documentato su entrambe le superfici.
- Positivo: error handling piu leggibile per operatore e debugging.
- Negativo: il lockout vive sul singolo utente locale e non copre futuri casi
  multi-utente avanzati, che restano fuori scope in questa fase.

## First Thin Slice

1. Aggiungere i campi lockout al record `users`.
2. Applicare la policy nel route `POST /api/auth/login`.
3. Propagare messaggi/codici coerenti a web e macOS.
4. Coprire soglia, finestra, durata e codici risposta con test mirati.
