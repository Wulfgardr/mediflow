# Manuale Operativo MediFlow

> Guida pratica per partire in pochi minuti.

Riferimenti utili:
- [README.md](../README.md) (onboarding rapido progetto)
- [docs/COMPLIANCE.md](./COMPLIANCE.md) (quadro privacy/GDPR/FHIR)
- [docs/ROADMAP.md](./ROADMAP.md) (direzione prodotto)

---

## 1. Installazione e avvio

### Requisiti

* Un computer recente (consigliato: Apple Silicon M1/M2/M3 o successivi).
* **Docker Desktop** (solo per i servizi opzionali come ICD-11).
* Circa 15GB liberi se usi i modelli AI locali.

### Avvio rapido

1. Apri la cartella `mediflow` che hai scaricato.
2. Fai doppio click su `Start_MediFlow.command`.
3. Si apre il Terminale: **non chiuderlo** mentre usi l'app.
4. Dopo l'avvio, apri:
    `http://localhost:3000`

> La prima esecuzione può richiedere più tempo per il download dei modelli AI.
> `Start_MediFlow.command` avvia la web app locale; l'eventuale client macOS segue un launcher separato.

---

## 2. Sicurezza e PIN

Al primo avvio ti chiederò di creare un **Profilo Medico** e un **PIN**.

### Regola d'oro

Il PIN è la chiave che protegge i dati.

* **Se perdi il PIN, perdi i dati.**
* Non c'è "recupero password" via email.
* Non c'è un server centrale che può aiutarti.

Questo è il prezzo di una privacy forte: controllo totale, ma nessuna backdoor.

---

## 3. Ambulatori e pazienti

### Ambulatori Multipli

Puoi creare più ambulatori (es. "Studio Roma", "Guardia Medica").

* Ogni ambulatorio ha un colore.
* I pazienti possono essere assegnati in modo esplicito.

### Scheda Paziente

È tutto in una pagina.

* **Anagrafica**: A sinistra.
* **Diario Clinico**: Al centro. Scrivi le note visita per visita.
* **Storia**: A destra vedi i riassunti dei vecchi documenti.

La lista pazienti mostra anche una piccola **agenda operativa** sui casi visibili:
PRIAMO, valutazioni, visite e follow-up già pianificati nella sezione controlli.

---

## 4. AI locale (senza internet)

MediFlow può leggere documenti clinici e produrre sintesi direttamente in locale.

### Caricare un documento

1. Vai nella scheda di un paziente.
2. Clicca su **"Carica Documento"** (PDF o foto).
3. Attendi l'elaborazione.

### Cosa succede?

1. **OCR**: estrae testo da PDF o immagine.
2. **Sintesi clinica**: produce un riassunto strutturato.
    * *Esempio*: Invece di leggere 10 pagine di referto ospedaliero, vedrai: *"Paziente dimesso dopo polmonite. Terapia: Augmentin per 5gg. Controllo RX tra 1 mese."*
3. **Archiviazione**: documento e sintesi restano associati al paziente.

> L'elaborazione avviene sul tuo computer. Nessun dato paziente viene inviato a servizi cloud di default.

---

## 5. Terapie e ICD-11

### Terapie

Puoi aggiungere farmaci e mantenere una lista terapie aggiornata.

### Diagnosi (ICD-11)

Le diagnosi usano lo standard OMS ICD-11.

* Inserisci una diagnosi e ottieni suggerimenti codificati (es. `5A10`).
* Risultato: più precisione clinica e migliore interoperabilità.

---

## 6. App nativa (sperimentale)

Se lavori su Mac, puoi usare anche il client nativo.

* **Vantaggi**: avvio rapido, integrazione macOS, lock screen con PIN.
* **Come si usa**: Avvia lo script `Launch_MediFlowMac.command` nella cartella principale, separatamente da `Start_MediFlow.command`.
* **Nota**: il vecchio shell macOS resta uno snapshot alpha mentre il lavoro attivo prosegue sul backend/API `home-base`. In caso di problemi usa l'interfaccia web, che resta la superficie operativa primaria.

---

## FAQ

**Posso usarlo su iPad?**
Stiamo lavorando ai client dedicati. Per ora il computer principale resta l'home base; iPadOS e iPhone sono in definizione sopra il contratto locale `/api/v1`, senza accesso diretto al database remoto.

**Se mi si rompe il computer?**
I dati sono nel file `medical.db`.
Usa **Esporta Backup** regolarmente e conserva il file in una posizione sicura (es. disco esterno). In caso di guasto, reinstalli MediFlow e ripristini backup + PIN.

**È a norma GDPR?**
MediFlow implementa misure tecniche forti (cifratura, local-first). La conformità legale completa dipende anche dalle tue misure organizzative e operative.

---
Per supporto, apri una issue o consulta la documentazione tecnica.
