# ADR 0072: voice visit capture con boundary Fluid-style

Date: 2026-06-29
Status: Proposed

Related: [ARCHITECTURE.md](../../ARCHITECTURE.md),
[SECURITY.md](../../SECURITY.md),
ADR 0033 (private),
[ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md),
[ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md),
[ADR 0053](./0053-network-diary-entry-write-boundary.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md)

## Problema

MediFlow deve poter evolvere verso una visita registrabile, trascritta e poi
trasformata in bozza SOAP o resoconto clinico, mantenendo il modello locale e
review-first. Il rischio e introdurre troppo presto cattura audio, endpoint,
schema o runtime terzi dentro una pagina clinica live senza avere prima un
confine di sicurezza, licenza, UX e test.

## Contesto

FluidVoice e oggi un riferimento utile per il tipo di esperienza desiderata:
app macOS di dettatura, modelli speech locali, post-processing locale opzionale
con Fluid Intelligence / Fluid-1, supporto macOS 15.0+, permessi microfono e
accessibility. La pagina pubblica dichiara anche provider opzionali OpenAI,
Groq o custom e licenza GPLv3 per FluidVoice dal 2026-02-23 in poi.

FluidAudio e un SDK Swift separato per audio AI locale su device Apple, con
licenza Apache 2.0 dichiarata dal repository. Le licenze, i modelli scaricati e
la distribuzione binaria devono essere verificati di nuovo nel workstream
macOS prima di qualsiasi integrazione reale.

I vincoli MediFlow restano invariati:

- local-first e no cloud di default;
- nessun PHI/PII in repository, log, fixture o transcript delegate;
- ogni output AI o speech-derived e una bozza non affidabile finche il medico o
  operatore non la rivede;
- nessun auto-import da testo libero verso diagnosi, terapie, prescrizioni o
  altri campi strutturati;
- i client iPhone/iPad paired non accedono mai a SQLite e usano solo superfici
  `/api/v1/network/*` approvate.

## Opzioni

1. Integrare subito cattura audio nella webapp con `MediaRecorder`.
2. Integrare FluidVoice o Fluid Intelligence direttamente nel bundle MediFlow.
3. Formalizzare prima il boundary e rinviare UI/runtime a issue separati.

## Trade-off

- Opzione 1:
  - Pro: mostra rapidamente una UI registrabile.
  - Contro: apre permessi microfono, gestione raw audio, storage, logging e
    trasporto prima del contratto.
- Opzione 2:
  - Pro: massimizza il riuso di un prodotto gia vicino all'esperienza target.
  - Contro: introduce rischi GPLv3, runtime privati, permessi macOS e
    dipendenze terze dentro la distribuzione MediFlow.
- Opzione 3:
  - Pro: conserva il confine clinico e rende testabili le slice successive.
  - Contro: non consegna ancora registrazione reale ne UI operativa.

## Decisione

Adottiamo l'opzione 3.

Questo ADR apre solo il boundary di prodotto e architettura. In WUL-419 non si
aggiungono `MediaRecorder`, `getUserMedia`, upload audio, endpoint audio, campi
DB, migrazioni, sidecar macOS o benchmark runtime.

Decisioni operative:

- La registrazione visita e una capability futura esplicita, non presente per
  default nella pagina clinica corrente.
- Raw audio non viene persistito di default. Se una slice futura richiede
  buffer temporanei, devono restare locali, con retention breve, path esclusi
  da Git e nessuna scrittura in log.
- Trascrizione, segmenti diarizzati, prompt, bozza SOAP e bozza di resoconto
  sono PHI quando derivano da una visita reale. Non devono comparire in log,
  benchmark pubblici.
- Il primo output persistibile resta una voce diario locale rivista
  dall'operatore, salvata nel modello `entries` esistente solo dopo conferma.
- Qualsiasi provider cloud o custom resta disabilitato dal percorso PHI finche
  non esiste una decisione esplicita, opt-in, auditabile e coerente con
  ADR 0065.
- Il percorso macOS e il candidato iniziale per la cattura on-device, perche
  puo possedere microfono, permessi, modello locale e sidecar in un unico nodo
  home-base.
- La webapp puo orchestrare solo stati e revisioni dopo un contratto approvato:
  non deve trasportare raw audio sulla rete, non deve inventare storage audio e
  non deve aggirare il boundary paired `/api/v1/network/*`.
- FluidVoice GPLv3, Fluid Intelligence privata e FluidAudio Apache 2.0 sono
  superfici diverse. WUL-422 deve scegliere un'integrazione arms-length,
  preferibilmente processo separato o SDK compatibile, prima di collegare codice
  o distribuire binari.

## Conseguenze

WUL-419 resta una PR documentale. La UI web, il benchmark sintetico e il
sidecar macOS diventano slice separate con test propri.

Rischi ridotti:

- niente richiesta microfono nel browser prima del contratto;
- niente raw audio in schema, API o storage;
- niente falsa promessa UI su una pagina clinica live;
- niente incorporazione involontaria di codice GPLv3 nel bundle MediFlow.

Rischi residui:

- serve una verifica legale/licenza aggiornata prima di qualsiasi distribuzione
  che includa componenti Fluid;
- serve decidere se il futuro runtime usa FluidAudio SDK, processo separato
  Fluid-style o browser-local model;
- serve definire metriche benchmark sintetiche per italiano clinico prima di
  promuovere un modello.

## First Thin Slice

1. WUL-419: mantenere questo ADR e verificare che non ci siano cambi runtime,
   schema, API o UI.
2. WUL-420: progettare la UI web di visita registrabile solo come sessione
   review-first, flag-gated, senza audio reale finche il contratto non esiste.
3. WUL-421: creare corpus e benchmark solo sintetici, con trascrizioni italiane
   artificiali, metriche su SOAP/draft e controlli di assenza PHI.
4. WUL-422: valutare macOS home-base, permessi microfono/accessibility,
   processo sidecar o SDK, licenze e contratto di ritorno transcript senza raw
   audio fuori dal nodo.

## Verifica

Per WUL-419:

- `npm run check:claims`
- `npm run typecheck`
- `rg -n "MediaRecorder|getUserMedia|audio|transcript|Fluid" app lib scripts`
- `git diff --name-only main..HEAD`

Per le slice successive:

- WUL-420 deve aggiungere test UI mirati e guardie che provino assenza di
  `MediaRecorder`, upload audio e logging transcript nel default.
- WUL-421 deve avere fixture sintetiche e test che falliscono su placeholder,
  nomi reali o dati clinici importati.
- WUL-422 deve provare permessi macOS, processo/SDK scelto, licenze e confine
  IPC prima di qualsiasi persistenza clinica.

## Fonti esterne verificate

- https://altic.dev/fluid
- https://github.com/altic-dev/FluidVoice
- https://github.com/FluidInference/FluidAudio
