# Importazione CSV delle anagrafiche su Apple

Il comando **Importa CSV**, nell’elenco pazienti condiviso da Mac, iPhone e
iPad, legge il file sul dispositivo e mostra un’anteprima prima di salvare.
Richiede una sessione operatore online, la chiave dei campi protetti,
un ambulatorio selezionato e il permesso paired di creazione pazienti.

Il modello scaricabile usa UTF-8, intestazione nella prima riga e separatore
punto e virgola:

```csv
nome;cognome;codice_fiscale;data_nascita;indirizzo;telefono
```

Le sei colonne e il loro ordine coincidono con il percorso web. Nome e cognome
richiedono almeno due caratteri; il codice fiscale richiede 16 caratteri
alfanumerici ASCII ed è normalizzato in maiuscolo. Data di nascita, indirizzo
e telefono possono essere vuoti. La data deve essere un giorno reale nel
formato `YYYY-MM-DD`. I campi fra virgolette possono contenere il separatore
e virgolette raddoppiate; solo l’indirizzo può contenere righe a capo.

Sono ammessi al massimo 2 MiB, 500 righe di dati, 4096 unità UTF-16 per record
e 1024 per cella. I limiti dei campi sono rispettivamente 100, 100, 64, 10,
500 e 80 unità UTF-16. Errori strutturali interrompono la lettura dell’intero
file; gli errori di campo escludono le singole righe e restano visibili
nell’anteprima. Tutte le occorrenze di un codice fiscale ripetuto nel file
sono escluse. Sono escluse anche le anagrafiche già presenti nell’ambulatorio,
comprese quelle archiviate e nel cestino.

L’anteprima scade dopo cinque minuti. Serve la conferma esplicita della
revisione; prima di inviare viene riletta la lista delle anagrafiche esistenti.
La destinazione è fissata nel cookie e nel payload di ogni creazione. Il
percorso usa `POST /api/v1/network/patients`, con le credenziali paired e la
sessione operatore, e cifra indirizzo e telefono prima dell’invio. Non usa
SQLite direttamente e non introduce un endpoint bulk. Restano applicabili
le protezioni e l’audit transazionale del servizio canonico.

Ogni riga idonea riceve un UUID distinto. Gli invii sono sequenziali e
l’importazione non è una transazione unica: interrompere il lavoro non
annulla le schede già create. Un cambio di paziente, ambulatorio, sessione
o contesto del workspace invalida l’anteprima e ferma gli invii successivi.
L’interruzione durante un invio attende il suo esito; non dichiara annullata
una scrittura già partita.

Gli esiti distinguono **confermata**, **esito sconosciuto**, **non inviata**,
**esclusa** e **osservata nella rilettura**. Una risposta persa o inattesa ferma
il lotto e non causa un nuovo tentativo. La verifica successiva esegue solo
una lettura e cerca l’UUID assegnato: un record trovato è osservato nella
rilettura; un record non trovato conserva l’esito sconosciuto, perché la sua
assenza non dimostra un annullamento. Gli esiti rimangono nella memoria della
finestra corrente. Prima di chiudere l’app occorre annotare gli identificativi
ancora da verificare. Dopo un cambio di contesto il contenuto dell’anteprima
viene cancellato e la ricevuta non viene mostrata nel nuovo contesto.

La protezione contro la ripetizione dello stesso UUID appartiene al writer
esistente. L’unicità del codice fiscale fra creazioni simultanee indipendenti
non è una garanzia del servizio: due client possono superare entrambi il
controllo preliminare prima che una delle due creazioni sia visibile.

Le prove sono distinte: `PatientCSVImportTests` esercita parser, anteprima,
conferma, cifratura, invalidazione, interruzione e risposta incerta con
trasporti controllati; `test:network:home-base-patient-lifecycle-write` esercita
il servizio HTTP reale in un archivio sintetico isolato. Le build macOS e iOS
verificano la compilazione. Queste prove non attestano da sole il percorso
interattivo completo del selettore file su ogni dispositivo Apple.
