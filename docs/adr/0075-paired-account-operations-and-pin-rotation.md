<!-- @Codex -->
# ADR 0075: operazioni account paired e rotazione PIN

Date: 2026-07-10
Status: Accepted

## Problema

Il client Apple paired aveva gia un login condiviso con il web, ma non una
postura documentata per cambio PIN, aggiornamento profilo e relative
esclusioni. Replicare queste operazioni sotto `/api/v1/network` avrebbe creato
una seconda famiglia di route e una superficie di scrittura credenziali non
necessaria.

## Contesto

Il login paired usa gia `/api/auth/login` e il cookie di sessione operatore.
La rotazione PIN richiede la master key gia sbloccata sul client, mentre il
server riceve solo il bundle aggiornato. ADR 0026 definisce il re-wrap
client-side della stessa master key senza ricifrare i dati clinici.

## Opzioni

1. Replicare cambio PIN e profilo sotto `/api/v1/network` con capability
   dedicate.
2. Riutilizzare la famiglia `/api/auth/*` gia condivisa con il web e la
   sessione operatore.
3. Esporre reset e re-wrap lazy anche al client paired.

## Trade-off

- Opzione 1: rende uniforme il prefisso network, ma duplica auth e introduce
  nuove capability senza una necessita di scope network.
- Opzione 2: riusa autenticazione e sessione gia presenti, senza una route
  network replicata.
- Opzione 3: amplia le scritture credenziali del client paired. Il reset e
  cripto-distruttivo; il re-wrap lazy e gia un comportamento del web.

## Decisione

Adottiamo l'opzione 2 e rifiutiamo l'opzione 3.

- Le operazioni account dal client paired usano `/api/auth/*` con il cookie di
  sessione operatore. Login, cambio PIN e profilo restano nella stessa famiglia
  condivisa con il web; non viene introdotta una route network replicata.
- La rotazione PIN fa il re-wrap sul client di origine. Con la master key gia
  in memoria, il client genera un salt nuovo di 16 byte e usa KDF versionata
  v2 per produrre `encryptedMasterKey`; la master key non viene inviata in
  chiaro al server. Il server verifica il PIN corrente e persiste il bundle
  aggiornato con un UPDATE condizionale su `id` e `passwordHash` precedente.
  Se la race rende l'UPDATE non applicabile, restituisce `409`.
- Il reset resta escluso dal client nativo. Cancella utenti e quindi i relativi
  `encrypted_master_key` e `salt`, lasciando cifrati i dati ENC, ed e una
  superficie host/web-admin.
- Il re-wrap lazy v1 verso v2 resta solo lato web. Il client paired legge blob
  versionati ma non esegue un re-wrap silenzioso.

## Conseguenze

Il client paired puo chiudere cambio PIN e profilo usando il contratto auth
esistente. Il cambio PIN non cambia la master key e non richiede una
ricifratura dei dati clinici. La protezione dalla race e il confronto
condizionale lato server, non una capability network o una colonna `version`
su `users`.

## First Thin Slice

1. Usare il login auth condiviso e la sessione operatore nel client paired.
2. Applicare il re-wrap client-of-origin con KDF v2 e salt ruotato.
3. Verificare la race change-pin con uno smoke che osserva un solo vincitore e
   un `409`.
4. Mantenere reset e re-wrap lazy fuori dalla superficie nativa.

## Riferimenti

- [ADR 0026](./0026-pin-rotation-via-client-side-rewrap.md)
- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
