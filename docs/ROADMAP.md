# Roadmap MediFlow

> **Dove siamo e dove vogliamo andare.**
> v0.5.0 (release corrente) — Marzo 2026
> Fonte roadmap prodotto canonica (vedi anche [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) per la lettura completa corrente e [docs/README.md](./README.md) per mappa completa documenti).

## Fatto (v0.3.0)

Le fondamenta sono solide e usabili in produzione locale.

* **Database solido**: migrazione completa a SQLite cifrato.
* **Privacy Totale**: Cifratura Zero-Knowledge attiva. Nemmeno io leggo i tuoi dati.
* **AI Locale**: Integrazione di Qwen text-only (sintesi/insight) e DeepSeek OCR via Ollama.
* **ICD-11**: Diagnosi standardizzate OMS.
* **Multi-ambulatorio**: gestione sedi con identificazione visiva rapida.

---

## Fatto (v0.4.0)

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

## Fatto (v0.5.0)

`v0.5.0` e la release che consolida lo snapshot oggi usato dal vivo: UI web piu leggibile e stack AI locale piu governato, senza riscrivere retroattivamente `v0.4.0`.

* **Interfaccia clinica web piu coerente**: scheda paziente, lista, form e shell impostazioni convergono verso una gerarchia visiva piu leggibile e piu orientata all'azione.
* **Governance AI locale piu esplicita**: task contract condiviso, benchmark headless, model stack/model parliament e separazione netta tra runtime operativo e lane `benchmark-only`.
* **Release hygiene ripristinata**: `lint` torna confinato ai sorgenti e i benchmark CLI generativi tornano eseguibili su `main`.
* **Narrativa prodotto riallineata**: `v0.4.0` resta la baseline storica, `v0.5.0` chiude il consolidamento AI/UI e il ciclo successivo si sposta su home-base e client native.
* **Boundary piu chiari**: SISS/FSE, multi-device e stack AI vengono raccontati per quello che sono davvero, senza attribuire a MediFlow integrazioni o automatismi non ancora dimostrati.

> Nota: le lane `benchmark-only` (`OpenMed redaction`, `clinical_entities`, challenger generativi non promossi) restano fuori dal runtime operativo e dal claim principale della release.

---

## In corso (post-v0.5)

La lettura operativa piu completa del ciclo post-v0.5 e ora
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md): questo file resta la
roadmap prodotto, mentre lo stato del sistema tiene insieme runtime effettivo,
boundary, document intelligence, home-base, Apple clients e split private/OSS.

### Modalita network home-base

* **Nodo centrale locale**: pairing esplicito, capability discovery, data plane read-only e primi write versionati per profilo/status, diario, terapie, checkup e osservazioni sono gia entrati su `main`; restano da estendere UX, replica e altri moduli clinici.
* **Replica e fallback offline**: continuita operativa tra dispositivi con riconciliazione esplicita ancora da promuovere oltre il mirror/snapshot governato.
* **Runtime AI centralizzabile**: opzione locale di studio per client meno potenti, senza egress cloud e ancora separata dal data plane clinico.

### Document intelligence prudente

* **Artifact `parse/evidence` su allegati**: la prima slice runtime del `document evidence ledger` e gia su `main`, con `patients.documentInsights` mantenuto come projection compatibile.
* **Decision layer separati**: i prossimi step spingono source governance, recency, exclusions e reviewability senza introdurre import silenziosi o riscritture in blocco.

### Esperienza nativa

* **Nuova shell macOS `home-base`**: rebuild controllato dell'app nativa, packaged e capace di gestire il runtime locale senza dipendere dal terminale, preservando `/api/v1`, TLS locale e semantica security/sessione.
* **Family Apple condivisa per contratto**: convergenza tramite core Swift condiviso e API versionate, con shell distinte per macOS, iPhone e iPad ma stesso comportamento clinico sui moduli condivisi.
* **App iPadOS/iOS paired**: consultazione e workflow non-AI coerenti con il modello `home-base`, paired e read-only-first oggi, con write versionati gia limitati a profilo/status, diario, terapie, checkup e osservazioni, cache locale cifrata futura e nessun accesso diretto al file SQLite del Mac.

### Shell ufficiale e sperimentazioni controllate

* **Shell web ufficiale**: `Clinical Workbench / Graphite` e la grammatica unica supportata su `main`.
* **Niente preview profiles su `main`**: AI, Smart Import e contesto paziente SISS/FSE vivono direttamente nella shell ufficiale quando sono maturi.
* **Sperimentazioni esplicite**: nuove fette AI, import o SISS entrano solo dopo verifica dedicata, non come selector runtime persistito.
* **Guardrail locali**: revision fingerprint, `/api/system/revision` e reset `.next` source-aware riducono il rischio di testare una shell stale.

### SISS/FSE e base documentale regionale

* **Boundary attuale**: MediFlow prepara il contesto e richiama percorsi ufficiali; il prescrittivo resta `webapp-assisted` e non una UI regionale custom dentro MediFlow.
* **Corpus locale SISS/FSE**: manifest sorgenti, fetch/sync incrementale e report di freschezza sono gia su `main` come base di lavoro documentale, fuori dal runtime clinico.
* **Integrazione piu profonda**: prima di codice runtime servono scenari approvati, qualifica/provisioning coerenti con `SSI/A2A` e documentazione scenario-specific verificabile.

### Interazione vocale

* **Dettatura**: Usare Whisper (locale) per dettare la visita invece di scrivere.
* **Chat**: Chiedere al sistema: *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*.

---

## Visione (v1.0.0)

Un ecosistema clinico open source, locale e affidabile, che un medico possa installare e usare senza complicazioni infrastrutturali.

Hai idee o critiche? Apri una issue su GitHub.
