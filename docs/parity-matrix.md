---
summary: "Canonical parity contract for localhost and Apple clients, with feature and interaction evidence kept separate."
read_when:
  - "Planning or reviewing macOS, iPhone, or iPad parity work."
  - "Checking feature parity separately from interaction and assistive-technology evidence."
---

# Matrice parity localhost ↔ client Apple

Stato documento: `CANONICAL`
Ultimo aggiornamento: 2026-07-28 (`MediFlow 0.8`)

## Gate MediFlow 0.8

Il candidato base è
`9ee798887fbba93b50d644f223a9a14cd85fa71c`, tree
`e4e5b69c7d034822dc7a311181e9dc08336e4ade`. Questo identificatore precede il
packet documentale corrente e non è un hash auto-referenziale.

Il verdetto resta `PARTIAL / HOLD_PROMOTION`. Web e macOS hanno prove reali
nuove. Restano non terminali la build Xcode corrente e le prove assistive su
iPhone, iPad e web.

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
| `host-only` | 21 | La funzione resta sul Mac/localhost per autorità, filesystem, runtime AI o policy. |
| **Totale** | **64** | Capability censite. |

Escludendo le 21 righe intenzionalmente host-only, 30 capability su 43 sono
`full-parity` (**70%**); 13 su 43 restano parziali (**30%**). Sul totale
grezzo, le righe full sono 30/64 (**47%**).

Questi numeri descrivono il contratto funzionale 30/13/21. Non sono il
conteggio delle prove correnti e non autorizzano il claim “parity completa”.

La chiave `reconciliation` del JSON collega il contratto alle prove 0.8.
Il manifest Apple-wide verifica 24 acceptance record tecnici separati.

## Evidenza corrente

| Classe | Superficie | Prova | Stato |
| --- | --- | --- | --- |
| `verified-automatic` | Web | Evidence Stack 2/2 con PIN sintetico `0000`; build 104 pagine e standalone | PASS |
| `verified-real-interaction` | Web | Chrome produzione a zoom esatto 200% e 400%; controlli principali visibili; nessun badge dev | PASS |
| `verified-automatic` | Apple universal | SwiftPM e audit iPhone/iPad già consolidati sul candidato | PASS, non equivale a VoiceOver |
| `verified-real-interaction` | macOS | Bundle Xcode 27 a 1100/1300/1600; click-map, focus, freccia e VoiceOver attivo prima/dopo | PASS sul bundle costruito |
| `verified-automatic` | macOS probe | `typecheck` e 6/6 test del probe AX corretto e process-safe | PASS |
| `blocked` | macOS | Nuova build e suite Xcode 27 | `disk5s1` non montabile; `fsck_apfs` `-69845` |
| `blocked` | iPhone/iPad | VoiceOver reale | Non provato |
| `partial` | Web | Screen reader reale | Run non terminale |

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
| AI generativa | `HOST-ONLY` | stato runtime/kill switch leggibile | nessuna invocazione AI paired per ADR 0076 |
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

Il codice clipping e il probe AX corretto sono integrati. Il bundle Xcode 27
costruito ha superato le prove reali a 1100, 1300 e 1600 punti.

La nuova build resta `blocked`. Il volume `disk5s1` non è montabile e
`fsck_apfs` termina con errore `-69845`. Il blocco infrastrutturale non annulla
le prove già concluse e non autorizza un claim sulla build corrente.

### W6-B — offline degradato onesto

Owner: `WUL-403`.

Rende visibili età/TTL della cache, stato stale, read-only e assenza di write
queue. Non introduce sync multi-master né scritture offline.

### W6-C — decisione sul workflow documentale nativo

Dipendenze: `WUL-417` (OCR Apple on-device), `WUL-383` (degradazione OCR) e
`WUL-409` (Smart Import review-first).

Lo stack web popolato, la curation e gli stati loading/empty/error hanno prova
E2E 2/2. I client Apple leggono insight e caricano documenti manuali.

OCR, curation e scritture document-derived restano sul nodo host per ADR 0076.
Questa divisione è `platform-specific-documented`, non un gap implicito.

### Fuori Wave 6

- chat/generazione AI paired;
- gestione modelli, backup, diagnostica e import repertori dal client;
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
| Web | Scheda | `lume-quadro` | Carica paziente e aggregati | Chrome produzione |
| Web | Evidence Stack | tile documento | Mostra stati e avvia curation | E2E 2/2 |
| Apple | Sezione clinica | `clinical-workspace-section-*-button` | Seleziona area | Audit automatico |
| Apple | Lista pazienti | `patients-selection-list` | Seleziona dettaglio | Audit automatico |
| macOS | Agenda sidebar | `clinical-workspace-section-agenda-button` | Seleziona riga `List` | Click-map e probe AX PASS |
| macOS | Riga paziente | `patient-cell-*` | Seleziona e carica dettaglio | Click-map e probe AX PASS |
| macOS | Focus | focus system | Avanza con `Tab` e freccia | Interazione reale PASS |

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
7. nessuna violazione dei boundary local-first, zero-knowledge o review-first.

Un gate assistivo resta non terminale finché la tecnologia assistiva richiesta
non è stata usata sulla piattaforma dichiarata.

## Verifica

```bash
npm run check:apple-wide-qa
jq empty docs/apple-parity-matrix.json
git diff --check
rg --files -g '*.md' | sort
```
