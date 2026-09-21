---
summary: "Canonical parity contract for localhost and Apple clients, with feature and interaction evidence kept separate."
read_when:
  - "Planning or reviewing macOS, iPhone, or iPad parity work."
  - "Checking feature parity separately from interaction and assistive-technology evidence."
---

# Matrice parity localhost ↔ client Apple

Stato documento: `CANONICAL`
Ultimo aggiornamento: 2026-09-06 (riconciliazione testuale della sorgente Apple 0.8.6; prove UI/interop separate e pending)

## Gate MediFlow 0.8

Per leggere la matrice occorre separare il contratto funzionale dalle prove
eseguite sulle singole revisioni. Il pacchetto parity parte dalla base congelata
`2355a46a4dde63b1956a2298d99ef0b5c4208222`, tree
`c46d739b026e509a3e1fae2348372a420c9a17aa`; il commit finale della candidata
viene registrato nel run record dopo la verifica successiva al commit.

Il contratto funzionale rimane `PARTIAL`: 13 funzionalità sono parziali e 23
sono intenzionalmente riservate all'host. Questo stato non blocca da solo una
candidata sorgente, ma nemmeno sostituisce le verifiche dell'interazione o le
ricevute di chiusura sulla SHA esatta. La distribuzione sorgente 0.8.6 e il
seguito nativo restano quindi distinti; pubblicare i sorgenti non promuove
questa matrice a parità completa.

La promozione rimane `HOLD_PROMOTION`, perché prove automatiche e interazioni
reali valgono per la baseline su cui sono state eseguite. Sul
runtime `29b2c94b6a044b1639137403a2228ff172ea3d0f`, tree
`5706ade800d6a8caf2ab875882f61fe0881b3dd5`, la sessione web con VoiceOver è
terminale `PASS_BOUNDED`: Chrome production era in primo piano, VoiceOver era
attivo e le azioni sono state esercitate con input tastiera macOS nativo su dati
sintetici. Il successore che registra questa evidenza è docs-only e non modifica
il runtime verificato. Il receipt Xcode exact-SHA resta un gate separato.
VoiceOver reale su iPhone e iPad non è provato perché l'API pubblica della beta
Xcode 27 non raggiunge uno stato terminale nel simulatore: questa è una deroga
esterna accettata, non un PASS, e non autorizza claim App Store o di conformità.

La parità serve a riconoscere e completare le stesse operazioni, non a
riprodurre la stessa interfaccia. Lume fornisce il linguaggio comune; Liquid
Glass è una declinazione nativa Apple, non un'identità da copiare in CSS.
Capacità, significato, gerarchia, stati, sicurezza e riconoscibilità devono
restare coerenti, mentre navigazione, densità, controlli e modalità di input
seguono la piattaforma. Una differenza documentata non è quindi una mancanza;
lo è una funzione necessaria ma assente dal perimetro dichiarato.

## Perimetro

Questa matrice confronta:

- **localhost**: la web app locale sul Mac, superficie clinica di riferimento;
- **macOS**: il bundle Apple/home-base con shell clinica condivisa;
- **iPhone/iPad**: client paired sul boundary `/api/v1/network/*`.

Il contratto leggibile dagli strumenti è
[docs/apple-parity-matrix.json](./apple-parity-matrix.json). Il manifest
[docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json) ha un compito
diverso: verifica 24 record tecnici di accettazione e i contratti di rete.
Per questo lo stato QA `covered` non dimostra automaticamente una parità
funzionale completa.

Riferimenti architetturali:

- [ADR 0005](./adr/0005-web-native-functional-parity.md)
- [ADR 0008](./adr/0008-web-first-with-parity-sweeps.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0076](./adr/0076-paired-document-domain-write-policy.md)

## Due assi distinti

Una funzione può essere presente senza che il suo percorso d'uso sia stato
verificato. La disponibilità funzionale (feature parity) e la possibilità di
completare l'interazione (interaction parity) sono perciò due assi indipendenti.

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

Anche una prova VoiceOver vale soltanto per la superficie effettivamente
esercitata: in Chrome di produzione riguarda la web app, non l'app nativa
macOS; dentro l'app macOS riguarda soltanto quest'ultima. Né queste sessioni
né gli audit XCTest dimostrano un uso reale di VoiceOver su iPhone o iPad.

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

Il rapporto 30/13/23 descrive il contratto funzionale censito, non il numero
delle prove valide sulla revisione corrente. Non permette quindi di dichiarare
“parity completa”.

La chiave `reconciliation` del JSON collega il contratto alle prove 0.8.
Il manifest Apple-wide verifica 24 acceptance record tecnici separati.

## Evidenza registrata

Le prove Apple con Xcode riportate sotto appartengono alla baseline storica
`0843726fe`: non si trasferiscono a un tree successivo. La disponibilità di
Xcode deve essere verificata sulla macchina e gli esiti sulla SHA esatta devono
risultare dalle ricevute di chiusura. La riconciliazione dei sorgenti integrati
indica ciò che è presente nel codice, tenendolo distinto da prove SPM, UI e
interoperabilità; non aggiorna per implicazione punteggi, celle UI o stato
della release.

| Classe | Superficie | Prova | Stato |
| --- | --- | --- | --- |
| `verified-automatic` | Web | Evidence Stack 2/2 con PIN sintetico `0000`; build 104 pagine e standalone | PASS |
| `verified-real-interaction` | Web | Chromium produzione a 320/390/768/1440 e zoom esatto 200%/400%; focus visibile e nessun overflow orizzontale | PASS |
| `verified-real-interaction` | Web / VoiceOver | Chrome production in primo piano, VoiceOver attivo e tastiera macOS nativa; `Vai ai pazienti`, `Rivedi agenda`, `Apri revisione`, comando `Diario` e ricerca paziente hanno raggiunto il target di focus dichiarato | `PASS_BOUNDED` sul runtime `29b2c94b6a04`, tree `5706ade800d6`; dati sintetici, non audit applicativo completo |
| `verified-automatic` | iPhone | XCUITest 2/2, tab identifier atomici e apertura delle sei superfici | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-automatic` | iPad | XCUITest 7/7, list-detail, AX5, rotazione, geometria e audit AX | PASS storico su `0843726fe`; non equivale a VoiceOver |
| `verified-real-interaction` | macOS | Build Xcode 27, click-map, focus, Cmd-R contestuale, resize e VoiceOver manuale | PASS storico su `0843726fe` |
| `verified-automatic` | macOS probe | `typecheck` e 6/6 test del probe AX corretto e process-safe | PASS storico su `0843726fe` |
| `accepted-external-limitation` | iPhone/iPad | VoiceOver reale | Non provato; Xcode 27 beta, issue Apple `173507341` |

## Stato per area

| Area | Stato | Cosa è già disponibile | Residuo reale |
| --- | --- | --- | --- |
| Pazienti | `PARTIAL` | lista, ricerca, dettaglio, create/update, DOB con patch `omit/value/null` in UTC, archivio con motivo/nota, cestino e ripristino | prove UI ordinarie e round-trip app/home-base ancora pending; assign/unassign/move/duplicate sono esplicitamente fuori dall'obbligo W2 |
| Diario | `PARTIAL` | CRUD versionato, restore, filtri, S/O/A/P, rich text inline, allegati per-record e bozza visita deterministica | indent/outdent e strutture complesse; prove UI/interop dell'editor |
| Terapie | `PARTIAL` | CRUD, soft-delete, stato, AIC/ATC/principio attivo, autocomplete AIFA, fallback manuale e collegamento diagnosi | prove finali del form e del round-trip |
| Checkup | `PARTIAL` | CRUD, soft-delete, status/source, conflitti versione e prefill follow-up manuale deduplicato | equivalenza campi e flussi |
| Osservazioni | `PARTIAL` | CRUD, soft-delete, LOINC/UCUM, trend e sparkline | equivalenza visuale e flessibilità |
| Cataloghi AIFA/esenzioni | `FULL` per lookup | ricerca network di farmaci ed esenzioni dal boundary paired | import, refresh e stato/freschezza del repertorio restano host-only |
| Prestazioni e protesica | `FULL` nel perimetro paired | read/write versionati e UI nativa | nessun invio regionale o generazione NRE |
| Export FHIR/FSE pre-check | `FULL` nel perimetro locale | bundle on-device e validazione boundary | nessun writeback FSE |
| SISS / PRREG | `HOST-ONLY` per integrazione, utilità PRREG parziale | web con pannello/diario; Apple copia il CF e apre la dashboard PRREG dal paziente | FSE, stato sessione, diario handoff e canale regionale restano sul Mac o fuori scope |
| Viste globali | `MIXED` | agenda, diario globale, analytics e interazione macOS reale; router/deep-link source-present per la sessione ordinaria | apertura OS, focus, resize, VoiceOver e app-freeze proof della slice restano pending; cockpit sintetico partial |
| Documenti | `PARTIAL` e policy-limited | upload cifrato, picker nativo singolo, archivio read, insight read, follow-up, allegati e stati web verificati | multi-file è differenza operativa; OCR, sintesi, curation e delete insight restano host per ADR 0076; UI/interop nativa pending |
| Offline mobile | `PARTIAL` | lista e ultimo profilo in cache cifrata, TTL massimo 24h e renderer read-only source-present nel candidato WUL-676 | workflow offline ordinario e verifica UI/device del renderer integrato (`WUL-403`) |
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

La consegna di Wave 5 copre quella tranche di lavoro; i residui riportati sotto
impediscono di leggerla come chiusura della parità complessiva.

## Wave 6 / closeout residuo

### W6-A — convergenza UI macOS e click-map P6

Sono integrati il codice di contenimento visivo, o clipping, e il probe AX
corretto. Le prove Xcode sul commit storico `0843726fe` valgono però soltanto
per quel tree. W6-A non attesta implicitamente il nativo sulla SHA corrente:
servono disponibilità di Xcode ed esito sulla revisione esatta nella ricevuta
di chiusura terminale.

### W6-B — offline degradato onesto

Owner: `WUL-403`.

Il lavoro rende visibili età e TTL della cache, eventuale obsolescenza, limite
di sola lettura e assenza di una coda di scrittura. Serve a rendere comprensibile
il degrado offline, non a introdurre sincronizzazione multi-master o scritture
senza rete.

La candidata locale `WUL-676` (0.8.6) collega al pannello `WUL-556` i metadata
effettivi di acquisizione, scadenza e motivo. Il TTL massimo rimane 24 ore;
oltre la scadenza vengono restituiti soltanto metadata non identificativi,
senza dati paziente. La lettura resta vincolata da ADR 0048 alla stessa
sessione operatore sbloccata, al pairing, all'ambulatorio e al pin TLS:
401/403, errori TLS e risposte non conformi non attivano il ricorso alla cache.

Store e modello conservano anche l'ultimo profilo manuale entro il TTL, con
una presentazione dedicata in sola lettura nelle destinazioni compatta e
affiancata. Questo prova la presenza del percorso circoscritto nel sorgente
candidato, non il workflow offline ordinario né la verifica integrata su UI
e dispositivo, che restano aperti. La riga rimane pertanto `partial`.
Sotto-risorse, artifact AI/documentali, export e coda di scrittura sono invece
esclusi espressamente dal contratto: non vanno aggiunti per colmare un presunto
vuoto funzionale.

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
| 1 — anagrafica paziente | `available`: `patient search`, `patient show` | `partial` | Mini copre ricerca/dettaglio; la riga Apple include anche create/update, DOB e archivio; assign/unassign/move/duplicate sono esplicitamente fuori dall'obbligo W2 |
| 39 — blocco/stato sessione | `available`: `whoami` | `full-parity` nella matrice Apple; stati visuali coperti dalla slice | `whoami`, pairing o token locale non sono un grant agentico |
| 45 — cache offline | `manual_only`: `NOT_IN_MINI_PILOT` | `partial` | Candidato WUL-676: metadata stale live e cache cifrata lista/ultimo profilo con renderer read-only source-present; workflow offline ordinario e verifica UI/device aperti. Write queue esclusa da ADR 0048 |
| 63 — discovery capability | `available`: `capabilities` | `full-parity` per consumo API | Il manifest descrive capability; non autorizza operazioni cliniche |

`open-loops` (riga 11) è la quarta riga Mini `available`, ma non appartiene alla
slice `WUL-556`. `draft preview` (riga 4) resta `proposal_only` con ragione
`SYNTHETIC_PREVIEW_ONLY`. Le altre righe conservano la disposizione e la ragione
del manifest; le 23 `HOST_AUTHORITY_ONLY` restano host-only nella matrice Apple.

| Superficie mobile | Stato candidata | Evidenza | Dipendenza host/headless |
| --- | --- | --- | --- |
| iPhone | `partial` | Test di presentazione, XCUITest e screenshot sintetico | Nessun grant nuovo; usa solo stato paired esistente |
| iPadOS | `partial` | Stesso contratto, layout adattivo, `⌘R`, pointer, XCUITest e screenshot sintetico | Metadata TTL/stale collegati nel candidato WUL-676; integrazione e verifica UI/device ancora aperte |
| Capability AIP/Mini | Gap Apple e disposizione Mini restano assi separati | Manifest WUL-557: 4/66 disponibili | Le ragioni `partial`, host-only e `manual_only` restano esplicite; manifest e receipt non diventano autorità client; verifica manager e `WUL-564` bloccano la promozione |

### W6-C — decisione sul workflow documentale nativo

Dipendenze: `WUL-417` (OCR Apple on-device), `WUL-383` (degradazione OCR) e
`WUL-409` (Smart Import review-first).

Sul web, archivio popolato, revisione delle estrazioni e stati di caricamento,
vuoto ed errore hanno una prova E2E 2/2. I client Apple leggono gli insight,
caricano documenti manuali e mostrano il riepilogo da rivedere, con conteggi
persistiti N+ e stati di caricamento o errore espliciti.

ADR 0076 mantiene sull'host OCR, revisione delle estrazioni e scritture derivate
dai documenti. La separazione è classificata
`platform-specific-documented`: è una scelta di responsabilità, non una
mancanza implicita del client.

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

La mappa collega ciascun controllo all'azione esercitata e alla prova di
chiusura registrata. Non estende l'esito a controlli o superfici non provati.

| Superficie | Controllo | Identificatore | Azione | Evidenza |
| --- | --- | --- | --- | --- |
| Web | Agenda | nome AX `Agenda` | Cambia area cockpit | Chrome produzione |
| Web | Rivedi agenda | nome AX `Rivedi agenda`; `aria-controls=turno-agenda-heading` | Mantiene `area=turno`, porta in viewport e focalizza il titolo `Agenda di oggi` | E2E e VoiceOver production `PASS_BOUNDED` sul runtime `29b2c94b6a04` |
| Web | Pazienti | nome AX `Pazienti N` | Carica worklist | Chrome produzione |
| Web | Diario | `lume-diario` | Carica feed globale | Chrome produzione |
| Web | Scheda | `lume-scheda-header` | Carica paziente e aggregati | E2E candidato locale D1/D2 — SHA esatti |
| Web | Evidence Stack | tile documento | Mostra stati e avvia curation | E2E 2/2 |
| Apple | Sezione clinica | `clinical-workspace-section-*-button` | Seleziona area | Audit automatico |
| Apple | Lista pazienti | `patients-selection-list` | Seleziona dettaglio | Audit automatico |
| macOS | Agenda sidebar | `clinical-workspace-section-agenda-button` | Seleziona riga `List` | Click-map e probe AX PASS |
| macOS | Riga paziente | `patient-cell-*` | Seleziona e carica dettaglio | Click-map e probe AX PASS |
| macOS | Focus | focus system | Avanza con `Tab` e freccia | Interazione reale PASS |
| macOS | Inspector paziente | `clinical-workspace-inspector-toggle` | Toolbar o `⌥⌘I` mostra/nasconde il contesto della finestra focalizzata | WUL-566/WUL-567: test focalizzati, 2 finestre simultanee osservate nello stesso PID, suite nativa, build Xcode e screenshot light/dark PASS; apertura OS, focus, resize, VoiceOver e app-freeze proof della slice `PARTIAL` restano pending. Il manifest Mini PR #184 mantiene `sourceRow: 32` a `manual_only`, senza comandi Mini. |

### AXPress

Il probe seleziona la riga nativa e ne verifica `AXSelectedRows`, anziché
premere il testo statico al suo interno in SwiftUI. Il precedente rilievo
`AXPress` è quindi `corrected` e non costituisce un blocco corrente.

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

La verifica assistiva resta non terminale finché la tecnologia richiesta non
viene usata sulla piattaforma dichiarata. L'unica limitazione esterna già
accettata è quella di VoiceOver mobile, registrata in
[docs/known-limitations.md](./known-limitations.md). Ogni altra prova non
terminale mantiene `HOLD_PROMOTION`: un test automatico diverso non può
sostituirla.

## Verifica

```bash
npm run check:apple-wide-qa
jq empty docs/apple-parity-matrix.json
git diff --check
rg --files -g '*.md' | sort
```
