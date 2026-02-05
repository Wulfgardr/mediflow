# 🩺 Manuale Operativo MediFlow

> **Guida rapida per usare la cartella clinica senza impazzire.**

---

## 🚀 1. Installazione e Avvio

Non serve chiamare un tecnico. Se sai usare il mouse, puoi farcela.

### Requisiti

* Un Mac recente (con chip M1, M2, M3...).
* **Docker Desktop** installato (è un programma che fa girare "i motori" sotto il cofano).
* Circa 15GB di spazio libero (per l'Intelligenza Artificiale).

### Come partire

1. Apri la cartella `mediflow` che hai scaricato.
2. Fai doppio click su `Start_MediFlow.command`.
3. Si aprirà una finestra nera (Terminale): **non chiuderla**. È il cuore del sistema.
4. Dopo un po', si aprirà automaticamente il tuo browser su questa pagina:
    `http://localhost:3000`

> **Nota**: La prima volta ci metterà un po' perché deve scaricare i "cervelli" dell'AI. Vai a prenderti un caffè.

---

## 🔐 2. Sicurezza e PIN

Al primo avvio ti chiederò di creare un **Profilo Medico** e un **PIN**.

### Regola d'oro del PIN

**Non dimenticarlo.** Scrivilo su carta, mettilo in cassaforte, tatuatelo (scherzo, ma quasi).

MediFlow usa il tuo PIN per mescolare digitalmente tutti i dati.

* **Se perdi il PIN, perdi i dati.**
* Non c'è "recupero password" via email.
* Non c'è un server centrale che può aiutarti.

È l'unico modo per garantirti che nemmeno io (o un hacker, o la polizia) possiamo leggere le tue cartelle senza il tuo permesso.

---

## 🗂 3. Ambulatori e Pazienti

### Ambulatori Multipli

Lavori in più studi? O magari fai guardia medica e studio privato?
Puoi creare diversi "Ambulatori" (es. "Studio Roma", "Guardia Medica").

* Ogni ambulatorio ha il suo colore.
* I pazienti sono assegnati a un ambulatorio, così non fai confusione.

### Scheda Paziente

È tutto in una pagina.

* **Anagrafica**: A sinistra.
* **Diario Clinico**: Al centro. Scrivi le note visita per visita.
* **Storia**: A destra vedi i riassunti dei vecchi documenti.

---

## 🤖 4. Usare l'AI (Senza internet)

Questa è la parte magica. MediFlow ha un'intelligenza artificiale integrata che legge per te.

### Caricare un documento

1. Vai nella scheda di un paziente.
2. Clicca su **"Carica Documento"** (PDF o foto).
3. Aspetta qualche secondo.

### Cosa succede?

1. **Lettura (OCR)**: Il sistema legge il testo, anche se è una foto storta fatta col cellulare.
2. **Sintesi**: L'AI analizza il testo e ti crea un riassunto clinico.
    * *Esempio*: Invece di leggere 10 pagine di referto ospedaliero, vedrai: *"Paziente dimesso dopo polmonite. Terapia: Augmentin per 5gg. Controllo RX tra 1 mese."*
3. **Archiviazione**: Il documento originale e il riassunto sono salvati per sempre.

> **Tranquillo**: Tutto questo calcolo avviene sul tuo Mac. Nessun dato viene inviato a Google, OpenAI o altri. Privacy totale.

---

## 💊 5. Terapie e ICD-11

### Terapie

Puoi aggiungere farmaci. Il sistema cercherà di ricordarsi cosa prende il paziente e generare l'elenco aggiornato da stampare o inviare.

### Diagnosi (ICD-11)

Usiamo lo standard mondiale dell'OMS (ICD-11).

* Scrivi "Diabete" e ti suggerirà i codici corretti (es. `5A10`).
* Serve per essere precisi e pronti per il futuro fascicolo sanitario.

---

## 🍏 6. App Nativa (Sperimentale)

Sei un utente Mac avanzato? Puoi provare la nostra applicazione nativa sperimentale.

* **Vantaggi**: Più veloce, si apre nel Dock, ha il blocco schermo con PIN integrato.
* **Come si usa**: Avvia lo script `Launch_MediFlowMac.command` nella cartella principale.
* **Nota**: È ancora in fase di sviluppo ("Alpha"). Se qualcosa non va, torna a usare il browser.

---

## ❓ FAQ (Domande Frequenti)

**Posso usarlo su iPad?**
Stiamo lavorando a un'app dedicata. Per ora, devi usare il Mac.

**Se mi si rompe il computer?**
I dati sono nel file `medical.db`.
Vai nelle Impostazioni e fai **"Esporta Backup"** regolarmente. Salva quel file su una chiavetta USB. Se il computer muore, reinstalli MediFlow su uno nuovo, importi il backup, rimetti il PIN ed è come non fosse successo nulla.

**È a norma GDPR?**
Tecnicamente sì (cifratura, dati locali). Legalmente, dipende da come gestisci tu il computer (password del Mac, chi accede allo studio, ecc.). Usalo con buonsenso professionale.

---
*Serve altro aiuto? Chiedi a Leo.*
