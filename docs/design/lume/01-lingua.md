---
summary: "Lume language specification: focal light model, matter and palette, il filo, two typographic voices, semantic depth, attention grammar, provenance, motion, platform notes."
read_when:
  - "Implementing or prototyping any Lume surface, token, or interaction."
  - "Understanding how Lume renders hierarchy without glass."
---

# La lingua

## 1. Il modello focale

Per lavorare su un paziente, un referto o una terapia deve essere chiaro quale oggetto si stia trattando, senza perdere il contesto. Lume assegna perciò all'interfaccia un solo **fuoco** alla volta e dispone il resto del lavoro in tre zone di luce:

| Zona | Cosa contiene | Resa |
| --- | --- | --- |
| **Fuoco** | L'oggetto in lavorazione | Superficie più chiara e leggermente più calda, contrasto pieno, ombra corta che la solleva |
| **Penombra** | Il contesto di lavoro (worklist, pannelli vicini) | Superficie neutra, contrasto pieno del testo ma cromatismo trattenuto, nessuna ombra |
| **Buio operativo** | Il telaio (rail, barre, chrome) | Superficie leggermente più scura e più fredda, contenuti attenuati, zero ornamento |

Regole:

- Il fuoco è UNO: due zone che lo sembrino rendono ambigua la gerarchia.
- A distinguerlo sono luminanza, temperatura e ombra, non il colore, che resta riservato ai segnali clinici.
- Il buio operativo deve restare presente e raggiungibile senza richiamare attenzione. La lezione di Linear riguarda proprio questo rapporto: il telaio arretra perché emerga il lavoro.
- Densità comoda/densa e modello focale sono assi indipendenti: anche una superficie densa deve avere un fuoco.

## 2. La materia

La profondità serve a distinguere ciò che conta nel lavoro in corso; non deve quindi dipendere dal vetro strutturale. Le superfici sono opache, con bordi reali da 1px e ombre corte, e si solleva soltanto ciò che è importante in quel momento.

### Palette dei registri

I tre registri modulano la luce, senza costituire tre temi indipendenti. Giorno e grafite seguono il chiaro/scuro di sistema; guardia affina il registro scuro per l'uso notturno, riprendendo l'esplorazione B di Vetro Clinico:

| Token | Giorno | Grafite | Guardia |
| --- | --- | --- | --- |
| `surface.canvas` (periferia) | `#eef0f2` | `#121417` | `#0c0e12` |
| `surface.field` (penombra) | `#f5f5f4` | `#191c21` | `#14171d` |
| `surface.focal` (fuoco) | `#fbfaf7` | `#22252b` | `#1a1e26` |
| `surface.chrome` (buio operativo) | `#e6e8eb` | `#0e1013` | `#090b0e` |
| `ink.primary` | `#1a1c1e` | `#e9ecef` | `#e3e8ee` |
| `ink.muted` | `#5c6772` | `#8f9aa6` | `#8792a3` |
| `accent.minerale` (interattivo) | `#33506b` | `#8fb0cc` | `#7fa0bc` |

La temperatura accompagna questa gerarchia: il fuoco tende appena all'avorio caldo, mentre la periferia assume un tono minerale più freddo. La differenza deve essere percepibile senza imporsi come una campitura distinta, perché orienti lo sguardo anziché competere con il contenuto.

I valori sono definiti nel sorgente token DTCG `tokens/lume.tokens.json` e misurati da `scripts/check-lume-tokens.mjs` (L1a). A portarli nel runtime web è il mirror CSS `app/lume-tokens.css`, importato dal layout insieme al marker fisso `data-lume="true"`: giorno si applica su `:root`, grafite su `.dark` (L1b). Il marker non governa la cascata, mentre guardia rimane nel sorgente senza essere un tema attivo. La misura spiega anche la correzione di `giorno` `ink.muted` da `#5f6b76` a `#5c6772`: su `surface.chrome`, la più scura fra le superfici chiare e dunque la coppia vincolante, il valore originale dava 4,44:1, sotto la soglia 4,5:1; il valore corretto dà 4,70:1. Le altre coppie erano già sopra soglia.

I segnali clinici NON cambiano: `signal.warning #9a6a2f`, `signal.critical #a33a2f`, `signal.success #4b6354`, `signal.plum #555161`, con le rispettive derivazioni scure/notturne dai token. Il cambiamento della materia non deve alterare il significato che il colore ha già nel lavoro clinico.

### Grana

Per rendere meno uniformi le campiture grandi è ammessa una grana appena percepibile, con rumore monocromo e opacità <= 2%, SOLO su `surface.canvas` e `surface.chrome`. Non deve mai comparire su fuoco, tabelle, testo o stampa; con Increase Contrast scompare.

### Dove finisce il vetro

Il blur è ammesso soltanto negli overlay transitori, come modali e popover, e rimane una resa opzionale della piattaforma: su Apple gli sheet di sistema usano già il vetro, mentre sul web la scelta dipende dal budget. La gerarchia NON deve dipenderne, perché scrim e ombra devono bastare a renderla leggibile.

## 3. Il filo

> Revisione 2026-07-14: [07-gesto-e-movimento.md](./07-gesto-e-movimento.md) aggiorna la resa descritta in questa sezione. A individuare il fuoco è la luce (par. 1), non il filo; a distinguere lo stato epistemico è l'inchiostro, attraverso tono e asciugatura della firma, non il tratteggio. Il filo resta la firma grafica dove rappresenti una connessione reale, con geometria SVG continua.

Una linea sottile di 1px, in `accent.minerale` o in un tono semantico, rende riconoscibile Lume soltanto dove esprima la continuità della cura:

| Dove | Cosa fa |
| --- | --- |
| Spina della timeline del diario | Le voci si appendono al filo, in ordine di tempo |
| Storia di un valore di laboratorio | Il filo collega le rilevazioni, con la banda di riferimento dietro |
| Connettore di provenienza | Lega un contenuto alla sua fonte (referto, trascrizione) |

**Lo stato epistemico è un contratto, e la firma è il commit**: finché un contenuto sia proposto o non rivisto rimane una bozza; è la firma del medico a consolidarlo. Per rendere visibile il passaggio si usa l'inchiostro che asciuga, non più il tratteggio del filo (vedi [07-gesto-e-movimento.md](./07-gesto-e-movimento.md)). Nessuna prescrizione, ordine o invio parte finché il tratto non sia pieno, e un inserimento errato deve essere marcato come tale, non cancellato. La distinzione fra bozza e contenuto consolidato deve quindi essere riconoscibile senza moltiplicare i badge. Anche le proposte degli strumenti di supporto entrano in inchiostro tenue e diventano piene solo dopo la revisione esplicita del medico. Poiché una sintesi o un'inferenza devono poter essere controllate, ciascuna apre con un gesto documento, data e frammento di origine: il filo di provenienza esprime questo contratto, non una decorazione (vedi [04-perlustrazione.md](./04-perlustrazione.md)).

Non deve esserci più di un filo per contenitore. I divisori restano bordi neutri: usare `accent.minerale` per una linea significa attribuirle un significato, non separare genericamente due aree.

## 4. Le due voci

| Voce | Famiglia | Ruolo |
| --- | --- | --- |
| **La Voce** | Sans umanista variabile. Web/tri-OS: font variabile impacchettato nell'app (candidato: Inter Variable con asse ottico; niente fetch remoti, l'app è locale-first). Apple: SF Pro (idiomatico, ha già optical sizing). | Discorso: titoli, etichette, prosa clinica, navigazione |
| **Il Registro** | Mono leggibile impacchettato (candidato: IBM Plex Mono; Apple: SF Mono). | Certificazione: ogni atomo verificabile |

**La regola del Registro** distingue il dato dalla narrazione: qualunque informazione che il medico possa leggere ad alta voce per verificarla deve usare il Registro con cifre tabellari. Vi rientrano dosi (`5 mg`), valori (`158 mmHg`), codici (ICD, LOINC, AIC), date, orari e ID; il discorso rimane nella Voce, così che la distinzione sia visibile prima ancora della lettura.

La scala resta quella di Vetro Clinico ([../vetro-clinico/02-token.md](../vetro-clinico/02-token.md)): minimo 10px, gerarchia affidata al peso, tracking commisurato alla taglia e `rem` per lo zoom. Dove la Voce disponga di un asse ottico, lo si usa per avere forme più strette e definite nei corpi grandi, più aperte nei corpi piccoli.

## 5. Profondità semantica

La luce distingue tre livelli di profondità, senza ricorrere al blur:

| Livello | Resa | Uso |
| --- | --- | --- |
| 0, appoggiato | `surface.field`, bordo 1px, nessuna ombra | Penombra, liste, pannelli |
| 1, sollevato | `surface.focal`, bordo 1px, ombra corta (`0 2px 8px` a bassa opacità) | Il fuoco |
| 2, sospeso | `surface.focal`, ombra media + scrim dietro | Overlay transitori |

Non sono ammessi livelli intermedi né ombre decorative: un componente può essere sollevato solo quando sia il fuoco o un overlay, perché l'ombra gli attribuisce una priorità nella gerarchia.

La geometria conserva la concentricità di Vetro Clinico, riducendo però la curvatura a `radius.panel 20px`, `radius.card 14px`, `radius.control 10px`, `radius.chip 999px`. Il carattere diventa così più vicino a un foglio tecnico che a una superficie consumer morbida, senza arrivare allo spigolo vivo.

## 6. La grammatica dell'attenzione

Il layout deve rendere comprensibili le decisioni che i dati richiedono, non limitarsi a esporli.

1. **Testata invariabile**: identità del paziente, allergie, alert e terapie critiche restano sempre nello stesso posto, mai sotto scroll. È l'unico elemento che non segue il modello focale, perché deve essere sempre leggibile. L'identità deve poter essere verificata attraverso data di nascita, identificativo e foto dove appropriato; se il contesto paziente è incerto, le azioni cliniche si bloccano. Nessun identificativo completo deve comparire sulle superfici esposte.
2. **La colonna dell'attenzione è una coda decisionale, non un feed**: raccoglie esiti nuovi, delta rilevanti, referti da rivedere e rinnovi in scadenza, rendendone spiegabile e ordinabile la priorità. Ogni voce dichiara perché sia presente, chi ne sia responsabile, se sia delegabile e quale scadenza abbia; una voce già valutata non si ripresenta identica. Il binario clinico usa i segnali, quello amministrativo il neutro minerale: i due registri visivi non devono usare lo stesso colore. Un segnale vero riordina la coda e propone un'azione, mentre gli avvisi interruttivi sono riservati ai rischi urgenti e azionabili.
3. **Baseline prima del benchmark**: il primo confronto è con la storia del paziente, attraverso la banda personale sul filo; segue il range di laboratorio, con una banda di riferimento che ne dichiari la fonte. La variazione rispetto all'abituale per quel paziente deve emergere prima di un semaforo generico.
4. **L'anatomia della riga di laboratorio** (canonica): nome nella Voce, valore nel Registro allineato a destra, unità, banda di range con fonte, delta dal precedente comparabile e data. La storia usa il filo con punti datati e banda sullo sfondo; sono vietate sparkline ornamentali senza assi ancorati.
5. **Densità a strati**: riga -> pannello laterale di contesto -> documento sorgente. Il pannello laterale deve consentire l'approfondimento senza perdere il punto di lavoro, sostituendo le navigazioni distruttive.
6. **Fiducia ispezionabile**: salvataggio, backup e cifratura devono restare sobri ma sempre raggiungibili dal buio operativo. La bozza deve dichiarare il proprio stato — indicato inizialmente con il tratteggio, aggiornato dalla revisione del paragrafo 3 — senza che il dato salvato richieda un'enfasi equivalente.

## 7. Motion: la luce si sposta

- Quando cambia il fuoco, cambiano luminanza e temperatura attraverso un cross-fade dal vecchio al nuovo fuoco (150-200ms, ease-out); non si spostano le superfici. Il fuoco è indicato dalla luce, non da un filo sul bordo, mentre i connettori di spina e provenienza si ridisegnano come geometria SVG (vedi [07-gesto-e-movimento.md](./07-gesto-e-movimento.md)).
- Il filo può estendersi in 200ms quando rappresenti una continuità: nel passaggio Quadro -> Scheda prosegue la linea, non vola una pagina.
- Drag e riordino mantengono le spring interrompibili di Vetro Clinico ([../vetro-clinico/04-interazione.md](../vetro-clinico/04-interazione.md)), perché la risposta fisica accompagna un gesto diretto.
- Non sono ammessi parallasse, morphing di superfici o blur animato. Il cross-fade è il comportamento predefinito, non un ripiego: la costruzione soddisfa già gran parte di Reduce Motion.

## 8. Note per piattaforma

- **Web**: è la prima implementazione di riferimento, ancora in corso nel quadro descritto. I registri usano set di custom properties: mirror `app/lume-tokens.css`, marker `data-lume="true"`, giorno/grafite attivi su `:root`/`.dark`. Il modello focale sposta le variabili di zona attraverso `data-lume-focus`, già adottato nella shell del workspace clinico. Il Filo usa esclusivamente geometria SVG continua (`line`, `path` e `circle`) tramite `components/ui/lume-filo.tsx`, mai bordi o pseudo-elementi; l'estensione assiale avviene con `transform: scaleY`. In questa fase restava da includere il font variabile nel bundle locale, senza fetch remoto.
- **Apple**: SF Pro/SF Mono sostituiscono le voci impacchettate; il fuoco usa colori semantici custom sopra materiali opachi. Gli overlay restano sheet di sistema, con vetro nativo dove lo fornisca l'OS: la prescrizione di opacità riguarda le superfici strutturali e cliniche, non questi elementi transitori. `matchedGeometryEffect` è ammesso solo per il filo che prosegue.
- **Windows**: Mica rimane il fondo della finestra, il suo "canvas" idiomatico, mentre i tre livelli di luce sono affidati ai layer fill. Il Registro usa Cascadia Mono quando Plex non sia impacchettato.
- **Linux/GNOME**: poiché Lume è già opaco e piatto, l'adattamento consiste in toni compatibili con Adwaita per le zone di luce e nell'accento del filo, senza dover rimuovere blur.
- **Stampa**: Inchiostro ([../vetro-clinico/08-esplorazioni.md](../vetro-clinico/08-esplorazioni.md), D) è già il registro di stampa di Lume; il Registro mono ne estende la distinzione dei valori.

## 9. Contratti invariati

Restano integralmente validi i contratti di accessibilità ([../vetro-clinico/06-accessibilita.md](../vetro-clinico/06-accessibilita.md)), interazione e stati onesti ([../vetro-clinico/04-interazione.md](../vetro-clinico/04-interazione.md)), responsività e densità ([../vetro-clinico/05-responsivita.md](../vetro-clinico/05-responsivita.md)). `scripts/check-lume-tokens.mjs` misura sul sorgente token il testo primario e attenuato su tutte e quattro le superfici, oltre all'accento minerale interattivo sulle superfici di lavoro, penombra e fuoco. La soglia è 4,5:1, poiché si tratta di testo di dimensione normale, e tutte le trenta coppie dichiarate la superano. Il risultato riguarda quelle coppie testo/superficie, non l'accessibilità complessiva: segnali clinici, stati di focus, componenti e superfici native richiedono le verifiche previste nelle fasi successive.