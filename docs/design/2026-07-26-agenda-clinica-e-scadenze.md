# Agenda clinica: dai controlli alle scadenze terapeutiche

Data: 2026-07-26
Stato: **intento di prodotto**, dettato da Leonardo e trascritto in questa nota.
Non è implementato. Le osservazioni tecniche derivano dalla lettura del codice
alla data indicata.

## Da dove si parte

L'agenda nasce legata a Zimbra, ma rimuovere o rimodellare quel legame non
significa soltanto cambiare connettore. Un calendario aziendale dice quando
è previsto un appuntamento; il lavoro clinico richiede anche di sapere quando
**una decisione clinica scade**. È questa seconda domanda a orientare la
proposta.

## Cosa deve diventare

La vista proposta deve riunire quattro famiglie di scadenze che, nella
ricognizione di partenza, risultano disperse o assenti:

1. **Visite di controllo.** Esistono già come `checkups` e sono lette dall'agenda.
2. **Rivalutazioni.** Indicano quando occorra riesaminare un quadro, ma non
   hanno ancora una collocazione propria.
3. **Fine di una terapia.** Una copertura antibiotica prescritta il giorno X
   finisce il giorno Y; quella scadenza, nella situazione esaminata, resta
   affidata alla memoria di chi ha prescritto.
4. **Sospensione di un farmaco.** Quando un cardiotropo va sospeso prima di
   un esame, servono sia il promemoria della sospensione **sia** quello della
   ripresa, perché il rischio clinico riguarda entrambi gli estremi.

Leonardo riassume così l'intento: sapere **quando ho prescritto qualcosa e
quando lo devo rimuovere.**

<a id="perche-non-e-un-calendario"></a>

## Perché non è un calendario

Un appuntamento ha una data che si rispetta o si sposta. La scadenza
terapeutica nasce invece da **una decisione già presa**: spostarla richiede
di riesaminare quella decisione. La vista deve quindi mostrare insieme i due
oggetti senza confonderli; condividere lo spazio non significa condividere
la semantica.

Le scadenze rimangono perciò in MediFlow. EventKit ne offre una
**proiezione**, utile per vederle accanto agli altri impegni, ma il calendario
ordinario non diventa il luogo che le governa e non deve poterle contraddire.

## Come atterra sul codice esistente

Le osservazioni seguenti si riferiscono al codice letto alla data della nota.

- `AgendaWorkspaceModel` (`ClinicalWorkspaceViews.swift`) legge soltanto
  `fetchScopedCheckups` e i pazienti necessari a risolvere i nomi; non legge
  le scadenze terapeutiche.
- Le terapie hanno un percorso proprio, `fetchScopedTherapies`, e una sezione
  per paziente, ma manca la nozione di **fine**: il modello contiene stato,
  dosaggio e motivazione, non una data di scadenza.
- Il primo cambiamento riguarda quindi il dato, prima dell'interfaccia:
  una terapia deve poter dichiarare quando finisce e una sospensione quando
  comincia e quando termina.
- La rotta `/api/v1/network/checkups` esiste con la capability
  `network.replica.readonly-agenda`. Per mostrare anche le terapie, l'agenda
  dovrà attraversare `network.replica.readonly-therapies`: occorre estendere
  il controllo preventivo introdotto nella ricognizione, altrimenti la vista
  supera il proprio controllo di accesso e fallisce alla seconda lettura.
  È lo stesso difetto già trovato su Agenda e Diario globale con `includeDeleted`.

## Vincoli che valgono comunque

- **Nessuna scadenza clinica può essere inventata dall'interfaccia.** Se chi
  prescrive non ha dichiarato la data di fine, l'agenda ne segnala l'assenza:
  non la deduce dalla posologia.
- **Uno stato non letto non è uno stato vuoto.** Come nelle tre viste corrette
  nella ricognizione, l'agenda non può dichiarare assenza di scadenze se non
  ha letto l'archivio delle terapie.
- **EventKit chiede un permesso.** L'agenda deve funzionare per intero anche
  senza quel permesso; la proiezione sul calendario deve essere una scelta
  esplicita, non il passaggio che abilita la funzione.
- **Niente PHI nel calendario di sistema senza una decisione esplicita.**
  Un evento EventKit è leggibile da altre app e può essere sincronizzato
  fuori dal controllo dell'archivio. Il titolo predefinito non deve contenere
  né il nome del paziente né il farmaco.

## Domande aperte, che sono di prodotto e non mie

1. La rivalutazione è un tipo di controllo o un oggetto distinto?
2. La fine della terapia è un campo della terapia o un evento separato che
   la richiama? L'evento gestisce meglio le proroghe; il campo è più semplice.
3. La sospensione periprocedurale lega farmaco ed esame: l'esame corrisponde
   a un `checkup` o a una prestazione?
4. La proiezione EventKit riguarda il singolo paziente, l'ambulatorio o
   un'agenda unica?