# 🧭 Roadmap MediFlow

> **Dove siamo e dove vogliamo andare.**
> v0.7.2 (release corrente, chiude la parità del boundary paired sopra il ramo Apple/native). Ultimo aggiornamento: 2026-07-09.
> Fonte roadmap prodotto canonica (vedi anche [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) per la lettura completa corrente e [docs/README.md](./README.md) per mappa completa documenti).

> [!NOTE]

## ✅ Fatto (v0.3.0)

Le fondamenta sono solide e usabili in produzione locale.

* **Database solido**: migrazione completa a SQLite cifrato.
* **Privacy locale**: cifratura locale dei dati clinici sensibili e modello senza cloud di default; i claim zero-knowledge forti restano in riallineamento `WUL-342`/`WUL-354`.
* **AI Locale**: Integrazione di Qwen text-only (sintesi/insight) e DeepSeek OCR via Ollama.
* **ICD-11**: Diagnosi standardizzate OMS.
* **Multi-ambulatorio**: gestione sedi con identificazione visiva rapida.

---

## ✅ Fatto (v0.4.0)

Base tecnica più solida, con flussi documentali e contratti locali molto più espliciti.

* **API locale più governata**: baseline OpenAPI `/api/v1`, guard anti-drift e concorrenza ottimistica sui pazienti.
* **Import clinico più utile**: pipeline OCR-first strutturata e smart import reviewable verso diagnosi ICD-11 e terapie.
* **Archivio intelligente più operabile**: pulizia per singolo documento o completa, persistenza farmaci estratti e riallineamento dell'insight AI.
* **Sicurezza e continuita operative**: audit append-only, lockout auth, cambio PIN zero-knowledge, backup artifact/preflight, scheduler notturno e retention automatica.
* **Compliance locale piu esplicita**: terminology registry locale, baseline GTW/FSE, baseline SISS e pannello prescrizione con handoff controllato.
* **Stabilizzazione web/core**: `typecheck` canonico, normalizzazione condivisa dei payload paziente e riduzione del carico nei file piu densi.

> Nota: il filone `macOS/parity` non prosegue come delivery incrementale oltre `v0.4.0`.
> Entra in **riscrittura controllata** della shell nativa, preservando `/api/v1`, TLS locale, cifratura e regole security/local-first.

---

## ✅ Fatto (v0.5.0)

`v0.5.0` e la release che consolida lo snapshot oggi usato dal vivo: UI web piu leggibile e stack AI locale piu governato, senza riscrivere retroattivamente `v0.4.0`.

* **Interfaccia clinica web piu coerente**: scheda paziente, lista, form e shell impostazioni convergono verso una gerarchia visiva piu leggibile e piu orientata all'azione.
* **Governance AI locale piu esplicita**: task contract condiviso, benchmark headless, registro candidati locali e separazione netta tra runtime operativo e lane `benchmark-only`.
* **Release hygiene ripristinata**: `lint` torna confinato ai sorgenti e i benchmark CLI generativi tornano eseguibili su `main`.
* **Narrativa prodotto riallineata**: `v0.4.0` resta la baseline storica, `v0.5.0` chiude il consolidamento AI/UI e il ciclo successivo si sposta su home-base e client native.
* **Boundary piu chiari**: SISS/FSE, multi-device e stack AI vengono raccontati per quello che sono davvero, senza attribuire a MediFlow integrazioni o automatismi non ancora dimostrati.

> [!NOTE]
> Le lane `benchmark-only` (`OpenMed redaction`, `clinical_entities`, challenger generativi non promossi) restano fuori dal runtime operativo e dal claim principale della release.

---

## ✅ Fatto (v0.6.0)

`v0.6.0` chiude il ciclo post-`v0.5`: il prodotto assume una forma piu
completa come sistema local-first con Mac `home-base`, client Apple paired,
document intelligence artifact-first e integrazioni regionali governate da
boundary espliciti.

* **Mac come home-base concreto**: pairing esplicito, capability discovery,
  data plane pazienti e primi write versionati sono su `main`; il bundle macOS
  puo avviare/fermare backend production e proxy TLS e mostra health read-only
  dei servizi locali opzionali.
* **Family Apple paired non-AI**: iPhone/iPad entrano nel disegno con core
  condiviso, cache mobile cifrata degradabile e primi workflow online
  versionati su profilo/status, diario, terapie, checkup e osservazioni.
* **Document intelligence artifact-first**: `parse/evidence` cifrato sugli
  allegati, `sectionMap`, ancore fonte e conflitti reviewable diventano la base
  runtime prudente per `Patient Insight` e create-flow documentale.
* **SISS/FSE piu maturo ma onesto**: corpus locale con sync/freshness,
  scenario notes per prescrittivo, FSE, NAR, SGDT/PAI/COT e certificati, e
  boundary `webapp-assisted` finche non esiste una qualifica `SSI/A2A`.
* **AI governance piu netta**: safety gate con kill-switch su `patient-insight`,
  `smart-import` e `document-synthesis`, piu model governance delle decisioni
  documentali (`WUL-355`, `WUL-358`); MLX resta benchmark-visible e
  diagnosticabile ma non runtime clinico; le lane OpenMed/NER/TurboQuant/comparator
  restano benchmark-only o shadow.
* **Cancellazione paziente reversibile**: soft-delete con tombstone
  (`deletedAt`/`deletionReason`) e version guard (ADR 0066, `WUL-306`), che non
  orfana i figli clinici e lascia il contratto API invariato; lato admin
  `purge-patient` (erasure GDPR con dry-run) e `restore-patient`, entrambi audited.
  azzerata in quel closeout; dal 2026-06-13/16 la coda post-review e di nuovo
  attiva tramite `WUL-341`, `WUL-356` e la proposta `WUL-373`.

> [!WARNING]
> `v0.6.0` non dichiara sync completo, multi-master, attachment remoti, cataloghi remoti, prescribing SISS nativo o AI cloud di default. Questi restano esplicitamente fuori dal claim di release.

---

## ✅ Fatto (v0.7.0)

`v0.7.0` consolida il mainline successivo alla `v0.6.0`: hardening clinico
post-review, safety gate AI piu solidi, look Kree8 piu pulito e documentazione
pubblica/OSS riallineata al prodotto reale.

* **Stabilizzazione dati e API**: soft-delete paziente, ciclo di vita uniforme
  delle sotto-risorse cliniche, token paired inerti a modalita rete spenta e
  controlli piu stretti su allegati, checkup, impostazioni e repair DB.
* **Esperienza piu leggibile**: cockpit, scheda paziente e impostazioni hanno
  copy piu asciutto, dark mode completa, palette semantica piu chiara e flusso
  a un clic verso la Scheda.
* **AI/document intelligence governate**: kill-switch e readiness storage piu
  robusti per Patient Insight, Smart Import e document synthesis, senza
  promuovere lane benchmark-only nel runtime clinico.
* **Pubblicazione piu onesta**: README, FAQ, roadmap, stato sistema e facciata
  OSS raccontano lo stato corrente senza overclaim su SISS/FSE, cloud, AI o
  automazione clinica.

> [!WARNING]
> Il client macOS storico deve ancora assorbire la compatibilita del ciclo `/api/v1`
> tracciata in `WUL-333`; la base prodotto da estendere resta il bundle
> Apple/home-base.

---

## ✅ Fatto (v0.7.1)

`v0.7.1` porta nel racconto di release il lavoro Apple/native e lo separa dai
filoni di portabilita ancora iniziali. Il valore non e dichiarare tre app
complete, ma rendere verificabile una direzione: web app locale solida, macOS
come fronte nativo piu avanzato, iPhone/iPad come client paired e core Swift
testato anche su Linux/Windows.

* **macOS avanti nel percorso native**: shell Apple/home-base, workspace
  paziente condiviso, design Vetro Clinico/Liquid Glass, privacy shield,
  runtime panel e slice cliniche non-AI portate dentro un artifact Xcode
  verificabile.
* **Core Swift condiviso**: `MediFlowCore` porta fuori dalla UI logica
  clinica, filtri, contratti, cifratura, conflict handling, clinical scales e
  store SQLite locale.
* **Gate tri-OS**: Linux, macOS e Windows costruiscono e testano il core
  condiviso in CI. Questo prova la direzione di portabilita, ma non equivale a
  parity applicativa Windows/Linux.
* **Convergenza pubblica completata**: questo punto storico sull'export OSS e
  superato da `WUL-477`; la repository pubblica e ora l'unica fonte operativa,
  mentre materiali sensibili e artifact temporanei restano fuori da Git.

> [!WARNING]
> La 0.7.1 va taggata solo dopo merge del ramo Apple/native, CI verde sul

---

## 🚧 In corso (post-v0.7.2)

La lettura operativa piu completa del ciclo post-v0.7.2 e ora
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md): questo file resta la
roadmap prodotto, mentre lo stato del sistema tiene insieme runtime effettivo,
boundary, document intelligence, home-base, Apple clients e governance della
repository pubblica.

### Modalita network home-base

* **Nodo centrale locale**: pairing esplicito, capability discovery, data plane read-only e primi write versionati per profilo/status, diario, terapie, checkup e osservazioni sono gia entrati su `main`; restano da estendere UX, replica e altri moduli clinici senza rompere il boundary.
* **Replica e fallback offline**: continuita operativa tra dispositivi con riconciliazione esplicita ancora da promuovere oltre il mirror/snapshot governato.
* **Runtime AI centralizzabile**: opzione locale di studio per client meno potenti, senza egress cloud e ancora separata dal data plane clinico.

### Document intelligence prudente

* **Artifact `parse/evidence` su allegati**: la prima slice runtime del `document evidence ledger` e gia su `main`, con `patients.documentInsights` mantenuto come projection compatibile.
* **Decision layer separati**: i prossimi step spingono source governance, recency, exclusions e reviewability senza introdurre import silenziosi o riscritture in blocco.
* **Safety gate AI**: kill-switch per `patient-insight`, `smart-import` e `document-synthesis` e model governance delle decisioni documentali sono gia su `main` (`WUL-355`, `WUL-358`); l'AI locale resta review-first, senza scrittura clinica automatica.

### Esperienza nativa

* **Merge train Apple/native**: chiudere PR #271, far girare CI sul `main`
  risultante e poi promuovere la release docs 0.7.1.
* **Stack voice visit**: riconciliare #272, #273 e #274 in ordine, partendo
  dall'ADR boundary e poi dalle superfici UI/backend sintetiche.
* **Windows/Linux oltre il core**: trasformare il vecchio branch #266 in slice
  piu piccole per launcher, floor hardware e distribuzione tri-OS, senza
  promettere parity applicativa prima delle prove.
* **Provider locali Apple**: rivalutare #259 dentro WUL-417/WUL-418, recuperando
  solo kill-switch, test e decisioni compatibili con il gate benchmark-first.

### Shell ufficiale e sperimentazioni controllate

* **Shell web ufficiale**: il cockpit Kree8 e la root live `/` supportata su `main` (ADR 0060); Graphite resta storico solo per il principio di shell unica/no selector.
* **Niente preview profiles su `main`**: AI, Smart Import e contesto paziente SISS/FSE vivono direttamente nella shell ufficiale quando sono maturi.
* **Sperimentazioni esplicite**: nuove fette AI, import o SISS entrano solo dopo verifica dedicata, non come selector runtime persistito.
* **Guardrail locali**: revision fingerprint, `/api/system/revision` e reset `.next` source-aware riducono il rischio di testare una shell stale.

### SISS/FSE e base documentale regionale

* **Boundary attuale**: MediFlow prepara il contesto e richiama percorsi ufficiali; il prescrittivo resta `webapp-assisted` e non una UI regionale custom dentro MediFlow.
* **Prescrizioni di prestazione**: dominio locale separato dalle terapie farmacologiche per visite, esami, imaging, riabilitazione e screening, con item codificabili e matching sul repertorio locale; niente generazione NRE ne invio prescrittivo regionale.
* **Corpus locale SISS/FSE**: manifest sorgenti, fetch/sync incrementale e report di freschezza sono gia su `main` come base di lavoro documentale, fuori dal runtime clinico; l'accesso MCP resta read-only sopra il corpus approvato.
* **Integrazione piu profonda**: prima di codice runtime servono scenari approvati, qualifica/provisioning coerenti con `SSI/A2A` e documentazione scenario-specific verificabile.

### Interazione vocale

* **Dettatura**: Usare Whisper (locale) per dettare la visita invece di scrivere.
* **Chat**: Chiedere al sistema: *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*.

---

## 🧭 Visione (v1.0.0)

Un ecosistema clinico open source, locale e affidabile, che un medico possa installare e usare senza complicazioni infrastrutturali.

Hai idee o critiche? Apri una issue su GitHub.
