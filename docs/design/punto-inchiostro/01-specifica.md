---
summary: "Specifica di Punto d'inchiostro: token, tipografia, forma, componenti con misure e stati, movimento, tastiera, accessibilità e testi."
read_when:
  - "Costruendo o rivedendo un componente MediFlow nella nuova direzione."
  - "Cercando il valore, lo stato o il testo esatto di un elemento dell'interfaccia."
---

# Specifica

I valori sono quelli di
[tokens/punto-inchiostro.tokens.json](./tokens/punto-inchiostro.tokens.json).
Dove qui compare un numero, è lo stesso del file dei token. Le misure sono in
px sul web e nei punti equivalenti sulle piattaforme native.

## Colore

Due registri: Giorno (chiaro) e Grafite (scuro). Segue il sistema, salvo
scelta esplicita in Impostazioni, Aspetto.

| Ruolo | Giorno | Grafite | Uso |
| --- | --- | --- | --- |
| Penombra | `#e8eaee` | `#101216` | Fondo, navigazione, contesto |
| Piano | `#ffffff` | `#1a1d22` | La superficie in luce |
| Filetto | `#dfe2e7` | `#2a2e35` | Fra le righe |
| Filetto forte | `#c9ced6` | `#3b414b` | Sotto le intestazioni, bordo dei controlli |
| Inchiostro asciutto | `#14161a` | `#e9ecef` | Testo registrato |
| Inchiostro fresco | `#2346b0` | `#9db4ff` | Bozza, azione principale, fuoco |
| Matita | `#5f6878` | `#9aa3b0` | Proposte |
| Secondario | `#555e6b` | `#a3acb8` | Etichette, metadati |
| Fondo della voce in scrittura | `#f3f6fd` | `#1d2333` | Solo la voce viva |
| Riga selezionata | `#eef2fb` | `#232a3d` | Elenchi |
| Avviso | `#8a5a1c` | `#d9a75f` | Con ▲ e testo |
| Critico | `#a33a2f` | `#f08a7d` | Con ◆ oppure ✕ e testo |
| Esito positivo | `#3f5a49` | `#8fbf9f` | Con ✓ e testo |
| Soglia in conferma | `#14161a` con testo bianco | `#e9ecef` con testo `#14161a` | Il blocco di massimo contrasto della schermata |

Contrasto misurato del testo sul piano, Giorno e Grafite: asciutto 18,1 e
14,3; fresco 8,2 e 8,4; matita 5,6 e 6,6; secondario 6,6 e 7,4; avviso 5,9 e
7,8; critico 6,6 e 7,0. La matita sulla penombra chiara è a 4,7: è il valore
più basso ammesso, e una proposta non si scrive su fondi più scuri della
penombra.

Regole:

- il blu non decora e non indica stati clinici;
- ogni segnale clinico porta forma e parola, mai solo il colore;
- con "Aumenta contrasto" del sistema i filetti passano al filetto forte e la
  matita all'inchiostro secondario; il tratteggio resta.

## Tipografia

Tre caratteri, ma con ruoli stretti e corpi vicini, perché la pagina legga come
una voce sola.

| Voce | Carattere | Corpo | Dove |
| --- | --- | --- | --- |
| Voce | Newsreader 400 | 28 px, interlinea 1,1 | Nome del paziente in testata (26 px in larghezza compatta) |
| Voce | Newsreader 400 | 26 px | Titolo di pagina: Pazienti, Agenda, Impostazioni |
| Voce | Newsreader 400 | 22 px | Nome del paziente nell'anteprima |
| Voce | Newsreader 400 | 17 px, interlinea 1,5 | Prosa del diario |
| Voce | Newsreader 500 | 21 px | Nome del prodotto |
| Registro | Sistema 400 | 14 px, interlinea 1,5 | Testo dei controlli, tabelle, etichette |
| Registro | Sistema 600 | 14 px | Nomi in elenco, farmaci, valori, tipo di voce |
| Registro | Sistema 600 | 15 px | Titolo della soglia |
| Registro | Sistema 400 | 13 px | Date, ore, variazioni, metadati, riga di registrazione |
| Registro | Sistema 600, maiuscolo, spaziatura 0,05 em | 12 px | Intestazione di sezione e di colonna |
| Codici | IBM Plex Mono 400 | 12 px | Solo codici: ICD, ATC, codice fiscale, identificativi. E la riga di comando |

Regole di armonia:

- **Il serif sta dove si parla di una persona**: nome del paziente in testata e
  in anteprima, prosa clinica, titoli di pagina, nome del prodotto. Non sta
  nelle righe di una tabella, nei comandi, nella soglia, negli errori.
- **Il mono è solo per i codici.** Date, ore, dosi e valori usano il carattere
  di sistema con cifre tabulari. Così in una riga non convivono tre caratteri.
- **Pochi corpi, vicini.** Nel registro: 12, 13, 14, 15. Nella voce: 17, 22,
  26, 28. Nessun corpo intermedio.
- **La gerarchia si fa con peso e colore prima che con la dimensione**: 600
  per ciò che si cerca con l'occhio, colore secondario per ciò che accompagna.
- Sulle piattaforme native il corpo del registro è quello del sistema: macOS
  13,5, Windows e Linux 14, iOS e iPadOS 15,5 nelle tabelle. Gli altri corpi
  del registro seguono in proporzione.
- Newsreader e IBM Plex Mono sono file locali con licenza OFL su ogni
  piattaforma. Il prodotto non scarica caratteri dalla rete.
- Il carattere di sistema è: San Francisco su Apple, Segoe UI Variable su
  Windows, il carattere del desktop su Linux, `system-ui` sul web.
- La prosa non supera 64 caratteri per riga.
- Con il testo regolabile del sistema ogni corpo scala con la preferenza
  dell'utente; oltre il 200% le colonne affiancate diventano una.

## Forma e spazio

Ogni distanza è un multiplo di un'unità di 4 px. Cambiando l'unità, tutta
l'interfaccia respira di più o di meno insieme: nel banco è il controllo
"Respiro".

| Passo | Valore | Dove |
| --- | --- | --- |
| 2 | 8 px | Fra elementi dello stesso gruppo, sotto un'intestazione di sezione |
| 3 | 12 px | Fra comandi affiancati, fra etichetta e valore |
| 4 | 16 px | Sopra e sotto una voce di diario, dentro la voce in scrittura, margini in larghezza compatta |
| 5 | 20 px | Sopra la testata |
| 7 | 28 px | Margine interno del piano, distanza fra una sezione e la successiva |
| 10 | 40 px | Distanza fra le due colonne |

| Elemento | Valore |
| --- | --- |
| Riga di tabella o elenco | 40 px con puntatore, 44 px al tocco |
| Riga di intestazione di colonna | 36 px |
| Riga di impostazione | almeno 60 px |
| Bersaglio minimo al tocco | 44 px; l'area può estendersi oltre il disegno (interruttori) |
| Colonna di margine del diario | 84 px |
| Navigazione laterale | 192 px; 160 px in larghezza media |
| Anteprima accanto all'elenco | 304 px |
| Raggio di righe e record | 0 |
| Raggio dei controlli | web 10, macOS 8, Windows 4, Linux 6, iOS e iPadOS 12 |
| Raggio del piano | web 16, macOS 12, Windows 8, Linux 10, iOS e iPadOS 18 |
| Raggio della voce in scrittura | 12 px |
| Pillola | Solo allergia e scelte compatte |
| Ombra | Solo sotto il piano: `0 18px 44px -26px` nero al 45% più un bordo di 1 px al 6% |
| Punto | 0,44 em; 0,24 em quando chiude un titolo o il nome |

Con queste misure a 1440 × 900 l'elenco mostra 14 pazienti e la scheda mostra
insieme quadro e diario.

Classi di larghezza, misurate sul contenitore dell'applicazione:

| Classe | Larghezza | Disposizione |
| --- | --- | --- |
| Compatta | sotto 700 px | Una colonna, schede in basso, anteprima nascosta |
| Media | da 700 a 1000 px | Navigazione stretta, colonne a 24 px, colonne secondarie nascoste |
| Estesa | oltre 1000 px | Navigazione, due colonne, anteprima |

Sul web restano obbligatorie le verifiche a 320, 390, 768 e 1440 px e con
zoom al 200% e 400%, come chiede `DESIGN.md`.

## Il punto e i tre inchiostri

| Stato | Punto | Testo | Parola | Chi lo produce |
| --- | --- | --- | --- | --- |
| Matita | Vuoto, contorno 1,5 px | Colore matita, sottolineatura tratteggiata 1 px a 4 px dalla riga | "Proposta" | Modello, agente, trascrizione |
| Inchiostro fresco | Pieno, blu | Colore fresco | "Bozza non registrata" | Il medico |
| Inchiostro asciutto | Pieno, colore del testo | Colore del testo | "Registrata" | Il sistema, dopo la rilettura |

- Una proposta diventa inchiostro fresco solo con un gesto del medico: Accetta,
  Porta nella voce, oppure una modifica al testo.
- Una bozza diventa inchiostro asciutto solo quando la scrittura è riuscita ed
  è stata riletta dallo stato salvato.
- Il punto non indica mai altro. Avvisi: ▲. Critico: ◆. Errore: ✕. Esito: ✓.
- Per i lettori di schermo il punto è decorativo e lo stato è nel testo
  accanto. In elenco, dove il punto sta da solo, porta un testo nascosto
  ("Bozza non registrata", "Proposta da rivedere") e la legenda sotto la
  tabella.

## Componenti

### Navigazione

Sei aree: Pazienti, Agenda, Diario, Repertori, Analisi, Scale. In fondo:
Impostazioni, Blocca. In larghezza estesa e media è una colonna in penombra
con il nome del prodotto in alto; la voce corrente ha fondo chiaro e peso 600.
In larghezza compatta diventa una barra a quattro schede in basso: Pazienti,
Agenda, Diario, Altro. Altro raccoglie Repertori, Analisi, Scale,
Impostazioni e Blocca.

### Testata del paziente

Nome in serif, riga di dati in colore secondario (sesso, età, data di nascita
e codice fiscale, quest'ultimo in mono), allergia in pillola con ▲ sempre visibile, poi i comandi a destra.
Il comando principale è uno solo ed è a destra: Nuova voce. Sotto la testata,
un controllo a segmenti: Riepilogo, Terapie, Misure, Documenti.

### Quadro

Quattro tabelle a filetti, ciascuna con intestazione di sezione e conteggio in
colore secondario a destra: Problemi (codice, descrizione, da quando), Terapie attive
(nome e dose, posologia, ATC), Misure recenti (nome, valore e unità a destra,
data, variazione), Controlli aperti (nome, scadenza). In larghezza media le
colonne secondarie (da quando, ATC, variazione) si nascondono, non si
rimpiccioliscono.

### Voce di diario

Griglia: margine di 84 px con data e ora, poi il corpo. Corpo: tipo in peso
600 e luogo in colore secondario, prosa in serif, riga di registrazione con
il punto asciutto ("Registrata da ..."). Filetto sotto ogni voce. In larghezza
compatta il margine sale sopra il corpo.

### Voce in scrittura

Nasce in cima al diario. Fondo e bordo propri, raggio 12 px. Contiene, in
ordine:

1. stato con punto ("Bozza non registrata") e, a destra, il comando di ascolto;
2. tipo e luogo;
3. area di testo in serif, colore inchiostro fresco, altezza minima 200 px;
4. pannello dell'ascolto, quando è aperto;
5. elenco di ciò che verrà scritto: una riga per elemento, con punto,
   etichetta (Diario, Misura, Terapia, Proposta) e descrizione.

Mentre si scrive le voci precedenti passano al colore secondario. Il quadro
resta visibile a sinistra. In larghezza compatta il diario sale sopra il
quadro, così la voce viva è il primo elemento sotto la testata.

Una proposta a matita sta nell'elenco con la sua fonte e due comandi: Scarta,
Accetta. Finché resta a matita non viene registrata, e la soglia lo dice.

### Soglia di conferma

Barra in fondo al piano, sempre visibile, mai sotto la piega. A sinistra il
messaggio (titolo in peso 600 con il punto, riga di dettaglio), a destra i
comandi.

| Stato | Aspetto | Titolo | Dettaglio | Comandi |
| --- | --- | --- | --- | --- |
| Bozza | Fondo del piano | Bozza non registrata | N elementi pronti per la scheda di Nome. Se c'è una proposta: Una proposta a matita resta fuori finché non la accetti. | Registra N elementi |
| Conferma | Soglia scura | Registrare nella scheda di Nome, età anni? | Conteggio per tipo. La scrittura è unica: o tutto o niente. | Torna alla bozza, Conferma e registra |
| In corso | Fondo del piano | Registrazione in corso | Attendi la conferma prima di chiudere. | Comando disattivato |
| Registrata | Fondo del piano, punto che si posa | Registrata il giorno alle ora | N elementi scritti e tracciati a nome di Autore. | Torna alla scheda |
| Non registrata | Fondo del piano, ✕ critico | Non registrata. Nulla è stato scritto. | La causa. La bozza è intatta: rileggi la scheda e riprova. | Rileggi la scheda, Riprova |
| In ascolto | Fondo del piano, punto vuoto che respira | In ascolto mm:ss | Ferma l'ascolto prima di registrare. | Registra disattivato |

#### Quando serve il secondo tempo

La soglia è sempre presente e dice sempre a chi si sta scrivendo e che cosa.
Il passaggio scuro di conferma, invece, non è per tutto: se comparisse a ogni
nota diventerebbe un riflesso e smetterebbe di proteggere.

| Livello | Quando | Come |
| --- | --- | --- |
| 1. Un gesto | Un solo elemento, scritto dal medico, che il prodotto sa ritirare con traccia: nota di diario, misura, risultato di scala, documento allegato | "Registra" scrive subito. La soglia mostra paziente ed elemento prima, esito dopo |
| 2. Due tempi | Cambia ciò che il paziente assume o ciò su cui altri agiranno (terapie, prescrizioni, allergie, problemi); contiene qualcosa nato a matita (proposta accettata, trascrizione); scrive più elementi insieme; ha un effetto fuori da MediFlow | Soglia scura con nome, età e conteggio per tipo |
| 3. Due tempi e parola digitata | Non si può ritirare o tocca l'intera cartella: eliminare o unire un paziente, ripristinare un backup, zona pericolo | Come il livello 2, più il cognome del paziente o la parola indicata, da scrivere |

Se una scrittura rientra in più livelli vale il più alto. Nel dubbio vale il
livello 2. Quando l'azione distrugge qualcosa, il comando evidenziato per
primo è quello che torna indietro.

Perché così:

- negli studi sugli avvisi di prescrizione la maggior parte viene scavalcata:
  fra il 46% e il 96% secondo una revisione sistematica del 2020, circa l'80%
  per le interazioni in una meta-analisi più recente ancora in prestampa;
- dove gli avvisi sono graduati per gravità, quelli gravi vengono rispettati
  molto di più: 100% contro 34% nel confronto fra due centri di Paterno e
  colleghi (2009), e 67% di accettazione quando solo i critici interrompono
  (Shah e colleghi, 2006). Sono studi osservazionali, non prove
  randomizzate, e riguardano avvisi, non conferme di scrittura: valgono per
  analogia;
- la pratica di progettazione dice la stessa cosa: una conferma che riceve
  sempre la stessa risposta smette di essere letta, quindi va riservata a ciò
  che è raro, grave o non ritirabile, con un testo che nomina la conseguenza;
- nel codice di oggi la conferma è chiamata in una ventina di punti, anche per
  scritture ordinarie: il livello 1 la toglie dove non protegge.

Fonti:
[revisione JMIR 2020](https://medinform.jmir.org/2020/7/e15653),
[Paterno 2009](https://academic.oup.com/jamia/article/16/1/40/865495),
[Shah 2006](https://pmc.ncbi.nlm.nih.gov/articles/PMC1560718),
[meta-analisi in prestampa](https://preprints.jmir.org/preprint/88578).
Leonardo ha delegato la scelta il 9 ottobre 2026. La verifica che conta è il
comportamento reale di chi usa la soglia, da osservare in WUL-767.

"Registrata" compare solo dopo la rilettura dello stato salvato. Un esito
parziale non viene mai mostrato come riuscito né come fallito per intero. Il
cambio di stato è annunciato ai lettori di schermo (regione di stato) e dopo
ogni passaggio il fuoco va sul comando principale del nuovo stato.

### Elenco pazienti

Riga di strumenti: titolo, ricerca, segmenti (In carico, Da rivedere,
Archivio), Nuova scheda. Tabella: Paziente (nome in peso 600 con il punto
davanti quando serve), Età, Problema principale, Ultimo contatto, Da fare.
Selezionare una riga apre l'anteprima a destra con età, problema, ultimo
contatto, cosa c'è da fare e Apri la scheda. Sotto la tabella la legenda del
punto. In larghezza compatta restano Paziente e Da fare, e toccare la riga
apre la scheda.

### Controlli

| Controllo | Regola |
| --- | --- |
| Comando | Alto quanto la riga. Principale: fondo inchiostro fresco, testo del colore del piano. Secondario: bordo filetto forte, fondo del piano. Uno solo principale per vista |
| Campo | Alto quanto la riga, bordo filetto forte, etichetta sempre presente anche se nascosta alla vista |
| Segmenti | Fondo penombra, segmento attivo sul piano con peso 600 |
| Interruttore | 40 × 24 px disegnati, area di tocco 44 px, attivo in inchiostro fresco, accanto a titolo e riga che dice l'effetto pratico |
| Fuoco da tastiera | Contorno di 2 px inchiostro fresco, staccato di 2 px, mai nascosto dalla soglia |
| Allergia | Pillola con bordo critico, ▲ e testo |

### Stati di una vista

Ogni vista ha i suoi stati, con testo e azione: vuoto, caricamento, non in
linea, dato non più attuale, conflitto, accesso negato, campo illeggibile,
errore. I testi sono nella sezione [Testi](#testi) e nella schermata "Stati"
del banco. Un dato che non si è potuto leggere non si mostra mai come vuoto.

## Movimento

| Occasione | Durata e curva | Con riduzione del movimento |
| --- | --- | --- |
| Tastiera, selezione di righe, passaggio del puntatore | 0 ms | uguale |
| Pressione di un comando | 80 ms, scala 0,97 | nessuna scala |
| Segmenti, interruttori, menu | 160 ms | cambio immediato |
| Fogli e pannelli | 240 ms in ingresso, 160 ms in uscita | sola dissolvenza |
| Il punto che si posa | 520 ms, `cubic-bezier(.3,1.5,.5,1)`, una volta: scende di 0,7 em, tocca, diventa asciutto | cambia solo colore |
| L'inchiostro che asciuga | 1500 ms, solo colore, `ease-out` | cambio immediato |
| Il punto durante l'ascolto | Ciclo di 1400 ms, il contorno si ispessisce e torna | fermo, resta la parola "In ascolto" |

Il testo non si sposta mai durante un'animazione. Nessuna animazione
all'ingresso di una pagina. Nessuna attesa aggiunta per mostrare un effetto.
L'uscita è sempre più rapida dell'ingresso.

## Tastiera

| Gesto | macOS, iPadOS | Windows, Linux, web |
| --- | --- | --- |
| Comandi e ricerca | ⌘K | Ctrl+K |
| Cerca nella vista | / | / |
| Scorrere l'elenco | ↑ ↓ oppure j k | ↑ ↓ oppure j k |
| Aprire la scheda | Invio | Invio |
| Nuova voce | ⌘N | Ctrl+N |
| Registra (apre la conferma) | ⌘Invio | Ctrl+Invio |
| Conferma e registra | ⌘Invio nella conferma | Ctrl+Invio nella conferma |
| Torna alla bozza | Esc | Esc |
| Avvia o ferma l'ascolto | ⌘⇧A | Ctrl+Shift+A |
| Blocca | ⌘L | Ctrl+L |

Le scorciatoie web vanno verificate contro quelle del browser prima di essere
dichiarate: Ctrl+N e Ctrl+L sono normalmente del browser e sul web localhost
possono richiedere un'alternativa. L'ordine di tabulazione segue l'ordine di
lettura: testata, sezioni, quadro, diario, soglia.

## Accessibilità

- Testo ad almeno 4,5:1, controlli e segni ad almeno 3:1, in entrambi i
  registri.
- Bersagli da 44 px al tocco.
- Ogni stato ha parola e forma oltre al colore.
- La soglia è una regione di stato annunciata.
- Riduzione del movimento, riduzione della trasparenza, aumento del contrasto
  e dimensione del testo del sistema sono rispettati su ogni piattaforma.
- Il supporto ai lettori di schermo si dichiara solo dopo una prova conclusa
  sulla piattaforma nominata.

## Testi

Parole fisse. Niente lineette lunghe, niente frasi di riempimento.

| Dove | Testo |
| --- | --- |
| Stato di bozza | Bozza non registrata |
| Bozza dopo un errore | Bozza intatta |
| Stato di proposta | Proposta |
| Stato registrato | Registrata da Autore; subito dopo la scrittura: Registrata alle ora da Autore |
| Comandi di scrittura | Nuova voce · Registra N elementi · Conferma e registra · Torna alla bozza · Riprova · Rileggi la scheda · Torna alla scheda |
| Comandi di proposta | Accetta · Scarta · Porta nella voce · Porta in una voce · Vedi le fonti |
| Conferma | Registrare nella scheda di Nome, età anni? |
| Regola della scrittura | La scrittura è unica: o tutto o niente. |
| Proposta lasciata fuori | Una proposta a matita resta fuori finché non la accetti. |
| Scrittura fallita | Non registrata. Nulla è stato scritto. |
| Conflitto | La scheda è stata modificata da un'altra postazione alle ora. La bozza è intatta: rileggi la scheda e riprova. |
| Vuoto | Nessun controllo aperto. (il nome della cosa che manca, senza altro) |
| Caricamento | Lettura della scheda… |
| Non in linea | Il computer dell'ambulatorio non risponde. Puoi leggere l'ultima copia, non scrivere. |
| Dato non più attuale | La scheda è cambiata alle ora su un'altra postazione. |
| Accesso negato | Questa postazione non può vedere le terapie. |
| Campo illeggibile | Questo dato non si può leggere con la chiave attuale. Non è vuoto. |
| Legenda dell'elenco | Proposta da rivedere · Bozza tua, non registrata |
| Sblocco | PIN operatore · Sblocca |
| Ascolto | vedi [03-ascolto-della-visita.md](./03-ascolto-della-visita.md) |

Il verbo "registrare" è riservato alla scrittura in cartella. L'audio si
"ascolta".

## Che cosa non fare

- Usare il blu per decorare o per uno stato clinico.
- Usare il punto per qualcosa che non sia lo stato di una scrittura.
- Rimettere una card per riga o cornici dentro cornici.
- Mettere il serif in righe di tabella, comandi, valori, soglia, errori.
- Usare il mono per date, dosi o valori: è solo per i codici.
- Inventare un corpo o una distanza fuori dalle due scale.
- Affidare uno stato al solo colore.
- Rimpicciolire testo o bersagli per guadagnare densità.
- Nascondere la soglia sotto la piega o mostrare come riuscita una scrittura
  parziale.
- Animare tastiera, righe, passaggio del puntatore.
- Vetro, sfocature e gradienti sopra contenuto clinico.
- Linee tratteggiate laterali, losanghe, onde e altri segni senza funzione.
