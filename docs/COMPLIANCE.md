# Compliance e interoperabilità

> GDPR, privacy e standard clinici in pratica.

Riferimenti correlati:

- [SECURITY.md](../SECURITY.md) (policy sicurezza e redazione)
- [ARCHITECTURE.md](../ARCHITECTURE.md) (confini architetturali stabili)
- [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) (roadmap terminologie/FSE)
- [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md) (mappa documentale)

---

## ⚖️ 1. GDPR e privacy

MediFlow segue il principio **Privacy by Design**.
Nel contesto clinico, il medico resta il **Titolare del Trattamento**: il software è uno strumento, non un sostituto delle responsabilità.

### Misure Tecniche di Sicurezza

Per supportare gli obblighi GDPR (Art. 32), MediFlow implementa:

1. **Cifratura at-rest (AES-256)**: senza PIN i dati non sono leggibili.
2. **Zero-knowledge**: il PIN non viene salvato e non esistono backdoor di recupero.
3. **Minimizzazione**: niente telemetria e nessun egress di default verso terze parti.
4. **Local-first**: i dati restano sul dispositivo del professionista.

### Strumenti per i Diritti dell'Interessato

Il GDPR garantisce diritti specifici ai pazienti. In MediFlow:

* **Diritto all'oblio (Art. 17)**: la cancellazione del paziente scrive un tombstone reversibile (`deletedAt` / `deletionReason`) con version guard, senza orfanare i figli clinici. L'erasure GDPR esplicita è l'azione admin `purge-patient`, con dry-run e audit `patient.purged`; il ripristino è `restore-patient`, con audit `patient.restored`.
* **Portabilità dei dati (Art. 20)**: puoi esportare la storia clinica in formato interoperabile (vedi sotto).

---

## 🔌 2. Interoperabilità (FHIR R4)

MediFlow adotta **HL7 FHIR R4** per evitare lock-in e facilitare integrazione/export.

### Export FHIR

Con l'export clinico viene generato un pacchetto JSON compatibile FHIR R4.

| Risorsa FHIR | Contenuto |
|---|---|
| `Patient` | Anagrafica |
| `Condition` | Diagnosi (codificate ICD-11/ICD-9) |
| `Encounter` | Visite effettuate |
| `MedicationStatement` | Terapie prescritte |
| `Observation` | Note e parametri rilevati |

Obiettivo: mantenere i dati riusabili anche fuori da MediFlow.

---

## 🩺 3. Standard diagnostici (ICD-11)

Le diagnosi non restano solo testo libero: MediFlow integra ICD-11 via API OMS locale.

* **Precisione clinica**: ogni diagnosi ha codice univoco (es. `5A10`).
* **Interoperabilità futura**: più dati strutturati, meno ambiguità nei flussi FSE.
