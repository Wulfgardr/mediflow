---
summary: "Canonical parity contract for localhost and Apple clients, with feature and interaction evidence kept separate."
read_when:
  - "Planning or reviewing macOS, iPhone, or iPad parity work."
  - "Checking feature parity separately from interaction and assistive-technology evidence."
---

# Matrice parity localhost ↔ client Apple

Stato documento: `CANONICAL`
Ultimo aggiornamento: 2026-08-07 (`MediFlow 0.8.1`, allineamento IA impostazioni)

## Gate MediFlow 0.8

La base congelata del packet parity è
`2355a46a4dde63b1956a2298d99ef0b5c4208222`, tree
`c46d739b026e509a3e1fae2348372a420c9a17aa`. Il commit finale della candidata è
registrato nel run record dopo la verifica post-commit.

Il contratto funzionale resta `PARTIAL`: 13 capability sono parziali e 23 sono
intenzionalmente host-only. Questo non impedisce la candidata sorgente 0.8.

Il gate UI è chiuso con una deroga esterna documentata: i test automatici,
macOS e localhost sono terminali; VoiceOver reale su iPhone e iPad non è
provato perché l'API pubblica della beta Xcode 27 non raggiunge uno stato
terminale nel simulatore. La deroga non trasforma questa prova in PASS e non
autorizza claim App Store o di conformità.

Lume è il linguaggio comune. Liquid Glass è una declinazione nativa Apple e non
viene copiata come identità CSS. La parity riguarda capacità, semantica,
gerarchia, stati, sicurezza e riconoscibilità. Navigazione, densità, controlli e
input restano specifici della piattaforma.

Una differenza documentata di piattaforma non è un gap. Lo è una funzione
necessaria che manca nel perimetro dichiarato.

## Perimetro

Questa matrice confronta:

- **localhost**: la web app locale sul Mac, superficie clinica di riferimento;
- **macOS**: il bundle Apple/home-base con shell clinica condivisa;
- **iPhone/iPad**: client paired sul boundary `/api/v1/network/*`.

La fonte machine-readable è
[docs/apple-parity-matrix.json](./apple-parity-matrix.json). Il manifest
[docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json) verifica invece
24 acceptance record tecnici e i contratti di rete: una capability QA
`covered` non equivale automaticamente a feature parity completa.

Riferimenti architetturali:

- [ADR 0005](./adr/0005-web-native-functional-parity.md)
- [ADR 0008](./adr/0008-web-first-with-parity-sweeps.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0076](./adr/0076-paired-document-domain-write-policy.md)

## Due assi distinti

La feature parity e la interaction parity sono indipendenti.

| Asse | Domanda | Limite |
| --- | --- | --- |
| Feature parity | La capability è disponibile nel perimetro dichiarato? | Non prova l'uso reale dei controlli. |
| Interaction parity | Un operatore completa il workflow con gli input della piattaforma? | Non prova una tecnologia assistiva non esercitata. |

Gli stati di prova sono:

- `verified-automatic`: test o audit terminale sul candidato;
- `verified-real-interaction`: interazione reale su bundle o browser di produzione;
- `partial`: funzione o prova ancora incompleta;
- `blocked`: prova richiesta non eseguibile nel contesto corrente;
- `platform-specific-documented`: adattamento intenzionale e documentato;
- `out-of-scope`: capability esclusa dal perimetro dichiarato.

VoiceOver attivo su macOS prova solo la sessione macOS eseguita. Gli audit
XCTest non dimostrano VoiceOver reale su iPhone o iPad.

## Fotografia corrente

| Classe | Righe | Significato |
| --- | ---: | --- |
| `full-parity` | 30 | Il workflow equivalente è disponibile sulle superfici target previste. |
| `partial` | 13 | Esiste una superficie utile, ma manca equivalenza di funzione, campo, flessibilità o verifica manuale. |
| `missing-both` | 0 | Nessuna capability resta priva sia di boundary sia di UI senza una decisione esplicita. |
| `host-only` | 23 | La funzione resta sul Mac/localhost per autorità, filesystem, runtime AI o policy. |
| **Totale** | **66** | Capability censite. |

Escludendo le 23 righe intenzionalmente host-only, 30 capability su 43 sono
`full-parity` (**70%**); 13 su 43 restano parziali (**30%**). Sul totale
grezzo, le righe full sono 30/66 (**45%**).

Questi numeri descrivono il contratto funzionale 30/13/23. Non sono il
conteggio delle prove correnti e non autorizzano il claim “parity completa”.

La chiave `reconciliation` del JSON collega il contratto alle prove 0.8.
Il manifest Apple-wide verifica 24 acceptance record tecnici separati.

## Evidenza registrata

Le prove Apple basate su Xcode nella tabella seguente appartengono alla baseline
storica `0843726fe`. Restano valide soltanto per quel tree e non costituiscono
evidenza exact-tree del candidato `0.8.5`, sul quale il volume Xcode non è
montato.

| Classe | Superficie | Prova | Stato |
| --- | --- | --- | --- |
| `verified-automatic` | Web | Evidence Stack 2/2 con PIN sintetico `0000`; build 104 pagine e standalone | PASS |
| `verified-real-interaction` | Web | Chromium produzione a 320/390/768/1440 e zoom esatto 200%/400%; focus visibile e nessun overflow orizzontale | PASS |
| `verified-automatic` | iPhone | XCUITest 2/2, tab identifier atomici e apertura delle sei superfici | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-automatic` | iPad | XCUITest 7/7, list-detail, AX5, rotazione, geometria e audit AX | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-real-interaction` | macOS | Build Xcode 27, click-map, focus, Cmd-R contestuale, resize e VoiceOver manuale | PASS storico su `0843726fe` |
| `verified-automatic` | macOS probe | `typecheck` e 6/6 test del probe AX corretto e process-safe | PASS storico su `0843726fe` |
| `accepted-external-limitation` | iPhone/iPad | VoiceOver reale | Non provato; Xcode 27 beta, issue Apple `173507341` |

## Stato per area

| Area | Stato | Cosa è già disponibile | Residuo reale |
| --- | --- | --- | --- |
| Pazienti | `PARTIAL` | lista, ricerca, dettaglio, create/update, archivio, cestino e ripristino | operazioni bulk non esposte |
| Diario | `PARTIAL` | CRUD versionato, restore, filtri, S/O/A/P, rich text, allegati e bozza visita deterministica | equivalenza completa allegati/editor |
| Terapie | `PARTIAL` | CRUD, stato, AIC/ATC/principio attivo, autocomplete AIFA e fallback manuale | collegamento diagnosi e flessibilità del form da verificare |
| Checkup | `PARTIAL` | CRUD, status/source, conflitti versione | equivalenza campi e flussi |
| Osservazioni | `PARTIAL` | CRUD LOINC/UCUM e trend | equivalenza visuale e flessibilità |
| Cataloghi AIFA/esenzioni | `FULL` per lookup | ricerca AIFA ed esenzioni dal boundary paired | import/clear repertori resta host-only |
| Prestazioni e protesica | `FULL` nel perimetro paired | read/write versionati e UI nativa | nessun invio regionale o generazione NRE |
| Export FHIR/FSE pre-check | `FULL` nel perimetro locale | bundle on-device e validazione boundary | nessun writeback FSE |
| SISS / PRREG | `HOST-ONLY` per integrazione, utilità PRREG parziale | web con pannello/diario; Apple copia il CF e apre la dashboard PRREG dal paziente | FSE, stato sessione, diario handoff e canale regionale restano sul Mac o fuori scope |
| Viste globali | `MIXED` | agenda, diario globale, analytics e interazione macOS reale | shell/deep-link e cockpit sintetico restano partial |
| Documenti | `PARTIAL` e policy-limited | upload cifrato, archivio, insight, follow-up, allegati e stati web verificati | OCR e curation restano host per ADR 0076; questa divisione intenzionale non è equivalenza mancante |
| Offline mobile | `PARTIAL` | cache cifrata derivata e stato degradato read-only | TTL/freschezza visibili e riconciliazione onesta (`WUL-403`) |
| AI generativa, Fabric e governance | `HOST-ONLY` | stato runtime/kill switch leggibile; registro Fabric read-only (16 capability, 4 venue, profili egress) e parliament/readiness del nodo host | ADR 0076 esclude l'invocazione AI paired; il registro e la governance descrivono il calcolo della macchina host, quindi non sono gap del client Apple |
| Backup, diagnostica, repertori, update | `HOST-ONLY` | gestiti dal nodo Mac autorevole | non sono gap di parity client |

## Wave completate

1. **Wave 1 — core mobile**: diario, rich text, scale, terapie, report e cockpit.
2. **Wave 2 — boundary paired**: lifecycle paziente, cataloghi, prestazioni,
   protesica, FHIR, terminologie, discovery e revision guard.
3. **Wave 3 — viste globali**: agenda, diario globale, analytics e shell clinica.
4. **Wave 4 — settings e chiavi**: ambulatori, profilo, aspetto, privacy,
   session lock e cambio PIN.
5. **Wave 5 — documenti e superfici AI-adiacenti**: allegati manuali, archivio,
   rich text, bozza visita deterministica, insight/follow-up read-only e stato AI.
   Consegnata con [PR #16](https://github.com/Wulfgardr/mediflow/pull/16) e
   follow-up [PR #17](https://github.com/Wulfgardr/mediflow/pull/17).

Wave 5 è una tranche consegnata, non la chiusura della parity complessiva.

## Wave 6 / closeout residuo

### W6-A — convergenza UI macOS e click-map P6

Il codice clipping e il probe AX corretto sono integrati. Le prove Xcode sul
commit storico `0843726fe` restano valide soltanto per quel tree. Sul candidato
exact-tree il volume Xcode non è disponibile, `xcode-select` punta a
CommandLineTools e `xcodebuild` non è utilizzabile. W6-A non ha quindi una
nuova prova nativa sullo SHA corrente.

### W6-B — offline degradato onesto

Owner: `WUL-403`.

Rende visibili età/TTL della cache, stato stale, read-only e assenza di write
queue. Non introduce sync multi-master né scritture offline.

La candidata `WUL-556` aggiunge su iPhone e iPad un pannello nativo per gli
stati `loading`, `error`, `online`, `cache`, `offline read-only` e
`session-expired`. La preview e i test sintetici coprono anche la resa
`stale`. Il runtime continua però a scartare lo snapshot oltre il TTL di 24
ore: finché il contratto cache/headless non espone metadata separati, lo stato
stale live resta `partial`, non `complete`.

Per decisione owner, Carta resta una grammatica del contenuto e non introduce
una palette calda. Le superfici della slice usano canvas e field neutrali
adattivi; i soli colori non neutrali sono segnali funzionali di stato.

Il gate di consumo `WUL-557` è aperto sul manifest canonico
`packages/mini/contracts/mini-parity.json`. I head PR #184
`3fd988bafe71a058fdd7d3c25ea569793dcba903` e PR #190
`1e35733c0218eae67a1d6e158085aab7340bc26b` espongono lo stesso contenuto
(SHA-256 `8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9`).
La metrica Mini è 4/66 (`6.060606%`): 4 `available`, 61 `manual_only`, 1
`proposal_only` e 0 `unavailable`. Le ragioni non vengono appiattite: 23 righe
sono `HOST_AUTHORITY_ONLY`, 38 `NOT_IN_MINI_PILOT` e 1
`SYNTHETIC_PREVIEW_ONLY`.

| Riga web canonica | Contratto Mini esatto | Stato iPhone/iPadOS | Motivo residuo o confine |
| --- | --- | --- | --- |
| 1 — anagrafica paziente | `available`: `patient search`, `patient show` | `partial` | Mini copre ricerca/dettaglio; la riga Apple resta più ampia e mancano assign/unassign/move/duplicate |
| 39 — blocco/stato sessione | `available`: `whoami` | `full-parity` nella matrice Apple; stati visuali coperti dalla slice | `whoami`, pairing o token locale non sono un grant agentico |
| 45 — cache offline | `manual_only`: `NOT_IN_MINI_PILOT` | `partial` | Lista cifrata read-only; metadata stale live, dettaglio offline e write queue assenti |
| 63 — discovery capability | `available`: `capabilities` | `full-parity` per consumo API | Il manifest descrive capability; non autorizza operazioni cliniche |

`open-loops` (riga 11) è la quarta riga Mini `available`, ma non appartiene alla
slice `WUL-556`. `draft preview` (riga 4) resta `proposal_only` con ragione
`SYNTHETIC_PREVIEW_ONLY`. Le altre righe conservano la disposizione e la ragione
del manifest; le 23 `HOST_AUTHORITY_ONLY` restano host-only nella matrice Apple.

| Superficie mobile | Stato candidata | Evidenza | Dipendenza host/headless |
| --- | --- | --- | --- |
| iPhone | `partial` | Test di presentazione, XCUITest e screenshot sintetico | Nessun grant nuovo; usa solo stato paired esistente |
| iPadOS | `partial` | Stesso contratto, layout adattivo, `⌘R`, pointer, XCUITest e screenshot sintetico | Metadata TTL/stale live non esposti |
| Capability AIP/Mini | Gap Apple e disposizione Mini restano assi separati | Manifest WUL-557: 4/66 disponibili | Le ragioni `partial`, host-only e `manual_only` restano esplicite; manifest e receipt non diventano autorità client; verifica manager e `WUL-564` bloccano la promozione |

### W6-C — decisione sul workflow documentale nativo

Dipendenze: `WUL-417` (OCR Apple on-device), `WUL-383` (degradazione OCR) e
`WUL-409` (Smart Import review-first).

Lo stack web popolato, la curation e gli stati loading/empty/error hanno prova
E2E 2/2. I client Apple leggono insight e caricano documenti manuali.

OCR, curation e scritture document-derived restano sul nodo host per ADR 0076.
Questa divisione è `platform-specific-documented`, non un gap implicito.

### Fuori Wave 6

- chat/generazione AI paired;
- gestione modelli, registro Fabric, governance/rollout, backup, diagnostica e import repertori dal client;
- hard delete remoto;
- writeback SISS/FSE;
- coda di scrittura offline o sync multi-master;
- parity applicativa Windows/Linux.

Il catalogo AIFA nativo non è un residuo: autocomplete, AIC/ATC e fallback
manuale sono già presenti; `WUL-476` è assorbita dallo stato corrente.

## Control-to-action map

La mappa registra i controlli esercitati nel closeout.

| Superficie | Controllo | Identificatore | Azione | Evidenza |
| --- | --- | --- | --- | --- |
| Web | Agenda | nome AX `Agenda` | Cambia area cockpit | Chrome produzione |
| Web | Pazienti | nome AX `Pazienti N` | Carica worklist | Chrome produzione |
| Web | Diario | `lume-diario` | Carica feed globale | Chrome produzione |
| Web | Scheda | `lume-scheda-header` | Carica paziente e aggregati | E2E candidato locale D1/D2 — SHA esatti |
| Web | Evidence Stack | tile documento | Mostra stati e avvia curation | E2E 2/2 |
| Apple | Sezione clinica | `clinical-workspace-section-*-button` | Seleziona area | Audit automatico |
| Apple | Lista pazienti | `patients-selection-list` | Seleziona dettaglio | Audit automatico |
| macOS | Agenda sidebar | `clinical-workspace-section-agenda-button` | Seleziona riga `List` | Click-map e probe AX PASS |
| macOS | Riga paziente | `patient-cell-*` | Seleziona e carica dettaglio | Click-map e probe AX PASS |
| macOS | Focus | focus system | Avanza con `Tab` e freccia | Interazione reale PASS |
| macOS | Inspector paziente | `clinical-workspace-inspector-toggle` | Toolbar o `⌥⌘I` mostra/nasconde il contesto della finestra focalizzata | WUL-566/WUL-567: test focalizzati, 2 finestre simultanee osservate nello stesso PID, suite nativa, build Xcode e screenshot light/dark PASS; focus, resize e VoiceOver interattivi della slice `PARTIAL` per sessione bloccata. Il manifest Mini PR #184 mantiene `sourceRow: 32` a `manual_only`, senza comandi Mini. |

### AXPress

Il probe non preme più il testo statico interno alla riga SwiftUI. Seleziona la
riga nativa e verifica `AXSelectedRows`. Il vecchio finding `AXPress` è
`corrected`, non un blocker corrente.

## Gate di uscita

Una capability può diventare `full-parity` solo con:

1. funzioni equivalenti nel perimetro dichiarato;
2. stessi campi clinici significativi;
3. equivalente ricerca, filtri, stati e gestione conflitti;
4. workflow completabile end-to-end;
5. test o runbook ripetibile;
6. click-map manuale quando la promessa riguarda l’esperienza UI;
7. nessuna violazione dei boundary local-first, cifratura dichiarata o
   review-first.

Un gate assistivo resta non terminale finché la tecnologia assistiva richiesta
non è stata usata sulla piattaforma dichiarata. La sola eccezione della
candidata sorgente 0.8 è il limite VoiceOver mobile registrato in
[docs/known-limitations.md](./known-limitations.md).

## Verifica

```bash
npm run check:apple-wide-qa
jq empty docs/apple-parity-matrix.json
git diff --check
rg --files -g '*.md' | sort
```
