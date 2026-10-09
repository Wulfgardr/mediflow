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

| Voce | Carattere | Corpo | Dove |
| --- | --- | --- | --- |
| Voce | Newsreader 400 | 30 px, interlinea 1,05 | Nome del paziente in testata (26 px in larghezza compatta) |
| Voce | Newsreader 400 | 28 px | Titolo di pagina: Pazienti, Agenda, Impostazioni |
| Voce | Newsreader 400 | 17 px, interlinea 1,45 | Prosa del diario, nomi in elenco, messaggio della soglia |
| Voce | Newsreader 500 | 21 px | Nome del prodotto |
| Registro | Sistema 400, 500, 600 | 13,5 px, interlinea 1,4 | Controlli, tabelle, etichette |
| Registro | Sistema 600, maiuscolo, spaziatura 0,07 em | 11 px | Intestazione di sezione |
| Dati | IBM Plex Mono 400 | 12 px | Date, ore, codici, identificativi, variazioni |
| Dati | IBM Plex Mono 500 | pari al testo vicino | Dosi e valori |

- Newsreader e IBM Plex Mono sono file locali con licenza OFL su ogni
  piattaforma. Il prodotto non scarica caratteri dalla rete.
- Il carattere di sistema è: San Francisco su Apple, Segoe UI Variable su
  Windows, il carattere del desktop su Linux, `system-ui` sul web.
- Il serif non entra in tabelle di dati, comandi, valori, messaggi di errore.
- I numeri in colonna usano cifre tabulari.
- La prosa non supera 64 caratteri per riga.
- Sulle piattaforme con testo regolabile ogni corpo scala con la preferenza
  dell'utente; oltre il 200% le colonne affiancate diventano una.

## Forma e spazio

| Elemento | Valore |
| --- | --- |
| Riga di tabella o elenco | 36 px con puntatore, 44 px al tocco |
| Bersaglio minimo al tocco | 44 px; l'area può estendersi oltre il disegno (interruttori) |
| Margine interno del piano | 22 px; 16 px in larghezza compatta |
| Distanza fra le due colonne | 28 px; 18 px in larghezza media |
| Colonna di margine del diario | 70 px |
| Navigazione laterale | 176 px; 150 px in larghezza media |
| Anteprima accanto all'elenco | 290 px |
| Raggio di righe e record | 0 |
| Raggio dei controlli | web 10, macOS 8, Windows 4, Linux 6, iOS e iPadOS 12 |
| Raggio del piano | web 16, macOS 12, Windows 8, Linux 10, iOS e iPadOS 18 |
| Raggio della voce in scrittura | 12 px |
| Pillola | Solo allergia e scelte compatte |
| Ombra | Solo sotto il piano: `0 18px 44px -26px` nero al 45% più un bordo di 1 px al 6% |
| Punto | 0,44 em; 0,24 em quando chiude un titolo o il nome |

Classi di larghezza, misurate sul contenitore dell'applicazione:

| Classe | Larghezza | Disposizione |
| --- | --- | --- |
| Compatta | sotto 700 px | Una colonna, schede in basso, anteprima nascosta |
| Media | da 700 a 1000 px | Navigazione stretta, colonne ravvicinate, colonne secondarie nascoste |
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

Nome in serif, riga di dati in mono (sesso, età, data di nascita, codice
fiscale), allergia in pillola con ▲ sempre visibile, poi i comandi a destra.
Il comando principale è uno solo ed è a destra: Nuova voce. Sotto la testata,
un controllo a segmenti: Riepilogo, Terapie, Misure, Documenti.

### Quadro

Quattro tabelle a filetti, ciascuna con intestazione di sezione e conteggio in
mono a destra: Problemi (codice, descrizione, da quando), Terapie attive
(nome e dose, posologia, ATC), Misure recenti (nome, valore e unità a destra,
data, variazione), Controlli aperti (nome, scadenza). In larghezza media le
colonne secondarie (da quando, ATC, variazione) si nascondono, non si
rimpiccioliscono.

### Voce di diario

Griglia: margine di 70 px con data e ora in mono, poi il corpo. Corpo: tipo
in peso 600 e luogo in mono, prosa in serif, riga di registrazione in mono con
il punto asciutto ("Registrata da ..."). Filetto sotto ogni voce. In larghezza
compatta il margine sale sopra il corpo.

### Voce in scrittura

Nasce in cima al diario. Fondo e bordo propri, raggio 12 px. Contiene, in
ordine:

1. stato con punto ("Bozza non registrata") e, a destra, il comando di ascolto;
2. tipo e luogo;
3. area di testo in serif, colore inchiostro fresco, altezza minima 190 px;
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
messaggio (titolo in serif con il punto, riga di dettaglio), a destra i
comandi.

| Stato | Aspetto | Titolo | Dettaglio | Comandi |
| --- | --- | --- | --- | --- |
| Bozza | Fondo del piano | Bozza non registrata | N elementi pronti per la scheda di Nome. Se c'è una proposta: Una proposta a matita resta fuori finché non la accetti. | Registra N elementi |
| Conferma | Soglia scura | Registrare nella scheda di Nome, età anni? | Conteggio per tipo. La scrittura è unica: o tutto o niente. | Torna alla bozza, Conferma e registra |
| In corso | Fondo del piano | Registrazione in corso | Attendi la conferma prima di chiudere. | Comando disattivato |
| Registrata | Fondo del piano, punto che si posa | Registrata il giorno alle ora | N elementi scritti e tracciati a nome di Autore. | Torna alla scheda |
| Non registrata | Fondo del piano, ✕ critico | Non registrata. Nulla è stato scritto. | La causa. La bozza è intatta: rileggi la scheda e riprova. | Rileggi la scheda, Riprova |
| In ascolto | Fondo del piano, punto vuoto che respira | In ascolto mm:ss | Ferma l'ascolto prima di registrare. | Registra disattivato |

"Registrata" compare solo dopo la rilettura dello stato salvato. Un esito
parziale non viene mai mostrato come riuscito né come fallito per intero. Il
cambio di stato è annunciato ai lettori di schermo (regione di stato) e dopo
ogni passaggio il fuoco va sul comando principale del nuovo stato.

### Elenco pazienti

Riga di strumenti: titolo, ricerca, segmenti (In carico, Da rivedere,
Archivio), Nuova scheda. Tabella: Paziente (nome in serif con il punto
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
- Mettere il serif in tabelle di dati, comandi, valori, errori.
- Affidare uno stato al solo colore.
- Rimpicciolire testo o bersagli per guadagnare densità.
- Nascondere la soglia sotto la piega o mostrare come riuscita una scrittura
  parziale.
- Animare tastiera, righe, passaggio del puntatore.
- Vetro, sfocature e gradienti sopra contenuto clinico.
- Linee tratteggiate laterali, losanghe, onde e altri segni senza funzione.
