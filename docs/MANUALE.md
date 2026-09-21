# Manuale Operativo MediFlow

> Guida pratica all'avvio locale e alle prime operazioni.

Per orientarti prima dell'avvio o approfondire una scelta:
- [README.md](../README.md) presenta il progetto e il primo accesso;
- [docs/COMPLIANCE.md](./COMPLIANCE.md) raccoglie il quadro privacy/GDPR/FHIR;
- [docs/ROADMAP.md](./ROADMAP.md) descrive la direzione del prodotto.

---

## ⚙️ 1. Installazione e avvio

### Requisiti

* Un computer recente (consigliato: Apple Silicon M1/M2/M3 o successivi).
* Circa 15GB liberi se usi i modelli AI locali.

### Avvio rapido

1. Apri la cartella `mediflow` che hai scaricato.
2. Fai doppio click su `Start_MediFlow.command`.
3. Si apre il Terminale: **non chiuderlo** mentre usi l'app.
4. Dopo l'avvio, apri:
    `http://localhost:3000`

> Se scegli i modelli AI locali, il loro download può allungare la prima
> esecuzione; non sono necessari per usare il gestionale.
> `Start_MediFlow.command` avvia la web app locale, mentre l'eventuale client
> macOS ha un launcher separato.

---

## 🔑 2. Sicurezza e PIN

Al primo avvio MediFlow ti chiede di creare un **Profilo Medico** e un
**PIN**, con cui proteggere l'accesso ai dati cifrati.

### Regola d'oro

Il PIN protegge i dati attraverso la gestione locale della chiave: conservarlo
è quindi essenziale per poterli riaprire.

> [!WARNING]
> **Se perdi il PIN, MediFlow non può aprire i campi clinici cifrati con quella chiave.** Non c'è "recupero password" via email, né un servizio centrale di recupero.

La protezione è a livello di campo, non di intero database: il limite di recupero riguarda le chiavi gestite localmente e i campi che esse proteggono.

---

## 🩺 3. Ambulatori e pazienti

### Ambulatori Multipli

Puoi distinguere le sedi di lavoro creando più ambulatori, per esempio
"Studio Roma" e "Guardia Medica".

* Ogni ambulatorio ha un colore che lo distingue.
* L'assegnazione dei pazienti all'ambulatorio è esplicita.

### Scheda Paziente

Dalla lista, **Apri scheda paziente** porta direttamente alla scheda;
il **Quadro** mostra la stessa vista dentro il cockpit, senza ricaricarne
la rotta.

* **Anagrafica**: a sinistra, per mantenere riconoscibile il paziente.
* **Diario Clinico**: al centro, dove scrivere le note visita per visita.
  Le voci eliminate restano recuperabili e possono essere ripristinate, con
  motivo tracciato; lo stesso vale per terapie, checkup e osservazioni.
* **Storia**: a destra, con i riassunti dei documenti precedenti.

Quando usi l'AI locale, il pannello **Cosa rivedere adesso** raccoglie le
proposte da approvare. Vederle qui non equivale ad averle registrate:
nessuna voce viene scritta in cartella senza la tua conferma.

Per riprendere il lavoro sui casi visibili senza aprire ogni scheda,
la lista pazienti mostra anche una piccola **agenda operativa**: PRIAMO,
valutazioni, visite e follow-up già pianificati nella sezione controlli.

---

## 🤖 4. AI locale (senza internet)

Con le funzioni AI locali abilitate, MediFlow può aiutarti a leggere i
documenti clinici e prepararne sintesi sul computer, senza richiedere
internet per l'elaborazione.

### Caricare un documento

1. Vai nella scheda di un paziente.
2. Clicca su **"Carica Documento"** (PDF o foto).
3. Attendi l'elaborazione.

### Cosa succede?

1. **OCR**: estrae il testo da PDF o immagine. I documenti senza testo entrano
   nella **Coda OCR**, che ne mostra stato e motivo in italiano e permette di
   riprovare; finché il testo non basta, l'AI non avanza proposte cliniche.
2. **Sintesi clinica**: prepara un riassunto strutturato che devi rivedere
   prima di conservarlo. Gli eventuali errori restano visibili.
    * *Esempio*: Un referto ospedaliero di 10 pagine può dare luogo a una sintesi
      come: *"Paziente dimesso dopo polmonite. Terapia: Augmentin per 5gg. Controllo RX tra 1 mese."*
3. **Archiviazione**: documento e sintesi restano associati al paziente,
   così da poterli ritrovare nello stesso contesto.

> [!NOTE]
> L'elaborazione avviene sul tuo computer. Nessun dato paziente viene inviato a servizi cloud di default.

---

## 🩺 5. Terapie e ICD-11

### Terapie

Puoi aggiungere farmaci alla scheda e aggiornare la lista delle terapie
per mantenerla allineata al lavoro sul paziente.

### Diagnosi e resolver ICD-11

La diagnosi può restare un testo libero. Quando è utile affiancarle una
codifica, il resolver OMS ICD-11 può proporre un codice strutturato: il servizio
è opzionale e il suggerimento resta da rivedere prima del salvataggio.

* Inserisci una diagnosi e, quando utile, richiedi un suggerimento codificato
  (es. `5A10`).
* Un codice strutturato può supportare riuso futuro; non garantisce da solo
  validità clinica o interoperabilità.

---

## 🍎 6. App nativa (sperimentale)

Il client nativo Mac è un percorso sperimentale separato: la release 0.8.6
è distribuita come sorgente e il seguito nativo non è necessario per usare
il runtime locale attraverso il browser.

* **Vantaggi**: avvio rapido, integrazione macOS e schermata di blocco con PIN.
* **Come si usa**: avvia lo script `Launch_MediFlowMac.command` nella cartella
  principale, separatamente da `Start_MediFlow.command`.
* **Nota**: la vecchia shell macOS resta una fotografia alpha, mentre il
  lavoro attivo prosegue sul backend/API `home-base`. In caso di problemi
  usa l'interfaccia web, che resta la superficie operativa primaria.

---

## 📚 FAQ

**Posso usarlo su iPad?**
I client dedicati sono in sviluppo. Il computer principale resta la home-base:
iPadOS e iPhone sono in definizione sul contratto locale `/api/v1`, senza
accesso diretto al database remoto. Non sono app complete distribuite con
la release sorgente.

**Se mi si rompe il computer?**
I dati risiedono nel file `medical.db`: usa regolarmente **Esporta Backup**
e conserva il file in un luogo sicuro, per esempio un disco esterno.
In caso di guasto, il ripristino richiede di reinstallare MediFlow e recuperare
backup e PIN.

**È a norma GDPR?**
Cifratura e gestione locale dei dati sono misure tecniche, non una garanzia
complessiva di conformità. La conformità legale dipende anche dalle misure
organizzative e operative con cui usi il sistema.

---
Per supporto, apri una issue o consulta la documentazione tecnica.
