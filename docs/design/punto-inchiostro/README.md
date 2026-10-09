---
summary: "Dossier della direzione estetica Punto d'inchiostro: da dove partire, che cosa è deciso, come lavorare e come regolare il disegno."
read_when:
  - "Implementando o rivedendo una superficie MediFlow su web, macOS, Windows, Linux, iPhone, iPad o iPhone Duo."
  - "Cercando misure, token, testi, movimento o stati di un componente."
---

# Punto d'inchiostro: dossier per chi implementa

Questo dossier serve a chi porterà la nuova direzione estetica nel prodotto,
persona o modello. Contiene ciò che è stato deciso, le misure, gli stati,
i testi e uno strumento per vedere e regolare ogni schermata. Chi implementa
sceglie file, strutture e ordine; non deve ridecidere il disegno.

Stato: **destinazione approvata, non ancora nel prodotto.** Leonardo ha scelto
la direzione e confermato la cifra il 9 ottobre 2026. Finché
[WUL-765](https://linear.app/wulfgardr/issue/WUL-765) non aggiorna il
contratto, nel runtime valgono ancora [`DESIGN.md`](../../../DESIGN.md),
ADR 0078 e i token Lume correnti. Punto d'inchiostro è un'evoluzione di Lume,
non una lingua nuova.

## Da dove partire

| Ordine | File | A che cosa serve |
| --- | --- | --- |
| 1 | questo file | Decisioni, modo di lavorare, che cosa resta aperto |
| 2 | [banco/index.html](./banco/index.html) | Tutte le schermate di riferimento su nove dispositivi, in Giorno e Grafite, con regolazione dei token. Si apre nel browser, senza server. Copia pubblicata: <https://claude.ai/artifact/5sjmwScMRwyjHyN1EtSZW4> |
| 3 | [01-specifica.md](./01-specifica.md) | Token, tipografia, forma, componenti con misure e stati, movimento, testi |
| 4 | [02-piattaforme-e-schermate.md](./02-piattaforme-e-schermate.md) | Che cosa è uguale ovunque, che cosa segue la piattaforma, mappa di ogni schermata |
| 5 | [03-ascolto-della-visita.md](./03-ascolto-della-visita.md) | Microfono, stati dell'ascolto, rapporto con ADR 0113 |
| 6 | [tokens/punto-inchiostro.tokens.json](./tokens/punto-inchiostro.tokens.json) | I valori in formato DTCG, Giorno e Grafite |

In Linear: documento
[MediFlow, Direzione estetica](https://linear.app/wulfgardr/document/mediflow-direzione-estetica-8e713290463a)
e issue WUL-765, 766, 767, 768, 769, 771, 772.

## La direzione in dieci righe

1. **Un punto, tre inchiostri.** Matita: lo propone un modello o un agente,
   non è in cartella. Inchiostro fresco: lo sta scrivendo il medico, è una
   bozza. Inchiostro asciutto: è registrato.
2. **Il punto** è il segno di MediFlow. Chiude il nome del prodotto, precede
   lo stato di una scrittura, segnala in elenco bozze e proposte. Quando una
   scrittura è registrata cade, si posa e diventa nero.
3. **Tutto il paziente in una schermata** su desktop: quadro a sinistra,
   diario a destra.
4. **Due voci.** Serif (Newsreader) per nomi dei pazienti e prosa clinica.
   Carattere di sistema per controlli e tabelle. Mono (IBM Plex Mono) per
   dosi, codici, date.
5. **Un solo piano in luce** su un fondo in penombra.
6. **Tabelle a filetti**, mai una card per riga.
7. **La scrittura nasce nel diario**, con il quadro accanto, e passa da una
   soglia sempre visibile che dice che cosa verrà scritto e a chi.
8. **Il colore ha un mestiere per volta.** Blu: inchiostro fresco e azione.
   Ocra, rosso, verde: segnali clinici, sempre con forma e testo.
9. **Nessun movimento nei gesti ripetuti.** Si muovono solo il punto che si
   posa e l'inchiostro che asciuga.
10. **Stessa famiglia ovunque.** Segno, inchiostri, parole e caratteri dei
    contenuti non cambiano. Finestre, controlli, raggi e materiali sono quelli
    della piattaforma.

## Decisioni prese

| Decisione | Scelta | Data |
| --- | --- | --- |
| Direzione | Struttura densa da strumento, voce serif, luce e inchiostro | 9 ottobre 2026 |
| Cifra | Un punto, tre inchiostri | 9 ottobre 2026 |
| Carattere dei controlli | Quello di sistema su ogni piattaforma, web compreso. Inter esce dall'interfaccia | 9 ottobre 2026 |
| Sito pubblico | Lo realizza il modello che Leonardo sceglierà, con gli strumenti che servono. La forma è in questo dossier | 9 ottobre 2026 |
| Ascolto della visita | Il percorso è già deciso da ADR 0113: Mac con macOS 26, trascrizione locale, audio mai salvato. Qui si decide il disegno | 1 settembre 2026 |

## Decisioni ancora di Leonardo

Sono elencate nelle issue che le riguardano. In breve:

- quali scritture passano dalla soglia in due tempi e quali con un solo gesto
  (WUL-767);
- la parola per l'audio: questo dossier propone "ascolto" al posto di
  "registrazione", perché "Registra" è già il comando che scrive in cartella
  (WUL-772);
- estendere l'ascolto oltre il Mac richiede una valutazione misurata di un
  modello locale e una decisione sul perimetro (WUL-772);
- l'icona dell'applicazione (WUL-768).

## Come lavorare

- **Il banco è il riferimento visivo.** Per ogni schermata scegli il
  dispositivo, guarda Giorno e Grafite, prova il flusso. Dove il banco e la
  specifica divergono, vale la specifica e il banco va corretto.
- **Le misure sono nei token.** Non inventare valori intermedi: se una misura
  manca, aggiungila ai token e alla specifica nello stesso cambiamento.
- **Il controllo nativo vince sulla copia.** Su macOS, Windows, Linux e iOS si
  usano i controlli della piattaforma. Si riproducono a mano soltanto il
  punto, i tre inchiostri, la voce di diario e la soglia.
- **Ogni stato ha la sua parola.** I testi sono in
  [01-specifica.md](./01-specifica.md#testi). Non si riscrivono per variare.
- **Prima la prova che conta.** Per le scritture: browser o app sulla build
  vera, SQLite vero, dati sintetici, un caso che fallisce. Il metodo è nel
  documento comune di lavoro in Linear.
- **Solo dati sintetici.** I dati veri dei pazienti non si usano per prove e
  schermate. La paziente del banco, Moretti Elena, è inventata.

## Come regolare il disegno

Il banco ha un pannello "Regola i token": cambia inchiostri, penombra, altezza
di riga, raggi, corpi e durate, e mostra subito l'effetto su ogni schermata e
dispositivo. "Esporta" produce i valori in formato DTCG.

Per cambiare una decisione di disegno:

1. prova il valore nel banco su almeno web, iPhone e Grafite;
2. aggiorna `tokens/punto-inchiostro.tokens.json` e la costante `T0` in
   `banco/index.html`, che ne è lo specchio;
3. se cambia un colore, ricalcola il contrasto e scrivilo nella descrizione
   del token: il testo deve restare almeno a 4,5:1;
4. aggiorna la riga corrispondente della specifica.

Altri interruttori del banco: "Mostra i controlli" traccia ogni elemento
interattivo, per verificare bersagli e ordine; "Movimento ridotto" mostra il
comportamento senza animazioni; "Simula errore" porta la scrittura e
l'ascolto nei loro stati di errore.

## Che cosa il banco non è

- Non è codice di prodotto: è HTML statico con dati inventati.
- Le cornici di macOS, Windows, Linux e iOS sono schizzi che mostrano la
  disposizione, non riproduzioni dei controlli nativi.
- Le misure di iPhone Duo sono ricavate dai pixel riportati dalla stampa al
  lancio, non dalla documentazione Apple: vanno verificate prima di
  implementare.
- Carica Newsreader e IBM Plex Mono da Google Fonts. Nel prodotto i caratteri
  sono file locali.
- Copre 17 schermate di riferimento. Le superfici restanti sono assegnate a
  una di esse nella mappa delle schermate, non disegnate una per una.

## Da dove viene

Prototipi di confronto fra le tre direzioni iniziali e la sintesi:
<https://claude.ai/artifact/N2dP4HpDnjuUouJoSy9xK5>. Reference dallo studio
estetico di Leonardo, usato come libreria: Sales CRM di Marcel Kargul, Frame
e Table di coss, griglie dense di ReUI, Emil Kowalski sul movimento per
frequenza, Fluid Functionalism, New Form e Seline su Refero Styles.
