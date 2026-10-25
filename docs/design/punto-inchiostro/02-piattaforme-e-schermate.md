---
summary: "Punto d'inchiostro per piattaforma: che cosa resta identico, che cosa segue web, macOS, Windows, Linux, iPhone, iPad e iPhone Duo, e la mappa di ogni schermata."
read_when:
  - "Portando una schermata MediFlow su una piattaforma specifica."
  - "Decidendo se una differenza fra piattaforme è voluta o è una deriva."
---

# Piattaforme e schermate

## Che cosa non cambia mai

Su ogni piattaforma, senza eccezioni:

- il punto e i tre inchiostri, con le stesse parole;
- Newsreader per nome del paziente, prosa clinica e titoli; IBM Plex Mono solo
  per i codici;
- i colori dei token, Giorno e Grafite;
- l'ordine delle informazioni: identità e allergia, quadro, diario, soglia;
- i testi dei comandi e della soglia;
- i cinque stati della scrittura e i loro esiti;
- il movimento: nessuno nei gesti ripetuti, il punto che si posa,
  l'inchiostro che asciuga.

## Che cosa segue la piattaforma

Il carattere dei controlli, finestre e barre, menu, raggi, materiali,
posizione del comando principale, gesti, scorciatoie con il modificatore
locale. Una differenza oltre queste va scritta con la sua ragione, come chiede
`DESIGN.md`.

| | Web localhost | macOS | Windows | Linux | iPad | iPhone | iPhone Duo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Carattere dei controlli | `system-ui` | San Francisco | Segoe UI Variable | Carattere del desktop | San Francisco | San Francisco | San Francisco |
| Corpo del registro | 14 px | 13,5 pt | 14 px | 14 px | 15,5 pt | 15,5 pt | 15,5 pt |
| Riga | 40 px | 40 pt | 40 px, 44 al tocco | 40 px | 44 pt | 44 pt | 44 pt |
| Raggio controlli e piano | 10 e 16 | 8 e 12 | 4 e 8 | 6 e 10 | 12 e 18 | 12 e 18 | 12 e 18 |
| Navigazione | Colonna a sinistra | Barra laterale | Navigazione a sinistra con tacca di selezione | Barra laterale | Barra laterale | Schede in basso | Chiuso: schede. Aperto: schede, due pagine |
| Cornice | Nessuna | Barra unificata, semafori | Barra del titolo, comandi a destra | Barra d'intestazione, titolo al centro | Nessuna | Barra di stato | Barra di stato |
| Comando principale | In alto a destra del piano | Barra degli strumenti | In alto a destra del piano | Barra d'intestazione o in alto a destra | In alto a destra | Nella soglia, sopra le schede | Sulla pagina destra |
| Anteprima dell'elenco | Colonna a destra | Ispettore | Colonna a destra | Colonna a destra | Colonna a destra | Assente: la riga apre la scheda | Pagina destra |
| Trasparenza | Nessuna | Solo barra laterale e barra degli strumenti | Solo titolo e navigazione | Nessuna | Solo barre | Solo barre | Solo barre |

Il banco mostra ognuna di queste colonne: menu "Piattaforma".

### Web localhost

- HTML semantico; il piano è `main`, la navigazione `nav`, la soglia una
  regione di stato.
- Le classi di larghezza si misurano sul contenitore dell'applicazione
  (container query), così valgono anche dentro una finestra incorporata.
- Caratteri locali: Newsreader va aggiunto in `app/fonts` accanto a
  IBM Plex Mono. Inter esce dall'interfaccia.
- Token: quando WUL-765 li porta nel runtime, entrano in
  `docs/design/lume/tokens/lume.tokens.json` e nello specchio
  `app/lume-tokens.css`, con il controllo di deriva esistente.
- Niente controlli nativi del browser lasciati senza stile accanto a controlli
  disegnati: menu a tendina e campo data seguono la regola dei campi.

### macOS

- Finestra con barra unificata; barra laterale per le aree; ispettore per
  l'anteprima; menu completi con le scorciatoie della specifica.
- Il piano resta opaco. I materiali di sistema stanno su barra laterale e
  barra degli strumenti e seguono "Riduci trasparenza".
- Il target resta macOS 14: i materiali più recenti si usano solo dove il
  sistema li offre, senza cambiare disposizione.
- Newsreader e IBM Plex Mono inclusi nell'app; i corpi seguono la dimensione
  del testo del sistema.
- L'ascolto della visita esiste solo qui, da macOS 26
  ([03-ascolto-della-visita.md](./03-ascolto-della-visita.md)).

### Windows e Linux

La shell non è ancora scelta
([WUL-714](https://linear.app/wulfgardr/issue/WUL-714)): le regole qui sotto
valgono qualunque essa sia.

- Windows: barra del titolo con i comandi di finestra a destra; navigazione a
  sinistra con la tacca di selezione della piattaforma; raggi 4 e 8; Segoe UI
  Variable; con un tema a contrasto elevato i token cedono ai colori di
  sistema e restano forma e parola.
- Linux: prima riga dichiarata GNOME, con barra d'intestazione e titolo al
  centro; raggi 6 e 10; carattere del desktop. Altri ambienti quando la 0.9.6
  li dichiara.
- Su entrambe: modificatore Ctrl, bersagli da 44 px quando l'ingresso è il
  tocco.

### iPad

- Larghezza regolare: barra laterale e piano, con le due colonne della scheda
  affiancate in orizzontale e ravvicinate in verticale.
- Larghezza compatta (finestra stretta o affiancata): come iPhone.
- Tastiera e puntatore: stesse scorciatoie del Mac, riga evidenziata al
  passaggio.
- Con il testo alle dimensioni di accessibilità le colonne diventano una.

### iPhone

- Una colonna. Quattro schede: Pazienti, Agenda, Diario, Altro.
- Scheda: testata, sezioni a segmenti che scorrono, quadro, diario.
- Scrittura: il diario sale sopra il quadro, la voce viva è la prima cosa
  sotto la testata; la soglia sta sopra la barra delle schede e non scorre.
- Il comando di ascolto è nella riga di stato della voce, non nella soglia.

### iPhone Duo

La compatibilità richiesta riguarda il layout completo. Il target seguente
resta da completare e qualificare con Xcode/SDK 27.1 e Device Hub Duo.
Le dimensioni ricavate dalla stampa non sono un vincolo hardware, una
soglia di riconoscimento del dispositivo o una misura della piega.

**Target di prodotto**

- **Chiuso:** tutti i percorsi dell'iPhone restano disponibili, adattati allo
  spazio effettivo; elenco, scheda e scrittura mantengono continuità.
- **Aperto, Pazienti:** elenco e anteprima nelle due regioni disponibili.
- **Aperto, Scheda:** quadro e diario nelle due regioni disponibili.
- **Aperto, Scrittura:** quadro e voce viva nelle due regioni disponibili.
  Il messaggio della soglia e i suoi comandi occupano regioni distinte,
  mantenendo chiaro a quale paziente e a quale operazione si riferiscono.
- Ogni regione ha una testata e comandi di conferma distinti, con contesto
  paziente e operazione espliciti. Le quattro schede restano visibili anche
  aperto: due per regione, secondo la composizione da qualificare con le
  API ufficiali.
- Contenuti, testo e controlli non si sovrappongono alle regioni di divisione
  o di occlusione. Posizione e spazio derivano dalle API ufficiali, non da
  una distanza centrale fissa. Le safe area asimmetriche restano rispettate.
- Aprire, chiudere o cambiare postura preserva paziente selezionato, sezione,
  bozza completa e stato della soglia/conferma, senza registrare dati o
  confermare operazioni. Tutte le funzioni restano raggiungibili.
- **Parziale, anche appoggiato:** adattare le regioni effettivamente usabili
  senza perdere questi contenuti o comandi. Non assumere la geometria della
  postura aperta; definire e verificare la composizione con l'SDK ufficiale.

**Incremento adattivo implementato**

Il client usa una sola gerarchia mobile: `TabView` con quattro schede
native e `NavigationSplitView` per elenco e scheda. Su spazio regolare la
navigazione principale è un elenco nativo in overlay: non aggiunge una
terza colonna alla cartella. Le colonne dipendono dallo spazio effettivo, dalla dimensione
del testo e dalla size class verticale, senza riconoscere il dispositivo
per nome o idiom. Il 42% è una larghezza ideale dell'elenco entro limiti di
contenuto, non la posizione della piega. Altro e Progetto restano percorsi
per le altre superfici.

Questo incremento compila con SDK 27.0 e prepara la continuità durante i
cambi di spazio. Non implementa ancora quadro/diario e quadro/voce in regioni
distinte, né la composizione Duo delle testate, delle quattro schede e della
soglia. Le prove simulate verificano anche che la navigazione laterale non
riduca l'area clinica protetta dall'overlay (#142).

**Qualifica residua**

Le fonti Apple sono [Above the fold](https://developer.apple.com/videos/play/tech-talks/111461/)
e [Adaptive layouts](https://developer.apple.com/videos/play/tech-talks/111463/).
Con Xcode/SDK 27.1 occorre verificare i contenitori di sistema e le API
`ReservedRegion` (divisione e occlusione) e `ArrangementView` prima di
utilizzarle. Non sono sostituite da API ricostruite.

Restano aperte implementazione e qualifica del target completo: posture
chiusa/aperta/parziale, divisione, occlusioni, safe area, tastiera, dimensioni
accessibili, quattro schede e continuità di bozze e conferme attraverso le
transizioni reali. Larghezze sintetiche, runtime 27.1 senza il relativo SDK
e build riuscite non qualificano la compatibilità fisica Duo. Lo stato
resta **non completo** fino alla verifica con SDK 27.1 e alle prove richieste.

### Mini e Headless

Stessi tre stati con gli stessi nomi: `○ matita`, `● fresco`, `● asciutto`.
Stessa domanda di conferma con nome, età e conteggio. Dopo la scrittura una
riga dice che cosa è rimasto fuori. Vedi la schermata "Mini" del banco.

### Icona e installer

Icona candidata in [icona/](./icona/): un tratto orizzontale che comincia a
matita (due punti grigi), diventa inchiostro fresco (tratto blu) e si chiude
nel punto asciutto. Niente testo, niente simboli medici, forme piene leggibili
fino a 16 px. `punto-giorno.svg` e `punto-grafite.svg` sono i due registri;
`punto-fg.svg` è il livello senza sfondo per gli strumenti di composizione
della piattaforma; `alternativa-alone-giorno.svg` è una seconda idea, il punto
con un alone a matita. Come l'icona attuale, i livelli restano quadrati e
senza ombre: maschera e materiali li applica il sistema. L'icona in uso
(`app/icon.svg` e gli asset nativi) non cambia finché Leonardo non accetta la
candidata. Nell'installer il nome è in serif con il punto.

### Sito

Titolo in serif chiuso dal punto, una scheda vera del prodotto in grande con
dati sintetici, i tre inchiostri in tre colonne. Lo realizza il modello che
Leonardo sceglierà; il sito non ha sorgente in questa repository
([WUL-769](https://linear.app/wulfgardr/issue/WUL-769)). Il riferimento visivo
è la schermata "Home del sito" dei prototipi di confronto.

## Mappa delle schermate

Le 17 schermate del banco, con l'origine nel prodotto di oggi e la
disposizione per classe di larghezza.

| Schermata del banco | Web oggi | Apple oggi | Estesa | Compatta |
| --- | --- | --- | --- | --- |
| Sblocco | `components/lock-screen.tsx` | accesso nativo | Scheda centrata, nome con il punto | uguale |
| Primo avvio | `components/work-profile-onboarding.tsx`, `onboarding-wizard.tsx` | n.d. | Scheda centrata, una domanda per volta | uguale |
| Pazienti | `app/page.tsx` (area incarico) | `PairedPatientsWorklistView` | Tabella e anteprima | Due colonne, la riga apre la scheda |
| Scheda paziente | `app/patients/[id]/modules`, `patient-synoptic-sheet.tsx` | `PairedPatientsWorkspaceView`, `MacPatientContextInspector` | Quadro e diario affiancati | Testata, segmenti, una colonna |
| Scrittura con conferma | `app/patients/[id]/entries/new` | `PairedDiaryComposerView` | Voce viva nel diario, soglia in fondo | Voce viva in cima, soglia sopra le schede |
| Ascolto della visita | assente | `VisitRecordingLumeShell` | Pannello dentro la voce viva | uguale |
| Terapie | `therapy-manager.tsx`, `treatment-reasoning-panel.tsx` | `PairedPatientTherapiesSection` | Tabella con comandi di riga, concluse, proposte | Nome e posologia, comandi nel dettaglio |
| Misure | `observation-manager.tsx` | `PairedPatientClinicalSections` | Tabella e andamento della misura scelta | Tabella, poi andamento |
| Documenti e proposte | `document-viewer.tsx`, `patient-smart-import-fabric-preview-card.tsx`, `document-insights-panel.tsx` | `PairedPatientDocumentsSection`, `PairedAttachmentDetailView` | Elenco e proposte a sinistra, originale a destra | Elenco, poi originale |
| Agenda | `app/page.tsx` (area turno) | n.d. | Gruppi per urgenza: scaduti, da prenotare, prossimi | uguale, una colonna |
| Diario | `app/diary` | `PairedPatientDiarySection` | Voci di tutti i pazienti, ricerca e filtri | uguale |
| Repertori | `app/page.tsx` (area repertori), `icd-autocomplete.tsx`, `drug-autocomplete.tsx` | `RepertoriWorkspaceView` | Segmenti per catalogo, risultati, fonte e data | uguale |
| Analisi | `app/analytics` | n.d. | Numeri chiave, tabella, un grafico per domanda | una colonna |
| Scale | `app/scales`, `app/patients/[id]/scales/[scaleId]` | `ClinicalScaleFormView`, `PairedScalesSection` | Voci a sinistra, risultato in bozza a destra, soglia | una colonna, soglia in fondo |
| Impostazioni | `app/settings/*` | `SettingsWorkspaceView`, `NativeAIConfigurationView` | Sezioni a sinistra, righe con interruttore ed effetto pratico | Sezioni in una riga che scorre |
| Stati | sparsi | sparsi | Testo, causa, azione | uguale |
| Mini | CLI | CLI | Testo a larghezza fissa | uguale |

### Superfici non disegnate una per una

Seguono la schermata indicata, con gli stessi componenti.

| Superficie | Segue | Nota |
| --- | --- | --- |
| Nuova scheda, modifica anagrafica (`app/patients/new`, `edit`) | Scale | Modulo a sinistra, riepilogo in bozza a destra, soglia |
| Importazione di pazienti (`app/patients/import`) | Documenti e proposte | Ogni riga importata è una proposta a matita finché non è accettata |
| Prescrizioni di prestazioni e protesica | Terapie | Stessa tabella, stessi comandi di riga |
| Ragionamento terapeutico, riepilogo assistito | Terapie, sezione Proposte | Risultato sempre a matita, con fonti |
| Revisione di una proposta di un agente (`headless-soap-approval-dialog.tsx`) | Scrittura con conferma | La proposta è la voce a matita; accettarla la rende bozza |
| Spazio di lavoro SISS | Documenti e proposte | Fuori dal perimetro di questa direzione finché il filone SISS non lo richiede |
| Sezioni delle impostazioni (Profilo, Accesso, Ambulatori, Aspetto, Backup, Repertori, Funzioni AI, Modelli, Governo dei dati, Diagnostica, Zona pericolo) | Impostazioni | Zona pericolo usa la soglia in due tempi |
| Backup e ripristino | Impostazioni, con soglia | Il ripristino è una scrittura: conferma con ciò che verrà sostituito |
| Modalità riservata (`privacy-mode-toggle.tsx`) | tutte | Nasconde i contenuti, non il motivo né il comando per tornare |

"n.d." significa che non ho trovato una vista corrispondente nell'app Apple di
oggi: all'ingresso della issue l'owner verifica sul codice corrente.

## Prove per piattaforma

Per dichiarare una schermata pronta su una piattaforma:

1. confronto affiancato con il banco, in Giorno e Grafite;
2. percorso completo da tastiera dove c'è una tastiera;
3. bersagli da 44 px dove c'è il tocco;
4. riduzione del movimento, riduzione della trasparenza, aumento del
   contrasto, testo ingrandito;
5. per le scritture: una riuscita con rilettura e un caso che fallisce, su
   dati sintetici.
