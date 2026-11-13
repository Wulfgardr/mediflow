# Misura dei gesti sul Web

Il test misura i percorsi del medico sul prodotto con dati sintetici e conserva
un limite che può solo scendere. Il file `conti.json` riporta i conti della base,
i percorsi, i tetti di progetto e le funzioni che oggi mancano.

## Rieseguire

Con Node 24 e `node_modules` reale nel worktree:

```sh
npm ci
npm run prepare:dependencies
nice -n 10 npm run e2e:gesti
```

Il runner sceglie una porta libera su loopback, crea un archivio sintetico nuovo,
prepara un catalogo inventato ed avvia Next in sviluppo con webpack. Chiude il
proprio processo server per PID. Conserva log e risultati in una cartella
temporanea, il cui percorso compare alla fine. Non riusa un server esistente.

Per cinque prove sullo stesso server:

```sh
GESTURE_RUNS=5 GESTURE_OUTPUT_DIR=/percorso/locale/evidenze nice -n 10 npm run e2e:gesti
```

`GESTURE_RECORD=1` produce misure senza applicare il cricchetto. Non modifica il
file versionato: abbassare o aggiornare la base richiede una modifica esplicita.
`GESTURE_PROVE_RED=1` fa fallire la prova permanente del cricchetto con un gesto
in più. Le prove normali verificano sia l’uguaglianza sia il rifiuto di ogni
contatore aumentato.

## Regola e limiti

Gli ascoltatori sono iniettati con `addInitScript`. Un `click` con `detail > 0`
vale un gesto. Invio su un pulsante produce anche un clic con `detail = 0`, che
non viene contato. Tab, Invio, frecce, Esc, scorciatoie e comandi fuori dai campi
valgono un gesto. I soli modificatori e la composizione IME non contano.
Caratteri e cancellazioni nei campi contano separatamente come tasti.

La regola del testo comprende anche il campo `contenteditable` del diario.
Il prototipo usa una textarea: applicarne alla lettera il selettore escluderebbe
il testo del diario e ne conterebbe ogni carattere come gesto. Il test del
contatore copre entrambe le superfici. Non sono contati scorrimenti o movimenti
del puntatore: si applica il perimetro click/keydown del brief. Playwright può
scorrere automaticamente per rendere un comando visibile.

Le modalità confrontano un percorso con puntatore e uno da tastiera. Anche il
primo usa Tab e la lettera `n` per scegliere l’identificativo nel select nativo.
Nessuna azione misurata usa `fill`, `focus`, `selectOption` o eventi sintetici.
La preparazione può aprire una rotta o impostare la ricerca senza esito, prima
del confine iniziale. La tastiera attraversa i controlli con veri Tab in avanti, dal fuoco
impostato dal prodotto. Per tornare dall’opzione dell’anno al suo campo usa
Shift+Tab. Non è una prova matematica del minimo
fra tutti i percorsi possibili.

Per ogni gesto il JSON di esecuzione conserva evento, destinazione, timestamp e
millisecondi fino al primo `requestAnimationFrame`. La base conserva il peggiore
per percorso. Questo intervallo non attesta il completamento della risposta
applicativa o un fotogramma già aggiornato. Sviluppo, compilazione e scheduling
rendono i tempi inadatti al gate dei 100 ms. Il cricchetto confronta gesti, clic,
comandi e tasti, senza usare i tempi o i tetti di progetto come soglie.

I campi data e ora nativi hanno segmenti interni decisi dal sistema: con l’orologio
a dodici ore c’è un segmento in più (AM/PM), e ogni segmento è una fermata di Tab.
Sulla macchina della CI la visita da tastiera costa per questo 26 gesti, contro i
25 della base. Il contatore segna i tasti premuti dentro quei campi
(`fermateDataOra`) e il cricchetto li confronta a parte: fuori dai campi il
confronto resta esatto, dentro è ammessa una sola fermata oltre la base, e solo
dove la base attraversava già il campo.

La pressione della visita è scritta nel resoconto, insieme alla nota. Il percorso
non registra un’osservazione strutturata separata. I file vengono verificati
nella scheda che il test ha scelto. I gesti del selettore file del sistema
operativo restano fuori dalla misura DOM e vengono dichiarati non misurati.

Dopo ogni serie la spec ricarica le rotte e verifica le scritture persistenti,
fuori dall’intervallo misurato. Ogni scrittura misurata richiede anche una risposta
HTTP di successo del percorso reale.

## Base del 13 novembre 2026

Base prodotto `8954e9c97`. Cinque esecuzioni consecutive hanno dato conti identici,
con durata della spec da 25,1 a 42,0 secondi. La CI esegue il runner nello shard
E2E 1, su un archivio proprio, e conserva log e JSON come artifact.

| Compito | Puntatore | Tastiera | Tetto |
|---|---:|---:|---:|
| Trovare un paziente, con omonimi | 3 | 4 | 2 |
| Nuova scheda senza codice fiscale, anno stimato | 9 | 24 | 5 |
| Visita, pressione nel resoconto | 3 | 25 | 4 |
| Terapia nuova, dose e posologia | 5 | 13 | 6 |
| Aggiornare la terapia invariata, alternativa alla conferma assente | 3 | 11 | 4 |
| Caricare un documento nella scheda già scelta, alternativa alla coda assente | 2 nella pagina | 10 nella pagina | 4 |

Confermare la revisione di una terapia invariata ed associare un documento da
una coda in arrivo sono **non eseguibili oggi**. I percorsi alternativi non ne
attestano il completamento. Il [file dei conti](conti.json) conserva motivo,
confini, percorsi e risposta peggiore per ogni variante.
