# Cosa mutuare: confronto critico con lo stato dell'arte

Data: 2026-07-26
Perimetro: ricerca esterna confrontata con il codice MediFlow esaminato alla
data della nota. Le fonti sono citate e restano distinti i risultati misurati
dalle opinioni di settore.

<a id="1-la-cosa-piu-utile-che-ho-trovato-ed-e-misurata"></a>

## 1. La distinzione più utile emersa dalla ricerca

Uno studio su npj Digital Medicine distingue due leve che, nel discutere
un'interfaccia, si tende a confondere: l'usabilità del sistema e quella del
dato. Nei risultati riportati agiscono su carichi cognitivi diversi,
**in direzioni opposte**:

| leva | effetto | coefficiente |
|---|---|---|
| usabilità di **sistema** | **riduce** il carico cognitivo *estraneo* | β = −0,642 (p < 0,001) |
| usabilità del **dato** | **aumenta** il carico cognitivo *germano* | β = +0,597 (p < 0,001) |

Il carico estraneo è lo sforzo richiesto dall'interfaccia per navigare,
ritrovare un'informazione o ripetere passaggi: va ridotto. Il carico germano
riguarda invece il lavoro necessario a **ragionare sul caso**, ed è questo
che occorre favorire.

La distinzione rende insufficiente la richiesta generica di "semplificare":
bisogna capire quale sforzo si stia eliminando. Togliere un passaggio di
navigazione libera attenzione; togliere un dato clinico rilevante per ottenere
una schermata più pulita può invece impoverire la decisione.

Il contesto del confronto conta: Epic, l'EHR più diffuso nel campione,
raggiunge un punteggio SUS medio di **45,9**, valutato negativamente sulla
scala. Il confronto con l'industria parte quindi da un livello di usabilità
basso, non da un riferimento già soddisfacente.

Lo studio traduce la distinzione in quattro raccomandazioni operative:

1. **Consolidare i flussi** per ridurre i passaggi di navigazione.
2. **Riunire in una sola vista** le informazioni diagnostiche chiave.
3. **Mostrare solo avvisi ad alto segnale**, perché l'abitudine a ignorarli
   finisce per ridurne l'efficacia.
4. **Rendere visibile l'affidabilità del dato**, sopprimere i duplicati e
   standardizzare le regole di completezza.

Il punto 4 dà una ragione al lavoro sugli stati esaminato in questa nota:
distinguere "non letto" da "vuoto" significa rendere leggibile l'affidabilità
dell'informazione. Il punto 2 sostiene invece il Quadro, che riunisce ciò
che serve al caso senza imporre continui passaggi fra moduli.

## 2. La regola che chiude una nostra questione aperta

In `10-superficie-e-materiale.md` era rimasta aperta la domanda se le
superfici Lume dovessero diventare materiali. Le indicazioni Apple richiamate
nelle fonti distinguono il contenuto dalla navigazione:

> Liquid Glass appartiene **solo allo strato di navigazione** che galleggia
> sopra il contenuto. Non va mai applicato al contenuto stesso: liste, schede,
> tabelle o media.

La stessa separazione ha un risvolto tecnico:

> Il vetro non può campionare altro vetro. Più elementi di vetro vanno
> racchiusi in un contenitore.

Per MediFlow ne derivano due conseguenze.

**La distinzione già scelta fra contenuto Lume e comandi di sistema trova
qui il proprio riferimento.** Lume non deve diventare un materiale: è la
lingua dello strato di contenuto, nel quale i valori opachi restano corretti
e misurabili. Il vetro appartiene allo strato sovrastante, non alle
informazioni cliniche.

**Il difetto rilevato nel cockpit non riguarda soltanto il gusto.**
Le cinque cornici concentriche fra scheda e pagina, con due coppie di livelli
dello stesso colore, sovrappongono vetro a vetro nello strato di contenuto:
è il modello da evitare descritto dalle indicazioni citate.

## 3. Cosa fanno le applicazioni con la migliore reputazione di immediatezza

Qui il confronto riguarda opinioni di settore, non misure. Le pratiche
ricorrenti vanno quindi giudicate per ciò che possono offrire a MediFlow,
non assunte come prova di efficacia.

### Vale, e molto: la divulgazione progressiva a tre stadi

Linear distribuisce lo stesso oggetto in tre livelli: riga in elenco,
azioni al passaggio del puntatore e dettaglio completo. Ogni livello aggiunge
informazione o possibilità d'azione quando serve, senza anticipare tutta
la complessità.

MediFlow ha già parte di questa struttura: la riga paziente mostra nome,
età, codice e diagnosi con pillola ICD, mentre il Quadro offre il dettaglio.
**Manca il secondo livello**, perché nella ricognizione la riga non consente
azioni senza aprirla. Su Mac e iPad, dove spazio e puntatore lo permettono,
nuova voce e apertura dei documenti potrebbero essere raggiungibili da lì.

### Vale: una tavolozza di comandi

Una tavolozza permette di raggiungere un'azione in due battute senza
ricordarne la posizione nei menu. Per MediFlow l'uso più pertinente è
**cercare il paziente e agire**: la ricerca esaminata filtra la lista ma
non prosegue. Digitare "Rossi" e scegliere fra apri, nuova voce ed esporta
ridurrebbe tre passaggi a uno.

Non va però mutuato il presupposto di un pubblico abituato alle scorciatoie:
un medico non necessariamente lo è e su iPad può non avere una tastiera.
La tavolozza va aggiunta come **acceleratore**, mai come percorso principale.

### Vale con giudizio: l'interfaccia ottimista

Linear anticipa a schermo l'effetto di un'azione e comunica con il server
dopo. Questa scelta può funzionare per una lista di attività, **non per un
dato clinico**: una prescrizione non può apparire salvata prima che l'archivio
l'abbia accettata. La pratica è trasferibile soltanto a operazioni reversibili
e non cliniche, come ordinamento, filtri, selezione e ambito ambulatorio.

<a id="non-vale-la-densita-come-valore-in-se"></a>

### Non vale: la densità come valore in sé

Il numero di righe visibili non misura da solo l'utilità di un gestionale.
Il beneficio indicato dallo studio sta nel **riunire ciò che serve a decidere**:
selezionare informazioni pertinenti è diverso dal comprimere più contenuti
nello stesso spazio.

## 4. Proposte concrete, in ordine di rapporto valore-rischio

1. **Aggiungere il secondo livello alla riga paziente.** Azioni al passaggio
   del puntatore su Mac e iPad, con equivalente a pressione prolungata su
   iPhone, riducono navigazione e carico estraneo, la leva con il coefficiente
   più alto nel confronto.
2. **Togliere un livello di superficie nel cockpit.** La cornice `shell-canvas`
   disegna un angolo da 20 e un bordo **sullo stesso colore della pagina**:
   eliminarla rimuove un livello che non distingue una superficie.
3. **Introdurre la tavolozza cerca-e-agisci** come acceleratore.
4. **Estendere gli indicatori di affidabilità.** Il modello degli stati onesti
   è presente, alla data della nota, in tre viste, non ancora nelle altre
   superfici cliniche.
5. **Verificare gli avvisi ad alto segnale.** Occorre contare quanti stati di
   avviso il cockpit mostri insieme: se numerosi e permanenti, abituano a
   ignorarli.

<a id="5-quello-che-non-propongo-e-perche"></a>

## 5. Che cosa non viene proposto, e perché

- **Non modificare la densità della worklist.** Funziona e lo studio non
  offre ragioni per comprimerla.
- **Non introdurre animazioni espressive nello strato di contenuto.**
  Su iPhone e iPad il carattere appartiene a navigazione e controlli, insieme
  a vetro e movimento; far rimbalzare una scheda clinica non aggiunge fiducia.
- **Non fare della tastiera il percorso principale.**

## Fonti

- [When better data meets better design: How EHR data usability and system usability shape physicians' cognitive load, npj Digital Medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC12864774/) — studio con i coefficienti citati
- [Liquid Glass guide, distillazione comunitaria di HIG e sessioni WWDC 2025](https://github.com/giorgio-a11y/liquid-glass-guide/blob/main/LIQUID-GLASS-GUIDE.md) — regole su strato di navigazione e vetro su vetro
- [Meet Liquid Glass, WWDC25, Apple](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Liquid Glass: Hierarchy, Harmony and Consistency, Create with Swift](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/) — i tre principi
- [Linear's design patterns, Gunpowder Labs](https://gunpowderlabs.com/2024/12/22/linear-delightful-patterns) e [Linear Design Breakdown, 925 Studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) — divulgazione progressiva, tavolozza comandi
- [How is Linear so fast, performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) — interfaccia ottimista
- [Healthcare App UI/UX Best Practices 2026, Fuselab](https://fuselabcreative.com/healthcare-app-ui-ux-design-best-practices/)
