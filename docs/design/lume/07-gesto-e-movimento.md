---
summary: "Lume gesture and motion grammar: light carries focus, ink carries state, il filo connects only where connection is real. Interaction-triggered vitality (never ambient loops), the signing gesture as drying ink, refined replacements for the side-line filo, and honest heuristic proactivity."
read_when:
  - "Implementing or prototyping any Lume interaction, motion, field, or state transition."
  - "Deciding how focus, draft/signed state, continuity, or provenance should be rendered and animated."
  - "Reconciling the rendering of il filo and motion described in 01-lingua sections 3 and 7."
---

# Il gesto e il movimento

Il capitolo [01-lingua.md](./01-lingua.md) ha fissato la materia, il filo, le due voci e la grammatica dell'attenzione, ma ha lasciato aperto il livello che rende Lume viva: come si muovono le cose, e come una interazione elementare (aprire un campo, firmare una voce, cambiare ambulatorio) diventa un gesto raffinato invece di un cambio di stato meccanico.

Questo capitolo distilla quel livello e **corregge la resa** di due punti di 01-lingua: il filo come segno sul bordo dei riquadri (par. 3) e il motion focale (par. 7). La correzione non tocca i concetti (fuoco, stato epistemico, continuita della cura, provenienza): sposta il modo in cui si rendono. La ragione e semplice e va scritta: un tratto disegnato sul lato di un riquadro, e ancora di piu quando tratteggiato, legge come un solco di diff, uno skeleton di caricamento o un abbozzo di wireframe. Sa di procedurale e di non finito. In un prodotto clinico che deve trasmettere fiducia, e il contrario di cio che serve. E soprattutto tradisce la legge madre di 01-lingua: *il fuoco non si assegna col colore ne con un segno, ma con la luce*.

## 1. Principio: tre portatori, tre lavori

Lume ha tre modi di dire le cose in movimento, e non si sovrappongono mai.

| Portatore | Lavoro | Resa |
| --- | --- | --- |
| **La luce** | Il fuoco (cosa e in lavorazione adesso) | La superficie sale nella luce: luminanza e temperatura appena piu alte, ombra corta. Nessuna linea. |
| **L'inchiostro** | Lo stato epistemico (bozza o firmato) | Il tono del testo: la bozza e a contrasto piu basso con una micro-etichetta onesta; il firmato e a contrasto pieno. La firma e il gesto che asciuga l'inchiostro. |
| **Il filo** | La connessione, dove e reale | Una hairline continua resa come geometria SVG che si disegna: la spina della timeline, il connettore di provenienza, la storia di un valore. Mai sul lato di un riquadro. |

La regola che tiene tutto: **il fuoco non porta mai una linea, e la linea non marca mai un fuoco.** Se una superficie deve dire "sono io che conti adesso", lo dice con la luce. Se una linea compare, sta collegando due cose reali nel tempo o nella provenienza, e porta significato (mai un divisore, mai una decorazione).

## 2. Leggi di movimento

1. **La vitalita risponde al gesto, non va in loop.** Nessuna animazione ambientale, nessun respiro perenne, nessuno shimmer di attesa: sono proprio i movimenti che-vanno-avanti-da-soli a leggere come procedurali e da intelligenza artificiale. Il movimento nasce quando l'utente agisce (sposta il fuoco, firma, preme, trascina) e finisce.
2. **La luce si sposta, non le superfici.** Quando il fuoco cambia, la luce fa un cross-fade di luminanza e temperatura (150-200ms, ease-out). La velocita e proporzionale alla scala del salto: riga vicina, breve; Quadro verso Scheda, piu lungo ma entro 250ms. Le variabili di luce si registrano via `@property` cosi da interpolare in modo pulito, oppure scattano; non si "trascinano" a caso.
3. **La conferma e transiente.** L'accento non resta come peso persistente: lampeggia brevemente per dare sicurezza e si spegne (una pulsazione di ombra e di alone minerale, ~300ms). E l'opposto della stanghetta fissa.
4. **Il filo si disegna.** I connettori sono `stroke` SVG che entrano con `stroke-dashoffset` (draw-on), non `border-left`. "Il filo che prosegue" da Quadro a Scheda e una linea che si allunga, non una pagina che vola. Nota: draw-on non vuol dire aspetto tratteggiato; la linea a riposo e continua e piena.
5. **I controlli sono materia reattiva.** Press `scale(0.97)` ~150ms su `:active`; l'azione emette un anello che parte dal punto del tocco e si spegne; hover = un lift sottile. La fisica (spring interrompibili) resta dove c'e un gesto diretto (riordino, drag).
6. **Togliere il movimento dove e ad alta frequenza.** Comandi, menu da tastiera, navigazione rapida: meglio lo scatto. Dopo cento ripetizioni un'animazione diventa attrito, non piacere.
7. **Reduce-motion per costruzione.** Senza moto lo stato resta leggibile lo stesso: la bozza e comunque inchiostro tenue con etichetta, il fuoco e comunque superficie sollevata, il tick di firma e comunque presente. Il moto e il default, non il fallback.
8. **Budget di movimento come invariante.** Ogni vista dichiara quanti elementi possono muoversi insieme; si conta in CI. La calma e una regola, non una speranza.

## 3. Gli atomi in movimento

- **Campo di testo.** Si apre con la luce (il campo entra in fuoco). Mentre si scrive, l'inchiostro e tenue: e una bozza. Il salvataggio si dichiara in modo sobrio e onesto ("salvato", con l'ora nel Registro), non con un badge chiassoso. Il contenuto diventa pieno solo quando e firmato.
- **Campo codificato (ICD, LOINC, AIC, catalogo).** La ricerca e inline; le candidate stanno in penombra sotto il campo; la disambiguazione si fa li, senza modale in cascata. Il codice scelto si posa nel Registro (cifre tabellari) con la sua etichetta nella Voce. Confermare non e firmare: il codice entra come bozza finche la voce che lo contiene non e firmata.
- **Impostazione.** Cambia con anteprima immediata e reversibile: l'effetto si vede subito nella vista, non si descrive a parole. Nessuno stato disabilitato muto: se una impostazione non si applica ora, spiega perche o non compare.
- **Menu.** La personalizzazione e manipolazione diretta: la voce trascinata resta sotto il dito con spring interrompibile, le altre si scostano. Nessun pannello di configurazione separato per un gesto che puo essere diretto.
- **Funzione intelligente / campo AI dinamico.** Quando lo strumento ha qualcosa da offrire, la materia si illumina appena: e luce, non calore semantico (il calore appartiene al fuoco, prenderlo in prestito farebbe segnale-AI). Il suggerimento entra come **inchiostro tenue**, cioe bozza, e diventa pieno solo con la firma esplicita del medico. Ogni inferenza apre le sue fonti con un gesto. Claims guard (ADR 0065): la superficie non vanta un motore, si comporta bene.
- **Allegato.** Il documento cade nella penombra, viene assorbito, e un connettore SVG si disegna dalla voce che lo cita verso la fonte: la provenienza e il filo reso contratto, non una graffetta decorativa.

## 4. Le scene

- **Cambio ambulatorio.** La luce dell'intero telaio si ricalibra con un cross-fade e il contesto si rimonta gia pronto (agenda, worklist, coda). Non una pagina che vola via: e lo stesso strumento che cambia stanza. La testata invariabile resta ferma e leggibile per tutto il passaggio.
- **Inserimento dati paziente.** Sequenza verticale di campi, errori accanto al dato, mai disabled opachi. L'inchiostro asciuga man mano che le parti vengono confermate; con contesto paziente incerto le azioni cliniche restano bloccate (la testata e anche sicurezza).
- **Campo AI dinamico.** La coreografia del par. 3: illuminazione appena percettibile, inchiostro tenue del suggerimento, firma che asciuga. Le fonti a un gesto.
- **Microfono e cattura visita (ADR 0072).** A riposo il pulsante e quieto. L'avvio accende la materia (luce, piu un indicatore di livello sobrio: nessun ornamento, nessuna onda decorativa). Durante la cattura lo stato e evidente ma calmo. Alla fine la trascrizione entra sul filo del diario come **bozza tenue**, e la revisione del medico la asciuga a firmata: il confine e fluido e review-first per costruzione.
- **Impostazioni sartoriali.** Dentro ADR 0047 (nessun selettore di stile UI persistito, i registri di luce seguono il sistema): la sartorialita e densita (comoda/densa), scorciatoie, viste salvate, default di ambulatorio, routing della coda, ordine delle voci di menu. Il rapporto conflittuale con le impostazioni si scioglie perche ogni opzione e ispezionabile, reversibile e con anteprima: niente e nascosto, niente e irreversibile, niente restyling travestito da personalizzazione.

## 5. La proattivita agentica per euristica

L'interfaccia deve sembrare orchestrata da un modello che serve la cosa giusta al momento giusto, prima che un motore esista. La sensazione nasce da euristiche oneste, non dalla simulazione di una intelligenza.

- La coda decisionale riordina e propone l'azione probabile; ogni voce dichiara perche e li, chi la possiede, entro quando. Le voci gia valutate non tornano uguali.
- L'app ricorda la luce dell'ultimo contesto e apre dove il lavoro era rimasto.
- Cosa NON si fa: pre-illuminare "il prossimo fuoco probabile" o mettere in scena una preveggenza. Sarebbe vantare un motore che non c'e (ADR 0065). La proattivita e servire bene cio che le euristiche sanno davvero, e ammettere il resto con stati vuoti onesti.

## 6. Primitive tecniche (come si implementa)

Queste primitive derivano dalla review di design del 2026-07-13, riconciliate alla direzione luce+inchiostro: quello che era pensato per far vivere la linea qui fa vivere la luce, l'inchiostro e il connettore.

- **Variabili di luce registrate.** Le variabili di zona (`--surface-l` luminanza, `--surface-temp` temperatura) si dichiarano con `@property` a syntax tipata, cosi interpolano davvero durante il cross-fade; senza registrazione scattano invece di transire. Il cross-fade del fuoco anima queste, non un `translate` di superfici.
- **L'ombra non si anima.** Il sollevamento del fuoco (profondita 0 verso 1) anima l'`opacity` di uno strato-ombra pre-renderizzato (pseudo-elemento), non `box-shadow` diretto, che e paint-bound.
- **Il filo e geometria vettoriale.** Un `<line>` o `<rect>` SVG (o `Path.trim` sul nativo), mai un bordo animato. Crescita lungo un asse dritto (la spina del diario che si allunga) uguale `transform: scaleY`, compositor-friendly; percorso non lineare (la provenienza) uguale `stroke-dashoffset`. Mai `opacity` da 0 a 1 su un filo: un filo che sfuma tradisce il suo significato di continuita.
- **`--filo-fill` per il connettore che si completa.** Proprieta registrata `@property --filo-fill { syntax: '<percentage>'; inherits: false; initial-value: 0% }`, da 0 a 100% in ~200ms ease-out. In luce+inchiostro serve al FILO-CONNETTORE (la provenienza che si riempie fonte per fonte, 33/66/100, man mano che il medico conferma ciascuna; la spina che si completa), NON allo stato epistemico: lo stato resta inchiostro che asciuga (par. 1 e 3). Il riempimento e legato al gesto, mai temporizzato.
- **Curve e tempi.** Easing di base `cubic-bezier(0.22, 0.61, 0.36, 1)`. Velocita proporzionale alla scala del salto: traversata di lista 90-110ms; cambio di fuoco o di contesto 150-180ms; asciugatura della firma e riempimento del connettore 200-220ms. Press `scale(0.97)` in ~100ms al pointer-down.
- **La fisica vive solo sotto il dito.** Drag, riordino, assorbimento allegato uguale spring interrompibili (response 0.30-0.35s, smorzamento pieno, zero overshoot), sempre dal valore corrente a schermo. Comparse e cambi di fuoco usano cross-fade temporizzato, mai una molla.
- **Feedback al tocco, commit al gesto.** `:active { transform: scale(0.97) }` alla pressione, ma lo stato passa a firmato solo con il gesto di firma (per esempio `Cmd+Invio`), mai al rilascio del dito. La fisica del dito e la fisica del dato sono separate: toccare non e mai firmare.
- **Un solo primitivo per famiglia.** Il campo codificato (ICD, farmaco, esenzione) e UN combobox condiviso, non implementazioni parallele. La lista di disambiguazione non sbuca: e una penombra che si schiarisce sotto il campo (cross-fade 150ms, superficie opaca, nessun blur strutturale); la luce di riga scivola in 90-110ms, mai un rettangolo colorato che salta.
- **Budget di movimento verificabile.** Fuori dai gesti diretti, un solo elemento in moto per viewport; se il fuoco si sposta mentre un connettore si sta ancora riempiendo, il precedente si tronca al valore corrente (interrompibile) e il token passa. Un test di regressione conta le `transition` e `animation` attive e fallisce la CI se due animazioni fuori-gesto girano nello stesso fotogramma: la calma diventa un contratto.
- **Reduce Motion.** Sopprime i respiri e le corse (il connettore appare gia completo, lo stato gia asciutto) e dimezza le durate. E il default per costruzione, non un ramo di fallback.

## 7. Note per piattaforma e accessibilita

- **Web** (implementazione di riferimento): variabili di luce via `@property`, connettori come SVG con draw-on, font della Voce impacchettato (nessun fetch remoto). Riferimento vivo: [mockups/lume-dinamica.html](./mockups/lume-dinamica.html).
- **Apple**: SF Pro e SF Mono; `matchedGeometryEffect` solo per il connettore che prosegue; overlay come sheet di sistema.
- **Windows / Linux**: la resa degrada per costruzione perche e opaca e piatta; il filo e un accent, non un materiale da rimuovere.
- **Accessibilita**: WCAG 2.2 AA, focus sempre visibile, tutto raggiungibile da tastiera, mai disabled opachi muti. Con reduce-motion lo stato resta leggibile per tono, etichetta e superficie (par. 2.7). I segnali clinici (colore = semantica) non partecipano mai a questa grammatica: restano invarianti.
