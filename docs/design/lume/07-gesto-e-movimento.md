---
summary: "Lume gesture and motion grammar: light carries focus, ink carries state, il filo connects only where connection is real. Interaction-triggered vitality (never ambient loops), the signing gesture as drying ink, refined replacements for the side-line filo, and honest heuristic proactivity."
read_when:
  - "Implementing or prototyping any Lume interaction, motion, field, or state transition."
  - "Deciding how focus, draft/signed state, continuity, or provenance should be rendered and animated."
  - "Reconciling the rendering of il filo and motion described in 01-lingua sections 3 and 7."
---

# Il gesto e il movimento

[01-lingua.md](./01-lingua.md) definisce materia, filo, due voci e grammatica dell'attenzione. Rimane da stabilire come questi elementi rispondano quando si apre un campo, si firma una voce o si cambia ambulatorio: il movimento deve rendere comprensibile il gesto, anziché limitarsi a segnalare un cambiamento di stato.

Questo capitolo **corregge la resa** del filo sul bordo dei riquadri e del movimento focale descritti nei par. 3 e 7 di 01-lingua, senza modificare fuoco, stato epistemico, continuità della cura o provenienza. La scelta deriva da un problema di lettura: un tratto laterale, soprattutto se tratteggiato, richiama un diff, uno skeleton di caricamento o un wireframe incompleto, invece di distinguere con chiarezza il lavoro clinico. Affidargli il fuoco contraddice inoltre il principio di 01-lingua: *il fuoco non si assegna con il colore né con un segno, ma con la luce*.

## 1. Principio: tre portatori, tre lavori

Lume affida a tre elementi compiti distinti, che non devono sovrapporsi:

| Portatore | Lavoro | Resa |
| --- | --- | --- |
| **La luce** | Il fuoco: ciò su cui si sta lavorando | Luminanza e temperatura appena più alte, con ombra corta. Nessuna linea. |
| **L'inchiostro** | Lo stato epistemico: bozza o firmato | La bozza usa testo a contrasto più basso e una micro-etichetta esplicita; la firma porta l'inchiostro a contrasto pieno, come se asciugasse. |
| **Il filo** | La connessione, soltanto dove sia reale | Una hairline continua, disegnata come geometria SVG, per spina della timeline, provenienza o storia di un valore. Mai sul lato di un riquadro. |

La distinzione è vincolante: **il fuoco non porta mai una linea, e la linea non marca mai un fuoco.** La superficie in lavorazione emerge attraverso la luce; una linea compare solo per collegare elementi reali nel tempo o nella provenienza, mai come divisore o decorazione.

## 2. Leggi di movimento

1. **La vitalità risponde al gesto, non va in loop.** Il movimento inizia con un'azione dell'utente, come spostare il fuoco, firmare, premere o trascinare, e deve terminare. Non sono ammesse animazioni ambientali, respiri continui o shimmer di attesa: un movimento autonomo e permanente suggerirebbe un'elaborazione procedurale o intelligente anziché spiegare un gesto.
2. **La luce si sposta, non le superfici.** Il cambio di fuoco usa un cross-fade di luminanza e temperatura di 150-200ms, ease-out. La durata è proporzionata alla distanza: breve fra righe vicine, maggiore da Quadro a Scheda ma sempre entro 250ms. Le variabili di luce si registrano tramite `@property` per interpolare correttamente; altrimenti cambiano di colpo, senza trascinamenti impropri.
3. **La conferma è transitoria.** Una pulsazione di ombra e alone minerale di ~300ms conferma l'azione e si spegne: l'accento non deve rimanere come peso visivo permanente.
4. **Il filo si disegna.** I connettori sono `stroke` SVG animati con `stroke-dashoffset`, non `border-left`. Da Quadro a Scheda prosegue una linea, non vola una pagina. Il draw-on descrive l'ingresso, non un aspetto tratteggiato: a riposo la linea è continua e piena.
5. **I controlli sono materia reattiva.** Alla pressione si applica `scale(0.97)` per ~150ms su `:active`; l'azione emette un anello che parte dal punto di contatto e si spegne, mentre l'hover produce un lieve sollevamento. Le spring interrompibili restano riservate a gesti diretti, come drag e riordino.
6. **Il movimento si elimina nelle azioni ad alta frequenza.** Comandi, menu da tastiera e navigazione rapida privilegiano il cambio istantaneo, perché dopo cento ripetizioni l'animazione diventa attrito.
7. **Reduce-motion vale per costruzione.** Anche senza movimento devono restare leggibili bozza con tono tenue ed etichetta, fuoco sollevato e tick di firma. Il movimento è la resa predefinita, non una condizione per comprendere lo stato.
8. **Il budget di movimento è un invariante.** Ogni vista dichiara quanti elementi possano muoversi insieme e il limite viene contato in CI: la calma deve dipendere da un controllo, non da un'intenzione.

## 3. Gli atomi in movimento

- **Campo di testo.** L'apertura porta il campo in luce; durante la scrittura l'inchiostro resta tenue perché il contenuto è una bozza. Il salvataggio si dichiara sobriamente con "salvato" e l'ora nel Registro, mentre soltanto la firma porta il contenuto a contrasto pieno.
- **Campo codificato (ICD, LOINC, AIC, catalogo).** La ricerca avviene inline e le candidate compaiono in penombra sotto il campo, dove deve avvenire anche la disambiguazione, senza modali in cascata. Il codice scelto usa il Registro con cifre tabellari e l'etichetta rimane nella Voce. La conferma della scelta non equivale a firma: il codice resta bozza finché non sia firmata la voce che lo contiene.
- **Impostazione.** L'effetto della scelta deve apparire subito nella vista, attraverso un'anteprima reversibile. Un'impostazione non applicabile deve spiegarne il motivo oppure non comparire; non sono ammessi stati disabilitati muti.
- **Menu.** La personalizzazione avviene per manipolazione diretta: la voce trascinata segue il dito con una spring interrompibile e le altre si spostano. Non si introduce un pannello di configurazione separato per un gesto che possa essere diretto.
- **Funzione intelligente / campo AI dinamico.** Quando lo strumento abbia una proposta, la materia si illumina appena senza assumere il calore semantico riservato al fuoco, che diventerebbe un improprio segnale-AI. Il suggerimento entra come **inchiostro tenue**, quindi come bozza, e diventa pieno solo con la firma esplicita del medico. Ogni inferenza apre le proprie fonti con un gesto. Nel rispetto di Claims guard (ADR 0065), il comportamento non deve vantare un motore non disponibile.
- **Allegato.** Il documento viene accolto nella penombra e un connettore SVG collega la voce che lo cita alla fonte: il filo esprime una provenienza verificabile, non sostituisce una graffetta con un ornamento.

## 4. Le scene

- **Cambio ambulatorio.** Un cross-fade ricalibra la luce del telaio mentre si ricompone il contesto di agenda, worklist e coda. Non si anima l'uscita di una pagina; la testata invariabile rimane ferma e leggibile durante tutto il passaggio.
- **Inserimento dati paziente.** I campi seguono una sequenza verticale, con errori accanto al dato e senza stati disabilitati opachi. L'inchiostro asciuga quando le parti vengono confermate, ma l'incertezza sul contesto paziente continua a bloccare le azioni cliniche: la testata svolge anche una funzione di sicurezza.
- **Campo AI dinamico.** Si applica la sequenza del par. 3: illuminazione appena percepibile, suggerimento in inchiostro tenue e firma che lo asciuga, con fonti raggiungibili in un gesto.
- **Microfono e cattura visita (ADR 0072).** Il pulsante è quieto a riposo; l'avvio lo illumina e introduce un indicatore di livello sobrio, senza onde decorative. Durante la cattura lo stato deve restare evidente ma calmo. La trascrizione entra poi sul filo del diario come **bozza tenue** e soltanto la revisione del medico la porta allo stato firmato: il movimento accompagna, senza attenuarlo, il confine review-first.
- **Impostazioni sartoriali.** Entro ADR 0047, che vieta un selettore persistito di stile UI e affida i registri al sistema, la personalizzazione riguarda densità comoda/densa, scorciatoie, viste salvate, default di ambulatorio, routing della coda e ordine del menu. Ogni opzione deve essere ispezionabile, reversibile e dotata di anteprima: nessuna scelta nascosta o irreversibile, né restyling presentato come personalizzazione.

<a id="5-la-proattivita-agentica-per-euristica"></a>

## 5. La proattività agentica per euristica

L'interfaccia deve offrire il contesto utile nel momento opportuno anche prima che esista un motore intelligente. Può farlo attraverso euristiche di cui siano comprensibili capacità e limiti, non simulando un'intelligenza che non c'è.

- La coda decisionale riordina il lavoro e propone l'azione probabile, dichiarando per ogni voce motivo, responsabile e scadenza. Una voce già valutata non deve tornare identica.
- L'app ricorda la luce dell'ultimo contesto e riapre il punto in cui il lavoro era rimasto.
- Non si pre-illumina un "prossimo fuoco probabile" né si mette in scena una capacità predittiva: significherebbe vantare un motore assente, in contrasto con ADR 0065. Le euristiche devono servire ciò che sanno realmente e dichiarare il resto attraverso stati vuoti espliciti.

## 6. Primitive tecniche (come si implementa)

Le primitive derivano dalla revisione di design del 2026-07-13, ricondotta alla distinzione fra luce e inchiostro. Il comportamento inizialmente affidato alla linea viene quindi ripartito fra luce, inchiostro e connettore, secondo il significato di ciascuno.

- **Variabili di luce registrate.** Dichiarare `--surface-l` per la luminanza e `--surface-temp` per la temperatura tramite `@property` a sintassi tipata, perché possano interpolare durante il cross-fade. Senza registrazione cambiano istantaneamente. Il fuoco anima queste variabili, non un `translate` delle superfici.
- **L'ombra non si anima direttamente.** Nel passaggio di profondità da 0 a 1 si anima l'`opacity` di uno strato-ombra già renderizzato, tramite pseudo-elemento. Non si anima `box-shadow` direttamente, poiché richiede paint.
- **Il filo è geometria vettoriale.** Usare `<line>` o `<rect>` SVG, oppure `Path.trim` sul nativo, mai un bordo animato. La crescita su un asse rettilineo, come la spina del diario, usa `transform: scaleY`, adatto al compositor; un percorso non lineare, come la provenienza, usa `stroke-dashoffset`. È vietato portare l'`opacity` di un filo da 0 a 1: la dissolvenza contraddice la continuità che deve rappresentare.
- **`--filo-fill` completa il connettore.** La proprietà registrata `@property --filo-fill { syntax: '<percentage>'; inherits: false; initial-value: 0% }` passa da 0 a 100% in ~200ms ease-out. Serve al FILO-CONNETTORE: una provenienza che si completa fonte per fonte, 33/66/100, quando il medico conferma ciascuna fonte, oppure una spina che si completa. NON rappresenta lo stato epistemico, affidato all'inchiostro che asciuga nei par. 1 e 3. Il riempimento è legato al gesto, mai a un avanzamento temporizzato.
- **Curve e tempi.** L'easing di base è `cubic-bezier(0.22, 0.61, 0.36, 1)`. Le durate seguono la scala del passaggio: 90-110ms per attraversare una lista, 150-180ms per cambiare fuoco o contesto, 200-220ms per asciugatura della firma e riempimento del connettore. Il press applica `scale(0.97)` in ~100ms al pointer-down.
- **La fisica resta sotto il dito.** Drag, riordino e assorbimento dell'allegato usano spring interrompibili, con response 0.30-0.35s, smorzamento pieno e zero overshoot, sempre dal valore corrente a schermo. Comparse e cambi di fuoco usano invece cross-fade temporizzati, mai molle.
- **Feedback al tocco, commit alla firma.** Alla pressione si applica `:active { transform: scale(0.97) }`, ma il dato diventa firmato soltanto con il gesto di firma, per esempio `Cmd+Invio`, mai al rilascio del dito. Il feedback del controllo non deve poter essere confuso con il consolidamento del dato.
- **Un solo primitivo per famiglia.** ICD, farmaco ed esenzione usano UN combobox condiviso, non implementazioni parallele. La lista di disambiguazione schiarisce la penombra sotto il campo con un cross-fade di 150ms, su superficie opaca e senza blur strutturale. La luce di riga si sposta in 90-110ms, senza il salto di un rettangolo colorato.
- **Budget di movimento verificabile.** Fuori dai gesti diretti è ammesso un solo elemento in moto per viewport. Se il fuoco cambia mentre un connettore si riempie, l'animazione precedente si interrompe al valore corrente e cede il token. Il test di regressione deve contare `transition` e `animation` attive e far fallire la CI se, nello stesso fotogramma, girino due animazioni estranee al gesto.
- **Reduce Motion.** Elimina respiri e corse, presenta connettore già completo e stato già asciutto e dimezza le durate. La leggibilità senza moto appartiene alla costruzione predefinita, non a un ramo di ripiego.

<a id="7-note-per-piattaforma-e-accessibilita"></a>

## 7. Note per piattaforma e accessibilità

- **Web**, implementazione di riferimento: variabili di luce tramite `@property`, connettori SVG con draw-on e font della Voce impacchettato, senza fetch remoto. Il riferimento interattivo è [mockups/lume-dinamica.html](./mockups/lume-dinamica.html).
- **Apple**: SF Pro e SF Mono, `matchedGeometryEffect` solo per il connettore che prosegue e sheet di sistema per gli overlay.
- **Windows / Linux**: l'adattamento parte da superfici già opache e piatte; il filo rimane un accento, non un materiale da rimuovere.
- **Accessibilità**: valgono WCAG 2.2 AA, focus sempre visibile, accesso completo da tastiera e divieto di stati disabilitati muti. Con reduce-motion, tono, etichetta e superficie devono bastare a leggere lo stato (par. 2.7). I segnali clinici non partecipano a questa grammatica: il loro rapporto fra colore e significato resta invariato.