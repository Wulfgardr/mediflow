---
summary: "Specifica del redesign 0.9.1: scheda «Stabile e cambiato» per larghezza e per stato, ciò che i dati attestano, controlli riconoscibili, ipotesi da smentire e inventario delle viste Web e GPUI."
read_when:
  - "Implementando la scheda a zone, la fascia «Dall'ultima visita», la fonte o la bozza su Web e GPUI."
  - "Applicando D17-D31 alle viste fuori dalla scheda, o verificando copertura e lacune per vista."
  - "Preparando una simulazione con dato di verità per cambiare una regola di questo documento."
---

# Stabile e cambiato: scheda e controlli della 0.9.1

Decisioni del 18 novembre 2026, per WUL-894. Fra cinque prototipi della stessa
cartella Leonardo ha scelto la struttura D, «Stabile e cambiato», e ha poi
precisato che è una direzione di ricerca: si migliora anche cambiandone i
comportamenti. Questo documento la porta in specifica per il Web locale e per
GPUI sul Mac, dichiara dove si scosta dal prototipo scelto e scrive le regole
come ipotesi, ciascuna con l'osservazione che la smentisce.

Completa la [specifica](./01-specifica.md) e
l'[addendum compositivo](./02-addendum-composizione.md). Dove modifica una loro
regola lo dice. I criteri di accettazione restano quelli
dell'[emendamento del 18 novembre](../../releases/0.9.1-contract.md#emendamento-del-18-novembre-2026-per-il-redesign-web-e-gpui):
questo documento non aggiunge gate.

## In breve

- La scheda si apre sul Riepilogo, che ha tre zone: **Stabile** (problemi,
  terapie attive, note), **Cambiato e diario** (la fascia «Dall'ultima visita»
  sopra il diario), **Contesto** (Quadro paziente, parametri, controlli,
  documenti, e la fonte o la bozza quando sono aperte).
- Le zone si affiancano da 1280 px, diventano due da 1000 e una colonna sotto.
- La fascia dice solo ciò che la scheda attesta. Per una terapia non esiste un
  valore precedente, un motivo, un autore o una fonte collegata: la riga non li
  finge.
- Si scrive nel Contesto in tre passi con il loro nome: Scrivi, Rivedi,
  Registrata. Dopo la conferma si rilegge ciò che è stato salvato.
- Titoli, campi, selettori e indici seguono D21-D24, ora chiuse.
- Le viste fuori dalla scheda seguono gli stessi criteri, elencati per vista.

## Riferimento eseguibile

[prototipi/scheda-stabile-e-cambiato.html](./prototipi/scheda-stabile-e-cambiato.html)
è la scheda di questo documento, con i token di Punto d'inchiostro e una
paziente inventata. Si apre nel browser senza server e senza rete. In alto si
scelgono il caso, il modo di mostrare i contatti, il posto delle variazioni di
terapia ed il tema. La larghezza si cambia ridimensionando la finestra.

`node docs/design/punto-inchiostro/prototipi/verifica-scheda.mjs` guida il
riferimento in Chrome a 1440, 1280, 1180, 1000, 768 e 390 px, nei quattro casi
e nei due temi, e controlla le regole di D26-D30. Con una cartella come
argomento salva le catture. Il 18 novembre: 701 controlli passati su 701.

Il riferimento prova composizione, ordine, testi e conservazione di bozza e
cursore. Non prova il prodotto: non legge un archivio, non scrive, e i suoi
dati sono costruiti con gli stessi campi della scheda ma non con il suo codice.

Il prototipo scelto da Leonardo è conservato fuori dalla repository
(`mf-coord-091/uscita-20261118/cartella-confronto.html`, struttura D). L'ho
guidato in Chrome nei due scenari, ritorno e primo accesso, sulla tela di
1180 × 660: le misure sono in [Scarti dal prototipo scelto](#scarti-dal-prototipo-scelto).

## D17. La scheda si apre su fatti registrati

Aprendo un paziente, senza generare nulla, si leggono:

- nome, età e nascita, anche quando l'anno è stimato
- l'identificativo con il suo nome (CF, STP, ENI, Documento), oppure
  «Nessun identificativo per ora» quando manca (ADR 0179)
- le allergie, la loro assenza registrata, oppure «Allergie: dato non
  disponibile» quando la superficie non le riceve
- i problemi documentati, con codice, nell'ordine in cui sono registrati
- le ultime modifiche di terapia, con la data
- le ultime voci del diario, con autore e data di registrazione.

Con tre zone tutto questo sta nel primo sguardo. Con due zone e in larghezza
media restano nel primo sguardo identità, allergie, Quadro paziente, fascia e
problemi. In larghezza compatta i problemi arrivano entro uno scorrimento di
pagina, dopo la fascia.

L'ordine dei problemi è quello della cartella e non esprime una priorità
clinica. Vietato ordinare i problemi per importanza presunta, riassumere con
testo generato ciò che la cartella contiene già, o mostrare un'età ricavata da
un codice che non la attesta.

## D18. Stato attuale ed eventi sono cose diverse

«Terapie attive» dice che cosa il paziente assume oggi. Le variazioni dicono
che cosa è cambiato: per ogni terapia l'ultimo evento che la scheda attesta
(Avviata, Aggiornata, Sospesa, Conclusa) con la sua data. Le due liste non si
fondono e non usano lo stesso titolo.

Al ritorno le variazioni di terapia sono righe della fascia (D28). Quando la
fascia non ne ha, perché manca una visita di riferimento o perché dopo la
visita la terapia non è cambiata, sopra il diario compare la sezione «Ultime
modifiche di terapia» con le quattro più recenti. Così le ultime modifiche con
data si leggono in ogni caso, come chiede il contratto.

La scheda non conserva una storia per terapia. Per una sospensione la data è
quella dell'ultima modifica registrata, e la sezione non ricostruisce passaggi
che la cartella non ha.

Modifica D9: la tabella «Controlli aperti» resta, nel Contesto.

## D19. Il Quadro paziente si raggiunge dalla scheda e resta una proposta

L'ingresso è un blocco a matita in cima al Contesto: titolo «Quadro paziente»,
parola «Proposta» con la data di generazione quando il dato la porta, comando
secondario «Apri il Quadro e le fonti». In una colonna diventa una riga sola,
la prima sotto i segmenti. Il comando porta all'area delle proposte: non
genera nulla e non cambia la cartella.

Fatti e proposta si distinguono per posto e per inchiostro: i fatti sono a
inchiostro asciutto, la proposta è a matita, con modello, fonti e data dentro
la propria area.

Vietato generare all'apertura della scheda, ripetere il pannello nel
Riepilogo o dare al comando il fondo pieno del principale.

## D20. La riga dice ciò che serve

Una riga di registro mostra senza aprire ciò che serve a leggerla: per una
terapia farmaco, posologia, indicazione o nota, diagnosi collegata e periodo.
I codici stanno nella riga con peso minore, in carattere da codice. Una
disclosure dentro la riga è ammessa solo per contenuto che la riga non può
ospitare, come referti e allegati. Non ripete mai ciò che è già in colonna.

In larghezza ridotta la riga impila gli stessi dati. Non nasconde colonne
dietro un controllo.

Vale per Terapie, Prestazioni, Protesica e Documenti. Per un documento:
nome, identità, data e dimensione su una riga, stato sotto, azioni accanto
al nome. L'originale aperto occupa l'altezza della finestra.

Nella zona Stabile le righe sono ridotte: problema e codice, farmaco e
posologia. Il registro completo sta nel segmento corrispondente.

## D21. Le superfici flottanti hanno il raggio dei controlli

Menu, pannelli di azioni, risultati di ricerca e avvisi temporanei sono
superfici flottanti: prendono il raggio dei controlli (Web 10, GPUI sul Mac
12), non quello dei record, che resta 0. Le righe al loro interno hanno un
raggio concentrico, cioè il raggio esterno meno il rientro. Ogni voce ha
margine, stato al passaggio e fuoco visibile, e l'azione distruttiva resta
l'ultima.

Vietata una cornice squadrata attorno a righe arrotondate, come già chiede
`DESIGN.md` per le cornici annidate.

## D22. Segmenti e indice hanno segni diversi

I segmenti della cartella cambiano il contenuto: sottolineatura sotto la voce
attiva, e restano in vista mentre si legge una sezione. Un indice elenca le
sezioni di una pagina unica, come in Analisi e nella libreria delle Scale:
porta la dicitura «In questa pagina», segna la sezione scelta con il solo
peso del testo, senza sottolineatura, e scorre fino a mostrarla.

In entrambi i casi la voce segnata è quella scelta, finché è visibile. Dopo
uno scorrimento l'indice torna a segnare la sezione che si sta leggendo.

## D23. Il contorno dei campi si vede

Un campo che riceve testo o una scelta ha un contorno che si distingue almeno
3:1 a riposo, sia dal fondo del campo sia dalla superficie che lo circonda,
nei due temi. Ogni campo ha un'etichetta visibile associata al controllo, e i
gruppi di scelte hanno un nome.

Chiusa (WUL-893). Il valore è uno solo per Web e GPUI: l'inchiostro
secondario, già in uso nei campi della cartella Web (6,56:1 in Giorno). Sul
riferimento il contorno della bozza misura almeno 3:1 nei due temi, contro il
campo e contro il blocco che lo contiene. Il filetto forte resta per le
intestazioni e per i comandi secondari. Modifica la riga «Campo» della
specifica.

## D24. I titoli di sezione si leggono

Il titolo di una sezione è in carattere di sistema, 15 px, peso 600, senza
maiuscolo, con il conteggio secondario a destra. Le intestazioni di colonna e
le etichette di gruppo, come il giorno nella fascia, restano a 12 px in
maiuscolo. Su GPUI il corpo segue in proporzione quello nativo.

Chiusa (WUL-892). A 14 px e peso 600 il titolo avrebbe lo stesso corpo e lo
stesso peso del nome di un farmaco nella riga sotto. Il prototipo scelto usa
già 15 px. Modifica la tabella tipografica della specifica e D10
dell'addendum, che prescriveva il maiuscoletto a 12 px. Il conteggio dice
sempre che cosa conta: «4 documentati», non «4».

Nel file dei token `intestazione-sezione` vale ancora 12 px. Il token, il
guard `check:type-scale` ed il ruolo `TypeRole` di GPUI cambiano nello stesso
cambiamento del codice che li usa, come chiede il dossier.

## D25. Scrivere, rivedere, registrare: l'esito si riconosce

Per una voce, una nota della scheda o una modifica di terapia, su Web e su
GPUI:

1. il comando che apre la scrittura ha il nome di ciò che si scrive: «Nuova
   voce» nella testata, «Modifica» nella riga del titolo «Note della scheda»
2. la bozza si apre nel Contesto (D30) e mostra i tre passi con il loro nome:
   «1 · Scrivi», «2 · Rivedi», «3 · Registrata». Il punto dice «Bozza non
   registrata»
3. il primo comando è «Rivedi». Non promette una scrittura che non fa:
   sostituisce «Registra N elementi»
4. la revisione ha il titolo «Che cosa verrà registrato», mostra paziente,
   tipo o oggetto e testo, e ha un solo comando principale: «Conferma e
   registra». Il ritorno si chiama sempre «Torna alla bozza», anche con Esc
5. a bozza aperta il comando della testata è secondario e chiude la bozza
   («Chiudi la voce», «Chiudi la nota»). In tutta la vista il fondo pieno è
   uno solo: «Nuova voce» a riposo, «Rivedi» scrivendo, «Conferma e registra»
   in revisione (D1)
6. dopo la registrazione il passo 3 dice «Registrata alle 22:27» e, sotto,
   mostra il testo riletto dallo stato salvato. L'oggetto registrato si
   rilegge anche dove vive: la voce in cima al diario, la nota al suo posto,
   con «Registrata alle 22:27 da Autore»
7. un rifiuto o un conflitto compare nel blocco della bozza, con la bozza
   conservata e un solo modo per rileggere. Il passo 3 non si accende
8. dalla stessa vista si arriva al registro delle operazioni.

I tre passi sono la soglia di queste scritture. Valgono contenuto, livelli di
conferma, atomicità e rilettura della specifica. Cambia il posto: accanto alla
bozza, non in fondo al piano. «Conferma e registra» resta in vista: quando la
revisione è più alta della zona, la riga dei comandi resta ancorata al fondo
della zona.

Vietato un comando di revisione senza nome, un esito affidato al solo colore
o alla sola ora, o una conferma che sparisce senza lasciare il testo
registrato.

## D26. Il Riepilogo ha tre zone

«Stabile e cambiato» è la composizione del Riepilogo, la prima destinazione
della cartella. Testata e segmenti restano quelli di D2, D8 e D22: gli altri
segmenti portano ai registri, dove si modifica.

| Zona | Contenuto, in ordine | Regola |
| --- | --- | --- |
| Stabile | Problemi · Terapie attive · Note della scheda | Ciò che vale finché qualcuno non lo cambia. Ogni sezione è un blocco su fondo penombra, con raggio dei controlli, senza bordo, righe a filetti |
| Cambiato e diario | Fascia «Dall'ultima visita», oppure la riga di stato · «Ultime modifiche di terapia» quando serve (D18) · Diario | Sul piano, senza blocchi. La fascia è l'unico contenitore tinto: fondo «riga selezionata», bordo filetto forte, raggio dei controlli |
| Contesto | Fonte aperta · Bozza aperta · Quadro paziente · Parametri recenti · Controlli aperti · Documenti recenti | Ciò che è aperto sale in cima. Nulla sparisce quando si scrive: il resto scorre sotto |

A bozza aperta «Documenti recenti» sale subito sotto la bozza, perché il
referto si apra senza scorrere.

Modifica la specifica: la voce in scrittura nasce nel Contesto, non in cima al
diario, ed il Quadro si divide fra Stabile e Contesto. Il blu resta ad azione e
bozza: per questo la fascia non ha il bordo blu del prototipo.

## D27. La composizione segue la larghezza

Le classi si misurano sul contenitore dell'applicazione, navigazione compresa.
Sono le stesse su Web e su GPUI, dove si misurano in punti sulla finestra.

| Classe | Contenitore | Disposizione | Che cosa scorre |
| --- | --- | --- | --- |
| Estesa ampia | da 1280 | Tre zone: Stabile 270 · Cambiato e diario · Contesto 340 | Ogni zona da sola. Testata e segmenti restano |
| Estesa | da 1000 a 1279 | Due zone: Cambiato e diario · colonna laterale 340 con, in ordine, fonte, bozza, Stabile, Contesto | Il centro e la laterale. Testata e segmenti restano |
| Media | da 700 a 999 | Una colonna. Problemi e Terapie attive affiancate | La pagina |
| Compatta | sotto 700 | Una colonna. Tutto impilato | La pagina |

Ordine in una colonna: riga del Quadro paziente, fonte aperta, bozza aperta,
fascia o riga di stato, Stabile, ultime 5 voci del diario con «Tutto il
diario», Parametri recenti, Controlli aperti, Documenti recenti. A bozza
aperta «Documenti recenti» segue la bozza.

A 1280 px il centro misura circa 478 px, margini compresi. Il prototipo scelto
non ha navigazione né segmenti: la sua tela di 1180 px corrisponde al piano di
un contenitore di 1440. Il minimo di GPUI resta 390 punti.

| Stato | Tre e due zone | Una colonna |
| --- | --- | --- |
| Ritorno con variazioni | Fascia sopra il diario | Fascia prima di Stabile |
| Ritorno senza variazioni | Una riga al posto della fascia, poi «Ultime modifiche di terapia» | Uguale |
| Nessuna visita registrata | Una riga al posto della fascia, poi «Ultime modifiche di terapia» | Uguale |
| Fonte aperta | Foglio in cima al Contesto, con «Chiudi» | Foglio sotto la riga del Quadro |
| Bozza aperta | Bozza in cima al Contesto, accanto al diario | Bozza sotto la riga del Quadro, prima della fascia |
| Fonte con bozza | Foglio sopra la bozza, che resta montata. «Torna alla bozza» chiude il foglio e ridà fuoco e cursore nel punto di prima | Uguale |
| Revisione e registrata | Nel blocco della bozza. Comandi ancorati al fondo della zona | Nel blocco della bozza |

## D28. La fascia confronta con l'ultima visita registrata

Il riferimento è l'ultima voce di diario di tipo Visita, non eliminata, di
chiunque l'abbia registrata. L'intestazione porta la data e l'autore, se la
voce lo ha: «Dall'ultima visita · 04/11 · Dott.ssa Prova Banco». Non dice
«tua» e non dice «primo accesso»: la scheda non registra chi ha aperto che
cosa.

Entra nel confronto ciò che è stato registrato o modificato dopo la
registrazione di quella voce. Il riferimento si fissa quando la scheda si
apre e non si sposta se nel frattempo si registra una visita: quella diventa
il riferimento dalla prossima apertura.

| Che cosa | Come compare |
| --- | --- |
| Variazioni di stato: terapie, parametri fuori intervallo | Una riga ciascuna, dalla più recente, raggruppate per giorno di registrazione. Nessun tetto |
| Voci di diario dopo la visita | Una riga sola in fondo alla fascia, che le conta per tipo e porta al diario: «Nel diario dopo la visita: 6 telefonate, 1 accesso, 3 note» |
| Documenti aggiunti e proposte generate | Spenti all'apertura. Compaiono come righe con «Mostra anche documenti e proposte» |
| Problemi | Non compaiono: una diagnosi non porta la data in cui è stata registrata |

Le voci del diario non sono righe della fascia perché stanno subito sotto, in
ordine di data, e comparirebbero due volte. Il conteggio usa il tipo della
voce, nell'ordine fisso dell'elenco dei tipi. Non esiste un dato che distingua
un contatto organizzativo da uno clinico, quindi la scheda non li separa e non
li ordina per importanza.

Senza una visita nel diario non c'è fascia né confronto: una riga, «Nessuna
visita registrata.». Con la visita ma senza nulla dopo: «Dall'ultima visita ·
14/11 · Dott.ssa Prova Banco: nessuna variazione registrata.».

Vietato un «prima e dopo» senza un valore precedente attestato, uno zero al
posto di un dato non letto, e un conteggio di variazioni che comprenda ciò che
la scheda non può datare.

## D29. Una variazione dice solo ciò che la scheda attesta

I campi sono quelli di `lib/db.ts` sul Web e di `transport/src/dto.rs` su
GPUI: le due superfici ricevono gli stessi dati, salvo dove indicato.

| Elemento | Dato | Che cosa si mostra | Quando il dato manca |
| --- | --- | --- | --- |
| Visita di riferimento | Voce con `type` «visit», `createdAt`, `recordedBy` | Data e autore nell'intestazione | Senza visita: «Nessuna visita registrata.». Senza autore: solo la data |
| Terapia | `status`, `version`, `updatedAt`, `createdAt`, `startDate`, `endDate`, `dosage`, `motivation` | Avviata, Aggiornata, Sospesa o Conclusa con la data di registrazione. Nel dettaglio: stato e posologia attuali, indicazione, inizio e fine | «Valore precedente non conservato». Nessun motivo, autore o fonte: non sono nei dati. «Aggiornata» non diventa «Posologia», perché non si sa quale campo è cambiato |
| Voci dello stesso giorno | Voci con `createdAt` nel giorno della modifica | Nel dettaglio della terapia, un comando per voce: «Diario del 12/11: Telefonata». Apre la voce nel Contesto | Nessuna voce quel giorno: nessun comando. Il testo non dice mai «fonte» o «motivo» |
| Parametro | `value`, `refLow`, `refHigh`, `observedAt`, `code` | Entra nella fascia solo fuori intervallo, con ▲ e «Fuori intervallo». Nel dettaglio: «4,8 mmol/L (02/10) → 5,6 mmol/L», riferimento e data della misura | Senza `refLow` o `refHigh` numerici non entra nella fascia e in «Parametri recenti» non ha segno. Senza una misura precedente con lo stesso codice: «Nessuna misura precedente» |
| Voce di diario | `type`, `title`, `content`, `recordedBy`, `createdAt` | Nel conteggio per tipo e nel diario | Senza autore: «Registrata» senza nome |
| Documento | `name`, `createdAt` dell'allegato | «Documento aggiunto» con la data, «Apri il documento» | L'allegato non porta un autore: la riga non lo nomina e non lo chiama automatico |
| Proposta | Data di generazione del Quadro (`aiSummaryGeneratedAt` sul Web) o di una sintesi, quando il dato la porta | «Proposta», a matita, «Generata l'11/11» | Senza data non entra nella fascia. Il blocco del Quadro dice «Proposta» senza data |
| Problema | `code`, `description`, `date` clinica | Nella zona Stabile, con il conteggio «N documentati» | Nessuna data di registrazione: fuori dalla fascia |
| Allergie | Elenco del paziente sul Web. Il DTO GPUI non le porta | Elenco, oppure «Allergie: nessuna registrata» | «Allergie: dato non disponibile», mai «nessuna» |
| Conteggi | Letture della pagina | Il numero letto | Una lettura fallita mostra lo stato della sezione, mai 0 (D12) |

La regola di «Avviata, Aggiornata, Sospesa, Conclusa» è quella di
`lib/patient-therapy-changes.ts`. Per sapere «sulla base di che cosa» una
terapia è cambiata servirebbe registrare motivo e fonte al momento della
modifica: è un cambiamento dei dati e delle scritture, fuori da questo
redesign.

## D30. Fonte e bozza stanno nel Contesto

Una fonte, cioè una voce o un documento, si apre come foglio in cima al
Contesto, con il titolo, il testo e la sua riga di registrazione. Aprirla non
sposta il diario e non chiude nulla.

La bozza si apre nello stesso posto. Chi scrive vede accanto il diario e la
fascia. Aprendo un referto il foglio sta sopra la bozza, che resta montata con
il suo testo. «Torna alla bozza» chiude il foglio e riporta fuoco e cursore
nel punto esatto.

Uscendo dalla scheda con una bozza aperta la bozza si conserva, come già
prevede la specifica, e l'elenco la segnala con il punto. Rientrando la bozza
è nel Contesto, al passo in cui era.

Vietato smontare la bozza per mostrare una fonte, aprire la fonte sopra la
bozza nascondendola, o perdere il passo della revisione cambiando zona.

## D31. Le viste fuori dalla scheda seguono gli stessi criteri

Ogni vista del perimetro si prova con questi criteri comuni, più quello
proprio indicato nell'[inventario](#inventario-delle-viste).

| Criterio | Che cosa si osserva |
| --- | --- |
| C1 Titoli | Un solo titolo di pagina, della shell (D15). Titoli di sezione a 15 px con conteggio che dice che cosa conta (D24) |
| C2 Un principale | Un solo comando a fondo pieno nella vista. A modulo aperto è l'invio del modulo (D1) |
| C3 Campi | Contorno almeno 3:1 nei due temi, etichetta visibile associata, gruppi con nome. Un campo obbligatorio vuoto è segnalato sul campo, con il fuoco sul primo da correggere (D23) |
| C4 Selettori | Menu e risultati con il raggio dei controlli e righe concentriche. Voce con margine, passaggio e fuoco. Esc chiude e ridà il fuoco al controllo (D3, D4, D21) |
| C5 Segmenti e indice | Segmenti con sottolineatura, indice con «In questa pagina» e solo peso (D22) |
| C6 Righe | La riga si legge senza aprirla. Un'azione quieta e un menu, distruttiva per ultima (D13, D20) |
| C7 Stati | Caricamento, vuoto, errore e non disponibile distinti. Il vuoto nomina ciò che manca. Un dato non letto non diventa zero (D12) |
| C8 Scrittura | Passi con il loro nome, un solo principale, esito con il testo riletto e accesso al registro delle operazioni (D25) |
| C9 Larghezze e temi | Giorno e Grafite. Web a 1440 e 768 px, GPUI a finestra ampia e a 390 punti. Nessuno scorrimento orizzontale, nessun testo tagliato al 200% |
| C10 Tastiera | L'ordine di tabulazione è quello di lettura, il fuoco si vede sempre |

## Come si migliora la direzione

Una regola di questo documento cambia quando una prova la smentisce. Il conto
dei clic non basta: con gli stessi gesti il medico può anche scegliere la
terapia sbagliata. Il ciclo è questo.

1. **Pratica osservata.** Il punto di partenza è un lavoro reale del medico,
   raccontato da Leonardo o visto in una seduta sul banco. Tre situazioni
   guidano la 0.9.1:
   - tornare su un paziente dopo due settimane e capire che cosa è cambiato,
     da quando e dove sta scritto
   - essere interrotti durante una bozza da una telefonata o da un referto da
     rileggere, e riprendere il filo
   - dopo la conferma, sapere che cosa è davvero in cartella.
2. **Ipotesi.** Una frase che la prova può smentire, con l'osservazione che la
   smentisce e la modifica che ne segue.
3. **Simulazione.** Un caso sintetico con un dato di verità scritto prima, un
   distrattore e un'interruzione. Si usa il banco o il candidato installato,
   nel formato dei compiti di Q7.
4. **Modifica e ripetizione.** Si cambia una cosa sola e si ripete su un caso
   gemello: stessa struttura, contenuti diversi, così il risultato non
   dipende dal ricordo del primo caso.

Le prove usano dati sintetici e sedute dichiarate. Nessuna osservazione
dell'uso in ambulatorio, nessuna telemetria sui pazienti. Il riferimento di
metodo per prove realistiche e centrate sull'errore d'uso è NISTIR 7804. Non
nasce un nuovo gate: sono prove di design, e Q7 resta com'è.

### Che cosa si misura

Quattro misure distinte, mai sommate.

| Misura | Che cosa è | Come si prende |
| --- | --- | --- |
| Durata tecnica | Il tempo che il sistema impiega dal gesto alla schermata o alla rilettura | Strumenti, sul candidato. Il tempo di un'automazione non è un tempo d'uso |
| Tempo attivo | Il tempo del medico sul compito, senza le attese del sistema e senza l'interruzione | Registro della seduta, come in Q7 |
| Esito | La risposta o lo stato della cartella confrontati con il dato di verità | Giusto, parziale o sbagliato, con il tipo di errore: omissione, elemento sbagliato, causa non attestata, paziente sbagliato |
| Autonomia | Quanto il medico ha fatto da solo e su che cosa ha deciso | Aiuti come in Q7 (nessuno, suggerimento, intervento). Si annota se la risposta viene da fatti letti in scheda o da una proposta di cui non ha aperto le fonti |

### Caso e compiti

Il caso del riferimento è «Ritorno con molti contatti»: due variazioni di
terapia e un potassio fuori intervallo, poi dieci voci di diario, fra cui una
telefonata che riferisce crampi e debolezza in mezzo a contatti di routine. La
telefonata del giorno delle modifiche ne dice il motivo.

| Compito | Dato di verità | Errore che conta |
| --- | --- | --- |
| S1 Ritorno: che cosa è cambiato dall'ultima visita, da quando, e dove lo leggi | Spironolattone sospeso e furosemide aggiornata il 12/11, potassio 5,6 del 10/11 contro 4,8, telefonata del 16/11 con sintomi | Omettere la telefonata o una variazione. Dare una causa che la scheda non attesta |
| S2 Terapia: indica il diuretico che la paziente assume oggi e la sua posologia | Furosemide, una compressa alle 8 e mezza alle 14 | Indicare lo spironolattone, che è sospeso, o la posologia di prima |
| S3 Interruzione: a metà di una frase della bozza apri il referto e torna. Poi rispondi a una domanda su un altro paziente e torna | Testo e cursore intatti, bozza al passo di prima, nessuna voce sull'altro paziente | Ricominciare la frase, perdere il testo, scrivere nella scheda sbagliata |
| S4 Esito: dopo la conferma, che cosa è in cartella. Si ripete con una scrittura rifiutata | Il testo riletto. Nel caso rifiutato: nulla | Dire registrato ciò che non lo è, o il contrario |

Il caso gemello ha lo stesso numero di variazioni, contatti e documenti, con
farmaci, valori e date diversi, e sposta il contatto con i sintomi. In una
delle due versioni la voce dello stesso giorno non c'entra con la modifica:
serve a vedere se il rimando viene letto come una causa.

### Ipotesi aperte

| Ipotesi | La smentisce | Allora |
| --- | --- | --- |
| I1. Contare i contatti per tipo, con il diario subito sotto, non fa perdere un contatto che conta | In S1 la telefonata con i sintomi viene omessa mentre le variazioni di stato vengono trovate | Nel diario compare un separatore alla visita di riferimento, e le voci sopra il separatore restano tutte in vista prima delle altre |
| I2. La fascia separata dall'elenco delle terapie non porta a scegliere la terapia sbagliata | In S2 viene indicato il farmaco sospeso, o la posologia di prima | Le variazioni di terapia lasciano la fascia e si segnano nell'elenco «Terapie attive», con le sospese in un gruppo «Non più attive dopo la visita». Il riferimento ha già questa variante |
| I3. Il rimando alle voci dello stesso giorno aiuta a trovare il motivo senza inventarlo | Nel caso gemello la voce estranea viene riferita come motivo | Il rimando esce. Resta la sola data, e la richiesta di registrare il motivo passa ai dati |
| I4. Il testo riletto al passo 3 basta a sapere che cosa è registrato | In S4 la scrittura rifiutata viene creduta registrata | L'esito negativo prende la forma critica della specifica dentro la bozza, e i passi tornano a «1 · Scrivi» |
| I5. Posti fissi e bozza conservata bastano a riprendere dopo un'interruzione | In S3 la frase viene ricominciata, o compare una voce nella scheda sbagliata | Il blocco della bozza porta il nome del paziente, e la navigazione segnala la bozza aperta |
| I6. Senza tetto, le variazioni di stato non spingono il diario fuori dalla vista nei casi ordinari | Un caso con molte misure fuori intervallo, come dopo un ricovero, lascia la prima voce del diario sotto il bordo a tre zone | I parametri fuori intervallo si raggruppano per data della misura, con il conteggio dichiarato |

Costo già noto della variante di I2: a 1440 × 900 il gruppo «Non più attive
dopo la visita» finisce sotto sei terapie attive e non è nel primo sguardo.

### Alternativa non adottata: una vista per compito

Una vista diversa per visita, telefonata o controllo di un esame chiede di
sapere quale compito è in corso. La scheda non lo sa, e chiederlo aggiunge una
scelta prima di leggere. Lo stesso fatto finirebbe in posti diversi secondo la
vista, e dopo un'interruzione il medico tornerebbe in una disposizione che
non è quella lasciata. Qui il compito si legge da ciò che è aperto nel
Contesto, e le zone non si spostano.

Cambierebbe la scelta una prova su S3 in cui, su casi gemelli, una vista
dedicata alla scrittura fa riprendere la bozza con meno errori della bozza
nel Contesto.

## Scarti dal prototipo scelto

Guidando in Chrome il prototipo scelto, sulla tela di 1180 × 660:

- aperta la scheda al ritorno, due delle sei terapie attive sono sotto il
  bordo della zona Stabile, e una delle tre voci del diario è sotto il bordo
- una variazione si apre con un clic, la sua fonte con un secondo clic
- scrivendo, il referto si apre con un clic e si torna alla bozza con un
  altro: il cursore torna alla posizione 21, dov'era
- in revisione ci sono due comandi a fondo pieno, «Chiudi la voce» e
  «Conferma e registra»
- al primo accesso la fascia è sostituita da un avviso, ed il resto non cambia.

Il coordinamento ha poi provato lo stesso prototipo con dodici variazioni,
otto delle quali contatti: la prima voce del diario comincia 135 px sotto il
bordo e la riga del potassio esce in parte. Sul riferimento, con dieci voci
dopo la visita, la fascia ha le stesse righe del caso con due, il potassio è
intero e la prima voce del diario è nel primo sguardo a tre zone. Con i
contatti come righe e un tetto di cinque, le cinque righe visibili sono tutte
contatti.

| Nel prototipo | Nella specifica | Perché |
| --- | --- | --- |
| «Prima → dopo», «Motivo registrato», autore e «Apri la fonte» per una terapia | Stato attuale, data, «Valore precedente non conservato», voci dello stesso giorno | La scheda non conserva il valore precedente, il motivo, l'autore o un legame con una fonte |
| «Posologia» come tipo di variazione | «Aggiornata» | Non si sa quale campo è cambiato |
| Voci di diario come righe della fascia | Conteggio per tipo in una riga | Stanno già nel diario subito sotto. Come righe spingono fuori le variazioni di stato |
| «Primo accesso. Non c'è una tua visita precedente…» | «Nessuna visita registrata.» | La scheda non sa chi l'ha aperta prima. Sa se nel diario c'è una visita |
| «Dall'ultima visita, 04/11» | «Dall'ultima visita · 04/11 · Autore» | L'autore dice di quale visita si parla |
| «Mostra anche gli eventi automatici» | «Mostra anche documenti e proposte» | Un allegato non porta l'autore: non si può dire automatico |
| Etichetta «Sempre vero» sopra la zona | Nessuna etichetta | I titoli bastano, e una sospensione la smentisce |
| Fascia con bordo blu | Bordo in filetto forte | Il blu resta ad azione e bozza |
| «Proposta da generare e rivedere. La cartella non cambia.» | Titolo, parola «Proposta», comando | La parola dice già che non è in cartella |
| A bozza aperta spariscono i parametri | Restano, sotto la bozza | Scrivendo una visita servono |
| «Chiudi la voce» a fondo pieno accanto a «Conferma e registra» | Secondario | Un solo principale (D1) |
| «Torna a scrivere» in revisione | «Torna alla bozza» | Un solo nome per lo stesso ritorno |
| «Terapia: Nessuna modifica» nella revisione | Solo ciò che verrà scritto | La revisione elenca ciò che si registra |
| «Registrata e riletta alle 22:27. La voce è in cima al diario.» | «Registrata alle 22:27» e il testo riletto | «Registrata» si dice solo dopo la rilettura. Il testo mostra che cosa è in cartella |
| Nessuna sezione sulle modifiche di terapia senza visita | «Ultime modifiche di terapia» sopra il diario | Il contratto chiede le ultime modifiche con data all'apertura |
| Nessun «Controlli aperti», nessuna nota della scheda | Nel Contesto e nella zona Stabile | D9 e il compito della nota restano |
| Data ripetuta su ogni riga e nel gruppo | Solo nel gruppo | La riga non ripete ciò che è già scritto (D20) |

## Testi

Parole fisse, come nella specifica. Ogni stringa nuova è passata dal vaglio
dei testi dell'interfaccia: esiste solo se senza di essa il medico non può
capire o agire.

| Dove | Testo |
| --- | --- |
| Intestazione della fascia | Dall'ultima visita · 04/11 · Autore |
| Senza visita | Nessuna visita registrata. |
| Visita senza variazioni | Dall'ultima visita · 14/11 · Autore: nessuna variazione registrata. |
| Parole di variazione | Avviata · Aggiornata · Sospesa · Conclusa · Fuori intervallo · Documento aggiunto · Proposta |
| Terapia, dettaglio | Stato attuale: Sospesa · posologia / Indicazione: … / Inizio 03/2024 · Registrata il 12/11 / Valore precedente non conservato |
| Rimando allo stesso giorno | Diario del 12/11: Telefonata |
| Parametro, dettaglio | 4,8 mmol/L (02/10) → 5,6 mmol/L / Riferimento 3,5–5,1 mmol/L · Misura del 10/11 / Nessuna misura precedente |
| Contatti dopo la visita | Nel diario dopo la visita: 6 telefonate, 1 accesso, 3 note |
| Interruttore | Mostra anche documenti e proposte |
| Sezioni | Problemi · N documentati / Terapie attive · N / Note della scheda / Ultime modifiche di terapia · N più recenti / Diario · N voci / Parametri recenti / Controlli aperti / Documenti recenti |
| Quadro paziente | Quadro paziente · Proposta dell'11/11 · Apri il Quadro e le fonti |
| Fonte | Apri il documento: nome · Chiudi · Torna alla bozza |
| Diario in una colonna | Tutto il diario |
| Passi | 1 · Scrivi · 2 · Rivedi · 3 · Registrata |
| Comandi di scrittura | Nuova voce · Modifica · Rivedi · Conferma e registra · Torna alla bozza · Chiudi la voce · Chiudi la nota · Scrivi un'altra voce |
| Revisione | Che cosa verrà registrato / Paziente · Tipo oppure Oggetto · Testo |
| Esito | Registrata alle 22:27 / Registrata alle 22:27 da Autore |

Modifica i comandi di scrittura della specifica: «Registra N elementi» esce.
Restano «Bozza non registrata», «Bozza intatta» e i testi di rifiuto,
conflitto ed esito da verificare.

## Inventario delle viste

Viste del perimetro W e G del contratto, con il criterio proprio di ciascuna.
I criteri comuni sono in D31. Le esclusioni GPUI sono X01-X16 del
[censimento](../../analysis/2026-10-23-gpui-census.md#disposizioni-correnti-ed-esclusioni-proposte),
approvate il 13 novembre 2026 come riporta l'[indice della documentazione](../../README.md).

Copertura al 18 novembre: «unita» indica una PR nel ramo principale, «aperta»
una PR in revisione, «in corso» un lavoro avviato senza PR da citare, «da
provare» una vista che questo documento non ha verificato. Nessuna voce vale
come accettazione: quella si fa sul candidato installato.

### Scheda paziente

| Vista | Web | GPUI | A prima vista e gesto che la prova | Copertura |
| --- | --- | --- | --- | --- |
| Riepilogo | `#quadro`, W-9 | Riepilogo | D17, D26-D30: identità, zone per larghezza, fascia o riga di stato, bozza e fonte nel Contesto. Gesti: S1-S4 | Web: prima tranche integrata (PR 1044), tre zone in corso. GPUI: in corso |
| Terapie | `#terapie`, W-7, W-8 | Terapie | Riga con farmaco, posologia, indicazione, periodo. «Modifica» e menu. Un conflitto lascia la bozza e dice che nulla è stato scritto | Web: integrata (PR 1044). GPUI: da fare |
| Misure | `#parametri`, W-11 | Parametri. Andamento escluso (X05) | Nome, valore con unità, data. ▲ solo con riferimenti numerici. Creazione accanto al titolo | Da provare |
| Documenti | `#documenti`, W-12 | Documenti | Nome, data e dimensione su una riga. L'originale aperto occupa l'altezza della finestra. Sintesi con provenienza | Web: integrata (PR 1044). GPUI: da provare |
| Diario | `#diario`, W-15a | Diario | Data, tipo, prosa, «Registrata da». Eventi tecnici solo con il filtro | Da provare |
| Nuova voce | `?voce=nuova`, `/entries/new`, W-16 | Compositore. Testo ricco e allegati esclusi (X03) | D25 e D30 per intero: tre passi, fonte accanto, esito riletto | In corso |
| Note della scheda | Note nel Riepilogo, `/notes-review` | Note nel Riepilogo | «Modifica» nella riga del titolo, tre passi, nota riletta al suo posto con l'ora. È il compito 1 di Q7 | In corso |
| Quadro paziente | Area delle proposte, W-13a | Quadro | A matita, con modello, fonti e data. Aprire non genera | Web: ingresso integrato (PR 1044). GPUI: da fare |
| Importazione assistita | W-13b | Importazione assistita | Ogni elemento è una proposta finché non è accettato. La revisione si conserva | Da provare |
| Controlli e follow-up | `#follow-up`, W-10 | Controlli, questioni aperte. Applicazione delle proposte esclusa (X04) | Nome e scadenza. Caricamento, vuoto ed errore distinti | Da provare |
| Attenzione | `#attenzione` | Questioni aperte | Conteggio di elementi reali, ciascuno con il suo rimando | Da provare |
| Anagrafica | `#identita`, `/edit` | Modulo anagrafica | Campi con etichetta, identificativo con il suo tipo. Un obbligatorio vuoto è segnalato sul campo | Da provare |
| Clinica e Amministrazione | `#clinica`, `#amministrazione` | Sola lettura. Modifica esclusa (X09, X10) | Diagnosi con codice e data, esenzioni con codice. Ricerca con risultati arrotondati | Da provare |
| Prestazioni | `#prestazioni`, W-14a | Esclusa (X06) | Riga di D20, stati e azioni di Terapie | Da fare |
| Protesica | `#protesica`, W-14b | Esclusa (X07) | Riga di D20, stato della prescrizione in parola | Da fare |
| Scale del paziente | `#scale`, `/scales`, `/scales/[scaleId]` | Scale | Voci compilabili da tastiera, punteggio in bozza accanto, tre passi | Web: tastiera unita (PR 1041). Resto da provare |
| SISS e FSE | `#siss`, W-14c | Esclusa (X12) | Esportazione e passaggio regionale distinti. Nessuna connessione dichiarata | Da provare |
| Timeline | `#timeline`, W-15b | Esclusa (X08) | Voci, controlli e documenti in ordine. Eventi tecnici con il filtro | Da provare |

### Fuori dalla scheda

| Vista | Web | GPUI | A prima vista e gesto che la prova | Copertura |
| --- | --- | --- | --- | --- |
| Sblocco | Schermata di blocco | Blocco nativo. Ripristino con PIN precedente e prima passphrase esclusi (G-0, X13) | Un campo con etichetta, un principale «Sblocca». Credenziale sbagliata: messaggio accanto al campo, fuoco sul campo | Da provare |
| Primo avvio | Procedura iniziale | Da verificare nel censimento | Una domanda per volta, un principale, ritorno senza perdere le risposte | Da provare |
| Navigazione | Colonna con sei aree, Impostazioni, Blocca | Colonna con le stesse aree | Area corrente con fondo e peso. In compatta quattro schede in basso | Da provare |
| Pazienti | `/`, W-21c | Pazienti. Archiviazione e cestino esclusi (X01) | Ricerca con etichetta, segmenti, tabella, «Nuova scheda» unico principale. La colonna del problema mostra una diagnosi documentata o resta vuota. Invio apre la scheda | Da provare |
| Nuova scheda | `/patients/new` | Modulo nuova scheda | Obbligatori riconoscibili prima dell'invio. Scheda senza identificativo ammessa (ADR 0179). Revisione prima della registrazione | Da provare |
| Importazione di pazienti | `/patients/import` | Esclusa (X16) | Anteprima delle righe prima della scrittura, errori per riga | Da provare |
| Importazione del dossier | `/patients/import/dossier` | Importazione del dossier | Ogni scheda proposta con le sue fonti, un gesto per scheda, esito riletto | Da provare |
| In arrivo | `/in-arrivo`, Giro 1 (WUL-868), successiva a U0 | Percorso Web | Mostrare quali elementi sono già registrati secondo il mandato e quali attendono il medico. Prima della conferma rendere riconoscibili paziente, differenze, fonti e dubbi | Da provare sul candidato con il canale visita ([ADR 0190](../../adr/0190-mandato-agenti-e-cassetta-della-visita.md)) |
| Agenda | Area turno, W-20a | Agenda | Gruppi per urgenza con il conteggio che dice che cosa conta. Filtri fino a quattro segmenti | Da provare |
| Diario | `/diary`, W-20b | Diario | Voci di tutti i pazienti con nome, tipo e autore. Ricerca con etichetta | Da provare |
| Repertori | Area repertori, W-20c | Repertori | Panoramica esistente (D11). Un conteggio non letto non diventa zero | Da provare |
| Analisi | `/analytics`, W-21a | Analisi. Cruscotto completo escluso (X11) | Numeri dentro la frase. Indice «In questa pagina» che segue la sezione | Web: indice unito (PR 1042, 1047). GPUI: da fare |
| Scale | `/scales`, W-21b | Scale | Catalogo con indice, scala scelta riconoscibile, compilazione da tastiera | Web: tastiera unita (PR 1041). GPUI: da provare |
| Impostazioni | `/settings`, W-17 | Impostazioni | Sezioni a sinistra, righe con titolo ed effetto pratico, nessun titolo ripetuto | Da provare |
| Backup e archivi | `/settings/backup`, W-18a | Archivi (G-3) | Ripristino come scrittura: dice che cosa verrà sostituito, annullare non lascia effetti | Da provare |
| Modelli | `/settings/ai/modelli`, W-18b | File e modelli, Provider | Modello scelto su una riga con «Cambia». Disponibilità distinta dal consenso (D7) | Da provare |
| Repertori nelle impostazioni | `/settings/repertori`, W-18c | Repertori | Fonte e data di ogni catalogo. Anteprima prima di sostituire | Da provare |
| Accesso | `/settings/accesso`, W-19a | Accesso | Stato della sessione in una frase, blocco raggiungibile | Da provare |
| Profilo | `/settings/profilo`, W-19b | Profilo | Modifica con revisione, ritorno senza perdere la bozza | Da provare |
| Aspetto | `/settings/aspetto`, W-19c | Aspetto e accessibilità | Tema scelto segnato, cambio immediato, fuoco conservato | Da provare |
| Ambulatori | `/settings/ambulatories`, W-19d | Ambulatori | Sede corrente riconoscibile. Creare e scegliere sono comandi diversi | Da provare |
| Conformità | `/settings/compliance`, W-19e | Controlli | Limiti e fatti senza nuove dichiarazioni | Da provare |
| Diagnostica | `/settings/diagnostica`, W-19f | Controlli | Errore in una frase, dettaglio tecnico da aprire | Da provare |
| Sviluppo | `/settings/sviluppo`, W-19g | Esclusa (X15) | Comandi di prova distinti da quelli ordinari | Da provare |
| Zona pericolo | `/settings/zona-pericolo`, W-19h | Sicurezza | Soglia in due tempi, ritorno evidenziato per primo | Da provare |
| Funzioni | `/settings/ai/funzioni`, W-19i | Funzioni e parametri | Spenta, non disponibile e pronta distinte in parola (D14) | Da provare |
| ChatGPT | `/settings/ai/chatgpt`, W-19j | ChatGPT | Account, quota e consenso su righe diverse. Titolo della shell (D15) | Da provare |
| Fabric | `/settings/ai/fabric`, W-19k | Governo | Capacità leggibili, nessuna disponibilità sottintesa | Da provare |
| Governo | `/settings/ai/governance`, W-19l | Governo | Regole e stati di controllo distinti dagli errori | Da provare |
| Conservazione | `/settings/conservazione`, R-1–R-6 dell’emendamento del 3 novembre | Vista Conservazione censita in G-0, prove O13/F26 | Termini e blocchi in parole. Lo scarto richiede la conferma del medico | Da provare sul candidato. [Contratto di rilascio](../../releases/0.9.1-contract.md#emendamento-del-3-novembre-2026-conservazione-nella-091) e [censimento GPUI](../../analysis/2026-10-23-gpui-census.md) |
| Agenti | `/settings/agenti`, Giro 1 (WUL-866), successiva alle dodici sottoviste W-19 di U0 | Abbinamento e gestione dei mandati nel Web | Distinguere il client abbinato dal mandato attivo. Rendere riconoscibili perimetro, scadenza e revoca | Da provare sul candidato con il canale visita ([ADR 0190](../../adr/0190-mandato-agenti-e-cassetta-della-visita.md)) |
| Attività della postazione | Registro delle operazioni | Da verificare nel censimento | Conteggio degli eventi e ultimo evento con ora. Si raggiunge dalla vista in cui si è scritto | Da provare |
| Continua in MediFlow | `/plugin-local-ui` | Accesso da chat | Dice che cosa si sta per aprire e per quale paziente | Da provare |
| Banchi | `/mockups/*`, `/review-pilot` | Non presenti | Solo sviluppo: fuori dal giro | Fuori |

## Copertura dei criteri

Stato al 18 novembre 2026.

| Criterio | Web locale | GPUI sul Mac |
| --- | --- | --- |
| D17 Primo sguardo | Integrata (PR 1044): identità senza codice, anno stimato | In corso |
| D18 Stato ed eventi | Integrata (PR 1044): sezione nel Riepilogo. Da fare: posto secondo D18 | Da fare |
| D19 Quadro paziente | Integrata (PR 1044): riga in cima e comando. Da fare: blocco nel Contesto | Da fare |
| D20 Righe | Integrata (PR 1044) per Terapie e Documenti. Da fare: Prestazioni, Protesica, Misure | Da fare |
| D21 Superfici flottanti | Integrata (PR 1044) per menu e ricerche. Da fare: avvisi temporanei, pannelli della testata | Da provare |
| D22 Segmenti e indice | Unita: indice che segue la scelta e che si presenta come indice (PR 1042, 1047). Integrati i segmenti in vista (PR 1044) | Da fare: Analisi e Scale |
| D23 Campi | Integrata (PR 1044) nella cartella. Da fare: Impostazioni, primo avvio, nuova scheda, scale, importazione | Da fare |
| D24 Titoli di sezione | Da fare, con token e guard | Da fare, con il ruolo tipografico |
| D25 Scrittura ed esito | In corso | In corso: nota della scheda |
| D26-D30 Zone, larghezze, fascia, fonte e bozza | In corso. La bozza a tre zone (PR 1048, chiusa) è servita da termine di confronto | In corso |
| D31 Viste fuori dalla scheda | Per vista, nell'inventario | Per vista, nell'inventario |

Aggiornamento del 24 novembre 2026 (PR 1059). Il linguaggio «Vassoio opaco»
si estende a tutte le viste Web e GPUI; la tabella sopra resta lo stato del
18 novembre.

- Web, viste del cockpit: Turno, Incarico, Diario e Repertori erano già pagine
  di cartella. Si aggiungono Revisione, Handoff SISS e Stato operativo: titolo
  con il ruolo `--type-record-person`, flusso del caso in un vassoio
  (`--lume-record-tray`, raggio 16 px) e sezioni come isole
  (`--lume-record-island`, raggio 14 px). La superficie di review
  (`/mockups/kree8`) non cambia.
- Web, viste fuori dal cockpit: nuova voce clinica, revisione delle note e
  «Il tuo modo di lavorare» usano lo stesso titolo; il profilo di lavoro e il
  primo avvio condividono l'isola. Le domande del profilo usano
  `--type-section-heading`. Nessun titolo conserva il punto finale.
- Web, controlli: la riga compatta del Diario nel Quadro misura 48 px di
  colonna data (prima 84 px); la vista Diario completa resta a 84 px.
- GPUI: le viste del pilota si allineano agli stessi ruoli di vassoio e isola
  nello stesso branch, con 15 titoli residui portati in case frase e righe
  Impostazioni a tutta larghezza.

Provato in questo aggiornamento (archivio sintetico, senza dati reali): build
standalone Web, 12 spec Playwright mirati (48/48), regressione identità UI
(`scripts/ui-identita/prova.mjs`, 19/19), 3 copioni UI CLI Web (279 passi),
suite Rust GPUI (`cargo fmt --check`, `clippy -Dwarnings`, 788 test), 10
copioni UI CLI GPUI (`gpui-shell*.jsonl`) e 28 catture visive GPUI in Giorno e
Grafite. Non provato qui: CI GitHub completa sul riallineamento finale dopo
l'ingresso su `main` delle PR precedenti in coda.

## Prove e limiti

Provato il 18 novembre, con dati sintetici:

- il prototipo scelto, guidato in Chrome nei due scenari
- il riferimento, guidato a sei larghezze, in quattro casi e due temi: 701
  controlli passati su 701
- i campi usati in D29, letti in `lib/db.ts`, `lib/schema.ts` e
  `transport/src/dto.rs`.

Non provato:

- nessuna simulazione con una persona. Le ipotesi I1-I6 sono aperte
- nessuna regola sul prodotto: Web e GPUI non sono stati eseguiti per questo
  documento
- GPUI è stato confrontato solo sui campi del DTO, non a schermo
- le viste dell'inventario segnate «da provare»
- testo al 200%, lettori di schermo e larghezza di 320 px sul riferimento.
