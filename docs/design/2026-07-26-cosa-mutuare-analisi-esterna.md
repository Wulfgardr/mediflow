# Cosa mutuare: confronto critico con lo stato dell'arte

Data: 2026-07-26
Perimetro: ricerca esterna, confrontata con il codice MediFlow che ho letto oggi.
Le fonti sono citate. Dove una cosa e' misurata lo dico, dove e' opinione di
settore lo dico ugualmente.

## 1. La cosa piu' utile che ho trovato, ed e' misurata

Uno studio su npj Digital Medicine separa due leve che nella pratica vengono
confuse, e mostra che **tirano in direzioni opposte**:

| leva | effetto | coefficiente |
|---|---|---|
| usabilita' di **sistema** | **riduce** il carico cognitivo *estraneo* | β = −0,642 (p < 0,001) |
| usabilita' del **dato** | **aumenta** il carico cognitivo *germano* | β = +0,597 (p < 0,001) |

Il carico estraneo e' lo sforzo speso per combattere l'interfaccia: navigare,
cercare dove sta una cosa, ripetere passaggi. Va abbassato.
Il carico germano e' lo sforzo speso a **ragionare sul caso**. Va alzato.

Questo cambia il modo di leggere una critica di interfaccia. "Semplifica" non e'
un obiettivo: dipende da quale dei due carichi si sta togliendo. Togliere un
passaggio di navigazione e' guadagno puro; togliere un dato clinico rilevante
per fare pulizia e' una perdita travestita da miglioramento.

Nota di contesto che vale da sola: l'EHR piu' diffuso nel campione, Epic, ha un
punteggio SUS medio di **45,9**, che sulla scala e' una bocciatura. La barra
dell'industria in cui MediFlow si colloca e' bassa.

Le raccomandazioni operative dello studio, tradotte:

1. **Consolidare i flussi** per ridurre i passaggi di navigazione.
2. **Collocare in una sola vista** le informazioni diagnostiche chiave.
3. **Solo avvisi ad alto segnale**, perche' un avviso che si ignora addestra a
   ignorare gli avvisi.
4. **Incorporare indicatori di affidabilita' del dato**, sopprimere i duplicati,
   standardizzare le regole di completezza.

Il punto 4 e' letteralmente il lavoro fatto oggi sugli stati onesti: "indicatore
di affidabilita'" e' il nome accademico di "non dire vuoto quando vuoi dire non
letto". E il punto 2 e' l'argomento a favore del Quadro contro il salto continuo
fra moduli.

## 2. La regola che chiude una nostra questione aperta

In `10-superficie-e-materiale.md` avevo lasciato aperta la domanda se le
superfici Lume debbano diventare materiali. La risposta e' nella guida di Apple,
e non e' un compromesso:

> Liquid Glass appartiene **solo allo strato di navigazione** che galleggia sopra
> il contenuto. Non va mai applicato al contenuto stesso: liste, schede, tabelle,
> media.

E, tecnicamente:

> Il vetro non puo' campionare altro vetro. Piu' elementi di vetro vanno
> racchiusi in un contenitore.

Due conseguenze per noi.

**Prima: la scelta che hai fatto era quella giusta, e ora ha una fonte.** Avevi
detto contenuto in Lume e cromo di sistema. E' esattamente la ripartizione che
Apple prescrive. Lume non deve diventare un materiale: Lume **e'** il linguaggio
dello strato di contenuto, dove i valori opachi sono corretti e misurabili. Il
vetro sta sopra, e non gli appartiene.

**Seconda: il difetto trovato oggi sul cockpit e' un anti-pattern dichiarato.**
Le cinque cornici concentriche fra scheda e pagina, con due coppie di livelli
dello stesso colore, sono vetro su vetro nello strato di contenuto. Non era una
questione di gusto.

## 3. Cosa fanno le applicazioni con la migliore reputazione di immediatezza

Qui siamo nel campo dell'opinione di settore, non della misura. Le pratiche
ricorrenti, e quali valgono per noi.

### Vale, e molto: la divulgazione progressiva a tre stadi

Linear mostra tre livelli sullo stesso oggetto: la riga in elenco, le azioni che
appaiono al passaggio del puntatore, la vista di dettaglio completa. Ogni strato
aggiunge senza anticipare complessita'.

Da noi la topologia c'e' gia' ma e' incompleta. La riga paziente della worklist
mostra nome, eta', codice, diagnosi con pillola ICD: e' un primo stadio buono. Il
Quadro e' il terzo. **Manca il secondo**: sulla riga non c'e' nessuna azione
raggiungibile senza aprire. Su Mac e iPad, dove c'e' spazio e un puntatore, le
azioni piu' frequenti (nuova voce, apri documenti) potrebbero stare li'.

### Vale: una tavolozza di comandi

Il tasto unico che porta a qualunque azione in due battute, senza ricordare dove
sta nei menu. Da noi il candidato naturale non e' generico: e' **cerca paziente e
agisci**. Oggi la ricerca filtra la lista e si ferma li'. Una tavolozza che
accetta "Rossi" e poi offre apri, nuova voce, esporta, sarebbe il collasso di
tre passaggi in uno.

Attenzione a non copiare male: Linear puo' essere tutto-tastiera perche' il suo
pubblico pensa per scorciatoie. Un medico no, e su iPad spesso non ha tastiera.
Va aggiunta come **acceleratore**, mai come la strada principale.

### Vale con giudizio: l'interfaccia ottimista

Linear mostra l'effetto subito e parla col server dopo. Su una lista di attivita'
e' giusto. **Su un dato clinico non lo e'**: mostrare una prescrizione come
salvata prima che l'archivio l'abbia accettata e' una bugia con conseguenze. La
pratica si puo' mutuare solo dove l'operazione e' reversibile e non clinica:
ordinamento, filtri, selezione, ambito ambulatorio.

### Non vale: la densita' come valore in se'

Molte applicazioni gestionali si vantano di quante righe stanno a schermo. Lo
studio dice che il guadagno sta nel **collocare in una vista cio' che serve a
decidere**, non nel massimizzare le righe. Sono cose diverse: la prima e'
selezione, la seconda e' compressione.

## 4. Proposte concrete, in ordine di rapporto valore-rischio

1. **Il secondo stadio sulla riga paziente.** Azioni al passaggio del puntatore
   su Mac e iPad, con equivalente a pressione prolungata su iPhone. Riduce
   passaggi di navigazione, cioe' carico estraneo, che e' la leva col
   coefficiente piu' alto.
2. **Un livello di superficie in meno nel cockpit.** La cornice `shell-canvas`
   disegna un angolo da 20 e un bordo **sul colore stesso della pagina**: e' un
   livello che non e' una superficie. Toglierlo e' sottrazione senza perdita.
3. **La tavolozza cerca-e-agisci**, come acceleratore.
4. **Indicatori di affidabilita' generalizzati.** Il modello onesto esiste ora in
   tre viste. Le altre superfici cliniche non lo hanno ancora.
5. **Gli avvisi ad alto segnale.** Da verificare quanti stati di avviso il
   cockpit mostra contemporaneamente: se sono molti e sempre presenti, insegnano
   a essere ignorati.

## 5. Quello che non propongo, e perche'

- **Non toccare la densita' della worklist.** Funziona, e lo studio non da'
  ragioni per comprimerla.
- **Non introdurre animazioni espressive nello strato di contenuto.** Il
  carattere per iPhone e iPad va nello strato di navigazione e nei controlli, che
  e' dove il vetro e il movimento appartengono. Una scheda clinica che rimbalza
  non aggiunge fiducia.
- **Non copiare il tutto-tastiera** come modo principale.

## Fonti

- [When better data meets better design: How EHR data usability and system usability shape physicians' cognitive load, npj Digital Medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC12864774/) — studio con i coefficienti citati
- [Liquid Glass guide, distillazione comunitaria di HIG e sessioni WWDC 2025](https://github.com/giorgio-a11y/liquid-glass-guide/blob/main/LIQUID-GLASS-GUIDE.md) — regole su strato di navigazione e vetro su vetro
- [Meet Liquid Glass, WWDC25, Apple](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Liquid Glass: Hierarchy, Harmony and Consistency, Create with Swift](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/) — i tre principi
- [Linear's design patterns, Gunpowder Labs](https://gunpowderlabs.com/2024/12/22/linear-delightful-patterns) e [Linear Design Breakdown, 925 Studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) — divulgazione progressiva, tavolozza comandi
- [How is Linear so fast, performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) — interfaccia ottimista
- [Healthcare App UI/UX Best Practices 2026, Fuselab](https://fuselabcreative.com/healthcare-app-ui-ux-design-best-practices/)
