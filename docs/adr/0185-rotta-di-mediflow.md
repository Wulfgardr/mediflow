# ADR 0185: Rotta di MediFlow, un centro e un laboratorio

Data: 2026-11-08. Stato: **Accepted** (decisioni di Leonardo dell'8 novembre 2026).
Supera la sequenza di release 0.9.2-1.0 della [roadmap del 21 settembre](../ROADMAP.md) come
piano di consegna. Non tocca il contratto `/api/v1` né il
[contratto 0.9.1](../releases/0.9.1-contract.md), che resta intero.
Integra [ADR 0180](./0180-athena-fuori-dal-nucleo-modelli-per-dominio.md) e
[ADR 0184](./0184-prove-sul-comportamento-e-vincoli-sul-testo.md).

## Contesto

Tra settembre e novembre 2026 MediFlow ha prodotto moltissimo: circa 2.190 commit dal 1° ottobre e
decine di ADR. La consegna però si è allungata. Lo scopo originale della 0.9.1, il servizio comune per
leggere e scrivere i dati clinici, era raggiunto il 19 ottobre. Tre settimane dopo la versione non era
uscita, perché il contratto aveva assorbito via via altri filoni: GPUI, chat, plugin, intelligenza,
moduli di giurisdizione. Linear contava 158 lavori aperti, 64 dei quali distribuiti in anticipo su sei
versioni future, ciascuna definita da prove da superare e non da qualcosa di nuovo per il medico.

Il progetto stava provando ad essere insieme sette cose:
- lo strumento clinico del suo autore;
- un prodotto per altri medici;
- un laboratorio di intelligenza artificiale;
- una piattaforma per altri programmi;
- un'app per ogni sistema operativo;
- una ricerca grafica;
- un esperimento di sviluppo con agenti.

Tutte competevano per lo stesso treno di release. Una nuova idea aveva un solo modo per entrare: cambiare
il perimetro della versione in corso.

Le domande e le risposte che hanno portato a questa decisione sono raccolte nella pagina di lavoro
dell'8 novembre, fuori dal repository.

## Decisione

### 1. Il centro

**MediFlow è la cartella dei pazienti che il sistema non vede: fatta per il lavoro del suo autore,
aperta a chiunque faccia lo stesso lavoro altrove.**

Il riferimento clinico è la medicina territoriale nelle Case di Comunità e a domicilio, con pazienti
che le cartelle ordinarie non registrano bene:
- persone senza documenti o senza codice fiscale, a volte senza STP o ENI, spesso dalla strada;
- persone senza medico di famiglia, sconosciute al servizio sanitario;
- incontri in fasi acute su cronica: infezioni, cronicità sfuggite di mano, disabilità.

I pazienti tornano. MediFlow conserva una storia clinica che nessun altro sistema tiene, con dati
durevoli, tracciabili, ben codificati ed esportabili in un formato comune (FHIR).

MediFlow resta anche un **laboratorio intelligente**: la codifica dei dati e i percorsi dell'app devono
permettere sempre un'ampia operabilità automatizzata da parte di agenti, oggi e con le tecnologie future.

Chiunque può usare MediFlow. Il lavoro per renderlo installabile da altri si fa quando qualcuno lo chiede.

### 2. La 1.0

La 1.0 arriva quando MediFlow è da mesi la sola cartella del suo autore per questi pazienti, senza
ritorno a carta o ad altri strumenti. Non richiede la qualifica di un secondo medico.

### 3. Come si consegna

- **Giri di due settimane.** Ogni giro ha un solo risultato d'uso, scelto all'inizio. Il resto pronto e
  provato esce insieme, senza promessa.
- **Una sessione fissa di accettazione** a fine giro. Esce ciò che è stato accettato.
- **Il numero di versione si assegna all'uscita.** Le versioni future non hanno contenuto prefissato.
- **Ogni aggiunta a un giro in corso dice cosa toglie.** Altrimenti va nel quaderno delle idee. Fa
  eccezione un danno che blocca il lavoro clinico.
- **Verifica su tre livelli:**
  1. ogni modifica, con test sul comportamento (ADR 0184), integrità dei dati, sicurezza e recupero;
  2. un pacchetto che esce verso altri, con installazione da zero e prova d'uso;
  3. l'ammissione all'uso clinico, che resta una decisione separata.
- **Agenti:** di norma una lane di prodotto e una di ricerca. L'impiego si adatta alla quantità di idee e
  all'uso disponibile.
- **Decisioni in cinque righe:** cosa si sceglie, cosa resta fuori, quale prova chiude, quanto costa,
  quando si può riaprire.

### 4. La casa delle idee

Linear è la casa delle idee e dello sviluppo di MediFlow.
- **Quaderno delle idee.** Un progetto senza versione. Ogni idea ha quattro righe: problema osservato,
  chi lo vive, beneficio atteso, prova minima.
- **Ingresso nei giri.** All'inizio di ogni giro entrano al massimo due idee nuove.
- **Come si scrive in Linear.** Prima per chi non programma, poi con dettaglio tecnico progressivo in
  fondo. Agli agenti bastano la direzione e le informazioni essenziali.
- **Altri prodotti.** Escono da Linear e sono archiviati altrove.

### 5. La strada

- **Prima la 0.9.1, a contratto intero,** compresa la revisione dell'import dossier in GPUI. Non si
  congela un perimetro ridotto.
- **Primo giro dopo la 0.9.1: registrare in fretta.** Il lavoro con questi pazienti segue due modi,
  e MediFlow deve sostenerli entrambi:
  - **modo pulito:** una bozza preparata durante la visita da uno scriba, confermata in pochi gesti;
  - **modo «sporco»:** la visita avviene fuori dall'app, poi impegnative, certificati e referti prodotti
    altrove vengono assorbiti dall'import dossier (lazy import). Saper estrarre tutto da quei documenti
    è il primo requisito.
- **Giri candidati successivi, in ordine:**
  1. il paziente senza codici, dal primo contatto;
  2. presa in carico e passaggio al medico di famiglia, con un riassunto ufficiale al posto della mail
     di raccordo;
  3. una traccia delle vaccinazioni registrate su Arvax;
  4. condizioni sociali codificate (ICD-11, anche in inglese), persone presenti alla visita con ruolo,
     lingua e mediatore;
  5. documenti senza fatica;
  6. terapia: cosa è cambiato dall'ultima visita, compresi i farmaci proposti e non ancora iniziati;
  7. altri possono installarlo.
- **Superfici.** Il Web sul Mac e le app Apple fuori studio sono le superfici principali. GPUI passa
  alla ricerca: si sviluppa senza che una versione la aspetti.
- **Orizzonte senza data.** Il passaggio a Rust, la distribuzione completa su tutti i sistemi, lo
  scambio FHIR avanzato (SMART, Bulk Data, CDS Hooks, scrittura verso sistemi esterni) e i piloti
  regionali. FHIR resta nel centro per l'esportazione fedele e per il riassunto al passaggio.
- **Fuori dal perimetro.** L'assistenza domiciliare integrata ha il suo sistema regionale (SGDT).
  MediFlow può offrire un collegamento diretto al paziente in quel sistema.

### 6. Intelligenza

Conferma ADR 0180 e la forma a cascata del piano del 7 novembre:
- regole e cataloghi al tronco, modelli piccoli come foglie, un modello grande facoltativo;
- intelligenza portata dall'utente: un modello locale, un abbonamento, o entrambi.

Sono ammesse:
- la misura su documenti reali, sul computer del medico, con i soli numeri aggregati fuori;
- l'addestramento locale di modelli privati e non pubblicati;
- controlli terapeutici a regole esplicite e citate, previa verifica delle licenze delle fonti.

Ogni tentativo di prompt injection in un documento va segnalato all'utente, con un'indicazione sul
paziente e una via di escalation.

## Conseguenze

- I progetti Linear 0.9.2-0.9.7 e 1.0 diventano orizzonte senza numero. Le issue restano con la loro storia.
- La roadmap del 21 settembre resta come cronologia. Questa rotta la sostituisce come piano di consegna.
- Il contratto 0.9.1 non cambia perimetro. L'emendamento dell'8 novembre registra le decisioni sulle righe aperte.
- Nessun impatto sul runtime, sullo schema o sul contratto `/api/v1`.
