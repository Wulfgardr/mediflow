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

Verifica e ripristino accettano il backup completo anche quando supera la
dimensione di un singolo allegato. Il file viene elaborato interamente in
memoria: per archivi grandi serve memoria libera sufficiente sul computer.

All'apertura su macOS e Linux, MediFlow limita al proprietario l'accesso a
`medical.db` e ai file di lavoro SQLite `-wal` e `-shm`. Non modifica file
di altri utenti o collegamenti simbolici, che impediscono l'apertura.
Se non riesce a verificare o correggere questi permessi, l'apertura si ferma:
conserva l'archivio e i file di lavoro, senza eliminarli per forzare l'avvio.
Se hai scelto una cartella dati personalizzata, assicurati che sia accessibile
solo al tuo utente prima di allegare originali al repertorio protesico.

**È a norma GDPR?**
Cifratura e gestione locale dei dati sono misure tecniche, non una garanzia
complessiva di conformità. La conformità legale dipende anche dalle misure
organizzative e operative con cui usi il sistema.

---
Per supporto, apri una issue o consulta la documentazione tecnica.


## Fonti personali della protesica

In Repertori, Protesica e ausili mostra il numero di fonti e voci locali.
Apri Gestisci fonti per importare un listino o nomenclatore della tua ATS/ASL
oppure un elenco aziendale. Non è un catalogo normativo completo e MediFlow
non verifica eleggibilità, validità prescrittiva o attualità della fonte.

1. Esporta l’eventuale foglio Excel in CSV UTF-8. XLSX non è letto direttamente.
2. Scegli il file (massimo 2 MiB e 20.000 righe), indica virgola o punto e virgola
   e associa esplicitamente le otto colonne. Le colonne delle date possono
   contenere celle vuote. Codifica, codice, descrizione, versione, fonte e ambito
   sono obbligatori; ogni file dichiara una sola fonte/versione/ambito/codifica.
3. Indica ente, data e note se utili. Genera una nuova anteprima dopo qualsiasi
   modifica alla mappatura o ai metadati. Controlla campione, errori e conteggi,
   accetta la fonte e conferma. Duplicati o errori bloccano tutto il file.
4. In Fonti e originali allega PDF o altri documenti senza dati dei pazienti.
   Puoi indicare pagina o sezione. Massimo 25 MiB per originale, 100 MiB e 1.000
   documenti complessivi. Gli originali sono aggiuntivi e non sostituibili dalla UI.
   Il collegamento scarica il documento per aprirlo con l’applicazione locale.

Fonti diverse con lo stesso codice convivono. A parità di nome, versione e
ambito l’import aggiorna la fonte esistente; una versione diversa crea una
fonte distinta. I codici assenti dal file restano. I dati precedenti sono
migrati in fonti derivate dai campi già presenti, senza recuperare voci che
fossero state sovrascritte prima dell’aggiornamento.

Nella nuova prescrizione cerca e filtra per fonte, poi premi Usa voce nella
bozza. Il codice mantiene la propria codifica e non compila automaticamente
il campo ISO. Salva solo dopo la revisione clinica. Una revisione cambiata
richiede una nuova scelta. Modificare manualmente la descrizione nella bozza
annulla la selezione dal catalogo. La prescrizione conserva uno snapshot della
voce, dei metadati del suo import e dei riferimenti agli originali allegati a
quell’import al momento del salvataggio; gli import successivi non lo modificano. Le prescrizioni precedenti restano
leggibili e non ricevono provenienze ricostruite automaticamente.

Originali, catalogo e snapshot di provenienza sono in chiaro nel database
locale; la descrizione clinica segue la cifratura dei campi esistenti. Il backup
web e quello schedulato includono gli originali conservati come BLOB SQLite;
il ripristino è atomico. Se un originale referenziato manca o non corrisponde
a fonte, import, hash o dimensione dichiarati, il backup e il ripristino sono
rifiutati prima di modificare l’archivio di destinazione.
Un originale mancante o alterato non viene restituito come verificato. Gli
aggiornamenti degli originali richiedono una nuova allegazione esplicita.

I codici assenti da un nuovo import conservano i metadati e gli originali del
proprio import. I nuovi allegati appartengono all'import corrente della fonte.
Ridurre il limite configurato per gli upload non impedisce di scaricare gli
originali già conservati. Il client Apple attuale ignora lo snapshot di
provenienza e non offre la gestione delle fonti.

## Catalogo farmaci AIFA

In **Impostazioni > Repertori**, abilita **Consenti verifiche e download del
catalogo pubblico AIFA via Internet** per permettere l'accesso alla fonte
ufficiale. Senza consenso puoi continuare a consultare il catalogo locale e
caricare un CSV già scaricato. La condivisione in rete locale non abilita
questo accesso Internet.

Quando apri Repertori o le relative impostazioni, MediFlow controlla le sole
intestazioni del file AIFA, al massimo ogni 24 ore, anche dopo un riavvio.
Mostra «Aggiornamento disponibile», «Nessuna variazione» oppure «Verifica non
disponibile». Un controllo fallito non svuota il catalogo. Per cataloghi
importati in precedenza può mancare una data AIFA confrontabile: aggiornarli
esplicitamente permette di acquisirla.

**Aggiorna ora** scarica e valida il CSV. La data AIFA indica la pubblicazione
dichiarata dal server; la data di scarico indica l'acquisizione locale. Il
catalogo cambia solo dopo il completamento dei controlli. Il progresso mostra
i byte ricevuti, poi la validazione. Se AIFA risponde che il file non è cambiato,
non viene sostituito. Annullare richiede comunque di rileggere lo stato, perché
la richiesta potrebbe essere già stata completata.

Una riduzione sotto il 90% delle confezioni locali richiede una conferma
aggiuntiva. Il catalogo viene conservato finché non confermi; per aggiornamenti
via Internet il file viene scaricato nuovamente e deve essere identico a quello
controllato e il catalogo locale deve essere rimasto invariato. La verifica
vale anche se il secondo file non presenta più una riduzione sotto soglia.
Se file o catalogo sono cambiati, rileggi lo stato e ripeti l'operazione.
Gli altri errori di validazione non possono essere forzati.

Durante una verifica o importazione, altri caricamenti e lo svuotamento del
catalogo vengono rifiutati come operazione già in corso. Attendi il termine
e ripeti l'azione.

Il CSV deve contenere AIC, denominazione, ATC e principi attivi. La copertura
è descrittiva e parziale: FORNITURA e STATO_AMMINISTRATIVO non sono conservati;
fascia e prezzo non sono presenti nel feed corrente. I dati non certificano
rimborsabilità, disponibilità o appropriatezza. Ogni sostituzione AIFA riuscita
conserva provenienza e audit locale. Nessun dato clinico viene inviato ad AIFA.
