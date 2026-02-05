# ⚖️ Compliance & Interoperabilità

> **GDPR, Privacy e Standard Dati (FHIR).**
> Come MediFlow ti aiuta a dormire sonni tranquilli (legalmente e tecnicamente).

---

## 1. GDPR & Privacy

MediFlow è progettato secondo il principio **Privacy by Design**.
Tuttavia, come medico, tu sei il **Titolare del Trattamento** (Data Controller). Il software è lo strumento.

### Misure Tecniche di Sicurezza

Per aiutarti a rispettare gli obblighi del GDPR (Art. 32), abbiamo implementato:

1. **Cifratura At-Rest (AES-256)**: Se ti rubano il computer, il disco rigido è illeggibile senza il PIN.
2. **Zero-Knowledge**: Il PIN non è salvato da nessuna parte. Non c'è una "backdoor" per recuperare i dati.
3. **Minimizzazione**: Il software non raccoglie telemetria. Nessun dato va a terze parti.
4. **Local-First**: I dati risiedono fisicamente nel tuo studio (sul tuo Mac). Non ci sono server cloud in California o altrove.

### Strumenti per i Diritti dell'Interessato

Il GDPR garantisce ai pazienti certi diritti. Ecco come soddisfarli:

* **Diritto all'Oblio (Art. 17)**: Puoi eliminare un paziente. Il sistema usa una "cancellazione sicura" (dopo 30 giorni nel cestino per sicurezza).
* **Portabilità dei Dati (Art. 20)**: Puoi esportare l'intera storia clinica di un paziente in un formato standard (vedi sotto "FHIR").

---

## 2. Interoperabilità (FHIR R4)

Non vogliamo che i tuoi dati siano "prigionieri" di MediFlow.
Per questo adottiamo lo standard mondiale **HL7 FHIR (Fast Healthcare Interoperability Resources)**.

### Export FHIR

Quando clicchi "Esporta Dati Clinici" nella scheda paziente, generiamo un pacchetto JSON compatibile con lo standard FHIR R4.

**Cosa contiene il pacchetto?**

* **Patient**: Anagrafica.
* **Condition**: Le diagnosi (codificate ICD-11/ICD-9).
* **Encounter**: Le visite effettuate.
* **MedicationStatement**: Le terapie prescritte.
* **Observation**: Note e parametri rilevati.

Questo significa che un domani potrai importare questi dati in qualsiasi altro software ospedaliero o regionale moderno, senza perdere nulla.

---

## 3. Standard Diagnostici (ICD-11)

Abbandoniamo le descrizioni "in testo libero" per le diagnosi.
MediFlow integra il motore ufficiale dell'**OMS (Check WHO ICD-API)**.

* **Precisione**: Ogni diagnosi ha un codice univoco (es. `5A10` per Diabete Mellito tipo 1).
* **Futuro**: Il Fascicolo Sanitario Elettronico (FSE 2.0) richiederà sempre più dati strutturati. Noi siamo già pronti.
