# Compliance e interoperabilità

> GDPR, privacy e standard clinici in pratica.

Riferimenti correlati:

- [SECURITY.md](../SECURITY.md) (policy sicurezza e redazione)
- [ARCHITECTURE.md](../ARCHITECTURE.md) (confini architetturali stabili)
- [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) (roadmap terminologie/FSE)
- [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md) (mappa documentale)

---

## Inventario tecnico in-app

La superficie **Impostazioni → Evidenze e conformità** rende consultabile un
inventario statico e versionato (`mediflow.compliance-evidence.v1`). Per ogni
ambito mostra:

- evidenze verificabili nel repository;
- limite del claim;
- owner della verifica successiva;
- stato `evidenza nel sorgente`, `evidenza con limite esplicito` oppure
  `valutazione esterna necessaria`.

L'inventario non legge dati clinici, non esegue controlli sul deployment e non
produce un verdetto legale. Le fonti ufficiali esterne — [articolo 25
GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/art_25/oj/eng), [articolo 32
GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng) e [Regolamento
(UE) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en) — sono
input per la valutazione dell'organizzazione, del referente legale e del DPO;
non classificano automaticamente MediFlow o il suo uso concreto.

Il claim ceiling dell'inventario è quindi **solo inventario di evidenze
tecniche**. Configurazione, finalità, ruoli privacy, procedure, classificazione
del sistema AI e adempimenti restano fuori dal suo perimetro.

---

## ⚖️ 1. GDPR e privacy

MediFlow applica misure tecniche coerenti con il principio **Privacy by
Design**. Queste misure possono supportare la protezione dei dati, ma non
certificano da sole la conformità GDPR.

Ruoli e obblighi dipendono da finalità, mezzi e contesto effettivi del singolo
deployment. Il software non assegna automaticamente il ruolo di titolare o
responsabile del trattamento: la valutazione resta in capo all'organizzazione
che usa MediFlow.

### Misure Tecniche di Sicurezza

MediFlow mette a disposizione misure tecniche che possono concorrere alla
protezione richiesta dal contesto operativo:

1. **Cifratura clinica per campo (AES-256-GCM)**: i campi elencati in
   `ENCRYPTED_FIELDS` vengono cifrati lato client prima della persistenza. Il
   file SQLite non è cifrato integralmente: identificativi, alcuni metadati e
   gli artefatti di backup non rientrano tutti nello stesso perimetro
   whole-database verificato.
2. **Chiavi e PIN**: il PIN non viene persistito e la master key viene aperta
   solo nella memoria del client durante la sessione. Questo non equivale a un
   claim zero-knowledge sull'intero database.
3. **Minimizzazione**: telemetria, cloud sync ed egress PHI non sono attivi per
   default.
4. **Local-first**: lo storage autorevole resta sul nodo `home-base`. Client
   paired sulla LAN, cache locali ed export/backup avviati dall'operatore sono
   percorsi espliciti, non eccezioni nascoste.

### Strumenti per i Diritti dell'Interessato

MediFlow offre strumenti che possono aiutare l'operatore a gestire richieste
degli interessati:

* **Cancellazione ed erasure**: il DELETE operativo scrive un tombstone
  reversibile (`deletedAt` / `deletionReason`) con version guard. L'azione admin
  `purge-patient` rimuove il grafo paziente dal database live con dry-run e
  audit `patient.purged`; non raggiunge backup già esportati, che devono essere
  gestiti separatamente. `restore-patient` ripristina un tombstone e registra
  `patient.restored`.
* **Accesso e portabilità**: gli export possono supportare la risposta a una
  richiesta. La loro disponibilità non prova da sola l'adempimento degli
  articoli 17, 20 o 32 né sostituisce la valutazione del caso concreto.

---

## 🔌 2. Export FHIR R4 (v0)

Lo storage interno di MediFlow non è FHIR-native. L'export locale genera una
mappatura **export-only v0** in un `Bundle` FHIR R4 di tipo `collection`.

### Export FHIR

| Risorsa FHIR | Contenuto |
|---|---|
| `Patient` | Campi anagrafici e identificativi selezionati |
| `Condition` | Diagnosi strutturate presenti nel profilo |
| `Encounter` | Una risorsa per ogni voce di diario clinico non eliminata |
| `MedicationStatement` | Terapie, con farmaco rappresentato oggi come testo |
| `Observation` | Scale con punteggio e osservazioni strutturate |

I test correnti verificano il mapping su fixture sintetiche. Non attestano
conformità completa alla base R4, a profili HL7 Italia/FSE, correttezza
terminologica o ingestione da parte di sistemi terzi. L'export è una base di
trasporto limitata ai record mappati, non una garanzia di interoperabilità o
portabilità completa.

---

## 🩺 3. Standard diagnostici (ICD-11)

Un resolver locale ICD-11 opzionale può supportare ricerca e codifica tramite
API OMS locale.

* **Codifica reviewable**: le diagnosi strutturate possono includere un codice;
  i problemi free-text restano ammessi e non sono garantiti come codificati o
  validati.
* **Direzione futura**: più dati strutturati possono ridurre ambiguità nei
  flussi FSE, dopo profili e verifiche dedicate.
