---
summary: "Shared MediFlow design contract and platform adaptations for web, iPhone, iPad, and macOS."
read_when:
  - "Designing or reviewing a user-facing MediFlow surface."
  - "Checking Lume, interaction parity, accessibility, or platform adaptation."
---

<a id="mediflow-design"></a>

# Design di MediFlow

<a id="design-intent"></a>

## Intento progettuale

MediFlow si rivolge a medici impegnati in un lavoro clinico denso di
informazioni. L'interfaccia deve renderlo leggibile senza aggiungere rumore:
calma, precisione, affidabilità percepita e rapidità di consultazione sono
qualità della stessa esperienza.

La gerarchia delle informazioni prevale sulla decorazione. Materiali,
movimento e funzioni intelligenti devono aiutare a svolgere il compito,
non diventare ciò di cui il medico debba occuparsi.

<a id="plain-language-for-physicians"></a>

## Un linguaggio comprensibile per i medici

Ogni interfaccia MediFlow deve essere utilizzabile da un medico che non
conosca codice, infrastruttura, intelligenza artificiale o convenzioni delle
interfacce. Il requisito riguarda web/localhost, macOS, iPhone e iPad e
comprende impostazioni, configurazione iniziale, descrizioni dei campi,
pulsanti, suggerimenti, notifiche, errori, conferme ed etichette di accessibilità.

- Ogni parola deve aiutare il medico a capire il compito. Nominare i campi
  secondo il contenuto e le azioni secondo ciò che fanno, spiegando input
  atteso e conseguenze quando non siano evidenti. Non dare per scontato che
  un'icona sia compresa.
- Usare una lingua familiare e precisa e lo stesso nome per lo stesso concetto.
  Conservare la terminologia clinica appropriata senza richiedere competenze
  tecniche.
- Non esporre host, MCP, payload, receipt o gate come normali etichette di
  prodotto. Spiegare nella lingua comune i concetti tecnici necessari;
  i dettagli diagnostici opzionali appartengono a una vista di supporto
  separata e non devono mai essere necessari per completare il lavoro ordinario.
- Descrivere le impostazioni attraverso il loro effetto pratico. Quando si
  condividono dati, dichiarare in termini comprensibili che cosa viene inviato,
  a chi e quando: la semplicità non deve nascondere consenso, limiti, rischi
  o distinzione fra proposta e azione già eseguita.
- Gli errori spiegano che cosa è accaduto e quale azione sia ancora disponibile.
  Anche un'etichetta breve deve avere senso; un suggerimento a comparsa non
  rimedia a un comando incomprensibile.

L'accettazione richiede di leggere il percorso sull'interfaccia effettiva,
compresi gli stati secondari pertinenti, e verificare che un medico senza
conoscenze tecniche possa capire significato, dati da inserire o scelta da
compiere e conseguenze, senza la spiegazione di uno sviluppatore. Gergo non
spiegato e azioni ambigue impediscono l'accettazione anche con test automatici
superati. Il requisito vale per interfacce esistenti e future; formularlo
non certifica che tutti i testi correnti lo rispettino già.

<a id="shared-language"></a>

## Una lingua condivisa

Lume è la lingua visiva attiva. Web e implementazioni Apple condividono
il significato dei controlli, pur adattandone la forma alla piattaforma:

- terminologia clinica e significato dei controlli;
- gerarchia informativa e ritmo tipografico;
- ruoli semantici del colore;
- principi di spaziatura e raggruppamento;
- gerarchia di bordi e materiali;
- vocabolario delle icone;
- significato degli stati di caricamento, vuoto, offline, dato non più attuale,
  conflitto, accesso negato ed errore;
- identificatori di accessibilità stabili per i controlli sottoposti a test.

Condividere questa lingua non impone la stessa navigazione né la stessa
densità di contenuti.

<a id="hierarchy-and-typography"></a>

## Gerarchia e tipografia

La tipografia di Lume distingue due registri funzionali, così che orientamento
e dettaglio possano convivere:

- **Voce** identifica la domanda, il paziente, il compito o l'azione corrente.
- **Registro** raccoglie dati densi, provenienza, stato e storia.

I titoli stabiliscono il contesto; le etichette restano vicine al valore
o al controllo che descrivono. Nomi clinici lunghi e dati con più codifiche
devono andare a capo senza tagli e senza nascondere l'azione principale.

<a id="color-borders-and-materials"></a>

## Colore, bordi e materiali

Il colore semantico è riservato a condizione clinica, stato, avviso, selezione
e focus. Deve accompagnarne il significato, non esserne l'unico veicolo.

I contenuti clinici richiedono superfici stabili, leggibili e chiaramente
raggruppate. I materiali nativi Apple possono seguire la semantica corrente
del sistema quando chiariscano gerarchia o funzione; la traslucenza resta
limitata agli elementi di navigazione e comando e alle superfici di privacy,
senza sovrapporsi fra schede cliniche.

Localhost riprende con misura questa distinzione dei materiali, senza
imitare effetti di vetro decorativi.

<a id="nested-frames"></a>

### Cornici annidate

I contenitori annidati devono avere angoli coordinati. Quando due cornici
racchiudono lo stesso contenuto, evitare che una cornice esterna quadrata
o quasi quadrata ne contenga una fortemente arrotondata. Nei bordi interni
paralleli, coordinare raggio interno, raggio esterno e rientro affinché
la distanza appaia uniforme.

Ogni cornice deve identificare un gruppo significativo: preferire un unico
contenitore con spaziatura o divisori discreti a più scatole intorno allo
stesso contenuto. Il vincolo riguarda cornici ridondanti e geometrie in
conflitto, non vieta controlli arrotondati dentro una pagina rettangolare.

Riesaminare la superficie nelle dimensioni e negli aspetti supportati.
Gli angoli annidati devono essere coerenti e le distanze uniformi; eliminare
cornici ridondanti non deve compromettere raggruppamento comprensibile,
indicatori di focus o comportamento.

<a id="components-and-states"></a>

## Componenti e stati

Ogni controllo visibile deve corrispondere a questa sequenza:

`surface → control → identifier → action/service → state mutation → outcome`

L'esito comprende, quando applicabili, successo, errore, vuoto, caricamento,
offline, dato non più attuale, conflitto e accesso negato.

Indicatori di stato, condizioni di accesso alle funzioni, schede delle
evidenze, segnali del lavoro in attesa e connettore Filo di Lume hanno un
significato definito. Non sono ammessi pulsanti decorativi o azioni divergenti
non documentate.

I controlli touch mirano ad almeno 44 punti o al minimo equivalente della
piattaforma. Tastiera e puntatore mantengono uno stato di focus visibile.

<a id="platform-adaptations"></a>

## Adattamenti alle piattaforme

### iPhone

- Dare priorità a consultazione e acquisizione rapide.
- Usare navigazione compatta e, dove pratico, raggiungibile con una mano.
- Mantenere chiari paziente e compito attivi anche nelle interazioni brevi.
- Ridisporre le viste dense prima di ridurne la leggibilità.

### iPad

- Usare lo spazio più ampio per il lavoro elenco-dettaglio e per il contesto
  clinico strutturato.
- Adattarsi a larghezze compatte e regolari, orientamento verticale e orizzontale
  e ridimensionamento continuo.
- Supportare touch, tastiera e puntatore senza cambiare il significato delle
  funzioni.

### macOS

- Usare finestre, barre laterali, barre degli strumenti, menu, focus, comandi
  da tastiera e ridimensionamento continuo nativi.
- Conservare la densità desktop senza tagliare contenuti o nascondere stati.
- Rendere visibile, nelle superfici amministrative e runtime, il ruolo del Mac
  come home-base autorevole.

### Localhost

- Usare semantica HTML nativa e struttura web responsive.
- Supportare viewport di 320, 390, 768 e 1440 pixel.
- Conservare contenuti e azioni con zoom del browser al 200% e al 400%.
- Rendere espliciti ordine da tastiera, visibilità del focus e struttura per
  lettori di schermo.

<a id="accessibility"></a>

## Accessibilità

L'accessibilità vincola il prodotto fin dall'inizio: non è una rifinitura
da demandare alla fine.

- Supportare Dynamic Type fino ad AX5 dove dichiarato.
- Preferire una sola colonna leggibile quando le dimensioni di accessibilità
  rendano inadeguate le viste affiancate.
- Conservare etichette, valori, caratteristiche, ordine e azioni di VoiceOver
  e dei lettori di schermo.
- Mantenere identificatori stabili secondo la convenzione
  `clinical-workspace-…` per i controlli Apple esercitati.
- Rispettare riduzione del movimento, riduzione della trasparenza, aumento
  del contrasto e aspetto del sistema.
- Non dichiarare supporto alle tecnologie assistive senza un'esecuzione
  conclusa sulla piattaforma nominata. Il limite corrente delle prove
  VoiceOver mobile è documentato in
  [`docs/known-limitations.md`](./docs/known-limitations.md).

<a id="motion-and-privacy"></a>

## Movimento e privacy

Il movimento comunica stato, gerarchia o continuità; quando è attiva
la riduzione del movimento, si ferma o si semplifica.

Le schermature per la privacy e gli stati di visualizzazione discreta
possono nascondere contenuti sensibili, ma non devono nascondere il motivo,
l'azione per tornare al lavoro o lo stato corrente di sicurezza.

<a id="intentional-differences-and-exceptions"></a>

## Differenze intenzionali ed eccezioni

Una differenza intenzionale fra piattaforme deve dichiarare:

- il ruolo della piattaforma che la richiede;
- la funzione condivisa e il significato clinico;
- la ragione della diversa struttura o modalità di input;
- la superficie di test o revisione;
- il responsabile e il seguito, se l'eccezione è temporanea.

Residui di colori letterali, certificazione incompleta degli stati secondari,
equivalenza delle condizioni di accesso alla creazione del paziente e pulizia
dei marcatori dei moduli restano lavoro post-0.8. Non autorizzano una
riprogettazione senza limiti del candidato 0.8.

<a id="evidence-order"></a>

## Ordine delle evidenze

Per le decisioni native Apple, l'ordine di riferimento è:

1. indicazioni correnti della piattaforma Apple e disponibilità delle API;
2. architettura della repository, Lume e ADR accettati;
3. prove runtime sul candidato esatto;
4. indicazioni secondarie di buona realizzazione.

Per le affermazioni pubbliche prevalgono la matrice di parità e il verbale
dell'esecuzione esatta: screenshot e impressione visiva non li sostituiscono.