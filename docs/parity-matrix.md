---
summary: "Canonical feature-parity status between the localhost web app and the universal Apple client."
read_when:
  - "Planning or reviewing macOS, iPhone, or iPad parity work."
  - "Checking which localhost capabilities are full, partial, host-only, or policy-gated."
---

# Matrice parity localhost ↔ client Apple

Stato documento: `CANONICAL`
Ultimo aggiornamento: 2026-07-11 (`WUL-479`, post-Wave 5)

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

## Fotografia post-Wave 5

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

Questi numeri non autorizzano il claim “parity completa”: la click-map manuale
P6 del bundle macOS è ancora aperta in `WUL-401`.

## Stato per area

| Area | Stato | Cosa è già disponibile | Residuo reale |
| --- | --- | --- | --- |
| Pazienti | `PARTIAL` | lista, ricerca, dettaglio, create/update, archivio, cestino e ripristino | operazioni bulk non esposte e click-map P6 |
| Diario | `PARTIAL` | CRUD versionato, restore, filtri, S/O/A/P, rich text, allegati e bozza visita deterministica | equivalenza completa allegati/editor e verifica P6 |
| Terapie | `PARTIAL` | CRUD, stato, AIC/ATC/principio attivo, autocomplete AIFA e fallback manuale | collegamento diagnosi e flessibilità del form da verificare |
| Checkup | `PARTIAL` | CRUD, status/source, conflitti versione | equivalenza campi/flussi e P6 |
| Osservazioni | `PARTIAL` | CRUD LOINC/UCUM e trend | equivalenza visuale/flessibilità e P6 |
| Cataloghi AIFA/esenzioni | `FULL` per lookup | ricerca AIFA ed esenzioni dal boundary paired | import/clear repertori resta host-only |
| Prestazioni e protesica | `FULL` nel perimetro paired | read/write versionati e UI nativa | nessun invio regionale o generazione NRE |
| Export FHIR/FSE pre-check | `FULL` nel perimetro locale | bundle on-device e validazione boundary | nessun writeback FSE |
| SISS / PRREG | `HOST-ONLY` per integrazione, utilità PRREG parziale | web con pannello/diario; Apple copia il CF e apre la dashboard PRREG dal paziente | FSE, stato sessione, diario handoff e canale regionale restano sul Mac o fuori scope |
| Viste globali | `MIXED` | agenda, diario globale e analytics di popolazione | shell/deep-link e cockpit sintetico restano partial |
| Documenti | `PARTIAL` e policy-limited | upload manuale cifrato, archivio, insight read-only, follow-up e allegati nel diario | OCR/curation/document-derived write richiedono policy dedicata |
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

## Wave 6 / closeout proposto

### W6-A — convergenza UI macOS e click-map P6

Owner: `WUL-401`.

Copre otto residui: pazienti, diario base, editor rich text, terapie, checkup,
osservazioni, cockpit e shell/deep-link. L’uscita richiede una click-map manuale
reale sul bundle home-base; i probe automatici non bastano.

### W6-B — offline degradato onesto

Owner: `WUL-403`.

Rende visibili età/TTL della cache, stato stale, read-only e assenza di write
queue. Non introduce sync multi-master né scritture offline.

### W6-C — decisione sul workflow documentale nativo

Dipendenze: `WUL-417` (OCR Apple on-device), `WUL-383` (degradazione OCR) e
`WUL-409` (Smart Import review-first).

Copre quattro residui partial: nuova voce avanzata, OCR/sintesi dell’archivio,
curation degli insight e wizard nuova scheda da documento. Prima di estendere
scritture document-derived o invocazione AI paired serve una nuova decisione
che aggiorni ADR 0076. In sua assenza, queste superfici restano read-only o
host-assisted.

### Fuori Wave 6

- chat/generazione AI paired;
- gestione modelli, backup, diagnostica e import repertori dal client;
- hard delete remoto;
- writeback SISS/FSE;
- coda di scrittura offline o sync multi-master;
- parity applicativa Windows/Linux.

Il catalogo AIFA nativo non è un residuo: autocomplete, AIC/ATC e fallback
manuale sono già presenti; `WUL-476` è assorbita dallo stato corrente.

## Gate di uscita

Una capability può diventare `full-parity` solo con:

1. funzioni equivalenti nel perimetro dichiarato;
2. stessi campi clinici significativi;
3. equivalente ricerca, filtri, stati e gestione conflitti;
4. workflow completabile end-to-end;
5. test o runbook ripetibile;
6. click-map manuale quando la promessa riguarda l’esperienza UI;
7. nessuna violazione dei boundary local-first, zero-knowledge o review-first.

## Verifica

```bash
npm run check:apple-wide-qa
npm run check:claims
npm run check:never-regress
```
