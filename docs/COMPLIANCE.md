# Compliance e interoperabilità

> Misure tecniche, evidenze disponibili e valutazioni che restano al contesto d’uso.

Riferimenti correlati:

- [SECURITY.md](../SECURITY.md) (sicurezza e oscuramento dei dati identificativi)
- [ARCHITECTURE.md](../ARCHITECTURE.md) (confini architetturali stabili)
- [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) (roadmap terminologie/FSE)
- [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md) (mappa documentale)

---

## Inventario tecnico in-app

Per valutare un impiego di MediFlow occorre distinguere ciò che il sorgente
mostra da ciò che va verificato nell’organizzazione che lo adotta. La superficie
**Impostazioni → Evidenze e conformità** raccoglie il primo insieme in un
inventario statico e versionato (`mediflow.compliance-evidence.v1`). Per ogni
ambito rende visibili:

- evidenze verificabili nella repository;
- limite di ciò che quelle evidenze permettono di affermare;
- responsabile della verifica successiva;
- stato `evidenza nel sorgente`, `evidenza con limite esplicito` oppure
  `valutazione esterna necessaria`.

L’inventario non legge dati clinici e non controlla l’installazione in uso;
non può quindi produrre un verdetto legale. Le fonti ufficiali esterne —
[GDPR, testo consolidato corrente](https://eur-lex.europa.eu/eli/reg/2016/679),
in particolare articoli 25 e 32, e
[AI Act, testo consolidato corrente](https://eur-lex.europa.eu/eli/reg/2024/1689)
— servono alla valutazione dell’organizzazione, del referente legale e del DPO,
non classificano automaticamente MediFlow o il suo impiego concreto.

Il limite è dunque **solo inventario di evidenze tecniche**. Configurazione,
finalità, ruoli privacy, procedure, classificazione del sistema AI e
adempimenti devono essere valutati al di fuori di questa superficie.

La [matrice regolatoria del 6 settembre 2026](./analysis/2026-09-06-086-regulatory-evidence.md)
registra, a quella data, versioni, calendario, evidenze statiche e lacune per
la 0.8.6. Include la modifica dell’AI Act introdotta dal Regolamento (UE)
2026/1744 e distingue i controlli tecnici dai documenti adottati nel progetto
e dagli adempimenti dell’installazione concreta. Il dossier resta candidato:
la revisione competente non è chiusa.

---

## ⚖️ 1. GDPR e privacy

La protezione dei dati deve entrare nelle scelte progettuali: è il senso del
principio **Privacy by Design** a cui si riferiscono le misure tecniche di
MediFlow. Queste misure aiutano a proteggere le informazioni, ma non certificano
da sole la conformità GDPR.

Per stabilire ruoli e obblighi occorre conoscere finalità, mezzi e contesto
effettivi del singolo impiego. Il software non assegna automaticamente il ruolo
di titolare o responsabile del trattamento; questa valutazione resta
all’organizzazione che lo usa.

### Misure Tecniche di Sicurezza

Le misure disponibili rispondono a esigenze diverse e vanno lette con i loro
limiti, perché la protezione richiesta dipende dal contesto operativo:

1. **Cifratura clinica per campo (AES-256-GCM)**: i campi elencati in
   `ENCRYPTED_FIELDS` vengono cifrati lato client prima della persistenza. Il
   file SQLite non è cifrato integralmente: identificativi, alcuni metadati e
   artefatti di backup non rientrano tutti in una protezione verificata
   dell’intero database.
2. **Chiavi e PIN**: il PIN non viene persistito e la master key viene aperta
   solo nella memoria del client durante la sessione. Questo non equivale a un
   claim zero-knowledge sull'intero database.
3. **Minimizzazione**: telemetria, cloud sync ed egress PHI non sono attivi per
   default.
4. **Local-first**: lo storage autorevole resta sul nodo `home-base`. Client
   paired sulla LAN, cache locali ed export/backup avviati dall'operatore sono
   percorsi espliciti, non eccezioni nascoste.

### Strumenti per i Diritti dell'Interessato

Gli strumenti applicativi possono aiutare a rispondere alle richieste degli
interessati, purché non se ne confonda la disponibilità con l’adempimento
completo della richiesta:

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

MediFlow conserva i dati nel proprio modello interno, non in un archivio
FHIR-native. Per esportarli localmente dispone di una mappatura
**export-only v0**, che genera un `Bundle` FHIR R4 di tipo `collection` con le
risorse descritte di seguito.

### Export FHIR

| Risorsa FHIR | Contenuto |
|---|---|
| `Patient` | Campi anagrafici e identificativi selezionati |
| `Condition` | Diagnosi strutturate presenti nel profilo |
| `Encounter` | Una risorsa per ogni voce di diario clinico non eliminata |
| `MedicationStatement` | Terapie, con farmaco rappresentato oggi come testo |
| `Observation` | Scale con punteggio e osservazioni strutturate |

I test verificano la mappatura su dati sintetici. Questo permette di controllare
come i record selezionati vengano trasformati, ma non attesta la conformità
completa alla base R4 o ai profili HL7 Italia/FSE, la correttezza terminologica
né l’acquisizione da parte di sistemi terzi. L’export offre quindi una base di
trasporto per i soli record mappati, non una garanzia di interoperabilità o di
portabilità completa.

---

## 🩺 3. Standard diagnostici (ICD-11)

La ricerca e la codifica possono avvalersi di un resolver ICD-11 locale e
facoltativo, attraverso l’API OMS locale. Le diagnosi strutturate possono così
includere un codice da rivedere, senza rendere obbligatoria la codifica di ogni
problema: il testo libero resta ammesso e non è garantito come codificato o
validato.

Una maggiore strutturazione dei dati potrà ridurre le ambiguità nei flussi FSE,
ma resta una direzione futura, subordinata a profili e verifiche dedicate.
