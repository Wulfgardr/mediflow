# ADR 0048: architettura shared Apple client e runtime `home-base` packaged

Date: 2026-04-17
Status: Accepted

## Problema

MediFlow ha gia una direzione chiara:

- il Mac e il `home-base` autorevole
- il backend locale e la sorgente unica di business logic e dati
- `local-only` resta il default
- i client paired non devono aggirare i boundary auth/security gia fissati

Manca pero una decisione madre su come portare questa direzione a una famiglia
Apple completa:

- nuova app macOS eseguibile e packaged, capace di avviare tutto cio che serve
  senza dipendere dal terminale
- app iPhone/iPad paired che possano consultare e usare il sistema in modo
  pieno per le feature non-AI
- convergenza strutturale tale per cui le future feature condivise non creino
  fork tra web, macOS e mobile

Senza questa decisione, il rischio e aprire tre derive pericolose:

1. far parlare i client mobili direttamente con SQLite o con token locali nati
   per il loopback
2. duplicare logica clinica e sicurezza in shell Apple separate
3. cercare una UI universale invece di una family architecture con core
   condiviso e shell distinte

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) fissa SQLite locale + `/api/v1/*`
  come contratto stabile e vieta cloud/server-first di default.
- [SECURITY.md](../../SECURITY.md) separa chiaramente:
  - `/api/v1/*` locale con token tecnico
  - `/api/v1/network/*` paired/read-only-first
  - primo write paziente limitato disciplinato da
    [ADR 0052](./0052-network-patient-profile-write-boundary.md)
  - child CRUD remoto, delete, sync record-level e fallback automatico ancora fuori scope
- [docs/NATIVE.md](../NATIVE.md) dichiara congelata la shell macOS storica e
  la colloca in rebuild controllato.
- [ADR 0005](./0005-web-native-functional-parity.md) impone la parity tramite
  contratto condiviso, non tramite accessi diretti al DB.
- [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md)
  dichiara `network home-base` come modalita esplicita, paired e non
  server-first.
- ADR 0037 (private)
  separa l'AI plane dal data plane clinico.
- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md) vieta di
  promuovere `local-api-token` a credenziale remota generale e impone pairing
  device + sessione operatore sul data plane `network`.
  prossimo ciclo concreto `home-base` + rebuild native.

## Opzioni

1. Estendere la shell macOS storica e aggiungere client iPhone/iPad con
   scorciatoie dirette al DB o un tunnel generico verso le route locali.
2. Costruire una UI Apple quasi unica, massimizzando la condivisione delle view
   e lasciando differenze solo dove obbligate.
3. Rebuild Apple family con:
   - core Swift condiviso
   - shell distinte per macOS, iPhone e iPad
   - Mac packaged come `home-base` runtime autorevole
   - client mobili paired che usano solo superfici API dedicate e cache
     derivate, mai SQLite diretto

## Trade-off

- Opzione 1:
  - Pro: puo sembrare la piu rapida nel breve.
  - Contro: viola i boundary di sicurezza gia scritti, prolunga la vita della
    shell congelata e rende probabile un fork logico tra local API e mobile.
- Opzione 2:
  - Pro: massimizza il riuso UI apparente.
  - Contro: contraddice i principi Apple/HIG e il vincolo repo "macOS !=
    iOS/iPadOS"; rischia una falsa parity visiva invece di una parity
    comportamentale.
- Opzione 3:
  - Pro: preserva un'unica business authority, rende la parity strutturale,
    consente shell davvero native e tiene separati data plane, AI plane e
    runtime host.
  - Contro: richiede piu disciplina iniziale su package graph, networking,
    cache e coordination macOS.

## Decisione

Adottiamo l'opzione 3.

Decisioni operative:

- Il database autorevole resta **uno solo**: il file SQLite locale sul Mac
  `home-base`.
- iPhone e iPad **non** accedono mai direttamente a SQLite, al file system del
  Mac o al `local-api-token`.
- La family Apple viene ricostruita come:
  - **shared core Swift** per DTO, client API, auth state, pairing/discovery,
    cache/reconciliation state, capability gating e utilita di sicurezza
  - **platform shell** distinte per macOS, iPhone e iPad, con navigazione e UI
    native specifiche della piattaforma
- La parity non si ottiene con una UI unica, ma con un **contratto condiviso**:
  - `/api/v1/*` resta la superficie canonica locale/shared
  - `/api/v1/network/*` diventa la superficie paired per i client mobili,
    estesa modulo-per-modulo fino alla parity non-AI
- Ogni nuova feature condivisa deve nascere in un contratto/back-end riusabile
  da web e Apple:
  - niente backend Apple-only
  - niente storage clinico Apple-only
  - niente fork di business logic per mobile
- La macOS app nuova diventa il **runtime host packaged**:
  - avvia e sorveglia backend locale, endpoint TLS, Ollama e componenti Docker
    necessari al prodotto
  - espone stato/health in UI
  - elimina il requisito operativo di lanciare MediFlow dal terminale
- Per i client iPhone/iPad, "remoto" in questo workstream significa:
  - pairing esplicito verso un `home-base` trusted
  - trasporto locale/proximity su rete fidata
  - non accesso internet generale o cloud sync
- La parity target della wave Apple e:
  - **macOS**: parity piena con il prodotto, inclusa l'coordinamento AI locale
  - **iPhone/iPad**: parity funzionale **non-AI** modulo-per-modulo, con cache
    locale cifrata e riconciliazione esplicita
- L'AI plane resta separato:
  - l'esecuzione AI locale e coordinata dal Mac `home-base`
  - questa ADR non promuove ancora comandi AI remoti su mobile
  - eventuale consultazione di output gia persistiti non cambia questo boundary

## Cache derivata read-only: precisazione 0.8.6 (WUL-676, 2026-09-06)

La cache Apple non e una replica snapshot/mirror di ADR 0035. Il precedente
limite alla sola lista era il perimetro implementato, non un divieto di
consultare un profilo derivato. Questa slice consente lista e **ultimo profilo
paziente letto online**, alle seguenti condizioni:

- Storage locale AES-GCM con la chiave Portachiavi esistente. Il payload resta
  cifrato integralmente; i campi clinici conservano inoltre il formato ricevuto
  dall'host e vengono aperti con la master key solo in memoria.
- Provenienza esatta: URL HTTPS, pin TLS, device paired, digest del token,
  operatore autenticato, digest della sessione e scope ambulatoriale. Token,
  cookie, PIN operatore e master key non sono persistiti nella cache.
- La consultazione richiede la stessa sessione gia autenticata e sbloccata in
  memoria. Nessun login offline, ripristino prima del login o nuova autorita
  mobile; gli snapshot v1 privi di questa provenienza non sono riutilizzabili.
- Il fallback riguarda esclusivamente indisponibilita o timeout di rete.
  Errori HTTP (inclusi 401/403), trust TLS e risposte non conformi non
  autorizzano il fallback. Lock, cambio operatore/sessione, pairing, pin o scope
  rimuovono la presentazione derivata; una lettura negata la invalida.
- Il TTL massimo resta 24 ore dalla lettura, separato per lista e profilo.
  Alla scadenza, o se l'orologio precede l'acquisizione, non si espongono righe
  o campi paziente. Restano metadata cifrati e non identificativi: acquisizione,
  scadenza, conteggio dell'ultima lista e motivo di inutilizzabilita. Il timer
  e il ritorno in foreground rivalutano la scadenza; un refresh della lista
  non prolunga il TTL del profilo.
- Il profilo e ammesso solo se appartiene alla lista fresca nello stesso
  contesto, con identita/versione/aggiornamento coincidenti. Un refresh che
  rimuove, cancella o cambia il paziente invalida il profilo conservato.
- Il profilo contiene anagrafica e campi manuali; esclude `aiSummary`,
  `documentInsights`, diario, terapie, controlli, osservazioni, prescrizioni,
  allegati e artifact. La UI dedicata dichiara questi limiti e non presenta
  collezioni non acquisite come collezioni vuote. Non abilita editor o export.

Restano esclusi write queue, write offline (anche per ADR 0056), sync,
riconciliazione automatica, accesso SQLite, nuovi endpoint e nuovi grant.
La revoca remota non puo essere verificata durante un'interruzione di rete:
la cache resta una lettura storica entro il TTL, mai prova di autorita corrente.
Questa precisazione non attesta parity completa ne verifica UI/device.

## Conseguenze

Positivo:

- il Mac torna a essere il solo nodo autorevole senza scorciatoie sul DB
- ogni feature condivisa puo essere resa disponibile su web e Apple senza
  moltiplicare le logiche
- la parity futura diventa verificabile su capability matrix e smoke
  cross-platform, non su promesse generiche
- la UX Apple puo restare davvero nativa pur condividendo contratti e core

Negativo:

- il primo avanzamento non e "fare subito tutte le schermate", ma fissare
  package graph, transport boundary e host runtime
- il write remoto mobile richiede un'estensione disciplinata di
  `/api/v1/network/*`, non un tunnel generico
- la cache mobile deve essere trattata come derivata e non come seconda source
  of truth

## First Thin Slice

1. `WUL-188`: persistire questa ADR e riallineare
   [docs/README.md](../README.md) e [docs/markdown-index.md](../markdown-index.md).
2. `WUL-191`: introdurre il package graph Apple condiviso e i target shell
   distinti per macOS, iPhone e iPad senza ancora estendere il vecchio shell.
3. `WUL-189`: harden del trasporto `home-base` su LAN fidata
   (discovery/pairing/HTTPS) senza riusare il `local-api-token`.
4. Estendere `/api/v1/network/*` con i primi write path paired
   reviewable. La prima slice e `PUT /api/v1/network/patients/{id}` secondo
   [ADR 0052](./0052-network-patient-profile-write-boundary.md), mantenendo la
   stessa semantica di conflitto e audit delle route core.
5. `WUL-192`: rendere la app macOS packaged il bootstrapper nativo del runtime
   locale e dei servizi necessari.
6. `WUL-193` e `WUL-194`: attivare i shell iPhone/iPad con cache locale
   cifrata, stati `paired-online` / `paired-offline-degraded` e nuova parity
   matrix Apple-wide.

## Fuori Scope

- accesso diretto a SQLite da iPhone/iPad
- sync internet/cloud o reachability fuori da device fidati
- una UI unica cross-platform che azzeri le differenze tra macOS, iPhone e iPad
- promozione implicita dell'AI plane remoto dentro il data plane clinico
- estensione del vecchio shell macOS come base della nuova delivery
